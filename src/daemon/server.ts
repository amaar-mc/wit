import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { WitDatabase } from "../db/index";
import type { ParserService } from "../parser/loader";
import {
  PROTOCOL_VERSION,
  createRpcError,
  type RpcRequest,
} from "../shared/protocol";
import { handleRpc } from "./rpc/handlers";

export type DaemonDeps = {
  db: WitDatabase;
  sqlite: Database;
  parserService: ParserService;
};

type Variables = {
  rpcBody: RpcRequest;
  deps: DaemonDeps;
};

export function createApp(deps: DaemonDeps): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();

  // Inject deps into context for all routes
  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  // Parse and validate RPC body ONCE in middleware — handlers never re-parse
  app.use("/rpc", async (c, next) => {
    // Step 1: Parse body
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(createRpcError(null, -32700, "PARSE_ERROR"), 400);
    }

    // Step 2: Validate basic JSON-RPC shape before version check
    if (
      typeof rawBody !== "object" ||
      rawBody === null ||
      (rawBody as Record<string, unknown>)["jsonrpc"] !== "2.0" ||
      typeof (rawBody as Record<string, unknown>)["id"] !== "string" ||
      typeof (rawBody as Record<string, unknown>)["method"] !== "string"
    ) {
      // Check if it has witVersion for version mismatch detection first
      const version = (rawBody as Record<string, unknown>)?.["witVersion"];
      if (typeof version === "string" && version !== PROTOCOL_VERSION) {
        return c.json(
          createRpcError(null, -32001, "VERSION_MISMATCH", {
            expected: PROTOCOL_VERSION,
            received: version,
          }),
          400,
        );
      }
      return c.json(createRpcError(null, -32600, "INVALID_REQUEST"), 400);
    }

    // Step 3: Validate protocol version
    const body = rawBody as Record<string, unknown>;
    if (body["witVersion"] !== PROTOCOL_VERSION) {
      return c.json(
        createRpcError(null, -32001, "VERSION_MISMATCH", {
          expected: PROTOCOL_VERSION,
          received: body["witVersion"],
        }),
        400,
      );
    }

    // Step 4: Stash validated body — handlers read from context, never re-parse
    c.set("rpcBody", rawBody as RpcRequest);
    await next();
  });

  app.post("/rpc", async (c) => {
    const rpcBody = c.get("rpcBody");
    const result = await handleRpc(rpcBody, deps);
    return c.json(result);
  });

  return app;
}
