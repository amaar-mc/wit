# Architecture Research

**Domain:** Local developer tool daemon with multi-agent coordination protocol
**Researched:** 2026-03-25
**Confidence:** HIGH (core patterns from LSP spec, SQLite docs, Bun docs, Watchman source)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Client Layer                               │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  wit CLI     │  │ Agent HTTP   │  │ Agent JSON-RPC       │   │
│  │ (Bun binary) │  │ client       │  │ client               │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
└─────────┼─────────────────┼─────────────────────┼───────────────┘
          │ HTTP/JSON-RPC   │ HTTP/JSON-RPC        │ JSON-RPC
          │ over Unix sock  │ over Unix sock       │ or localhost
┌─────────▼─────────────────▼─────────────────────▼───────────────┐
│                        Daemon Process                             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Transport Layer                          │   │
│  │   Unix socket server (Bun.serve unix:)  + HTTP router    │   │
│  │   JSON-RPC 2.0 dispatcher                                │   │
│  └────────────────────────────┬─────────────────────────────┘   │
│                               │                                  │
│  ┌────────────────────────────▼─────────────────────────────┐   │
│  │                  Coordination Engine                      │   │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│  │   │ Intent       │  │ Lock         │  │ Contract     │   │   │
│  │   │ Registry     │  │ Manager      │  │ Registry     │   │   │
│  │   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │   │
│  │          │                 │                  │           │   │
│  │   ┌──────▼─────────────────▼──────────────────▼───────┐   │   │
│  │   │              Conflict Detector                     │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │   │
│                                                               │   │
│  ┌──────────────────────────────────────────────────────┐   │   │
│  │                  AST / Symbol Layer                   │   │   │
│  │   web-tree-sitter WASM (singleton, lazy-loaded)       │   │   │
│  │   Language registry: TypeScript/JS + Python grammars  │   │   │
│  │   Symbol resolver: function/type/export extraction    │   │   │
│  └──────────────────────────────────────────────────────┘   │   │
│                                                               │   │
│  ┌──────────────────────────────────────────────────────┐   │   │
│  │                  Persistence Layer                    │   │   │
│  │   bun:sqlite  ·  WAL mode  ·  single connection       │   │   │
│  │   .wit/state.db  +  -wal  +  -shm                     │   │   │
│  └──────────────────────────────────────────────────────┘   │   │
└──────────────────────────────────────────────────────────────────┘

         .wit/
         ├── state.db          # SQLite main file
         ├── state.db-wal      # WAL sidecar (transient)
         ├── state.db-shm      # Shared memory index (transient)
         ├── daemon.pid        # PID file (daemon running check)
         └── daemon.sock       # Unix domain socket
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|---------------|------------------------|
| **CLI entry** | Parse argv, detect if daemon is running, proxy request to daemon or start it, format response for humans | Bun binary; `wit <cmd>` → HTTP POST to daemon.sock |
| **Transport layer** | Accept connections, parse JSON-RPC envelopes, route to correct handler, serialize responses | `Bun.serve({ unix: daemonSockPath })` with HTTP fetch on the client side |
| **JSON-RPC dispatcher** | Match method strings to handlers, enforce request/notification ordering, return errors in spec format | Thin router map; no framework needed at this scale |
| **Intent registry** | Store, query, and retire agent intents; broadcast intent-changed events to connected clients | Pure domain logic over SQLite `intents` table |
| **Lock manager** | Acquire, release, and query semantic locks on symbol keys (file:line:name); enforce single-holder per symbol | SQLite transactions for atomic lock acquire/release |
| **Contract registry** | Store propose/accept/reject state machines for interface contracts between agent pairs | SQLite `contracts` table with status column |
| **Conflict detector** | Given a new intent or lock request, query all active intents + locks + dependency edges; return conflict set | Read-only query layer composed over registry APIs |
| **AST / symbol layer** | Parse source files on demand using web-tree-sitter WASM; extract symbol keys; cache parsed results | Singleton Parser, per-language grammar instances, in-memory parse-tree cache keyed by `file:mtime` |
| **Persistence layer** | ACID storage for all coordination state; survives daemon restart; single writer, multiple readers | `bun:sqlite`, WAL mode, single long-lived `Database` instance owned by daemon |
| **Daemon lifecycle** | PID file write/check, Unix socket bind, signal handling (SIGTERM/SIGINT graceful shutdown), port cleanup | Process-level code in `daemon/index.ts` |

