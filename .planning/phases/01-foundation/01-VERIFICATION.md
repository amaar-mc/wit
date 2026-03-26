---
phase: 01-foundation
verified: 2026-03-25T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 1: Foundation Verification Report

**Phase Goal:** A running daemon that accepts JSON-RPC requests over a Unix socket, persists coordination state to SQLite with ACID guarantees, and has a CLI that auto-starts the daemon and proxies commands
**Verified:** 2026-03-25
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| #   | Truth                                                                                                                     | Status     | Evidence                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Running `wit init` creates a `.wit/` directory with an initialized SQLite database and starts the daemon if not already running | ✓ VERIFIED | `InitCommand.execute()` calls `mkdirSync(WIT_DIR)`, `createDatabase(DB_PATH)`, `runMigrations(db)`, `ensureDaemon()`. 6/6 `init.test.ts` tests pass including .wit/ creation, agents table presence, PID and socket file appearance. |
| 2   | The daemon process persists across CLI calls — a second `wit` command connects to the same running daemon, not a new one   | ✓ VERIFIED | `ensureDaemon()` calls `isDaemonAlive()` first and returns immediately if the PID file has a live process. Test "ensureDaemon is idempotent: second call is a no-op when daemon is alive" passes. |
| 3   | If the daemon crashes and leaves a stale PID file, the next CLI command recovers automatically and starts a fresh daemon   | ✓ VERIFIED | `isDaemonAlive()` uses `process.kill(pid, 0)` — if ESRCH is thrown the stale PID file is deleted and the function returns false, causing `ensureDaemon()` to spawn fresh. Test "isDaemonAlive returns false and deletes stale PID file for dead process" passes. |
| 4   | Every request and response over the Unix socket carries a `protocolVersion` field; a version mismatch returns a structured `VERSION_MISMATCH` error | ✓ VERIFIED | `server.ts` middleware checks `witVersion` against `PROTOCOL_VERSION`; mismatches return HTTP 400 with `createRpcError(null, -32001, "VERSION_MISMATCH", {expected, received})`. All `RpcRequest/RpcSuccess/RpcError` interfaces include `witVersion` field. Test "POST /rpc with wrong witVersion returns 400 with VERSION_MISMATCH" passes. |
| 5   | An agent can register a name and session ID with the daemon; all subsequent locks and intents reference that session       | ✓ VERIFIED | `handleRpc` handles `"register"` method: validates params with zod, inserts into `agents` table via `deps.db.insert(agents).values({...}).returning({id})`, returns `{agentId}`. Test "register inserts agent and returns agentId" passes. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `package.json` | Project manifest with all Phase 1 deps including hono | ✓ VERIFIED | Contains hono@^4.12.9, drizzle-orm@^0.45.1, zod@^4.3.6, @hono/zod-validator@^0.7.6. `bin.wit` points to `src/cli/index.ts`. |
| `tsconfig.json` | TypeScript strict mode with bun-types | ✓ VERIFIED | `"strict": true`, `"types": ["bun-types"]`, `"moduleResolution": "bundler"`. `tsc --noEmit` exits 0. |
| `src/shared/protocol.ts` | PROTOCOL_VERSION, RpcRequest, RpcSuccess, RpcError, helper factories | ✓ VERIFIED | Exports `PROTOCOL_VERSION = "1" as const`, `RpcRequest`, `RpcSuccess<T>`, `RpcError` interfaces (all with `witVersion` field), `createRpcRequest`, `createRpcSuccess`, `createRpcError`. |
| `src/shared/paths.ts` | WIT_DIR, SOCKET_PATH, PID_PATH, DB_PATH from WIT_REPO_ROOT | ✓ VERIFIED | Exports all four constants derived from `witPaths(process.env["WIT_REPO_ROOT"] ?? process.cwd())`. Also exports `witPaths(root)` factory for test isolation. |
| `src/db/schema.ts` | Drizzle agents table with id, name, sessionId, connectedAt | ✓ VERIFIED | `sqliteTable("agents", { id: int pk autoincrement, name: text notNull, sessionId: text notNull unique, connectedAt: int timestamp notNull })`. |
| `src/db/index.ts` | createDatabase factory with all four PRAGMAs | ✓ VERIFIED | `createDatabase(dbPath)` sets WAL, busy_timeout=5000, synchronous=NORMAL, foreign_keys=ON on raw `Database` before Drizzle wraps it. Returns `{db, sqlite}`. 6/6 PRAGMA tests pass. |
| `src/db/migrate.ts` | runMigrations programmatic migrator | ✓ VERIFIED | `runMigrations(db)` calls `migrate(db, { migrationsFolder: MIGRATIONS_DIR })` where `MIGRATIONS_DIR` is `import.meta.url`-relative (CWD-safe for detached daemon). |
| `drizzle/0000_yellow_prima.sql` | Initial agents table migration SQL | ✓ VERIFIED | File exists in `drizzle/` directory. |
| `src/daemon/server.ts` | Hono app factory with version middleware and /rpc route (min 40 lines) | ✓ VERIFIED | 86 lines. `createApp(deps)` factory with `app.use("/rpc", ...)` middleware parsing body once and stashing in `c.set("rpcBody")`. POST `/rpc` route reads from `c.get("rpcBody")`. Exports `createApp`, `DaemonDeps`. |
| `src/daemon/rpc/handlers.ts` | handleRpc dispatcher with ping and register | ✓ VERIFIED | `handleRpc(body, deps)` switch on `body.method`: ping returns "pong", register validates with zod then inserts via `deps.db.insert(agents).values(...).returning({id})`, default returns METHOD_NOT_FOUND. |
| `src/daemon/lifecycle.ts` | PID file, shutdown handlers, stale socket cleanup | ✓ VERIFIED | Exports `writePidFile`, `cleanStaleSocket`, `setupShutdownHandlers`. Shutdown handler calls `server.stop()`, `sqlite.close()`, unlinks PID and socket files, `process.exit(0)`. Registers both SIGTERM and SIGINT. |
| `src/daemon/index.ts` | Daemon entry point (min 15 lines) | ✓ VERIFIED | 28 lines. Full startup sequence: `mkdirSync(WIT_DIR)`, `createDatabase(DB_PATH)`, `runMigrations(db)`, `cleanStaleSocket(SOCKET_PATH)`, `writePidFile(PID_PATH)`, `createApp({db, sqlite})`, `Bun.serve({unix: SOCKET_PATH, fetch: app.fetch})`, `setupShutdownHandlers(...)`. |
| `src/cli/client.ts` | ensureDaemon, rpc, isDaemonAlive | ✓ VERIFIED | 120 lines. Exports `isDaemonAlive`, `spawnDaemon`, `waitForSocket`, `ensureDaemon`, `rpc<T>`. Daemon spawned with `detached: true` and `proc.unref()`. `waitForSocket` uses `existsSync` (not `Bun.file().exists()`) for socket detection. |
| `src/cli/commands/init.ts` | InitCommand creating .wit/, running migrations, ensuring daemon | ✓ VERIFIED | Exports `InitCommand` with `static override paths = [["init"]]`. Full implementation: mkdirSync, createDatabase, runMigrations, sqlite.close, ensureDaemon, stdout.write("Wit initialized.\n"). |
| `src/cli/index.ts` | Clipanion Cli entry point (min 10 lines) | ✓ VERIFIED | 14 lines. Registers `Builtins.HelpCommand`, `Builtins.VersionCommand`, `InitCommand`. Runs `cli.runExit(process.argv.slice(2))`. |

