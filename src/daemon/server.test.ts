import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "./server";
import { createDatabase } from "../db/index";
import { runMigrations } from "../db/migrate";
import type { DaemonDeps } from "./server";

const VALID_ENVELOPE = {
  jsonrpc: "2.0",
  witVersion: "1",
  id: "test-id",
} as const;

describe("Daemon server", () => {
  let tmpDir: string;
  let deps: DaemonDeps;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-server-test-"));
    const { db, sqlite } = createDatabase(join(tmpDir, "test.db"));
    await runMigrations(db);
    deps = {
      db,
      sqlite,
      parserService: { typescript: {} as never, python: {} as never, parser: {} as never },
    };
  });

  afterEach(() => {
    deps.sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("POST /rpc with wrong witVersion returns 400 with VERSION_MISMATCH", async () => {
    const app = createApp(deps);
    const res = await app.request("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        witVersion: "999",
        id: "test-id",
        method: "ping",
        params: {},
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32001);
    expect(body.error.message).toBe("VERSION_MISMATCH");
  });

  test("POST /rpc with correct witVersion and method ping returns pong", async () => {
    const app = createApp(deps);
    const res = await app.request("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...VALID_ENVELOPE,
        method: "ping",
        params: {},
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { result: string };
    expect(body.result).toBe("pong");
  });

  test("POST /rpc with unknown method returns METHOD_NOT_FOUND (-32601)", async () => {
    const app = createApp(deps);
    const res = await app.request("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...VALID_ENVELOPE,
        method: "nonexistent",
        params: {},
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toBe("METHOD_NOT_FOUND");
  });

  test("POST /rpc with malformed JSON returns PARSE_ERROR (-32700)", async () => {
    const app = createApp(deps);
    const res = await app.request("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json }",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32700);
    expect(body.error.message).toBe("PARSE_ERROR");
  });

  test("POST /rpc with missing required fields returns INVALID_REQUEST (-32600)", async () => {
    const app = createApp(deps);
    const res = await app.request("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        witVersion: "1",
        // missing jsonrpc, id, method
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toBe("INVALID_REQUEST");
  });
});
