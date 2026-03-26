import { z } from "zod";
import { agents } from "../../db/schema";
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

    default:
      return createRpcError(body.id, -32601, "METHOD_NOT_FOUND");
  }
}
