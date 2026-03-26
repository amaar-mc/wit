# Phase 4: Polish - Research

**Researched:** 2026-03-25
**Domain:** CLI surface completion, git hook automation, live watch polling, JSON-RPC protocol spec
**Confidence:** HIGH

## Summary

Phase 4 completes the user-facing surface of `wit`. The daemon and all RPC handlers are already fully built. Every new CLI command (`wit status`, `wit declare`, `wit lock`, `wit release`, `wit watch`) is a thin wrapper that calls existing `rpc()` calls — the same pattern already proven in `HookInstallCommand` and `CheckContractsCommand`. No new daemon logic is required; the handlers for `intent.declare`, `lock.acquire`, `lock.release`, `lock.query`, `intent.query`, and `contract.query` all exist and work.

The two genuinely new capabilities are intent-to-commit linkage (INTN-04) and the open protocol spec (APIC-09). INTN-04 is best implemented via a `prepare-commit-msg` git hook: the hook queries `intent.query` for active intents on the current session and appends a `Wit-Intent: <uuid>` git trailer using `git interpret-trailers --in-place`. The spec (APIC-09) is a single markdown + OpenRPC JSON document describing every method, parameter, and result shape so a third-party agent can implement the protocol without reading source.

`wit watch` does not require SSE or WebSockets — both are marked deferred in EXTD-04. Polling with `setInterval` + full-screen repaint is the correct approach: query `intent.query`, `lock.query`, and `contract.query` on an interval, diff the output, and redraw. The `--json` flag (APIC-07) on all commands is a straight `JSON.stringify(result)` path through the same RPC response.

**Primary recommendation:** Implement all commands as clipanion `Command` subclasses with `static paths` + `Option.Boolean` for `--json`. Use `prepare-commit-msg` (not `commit-msg`) for INTN-04 because it fires before the editor and can inject the trailer non-interactively. Write the protocol spec as an OpenRPC 1.4.0 `openrpc.json` plus a human-readable `PROTOCOL.md`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| APIC-03 | CLI `wit status` shows active intents, locks, contracts, and conflicts | Calls `intent.query`, `lock.query`, `contract.query` — all handlers exist; format as table for human output, JSON.stringify for --json |
| APIC-04 | CLI `wit declare` registers an intent | Calls `intent.declare` RPC — handler exists; needs --description, --files, --symbols flags |
| APIC-05 | CLI `wit lock` acquires a semantic lock | Calls `lock.acquire` RPC — handler exists; needs --symbol flag with optional --ttl |
| APIC-06 | CLI `wit release` releases a held lock | Calls `lock.release` RPC — handler exists; needs --symbol flag |
| APIC-07 | All CLI commands support `--json` flag | clipanion `Option.Boolean('--json', false)` + conditional JSON.stringify path |
| APIC-08 | `wit watch` polls and displays live coordination state changes | setInterval + full-screen repaint; no SSE/WebSocket (deferred) |
| APIC-09 | Open protocol spec (markdown + JSON Schema) | OpenRPC 1.4.0 document + PROTOCOL.md describing all 10 methods |
| INTN-04 | Intent-to-commit linkage via git trailer | `prepare-commit-msg` hook writes `Wit-Intent: <uuid>` trailer via `git interpret-trailers --in-place` |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| clipanion | ^4.0.0-rc.4 | CLI command/option parsing | Already in use; `static paths` + `Option.*` pattern established in existing commands |
| bun:test | built-in | Unit tests | Already used across all 155 existing tests |
| Bun.$ | built-in | Shell commands (git) | Already used in HookInstallCommand for `git rev-parse`; avoids execa dep |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:readline | built-in | Cursor control for `wit watch` repaint | `readline.cursorTo`, `readline.clearScreenDown` for in-place terminal refresh |
| process.stdout | built-in | Direct ANSI writes | When readline helpers insufficient for full-screen clear |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| polling (setInterval) for watch | SSE/WebSocket | SSE/WebSocket is EXTD-04 (deferred); polling is simpler, correct for v1 |
| OpenRPC openrpc.json | OpenAPI 3.1 | OpenRPC is purpose-built for JSON-RPC 2.0; no path/HTTP semantics noise |
| prepare-commit-msg hook | commit-msg hook | prepare-commit-msg fires before editor and cannot be bypassed by --no-verify |

