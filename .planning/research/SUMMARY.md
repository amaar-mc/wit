# Project Research Summary

**Project:** Wit — Agent Coordination Protocol
**Domain:** Local daemon + CLI + open protocol for AI agent coordination on shared codebases
**Researched:** 2026-03-25
**Confidence:** HIGH

## Executive Summary

Wit is a local developer daemon that gives AI agents a shared coordination layer before they write code. The problem it solves is novel but the building blocks are well-understood: it is a local lock manager (like Redis DLM, but code-aware), a local daemon with an HTTP+JSON-RPC API (like an LSP server), and a CLI thin-wrapper over that API (like the `git` CLI wrapping git internals). The key technical differentiation is semantic, symbol-level locking via Tree-sitter WASM — locking `src/auth.ts:validateToken`, not the file. This is the only approach that avoids the false-positive rate that killed Cursor's file-level locking experiment at scale.

The recommended stack is Bun + TypeScript + Hono (daemon HTTP server) + Drizzle ORM + `bun:sqlite` + web-tree-sitter WASM grammars + clipanion (CLI). Every choice optimizes for zero-install-friction — no native compilation, no extra binaries, `bun compile` produces a standalone distributable. The architecture is a strict client-server split: a long-running daemon process owns all coordination state in SQLite, and the CLI is a stateless HTTP client that proxies commands to the daemon over a Unix domain socket. This boundary must not blur.

The primary risks are all implementation pitfalls, not design unknowns. Stale PID file recovery, SQLite WAL mode setup, WASM memory cleanup (`tree.delete()`), and protocol version handshaking must all be addressed in Phase 1 before any coordination logic is written. The Cursor post-mortem validates the product direction: file-level locks at scale fail, optimistic concurrency fails, and explicit pre-write intent coordination is the right model for 2-10 agent teams. The main anti-feature to avoid is transitive lock blocking — warn callers, never block them.

## Key Findings

### Recommended Stack

The stack is fully determined. Bun is the runtime, package manager, bundler, and test runner — the unified toolchain eliminates configuration overhead and its native `bun:sqlite` and Unix socket support are first-class API requirements for this architecture. Hono provides the daemon's HTTP layer at minimum weight. Drizzle ORM with `bun:sqlite` handles the schema and migrations; Prisma is explicitly ruled out because its Rust engine binary breaks `bun compile` single-binary distribution.

The Tree-sitter integration uses WASM bindings only (`web-tree-sitter@0.24.7` pinned — the 0.25.x series has a TypeScript type regression). Native bindings are faster but require compilation and break the standalone binary constraint. clipanion v3.2.x handles the CLI command framework with compile-time type safety on argument shapes.

**Core technologies:**
- Bun 1.3.x: runtime + package manager + bundler — unified toolchain, native sqlite, unix socket support, standalone binary compilation
- Hono 4.x: daemon HTTP server — 14kb, native Bun support, correct abstraction level for an embedded local API
- Drizzle ORM 0.40.x + `bun:sqlite`: typed queries + migrations — pure TS, works in compiled binaries, 3-6x faster than `better-sqlite3`
- web-tree-sitter 0.24.7 + grammar WASM files: AST parsing — WASM avoids native compilation, zero install friction
- clipanion 3.2.x: CLI framework — type-safe command definitions, powers Yarn, zero runtime dependencies
- zod 3.x: runtime validation — validate all incoming JSON before it touches daemon state
- pino 9.x: structured daemon logging — fastest TS logger, NDJSON output

### Expected Features

The full feature dependency graph shows that the daemon process + SQLite is the prerequisite for everything. Intent declaration requires the daemon. Semantic locking requires intent declaration plus Tree-sitter. Conflict detection requires both. Interface contracts require intent declaration. The dependency-graph-based caller warnings are the key differentiator over flat lock managers and require Tree-sitter.

**Must have (table stakes) — v1:**
- Daemon process with SQLite persistence (WAL mode) — all shared state lives here
- Agent identity and session registration — required for lock attribution and release
- Intent declaration and query — pre-write announcement is the core value inversion over git
- Semantic locking (TS/JS + Python) via Tree-sitter WASM — function/type granularity, not file granularity
- Conflict detection (intent + lock intersection + dependency warnings) — the product's reason for existence
- Lock TTL and dead lock cleanup — correctness requirement; crashed agents must not poison state
- HTTP API (JSON-RPC over Unix socket) — agent-programmatic access
- CLI (`wit init`, `wit status`, `wit declare`, `wit lock`, `wit release`) — human access and demo-ability
- Interface contracts (propose/accept/reject) — agent-to-agent interface agreement before coding

