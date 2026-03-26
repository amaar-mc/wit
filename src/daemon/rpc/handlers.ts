import { z } from "zod";
import { eq, gt, and, inArray, sql } from "drizzle-orm";
import { join } from "node:path";
import { agents, locks, symbolDeps, intents } from "../../db/schema";
import {
  createRpcSuccess,
  createRpcError,
  type RpcRequest,
  type RpcSuccess,
  type RpcError,
} from "../../shared/protocol";
import type { DaemonDeps } from "../server";
import { extractSymbols } from "../../parser/symbols";
import { extractCallEdges, qualifyEdges } from "../../parser/calls";

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

const IntentDeclareParamsSchema = z.object({
  sessionId: z.string().min(1),
  description: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
  symbols: z.array(z.string()).optional(),
});

const IntentUpdateParamsSchema = z.object({
  intentId: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(["active", "resolved", "abandoned"]),
});

const IntentQueryParamsSchema = z.object({
  sessionId: z.string().optional(),
  file: z.string().optional(),
  status: z.string().optional(),
});

// Valid forward-only status transitions for intent lifecycle
const VALID_TRANSITIONS: Record<string, string[]> = {
  declared: ["active", "resolved", "abandoned"],
  active: ["resolved", "abandoned"],
};

const DEFAULT_TTL_MS = 1_800_000;

// Language detection by file extension
function detectLanguageId(filePath: string): "typescript" | "python" | null {
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".js") || filePath.endsWith(".jsx")) {
    return "typescript";
  }
  if (filePath.endsWith(".py")) {
    return "python";
  }
  return null;
}

// Parse a source file and refresh all symbol_deps rows for it.
// If the file does not exist or has an unknown extension, returns silently.
async function parseFileAndRefreshDeps(
  deps: DaemonDeps,
  symbolPath: string,
): Promise<void> {
  // symbolPath format: "src/auth.ts:symbolName"
  const colonIdx = symbolPath.indexOf(":");
  const filePath = symbolPath.slice(0, colonIdx);

  const langId = detectLanguageId(filePath);
  if (langId === null) return;

  // Resolve to absolute path using WIT_REPO_ROOT env var or cwd
  const repoRoot = process.env["WIT_REPO_ROOT"] ?? process.cwd();
  const absolutePath = join(repoRoot, filePath);

  const file = Bun.file(absolutePath);
  const exists = await file.exists();
  if (!exists) return;

  const source = await file.text();

  const language = langId === "typescript"
    ? deps.parserService.typescript
    : deps.parserService.python;

  // IMPORTANT: Do not await anything between setLanguage and parse
  const symbols = extractSymbols(deps.parserService.parser, language, source);
  const edges = extractCallEdges(deps.parserService.parser, language, source, symbols);
  const qualified = qualifyEdges(edges, filePath, symbols);

  // Fully replace symbol_deps for this file: delete old rows, insert new
  deps.db.delete(symbolDeps).where(eq(symbolDeps.file, filePath)).run();

  if (qualified.length > 0) {
    deps.db
      .insert(symbolDeps)
      .values(qualified.map((e) => ({ file: filePath, caller: e.caller, callee: e.callee })))
      .run();
  }
}

type CallerWarning = {
  lockedSymbol: string;
  heldBy: string;
  chain: [string, string];
};

// Find all callers of symbolPath that are currently locked by a DIFFERENT session.
// Returns a warning for each such caller.
async function buildCallerWarnings(
  deps: DaemonDeps,
  symbolPath: string,
  acquirerSessionId: string,
): Promise<CallerWarning[]> {
  const now = new Date();

  // Find all symbol_deps rows where callee = symbolPath
  const callerRows = await deps.db
    .select()
    .from(symbolDeps)
    .where(eq(symbolDeps.callee, symbolPath));

  if (callerRows.length === 0) return [];

  const warnings: CallerWarning[] = [];

  for (const row of callerRows) {
    const callerSymbolPath = row.caller;

    // Check if this caller has an active lock held by a different session
    const lockRows = await deps.db
      .select()
      .from(locks)
      .where(
        and(
          eq(locks.symbolPath, callerSymbolPath),
          gt(locks.expiresAt, now),
        ),
      )
      .limit(1);

    const lock = lockRows[0];
    if (lock && lock.sessionId !== acquirerSessionId) {
      warnings.push({
        lockedSymbol: callerSymbolPath,
        heldBy: lock.sessionId,
        chain: [callerSymbolPath, symbolPath],
      });
    }
  }

  return warnings;
}

