# Pitfalls Research

**Domain:** Local daemon + CLI coordinating AI agents on shared code (developer tool / coordination protocol)
**Researched:** 2026-03-25
**Confidence:** HIGH (daemon/process pitfalls), HIGH (SQLite concurrency), MEDIUM (Tree-sitter WASM), MEDIUM (protocol versioning), HIGH (CLI UX)

---

## Critical Pitfalls

### Pitfall 1: Stale PID File Leaves Daemon Unlaunchable After Crash

**What goes wrong:**
The daemon writes a PID file (e.g., `.wit/daemon.pid`) on startup. If the daemon is killed with SIGKILL, OOM, or a hard power cycle, the shutdown handler never runs and the PID file remains. On next `wit daemon start`, the naive check finds a PID file, assumes the daemon is running, and refuses to start. The user has no coordination layer and no clear error.

**Why it happens:**
Developers write the happy path: write PID on start, delete on clean exit. They forget that `SIGKILL` cannot be caught — cleanup handlers never run.

**How to avoid:**
Stale-lock breaking logic must be the first thing daemon startup does:
1. If PID file exists, read the PID.
2. Send `kill -0 <PID>` (does nothing, just checks if process is alive).
3. If process is dead: delete PID file, log "recovered stale lock", proceed.
4. If process is alive: refuse with an actionable message ("daemon already running, PID X. Run `wit daemon stop` to stop it.").
Also write the PID atomically (write to `.wit/daemon.pid.tmp`, then rename) to prevent partial writes.

**Warning signs:**
- `wit status` hangs or errors but no daemon is in `ps aux`.
- Users report "daemon already running" after a reboot without running `wit daemon stop`.
- Any test suite that kills the daemon process with SIGKILL leaves test artifacts.

**Phase to address:** Phase 1 (Daemon foundation) — must be in the initial PID management implementation, not retrofitted.

---

### Pitfall 2: SQLite `SQLITE_BUSY` Under Concurrent Agent Writers

**What goes wrong:**
Multiple agents call `wit lock` or `wit declare` simultaneously. SQLite serializes all writers. Without WAL mode and a `busy_timeout`, the second writer immediately gets `SQLITE_BUSY` and the CLI exits with a cryptic database error, not a user-friendly lock-conflict message.

**Why it happens:**
Bun's `bun:sqlite` defaults to journal mode DELETE (not WAL). Under this mode, any write holds an exclusive lock on the entire database file. Two simultaneous CLI invocations — a realistic scenario with two agents — reliably trigger this.

**How to avoid:**
On database initialization, execute these pragmas before any other query:
```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA synchronous=NORMAL;
```
WAL allows concurrent readers alongside one writer, so read-heavy operations (status checks) never block. Set `busy_timeout` to at least 5000ms — this makes SQLite retry internally before returning `SQLITE_BUSY`. Additionally: never upgrade read transactions to write transactions mid-flight. If a transaction will write, open it with `BEGIN IMMEDIATE` so the write lock is acquired up front and you get a clean retry-or-fail rather than a mid-transaction contention error.

**Warning signs:**
- `SQLITE_BUSY` or "database is locked" errors in logs, even occasionally.
- Flaky behavior when two agents run concurrently in tests.
- WAL mode not confirmed in startup diagnostics.

**Phase to address:** Phase 1 (Storage layer) — must be in initial schema migrations, pragmas set before first use.

---

### Pitfall 3: Tree-sitter WASM Memory Not Freed, Heap Grows Unbounded

**What goes wrong:**
WASM operates outside the JS garbage collector. Every call to `parser.parse(sourceCode)` returns a `Tree` object allocated in WASM heap memory. If you don't call `tree.delete()` after use, the WASM heap grows with every parsed file and never shrinks — even if you null out the JS reference. On a long-running daemon parsing thousands of lock/unlock events, this becomes an OOM crash.

**Why it happens:**
JS developers expect GC to handle object lifetimes. The tree-sitter docs mention `tree.delete()` but it's easy to skip, especially in error paths. WASM's heap does not shrink when memory is freed — fragmentation also builds over time.

**How to avoid:**
Always use try/finally to guarantee tree cleanup:
```typescript
const tree = parser.parse(source);
try {
  // walk tree, extract symbols
} finally {
  tree.delete();
}
```
Also call `parser.delete()` when a Parser instance is no longer needed. Load WASM modules once at daemon startup and reuse the single `Parser` instance rather than creating new parsers per file. Pre-initialize the WASM module during daemon boot (not on first parse request) to avoid 100-500ms cold-parse latency on the first lock operation.

**Warning signs:**
- Daemon RSS memory climbs over hours and never stabilizes.
- `bun --smol` flag helps temporarily (forces more aggressive GC) but symptoms return.
- First `wit lock` call in a fresh session takes noticeably longer than subsequent calls.