## Recommended Project Structure

```
src/
├── daemon/
│   ├── index.ts          # Entry point: start server, write PID, register signals
│   ├── lifecycle.ts      # PID file, socket cleanup, graceful shutdown logic
│   └── server.ts         # Bun.serve unix socket, fetch handler, health endpoint
├── protocol/
│   ├── dispatcher.ts     # JSON-RPC 2.0 method router
│   ├── methods.ts        # All method name constants (single source of truth)
│   └── types.ts          # TypeScript types for every request/response shape
├── coordination/
│   ├── intents.ts        # Intent CRUD + active query
│   ├── locks.ts          # Lock acquire/release/query + dependency edges
│   ├── contracts.ts      # Contract propose/accept/reject state machine
│   └── conflicts.ts      # Conflict detection logic (composes intents + locks)
├── ast/
│   ├── parser.ts         # web-tree-sitter init, singleton, grammar loader
│   ├── symbols.ts        # Symbol extraction queries (TS/JS, Python)
│   └── cache.ts          # In-memory parse-tree cache (file → {mtime, tree})
├── db/
│   ├── connection.ts     # Single Database instance, WAL + busy_timeout pragmas
│   ├── migrations.ts     # Schema versioning and migration runner
│   └── schema.ts         # CREATE TABLE statements as typed constants
└── cli/
    ├── index.ts          # Bun binary entry: argv parsing, daemon start if needed
    ├── client.ts         # HTTP client pointing at daemon.sock
    └── format.ts         # Human-readable formatting of daemon responses
```

### Structure Rationale

- **daemon/ vs cli/:** These are separate entry points with different lifecycles. The daemon is a long-running server process; the CLI is a short-lived request proxy. Mixing them is the most common structural mistake.
- **protocol/:** Transport-agnostic. The dispatcher doesn't know if the request came from a Unix socket, localhost HTTP, or a test harness. This makes the protocol testable without a real server.
- **coordination/:** Each subdomain (intents, locks, contracts, conflicts) is a distinct module with no cross-imports except `conflicts.ts`, which explicitly composes the others. This boundary is enforced — locks don't import intents.
- **ast/:** Isolated because WASM initialization is async and error-prone. The singleton pattern here means the parser fails loudly at startup rather than silently during a request.
- **db/:** One connection file, one migration runner. Nothing else imports from `bun:sqlite` directly.

## Architectural Patterns

### Pattern 1: Daemon-as-Single-Source-of-Truth

**What:** The daemon owns all coordination state. CLI and agent clients are stateless — they make requests and get responses. No client caches coordination state.

**When to use:** Always. Any client-side caching of lock state breaks the invariant that the daemon is authoritative.

**Trade-offs:** Slightly higher latency per CLI call (a round-trip to the Unix socket) vs. the guarantee that two concurrent agents can never see stale lock state.

**Example:**
```typescript
// cli/client.ts — the CLI is just an HTTP client
export async function daemonRequest(method: string, params: unknown): Promise<unknown> {
  const response = await fetch(`http://localhost/rpc`, {
    unix: DAEMON_SOCK_PATH,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: crypto.randomUUID() }),
  });
  const body = await response.json();
  if (body.error) throw new DaemonError(body.error.code, body.error.message);
  return body.result;
}
```

### Pattern 2: Single-Writer SQLite with Serialized Mutations

**What:** All writes to SQLite go through a single async queue. Reads happen concurrently on separate connections (WAL mode allows this). The single writer is the daemon process itself — agents never touch the database directly.

**When to use:** Any time multiple concurrent callers (agents) could issue conflicting writes. SQLite's single-writer constraint is not a limitation here — it enforces the right architecture.

**Trade-offs:** Write throughput is bounded by the serial queue, but at the scale of a local developer tool (tens of operations per second peak), this is irrelevant. The benefit is zero write-lock contention bugs.

**Key pragmas (set once at connection open):**
```typescript
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA busy_timeout = 5000");   // wait up to 5s instead of erroring immediately
db.run("PRAGMA synchronous = NORMAL");  // safe with WAL, faster than FULL
db.run("PRAGMA foreign_keys = ON");
```

### Pattern 3: Lazy WASM Grammar Singleton

**What:** The web-tree-sitter WASM binary and all grammar `.wasm` files are loaded once at daemon startup. Parser instances are reused. File parse results are cached in memory keyed by `${filePath}:${mtime}`.

**When to use:** Any server-side usage of web-tree-sitter. The WASM JIT compilation on Node/Bun is expensive (~100ms per language load). Reloading per-request would make semantic locking unusably slow.

**Trade-offs:** Memory cost of holding parsed trees (~1-2MB per open file) vs. re-parsing on every lock request. Cache invalidation on file change is handled by comparing `mtime`.

```typescript
// ast/parser.ts
let initialized = false;
const grammars: Map<string, Parser.Language> = new Map();
const parseCache: Map<string, { mtime: number; tree: Parser.Tree }> = new Map();

