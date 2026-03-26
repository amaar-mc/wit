---
phase: 04-polish
plan: 01
subsystem: cli
tags: [clipanion, session-id, status, declare, lock, release, rpc]

requires:
  - phase: 03-coordination
    provides: intent.declare, intent.query, lock.acquire, lock.release, lock.query, contract.query RPC endpoints
  - phase: 02-semantic-locking
    provides: lock.acquire, lock.release daemon handlers and semantic lock system
  - phase: 01-foundation
    provides: rpc() client, ensureDaemon(), unix socket transport, WIT_DIR path constants
provides:
  - wit status [--json] — parallel query of intents, locks, contracts with human table output
  - wit declare --description X --files Y [--symbols Z] [--json] — register intent via daemon
  - wit lock --symbol X [--ttl N] [--json] — acquire semantic lock via daemon
  - wit release --symbol X [--json] — release held lock via daemon
  - src/cli/session.ts — stable session ID persisted in .wit/session.id
  - src/cli/render.ts — shared human-readable rendering for status output
affects: [users, agents, any caller using the CLI interface]

tech-stack:
  added: [clipanion moved from devDependencies to dependencies]
  patterns:
    - Command class with static paths, Option.*, async execute returning number
    - try/catch with {error: message} JSON envelope in --json mode
    - getSessionId(WIT_DIR) for stable session ID across CLI invocations
    - renderStatus() with String.padEnd() fixed-width columns, no table library

key-files:
  created:
    - src/cli/session.ts
    - src/cli/render.ts
    - src/cli/commands/status.ts
    - src/cli/commands/declare.ts
    - src/cli/commands/lock.ts
    - src/cli/commands/release.ts
    - src/cli/commands/status.test.ts
    - src/cli/commands/declare.test.ts
    - src/cli/commands/lock.test.ts
    - src/cli/commands/release.test.ts
  modified:
    - src/cli/commands/init.ts
    - src/cli/index.ts
    - package.json

key-decisions:
  - "clipanion moved from devDependencies to dependencies — required at runtime for compiled binary"
  - "getSessionId(witDir) throws actionable error if .wit/session.id missing — never silently returns empty"
  - "writeSessionId derives ID from USER@cwd — stable across restarts without requiring random UUID generation"
  - "renderStatus uses String.padEnd() fixed-width columns — no external table library, zero new deps"
  - "All commands wrap execute() body in try/catch — in --json mode errors output {error:message} JSON to stdout"
  - "StatusCommand calls all three RPC queries in parallel via Promise.all — single round-trip cost"

patterns-established:
  - "Command pattern: static override paths, Option.Boolean/String/Array, async execute(): Promise<number>"
  - "JSON error envelope: catch -> write JSON({error: message}) -> return 1"
  - "Session ID: getSessionId(WIT_DIR) in every command that needs caller identity"

requirements-completed: [APIC-03, APIC-04, APIC-05, APIC-06, APIC-07]

duration: 5min
completed: 2026-03-26
---

# Phase 4 Plan 1: CLI Commands (status, declare, lock, release) Summary

**Four primary user/agent CLI commands with --json support, stable session ID from .wit/session.id, and shared human-readable rendering via padEnd table formatting**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-26T06:59:42Z
- **Completed:** 2026-03-26T07:05:00Z
- **Tasks:** 2 (TDD — RED + GREEN per task)
- **Files modified:** 12

## Accomplishments

- Session ID helper (`session.ts`) reads/writes stable `user@cwd` identity from `.wit/session.id`
- Shared rendering utility (`render.ts`) formats intents, locks, and contracts as fixed-width tables
- Four commands (`status`, `declare`, `lock`, `release`) all registered and functional with `--json` flag
- `InitCommand` updated to write session ID on `wit init`
- `clipanion` moved from devDependencies to dependencies (Phase 1 pitfall fix)
- All 16 new tests pass; no regressions introduced

## Task Commits

1. **Task 1: Session ID helper, render utility, and test scaffolds** - `0b5881e` (feat)
2. **Task 2: All four CLI commands and registration** - `9cc9679` (feat)

## Files Created/Modified

- `src/cli/session.ts` — getSessionId reads .wit/session.id; writeSessionId generates user@cwd stable ID
- `src/cli/render.ts` — renderStatus writes human-readable intents/locks/contracts tables to stream
- `src/cli/commands/status.ts` — StatusCommand: parallel rpc queries, human or JSON output
- `src/cli/commands/declare.ts` — DeclareCommand: intent.declare with conflict display
- `src/cli/commands/lock.ts` — LockCommand: lock.acquire with TTL and warnings
- `src/cli/commands/release.ts` — ReleaseCommand: lock.release with confirmation
- `src/cli/commands/status.test.ts` — 4 tests for StatusCommand
- `src/cli/commands/declare.test.ts` — 4 tests for DeclareCommand
- `src/cli/commands/lock.test.ts` — 4 tests for LockCommand
- `src/cli/commands/release.test.ts` — 4 tests for ReleaseCommand
- `src/cli/commands/init.ts` — Added writeSessionId call after mkdirSync
- `src/cli/index.ts` — Registered all four new commands
- `package.json` — Moved clipanion to dependencies

## Decisions Made

- Used `String.padEnd()` for table rendering — no external table library, keeps zero new production deps
- `getSessionId` throws with actionable message (`Run 'wit init' first`) rather than returning empty string
- `writeSessionId` derives ID from `USER@cwd` — deterministic, survives restarts, no UUID generation needed
- `StatusCommand` uses `Promise.all` for all three RPC queries — single round-trip latency cost
- Error envelope in `--json` mode outputs `{error: message}` to stdout (not stderr) so machine consumers can parse it

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Pre-existing test isolation issue: `init.test.ts` fails when run together with daemon-spawning tests due to bun module caching of `WIT_DIR` constant. This was present before this plan (same 5 init test failures in full suite, same pass count 166/171). Not caused by this plan's changes.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All four core CLI commands functional and tested
- Session ID mechanism in place
- Ready for Phase 4 Plan 2 (git trailer support or watch mode)

---
*Phase: 04-polish*
*Completed: 2026-03-26*

## Self-Check: PASSED

- All 7 created files exist on disk
- Task commits 0b5881e and 9cc9679 verified in git log
