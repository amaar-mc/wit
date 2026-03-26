---
phase: 03-coordination
plan: 02
subsystem: api
tags: [conflict-detection, intents, locks, symbol-deps, drizzle, bun-sqlite]

requires:
  - phase: 03-coordination
    plan: 01
    provides: "intent lifecycle system — schema, RPC handlers for declare/update/query, comma-delimited files column"
  - phase: 02-semantic-locking
    provides: "locks table, symbolDeps table, lock.acquire populating symbol_deps rows"

provides:
  - "ConflictItem union type (INTENT_OVERLAP | LOCK_INTERSECTION | DEP_CHAIN) in protocol.ts"
  - "ConflictReport type { hasConflicts: boolean; items: ConflictItem[] } in protocol.ts"
  - "findOverlappingIntents: detects file-level and byte-range overlapping intents from other sessions"
  - "findLockConflicts: detects active locks on intent's symbol paths held by other sessions"
  - "findDepChainConflicts: detects active locks on callees of intent's symbols held by other sessions"
  - "buildConflictReport: combines all three detectors into a ConflictReport"
  - "intent.declare response extended from {intentId} to {intentId, conflicts: ConflictReport}"

affects:
  - 03-03
  - cli
  - clients

tech-stack:
  added: []
  patterns:
    - "Conflict detection as warnings — intent.declare always succeeds, conflicts are informational only"
    - "Qualified symbol paths (file:symbolName) built from intent files x symbol names for lock lookups"
    - "File overlap via comma-delimited split on stored files column, then Array.includes check"
    - "Byte-range intersection predicate: startByte < other.endByte AND endByte > other.startByte"
    - "DEP_CHAIN mirrors buildCallerWarnings but inverted: checks callees instead of callers"
    - "Promise.all for parallel execution of all three conflict detectors"

key-files:
  created: []
  modified:
    - src/shared/protocol.ts
    - src/daemon/rpc/handlers.ts
    - src/daemon/rpc/handlers.test.ts

key-decisions:
  - "Conflict detection always runs on all declared/active intents from other sessions — no caching or early exit"
  - "Symbols passed as names in intent.declare params; qualified to file:symbolName for lock/dep lookups at conflict check time"
  - "File-level intents (null byte range) overlap with ALL intents touching the same file, regardless of other intent's byte range"
  - "Byte-range intents only overlap when both have non-null ranges and ranges intersect (startByte < other.endByte AND endByte > other.startByte)"

patterns-established:
  - "Conflict report pattern: collect all warning items, return {hasConflicts: items.length > 0, items}"
  - "All conflict detectors take (deps, sessionId, ...) and never block — callers decide response strategy"

requirements-completed: [CONF-01, CONF-02, CONF-03, CONF-04]

duration: 3min
completed: 2026-03-26
---

# Phase 3 Plan 2: Conflict Detection Engine Summary

**Three-detector conflict engine wired into intent.declare: INTENT_OVERLAP (file/byte-range), LOCK_INTERSECTION (symbol locked by other session), DEP_CHAIN (callee of intent symbol locked), with ConflictReport types in protocol.ts**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-26T06:21:22Z
- **Completed:** 2026-03-26T06:24:01Z
- **Tasks:** 1 (TDD: test + feat commits)
- **Files modified:** 3

## Accomplishments

- ConflictItem union type and ConflictReport type exported from `src/shared/protocol.ts`
- Three conflict detectors: `findOverlappingIntents`, `findLockConflicts`, `findDepChainConflicts`
- `buildConflictReport` runs all three in parallel via Promise.all and merges results
- `intent.declare` response extended from `{intentId}` to `{intentId, conflicts: ConflictReport}`
- 12 new tests covering all conflict types, edge cases (same session, expired locks, abandoned intents), and no-conflict path
- All 132 project tests pass (52 existing handler tests + 12 new conflict tests + 68 other)

## Task Commits

Each task was committed atomically:

1. **RED: Failing conflict detection tests** - `21983be` (test)
2. **GREEN: Conflict engine implementation** - `e232809` (feat)

_Note: TDD task — test commit followed by feat commit_

## Files Created/Modified

- `src/shared/protocol.ts` — Added `ConflictItem` union type and `ConflictReport` type
- `src/daemon/rpc/handlers.ts` — Added `findOverlappingIntents`, `findLockConflicts`, `findDepChainConflicts`, `buildConflictReport`; extended `intent.declare` response
- `src/daemon/rpc/handlers.test.ts` — 12 new tests across 3 describe blocks for all conflict detection paths

## Decisions Made

- Symbols in `intent.declare` params are bare names (e.g. `["validateToken"]`); these are qualified to `file:symbolName` at conflict check time by combining with the intent's `files` array. This keeps the declare API ergonomic while enabling precise lock lookups.
- File-level intents (null byte range) overlap with any intent touching the same file, regardless of whether the other intent has a byte range. This is the conservative approach — a file-level intent signals "I'm touching this entire file."
- Byte-range intents only conflict when both sides have non-null ranges and those ranges intersect. If only one side has a range, the file-level side wins (overlap detected).
- `buildConflictReport` uses `Promise.all` to run all three detectors concurrently for latency.

## Deviations from Plan

None — plan executed exactly as written. The implementation matches the specified behavior, types, function signatures, and SQL predicates from the plan action section.

## Issues Encountered

Minor: initial implementation passed bare symbol names to `findLockConflicts` instead of qualified `file:symbolName` paths. Detected immediately by RED tests; fixed in the same GREEN commit by qualifying paths before passing to `buildConflictReport`. No separate commit needed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Conflict detection is fully wired into `intent.declare`
- `ConflictItem` and `ConflictReport` types are exported and ready for CLI/client consumption in Phase 3 Plan 3
- The three conflict types cover the full CONF-01 through CONF-04 requirements
- No blockers for 03-03

## Self-Check: PASSED

All files present and commits verified:
- `src/shared/protocol.ts` — FOUND
- `src/daemon/rpc/handlers.ts` — FOUND
- `src/daemon/rpc/handlers.test.ts` — FOUND
- `.planning/phases/03-coordination/03-02-SUMMARY.md` — FOUND
- Commit `21983be` (test RED) — FOUND
- Commit `e232809` (feat GREEN) — FOUND

---
*Phase: 03-coordination*
*Completed: 2026-03-26*