export async function initParser(): Promise<void> {
  if (initialized) return;
  await Parser.init({ locateFile: (name) => path.join(WASM_DIR, name) });
  grammars.set("typescript", await Parser.Language.load(path.join(WASM_DIR, "tree-sitter-typescript.wasm")));
  grammars.set("javascript", await Parser.Language.load(path.join(WASM_DIR, "tree-sitter-javascript.wasm")));
  grammars.set("python",     await Parser.Language.load(path.join(WASM_DIR, "tree-sitter-python.wasm")));
  initialized = true;
}
```

### Pattern 4: Daemon Lifecycle with PID Guard

**What:** On startup, write a PID file. On any subsequent start attempt, check the PID file and whether that process is still alive. Clean up the socket file on exit. The CLI checks the PID file to decide whether to start the daemon or just proxy to it.

**When to use:** Always for local daemons. Without this, two daemon instances can bind conflicting sockets, leaving coordination state split between them.

**Trade-offs:** Small startup overhead for the PID check vs. guarantee of a single daemon instance per repo.

```typescript
// daemon/lifecycle.ts
export async function acquireDaemonLock(witDir: string): Promise<void> {
  const pidPath = path.join(witDir, "daemon.pid");
  const existing = await readPidFile(pidPath);
  if (existing !== null && isProcessAlive(existing)) {
    throw new Error(`Daemon already running (PID ${existing}). Use 'wit stop' to stop it.`);
  }
  await Bun.write(pidPath, String(process.pid));
  process.on("SIGTERM", () => cleanup(witDir));
  process.on("SIGINT",  () => cleanup(witDir));
}

async function cleanup(witDir: string): Promise<void> {
  await unlink(path.join(witDir, "daemon.pid")).catch(() => {});
  await unlink(path.join(witDir, "daemon.sock")).catch(() => {});
  process.exit(0);
}
```

## Data Flow

### Lock Acquire Request Flow

```
Agent (CLI or HTTP client)
    │
    │  POST / HTTP/1.1  {jsonrpc:"2.0", method:"lock.acquire", params:{file, symbol}}
    ▼
Bun.serve fetch handler (daemon/server.ts)
    │
    │  parse JSON body
    ▼
JSON-RPC dispatcher (protocol/dispatcher.ts)
    │
    │  method → "lock.acquire" → locks.acquire handler
    ▼
AST / Symbol layer (ast/symbols.ts)
    │
    │  resolve symbol key: parse file with Tree-sitter,
    │  extract {file, startLine, endLine, name, kind}
    ▼
Lock manager (coordination/locks.ts)
    │
    │  BEGIN IMMEDIATE transaction
    │  INSERT INTO locks WHERE NOT EXISTS conflicting row
    │  COMMIT or ROLLBACK
    ▼
Conflict detector (coordination/conflicts.ts)
    │
    │  query dependency edges for callers of locked symbol
    │  generate warning list (non-blocking for v1)
    ▼
Response builder (protocol/dispatcher.ts)
    │
    │  {result: {lockId, warnings: [...]}}
    ▼
Agent receives response
```

### Intent Declaration Flow

```
Agent declares intent
    │
    │  {method:"intent.declare", params:{description, files, symbols}}
    ▼
Intent registry (coordination/intents.ts)
    │
    │  INSERT INTO intents (agentId, description, files, symbols, createdAt)
    ▼
