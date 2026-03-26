---
phase: 01-foundation
plan: "03"
subsystem: infra
tags: [bun, typescript, clipanion, unix-socket, json-rpc, cli, spawn, tdd]

requires:
  - phase: 01-foundation-01
    provides: witPaths, SOCKET_PATH, PID_PATH, DB_PATH, WIT_DIR, createRpcRequest
  - phase: 01-foundation-02
    provides: daemon entry point at src/daemon/index.ts, unix socket server, JSON-RPC /rpc route

provides:
  - src/cli/client.ts — isDaemonAlive, spawnDaemon, waitForSocket, ensureDaemon, rpc<T>
  - src/cli/commands/init.ts — InitCommand (clipanion): .wit/ creation, DB migration, daemon start
  - src/cli/index.ts — Cli entry point with HelpCommand, VersionCommand, InitCommand
affects:
  - 01-04
  - All CLI subcommands added in Phase 2+
  - Any plan that needs to invoke wit from a subprocess or test harness

tech-stack:
  added: []
  patterns:
    - "Connect-or-spawn idiom: ensureDaemon() checks isDaemonAlive before spawning — never double-spawns"
    - "Detached daemon via Bun.spawn with proc.unref() — CLI exits without waiting for daemon"
    - "WIT_REPO_ROOT env var passed to detached daemon so it knows which repo to serve"
    - "existsSync (node:fs) for socket polling — Bun.file().exists() returns false for socket files"
    - "defaultPaths() lazy factory in client.ts — reads env at call time, avoids module-level constant baking"
    - "InitCommand opens DB for migrations then closes — daemon opens its own independent connection"

key-files:
  created:
    - src/cli/client.ts
    - src/cli/commands/init.ts
    - src/cli/index.ts
    - src/cli/client.test.ts
    - src/cli/commands/init.test.ts
  modified:
    - src/db/migrate.ts
    - package.json

key-decisions:
  - "existsSync (node:fs) used for socket file detection — Bun.file().exists() returns false for socket files (socket is not a regular file)"
  - "import.meta.url-relative path for drizzle migrations folder — detached daemon has unpredictable CWD"
  - "WitPaths passed as explicit argument to client functions — tests inject temp-dir paths without env mutation"
  - "static override modifier required in TS6 strict mode for clipanion paths/usage class members"
  - "CLI's InitCommand opens DB for migrations, closes before ensureDaemon — daemon owns its own DB connection"

patterns-established:
  - "Connect-or-spawn: isDaemonAlive → spawnDaemon → waitForSocket — the central Phase 1 CLI idiom"
  - "Test isolation via explicit WitPaths arg + per-test temp dirs + PID-guarded SIGTERM in afterEach"
  - "Bun.file().exists() is unsafe for non-regular files — always use existsSync for sockets and FIFOs"

requirements-completed: [INFR-01, INFR-03, APIC-02]

duration: 7min
completed: 2026-03-26
---

# Phase 1 Plan 03: CLI Layer Summary

**Clipanion CLI with connect-or-spawn daemon client — `wit init` creates .wit/, runs Drizzle migrations, auto-starts detached Unix-socket daemon, and responds to RPC ping in under 700ms**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-03-26T04:36:40Z
- **Completed:** 2026-03-26T04:43:42Z
- **Tasks:** 2 (+ 2 TDD test commits)
- **Files created:** 5, modified: 2

## Accomplishments

- `isDaemonAlive` correctly detects live/dead/missing PIDs and cleans stale PID files
- `spawnDaemon` launches daemon as fully detached Bun subprocess with WIT_REPO_ROOT env var, proc.unref()
- `ensureDaemon` idempotent connect-or-spawn: second call returns immediately if daemon alive
- `rpc<T>` sends JSON-RPC 2.0 POST over unix socket, returns typed result, throws on RPC error
- `InitCommand` (clipanion): creates .wit/, runs migrations, starts daemon, prints "Wit initialized."
- Phase 1 end-to-end flow verified: 44 tests pass in 2s across 7 files

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: CLI client tests** — `f588832` (test)
2. **Task 1 GREEN: CLI client implementation** — `ef2fc39` (feat)
3. **Task 2 RED: wit init command tests** — `d15c3e6` (test)
4. **Task 2 GREEN: wit init + CLI entry point** — `0281735` (feat)

## Files Created

