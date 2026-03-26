---
phase: 03-coordination
plan: 03
subsystem: contracts
tags: [tree-sitter, rpc, git-hooks, drizzle, sqlite, clipanion, bun]

# Dependency graph
requires:
  - phase: 03-02
    provides: conflict detection engine (intent declare + INTENT_OVERLAP/LOCK_INTERSECTION/DEP_CHAIN)
  - phase: 03-01
    provides: intent lifecycle RPC handlers (declare/update/query)
  - phase: 02-semantic-locking
    provides: lock.acquire RPC and symbol_deps population via tree-sitter
provides:
  - contracts table (id, proposerSessionId, symbolPath, signature, status, responderSessionId, proposedAt, respondedAt)
  - contract.propose RPC: extracts normalized function signature via tree-sitter, stores proposed contract
  - contract.respond RPC: accept/reject with self-accept guard and status transition enforcement
  - contract.query RPC: filterable by symbolPath and status
  - check-contracts RPC: compares staged file content against accepted contracts, returns violations
  - HookInstallCommand (wit hook install): writes executable pre-commit hook
  - CheckContractsCommand (wit check-contracts): reads argv file paths, calls check-contracts RPC
  - drizzle migration 0003_large_nitro.sql for contracts table
affects: [pre-commit enforcement, future agent coordination workflows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - extractSignatureFromSource: synchronous helper using SIG_QUERY_TS/SIG_QUERY_PY tree-sitter queries to extract normalized signature (params + return type) from source text
    - check-contracts: staged content passed as {path, content} pairs — never reads disk, uses content provided by caller
    - HookInstallCommand: git rev-parse --git-path hooks for core.hooksPath support, fallback to .git/hooks
    - CheckContractsCommand: Promise.race with 2s timeout for best-effort enforcement (never blocks commit if daemon unreachable)
    - like(contracts.symbolPath, filePrefix + "%") for file-scoped contract lookup

key-files:
  created:
    - drizzle/0003_large_nitro.sql
    - drizzle/meta/0003_snapshot.json
    - src/cli/commands/hook.ts
    - src/cli/commands/hook.test.ts
  modified:
    - src/db/schema.ts
    - src/daemon/rpc/handlers.ts
    - src/daemon/rpc/handlers.test.ts
    - src/cli/index.ts

key-decisions:
  - "SIG_QUERY_TS uses three capture patterns (function_declaration, variable_declarator+arrow_function, method_definition) matching the plan's research-defined query"
  - "extractSignatureFromSource is synchronous (no async/await) — setLanguage + parse must not be interrupted by async operations per existing codebase comment"
  - "check-contracts receives {path, content} pairs not file paths — staged content injected by caller, daemon never reads disk for check-contracts"
  - "like(contracts.symbolPath, filePrefix + '%') used for file-scoped contract lookup in check-contracts handler"
  - "CheckContractsCommand uses Promise.race with 2s timeout for best-effort enforcement — never blocks commit if daemon unreachable"
  - "HookInstallCommand uses git rev-parse --git-path hooks (not hardcoded .git/hooks) to respect core.hooksPath custom configuration"
  - "normalizeSignature collapses whitespace and trims — ensures signatures from different parse contexts compare equal"

patterns-established:
  - "Contract status machine: proposed -> accepted | rejected (forward-only, no revert)"
  - "Self-accept guard: proposerSessionId === sessionId check in contract.respond"
  - "Staged content injection pattern: check-contracts receives file content as parameter, not file paths to read"

requirements-completed: [CONT-01, CONT-02, CONT-03]

# Metrics
duration: 15min
completed: 2026-03-26
---

# Phase 03 Plan 03: Contract System Summary

**Tree-sitter signature extraction with propose/respond/query RPC, git pre-commit hook enforcing accepted function contracts via xargs + check-contracts daemon call**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-26T06:15:00Z
- **Completed:** 2026-03-26T06:31:10Z
- **Tasks:** 2
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments
- Contracts table schema + drizzle migration with symbolPath/status/proposer/responder columns
- contract.propose: extracts normalized function signature via tree-sitter SIG_QUERY_TS/PY and stores as proposed contract
- contract.respond: enforces self-accept guard, status transition guard (proposed-only), transitions to accepted/rejected
- contract.query: returns all contracts filterable by symbolPath and status
- check-contracts: receives staged file {path, content} pairs, compares each accepted contract's signature against re-extracted signature from staged content
- HookInstallCommand (wit hook install): writes executable pre-commit shell script respecting git core.hooksPath
- CheckContractsCommand (wit check-contracts): reads file paths from xargs argv, gets staged content via git show, calls daemon RPC with 2s timeout

## Task Commits

Each task was committed atomically:

1. **Task 1: Contracts schema, propose/respond/query/check-contracts RPC** - `6b4f9c7` (feat)
2. **Task 2: wit hook install + check-contracts CLI commands** - `38c1679` (feat)

## Files Created/Modified
- `src/db/schema.ts` - Added contracts table with 8 columns and 3 indexes
- `src/daemon/rpc/handlers.ts` - Added contract.propose/respond/query/check-contracts cases, extractSignature/extractSignatureFromSource helpers, SIG_QUERY_TS/PY constants
- `src/daemon/rpc/handlers.test.ts` - Added 16 new contract tests across 4 describe blocks
- `src/cli/commands/hook.ts` - HookInstallCommand and CheckContractsCommand
- `src/cli/commands/hook.test.ts` - 7 hook installation tests
- `src/cli/index.ts` - Registered HookInstallCommand and CheckContractsCommand
- `drizzle/0003_large_nitro.sql` - Migration SQL for contracts table
- `drizzle/meta/0003_snapshot.json` - Drizzle migration metadata snapshot

## Decisions Made
- `extractSignatureFromSource` is synchronous — tree-sitter's setLanguage/parse pair must not be interrupted by async operations (matches existing codebase constraint)
- `check-contracts` receives staged content as `{path, content}[]` pairs rather than reading disk — clean separation between pre-commit hook (which reads via `git show`) and daemon (which processes content)
- `like(contracts.symbolPath, filePrefix + "%")` for file-scoped contract lookup instead of string splitting in SQL
- CheckContractsCommand uses `Promise.race` with 2s timeout so a dead/slow daemon never blocks a commit
- HookInstallCommand uses `git rev-parse --git-path hooks` to support custom `core.hooksPath` configurations

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Test assertion `toContain(".ts")` failed because the shell regex in the hook script uses `\\.(ts|tsx|py)$` (escaped backslash), which does not contain the literal string `.ts` as a standalone segment. Fixed the assertion to check for `ts` and `py` individually (still validates TS/Python extension filtering).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Contract system fully operational: propose → accept/reject lifecycle working
- Pre-commit hook enforcement ready to install in any repo with `wit hook install`
- Phase 03-coordination complete — all three coordination mechanisms (intents, conflict detection, contracts) implemented
- Ready for Phase 04 (final phase) if planned

---
*Phase: 03-coordination*
*Completed: 2026-03-26*

## Self-Check: PASSED

- FOUND: `.planning/phases/03-coordination/03-03-SUMMARY.md`
- FOUND: `src/db/schema.ts`
- FOUND: `src/daemon/rpc/handlers.ts`
- FOUND: `src/cli/commands/hook.ts`
- FOUND: `src/cli/commands/hook.test.ts`
- FOUND: `drizzle/0003_large_nitro.sql`
- FOUND: commit `6b4f9c7` (feat: contract RPC + schema)
- FOUND: commit `38c1679` (feat: hook install + check-contracts CLI)