**Installation:** No new runtime packages needed. All dependencies already present.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── cli/
│   ├── commands/
│   │   ├── init.ts          # exists
│   │   ├── hook.ts          # exists
│   │   ├── status.ts        # NEW: wit status [--json]
│   │   ├── declare.ts       # NEW: wit declare --description X --files Y [--symbols Z]
│   │   ├── lock.ts          # NEW: wit lock --symbol X [--ttl N]
│   │   ├── release.ts       # NEW: wit release --symbol X
│   │   └── watch.ts         # NEW: wit watch [--interval N]
│   ├── client.ts            # exists: rpc() helper
│   └── index.ts             # update: register new commands
├── shared/
│   └── protocol.ts          # exists: may add status.query method or reuse existing
docs/
├── PROTOCOL.md              # NEW: human-readable protocol spec
└── openrpc.json             # NEW: machine-readable OpenRPC 1.4.0 spec
```

### Pattern 1: Standard CLI Command with --json Flag

The existing commands (`InitCommand`, `HookInstallCommand`) establish the pattern. New commands follow it exactly.

```typescript
// Source: existing src/cli/commands/hook.ts pattern
import { Command, Option } from "clipanion";
import { rpc } from "../client";

export class StatusCommand extends Command {
  static override paths = [["status"]];
  static override usage = Command.Usage({
    description: "Show all active intents, locks, contracts, and conflicts",
  });

  json = Option.Boolean("--json", false, {
    description: "Output machine-readable JSON instead of human-readable text",
  });

  async execute(): Promise<number> {
    const [intents, locks, contracts] = await Promise.all([
      rpc<IntentRow[]>("intent.query", {}),
      rpc<LockRow[]>("lock.query", {}),
      rpc<ContractRow[]>("contract.query", {}),
    ]);

    if (this.json) {
      this.context.stdout.write(JSON.stringify({ intents, locks, contracts }, null, 2) + "\n");
      return 0;
    }

    // Human-readable table output
    renderStatus(this.context.stdout, intents, locks, contracts);
    return 0;
  }
}
```

### Pattern 2: Session ID for Declare/Lock/Release

Agents need a session ID to call declare/lock/release. For the CLI, the session ID is derived deterministically from the current user + repo — avoids requiring the user to pass `--session-id` manually.

```typescript
// Derive session ID from hostname + cwd — stable within a checkout
function getCliSessionId(): string {
  const base = `${process.env["USER"] ?? "user"}@${process.cwd()}`;
  // Simple stable hash — not cryptographic, just unique enough
  return `cli-${Buffer.from(base).toString("base64url").slice(0, 16)}`;
}
```

Alternatively, persist a session ID in `.wit/session.id` (written on `wit init`). This is cleaner and maps naturally to how the daemon attributes intents.

### Pattern 3: wit watch Implementation

`wit watch` polls at a configurable interval, clears the screen, and redraws. The daemon already supports all required query methods.

```typescript
// Source: node:readline built-in API + setInterval
import readline from "node:readline";

export class WatchCommand extends Command {
  static override paths = [["watch"]];

  interval = Option.String("--interval", "2000", {
    description: "Poll interval in milliseconds (default: 2000)",
  });