- `src/cli/client.ts` — isDaemonAlive, spawnDaemon, waitForSocket, ensureDaemon, rpc<T>
- `src/cli/commands/init.ts` — InitCommand with mkdirSync, createDatabase, runMigrations, ensureDaemon
- `src/cli/index.ts` — Cli instance with HelpCommand, VersionCommand, InitCommand
- `src/cli/client.test.ts` — 6 tests: PID detection, daemon spawn, socket poll, RPC round trip
- `src/cli/commands/init.test.ts` — 6 tests: .wit/ creation, agents table, PID file, socket, stdout, idempotent

## Files Modified

- `src/db/migrate.ts` — Changed `./drizzle` to `import.meta.url`-relative absolute path (detached CWD safety)
- `package.json` — Added `bin.wit` pointing to `src/cli/index.ts`

## Decisions Made

- `existsSync` (node:fs) for socket polling — `Bun.file().exists()` silently returns `false` for unix socket files, which caused a 3000ms timeout on every `ensureDaemon` call
- `import.meta.url`-relative path in `migrate.ts` — daemon is spawned detached with no guaranteed CWD; `./drizzle` would fail in any directory other than the project root
- Explicit `WitPaths` argument on all client functions with lazy `defaultPaths()` factory — tests inject temp-dir paths, production code reads env at call time (not module load time)
- `static override` required in TypeScript 6 strict mode when overriding base class static members in clipanion `Command` subclasses

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Bun.file().exists() returns false for Unix socket files**
- **Found during:** Task 1 (`waitForSocket` implementation)
- **Issue:** `Bun.file(socketPath).exists()` always returns `false` for socket files — Bun's file API handles regular files only. `waitForSocket` polled forever and timed out at 3000ms even when socket was present.
- **Fix:** Switched to `existsSync` from `node:fs` in `waitForSocket`. Added `existsSync` to the import.
- **Files modified:** `src/cli/client.ts`
- **Verification:** `bun test src/cli/client.test.ts` — all 6 pass including ensureDaemon/rpc round trip
- **Committed in:** `ef2fc39` (Task 1 GREEN commit)

**2. [Rule 1 - Bug] migrate.ts used CWD-relative `./drizzle` path**
- **Found during:** Task 1 (debugging daemon spawn timeout)
- **Issue:** `runMigrations` called `migrate(db, { migrationsFolder: "./drizzle" })`. When daemon is spawned as a detached subprocess from a different directory, `./drizzle` resolves incorrectly and throws `Can't find meta/_journal.json`.
- **Fix:** Changed to `join(new URL(".", import.meta.url).pathname, "../../drizzle")` — absolute path relative to `migrate.ts` location, CWD-independent.
- **Files modified:** `src/db/migrate.ts`
- **Verification:** Daemon starts successfully from any CWD; all 44 tests pass
- **Committed in:** `ef2fc39` (Task 1 GREEN commit)

**3. [Rule 1 - Bug] TypeScript 6 requires `override` modifier on clipanion static members**
- **Found during:** Task 2 (`bun run tsc --noEmit` verification)
- **Issue:** TS4114 error — `static paths` and `static usage` in `InitCommand` override base class members but lacked `override` keyword, which is required in TypeScript 6 strict mode.
- **Fix:** Added `static override` to both `paths` and `usage` declarations.
- **Files modified:** `src/cli/commands/init.ts`
- **Verification:** `bun run tsc --noEmit` exits 0
- **Committed in:** `0281735` (Task 2 GREEN commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 — Bug)
**Impact on plan:** All three were correctness bugs — one runtime failure, one silent test sabotage, one type system violation. No scope creep.

## Issues Encountered

- Test runner received SIGTERM when `afterEach` tried to kill a daemon using `process.pid` (from the `isDaemonAlive returns true` test which writes `process.pid` to the PID file). Fixed by guarding `process.kill(pid)` with `pid !== process.pid` check.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 1 end-to-end flow is complete: `wit init` → `.wit/` created → DB migrated → daemon running → RPC ping/pong verified
- All 44 tests pass in 2.09s, TypeScript strict mode clean
- Phase 2 can add new CLI subcommands by: creating `src/cli/commands/[name].ts`, extending `Command`, registering in `src/cli/index.ts`
- Phase 2 can add new RPC methods by extending `handleRpc` in `src/daemon/rpc/handlers.ts`

---
*Phase: 01-foundation*
*Completed: 2026-03-26*

## Self-Check: PASSED

All files verified present on disk. All commits verified in git log.
- f588832: test(01-03) client RED
- ef2fc39: feat(01-03) client GREEN + migrate.ts fix
- d15c3e6: test(01-03) init RED
- 0281735: feat(01-03) init GREEN