**Should have (differentiators) — v1.x after validation:**
- Intent-to-commit git linkage — audit trail connecting declared intent to actual commit
- Open protocol spec document (markdown + JSON Schema) — enables third-party agent adoption
- `wit watch` — CLI polling loop for live coordination state monitoring

**Defer (v2+):**
- Remote/multi-machine coordination — requires distributed consensus; Raft/Paxos is not a v1 problem
- Additional language grammars beyond TS/JS and Python — extensible architecture, community-contributed
- Push notifications (SSE/WebSocket) — polling at 1Hz is sufficient; push adds stateful connection management
- Counter-proposal contract negotiation — propose/accept/reject is sufficient; counter-proposals if evidence demands
- CI/CD integration — local daemon model must be proven first

### Architecture Approach

The architecture is a strict two-process model: a long-running daemon that owns all state and a stateless CLI client that proxies to it. The daemon exposes a Unix domain socket with plain HTTP (not raw WebSockets or binary protocol) serving JSON-RPC-style endpoints. Inside the daemon, there are four distinct layers: Transport (Bun.serve unix socket + Hono), Coordination Engine (Intent Registry, Lock Manager, Contract Registry, Conflict Detector), AST/Symbol Layer (singleton web-tree-sitter instance with mtime-keyed parse cache), and Persistence (single `bun:sqlite` connection in WAL mode). The build order is dictated by dependency: db layer first, then daemon lifecycle, then protocol/transport, then CLI, then AST, then coordination modules in order of complexity.

**Major components:**
1. Daemon process (daemon/) — owns lifecycle, Unix socket binding, PID file, signal handling
2. Transport + dispatcher (protocol/) — Bun.serve + Hono HTTP routing, JSON-RPC method dispatch, transport-agnostic handlers
3. Coordination engine (coordination/) — Intent Registry, Lock Manager, Contract Registry, Conflict Detector; strict module boundaries with no cross-imports except conflicts.ts
4. AST/Symbol layer (ast/) — singleton Parser, lazy-initialized WASM grammars, mtime-keyed parse-tree cache
5. Persistence layer (db/) — single Database instance, WAL pragmas, Drizzle schema + migrations
6. CLI entry (cli/) — argv parsing, PID check + daemon auto-start, Unix socket HTTP client, human-readable output formatting

### Critical Pitfalls

1. **Stale PID file blocks restart after crash** — SIGKILL cannot be caught; always check `kill -0 <PID>` on startup and recover silently if the process is dead. Write PID atomically with a tmp-then-rename pattern. Must be in Phase 1.

2. **SQLite `SQLITE_BUSY` under concurrent agents** — `bun:sqlite` defaults to DELETE journal mode. Set `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`, `PRAGMA synchronous=NORMAL` before the first query. Use `BEGIN IMMEDIATE` for all read-then-write operations. Must be in Phase 1.

3. **WASM heap grows unbounded if `tree.delete()` is skipped** — WASM memory is outside the JS GC. Every `parser.parse()` call must be wrapped in `try/finally { tree.delete() }`. Initialize parser once at daemon startup, never per-request. Must be in Phase 2 when the parser wrapper is first written.

4. **Compiled binary fails to find WASM assets** — `bun build --compile` does not automatically embed WASM files. Resolve WASM paths via `import.meta.url` at runtime; test the compiled binary on a clean machine before any release. Must be addressed in Phase 2.

5. **Protocol version skew between CLI and daemon** — embed `protocolVersion` in every request/response from day one. Return a structured `VERSION_MISMATCH` error (never fail silently) when major versions differ. Must be in Phase 1.

## Implications for Roadmap

Based on the component dependency graph and the pitfall-to-phase mapping from research, a 4-phase structure is strongly implied.

### Phase 1: Foundation — Daemon, Storage, Transport, CLI Skeleton

**Rationale:** Everything downstream requires the daemon process, SQLite schema, JSON-RPC transport, and CLI entry point to exist. The pitfall research explicitly tags stale PID recovery, SQLite WAL setup, protocol versioning, and daemon auto-start as Phase 1 requirements — these cannot be retrofitted. The architecture's build order confirms this ordering: db → lifecycle → protocol → CLI.

