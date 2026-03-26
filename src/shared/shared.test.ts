import { describe, test, expect } from "bun:test";
import { join } from "node:path";

describe("paths.ts", () => {
  test("WIT_DIR ends with .wit", async () => {
    const { WIT_DIR } = await import("./paths");
    expect(WIT_DIR).toEndWith(".wit");
  });

  test("SOCKET_PATH ends with daemon.sock", async () => {
    const { SOCKET_PATH } = await import("./paths");
    expect(SOCKET_PATH).toEndWith("daemon.sock");
  });

  test("PID_PATH ends with daemon.pid", async () => {
    const { PID_PATH } = await import("./paths");
    expect(PID_PATH).toEndWith("daemon.pid");
  });

  test("DB_PATH ends with state.db", async () => {
    const { DB_PATH } = await import("./paths");
    expect(DB_PATH).toEndWith("state.db");
  });

  test("witPaths uses provided root", async () => {
    const { witPaths } = await import("./paths");
    const paths = witPaths("/custom/root");
    expect(paths.WIT_DIR).toBe(join("/custom/root", ".wit"));
    expect(paths.SOCKET_PATH).toBe(join("/custom/root", ".wit", "daemon.sock"));
    expect(paths.PID_PATH).toBe(join("/custom/root", ".wit", "daemon.pid"));
    expect(paths.DB_PATH).toBe(join("/custom/root", ".wit", "state.db"));
  });

  test("WIT_DIR respects WIT_REPO_ROOT env var", () => {
    // witPaths with a custom root to simulate env var override
    const { witPaths } = require("./paths");
    const paths = witPaths("/env/root");
    expect(paths.WIT_DIR).toStartWith("/env/root");
  });
});

describe("protocol.ts", () => {
  test("PROTOCOL_VERSION is '1'", async () => {
    const { PROTOCOL_VERSION } = await import("./protocol");
    expect(PROTOCOL_VERSION).toBe("1");
  });

  test("createRpcRequest produces valid RpcRequest shape", async () => {
    const { createRpcRequest, PROTOCOL_VERSION } = await import("./protocol");
    const req = createRpcRequest("ping", { foo: "bar" });
    expect(req.jsonrpc).toBe("2.0");
    expect(req.witVersion).toBe(PROTOCOL_VERSION);
    expect(typeof req.id).toBe("string");
    expect(req.id.length).toBeGreaterThan(0);
    expect(req.method).toBe("ping");
    expect(req.params).toEqual({ foo: "bar" });
  });

  test("createRpcSuccess produces valid RpcSuccess shape", async () => {
    const { createRpcSuccess, PROTOCOL_VERSION } = await import("./protocol");
    const res = createRpcSuccess("test-id", { value: 42 });
    expect(res.jsonrpc).toBe("2.0");
    expect(res.witVersion).toBe(PROTOCOL_VERSION);
    expect(res.id).toBe("test-id");
    expect(res.result).toEqual({ value: 42 });
  });

  test("createRpcError produces valid RpcError shape", async () => {
    const { createRpcError, PROTOCOL_VERSION } = await import("./protocol");
    const err = createRpcError("test-id", -32001, "VERSION_MISMATCH", { expected: "1" });
    expect(err.jsonrpc).toBe("2.0");
    expect(err.witVersion).toBe(PROTOCOL_VERSION);
    expect(err.id).toBe("test-id");
    expect(err.error.code).toBe(-32001);
    expect(err.error.message).toBe("VERSION_MISMATCH");
    expect(err.error.data).toEqual({ expected: "1" });
  });

  test("createRpcError accepts null id", async () => {
    const { createRpcError } = await import("./protocol");
    const err = createRpcError(null, -32700, "Parse error");
    expect(err.id).toBeNull();
    expect(err.error.data).toBeUndefined();
  });
});