  async execute(): Promise<number> {
    const intervalMs = parseInt(this.interval, 10);

    const redraw = async (): Promise<void> => {
      const [intents, locks, contracts] = await Promise.all([
        rpc<IntentRow[]>("intent.query", {}),
        rpc<LockRow[]>("lock.query", {}),
        rpc<ContractRow[]>("contract.query", {}),
      ]);
      // Move cursor to top-left, clear screen down
      readline.cursorTo(process.stdout, 0, 0);
      readline.clearScreenDown(process.stdout);
      renderStatus(this.context.stdout, intents, locks, contracts);
    };

    // Initial draw
    await redraw();

    const timer = setInterval(async () => {
      await redraw();
    }, intervalMs);

    // Block until SIGINT
    await new Promise<void>((resolve) => {
      process.once("SIGINT", () => {
        clearInterval(timer);
        resolve();
      });
    });

    return 0;
  }
}
```

### Pattern 4: Intent-to-Commit Linkage (INTN-04)

Use `prepare-commit-msg` hook. It fires before the editor opens, receives the commit message file path as `$1`, and can be used to inject a trailer non-interactively. Unlike `pre-commit`, it is NOT skipped by `git commit --no-verify`.

The hook script queries the daemon for active intents on the current session, then appends a `Wit-Intent: <uuid>` trailer using `git interpret-trailers --in-place`.

```sh
#!/bin/sh
# Managed by wit. Do not edit -- run `wit hook install` to regenerate.
# Injects Wit-Intent trailer for any active intents in the current session.
COMMIT_MSG_FILE="$1"
REPO_ROOT=$(git rev-parse --show-toplevel)
SESSION_FILE="$REPO_ROOT/.wit/session.id"

if [ ! -f "$SESSION_FILE" ]; then exit 0; fi
SESSION_ID=$(cat "$SESSION_FILE")

# Query active intents for this session — outputs one UUID per line
ACTIVE_INTENTS=$(bun run --cwd "$REPO_ROOT" wit _active-intents "$SESSION_ID" 2>/dev/null)
if [ -z "$ACTIVE_INTENTS" ]; then exit 0; fi

# Append a Wit-Intent trailer for each active intent
echo "$ACTIVE_INTENTS" | while IFS= read -r intent_id; do
  git interpret-trailers --in-place --trailer "Wit-Intent: $intent_id" "$COMMIT_MSG_FILE"