**Delivers:** A running daemon that accepts JSON-RPC requests over a Unix socket, persists to SQLite, and has a CLI that auto-starts the daemon and proxies commands. No coordination logic yet — just the skeleton that all logic plugs into.

**Addresses:** Daemon process with SQLite persistence, agent identity/session registration, HTTP API, CLI skeleton (`wit init`, `wit status`, `wit version`)

**Avoids:** Stale PID file crash (Pitfall 1), SQLite BUSY errors (Pitfall 2), protocol version skew (Pitfall 5), daemon-as-false-dependency UX failure (Pitfall 6)

### Phase 2: Semantic Locking — Tree-sitter Integration + Lock Manager

**Rationale:** Semantic locking is the highest-complexity P1 feature and the technical foundation for conflict detection. It must be built and validated in isolation before conflict detection is layered on top. WASM asset embedding and memory management pitfalls (Pitfalls 3 and 4) belong here and must be solved before integration tests.

**Delivers:** Agents can lock symbols (not files) using Tree-sitter AST parsing for TS/JS and Python. Lock TTL and dead lock cleanup are included here — they are correctness requirements for the lock primitive, not optional.

**Uses:** web-tree-sitter 0.24.7, tree-sitter-typescript, tree-sitter-python, ast/ module with singleton parser + mtime cache

**Implements:** AST/Symbol layer, Lock Manager

**Avoids:** WASM memory leak (Pitfall 3), compiled binary WASM path failure (Pitfall 4)

### Phase 3: Coordination — Intent Declaration, Conflict Detection, Dependency Graph

**Rationale:** Intent declaration is simpler than locking (no AST dependency) but conflict detection requires both intents and locks to be present. The dependency graph (call edges) is required for the caller-warning differentiator. These three components form a logical unit: they only deliver value together. Contracts can be built in parallel with or after this phase since they share the intent data model.

**Delivers:** The full coordination loop — agents declare intent, receive conflict warnings based on overlapping intents and locked symbols, and see which callers of locked symbols they touch. This is the demo-able core of the product.

**Addresses:** Intent declaration and query, conflict detection (intent + lock intersection), dependency graph with caller warnings, interface contracts (propose/accept/reject)

**Avoids:** Transitive lock blocking anti-pattern (warn, never block), false-positive conflicts from file-level lock keys

### Phase 4: Polish — CLI Commands, Output Quality, Protocol Spec, Integration Hardening

**Rationale:** Once the coordination primitives are validated, complete the full CLI surface (`wit declare`, `wit lock`, `wit release`, `wit log`), harden conflict message UX (must name which agent, which symbol, when acquired), add `wit watch`, write the open protocol spec, and implement intent-to-commit git linkage. These are v1.x additions that make the validated core shippable.

**Delivers:** Full CLI surface, human-readable conflict messages, `wit watch` polling loop, protocol spec document, intent-to-commit git trailer linkage

**Addresses:** Human-readable coordination state, pre-write conflict surface polish, open protocol spec (enables third-party agent adoption)

### Phase Ordering Rationale

- The daemon and storage layer are hard prerequisites — no coordination state can exist without them. Phases 1 before 2 before 3 is non-negotiable.
- Tree-sitter is a complex isolated subsystem. Validating it independently (Phase 2) before integrating it into conflict detection (Phase 3) avoids debugging WASM issues mixed with coordination logic issues.
- Conflict detection (Phase 3) is the intersection of all inputs — it cannot be built until all its inputs (intents, locks, dependency graph) exist.
- All six critical pitfalls map to Phases 1-2. Getting these right early means Phases 3-4 are building on a correct foundation, not patching a broken one.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Tree-sitter integration):** WASM asset embedding in `bun compile` is actively evolving. The pitfall research flags `bun build --compile` WASM embedding as in-beta with documented issues. Verify the exact `Bun.embeddedFiles` API and test approach before implementation planning.
- **Phase 3 (Dependency graph):** The call graph construction from Tree-sitter queries is not trivially well-documented. How to walk the AST and extract caller/callee edges for TS/JS and Python may benefit from additional research into tree-sitter query syntax for each language's grammar.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Daemon foundation):** PID lifecycle, Unix socket HTTP, SQLite WAL setup, JSON-RPC over HTTP — all have solid official documentation and well-established patterns from LSP, Watchman, and git internals. No new research needed.
- **Phase 4 (Polish):** CLI formatting, git hooks, protocol spec writing — standard patterns throughout.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All core choices verified against official Bun, Drizzle, and Hono docs. web-tree-sitter version pin is verified against the upstream type regression issue. clipanion v4 RC status confirmed. |
| Features | HIGH | Primary source is Cursor's public post-mortem on multi-agent locking failure. LSP spec, Kleppmann's distributed locking analysis, and MCP spec all corroborate the design choices. |
| Architecture | HIGH | Core patterns (LSP lifecycle, SQLite WAL single-writer, WASM singleton, PID guard) are from official documentation with high-confidence sources. Component boundary design is sound. |
| Pitfalls | HIGH (daemon/SQLite), MEDIUM (WASM/protocol) | SQLite and daemon pitfalls have extensive prior art. WASM asset embedding in `bun compile` is actively changing — the mitigation advice is directionally correct but the exact API may shift. |

