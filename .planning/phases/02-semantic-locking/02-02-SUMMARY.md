---
phase: 02-semantic-locking
plan: "02"
subsystem: api
tags: [drizzle, sqlite, hono, rpc, locking, ttl, tree-sitter]

# Dependency graph
requires:
  - phase: 02-01
    provides: locks/symbol_deps schema tables, ParserService/createParserService

provides:
  - lock.acquire RPC method with conflict detection and idempotent re-lock
  - lock.release RPC method with ownership check
  - lock.query RPC method with active-only filtering and ttlRemainingMs
  - startTtlCleanup/runTtlCleanup exported from lifecycle.ts
  - ParserService field in DaemonDeps
  - Parser init + TTL cleanup wired into daemon/index.ts startup

affects: [03-call-graph, 04-cli]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Separate runTtlCleanup for direct test invocation, startTtlCleanup for production interval"
    - "Upsert via onConflictDoUpdate — single SQL for both insert and idempotent re-lock"
    - "gt(locks.expiresAt, now) in lock.query — never return stale entries from query layer"

key-files:
  created: []
  modified:
    - src/daemon/rpc/handlers.ts
    - src/daemon/rpc/handlers.test.ts
    - src/daemon/lifecycle.ts
    - src/daemon/lifecycle.test.ts
    - src/daemon/server.ts
    - src/daemon/server.test.ts
    - src/daemon/index.ts

key-decisions:
  - "runTtlCleanup exported separately from startTtlCleanup — enables tests to trigger cleanup logic without setting up real intervals"
  - "Expired-lock takeover uses upsert onConflictDoUpdate — avoids delete+insert race condition on concurrent acquire"
  - "setupShutdownHandlers accepts optional cleanupInterval — backward-compatible, clears interval before sqlite.close()"
  - "symbolPath must contain ':' separator (zod refine) — validates format at RPC boundary before any DB access"

patterns-established:
  - "Stub parserService in test deps: { typescript: {} as never, python: {} as never, parser: {} as never } — handlers don't use parser directly until Plan 03"
  - "Lock conflict check reads existing row first, then upserts — explicit check allows returning holder info in LOCK_CONFLICT error"

requirements-completed: [LOCK-01, LOCK-02, LOCK-05, LOCK-06]

# Metrics
duration: 3min
completed: 2026-03-26
---

# Phase 2 Plan 02: Lock RPC Handlers and TTL Cleanup Summary

**Drizzle-backed lock.acquire/release/query RPC handlers with conflict detection, idempotent re-lock, and a 30s TTL cleanup loop wired into daemon startup**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-26T05:21:12Z
- **Completed:** 2026-03-26T05:24:36Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- lock.acquire inserts or upserts locks with LOCK_CONFLICT on cross-session collision and idempotent refresh for same-session re-acquire
- lock.release deletes with LOCK_NOT_FOUND/LOCK_NOT_HELD ownership check
- lock.query returns only non-expired locks with computed ttlRemainingMs, optional sessionId filter
- startTtlCleanup runs expired-lock deletion every 30 seconds; runTtlCleanup exported for direct test invocation
- ParserService added to DaemonDeps; daemon/index.ts initializes parser and cleanup at startup

## Task Commits

Each task was committed atomically:

1. **Task 1: Lock acquire/release/query RPC handlers with tests** - `84970d9` (feat)
2. **Task 2: TTL cleanup loop, ParserService in DaemonDeps, daemon startup wiring** - `687afa6` (feat)

## Files Created/Modified

- `src/daemon/rpc/handlers.ts` - Added lock.acquire, lock.release, lock.query cases with zod schemas
- `src/daemon/rpc/handlers.test.ts` - 21 tests covering acquire/release/query including conflict, idempotency, expiry
- `src/daemon/lifecycle.ts` - Added runTtlCleanup, startTtlCleanup; extended setupShutdownHandlers with cleanupInterval
- `src/daemon/lifecycle.test.ts` - 7 tests including TTL cleanup (expired deleted, active preserved)
- `src/daemon/server.ts` - Added parserService: ParserService to DaemonDeps type
- `src/daemon/server.test.ts` - Updated stub deps to include parserService
- `src/daemon/index.ts` - Wired createParserService + startTtlCleanup into startup sequence

## Decisions Made

- Exported `runTtlCleanup` separately from `startTtlCleanup` so tests trigger cleanup logic directly without real intervals
- Expired-lock takeover uses upsert `onConflictDoUpdate` to avoid delete+insert race on concurrent acquires
- `setupShutdownHandlers` accepts optional `cleanupInterval` — backward-compatible, interval cleared before sqlite.close()
- `symbolPath` must contain `:` separator validated via zod refine — enforces format at RPC boundary

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Lock acquire/release/query RPC fully implemented and tested (33 daemon tests pass, 76 total)
- ParserService initialized at daemon startup — ready for Plan 03 to add call graph extraction RPC methods that use the parser
- TTL cleanup running — stale locks from crashed agents will auto-expire within 30s

## Self-Check: PASSED

- handlers.ts: FOUND
- lifecycle.ts: FOUND
- server.ts: FOUND
- index.ts: FOUND
- 02-02-SUMMARY.md: FOUND
- commit 84970d9: FOUND
- commit 687afa6: FOUND

---
*Phase: 02-semantic-locking*
*Completed: 2026-03-26*