**Phase to address:** Phase 2 (Semantic locking with Tree-sitter) — establish the `try/finally` pattern immediately when the parser wrapper is first written.

---

### Pitfall 4: WASM Grammar File Not Found at Runtime in Compiled Binary

**What goes wrong:**
`bun build --compile` embeds JavaScript but WASM binary assets need explicit embedding. `web-tree-sitter` calls `Parser.init()` with a path to `tree-sitter.wasm`. The default assumption is the WASM file is co-located with the JS. In the compiled binary, this path no longer exists — the daemon crashes at startup with "WASM file not found" after distribution.

**Why it happens:**
`bun build --compile` asset embedding was in beta through 2024-2025 and has documented issues with non-JS assets. The WASM path resolution differs between dev (relative path from source) and compiled binary (embedded or absolute path).

**How to avoid:**
Use `Bun.embeddedFiles` or `import.meta.dir` path resolution with an explicit fallback. Test the compiled binary on a clean machine (not the build machine) before any release — `bun build --compile produces a binary that only works on my machine` is a documented known issue. Alternatively, ship the WASM files alongside the binary in a known relative location rather than trying to embed them, and document that they must be present.

**Warning signs:**
- Works in `bun run` dev mode but fails after `bun build --compile`.
- Error references a path inside the compile cache or a non-existent path.
- WASM file path is hardcoded relative to `__dirname` rather than resolved at runtime.

**Phase to address:** Phase 2 (Semantic locking) — solve WASM bundling before integration tests, not at distribution time.

---

### Pitfall 5: Protocol Version Skew Between CLI and Daemon

**What goes wrong:**
A user installs a new `wit` CLI but the daemon is still running from the previous version (or vice versa). The CLI sends a request with a field that doesn't exist in the old protocol, or the daemon sends a response the CLI can't parse. This produces silent wrong behavior or a confusing crash — not a clear "please restart your daemon."

**Why it happens:**
Docker, CRC, and other daemon-CLI tools have all hit this. The daemon process is long-running; users update packages without restarting the daemon. Without an explicit version handshake on every connection, the two sides drift.

**How to avoid:**
Embed a `protocolVersion` field in every request/response from day one. On connection, the CLI sends `{"protocolVersion": "1.0.0"}` and the daemon responds with its own version. If they are incompatible (major version differs), the daemon returns a structured error: `{"error": {"code": "VERSION_MISMATCH", "message": "CLI version 1.0.0 requires daemon >= 1.0.0. Run: wit daemon restart"}}`. Never fail silently on unknown fields — follow the LSP principle: ignore unknown fields for forward compatibility. Bump `protocolVersion` only on breaking changes.

**Warning signs:**
- TypeScript type errors in request/response shapes after a protocol change.
- Any field rename or removal without a version bump.
- Tests that mock the HTTP layer without verifying version headers.

**Phase to address:** Phase 1 (Protocol design) — the version handshake must be in the first working request/response, not added later when the first version skew bug occurs in the wild.

---

### Pitfall 6: Daemon Becomes a False Dependency — Kills Adoption

**What goes wrong:**
Every `wit` subcommand requires the daemon to be running. A developer clones a new repo, runs `wit status` out of curiosity, gets `Error: daemon not running`. They do not read the error message, conclude the tool is broken, and never return. Wit sits in a critical path between agents and the repo — if it's annoying to start, agents will route around it.

**Why it happens:**
Tools that require a running service often make every command fail hard if the service is absent. This is the path of least resistance to implement. But developer tools that interrupt the flow are abandoned.

**How to avoid:**
Make the daemon auto-start on first use: if a CLI command requires the daemon and it's not running, start it in the background automatically and surface a single informational line: `[wit] starting daemon...`. Use a socket/PID check with a short timeout before declaring the daemon absent. Commands that don't need coordination state (`wit version`, `wit help`) must never require the daemon.

**Warning signs:**
- Any command that errors if the daemon isn't running without attempting auto-start.
- `wit init` requires manual `wit daemon start` after it.
- Demo scripts that list "step 1: start daemon" as a separate prerequisite.

