---
phase: 04-polish
plan: 02
subsystem: cli
tags: [clipanion, bun, git-hooks, git-trailers, readline, polling]

# Dependency graph
requires:
  - phase: 04-01
    provides: renderStatus() in render.ts, getSessionId() in session.ts, rpc() in client.ts

provides:
  - WatchCommand (wit watch): live polling of coordination state with configurable interval and clean SIGINT exit
  - ActiveIntentsCommand (wit _active-intents): hidden internal command outputting declared/active intent UUIDs for a session
  - prepare-commit-msg hook: git hook that injects Wit-Intent trailers for active intents via git interpret-trailers
  - HookInstallCommand extended: now writes both pre-commit and prepare-commit-msg hooks

affects:
  - git workflow (prepare-commit-msg hook active in any repo where wit hook install is run)
  - audit trail (Wit-Intent git trailers link commits to declared intents)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Silent exit on daemon unreachable: Promise.race with timeout resolves to 0 exit code — never block git operations"
    - "Polling watch with SIGINT: setInterval + process.once('SIGINT') + Promise resolve for clean terminal exit"
    - "Readline screen clear: readline.cursorTo(0,0) + clearScreenDown before each redraw cycle"
    - "timeout binary guard: command -v timeout check before using coreutils timeout in shell scripts"

key-files:
  created:
    - src/cli/commands/watch.ts
    - src/cli/commands/watch.test.ts
    - src/cli/commands/active-intents.ts
  modified:
    - src/cli/commands/hook.ts
    - src/cli/commands/hook.test.ts
    - src/cli/index.ts

key-decisions:
  - "Promise.race with 500ms timeout in ActiveIntentsCommand — 500ms inner timeout plus optional coreutils timeout 0.5 as outer safety net on systems where it exists"
  - "command -v timeout guard in prepare-commit-msg shell script — macOS ships without coreutils timeout, so primary timeout is the Promise.race in ActiveIntentsCommand"
  - "ACTIVE_STATUSES = {declared, active}: only these two statuses contribute Wit-Intent trailers — resolved/abandoned intents should not appear in commit messages"
  - "readline module mocked with both default and named exports in tests — watch.ts uses default import so mock needs a default key"

patterns-established:
  - "Silent-exit pattern: any command invoked from git hooks wraps all rpc calls in try/catch and always returns 0 — never block git"
  - "Hidden command pattern: static usage = Command.Usage({hidden: true}) for internal plumbing commands not meant for direct user invocation"

requirements-completed: [APIC-08, INTN-04]

# Metrics
duration: 4min
completed: 2026-03-26
---

# Phase 04 Plan 02: Watch and Intent-to-Commit Linkage Summary

**`wit watch` live coordination monitor with configurable polling plus prepare-commit-msg hook that injects Wit-Intent git trailers for traceable intent-to-commit linkage**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-26T07:07:51Z
- **Completed:** 2026-03-26T07:11:10Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- WatchCommand polls intent.query, lock.query, contract.query in parallel on configurable interval (default 2000ms), clears and redraws terminal using renderStatus, exits cleanly on Ctrl+C with code 0, and shows inline error message if daemon is unreachable without crashing
- ActiveIntentsCommand (hidden `_active-intents`) outputs one UUID per line for declared/active intents of a given session, with 500ms Promise.race timeout to prevent blocking git operations on daemon unreachability
- HookInstallCommand now writes both pre-commit and prepare-commit-msg hooks; the prepare-commit-msg script reads session ID, queries active intents via `wit _active-intents`, and injects Wit-Intent trailers via `git interpret-trailers --in-place`
- WatchCommand and ActiveIntentsCommand registered in CLI index (confirmed via `--help` output)

## Task Commits

Each task was committed atomically:

1. **Task 1: wit watch command with polling and clean exit** - `6ce6b35` (feat)
2. **Task 2: Intent-to-commit linkage via prepare-commit-msg hook** - `c5f714a` (feat)

**Plan metadata:** see final docs commit (docs)

_Note: TDD tasks — both followed Red-Green pattern (failing test first, then implementation)_

## Files Created/Modified

- `src/cli/commands/watch.ts` - WatchCommand: polls 3 RPC queries on interval, redraws with renderStatus, SIGINT handling
- `src/cli/commands/watch.test.ts` - Tests: initial draw calls rpc 3x and renders status; rpc error shows inline without crash
- `src/cli/commands/active-intents.ts` - ActiveIntentsCommand: hidden `_active-intents` command, filters to declared/active, 500ms timeout
- `src/cli/commands/hook.ts` - Extended HookInstallCommand to also write prepare-commit-msg hook with Wit-Intent trailer injection
- `src/cli/commands/hook.test.ts` - Extended with 4 new tests: prepare-commit-msg installation, ActiveIntentsCommand UUID output, filtering, silent error exit
- `src/cli/index.ts` - Registered WatchCommand and ActiveIntentsCommand

## Decisions Made

- `command -v timeout` guard in shell script: macOS ships without coreutils `timeout`, so the primary protection is the 500ms Promise.race inside `ActiveIntentsCommand`. The shell guard adds `timeout 0.5` only on systems where it exists (Linux/coreutils).
- Readline mock in watch tests requires both `default` key and named exports because `watch.ts` uses `import readline from "node:readline"` (default import). Bun's `mock.module` needs the `default` key to satisfy that import.
- `ACTIVE_STATUSES = {declared, active}` only — resolved and abandoned intents must not contribute trailers since they represent completed/cancelled work, not in-progress work.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Readline mock initially only exported named exports; watch.ts uses a default import so the mock needed a `default` key added. Fixed inline during GREEN phase (not a deviation — part of normal test writing).
- Full test suite shows 5 failing tests in init.test.ts, but these are pre-existing concurrency isolation failures that pass when init.test.ts is run in isolation. Not caused by changes in this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 04 is now complete:
- Plan 01 delivered: status command, render.ts, session.ts, openrpc.json, PROTOCOL.md
- Plan 02 delivered: watch command, active-intents command, prepare-commit-msg hook

The full `wit` CLI surface is implemented. Any follow-on work would be packaging/distribution (bun compile, binary distribution) which is outside the current milestone scope.

---
*Phase: 04-polish*
*Completed: 2026-03-26*
