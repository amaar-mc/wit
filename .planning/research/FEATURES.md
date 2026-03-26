# Feature Research

**Domain:** Agent coordination daemon / developer coordination protocol
**Researched:** 2026-03-25
**Confidence:** HIGH (Cursor's public post-mortems, LSP spec, distributed systems literature, and MCP spec are primary sources)

---

## Feature Landscape

### Table Stakes (Agents Can't Coordinate Without These)

These are the non-negotiable primitives. If any of these are missing, Wit cannot fulfill its core promise of preventing merge conflicts before code is written.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Daemon process with persistent state | All distributed lock managers require a single authoritative source of truth; no daemon = no shared state | MEDIUM | SQLite-backed, survives restarts. WAL mode required for concurrent reads during writes. |
| Mutual exclusion on semantic code units | Every lock manager since Lamport's 1978 paper requires this; file-level locks are too coarse, character-level too fine | HIGH | Tree-sitter WASM to extract function/type/export boundaries. The "semantic" framing is Wit's specific take on a universal primitive. |
| Lock acquisition and release API | Table stakes for any lock protocol — acquire, hold, release with timeout/TTL | LOW | POST /lock, DELETE /lock/id. TTL prevents dead locks when agents crash mid-task. |
| Dead lock / stale lock cleanup | Every production lock manager (Redis, ZooKeeper, etcd) has TTL-based expiry; without this, a crashed agent poisons the shared state | LOW | TTL on every lock record. Daemon background job clears expired locks. |
| Status query (what is locked, by whom) | Any developer tool without a "what's happening" view is unusable; compare: `git status`, Watchman's query API | LOW | GET /status or `wit status`. Must include: locker identity, lock target, time acquired, TTL remaining. |
| CLI interface for humans | Agents and humans both need to interact with the daemon; CLI is the human-facing layer on top of the API | LOW | `wit init`, `wit status`, `wit lock`, `wit declare`, `wit release`. Thin wrappers around HTTP API. |
| Repo initialization and daemon lifecycle | Any daemon tool (Watchman, language servers) requires init/start/stop/restart primitives | LOW | `wit init` creates `.wit/` dir and SQLite schema. Daemon auto-starts on first use. |
| Intent declaration | Without announced intent, agents have no shared signal to check before starting work — coordination becomes post-hoc | MEDIUM | Agents write what they plan to do before starting. Stored in SQLite. All agents can query all intents. |
| Conflict detection before code is written | This is Wit's core purpose. Without pre-write conflict detection it degrades to a post-hoc notification tool (what git already does) | HIGH | Cross-reference declared intents against active locks and dependency graph edges. Surface before agent begins writing. |
| Programmatic API (HTTP/JSON-RPC) | AI agents cannot reliably shell out and parse CLI output at scale; a local API is required for programmatic access | LOW | localhost HTTP or Unix socket. JSON-RPC is the LSP-proven pattern for tool-protocol communication. |
| Agent identity / session tracking | Lock managers must know WHO holds a lock to enable release, transfer, and conflict attribution | LOW | Agent registers with name + session ID on connect. Daemon associates all locks/intents with that session. |

### Differentiators (Competitive Advantage Over Ad-Hoc Approaches)

These distinguish Wit from "just use git worktrees and be careful." None of the existing approaches — worktrees, manual branch conventions, flat-file coordination — provide these.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Semantic (symbol-level) locking via Tree-sitter | Every existing tool (git, git-lfs, filesystem locks) operates at file granularity. Symbol-level locking allows two agents to edit the same file in non-overlapping functions without conflict. This is Wit's core technical differentiation. | HIGH | Tree-sitter WASM grammars for TS/JS and Python. Lock target is a symbol path (e.g. `src/auth.ts:validateToken`), not a file path. |
| Dependency-aware conflict warnings | Ad-hoc worktree isolation cannot detect that Agent A locked `parseToken()` and Agent B is about to modify its callers. Wit walks the dependency graph and warns. | HIGH | Tree-sitter-derived call graph stored in SQLite. On lock acquisition, query for callers of locked symbol. Warn (not block) in v1. |
| Intent-to-commit linkage | No existing tool connects "what an agent planned to do" with "what it actually committed." This creates an audit trail and enables future replay/rollback. | MEDIUM | Intent ID stored as git trailer or commit message annotation. `wit log` shows intent → commit mapping. |
| Agent-to-agent interface contracts | Agents working on adjacent code units need a machine-readable way to agree on shared interfaces before either writes code. No existing tool provides this. | MEDIUM | Propose/accept/reject model. Stored in SQLite as structured records (function signature, type shape). Enforced at commit time via pre-commit hook. |
| Open protocol spec (agent-agnostic) | Vendor lock-in to a single AI tool is a blocker for adoption. An open JSON-RPC protocol spec (analogous to LSP) means Claude Code, Cursor, Copilot, and Devin all interoperate without changes to Wit. | LOW | Spec is a markdown document + JSON Schema. Implementation in Bun/TS. Protocol versioning from day one. |
| Lock dependency graph (not just flat locks) | Redis and ZooKeeper provide flat key-based locks. Wit models the codebase as a graph where locking a node propagates warnings up the call chain. This is the distinction between "locking a file" and "locking a concept." | HIGH | SQLite adjacency list or JSON column for edges. Queried on every lock/intent operation. |
| Human-readable coordination state | Git has `git log`, `git blame`, `git status`. Wit should have equivalents that make coordination state legible. This is a differentiator because worktree-based approaches have no shared state to introspect. | LOW | `wit status` shows all active intents, locks, and contracts. `wit log` shows resolved sessions. |
| Pre-write conflict surface (not post-merge) | Git surfaces conflicts after code is written and pushed. Wit surfaces conflicts when an agent declares intent — before a single line is written. This is the core value inversion relative to git. | MEDIUM | Intent declaration triggers conflict check. Returns structured conflict report synchronously. |

### Anti-Features (Deliberately Not Building)

These are features that seem reasonable on first principles but create problems that outweigh their value for v1.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Transitive lock blocking (hard block on callers) | If A locks `foo()` and B calls `foo()`, blocking B seems "safe" | Cursor tried strict locking with 20 agents and got throughput of 2-3 agents. False positive rate is too high — most callers don't need changes just because a callee is locked. Kills adoption. | Warn callers, don't block. Let agents decide. Record the warning in the session log. |
| Full counter-proposal negotiation | Feels like the "complete" contract model — propose, counter, counter-counter, accept | Adds a multi-round async protocol to what should be a synchronous check. Complexity grows exponentially. No evidence teams need this in v1. | Propose/accept/reject only. Counter-proposals come in v2 if evidence demands it. |
| Network / multi-machine coordination | Multiple machines coordinating on the same repo is the "obvious" scale-up | Single-machine v1 already solves the real problem. Distributed coordination requires consensus algorithms (Raft/Paxos), fencing tokens, clock skew handling — each a multi-week project. Shipping distributed-first delays the core value. | Scope to single-machine, single-repo in v1. Use Unix socket as transport (makes remote impossible by design — no accidents). |
| GUI / dashboard | Visual representation of lock state looks impressive in demos | Adds an entire frontend build pipeline, no-code constraint in PROJECT.md rules it out, and the CLI/API is sufficient for both humans and agents. Visual state is nice-to-have after protocol is validated. | `wit status` with clean terminal output. JSON output flag for programmatic consumers. |
| Languages beyond TS/JS and Python for v1 | Completeness argument — why not Go, Rust, Java? | Tree-sitter grammar quality varies by language. Semantic lock extraction logic must be validated per-language. Each language is a non-trivial addition. Shipping five languages at 60% quality is worse than two languages at 95%. | Extensible grammar plugin architecture so community can add languages. Ship TS/JS + Python only. |
| CI/CD integration (remote hooks) | "Obviously useful" to enforce Wit coordination in CI | CI runs on remote machines without a Wit daemon. This requires the network coordination that is explicitly out of scope. Also, CI is post-write — it doesn't prevent conflicts, it just adds a gate. | Pre-commit hooks locally enforce contracts. CI integration is v2+ after the local model is proven. |
| Real-time lock notifications via WebSocket/SSE | Push model feels more "live" than poll | Adds stateful connection management to a daemon that would otherwise be stateless-per-request. Polling `/status` at 1Hz is sufficient for agent coordination cadences. Complexity vs value ratio is poor. | Agents poll `/status`. For human monitoring, `wit watch` can be a CLI polling loop. Add push in v2 if poll performance is the bottleneck. |
| Optimistic concurrency control (no locks, just conflict-on-write) | "More scalable" than locking — agents write freely, detect conflicts at save time | Cursor tried this after locking failed. Agents became risk-averse, avoided hard tasks, made only minimal safe changes. The purpose of Wit is intent declaration before writing, which optimistic CC undermines. | Keep explicit pessimistic locks for semantic units. The pre-write declaration is the core value; don't trade it for concurrency. |
| Automatic merge conflict resolution | "If Wit knows what each agent intends, it could merge for them" | Semantic-aware auto-merge is a research problem, not a product feature. Even CRDTs (which handle this well for text) don't handle semantic conflicts in code (e.g., two agents that both add a function with the same name). | Prevent conflicts before they occur. When a conflict is detected, surface it clearly. Resolution is always human/agent guided. |

---

## Feature Dependencies

```
Daemon process (SQLite persistence)
    └──requires──> All other features (no daemon = no shared state)

Intent Declaration
    └──requires──> Daemon process
    └──requires──> Agent identity / session tracking
    └──enhances──> Conflict Detection (intents are inputs to conflict check)

Semantic Locking (Tree-sitter)
    └──requires──> Daemon process
    └──requires──> Tree-sitter WASM grammar loading
    └──enhances──> Conflict Detection (locked symbols are conflict inputs)

Conflict Detection
    └──requires──> Intent Declaration
    └──requires──> Semantic Locking
    └──requires──> Dependency Graph (for caller warnings)
    └──enables──> Pre-write conflict surface (the core value)

Dependency Graph (call graph edges)
    └──requires──> Tree-sitter WASM (same AST traversal as semantic locking)
    └──requires──> SQLite (edge storage)
    └──enhances──> Conflict Detection (adds transitive caller warnings)

Interface Contracts
    └──requires──> Agent identity / session tracking
    └──requires──> Daemon process
    └──depends-on──> Intent Declaration (contracts reference intents)

CLI
    └──requires──> HTTP API (CLI wraps API)
    └──enhances──> All features (human access layer)

Open Protocol Spec
    └──requires──> HTTP API (spec documents the API)
    └──enables──> Agent-agnostic adoption

Intent-to-commit linkage
    └──requires──> Intent Declaration
    └──requires──> git hook (pre-commit or post-commit)
    └──enhances──> audit trail / replay

Lock acquisition/release ──conflicts──> Optimistic CC (incompatible coordination models)
Transitive lock blocking ──conflicts──> "Warn callers, don't block" (pick one)
```

### Dependency Notes

- **Conflict Detection requires both Intent Declaration and Semantic Locking:** Conflict detection is the intersection operation across all active intents, all active locks, and the dependency graph. Any one of these inputs being missing produces an incomplete conflict check.
- **Dependency Graph enhances Conflict Detection:** The graph is technically optional in a minimal v1 (you could just compare intents to locked symbols without traversing the call graph), but without it the caller-warning differentiator does not exist.
- **Interface Contracts depends on Intent Declaration:** Contracts are proposed between agents who have already declared intents on the relevant code regions. Without intents, contracts have no grounding in the coordination state.
- **CLI conflicts with building the API last:** The CLI must come after the HTTP API, but the HTTP API is the correct first-class interface. Never build CLI as the primary layer and retrofit an API.

---

## MVP Definition

### Launch With (v1)

Minimum viable product — sufficient to demonstrate "two agents, one repo, no merge conflict."

- [ ] Daemon process with SQLite persistence and clean startup/shutdown — the coordination state store
- [ ] Agent identity and session registration — required for all other features
- [ ] Intent declaration and query — agents announce what they plan before writing
- [ ] Semantic locking (TS/JS + Python) via Tree-sitter WASM — agents lock functions/types, not files
- [ ] Conflict detection: overlapping intents + locked region intersection — pre-write conflict surface
- [ ] Dependency graph (call edges) with caller warnings — the key differentiator over flat locks
- [ ] Lock TTL / dead lock cleanup — correctness requirement; crashed agents must not poison state
- [ ] HTTP API (JSON-RPC over localhost) — agent-programmatic access
- [ ] CLI (`wit init`, `wit status`, `wit declare`, `wit lock`, `wit release`) — human access and demo-ability
- [ ] Interface contracts: propose/accept/reject — agent-to-agent interface agreement before coding

### Add After Validation (v1.x)

Features to add once the core coordination model is validated in real use.

- [ ] Intent-to-commit linkage via git trailer — when evidence shows teams want audit trails
- [ ] Protocol spec document (markdown + JSON Schema) — when external tool authors ask for it
- [ ] `wit watch` — CLI polling loop for human monitoring of live coordination state
- [ ] Python language grammar hardening — TS/JS will be battle-tested first; Python quality verified second

### Future Consideration (v2+)

Defer until product-market fit is established.

- [ ] Remote/multi-machine coordination — requires distributed consensus; enormous scope
- [ ] Additional language grammars (Go, Rust, Java) — community can add via plugin architecture
- [ ] Counter-proposal contract negotiation — only if propose/accept/reject proves insufficient
- [ ] CI/CD integration — only after local daemon model is validated
- [ ] Push notifications (SSE/WebSocket) — only if polling is a demonstrated performance bottleneck

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Daemon + SQLite persistence | HIGH | MEDIUM | P1 |
| Agent identity / session tracking | HIGH | LOW | P1 |
| Intent declaration + query | HIGH | LOW | P1 |
| Semantic locking (Tree-sitter WASM) | HIGH | HIGH | P1 |
| Conflict detection (intent + lock intersection) | HIGH | MEDIUM | P1 |
| Dependency graph + caller warnings | HIGH | HIGH | P1 |
| Lock TTL / dead lock cleanup | HIGH | LOW | P1 |
| HTTP API (JSON-RPC) | HIGH | LOW | P1 |
| CLI (thin wrapper) | HIGH | LOW | P1 |
| Interface contracts (propose/accept/reject) | MEDIUM | MEDIUM | P1 |
| Intent-to-commit git linkage | MEDIUM | LOW | P2 |
| Open protocol spec document | MEDIUM | LOW | P2 |
| `wit watch` monitoring command | LOW | LOW | P2 |
| Additional language grammars | MEDIUM | HIGH | P3 |
| Counter-proposal negotiation | LOW | HIGH | P3 |
| Push notifications (SSE/WebSocket) | LOW | MEDIUM | P3 |
| Remote / multi-machine coordination | HIGH | VERY HIGH | P3 |

**Priority key:**
- P1: Must have for launch — the v1 demo cannot succeed without these
- P2: Should have — add when P1 is stable and validated
- P3: Future consideration — defer until PMF evidence

---

## Competitor / Reference System Analysis

| Feature | git-lfs locking | Watchman | Redis/ZooKeeper DLM | Cursor multi-agent | Our Approach |
|---------|-----------------|----------|--------------------|--------------------|--------------|
| Lock granularity | File | File (watch paths) | Arbitrary key | File / task | Symbol (function, type, export) |
| Conflict model | Pessimistic lock | Notify on change | Pessimistic lock (key-based) | Hierarchical roles, no shared locks | Pessimistic lock + pre-write intent check |
| Dependency awareness | None | None | None | None (role separation solves it differently) | Call graph edges, caller warnings |
| Protocol | Git LFS HTTP API | JSON or BSER binary | Client library | Proprietary | Open JSON-RPC spec |
| Agent-agnostic | No (git-specific) | No (file-system only) | No (infra tool, not code-aware) | No (Cursor-only) | Yes (any agent that can hit an HTTP endpoint) |
| Dead lock handling | Server-enforced lock expiry | N/A | TTL / session expiry | Agent role restart | TTL on every lock record |
| Intent declaration | None | None | None | Task queue (planner assigns) | Explicit pre-write intent with conflict check |
| Interface contracts | None | None | None | None | Propose/accept/reject for shared interfaces |
| Human introspection | `git lfs locks` | `watchman find` | Key inspection | None (internal state) | `wit status`, `wit log` |

**Key insight from Cursor's post-mortem:** Flat locking at scale (20+ agents) degrades throughput to 2-3 effective agents. Their solution was hierarchical role separation, which removes the need for fine-grained coordination. Wit's approach is different — smaller agent counts (2-10), semantic granularity, and pre-write intent coordination rather than post-write role isolation. The Cursor lesson validates that file-level locks are too blunt, and that TTL / session cleanup is critical for correctness.

---

## Sources

- [Cursor: Scaling Multi-Agent Autonomous Coding Systems](https://cursor.com/blog/scaling-agents) — PRIMARY: post-mortem on locking failure, optimistic CC failure, hierarchical solution (HIGH confidence)
- [LSP Overview — microsoft.github.io](https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/) — Protocol design: capabilities handshake, JSON-RPC message types (HIGH confidence)
- [LSP 3.18 Specification](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.18/specification.md) — Request/response/notification model, capability negotiation (HIGH confidence)
- [Facebook Watchman](https://facebook.github.io/watchman/) — Daemon design: settle-before-notify, project scoping, binary protocol option (HIGH confidence)
- [Martin Kleppmann: How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) — Fencing tokens, TTL requirements, correctness analysis (HIGH confidence)
- [Git LFS File Locking Wiki](https://github.com/git-lfs/git-lfs/wiki/File-Locking) — File-granularity lock API design, acquire/release primitives (HIGH confidence)
- [Git lockfile API](https://git-scm.com/docs/api-lockfile) — Atomic rename pattern, signal-safe cleanup, lock-on-write semantics (HIGH confidence)
- [SQLite WAL Mode](https://www.sqlite.org/wal.html) — Concurrent read during write, single-writer, WAL checkpoint behavior (HIGH confidence)
- [SQLite Locking and Concurrency V3](https://sqlite.org/lockingv3.html) — SHARED/RESERVED/EXCLUSIVE lock states (HIGH confidence)
- [MCP November 2025 Specification](https://modelcontextprotocol.io/specification/2025-11-25) — Agent capability discovery, JSON-RPC, tool notification pattern (HIGH confidence)
- [A Survey of Agent Interoperability Protocols: MCP, ACP, A2A, ANP](https://arxiv.org/html/2505.02279v1) — Protocol landscape, A2A design, capability metadata (MEDIUM confidence)
- [Google A2A Protocol announcement](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/) — Agent card / contract model, vendor-neutral capability spec (MEDIUM confidence)
- [Git Worktrees for AI Agents](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/) — Why worktrees alone are insufficient (disk usage, shared DB state) (MEDIUM confidence)
- [Semantic Code Indexing with Tree-sitter for AI Agents](https://medium.com/@email2dineshkuppan/semantic-code-indexing-with-ast-and-tree-sitter-for-ai-agents-part-1-of-3-eb5237ba687a) — Symbol extraction, dependency graph, repo-map construction (MEDIUM confidence)
- [AFT: Tree-sitter powered code analysis tools for AI agents](https://github.com/ualtinok/aft) — Symbol-addressed operations over AST (MEDIUM confidence)
- [Agentic Coding Trends Report 2026 — Anthropic](https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf) — Industry adoption context, multi-agent coordination state of the art (MEDIUM confidence)

---

*Feature research for: Agent coordination daemon (Wit)*
*Researched: 2026-03-25*