**Phase to address:** Phase 1 (CLI scaffolding) — daemon auto-start must be in the first CLI implementation.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip WAL/busy_timeout on SQLite init | Simpler initial setup | `SQLITE_BUSY` under any concurrent load | Never — add pragmas on first schema migration |
| Skip tree.delete() in WASM code | Less boilerplate | Unbounded heap growth, daemon OOM over hours | Never — use try/finally wrapper from day one |
| Hardcode protocol version as a constant instead of a handshake | Faster first implementation | Silent version skew bugs after any update | Only in internal-only tests, never in real daemon connections |
| Single flat `.wit/state.db` for all data | Simple to start | Harder to shard, migrate, or reason about contention hotspots | Acceptable for v1 single-machine scope |
| Use HTTP/localhost instead of Unix socket | Works everywhere including Windows | ~2-3x higher latency per call vs Unix socket | Acceptable for v1 if Windows support is needed |
| Skip `BEGIN IMMEDIATE` and use auto-commit per statement | Simpler queries | Race conditions between write-check and write-execute | Never for multi-step read-then-write operations |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `bun:sqlite` | Not setting WAL mode — defaults to DELETE journal mode | Execute `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` before first query |
| `web-tree-sitter` | Calling `Parser.init()` on every parse request — re-initializes WASM each time | Initialize once at daemon startup, reuse the single `Parser` instance |
| `bun build --compile` | Assuming WASM assets are bundled automatically like JS | Explicitly handle WASM file paths; test compiled binary on a clean machine |
| Unix socket | Leaving socket file behind after crash — `EADDRINUSE` on next start | Check/remove stale socket file at startup, same as PID file recovery |
| git hooks (future) | Synchronous hook that blocks commit waiting for daemon response | Never block a git operation on Wit — hooks must fire-and-forget or async |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Parsing full file AST on every lock/unlock call | Noticeable latency spike on `wit lock` for large files | Parse once per file change, cache parsed tree keyed by file path + mtime | Files > ~5,000 lines of TypeScript |
| Dependency graph traversal with N+1 queries | `wit status` slows linearly as number of intents/locks grows | Pre-compute edges in SQLite, use JOINs not N queries | > ~50 active intents/locks |
| WASM module loaded multiple times (multiple `Parser.init()` calls) | Each CLI invocation cold-starts the WASM module | WASM lives in the daemon, CLI is a thin HTTP/socket client | Any CLI-per-agent workflow |
| Synchronous WASM parse blocking daemon event loop | Daemon becomes unresponsive during large file parse | Parse in a Bun Worker thread, return result async | Files > ~10,000 lines |
| SQLite checkpoint starvation under long-running reads | WAL file grows unboundedly, disk space fills | Set `PRAGMA wal_autocheckpoint=1000`; use short read transactions | Sustained high-read + high-write load |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Daemon listens on `0.0.0.0` instead of `127.0.0.1` | Any process on the network can acquire locks, forge intents | Bind exclusively to localhost or a Unix socket; document this constraint |
| No agent identity validation | Any process can claim to be any agent, hijack or release another agent's locks | Generate a per-session token on `wit init`, require it in all API calls |
| SQLite file world-readable | Any local user can read all intent and lock state including code structure | Create `.wit/` with mode 0700, `state.db` with mode 0600 |
| Accepting arbitrary shell commands through intent descriptions | Intent descriptions stored in SQLite; if ever rendered/executed, injection risk | Treat all agent-supplied strings as untrusted data; never eval or shell-interpolate them |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Blocking errors when daemon is not running | Developers get confused error, abandon tool | Auto-start daemon silently on first command that needs it |
| Lock conflicts that block with no explanation | Agent workflow halts; developer doesn't know what is locked or by whom | Conflict messages must name: which symbol, which agent holds the lock, when it was acquired |
| `wit lock` requires knowing the exact symbol name | Agents must parse their own code to lock correctly — fragile | Accept file:line as input and resolve to containing symbol automatically |
| Long-running `wit status` with no progress indicator | Feels frozen on larger repos | Stream output or show "scanning..." indicator; never block > 500ms |
| Protocol errors shown as raw JSON | Confusing to humans using CLI directly | CLI layer must unwrap `{"error": {...}}` into readable messages |
| Silent success on ambiguous operations | Agent doesn't know if lock was acquired or just warned | Always return structured `{acquired: true, warnings: [...]}` not just HTTP 200 |

---

## "Looks Done But Isn't" Checklist

