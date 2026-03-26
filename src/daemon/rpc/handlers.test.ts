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

// Stub for ParserService — handlers don't use parser directly (used in Plan 03)
const stubParserService = {
  typescript: {} as never,
  python: {} as never,
  parser: {} as never,
};

describe("RPC handlers", () => {
  let tmpDir: string;
  let deps: DaemonDeps;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-handlers-test-"));
    const { db, sqlite } = createDatabase(join(tmpDir, "test.db"));
    await runMigrations(db);
    deps = { db, sqlite, parserService: stubParserService };
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

describe("lock.acquire", () => {
  let tmpDir: string;
  let deps: DaemonDeps;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-lock-test-"));
    const { db, sqlite } = createDatabase(join(tmpDir, "test.db"));
    await runMigrations(db);
    deps = { db, sqlite, parserService: stubParserService };
  });

  afterEach(() => {
    deps.sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("acquires lock and returns lock details", async () => {
    const req = makeRequest("lock.acquire", {
      symbolPath: "src/auth.ts:validateToken",
      sessionId: "session-a",
      ttlMs: 60_000,
    });
    const result = await handleRpc(req, deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const lock = result.result as {
        symbolPath: string;
        sessionId: string;
        acquiredAt: string;
        expiresAt: string;
      };
      expect(lock.symbolPath).toBe("src/auth.ts:validateToken");
      expect(lock.sessionId).toBe("session-a");
      expect(lock.acquiredAt).toBeDefined();
      expect(lock.expiresAt).toBeDefined();
    }
  });

  test("uses default TTL of 1_800_000ms when ttlMs not provided", async () => {
    const before = Date.now();
    const req = makeRequest("lock.acquire", {
      symbolPath: "src/auth.ts:login",
      sessionId: "session-a",
    });
    const result = await handleRpc(req, deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const lock = result.result as { expiresAt: string };
      const expiresAt = new Date(lock.expiresAt).getTime();
      // Should expire roughly 30 minutes from now
      expect(expiresAt).toBeGreaterThanOrEqual(before + 1_800_000 - 1000);
      expect(expiresAt).toBeLessThanOrEqual(before + 1_800_000 + 5000);
    }
  });

  test("re-acquiring lock by same session is idempotent (refreshes TTL)", async () => {
    const symbolPath = "src/auth.ts:validateToken";
    const sessionId = "session-a";

    // First acquire
    await handleRpc(
      makeRequest("lock.acquire", { symbolPath, sessionId, ttlMs: 5_000 }),
      deps,
    );

    // Second acquire with longer TTL
    const result = await handleRpc(
      makeRequest("lock.acquire", { symbolPath, sessionId, ttlMs: 60_000 }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const lock = result.result as { expiresAt: string };
      const expiresAt = new Date(lock.expiresAt).getTime();
      // TTL should be refreshed to ~60s
      expect(expiresAt).toBeGreaterThan(Date.now() + 50_000);
    }
  });

  test("acquiring lock held by different session returns LOCK_CONFLICT", async () => {
    const symbolPath = "src/auth.ts:validateToken";

    // Session A acquires first
    await handleRpc(
      makeRequest("lock.acquire", { symbolPath, sessionId: "session-a", ttlMs: 60_000 }),
      deps,
    );

    // Session B tries to acquire
    const result = await handleRpc(
      makeRequest("lock.acquire", { symbolPath, sessionId: "session-b", ttlMs: 60_000 }),
      deps,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe(-32000);
      expect(result.error.message).toBe("LOCK_CONFLICT");
      const data = result.error.data as { heldBy: string; expiresAt: string };
      expect(data.heldBy).toBe("session-a");
      expect(data.expiresAt).toBeDefined();
    }
  });

  test("acquiring lock on expired lock by different session succeeds", async () => {
    const symbolPath = "src/auth.ts:validateToken";

    // Insert an expired lock directly via DB
    const pastDate = new Date(Date.now() - 10_000);
    await deps.db.insert(
      (await import("../../db/schema")).locks,
    ).values({
      symbolPath,
      sessionId: "session-old",
      acquiredAt: pastDate,
      expiresAt: pastDate,
    });

    // Session B should be able to acquire because old lock is expired
    const result = await handleRpc(
      makeRequest("lock.acquire", { symbolPath, sessionId: "session-b", ttlMs: 60_000 }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const lock = result.result as { sessionId: string };
      expect(lock.sessionId).toBe("session-b");
    }
  });

  test("missing symbolPath returns INVALID_REQUEST", async () => {
    const req = makeRequest("lock.acquire", { sessionId: "session-a", ttlMs: 60_000 });
    const result = await handleRpc(req, deps);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe(-32600);
      expect(result.error.message).toBe("INVALID_REQUEST");
    }
  });

  test("missing sessionId returns INVALID_REQUEST", async () => {
    const req = makeRequest("lock.acquire", { symbolPath: "src/auth.ts:fn", ttlMs: 60_000 });
    const result = await handleRpc(req, deps);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe(-32600);
      expect(result.error.message).toBe("INVALID_REQUEST");
    }
  });

  test("symbolPath without colon returns INVALID_REQUEST", async () => {
    const req = makeRequest("lock.acquire", {
      symbolPath: "src/auth.ts",
      sessionId: "session-a",
    });
    const result = await handleRpc(req, deps);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe(-32600);
      expect(result.error.message).toBe("INVALID_REQUEST");
    }
  });
});

describe("lock.release", () => {
  let tmpDir: string;
  let deps: DaemonDeps;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-lock-release-test-"));
    const { db, sqlite } = createDatabase(join(tmpDir, "test.db"));
    await runMigrations(db);
    deps = { db, sqlite, parserService: stubParserService };
  });

  afterEach(() => {
    deps.sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("releases own lock and returns { released: true }", async () => {
    const symbolPath = "src/auth.ts:validateToken";
    const sessionId = "session-a";

    // First acquire
    await handleRpc(
      makeRequest("lock.acquire", { symbolPath, sessionId, ttlMs: 60_000 }),
      deps,
    );

    // Then release
    const result = await handleRpc(
      makeRequest("lock.release", { symbolPath, sessionId }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const data = result.result as { released: boolean };
      expect(data.released).toBe(true);
    }
  });

  test("releasing non-existent lock returns LOCK_NOT_FOUND", async () => {
    const result = await handleRpc(
      makeRequest("lock.release", {
        symbolPath: "src/auth.ts:nonExistent",
        sessionId: "session-a",
      }),
      deps,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe(-32000);
      expect(result.error.message).toBe("LOCK_NOT_FOUND");
    }
  });

  test("releasing lock held by different session returns LOCK_NOT_HELD", async () => {
    const symbolPath = "src/auth.ts:validateToken";

    // Session A acquires
    await handleRpc(
      makeRequest("lock.acquire", { symbolPath, sessionId: "session-a", ttlMs: 60_000 }),
      deps,
    );

    // Session B tries to release
    const result = await handleRpc(
      makeRequest("lock.release", { symbolPath, sessionId: "session-b" }),
      deps,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe(-32000);
      expect(result.error.message).toBe("LOCK_NOT_HELD");
      const data = result.error.data as { heldBy: string };
      expect(data.heldBy).toBe("session-a");
    }
  });
});

describe("lock.query", () => {
  let tmpDir: string;
  let deps: DaemonDeps;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-lock-query-test-"));
    const { db, sqlite } = createDatabase(join(tmpDir, "test.db"));
    await runMigrations(db);
    deps = { db, sqlite, parserService: stubParserService };
  });

  afterEach(() => {
    deps.sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns all active locks with ttlRemainingMs", async () => {
    // Acquire two locks
    await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/auth.ts:validateToken",
        sessionId: "session-a",
        ttlMs: 60_000,
      }),
      deps,
    );
    await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/auth.ts:login",
        sessionId: "session-b",
        ttlMs: 60_000,
      }),
      deps,
    );

    const result = await handleRpc(makeRequest("lock.query", {}), deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const locks = result.result as Array<{
        symbolPath: string;
        sessionId: string;
        acquiredAt: string;
        expiresAt: string;
        ttlRemainingMs: number;
      }>;
      expect(locks).toHaveLength(2);
      for (const lock of locks) {
        expect(lock.ttlRemainingMs).toBeGreaterThan(0);
        expect(lock.symbolPath).toBeDefined();
        expect(lock.sessionId).toBeDefined();
        expect(lock.acquiredAt).toBeDefined();
        expect(lock.expiresAt).toBeDefined();
      }
    }
  });

  test("filters by sessionId when provided", async () => {
    // Acquire two locks under different sessions
    await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/auth.ts:validateToken",
        sessionId: "session-a",
        ttlMs: 60_000,
      }),
      deps,
    );
    await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/auth.ts:login",
        sessionId: "session-b",
        ttlMs: 60_000,
      }),
      deps,
    );

    const result = await handleRpc(
      makeRequest("lock.query", { sessionId: "session-a" }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const locks = result.result as Array<{ sessionId: string }>;
      expect(locks).toHaveLength(1);
      expect(locks[0]!.sessionId).toBe("session-a");
    }
  });

  test("does not return expired locks", async () => {
    const { locks: locksTable } = await import("../../db/schema");

    // Insert an expired lock directly
    const pastDate = new Date(Date.now() - 10_000);
    await deps.db.insert(locksTable).values({
      symbolPath: "src/auth.ts:expired",
      sessionId: "session-old",
      acquiredAt: pastDate,
      expiresAt: pastDate,
    });

    // Acquire a valid lock
    await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/auth.ts:active",
        sessionId: "session-a",
        ttlMs: 60_000,
      }),
      deps,
    );

    const result = await handleRpc(makeRequest("lock.query", {}), deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const locks = result.result as Array<{ symbolPath: string }>;
      // Only the active lock should appear
      expect(locks).toHaveLength(1);
      expect(locks[0]!.symbolPath).toBe("src/auth.ts:active");
    }
  });

  test("returns empty array when no active locks", async () => {
    const result = await handleRpc(makeRequest("lock.query", {}), deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const locks = result.result as unknown[];
      expect(locks).toHaveLength(0);
    }
  });
});
