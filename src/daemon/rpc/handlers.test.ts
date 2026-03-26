import { test, expect, describe, beforeEach, afterEach, beforeAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleRpc } from "./handlers";
import { createDatabase } from "../../db/index";
import { runMigrations } from "../../db/migrate";
import { createParserService, defaultWasmPaths } from "../../parser/loader";
import type { ParserService } from "../../parser/loader";
import type { DaemonDeps } from "../server";
import type { RpcRequest } from "../../shared/protocol";
import { symbolDeps } from "../../db/schema";

type IntentRow = {
  intentId: string;
  sessionId: string;
  description: string;
  files: string;
  symbols: string;
  startByte: number | null;
  endByte: number | null;
  status: string;
  declaredAt: number;
  updatedAt: number;
};

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

// Real parser is required for symbol_deps population tests
let realParserService: ParserService;

beforeAll(async () => {
  const paths = defaultWasmPaths();
  realParserService = await createParserService(paths.wasmDir, paths.treeSitterWasm);
});

describe("lock.acquire with symbol_deps and caller warnings", () => {
  let tmpDir: string;
  let repoDir: string;
  let deps: DaemonDeps;
  let origEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-deps-test-"));
    repoDir = join(tmpDir, "repo");
    // Create a fake repo directory with source files
    require("node:fs").mkdirSync(join(repoDir, "src"), { recursive: true });

    const { db, sqlite } = createDatabase(join(tmpDir, "test.db"));
    await runMigrations(db);
    deps = { db, sqlite, parserService: realParserService };

    // Point WIT_REPO_ROOT at our fake repo
    origEnv = process.env["WIT_REPO_ROOT"];
    process.env["WIT_REPO_ROOT"] = repoDir;
  });

  afterEach(() => {
    deps.sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
    if (origEnv === undefined) {
      delete process.env["WIT_REPO_ROOT"];
    } else {
      process.env["WIT_REPO_ROOT"] = origEnv;
    }
  });

  test("lock.acquire on existing TS file populates symbol_deps rows for that file", async () => {
    // Write a TS file where callerFn calls calleeFn
    writeFileSync(
      join(repoDir, "src", "auth.ts"),
      `function callerFn(): void {
  calleeFn();
}
function calleeFn(): void {}
`,
    );

    const result = await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/auth.ts:calleeFn",
        sessionId: "session-a",
        ttlMs: 60_000,
      }),
      deps,
    );

    expect("result" in result).toBe(true);

    // symbol_deps should have the callerFn -> calleeFn edge
    const rows = await deps.db.select().from(symbolDeps);
    expect(rows.length).toBeGreaterThan(0);
    const edge = rows.find(
      (r) => r.caller === "src/auth.ts:callerFn" && r.callee === "src/auth.ts:calleeFn",
    );
    expect(edge).toBeDefined();
  });

  test("lock.acquire returns caller warnings when a caller of the locked symbol is locked by another session", async () => {
    writeFileSync(
      join(repoDir, "src", "auth.ts"),
      `function callerFn(): void {
  calleeFn();
}
function calleeFn(): void {}
`,
    );

    // Session A locks callerFn first
    await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/auth.ts:callerFn",
        sessionId: "session-a",
        ttlMs: 60_000,
      }),
      deps,
    );

    // Session B now locks calleeFn — should receive warning about session-a's lock on callerFn
    const result = await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/auth.ts:calleeFn",
        sessionId: "session-b",
        ttlMs: 60_000,
      }),
      deps,
    );

    expect("result" in result).toBe(true);
    if ("result" in result) {
      const lock = result.result as {
        symbolPath: string;
        sessionId: string;
        warnings: Array<{ lockedSymbol: string; heldBy: string; chain: string[] }>;
      };
      expect(lock.symbolPath).toBe("src/auth.ts:calleeFn");
      expect(lock.sessionId).toBe("session-b");
      expect(Array.isArray(lock.warnings)).toBe(true);
      expect(lock.warnings.length).toBeGreaterThan(0);
      const warning = lock.warnings.find((w) => w.lockedSymbol === "src/auth.ts:callerFn");
      expect(warning).toBeDefined();
      expect(warning!.heldBy).toBe("session-a");
      expect(warning!.chain).toEqual(["src/auth.ts:callerFn", "src/auth.ts:calleeFn"]);
    }
  });

  test("lock.acquire returns empty warnings when same session holds caller lock", async () => {
    writeFileSync(
      join(repoDir, "src", "auth.ts"),
      `function callerFn(): void {
  calleeFn();
}
function calleeFn(): void {}
`,
    );

    // Same session locks both callerFn and calleeFn
    await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/auth.ts:callerFn",
        sessionId: "session-a",
        ttlMs: 60_000,
      }),
      deps,
    );

    const result = await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/auth.ts:calleeFn",
        sessionId: "session-a",
        ttlMs: 60_000,
      }),
      deps,
    );

    expect("result" in result).toBe(true);
    if ("result" in result) {
      const lock = result.result as { warnings: unknown[] };
      expect(lock.warnings).toHaveLength(0);
    }
  });

  test("lock.acquire on non-existent file succeeds with empty warnings and no symbol_deps rows", async () => {
    // No file created — symbolPath points to a file that doesn't exist
    const result = await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/nonexistent.ts:foo",
        sessionId: "session-a",
        ttlMs: 60_000,
      }),
      deps,
    );

    expect("result" in result).toBe(true);
    if ("result" in result) {
      const lock = result.result as { warnings: unknown[] };
      expect(lock.warnings).toHaveLength(0);
    }

    // No symbol_deps should be written
    const rows = await deps.db.select().from(symbolDeps);
    expect(rows).toHaveLength(0);
  });

  test("symbol_deps for a file are fully replaced on re-acquire (no stale edges)", async () => {
    // First version of the file
    writeFileSync(
      join(repoDir, "src", "utils.ts"),
      `function fn1(): void {
  fn2();
  fn3();
}
function fn2(): void {}
function fn3(): void {}
`,
    );

    await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/utils.ts:fn1",
        sessionId: "session-a",
        ttlMs: 60_000,
      }),
      deps,
    );

    const firstRows = await deps.db.select().from(symbolDeps);
    const firstCount = firstRows.length;
    expect(firstCount).toBeGreaterThan(0);

    // Re-acquire (same session refresh) — symbol_deps should be fully replaced
    await handleRpc(
      makeRequest("lock.acquire", {
        symbolPath: "src/utils.ts:fn1",
        sessionId: "session-a",
        ttlMs: 60_000,
      }),
      deps,
    );

    const secondRows = await deps.db.select().from(symbolDeps);
    // Same count (fully replaced, not doubled)
    expect(secondRows.length).toBe(firstCount);
  });
});

