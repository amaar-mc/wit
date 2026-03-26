---
phase: 01-foundation
plan: "01"
subsystem: infra
tags: [bun, typescript, drizzle-orm, sqlite, hono, clipanion, zod, json-rpc]

requires: []
provides:
  - Bun project scaffold with all Phase 1 production and dev dependencies
  - Strict TypeScript configuration with bun-types
  - drizzle.config.ts for schema-driven migrations
  - src/shared/paths.ts — WIT_DIR, SOCKET_PATH, PID_PATH, DB_PATH from WIT_REPO_ROOT env
  - src/shared/protocol.ts — PROTOCOL_VERSION, RpcRequest/RpcSuccess/RpcError interfaces and helpers
  - src/db/schema.ts — Drizzle agents table definition
  - src/db/index.ts — createDatabase(dbPath) factory with all four PRAGMAs
  - src/db/migrate.ts — runMigrations(db) programmatic migrator
  - drizzle/0000_yellow_prima.sql — initial agents table migration
affects:
  - 01-02
  - 01-03
  - 01-04
  - All Phase 1 plans that import from src/shared/ or src/db/

tech-stack:
  added:
    - hono@4.12.9
    - drizzle-orm@0.45.1
    - zod@4.3.6
    - "@hono/zod-validator@0.7.6"
    - drizzle-kit@0.31.10
    - "@types/bun@latest"
    - typescript@6.0.2
    - clipanion@4.0.0-rc.4
  patterns:
    - createDatabase(dbPath) factory pattern — avoids singleton, safe for multi-DB test isolation
    - witPaths(root) function for computing all .wit/ paths from explicit root (test-friendly)
    - Module-level path exports using process.env["WIT_REPO_ROOT"] ?? process.cwd()
    - PRAGMAs set on raw Database before Drizzle wraps it (WAL must be first write-adjacent call)
    - RpcRequest/RpcSuccess/RpcError interfaces with jsonrpc:"2.0" + witVersion for protocol evolution

key-files:
  created:
    - package.json
    - tsconfig.json
    - drizzle.config.ts
    - src/shared/paths.ts
    - src/shared/protocol.ts
    - src/db/schema.ts
    - src/db/index.ts
    - src/db/migrate.ts
    - src/db/db.test.ts
    - src/shared/shared.test.ts
    - drizzle/0000_yellow_prima.sql
  modified: []

key-decisions:
  - "TypeScript types added via types:[bun-types] in tsconfig, not triple-slash reference — broader coverage"
  - "createDatabase returns {db, sqlite} tuple so callers can close raw sqlite handle on shutdown"
  - "witPaths(root) exported alongside module-level constants — tests use witPaths without env mutation"
  - "PRAGMA busy_timeout query returns column 'timeout' not 'busy_timeout' — test updated to match SQLite actual column name"

patterns-established:
  - "Factory function pattern: createDatabase(dbPath) instead of module singleton — enables isolated test DBs"
  - "PRAGMA order: journal_mode=WAL first, before any write transaction opens"
  - "All .wit/ paths derived from WIT_REPO_ROOT env var with cwd() fallback — absolute paths at runtime"

requirements-completed: [INFR-02, INFR-04, INFR-05]

duration: 4min
completed: 2026-03-26
---

# Phase 1 Plan 01: Foundation Scaffold Summary

**Bun+TypeScript project scaffolded with Drizzle/SQLite WAL database, JSON-RPC protocol types, and canonical .wit/ path utilities — the shared foundation all Phase 1 plans import from**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-26T04:23:53Z
- **Completed:** 2026-03-26T04:27:50Z
- **Tasks:** 3 (+ 2 TDD test commits)
- **Files created:** 11

## Accomplishments

