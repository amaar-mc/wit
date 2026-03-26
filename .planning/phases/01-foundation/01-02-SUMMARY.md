---
phase: 01-foundation
plan: "02"
subsystem: infra
tags: [bun, hono, json-rpc, unix-socket, drizzle-orm, zod, lifecycle, sigterm]

requires:
  - phase: 01-foundation-01
    provides: createDatabase/WitDatabase, PROTOCOL_VERSION/RpcRequest/RpcError helpers, SOCKET_PATH/PID_PATH/DB_PATH constants, agents schema, runMigrations

provides:
  - src/daemon/server.ts — createApp(DaemonDeps) Hono factory with version middleware and /rpc route
  - src/daemon/rpc/handlers.ts — handleRpc() dispatcher for ping and register methods
  - src/daemon/lifecycle.ts — writePidFile, cleanStaleSocket, setupShutdownHandlers
  - src/daemon/index.ts — runnable daemon entry point on Unix domain socket

affects:
  - 01-03
  - 01-04
  - Any component that starts or stops the daemon process

tech-stack:
  added: []
  patterns:
    - "createApp(deps) factory pattern — DaemonDeps injected at startup, no singletons, test-friendly"
    - "RPC body parsed ONCE in Hono middleware, stashed via c.set('rpcBody') — handlers use c.get(), never re-parse"
    - "TDD: test RED commit before feat GREEN commit for each logical unit"
    - "Drizzle .returning({id}) for insert ID retrieval — .run() returns void in Drizzle types"

key-files:
  created:
    - src/daemon/server.ts
    - src/daemon/rpc/handlers.ts
    - src/daemon/lifecycle.ts
    - src/daemon/index.ts
    - src/daemon/server.test.ts
    - src/daemon/rpc/handlers.test.ts
    - src/daemon/lifecycle.test.ts
  modified: []

key-decisions:
  - "createApp(deps) factory instead of module-level app singleton — enables isolated test deps injection"
  - "RPC body parsed in middleware and stashed in context — avoids double-parse pitfall identified in research"
  - "Use Drizzle .returning({id}) instead of .run().lastInsertRowid — .run() on insert builder returns void in Drizzle's type system"
  - "setupShutdownHandlers registers both SIGTERM and SIGINT for graceful shutdown in all termination scenarios"

patterns-established:
  - "Middleware-first parsing: all request validation in middleware layer, handlers assume valid input from context"
  - "Lifecycle hook pattern: cleanStaleSocket before bind, writePidFile after bind, setupShutdownHandlers after server ready"

requirements-completed: [INFR-01, INFR-04, INFR-05, INFR-06, APIC-01]

duration: 8min
completed: 2026-03-26
---

# Phase 1 Plan 02: Daemon Server Summary

**Hono HTTP server on Unix domain socket with JSON-RPC middleware, protocol version gating (-32001), agent registration via Drizzle, and SIGTERM/SIGINT lifecycle management**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-26T04:30:50Z
- **Completed:** 2026-03-26T04:38:50Z
- **Tasks:** 2 (+ 2 TDD test commits)
- **Files created:** 7

## Accomplishments

- Hono app factory with version-checking middleware — mismatched witVersion returns 400 with -32001 VERSION_MISMATCH
- JSON-RPC dispatcher: ping returns "pong", register inserts agent row and returns typed agentId, unknown methods return -32601
- RPC body parsed once in middleware and stashed in context — handlers never call `c.req.json()` directly
- Lifecycle module: PID file write, stale socket cleanup before bind, SIGTERM/SIGINT shutdown handlers
- Runnable daemon entry point — `bun src/daemon/index.ts` starts server on Unix socket with full startup sequence
- 15 tests passing across 3 test files, TypeScript strict mode clean

## Task Commits

1. **Task 1 RED: daemon server + handler tests** — `2ab1bf6` (test)
2. **Task 1 GREEN: Hono server + handleRpc implementation** — `659575d` (feat)
3. **Task 2 RED: lifecycle tests** — `06c73f5` (test)
4. **Task 2 GREEN: lifecycle + index.ts** — `7e5a41e` (feat)

## Files Created

- `src/daemon/server.ts` — createApp(DaemonDeps) with version middleware and /rpc route dispatch
- `src/daemon/rpc/handlers.ts` — handleRpc() with ping, register (zod-validated), and METHOD_NOT_FOUND fallback
- `src/daemon/lifecycle.ts` — writePidFile, cleanStaleSocket, setupShutdownHandlers
- `src/daemon/index.ts` — daemon entry point: mkdirSync, createDatabase, runMigrations, Bun.serve unix, lifecycle hooks
- `src/daemon/server.test.ts` — 5 server-level tests (version mismatch, ping, unknown method, parse error, invalid request)
- `src/daemon/rpc/handlers.test.ts` — 6 handler tests (register insert, duplicate session, missing fields, ping, unknown)
- `src/daemon/lifecycle.test.ts` — 4 lifecycle tests (writePidFile, cleanStaleSocket, missing socket, SIGTERM/SIGINT registration)

## Decisions Made

- `createApp(deps)` factory instead of module-level singleton — DaemonDeps injected at call site, enabling clean test isolation without process.env mutation
- Used Drizzle `.returning({ id: agents.id })` for insert ID retrieval — `.run()` on the Drizzle insert builder returns `void` in the type system (not `Changes`), so `.returning()` is the correct idiomatic approach
- Both SIGTERM and SIGINT registered in setupShutdownHandlers — covers both `kill <pid>` and Ctrl+C termination paths

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Drizzle insert .run() returns void — switched to .returning()**
- **Found during:** Task 1 (handlers implementation), TypeScript compile check
- **Issue:** Plan specified `.run().lastInsertRowid` but Drizzle's insert builder `.run()` return type is `void`, not `Changes`. `bun run tsc --noEmit` reported TS2339: Property 'lastInsertRowid' does not exist on type 'void'.
- **Fix:** Changed to `.returning({ id: agents.id })` and accessed `rows[0].id` — the correct Drizzle pattern for getting inserted row IDs
- **Files modified:** `src/daemon/rpc/handlers.ts`
- **Verification:** `bun run tsc --noEmit` clean, all 11 handler/server tests pass
- **Committed in:** `7e5a41e` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — Bug)
**Impact on plan:** Fix required for type correctness. Functionally equivalent — both approaches return the same inserted row ID. No scope change.

## Issues Encountered

- `tsc --noEmit` failed on `result.lastInsertRowid` because Drizzle types `.run()` as `void` on insert builders. Fixed by switching to `.returning({ id })` which is the idiomatic Drizzle pattern and type-safe.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Daemon is fully operational: starts, serves RPC, handles graceful shutdown
- `createApp(DaemonDeps)` and `handleRpc` are exported and testable in isolation
- Ready for Plan 01-03 (CLI scaffold) to connect to the daemon socket and call RPC methods
- Plan 01-04 integration test can start daemon process, hit unix socket, verify e2e

---
*Phase: 01-foundation*
*Completed: 2026-03-26*

## Self-Check: PASSED

All files verified present on disk. All commits verified in git log.
- 2ab1bf6: test(01-02) server+handler RED
- 659575d: feat(01-02) Hono server + handleRpc GREEN
- 06c73f5: test(01-02) lifecycle RED
- 7e5a41e: feat(01-02) lifecycle + index.ts GREEN