// ---------------------------------------------------------------------------
// intent.declare
// ---------------------------------------------------------------------------

describe("intent.declare", () => {
  let tmpDir: string;
  let deps: DaemonDeps;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-intent-test-"));
    const { db, sqlite } = createDatabase(join(tmpDir, "test.db"));
    await runMigrations(db);
    deps = { db, sqlite, parserService: stubParserService };
  });

  afterEach(() => {
    deps.sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("inserts intent and returns intentId", async () => {
    const req = makeRequest("intent.declare", {
      sessionId: "session-a",
      description: "Refactoring auth module",
      files: ["src/auth.ts"],
    });
    const result = await handleRpc(req, deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const data = result.result as { intentId: string };
      expect(typeof data.intentId).toBe("string");
      expect(data.intentId.length).toBeGreaterThan(0);
    }
  });

  test("stores files as comma-delimited with leading/trailing commas", async () => {
    const req = makeRequest("intent.declare", {
      sessionId: "session-a",
      description: "Work on auth and utils",
      files: ["src/auth.ts", "src/utils.ts"],
    });
    const result = await handleRpc(req, deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const { intents } = await import("../../db/schema");
      const rows = await deps.db.select().from(intents);
      expect(rows).toHaveLength(1);
      // Must have leading and trailing commas for exact LIKE matching
      expect(rows[0]!.files).toBe(",src/auth.ts,src/utils.ts,");
    }
  });

  test("declares file-level intent with no symbols: startByte and endByte are null", async () => {
    const req = makeRequest("intent.declare", {
      sessionId: "session-a",
      description: "Touch auth.ts at file level",
      files: ["src/auth.ts"],
    });
    const result = await handleRpc(req, deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const { intents } = await import("../../db/schema");
      const rows = await deps.db.select().from(intents);
      expect(rows[0]!.startByte).toBeNull();
      expect(rows[0]!.endByte).toBeNull();
    }
  });

  test("status defaults to declared", async () => {
    const req = makeRequest("intent.declare", {
      sessionId: "session-a",
      description: "initial",
      files: ["src/auth.ts"],
    });
    await handleRpc(req, deps);
    const { intents } = await import("../../db/schema");
    const rows = await deps.db.select().from(intents);
    expect(rows[0]!.status).toBe("declared");
  });

  test("missing files array returns INVALID_REQUEST", async () => {
    const req = makeRequest("intent.declare", {
      sessionId: "session-a",
      description: "no files",
    });
    const result = await handleRpc(req, deps);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe(-32600);
    }
  });

  test("empty files array returns INVALID_REQUEST", async () => {
    const req = makeRequest("intent.declare", {
      sessionId: "session-a",
      description: "empty files",
      files: [],
    });
    const result = await handleRpc(req, deps);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe(-32600);
    }
  });
});