---

### Key Link Verification

All key links verified by direct source inspection:

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `src/db/index.ts` | `src/db/schema.ts` | `import * as schema from "./schema"` | ✓ WIRED | Schema passed to `drizzle({ client: sqlite, schema })` |
| `src/daemon/server.ts` | `src/shared/protocol.ts` | PROTOCOL_VERSION imported and used in version check | ✓ WIRED | Multi-line import at line 4-8; `PROTOCOL_VERSION` compared at lines 50 and 64 |
| `src/daemon/rpc/handlers.ts` | `src/db/schema.ts` | `import { agents } from "../../db/schema"` | ✓ WIRED | `agents` table used in `deps.db.insert(agents).values(...)` at line 37 |
| `src/daemon/index.ts` | `src/daemon/lifecycle.ts` | `writePidFile` and `setupShutdownHandlers` called at startup | ✓ WIRED | Both imported and called at lines 17 and 26 |
| `src/daemon/index.ts` | `src/shared/paths.ts` | `SOCKET_PATH` used in `Bun.serve({unix: SOCKET_PATH})` | ✓ WIRED | Imported at line 6, used at lines 15, 22, 26, 28 |
| `src/cli/client.ts` | `src/shared/paths.ts` | `witPaths` imported for `WitPaths` type and path resolution | ✓ WIRED | Imported at line 2; `paths.PID_PATH`, `paths.SOCKET_PATH` used throughout |
| `src/cli/client.ts` | `src/shared/protocol.ts` | `createRpcRequest` used to build RPC POST body | ✓ WIRED | Imported at line 3; used in `rpc()` at line 107 |
| `src/cli/client.ts` | `src/daemon/index.ts` | `Bun.spawn(["bun", "run", daemonPath], {detached: true, ...})` where daemonPath is daemon/index.ts | ✓ WIRED | `daemonPath` resolved via `new URL("../daemon/index.ts", import.meta.url).pathname` at line 55; spawned at line 60 |
| `src/cli/commands/init.ts` | `src/cli/client.ts` | `ensureDaemon()` called after migrations | ✓ WIRED | Imported at line 6; called at line 25 |
| `src/cli/index.ts` | `src/cli/commands/init.ts` | `InitCommand` registered with Clipanion Cli | ✓ WIRED | Imported at line 2; `cli.register(InitCommand)` at line 12 |