- [ ] **Daemon startup:** Handles stale PID file recovery — verify by killing daemon with SIGKILL and restarting.
- [ ] **SQLite init:** WAL mode and busy_timeout confirmed — verify with `PRAGMA journal_mode;` returning `wal`.
- [ ] **Tree-sitter:** All `tree.delete()` calls present, including in error paths — verify no WASM memory growth over 100 parse cycles.
- [ ] **Compiled binary:** WASM assets resolve correctly — verify on a machine that has never run `bun` or has the tree-sitter WASM cached.
- [ ] **Protocol versioning:** `protocolVersion` in every request/response — verify that CLI v1.0.0 connecting to daemon v2.0.0 returns a readable `VERSION_MISMATCH` error.
- [ ] **Unix socket cleanup:** Stale socket file removed on daemon start — verify by killing daemon, then starting again without manual cleanup.
- [ ] **Auto-start:** `wit status` on a fresh repo with no running daemon auto-starts the daemon — verify with `killall wit-daemon && wit status`.
- [ ] **Conflict messages:** Lock conflict errors name the blocking agent and symbol — verify with two concurrent agents requesting the same symbol.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Stale PID file + no auto-recovery | LOW | Delete `.wit/daemon.pid` and `.wit/daemon.sock` manually, then restart |
| SQLITE_BUSY cascade after not setting WAL | HIGH (requires migration) | Add WAL pragma in a schema migration; existing databases require explicit `PRAGMA journal_mode=WAL` run once |
| WASM heap OOM from missing tree.delete() | MEDIUM | Restart daemon (clears WASM heap); then audit all parse call sites for missing `.delete()` |
| Protocol version skew crash | LOW | `wit daemon restart` resolves most cases; document this as first step in troubleshooting |
| Compiled binary WASM path failure | MEDIUM | Ship WASM alongside binary as a known-path asset; rebuild distribution packaging |
| Corrupt SQLite (power loss mid-write) | LOW | WAL mode provides atomic commits; WAL journal file is replayed on next open automatically |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Stale PID file | Phase 1 (Daemon foundation) | Kill daemon with SIGKILL, verify clean restart |
| SQLite SQLITE_BUSY | Phase 1 (Storage layer) | Two simultaneous `wit lock` calls, no errors |
| WASM memory leak | Phase 2 (Semantic locking) | Parse 1,000 files, measure RSS before and after |
| WASM asset in compiled binary | Phase 2 (Semantic locking) | Run compiled binary on CI machine that has never built the project |
| Protocol version skew | Phase 1 (Protocol design) | Verify version mismatch returns structured error |
| Daemon as false dependency | Phase 1 (CLI scaffolding) | Run `wit status` with no daemon, verify auto-start |
| Conflict messages lacking detail | Phase 2 (Semantic locking) | Verify conflict response includes agent ID, symbol, timestamp |
| SQLite checkpoint starvation | Phase 1 (Storage layer) | Verify `wal_autocheckpoint` pragma set; check WAL file size under load |

---

## Sources

- [SQLite WAL mode official documentation](https://www.sqlite.org/wal.html) — WAL concurrency model, SQLITE_BUSY cases
- [SQLite concurrent writes and "database is locked" errors](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) — SQLITE_BUSY analysis and BEGIN IMMEDIATE pattern
- [Abusing SQLite to Handle Concurrency — SkyPilot](https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/) — multi-process WAL patterns
- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite) — bun:sqlite API, synchronous nature
- [Modern Tree-sitter, part 7: the pain points and the promise — Pulsar Edit blog](https://blog.pulsar-edit.dev/posts/20240902-savetheclocktower-modern-tree-sitter-part-7/) — WASM memory management, explicit delete requirement, Emscripten versioning
- [web-tree-sitter WASM initialization issues — GitHub](https://github.com/tree-sitter/tree-sitter/issues/1580) — async loading patterns
- [bun build --compile only works on my machine — GitHub Issue](https://github.com/oven-sh/bun/issues/24470) — WASM asset embedding limitation
- [Docker API version conflict (Docker Engine v29.0) — Frank's Home Page](https://frank.seesink.com/blog/docker-api-version-issues/) — real-world daemon version skew consequences
- [The Silent Breakage: Versioning for Production-Ready MCP Tools](https://medium.com/@minherz/the-silent-breakage-a-versioning-strategy-for-production-ready-mcp-tools-fbb998e3f71f) — protocol immutability at version boundaries
- [pid — GitHub (trbs/pid)](https://github.com/trbs/pid) — stale PID detection patterns
- [What to do about SQLITE_BUSY despite setting a timeout](https://berthug.eu/articles/posts/a-brief-post-on-sqlite3-database-locked-despite-timeout/) — BEGIN IMMEDIATE pattern for avoiding mid-transaction contention
- [Node.js Unix Domain Sockets — 50% lower latency than TCP loopback](https://nodevibe.substack.com/p/the-nodejs-developers-guide-to-unix) — latency benchmarks, IPC pitfalls
- [Bun node:net Socket compatibility](https://bun.com/reference/node/net/Socket) — Windows named pipes vs Unix socket behavior
- [UX patterns for CLI tools](https://lucasfcosta.com/2022/06/01/ux-patterns-cli-tools.html) — developer tool UX principles
- [The Multi-Agent Trap — Towards Data Science](https://towardsdatascience.com/the-multi-agent-trap/) — multi-agent coordination failure modes

---
*Pitfalls research for: Wit — local daemon + CLI coordinating AI agents on shared code*
*Researched: 2026-03-25*