// intent.declare with real parser for symbol byte-range resolution
describe("intent.declare with symbols", () => {
  let tmpDir: string;
  let repoDir: string;
  let deps: DaemonDeps;
  let origEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-intent-symbols-test-"));
    repoDir = join(tmpDir, "repo");
    require("node:fs").mkdirSync(join(repoDir, "src"), { recursive: true });

    const { db, sqlite } = createDatabase(join(tmpDir, "test.db"));
    await runMigrations(db);
    deps = { db, sqlite, parserService: realParserService };

    origEnv = process.env["WIT_REPO_ROOT"];
    process.env["WIT_REPO_ROOT"] = repoDir;
  });

  afterEach(() => {
    deps.sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
    if (origEnv === undefined) {
      delete process.env["WIT_REPO_ROOT"];
    } else {
      process.env["WIT_REPO_ROOT"] = origEnv;
    }
  });

  test("declares intent with symbols: populates startByte and endByte from parser", async () => {
    writeFileSync(
      join(repoDir, "src", "auth.ts"),
      `function validateToken(token: string): boolean {
  return token.length > 0;
}
function login(user: string): void {}
`,
    );

    const req = makeRequest("intent.declare", {
      sessionId: "session-a",
      description: "Modify validateToken",
      files: ["src/auth.ts"],
      symbols: ["validateToken"],
    });
    const result = await handleRpc(req, deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const { intents } = await import("../../db/schema");
      const rows = await deps.db.select().from(intents);
      expect(rows).toHaveLength(1);
      // startByte and endByte should be populated (non-null) when symbol found
      expect(rows[0]!.startByte).not.toBeNull();
      expect(rows[0]!.endByte).not.toBeNull();
      expect((rows[0]!.startByte as number)).toBeGreaterThanOrEqual(0);
      expect((rows[0]!.endByte as number)).toBeGreaterThan(0);
    }
  });

  test("declares intent with unknown symbol: byte range stays null", async () => {
    writeFileSync(
      join(repoDir, "src", "auth.ts"),
      `function validateToken(token: string): boolean {
  return token.length > 0;
}
`,
    );

    const req = makeRequest("intent.declare", {
      sessionId: "session-a",
      description: "No such symbol",
      files: ["src/auth.ts"],
      symbols: ["nonExistentFn"],
    });
    const result = await handleRpc(req, deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const { intents } = await import("../../db/schema");
      const rows = await deps.db.select().from(intents);
      expect(rows[0]!.startByte).toBeNull();
      expect(rows[0]!.endByte).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// intent.update
// ---------------------------------------------------------------------------

describe("intent.update", () => {
  let tmpDir: string;
  let deps: DaemonDeps;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-intent-update-test-"));
    const { db, sqlite } = createDatabase(join(tmpDir, "test.db"));
    await runMigrations(db);
    deps = { db, sqlite, parserService: stubParserService };
  });

  afterEach(() => {
    deps.sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function declareIntent(sessionId: string = "session-a"): Promise<string> {
    const result = await handleRpc(
      makeRequest("intent.declare", {
        sessionId,
        description: "test intent",
        files: ["src/auth.ts"],
      }),
      deps,
    );
    if ("result" in result) {
      return (result.result as { intentId: string }).intentId;
    }
    throw new Error("declare failed");
  }

  test("declared -> active is a valid transition", async () => {
    const intentId = await declareIntent();
    const result = await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "active" }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const data = result.result as { intentId: string; status: string; updatedAt: number };
      expect(data.status).toBe("active");
      expect(data.intentId).toBe(intentId);
      expect(typeof data.updatedAt).toBe("number");
    }
  });

  test("declared -> resolved is a valid transition", async () => {
    const intentId = await declareIntent();
    const result = await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "resolved" }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const data = result.result as { status: string };
      expect(data.status).toBe("resolved");
    }
  });

  test("declared -> abandoned is a valid transition", async () => {
    const intentId = await declareIntent();
    const result = await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "abandoned" }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const data = result.result as { status: string };
      expect(data.status).toBe("abandoned");
    }
  });

  test("active -> resolved is a valid transition", async () => {
    const intentId = await declareIntent();
    await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "active" }),
      deps,
    );
    const result = await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "resolved" }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const data = result.result as { status: string };
      expect(data.status).toBe("resolved");
    }
  });

  test("active -> abandoned is a valid transition", async () => {
    const intentId = await declareIntent();
    await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "active" }),
      deps,
    );
    const result = await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "abandoned" }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const data = result.result as { status: string };
      expect(data.status).toBe("abandoned");
    }
  });

  test("resolved -> active is rejected with INVALID_TRANSITION", async () => {
    const intentId = await declareIntent();
    await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "resolved" }),
      deps,
    );
    const result = await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "active" }),
      deps,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.message).toBe("INVALID_TRANSITION");
      const data = result.error.data as { current: string; requested: string };
      expect(data.current).toBe("resolved");
      expect(data.requested).toBe("active");
    }
  });

  test("abandoned -> active is rejected with INVALID_TRANSITION", async () => {
    const intentId = await declareIntent();
    await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "abandoned" }),
      deps,
    );
    const result = await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "active" }),
      deps,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.message).toBe("INVALID_TRANSITION");
    }
  });

  test("wrong session returns INTENT_NOT_OWNED", async () => {
    const intentId = await declareIntent("session-a");
    const result = await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-b", status: "active" }),
      deps,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.message).toBe("INTENT_NOT_OWNED");
    }
  });

  test("non-existent intentId returns INTENT_NOT_FOUND", async () => {
    const result = await handleRpc(
      makeRequest("intent.update", {
        intentId: "does-not-exist",
        sessionId: "session-a",
        status: "active",
      }),
      deps,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.message).toBe("INTENT_NOT_FOUND");
    }
  });

  test("updatedAt timestamp changes on each transition", async () => {
    const intentId = await declareIntent();
    const { intents } = await import("../../db/schema");

    const before = await deps.db.select().from(intents);
    // timestamp_ms mode returns Date objects — compare numeric values
    const originalUpdatedAt = (before[0]!.updatedAt as Date).getTime();

    // Small delay to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 5));

    await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "active" }),
      deps,
    );

    const after = await deps.db.select().from(intents);
    const newUpdatedAt = (after[0]!.updatedAt as Date).getTime();
    expect(newUpdatedAt).toBeGreaterThan(originalUpdatedAt);
  });
});