**Note on db/index.ts → paths.ts link:** The PLAN specified `db/index.ts` importing `DB_PATH` from `paths.ts`. The implementation uses a factory pattern — `createDatabase(dbPath)` takes `dbPath` as a parameter. The `DB_PATH` constant is consumed by `daemon/index.ts` and `cli/commands/init.ts` when calling `createDatabase(DB_PATH)`. This is a correct design evolution documented in the SUMMARY ("Factory function pattern: createDatabase(dbPath) instead of module singleton"). The semantic link is preserved at the call site; the implementation is correct.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| INFR-01 | 01-02, 01-03 | Daemon starts automatically on first CLI/API use and persists coordination state | ✓ SATISFIED | `ensureDaemon()` in `client.ts` auto-starts daemon; `isDaemonAlive()` prevents double-spawn; test "daemon persists after CLI exits" passes |
| INFR-02 | 01-01 | SQLite database in `.wit/` with WAL mode, busy_timeout, and ACID guarantees | ✓ SATISFIED | `createDatabase()` sets WAL, busy_timeout=5000, synchronous=NORMAL, foreign_keys=ON; 6/6 PRAGMA tests confirm via live PRAGMA queries |
| INFR-03 | 01-01, 01-03 | PID file management with stale PID detection and automatic recovery | ✓ SATISFIED | `isDaemonAlive()` uses `process.kill(pid, 0)` to probe liveness; stale PID file deleted on ESRCH; `cleanStaleSocket()` removes stale socket before bind |
| INFR-04 | 01-01, 01-02 | Protocol version field in every request/response with structured VERSION_MISMATCH error | ✓ SATISFIED | `witVersion` field on all three RPC types; server middleware returns -32001 VERSION_MISMATCH with `{expected, received}` data on mismatch |
| INFR-05 | 01-01, 01-02 | Agent registers with name and session ID; all locks/intents attributed to session | ✓ SATISFIED | `register` RPC method inserts into `agents` table with `sessionId` unique index; returns `agentId` for downstream attribution |
| INFR-06 | 01-02 | Daemon clean shutdown on SIGTERM/SIGINT with state flush | ✓ SATISFIED | `setupShutdownHandlers` registers both SIGTERM and SIGINT; handler calls `server.stop()`, `sqlite.close()`, unlinks PID + socket files, `process.exit(0)` |
| APIC-01 | 01-02 | HTTP/JSON-RPC API exposed over Unix domain socket at `.wit/daemon.sock` | ✓ SATISFIED | `Bun.serve({unix: SOCKET_PATH, fetch: app.fetch})` in `daemon/index.ts`; SOCKET_PATH resolves to `.wit/daemon.sock` |
| APIC-02 | 01-01, 01-03 | CLI command `wit init` creates `.wit/` directory and initializes SQLite schema | ✓ SATISFIED | `InitCommand` creates `.wit/` via `mkdirSync`, opens DB, runs `runMigrations(db)`, then closes; 6/6 init tests pass |

All 8 required Phase 1 requirements satisfied. No orphaned requirements.

---

### Anti-Patterns Found

No blockers or stubs detected across all source files.

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `package.json` | 10 | `clipanion` listed under `devDependencies` but used at runtime in `src/cli/` | ℹ Info | No impact during Phase 1 since the project runs via `bun run`. Would affect `bun compile` for binary distribution (Phase 4 concern per PLAN note). No action required now. |

---

### Human Verification Required

#### 1. Full end-to-end manual smoke test

**Test:** In a fresh directory, run `bun /path/to/wit/src/cli/index.ts init`. Then kill the daemon (`kill $(cat .wit/daemon.pid)`). Run `bun /path/to/wit/src/cli/index.ts init` again.
**Expected:** First run: `.wit/` directory created with `state.db`, `daemon.pid`, `daemon.sock`; "Wit initialized." printed. Second run (after kill): fresh daemon spawned, new PID in `daemon.pid`, "Wit initialized." printed without error.
**Why human:** Process-level daemon lifecycle (detached subprocess surviving CLI exit) requires an actual shell session to observe.

#### 2. Unix socket RPC over curl

**Test:** After `wit init`, run: `curl --unix-socket .wit/daemon.sock -X POST http://localhost/rpc -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","witVersion":"1","id":"test-1","method":"ping","params":{}}'`
**Expected:** JSON response `{"jsonrpc":"2.0","witVersion":"1","id":"test-1","result":"pong"}` with no error.
**Why human:** Verifies the live Unix socket binding and end-to-end request dispatch outside the test harness.

---

### Gaps Summary

No gaps. All five success criteria from ROADMAP.md are verified, all 8 requirement IDs are satisfied, all 15 artifacts pass existence/substance/wiring checks, all 10 key links are confirmed wired, and 44/44 tests pass with `tsc --noEmit` exiting 0.

---

_Verified: 2026-03-25_
_Verifier: Claude (gsd-verifier)_
