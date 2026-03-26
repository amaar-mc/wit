---
phase: 02-semantic-locking
plan: "01"
subsystem: parser
tags: [tree-sitter, wasm, web-tree-sitter, typescript, python, drizzle, sqlite]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: Drizzle schema + bun-sqlite database + import.meta.url-relative path pattern

provides:
  - createParserService() factory loading web-tree-sitter WASM with TypeScript and Python grammars
  - extractSymbols() producing SymbolInfo arrays for all 6 TS symbol kinds and 2 Python kinds
  - defaultWasmPaths() helper resolving WASM paths relative to file (CWD-independent)
  - locks table in Drizzle schema with symbol_path unique index and timestamp_ms TTL columns
  - symbolDeps table in Drizzle schema with indexes on callee, caller, and file columns
  - Migration drizzle/0001_jazzy_red_ghost.sql with CREATE TABLE for locks and symbol_deps

affects:
  - 02-semantic-locking (plans 02+) — lock acquire/release handlers depend on ParserService and schema
  - daemon lifecycle — ParserService must be added to DaemonDeps at startup

# Tech tracking
tech-stack:
  added:
    - web-tree-sitter@0.24.7 (pinned — 0.25.x has type regression)
    - tree-sitter-wasms@0.1.13 (prebuilt WASM grammars)
  patterns:
    - WASM init via Parser.init({ locateFile }) with import.meta.url-relative path to tree-sitter.wasm
    - Language.load(Uint8Array) via Bun.file().bytes() — no HTTP serving, no bundler config needed
    - getQueryString() tries TS query first, falls back to Python to auto-detect grammar
    - Parser not thread-safe: never await between parser.setLanguage() and parser.parse()
    - Query capture names with dot-suffix (definition.function) map to SymbolInfo.kind

key-files:
  created:
    - src/parser/loader.ts
    - src/parser/symbols.ts
    - src/parser/loader.test.ts
    - src/parser/symbols.test.ts
    - drizzle/0001_jazzy_red_ghost.sql
  modified:
    - src/db/schema.ts
    - package.json
    - bun.lock

key-decisions:
  - "defaultWasmPaths() resolves paths relative to import.meta.url — same CWD-independence pattern as migrate.ts"
  - "Language.load(Uint8Array) accepted directly — no locateFile dance needed for language WASM, only for tree-sitter.wasm core"
  - "Arrow functions use variable_declarator node for byte range (covers the full const assignment including name binding)"
  - "timestamp_ms mode for locks.acquiredAt/expiresAt — enables numeric Date.now() comparison without Date object overhead"
  - "symbolPath unique index at DB level — one lock per symbol enforced in schema, not just application code"

patterns-established:
  - "Pattern: WASM-based parser initialized once per service lifetime via createParserService() factory"
  - "Pattern: extractSymbols() accepts (parser, language, source) — caller owns the parser instance for concurrency control"
  - "Pattern: SymbolInfo.kind derived from query capture name suffix (definition.function -> function)"

requirements-completed: [LOCK-03, LOCK-04]

# Metrics
duration: 2min
completed: 2026-03-26
---

# Phase 2 Plan 01: Parser Service and Schema Summary

**web-tree-sitter 0.24.7 WASM parser service extracting TypeScript (6 symbol kinds) and Python (2 symbol kinds), plus Drizzle locks and symbolDeps schema tables with TTL-capable indexes**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-26T05:15:31Z
- **Completed:** 2026-03-26T05:17:36Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Parser service loads web-tree-sitter WASM core and TypeScript/Python language grammars using CWD-independent import.meta.url-relative paths
- Symbol extractor correctly identifies function, arrow, method, type, interface, class symbols in TypeScript and function, class in Python — 14 tests all pass
- Drizzle schema extended with locks (unique symbol_path index, timestamp_ms TTL) and symbolDeps (callee/caller/file indexes) tables; migration generated

## Task Commits

Each task was committed atomically:

1. **Task 1: Install tree-sitter deps, create parser loader + symbol extractor with tests** - `ac5aed5` (feat)
2. **Task 2: Add locks and symbol_deps tables to Drizzle schema and generate migration** - `e109e94` (feat)

Auto-fix commit: `6182e40` (fix: tsc strict null check in test file)

## Files Created/Modified

- `src/parser/loader.ts` - createParserService() factory + defaultWasmPaths() helper
- `src/parser/symbols.ts` - extractSymbols() for TS/Python ASTs + SymbolInfo type
- `src/parser/loader.test.ts` - Smoke tests for WASM init and language load (3 tests)
- `src/parser/symbols.test.ts` - Unit tests for all 6 TS and 2 Python symbol kinds (11 tests)
- `src/db/schema.ts` - Added locks and symbolDeps table definitions alongside agents
- `drizzle/0001_jazzy_red_ghost.sql` - Migration with CREATE TABLE locks + symbol_deps and all indexes
- `package.json` / `bun.lock` - web-tree-sitter@0.24.7 and tree-sitter-wasms@0.1.13

## Decisions Made

- Used `getQueryString()` helper that probes the language object by trying to compile the TS query — avoids passing an explicit language flag to `extractSymbols()` while keeping the function signature simple.
- Both `acquiredAt` and `expiresAt` use `timestamp_ms` mode (not `timestamp`) — this stores milliseconds as integers, matching `Date.now()` for TTL cleanup via `lt(locks.expiresAt, new Date())`.
- `symbolPath` unique index is enforced at the DB level (not application code only) — prevents race conditions where two concurrent acquire calls could both pass the conflict check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript strict null check in symbols.test.ts**
- **Found during:** Post-implementation tsc verification
- **Issue:** Array element accesses `sorted[i]` and `sorted[i - 1]` not checked for undefined, failing `noUncheckedIndexedAccess` strict mode
- **Fix:** Added explicit `if (current && previous)` guard before the expect assertion
- **Files modified:** src/parser/symbols.test.ts
- **Verification:** `bun run tsc --noEmit` exits clean; 14 parser tests still pass
- **Committed in:** `6182e40` (fix commit after Task 2)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug)
**Impact on plan:** Required for TypeScript strict mode compliance. No scope creep.

## Issues Encountered

None beyond the tsc strict null check auto-fix.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- ParserService and SymbolInfo types ready for use in lock acquire/release handlers
- DaemonDeps in src/daemon/server.ts needs `parserService: ParserService` field added in next plan
- locks and symbolDeps tables exist in schema; runMigrations() will apply them on next daemon start
- No blockers

---
*Phase: 02-semantic-locking*
*Completed: 2026-03-26*

## Self-Check: PASSED

All created files exist on disk. All 3 task commits verified in git history.
