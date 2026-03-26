---
phase: 03-coordination
plan: 01
subsystem: database
tags: [drizzle, sqlite, zod, tree-sitter, intent-tracking]

# Dependency graph
requires:
  - phase: 02-semantic-locking
    provides: lock.acquire pattern, extractSymbols parser integration, timestamp_ms convention, DaemonDeps shape
  - phase: 01-foundation
    provides: schema.ts table pattern, Drizzle insert/select/update, RPC handler switch structure

provides:
  - intents table with status lifecycle (declared -> active -> resolved/abandoned)
  - intent.declare RPC handler with symbol byte-range resolution via tree-sitter
  - intent.update RPC handler with transition validation
  - intent.query RPC handler with sessionId/file/status filters
  - Drizzle migration 0002_bent_naoko.sql for intents table

affects:
  - 03-coordination plan 02 (conflict detection queries intents table)
  - 03-coordination plan 03 (contract enforcement reads intents)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Comma-delimited files column with leading/trailing commas for exact LIKE segment matching"
    - "timestamp_ms mode for declared_at/updated_at — numeric Date.now() storage without Date object overhead"
    - "TDD: RED commit (failing tests) then GREEN commit (passing implementation)"

key-files:
  created:
    - drizzle/0002_bent_naoko.sql
  modified:
    - src/db/schema.ts
    - src/daemon/rpc/handlers.ts
    - src/daemon/rpc/handlers.test.ts

key-decisions:
  - "Files column stores comma-delimited paths with leading/trailing commas (e.g. ',src/auth.ts,src/utils.ts,') — enables exact segment LIKE matching via '%,file,%' without partial path false positives"
  - "intent.query default filter returns only declared+active intents; explicit status param overrides to allow querying resolved/abandoned"
  - "resolveSymbolByteRange computes union range (min startByte, max endByte) across all listed files — handles multi-file symbol intents"
  - "VALID_TRANSITIONS map defines forward-only lifecycle: declared->[active,resolved,abandoned], active->[resolved,abandoned]; resolved/abandoned have no valid forward transitions"
  - "timestamp_ms Drizzle mode returns Date objects from select — tests must call .getTime() for numeric comparison"

patterns-established:
  - "Intent lifecycle: declared (inserted) -> active (work in progress) -> resolved (merged/done) | abandoned (cancelled)"
  - "Symbol byte-range resolution: same extractSymbols pattern as lock.acquire, returns null if file missing or symbol not found"

requirements-completed: [INTN-01, INTN-02, INTN-03]

# Metrics
duration: 8min
completed: 2026-03-26
---

# Phase 03 Plan 01: Intent Lifecycle System Summary

**SQLite intents table with declare/update/query RPC handlers, forward-only status transitions, symbol byte-range resolution via tree-sitter, and exact comma-delimited file-segment LIKE matching**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-26T06:10:00Z
- **Completed:** 2026-03-26T06:18:36Z
- **Tasks:** 1 (TDD: RED + GREEN commits)
- **Files modified:** 4

## Accomplishments
- Intents table added to schema.ts with indexes on sessionId, status, files; Drizzle migration generated
- intent.declare inserts intent row, resolves symbol startByte/endByte via tree-sitter for symbol-level intents; file-level intents (no symbols) leave byte range null
- intent.update enforces forward-only transitions with INVALID_TRANSITION error for backward moves, INTENT_NOT_OWNED for session mismatch
- intent.query returns declared+active by default; supports sessionId, file (exact segment), and explicit status filters; all 120 tests pass including existing lock tests

## Task Commits

Each task was committed atomically (TDD):

1. **RED: Failing intent tests** - `6f588fe` (test)
2. **GREEN: Intent schema, migration, and handlers** - `805c161` (feat)

**Plan metadata:** (docs commit — pending)

_Note: TDD task split into RED (failing tests) then GREEN (implementation) commits_

## Files Created/Modified
- `src/db/schema.ts` — Added intents table definition with 10 columns and 3 indexes
- `src/daemon/rpc/handlers.ts` — Added IntentDeclare/Update/QueryParamsSchema, resolveSymbolByteRange helper, three RPC cases
- `src/daemon/rpc/handlers.test.ts` — Added 26 intent tests across intent.declare, intent.declare with symbols, intent.update, intent.query describe blocks
- `drizzle/0002_bent_naoko.sql` — Migration SQL creating intents table and indexes

## Decisions Made
- Files column stored with leading/trailing commas (`,src/auth.ts,src/utils.ts,`) so LIKE `%,src/auth.ts,%` matches exact path segments without false positives on partial paths like `auth.ts` matching `src/auth.ts`
- Default intent.query returns only declared+active (useful status) unless status param provided explicitly; allows Plan 02 conflict detection to query by file without filtering status manually
- timestamp_ms Drizzle columns return Date objects from select — test comparing updatedAt uses `.getTime()` for numeric comparison

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed updatedAt timestamp comparison test using .getTime()**
- **Found during:** Task 1 (GREEN phase — first test run)
- **Issue:** Test compared two Date objects with `toBeGreaterThan` — Bun's test runner requires numbers for numeric comparisons, not Date objects
- **Fix:** Changed `before[0]!.updatedAt` to `(before[0]!.updatedAt as Date).getTime()` in test assertion
- **Files modified:** src/daemon/rpc/handlers.test.ts
- **Verification:** All 26 intent tests pass after fix
- **Committed in:** 805c161 (GREEN commit)

**2. [Rule 1 - Bug] Fixed file LIKE pattern missing wildcard characters**
- **Found during:** Task 1 (GREEN phase — file filter test failed with 1 result instead of 2)
- **Issue:** Handler used `"," + file + ","` as LIKE pattern — matches literal `,src/auth.ts,` with no wildcards, missing entries where auth.ts is not the only file
- **Fix:** Changed to `"%" + "," + file + "," + "%"` so pattern becomes `%,src/auth.ts,%`
- **Files modified:** src/daemon/rpc/handlers.ts
- **Verification:** File filter test passes, finds 2 entries as expected
- **Committed in:** 805c161 (GREEN commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs)
**Impact on plan:** Both bugs found during first test run and fixed inline. No scope creep.

## Issues Encountered
- Drizzle `timestamp_ms` mode stores integers in SQLite but hydrates them as Date objects on select — this required numeric conversion in test assertions and defensive `.getTime()` fallback in the query result mapper

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- intents table and all three RPC methods ready for Plan 02 conflict detection
- intent.query with file filter is the primary API Plan 02 will use to detect overlapping intents
- Byte ranges (startByte/endByte) available for symbol-level overlap detection in Plan 02