// Resolve the union byte range (min startByte, max endByte) for the given symbol names
// across all listed files. Returns null if no matching symbols found or files don't exist.
async function resolveSymbolByteRange(
  deps: DaemonDeps,
  files: string[],
  symbolNames: string[],
): Promise<{ startByte: number; endByte: number } | null> {
  const repoRoot = process.env["WIT_REPO_ROOT"] ?? process.cwd();
  let minStart: number | null = null;
  let maxEnd: number | null = null;

  for (const filePath of files) {
    const langId = detectLanguageId(filePath);
    if (langId === null) continue;

    const absolutePath = join(repoRoot, filePath);
    const file = Bun.file(absolutePath);
    const exists = await file.exists();
    if (!exists) continue;

    const source = await file.text();
    const language = langId === "typescript"
      ? deps.parserService.typescript
      : deps.parserService.python;

    // IMPORTANT: Do not await anything between setLanguage and parse
    const symbols = extractSymbols(deps.parserService.parser, language, source);

    for (const sym of symbols) {
      if (symbolNames.includes(sym.name)) {
        if (minStart === null || sym.startByte < minStart) minStart = sym.startByte;
        if (maxEnd === null || sym.endByte > maxEnd) maxEnd = sym.endByte;
      }
    }
  }

  if (minStart === null || maxEnd === null) return null;
  return { startByte: minStart, endByte: maxEnd };
}

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

      // Parse the locked file and refresh symbol_deps — enables caller warning lookups
      await parseFileAndRefreshDeps(deps, symbolPath);

      // Build caller warnings: inform acquirer if any callers of this symbol are locked elsewhere
      const warnings = await buildCallerWarnings(deps, symbolPath, sessionId);

      return createRpcSuccess(body.id, {
        symbolPath,
        sessionId,
        acquiredAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        warnings,
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

    case "intent.declare": {
      const parsed = IntentDeclareParamsSchema.safeParse(body.params);
      if (!parsed.success) {
        return createRpcError(body.id, -32600, "INVALID_REQUEST", parsed.error.flatten());
      }
      const { sessionId, description, files, symbols } = parsed.data;

      // Comma-delimited with leading/trailing commas for exact LIKE segment matching
      const filesCol = "," + files.join(",") + ",";

      // Resolve byte range if symbols were provided
      let startByte: number | null = null;
      let endByte: number | null = null;
      if (symbols && symbols.length > 0) {
        const range = await resolveSymbolByteRange(deps, files, symbols);
        if (range !== null) {
          startByte = range.startByte;
          endByte = range.endByte;
        }
      }

      const id = crypto.randomUUID();
      const now = Date.now();

      await deps.db.insert(intents).values({
        id,
        sessionId,
        description,
        files: filesCol,
        symbols: JSON.stringify(symbols ?? []),
        startByte,
        endByte,
        status: "declared",
        declaredAt: new Date(now),
        updatedAt: new Date(now),
      });

      return createRpcSuccess(body.id, { intentId: id });
    }

    case "intent.update": {
      const parsed = IntentUpdateParamsSchema.safeParse(body.params);
      if (!parsed.success) {
        return createRpcError(body.id, -32600, "INVALID_REQUEST", parsed.error.flatten());
      }
      const { intentId, sessionId, status: targetStatus } = parsed.data;

      const rows = await deps.db
        .select()
        .from(intents)
        .where(eq(intents.id, intentId))
        .limit(1);

      const intent = rows[0];
      if (!intent) {
        return createRpcError(body.id, -32000, "INTENT_NOT_FOUND");
      }

      if (intent.sessionId !== sessionId) {
        return createRpcError(body.id, -32000, "INTENT_NOT_OWNED");
      }

      const allowed = VALID_TRANSITIONS[intent.status];
      if (!allowed || !allowed.includes(targetStatus)) {
        return createRpcError(body.id, -32000, "INVALID_TRANSITION", {
          current: intent.status,
          requested: targetStatus,
        });
      }

      const updatedAt = new Date();
      await deps.db
        .update(intents)
        .set({ status: targetStatus, updatedAt })
        .where(eq(intents.id, intentId));

      return createRpcSuccess(body.id, {
        intentId,
        status: targetStatus,
        updatedAt: updatedAt.getTime(),
      });
    }

    case "intent.query": {
      const parsed = IntentQueryParamsSchema.safeParse(body.params);
      if (!parsed.success) {
        return createRpcError(body.id, -32600, "INVALID_REQUEST", parsed.error.flatten());
      }
      const { sessionId, file, status: statusFilter } = parsed.data;

      // Build where conditions dynamically
      const conditions = [];

      if (statusFilter !== undefined) {
        // Explicit status filter: return exactly that status (allows querying resolved/abandoned)
        conditions.push(eq(intents.status, statusFilter));
      } else {
        // Default: only declared and active intents
        conditions.push(inArray(intents.status, ["declared", "active"]));
      }

      if (sessionId !== undefined) {
        conditions.push(eq(intents.sessionId, sessionId));
      }

      if (file !== undefined) {
        // Exact segment match using comma-delimited format: "%,src/auth.ts,%"
        // This finds files containing exactly "src/auth.ts" as a segment (not "src/auth.ts.bak")
        conditions.push(sql`${intents.files} LIKE ${"%" + "," + file + "," + "%"}`);
      }

      const rows = await deps.db
        .select()
        .from(intents)
        .where(and(...conditions));

      const result = rows.map((row) => ({
        intentId: row.id,
        sessionId: row.sessionId,
        description: row.description,
        files: row.files,
        symbols: row.symbols,
        startByte: row.startByte,
        endByte: row.endByte,
        status: row.status,
        declaredAt: row.declaredAt instanceof Date ? row.declaredAt.getTime() : row.declaredAt,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : row.updatedAt,
      }));

      return createRpcSuccess(body.id, result);
    }

    default:
      return createRpcError(body.id, -32601, "METHOD_NOT_FOUND");
  }
}
