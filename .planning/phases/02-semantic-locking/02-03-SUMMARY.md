---
phase: 02-semantic-locking
plan: "03"
subsystem: parser
tags: [tree-sitter, call-edges, symbol-deps, lock-warnings, tdd, bun, drizzle]

# Dependency graph
requires:
  - phase: 02-semantic-locking
    plan: "01"
    provides: "ParserService, SymbolInfo, extractSymbols, symbolDeps schema, locks schema"
  - phase: 02-semantic-locking
    plan: "02"
    provides: "lock.acquire/release/query handlers, DaemonDeps, TTL cleanup"
provides:
  - "extractCallEdges(parser, language, source, symbols): CallEdge[] — TS and Python call graph extraction via AST query + parent walk"
  - "qualifyEdges(edges, filePath, symbols): QualifiedCallEdge[] — qualifies bare names to 'file:symbol' or '?:name'"
  - "lock.acquire now parses the target file, refreshes symbol_deps, and returns caller warnings in response"
  - "buildCallerWarnings: returns informational warnings when callers of a locked symbol are locked by other sessions"
affects:
  - "03-cli (lock output will display warnings)"
  - "Phase 3+ anything querying symbol_deps"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD two-pass for tree-sitter: query captures call nodes, parent walk finds innermost function boundary"
    - "Language detection by querying TS grammar — same try/catch approach as symbols.ts"
    - "Symbol deduplication via Set<caller:callee> to avoid duplicate edges when same callee called multiple times"
    - "symbol_deps fully replaced per file on each parse (delete + insert) — no stale edges"
    - "WIT_REPO_ROOT env var with cwd() fallback for resolving absolute file paths in daemon context"

key-files:
  created:
    - "src/parser/calls.ts — CallEdge, QualifiedCallEdge types; extractCallEdges, qualifyEdges functions"
    - "src/parser/calls.test.ts — 13 unit tests covering TS/Python call extraction and qualifyEdges"
  modified:
    - "src/daemon/rpc/handlers.ts — added parseFileAndRefreshDeps, buildCallerWarnings; wired into lock.acquire"
    - "src/daemon/rpc/handlers.test.ts — added 5 new tests for symbol_deps population and caller warnings"

key-decisions:
  - "Parent walk uses innermost function boundary as caller — arrow function resolves name from parent variable_declarator"
  - "Module-level calls produce no edge — containing function required for both caller ends"
  - "Caller warnings are informational only — lock.acquire always succeeds, warnings in response body"
  - "symbol_deps fully replaced per file on each lock.acquire (delete old + insert new) — prevents stale edge accumulation"
  - "Language detection by file extension (.ts/.tsx/.js/.jsx -> typescript, .py -> python) — unknown extensions skipped silently"

patterns-established:
  - "Two-pass AST call extraction: tree-sitter query for call nodes + parent walk to find containing function"
  - "qualifyEdges: caller always intra-file qualified, callee checked against known symbols set"
  - "TDD RED (failing test commit) -> GREEN (implementation commit) pattern for each task"

requirements-completed: [LOCK-07, LOCK-08]

# Metrics
duration: 12min
completed: 2026-03-26
---

# Phase 02 Plan 03: Call Edge Extraction and Caller Warnings Summary

**AST call graph extraction for TS/Python via tree-sitter query + parent walk, with symbol_deps population and transitive caller warnings on lock.acquire**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-26T05:27:19Z
- **Completed:** 2026-03-26T05:39:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `extractCallEdges` extracts caller->callee pairs from TypeScript and Python source using a tree-sitter query for call nodes combined with a parent walk to identify the innermost containing function
- `qualifyEdges` transforms bare symbol names to fully-qualified `file:symbol` paths, marking unknown callees as `?:name` for cross-file tracking
- `lock.acquire` now parses the locked file on each acquire, refreshes `symbol_deps` table rows for that file, and returns a `warnings` array identifying any callers of the locked symbol that are held by other sessions

## Task Commits

Each task was committed atomically following TDD RED -> GREEN:

1. **Task 1 RED: Failing tests for call edge extraction** - `7613283` (test)
2. **Task 1 GREEN: extractCallEdges and qualifyEdges implementation** - `40f0e3b` (feat)
3. **Task 2 RED: Failing tests for symbol_deps and caller warnings** - `c062621` (test)
4. **Task 2 GREEN: parseFileAndRefreshDeps and buildCallerWarnings wired into lock.acquire** - `a9f486b` (feat)

**Plan metadata:** _(final commit — docs)_

_Note: TDD tasks have two commits each (test → feat)_

## Files Created/Modified

- `src/parser/calls.ts` — CallEdge and QualifiedCallEdge types, extractCallEdges (TS+Python), qualifyEdges
- `src/parser/calls.test.ts` — 13 unit tests: TS function/method/arrow/member/module-level/nested, Python function/method/attribute/module-level, qualifyEdges
- `src/daemon/rpc/handlers.ts` — Added parseFileAndRefreshDeps, buildCallerWarnings; lock.acquire now returns warnings array
- `src/daemon/rpc/handlers.test.ts` — Added 5 new tests using real ParserService and temp repo dir fixture

## Decisions Made

- Parent walk finds innermost function boundary: arrow functions resolve name from parent `variable_declarator`, anonymous arrows produce no edge
- Module-level calls produce no edge — caller must be a named function
- Caller warnings are informational — lock.acquire always returns success, warnings included in result body
- `symbol_deps` fully replaced (delete + insert) per file on each lock.acquire, preventing stale edge accumulation across file edits
- Language detected by file extension; unknown extensions silently skipped rather than erroring

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Call edge dependency graph is complete: `symbol_deps` is populated on every lock.acquire
- Caller warnings available in lock.acquire response — CLI can surface these to agents in Phase 3
- Full test suite passes (94 tests across 10 files), zero TypeScript errors

---
*Phase: 02-semantic-locking*
*Completed: 2026-03-26*

## Self-Check: PASSED

- src/parser/calls.ts — FOUND
- src/parser/calls.test.ts — FOUND
- src/daemon/rpc/handlers.ts — FOUND
- src/daemon/rpc/handlers.test.ts — FOUND
- 02-03-SUMMARY.md — FOUND
- Commits 7613283, 40f0e3b, c062621, a9f486b — ALL FOUND