// ---------------------------------------------------------------------------
// intent.query
// ---------------------------------------------------------------------------

describe("intent.query", () => {
  let tmpDir: string;
  let deps: DaemonDeps;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-intent-query-test-"));
    const { db, sqlite } = createDatabase(join(tmpDir, "test.db"));
    await runMigrations(db);
    deps = { db, sqlite, parserService: stubParserService };
  });

  afterEach(() => {
    deps.sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function declare(
    sessionId: string,
    files: string[],
    description: string = "test",
  ): Promise<string> {
    const result = await handleRpc(
      makeRequest("intent.declare", { sessionId, description, files }),
      deps,
    );
    if ("result" in result) {
      return (result.result as { intentId: string }).intentId;
    }
    throw new Error("declare failed");
  }

  test("returns all declared/active intents with no filter", async () => {
    await declare("session-a", ["src/auth.ts"]);
    await declare("session-b", ["src/utils.ts"]);

    const result = await handleRpc(makeRequest("intent.query", {}), deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const items = result.result as IntentRow[];
      expect(items).toHaveLength(2);
    }
  });

  test("filters by sessionId", async () => {
    await declare("session-a", ["src/auth.ts"]);
    await declare("session-b", ["src/utils.ts"]);

    const result = await handleRpc(
      makeRequest("intent.query", { sessionId: "session-a" }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const items = result.result as IntentRow[];
      expect(items).toHaveLength(1);
      expect(items[0]!.sessionId).toBe("session-a");
    }
  });

  test("filters by file using exact segment matching", async () => {
    await declare("session-a", ["src/auth.ts"]);
    await declare("session-b", ["src/auth.ts", "src/utils.ts"]);
    await declare("session-c", ["src/other.ts"]);

    const result = await handleRpc(
      makeRequest("intent.query", { file: "src/auth.ts" }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const items = result.result as IntentRow[];
      // session-a and session-b touch src/auth.ts; session-c does not
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.files).toContain("src/auth.ts");
      }
    }
  });

  test("file filter does not match partial paths (e.g. 'auth.ts' vs 'src/auth.ts')", async () => {
    await declare("session-a", ["src/auth.ts"]);

    const result = await handleRpc(
      makeRequest("intent.query", { file: "auth.ts" }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const items = result.result as IntentRow[];
      // Should NOT match because 'auth.ts' != 'src/auth.ts'
      expect(items).toHaveLength(0);
    }
  });

  test("filters by status", async () => {
    const intentId = await declare("session-a", ["src/auth.ts"]);
    await declare("session-b", ["src/utils.ts"]);

    // Transition session-a's intent to active
    await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "active" }),
      deps,
    );

    const result = await handleRpc(
      makeRequest("intent.query", { status: "declared" }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const items = result.result as IntentRow[];
      expect(items).toHaveLength(1);
      expect(items[0]!.status).toBe("declared");
    }
  });

  test("does not return resolved/abandoned intents by default", async () => {
    const intentId = await declare("session-a", ["src/auth.ts"]);

    // Transition to resolved
    await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "resolved" }),
      deps,
    );

    const result = await handleRpc(makeRequest("intent.query", {}), deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const items = result.result as IntentRow[];
      expect(items).toHaveLength(0);
    }
  });

  test("status filter can retrieve resolved intents explicitly", async () => {
    const intentId = await declare("session-a", ["src/auth.ts"]);
    await handleRpc(
      makeRequest("intent.update", { intentId, sessionId: "session-a", status: "resolved" }),
      deps,
    );

    const result = await handleRpc(
      makeRequest("intent.query", { status: "resolved" }),
      deps,
    );
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const items = result.result as IntentRow[];
      expect(items).toHaveLength(1);
      expect(items[0]!.status).toBe("resolved");
    }
  });

  test("returns empty array when no matching intents", async () => {
    const result = await handleRpc(makeRequest("intent.query", {}), deps);
    expect("result" in result).toBe(true);
    if ("result" in result) {
      const items = result.result as IntentRow[];
      expect(items).toHaveLength(0);
    }
  });
});