Conflict detector
    │
    │  SELECT all active intents overlapping same files/symbols
    │  return overlapping intents as conflicts (non-blocking)
    ▼
Agent gets {intentId, conflicts: [...]}
```

### CLI Proxy Flow

```
wit lock src/api.ts --symbol "handleRequest"
    │
    │  cli/index.ts: check .wit/daemon.pid — daemon alive?
    │  NO → spawn daemon background process, wait for socket ready
    │  YES → proceed
    ▼
cli/client.ts: daemonRequest("lock.acquire", {file, symbol})
    │
    │  HTTP POST to unix:.wit/daemon.sock
    ▼
[same as Lock Acquire flow above]
    │
    ▼
cli/format.ts: print human-readable result
```

### Daemon Startup Sequence

```
1. Parse argv for --repo-root (defaults to cwd git root)
2. Ensure .wit/ directory exists
3. acquireDaemonLock() — write PID, check for stale instance
4. db/connection.ts: open SQLite, apply WAL pragmas, run migrations
5. ast/parser.ts: initParser() — load WASM + all three grammars
6. Bun.serve({ unix: daemonSockPath, fetch: rpcHandler })
7. Write ready signal to stdout (CLI start waits for this)
8. Event loop runs; handle requests until SIGTERM
9. On SIGTERM: wal_checkpoint(TRUNCATE), db.close(), cleanup PID + sock
```

## Scaling Considerations

This is a local single-machine tool, so "scaling" means concurrent agents on one repo, not distributed load.

| Scale | Architecture Concern |
|-------|----------------------|
| 2-5 agents | Default design handles this. SQLite WAL + busy_timeout is fine. |
| 10-20 agents | Watch SQLite write queue depth. If `busy_timeout` hits frequently, batch lock operations into single transactions. |
| 50+ agents | At this point you have a different problem. WASM parse cache memory grows with open files; cap it with LRU eviction (100-file cap is reasonable). |

### Scaling Priorities

1. **First bottleneck:** WASM parse latency on first request per file. Mitigate by pre-parsing on daemon startup for known project entry points, or warming cache on `wit init`.
2. **Second bottleneck:** SQLite write serialization under many concurrent agents. Mitigate by batching writes from the dispatcher before committing (collect 10ms of writes → single transaction).

## Anti-Patterns

### Anti-Pattern 1: One Process Does Everything

**What people do:** Make the CLI binary also contain the daemon — when you run `wit lock`, it both starts the daemon inline AND services the request in the same process.

**Why it's wrong:** The daemon must persist between CLI calls. If the CLI is the daemon, every invocation starts fresh with no shared state. You lose coordination entirely.

**Do this instead:** CLI checks for a running daemon via PID file and proxies to it. Daemon is a separate `wit daemon --start` command (or auto-spawned by the CLI if absent).

### Anti-Pattern 2: File-Level Lock Keys

**What people do:** Use file paths as lock identifiers because they're simple. `LOCK: src/api.ts`.

**Why it's wrong:** Files contain many symbols. Two agents working on different functions in the same file would conflict unnecessarily. This produces the false-positive rate that kills adoption.

**Do this instead:** Lock keys are `{file, symbolName, symbolKind, startLine}`. Two agents can safely modify different functions in the same file simultaneously. Tree-sitter extraction makes this possible.

### Anti-Pattern 3: Blocking on Transitive Dependency Locks

**What people do:** When agent B tries to lock `callSite()` which calls a function already locked by agent A, block agent B.

**Why it's wrong:** Transitive blocking produces cascading false positives. In a real codebase, a utility function is called from dozens of places. Lock the utility and you block the whole project.

**Do this instead:** Warn agent B that it is touching a caller of a locked symbol. Let agent B decide whether to proceed. This is exactly what Wit v1 specifies — warn, don't block.

### Anti-Pattern 4: Reloading WASM Per Request

**What people do:** Call `Parser.init()` and `Language.load()` inside each request handler because it's simpler.

**Why it's wrong:** WASM module JIT compilation takes 50-200ms per language on Bun. A lock request that also triggers a parse would take 300ms+ just for initialization. Unusable.

**Do this instead:** Initialize once at daemon startup in `initParser()`. Store grammar instances in a module-level Map. Never call `Parser.init()` more than once per process lifetime.

### Anti-Pattern 5: Multiple SQLite Connections for Writes

**What people do:** Open a new `Database` instance per request for isolation.

**Why it's wrong:** SQLite allows one writer at a time. Multiple write connections increase lock contention and break WAL checkpointing behavior. Even with `busy_timeout`, write serialization through multiple connections is less reliable than a single connection.

**Do this instead:** One `Database` instance owned by the daemon process, opened once and closed on SIGTERM. All reads and writes go through this connection. WAL mode gives you concurrent reader access without needing a separate read connection.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|--------------------|----|
| Git | Shell out to `git rev-parse --git-dir` for repo root detection; `git log` for commit-to-intent linking | Never use git internals directly; shell out only |
| File system | `Bun.file().text()` for reading source files into the AST layer | Watch `mtime` for cache invalidation; no inotify in v1 |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|--------------|-------|
| CLI ↔ Daemon | HTTP/JSON-RPC over Unix domain socket | CLI is a pure client; never imports daemon modules |
| Dispatcher ↔ Coordination | Direct function call (same process) | No queue needed — JavaScript event loop serializes handlers |
| Coordination ↔ DB | Synchronous bun:sqlite API | bun:sqlite is synchronous by design; no async overhead |
| Coordination ↔ AST | Async call to `resolveSymbol(file, symbolName)` | WASM parsing is async; await at the lock.acquire handler boundary |
| Lock Manager ↔ Intent Registry | No direct import; conflicts.ts reads both | Conflict detection is a read-only observer of both subsystems |

## Build Order Implications

The component dependency graph dictates this build order:

1. **db/** — Everything depends on storage. Get schema, migrations, and WAL setup correct before building anything that persists data.
2. **daemon/lifecycle.ts** — PID guard and socket binding. Proves the daemon can start and stop cleanly before any logic is added.
3. **protocol/** — Dispatcher and types. Proves the JSON-RPC wire format works end-to-end with stub handlers before real coordination logic exists.
4. **cli/** — The CLI client and format layer. Validates the full round-trip (CLI → Unix socket → dispatcher → response → formatted output) with stubs.
5. **ast/** — WASM init, grammar loading, symbol extraction. Isolated enough to develop and test separately; needed before real lock keys can be computed.
6. **coordination/intents.ts** — Simplest coordination primitive; no dependencies on AST layer.
7. **coordination/locks.ts** — Depends on AST layer for symbol resolution. Build after ast/ is working.
8. **coordination/contracts.ts** — Independent of locks; can be built in parallel with locks.
9. **coordination/conflicts.ts** — Composes intents + locks; build last in the coordination layer.

## Sources

- [Language Server Protocol Specification 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) — Lifecycle, transport, JSON-RPC patterns (HIGH confidence)
- [SQLite WAL Mode documentation](https://www.sqlite.org/wal.html) — WAL behavior, checkpoint management (HIGH confidence)
- [web-tree-sitter binding README](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md) — WASM init pattern, grammar loading, Node.js performance caveats (HIGH confidence)
- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite) — WAL pragmas, cleanup pattern (HIGH confidence)
- [Bun.serve Unix socket support](https://bun.com/docs/runtime/http/server) — Unix domain socket server pattern (HIGH confidence)
- [Bun OS signal handling](https://bun.sh/guides/process/os-signals) — SIGTERM/SIGINT patterns (HIGH confidence)
- [Facebook Watchman daemon](https://facebook.github.io/watchman/) — Daemon architecture reference: client-server, Unix socket, clock-based state (MEDIUM confidence)
- [SQLite concurrency — SkyPilot blog](https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/) — busy_timeout patterns in practice (MEDIUM confidence)
- [tower-lsp concurrency discussion](https://github.com/ebkalderon/tower-lsp/issues/284) — LSP request concurrency model tradeoffs (MEDIUM confidence)
- [Git concurrency in GitHub Desktop](https://github.blog/2015-10-20-git-concurrency-in-github-desktop/) — Lock file semantics reference (MEDIUM confidence)

---
*Architecture research for: local daemon + CLI + agent coordination protocol (Wit)*
*Researched: 2026-03-25*
