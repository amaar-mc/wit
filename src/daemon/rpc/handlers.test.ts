import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleRpc } from "./handlers";
import { createDatabase } from "../../db/index";
import { runMigrations } from "../../db/migrate";
import type { DaemonDeps } from "../server";
import type { RpcRequest } from "../../shared/protocol";

const PROTOCOL_VERSION = "1" as const;

function makeRequest(method: string, params: unknown): RpcRequest {
  return {
    jsonrpc: "2.0",
    witVersion: PROTOCOL_VERSION,
    id: crypto.randomUUID(),
    method,
    params,
  };
}

describe("RPC handlers", () => {
  let tmpDir: string;
  let deps: DaemonDeps;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-handlers-test-"));
    const { db, sqlite } = createDatabase(join(tmpDir, "test.db"));
    await runMigrations(db);
    deps = { db, sqlite };
  });

  afterEach(() => {
    deps.sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("ping returns pong", async () => {
    const req = makeRequest("ping", {});
    const result = await handleRpc(req, deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      expect(result.result).toBe("pong");
      expect(result.id).toBe(req.id);
    }
  });

  test("register inserts agent and returns agentId", async () => {
    const req = makeRequest("register", { name: "test-agent", sessionId: "session-abc" });
    const result = await handleRpc(req, deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const { agentId } = result.result as { agentId: number | bigint };
      expect(Number(agentId)).toBeGreaterThan(0);
    }
  });

  test("register with duplicate sessionId returns error", async () => {
    const params = { name: "agent-1", sessionId: "session-dup" };
    await handleRpc(makeRequest("register", params), deps);
    // Second call with same sessionId should fail
    const result = await handleRpc(makeRequest("register", params), deps);
    expect("error" in result).toBe(true);
  });

  test("register with missing name returns error", async () => {
    const req = makeRequest("register", { sessionId: "session-xyz" });
    const result = await handleRpc(req, deps);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe(-32600);
    }
  });

  test("register with missing sessionId returns error", async () => {
    const req = makeRequest("register", { name: "agent-no-session" });
    const result = await handleRpc(req, deps);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe(-32600);
    }
  });

  test("unknown method returns METHOD_NOT_FOUND", async () => {
    const req = makeRequest("doSomethingUnknown", {});
    const result = await handleRpc(req, deps);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe(-32601);
      expect(result.error.message).toBe("METHOD_NOT_FOUND");
    }
  });
});
