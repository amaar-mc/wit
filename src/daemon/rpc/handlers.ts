import { z } from "zod";
import { eq, gt, and } from "drizzle-orm";
import { agents, locks } from "../../db/schema";
import {
  createRpcSuccess,
  createRpcError,
  type RpcRequest,
  type RpcSuccess,
  type RpcError,
} from "../../shared/protocol";
import type { DaemonDeps } from "../server";

const RegisterParamsSchema = z.object({
  name: z.string().min(1),
  sessionId: z.string().min(1),
});

const LockAcquireParamsSchema = z.object({
  symbolPath: z.string().min(1).refine((s) => s.includes(":"), {
    message: "symbolPath must contain ':' separator (e.g. 'src/auth.ts:functionName')",
  }),
  sessionId: z.string().min(1),
  ttlMs: z.number().optional(),
});

const LockReleaseParamsSchema = z.object({
  symbolPath: z.string().min(1),
  sessionId: z.string().min(1),
});

const LockQueryParamsSchema = z.object({
  sessionId: z.string().optional(),
});

const DEFAULT_TTL_MS = 1_800_000;

export async function handleRpc(
  body: RpcRequest,
  deps: DaemonDeps,
): Promise<RpcSuccess | RpcError> {
  switch (body.method) {
    case "ping":
      return createRpcSuccess(body.id, "pong");

    case "register": {
      const parsed = RegisterParamsSchema.safeParse(body.params);
      if (!parsed.success) {
        return createRpcError(
          body.id,
          -32600,
          "INVALID_REQUEST",
          parsed.error.flatten(),
        );
      }
      const { name, sessionId } = parsed.data;
      try {
        const rows = await deps.db
          .insert(agents)
          .values({
            name,
            sessionId,
            connectedAt: new Date(),
          })
          .returning({ id: agents.id });
        const inserted = rows[0];
        if (!inserted) {
          return createRpcError(body.id, -32000, "Failed to insert agent — no row returned");
        }
        return createRpcSuccess(body.id, { agentId: inserted.id });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to register agent";
        return createRpcError(body.id, -32000, message);
      }
    }

    case "lock.acquire": {
      const parsed = LockAcquireParamsSchema.safeParse(body.params);
      if (!parsed.success) {
        return createRpcError(
          body.id,
          -32600,
          "INVALID_REQUEST",
          parsed.error.flatten(),
        );
      }
      const { symbolPath, sessionId, ttlMs } = parsed.data;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (ttlMs ?? DEFAULT_TTL_MS));

      // Check for existing lock on this symbol
      const existing = await deps.db
        .select()
        .from(locks)
        .where(eq(locks.symbolPath, symbolPath))
        .limit(1);

      const existingLock = existing[0];

      // If a non-expired lock is held by a different session, return conflict
      if (
        existingLock &&
        existingLock.sessionId !== sessionId &&
        existingLock.expiresAt.getTime() > now.getTime()
      ) {
        return createRpcError(body.id, -32000, "LOCK_CONFLICT", {
          heldBy: existingLock.sessionId,
          expiresAt: existingLock.expiresAt.toISOString(),
        });
      }

      // Upsert: insert or update (covers same session refresh and expired lock takeover)
      await deps.db
        .insert(locks)
        .values({
          symbolPath,
          sessionId,
          acquiredAt: now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: locks.symbolPath,
          set: {
            sessionId,
            acquiredAt: now,
            expiresAt,
          },
        });

      return createRpcSuccess(body.id, {
        symbolPath,
        sessionId,
        acquiredAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
    }

    case "lock.release": {
      const parsed = LockReleaseParamsSchema.safeParse(body.params);
      if (!parsed.success) {
        return createRpcError(
          body.id,
          -32600,
          "INVALID_REQUEST",
          parsed.error.flatten(),
        );
      }
      const { symbolPath, sessionId } = parsed.data;

      // Check for existing lock
      const existing = await deps.db
        .select()
        .from(locks)
        .where(eq(locks.symbolPath, symbolPath))
        .limit(1);

      const existingLock = existing[0];

      if (!existingLock) {
        return createRpcError(body.id, -32000, "LOCK_NOT_FOUND");
      }

      if (existingLock.sessionId !== sessionId) {
        return createRpcError(body.id, -32000, "LOCK_NOT_HELD", {
          heldBy: existingLock.sessionId,
        });
      }

      await deps.db.delete(locks).where(eq(locks.symbolPath, symbolPath));

      return createRpcSuccess(body.id, { released: true });
    }

    case "lock.query": {
      const parsed = LockQueryParamsSchema.safeParse(body.params);
      if (!parsed.success) {
        return createRpcError(
          body.id,
          -32600,
          "INVALID_REQUEST",
          parsed.error.flatten(),
        );
      }
      const { sessionId } = parsed.data;
      const now = new Date();

      // Build base query: only non-expired locks
      const conditions = [gt(locks.expiresAt, now)];
      if (sessionId) {
        conditions.push(eq(locks.sessionId, sessionId));
      }

      const rows = await deps.db
        .select()
        .from(locks)
        .where(and(...conditions));

      const result = rows.map((row) => ({
        symbolPath: row.symbolPath,
        sessionId: row.sessionId,
        acquiredAt: row.acquiredAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        ttlRemainingMs: row.expiresAt.getTime() - now.getTime(),
      }));

      return createRpcSuccess(body.id, result);
    }

    default:
      return createRpcError(body.id, -32601, "METHOD_NOT_FOUND");
  }
}