done
```

The `wit _active-intents <sessionId>` internal command (or reuse `wit status --json` with jq parsing) is the simplest approach. An alternative is embedding the query directly in the hook as a `bun -e` one-liner.

**Key insight on `prepare-commit-msg` vs `commit-msg`:**
- `prepare-commit-msg`: runs before editor, not bypassable with `--no-verify`, receives message file path
- `commit-msg`: runs after editor, CAN be bypassed with `--no-verify`
- For passive metadata injection (not enforcement), `prepare-commit-msg` is correct

### Pattern 5: OpenRPC 1.4.0 Spec Structure

The spec lives at `docs/openrpc.json`. It describes all 10 RPC methods with JSON Schema parameter and result shapes. A companion `docs/PROTOCOL.md` provides narrative context.

```json
{
  "openrpc": "1.4.0",
  "info": {
    "title": "Wit Agent Coordination Protocol",
    "version": "1",
    "description": "JSON-RPC 2.0 protocol over Unix domain socket..."
  },
  "methods": [
    {
      "name": "register",
      "summary": "Register an agent session",
      "params": [
        {
          "name": "params",
          "required": true,
          "schema": {
            "type": "object",
            "required": ["name", "sessionId"],
            "properties": {
              "name": { "type": "string" },
              "sessionId": { "type": "string" }
            }
          }
        }
      ],
      "result": {
        "name": "result",
        "schema": {
          "type": "object",
          "properties": {
            "agentId": { "type": "integer" }
          }
        }
      }
    }
  ]
}
```

All 10 methods to spec: `ping`, `register`, `lock.acquire`, `lock.release`, `lock.query`, `intent.declare`, `intent.update`, `intent.query`, `contract.propose`, `contract.respond`, `contract.query`, `check-contracts`.

### Anti-Patterns to Avoid

- **Querying the DB directly from CLI commands:** All CLI commands go through `rpc()` over the Unix socket, never import db schema or connect directly. The daemon owns the DB.
- **Hardcoding session IDs:** Derive from `.wit/session.id` or stable env combination. Never use process PID (changes on each run).
- **Using `commit-msg` hook for INTN-04:** It can be bypassed with `--no-verify`. Use `prepare-commit-msg`.
- **Blocking `wit watch` on error:** If the daemon is unreachable during a poll cycle, log the error inline and continue — don't crash.
- **Writing the spec to a `.ts` file:** The spec is a static artifact (`openrpc.json`). Don't generate it at runtime.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Git trailer insertion | Custom string append to commit msg | `git interpret-trailers --in-place` | Handles duplicate deduplication, RFC 822 format, trailer block placement |
| Option parsing | Custom argv loop | `Option.Boolean`, `Option.String` from clipanion | Already in use; consistent with existing commands |
| Terminal cursor control for watch | Raw ANSI codes | `readline.cursorTo` + `readline.clearScreenDown` | Built-in, cross-platform, already available in Bun's Node.js compat layer |
| Protocol machine spec | Custom format | OpenRPC 1.4.0 JSON | Standard format with tooling ecosystem; parseable by third-party generators |

**Key insight:** Every problem in this phase has a solved, standard answer. The work is wiring — not invention.

## Common Pitfalls

### Pitfall 1: Session ID Instability
**What goes wrong:** Using `process.pid` or a random UUID as the CLI session ID means each `wit` invocation creates a new session — `wit declare` and then `wit status` appear to show no active intent for the caller because the session IDs differ.
**Why it happens:** The daemon attributes intents/locks to session IDs. The CLI is stateless unless session ID is persisted.
**How to avoid:** Write a stable session ID to `.wit/session.id` on `wit init`. All subsequent CLI commands read from that file. Session is per-checkout, not per-process.
**Warning signs:** `wit status` shows no intents immediately after `wit declare` succeeds.

### Pitfall 2: clipanion devDependency Bug (from Phase 1 notes)
**What goes wrong:** clipanion is in `devDependencies` but is a runtime dependency. Binary compilation with `bun compile` will fail because clipanion won't be bundled.
**Why it happens:** Was misclassified during initial setup.
**How to avoid:** Move clipanion from `devDependencies` to `dependencies` in `package.json` before Phase 4 ships. This was flagged in Phase 1 verification notes.
**Warning signs:** `bun compile` produces a binary that crashes on startup with module-not-found for clipanion.

### Pitfall 3: wit watch Signal Handling
**What goes wrong:** `wit watch` does not respond to Ctrl+C and leaves the terminal in a cleared state.
**Why it happens:** `setInterval` keeps the process alive but `SIGINT` is not handled explicitly, or the handler doesn't restore the terminal.
**How to avoid:** Register `process.once("SIGINT", ...)` that clears the interval and writes a final newline before exiting. Use `process.exit(0)` explicitly after cleanup.
**Warning signs:** Terminal shows no prompt after Ctrl+C.

### Pitfall 4: prepare-commit-msg Hook and Non-Interactive Commits
**What goes wrong:** The `prepare-commit-msg` hook runs for merge commits, rebase commits, and `git commit -m` — not just interactive commits. Querying the daemon adds latency to all commits.
**Why it happens:** The hook always fires, regardless of how the commit is initiated.
**How to avoid:** Add an early exit: if the daemon socket doesn't exist (`.wit/daemon.sock` absent), skip silently with `exit 0`. Keep the daemon query non-blocking with a short timeout (500ms max).
**Warning signs:** Git operations are noticeably slower even when wit is not active.

### Pitfall 5: --json flag and process.exitCode
**What goes wrong:** `--json` output is written to stdout but errors from the RPC call (e.g. daemon down) are thrown as exceptions and bypass the JSON output path, printing unstructured text to stderr.
**Why it happens:** The `rpc()` helper throws on RPC errors.
**How to avoid:** In commands with `--json`, wrap the `rpc()` call in try/catch and write `{ error: message }` JSON to stdout when in JSON mode. Always return a consistent JSON envelope.
**Warning signs:** Script consumers of `wit status --json` receive mixed stdout/stderr when the daemon is down.

## Code Examples

Verified patterns from official sources and existing codebase:

### Option.Boolean for --json flag
```typescript
// Follows existing pattern in src/cli/commands/hook.ts
// Option.Boolean(optionNames, default, opts)
json = Option.Boolean("--json", false, {
  description: "Output machine-readable JSON",
});
```

### git interpret-trailers --in-place
```sh
# Source: https://git-scm.com/docs/git-interpret-trailers
# Appends trailer to the commit message file in place
git interpret-trailers --in-place --trailer "Wit-Intent: abc-123" "$COMMIT_MSG_FILE"
```

### readline cursor control for watch repaint
```typescript
// Source: node:readline built-in (available in Bun's Node compat)
import readline from "node:readline";