**Overall confidence:** HIGH

### Gaps to Address

- **`bun compile` WASM asset embedding:** The exact API for embedding non-JS binary assets in `bun build --compile` has documented instability. Before Phase 2 implementation planning, verify whether `Bun.embeddedFiles` is the current stable API or whether shipping WASM as a sidecar file is the safer approach.
- **Tree-sitter call graph queries:** How to write tree-sitter queries that extract caller/callee relationships (not just symbol declarations) for TypeScript and Python is not covered in the research. This needs investigation before Phase 3 planning — the query syntax for each grammar differs.
- **Windows compatibility:** The primary transport is Unix domain sockets. The fallback is `localhost:7337`. The research confirms Bun supports both, but the Windows named-pipe path has not been validated. Scope decision (support Windows in v1 or not) should be made before Phase 1 implementation.

## Sources

### Primary (HIGH confidence)
- [Cursor: Scaling Multi-Agent Autonomous Coding Systems](https://cursor.com/blog/scaling-agents) — locking failure post-mortem, hierarchical agent solution, optimistic CC failure
- [Language Server Protocol Specification 3.17/3.18](https://microsoft.github.io/language-server-protocol/) — JSON-RPC lifecycle, transport, capability negotiation
- [SQLite WAL Mode documentation](https://www.sqlite.org/wal.html) — WAL behavior, SQLITE_BUSY cases, checkpoint management
- [Bun official docs](https://bun.com/docs) — `bun:sqlite`, Unix socket Bun.serve + fetch, `bun compile` targets, signal handling
- [web-tree-sitter binding README](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md) — WASM init pattern, grammar loading
- [tree-sitter/tree-sitter GitHub issue #4187](https://github.com/tree-sitter/tree-sitter/issues/4187) — web-tree-sitter 0.25.x TypeScript type regression confirmation
- [Martin Kleppmann: How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) — TTL requirements, fencing tokens, correctness analysis
- [drizzle.team/docs/connect-bun-sqlite](https://drizzle.team/docs/connect-bun-sqlite) — Drizzle + bun:sqlite integration pattern
- [MCP November 2025 Specification](https://modelcontextprotocol.io/specification/2025-11-25) — agent capability discovery, JSON-RPC patterns

### Secondary (MEDIUM confidence)
- [Facebook Watchman](https://facebook.github.io/watchman/) — daemon architecture reference: client-server, Unix socket, clock-based state
- [SkyPilot: Abusing SQLite to Handle Concurrency](https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/) — multi-process WAL patterns
- [Pulsar Edit: Modern Tree-sitter part 7](https://blog.pulsar-edit.dev/posts/20240902-savetheclocktower-modern-tree-sitter-part-7/) — WASM memory management, explicit delete requirement
- [bun build --compile only works on my machine — GitHub Issue #24470](https://github.com/oven-sh/bun/issues/24470) — WASM asset embedding limitation
- [Git LFS File Locking Wiki](https://github.com/git-lfs/git-lfs/wiki/File-Locking) — file-granularity lock API design
- [Agentic Coding Trends Report 2026 — Anthropic](https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf) — industry multi-agent coordination context
- [A Survey of Agent Interoperability Protocols: MCP, ACP, A2A, ANP](https://arxiv.org/html/2505.02279v1) — protocol landscape

---
*Research completed: 2026-03-25*
*Ready for roadmap: yes*