- Bun project scaffold with all Phase 1 deps (hono, drizzle-orm, zod, @hono/zod-validator, drizzle-kit, clipanion, typescript)
- SQLite database factory with WAL mode, busy_timeout=5000, synchronous=NORMAL, foreign_keys=ON confirmed by 6 passing tests
- JSON-RPC protocol types (RpcRequest, RpcSuccess, RpcError) with witVersion field and helper factories
- Canonical .wit/ path utilities with WIT_REPO_ROOT env override and witPaths() test helper
- Initial Drizzle migration generated — agents table with id, name, session_id, connected_at columns

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold project and install dependencies** — `f9ca2b4` (chore)
2. **Task 2: Shared contracts — failing tests (RED)** — `a2c185b` (test)
3. **Task 2: Shared contracts — implementation (GREEN)** — `ceeb342` (feat)
4. **Task 3: Database layer — failing tests (RED)** — `014a28d` (test)
5. **Task 3: Database layer — implementation (GREEN)** — `1f57c6c` (feat)

## Files Created

- `package.json` — Project manifest with all Phase 1 deps
- `tsconfig.json` — Strict mode, moduleResolution=bundler, types=[bun-types]
- `drizzle.config.ts` — Points to src/db/schema.ts, outputs to ./drizzle, sqlite dialect
- `src/shared/paths.ts` — WIT_DIR, SOCKET_PATH, PID_PATH, DB_PATH + witPaths(root) factory
- `src/shared/protocol.ts` — PROTOCOL_VERSION, RpcRequest/RpcSuccess/RpcError + create helpers
- `src/db/schema.ts` — Drizzle agents table (id, name, session_id, connected_at)
- `src/db/index.ts` — createDatabase(dbPath) factory with four PRAGMA calls
- `src/db/migrate.ts` — runMigrations(db) wrapping drizzle-orm/bun-sqlite/migrator
- `src/db/db.test.ts` — 6 tests covering all PRAGMAs and agents table migration
- `src/shared/shared.test.ts` — 11 tests covering paths and protocol module behavior
- `drizzle/0000_yellow_prima.sql` — CREATE TABLE agents + unique index migration

## Decisions Made

- `createDatabase` returns `{ db, sqlite }` tuple — caller retains raw sqlite handle for explicit close on shutdown (matches lifecycle.ts pattern from research)
- `witPaths(root)` exported as test utility — avoids process.env mutation in tests
- `typescript@6.0.2` installed (research pinned `^5`, but v6 is compatible and bun resolved it)
- PRAGMA busy_timeout result accessed via `.timeout` column (not `.busy_timeout`) — confirmed by live SQLite query

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PRAGMA busy_timeout test used wrong column key**
- **Found during:** Task 3 (database PRAGMA tests)
- **Issue:** Test expected `row.busy_timeout` but SQLite's PRAGMA busy_timeout returns column named `timeout`
- **Fix:** Updated test type assertion and property access to `.timeout`
- **Files modified:** `src/db/db.test.ts`
- **Verification:** `bun test src/db/db.test.ts` — 6/6 pass
- **Committed in:** `1f57c6c` (Task 3 feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — Bug)
**Impact on plan:** Test had incorrect column name assumption. Fix required for correctness, no scope change.

## Issues Encountered

- `bun init` sets typescript to `peerDependencies` instead of `devDependencies` — moved to devDependencies manually in package.json
- `tsconfig.json` from `bun init` didn't include `"types": ["bun-types"]` — added to resolve `console` global

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All shared contracts exported and type-safe: `src/shared/paths.ts`, `src/shared/protocol.ts`
- Database layer fully operational: `createDatabase()`, `runMigrations()`, `agents` schema
- Ready for Plan 01-02 (daemon HTTP server) and Plan 01-03 (CLI scaffold) to import from these modules

---
*Phase: 01-foundation*
*Completed: 2026-03-26*

## Self-Check: PASSED

All files verified present on disk. All commits verified in git log.
- f9ca2b4: chore(01-01) scaffold
- a2c185b: test(01-01) shared RED
- ceeb342: feat(01-01) shared GREEN
- 014a28d: test(01-01) db RED
- 1f57c6c: feat(01-01) db GREEN