readline.cursorTo(process.stdout, 0, 0);
readline.clearScreenDown(process.stdout);
// Then write updated content
```

### Bun.$ for git commands in hooks
```typescript
// Source: existing src/cli/commands/hook.ts pattern
const repoRoot = await Bun.$`git rev-parse --show-toplevel`.text();
```

### rpc() pattern for new commands
```typescript
// Source: existing src/cli/client.ts
import { rpc } from "../client";

// All three queries in parallel
const [intents, locks, contracts] = await Promise.all([
  rpc<IntentRow[]>("intent.query", {}),
  rpc<LockRow[]>("lock.query", {}),
  rpc<ContractRow[]>("contract.query", {}),
]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `commit-msg` for metadata injection | `prepare-commit-msg` for passive injection | Always was best practice | `prepare-commit-msg` can't be bypassed with --no-verify; fires before editor |
| Custom JSON-RPC spec format | OpenRPC 1.4.0 standard | 2019 (OpenRPC 1.0) | Enables third-party tooling, playground, type generators |
| SSE/WebSocket for live state | Polling for v1 | v1 decision | Simpler, no daemon changes needed; SSE is EXTD-04 |

**Deprecated/outdated:**
- `commit-msg` hook for trailer injection: wrong lifecycle stage for passive metadata; use `prepare-commit-msg`

## Open Questions

1. **Session ID persistence strategy**
   - What we know: Daemon attributes intents/locks to session IDs; CLI commands need a stable ID
   - What's unclear: Whether to write `.wit/session.id` on `wit init` or derive from env (USER + cwd hash)
   - Recommendation: Write `.wit/session.id` on `wit init` — explicit, deterministic, maps to agent model. Planner should decide.

2. **`wit declare` UX: required flags or interactive prompts**
   - What we know: `intent.declare` requires `description`, `files[]`, optional `symbols[]`
   - What's unclear: Whether `--files` accepts comma-separated or multiple flags (`--files a.ts --files b.ts`)
   - Recommendation: Use `Option.Array` for `--files` (multiple `--files src/a.ts --files src/b.ts`) for clipanion consistency. Or accept a single positional for files. Planner should decide.

3. **`wit _active-intents` internal command vs inline bun -e in hook**
   - What we know: The `prepare-commit-msg` hook needs to query active intents for the session
   - What's unclear: Whether to add a hidden `_active-intents` command or embed a `bun -e` one-liner
   - Recommendation: Add a hidden (`hidden: true` in clipanion usage) internal command. Keeps the hook script simple and testable.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | none — bun test discovers *.test.ts automatically |
| Quick run command | `bun test --testPathPattern "commands/"` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| APIC-03 | `wit status` outputs intents/locks/contracts | unit | `bun test --testPathPattern "status"` | Wave 0 |
| APIC-04 | `wit declare` calls intent.declare RPC | unit | `bun test --testPathPattern "declare"` | Wave 0 |
| APIC-05 | `wit lock` calls lock.acquire RPC | unit | `bun test --testPathPattern "lock"` | Wave 0 |
| APIC-06 | `wit release` calls lock.release RPC | unit | `bun test --testPathPattern "release"` | Wave 0 |
| APIC-07 | `--json` flag outputs valid JSON on all commands | unit | `bun test --testPathPattern "status\|declare\|lock\|release"` | Wave 0 |
| APIC-08 | `wit watch` redraws on poll interval | unit (mock interval) | `bun test --testPathPattern "watch"` | Wave 0 |
| APIC-09 | openrpc.json validates against OpenRPC schema | manual | validate with openrpc-playground or ajv | manual |
| INTN-04 | prepare-commit-msg hook appends Wit-Intent trailer | unit | `bun test --testPathPattern "hook"` | extend existing hook.test.ts |

### Sampling Rate

- **Per task commit:** `bun test --testPathPattern "commands/"`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green (`bun test`, 0 failures) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/cli/commands/status.test.ts` — covers APIC-03, APIC-07 (status)
- [ ] `src/cli/commands/declare.test.ts` — covers APIC-04, APIC-07 (declare)
- [ ] `src/cli/commands/lock.test.ts` — covers APIC-05, APIC-07 (lock)
- [ ] `src/cli/commands/release.test.ts` — covers APIC-06, APIC-07 (release)
- [ ] `src/cli/commands/watch.test.ts` — covers APIC-08 (mock setInterval, verify redraw)
- [ ] Extend `src/cli/commands/hook.test.ts` — covers INTN-04 (prepare-commit-msg trailer injection)

## Sources

### Primary (HIGH confidence)

- Existing codebase (`src/cli/commands/hook.ts`, `src/cli/client.ts`, `src/shared/protocol.ts`) — established patterns for clipanion static paths, Option.*, rpc() helper
- [git-interpret-trailers official docs](https://git-scm.com/docs/git-interpret-trailers) — `--in-place --trailer` syntax verified
- [git hooks official docs](https://git-scm.com/docs/githooks) — `prepare-commit-msg` lifecycle, arguments, and --no-verify behavior verified
- [OpenRPC Specification](https://spec.open-rpc.org/) — OpenRPC 1.4.0 document structure, required fields, method/param/result shape
- [Clipanion Option API docs](http://mael.dev/clipanion/docs/api/option/) — `Option.Boolean(name, default, opts)` signature verified

### Secondary (MEDIUM confidence)

- [Clipanion README](https://github.com/arcanis/clipanion/blob/master/README.md) — static paths pattern confirmed via WebFetch
- node:readline `cursorTo` + `clearScreenDown` — available in Bun's Node.js compatibility layer; verified via WebSearch with multiple sources

### Tertiary (LOW confidence)

- `prepare-commit-msg` not bypassable by `--no-verify` — stated in multiple sources but not explicitly confirmed in official git docs for this specific behavior; the docs only state commit-msg can be bypassed. Recommend confirming with `git commit --no-verify` test.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new deps; all tools already used or built-in
- Architecture (CLI commands): HIGH — direct extension of established patterns
- Architecture (INTN-04 hook): HIGH — prepare-commit-msg + git interpret-trailers both official git features
- Architecture (watch): HIGH — setInterval + readline is standard Node/Bun pattern
- Architecture (OpenRPC spec): HIGH — spec.open-rpc.org is the official source
- Pitfalls: HIGH — session ID, signal handling, and the devDependency bug are concrete, traceable issues

**Research date:** 2026-03-25
**Valid until:** 2026-06-25 (stable libraries)
