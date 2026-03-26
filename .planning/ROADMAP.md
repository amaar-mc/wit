# Roadmap: Wit — Agent Coordination Protocol

## Overview

Wit is built in four phases that follow a strict dependency order: the daemon foundation must exist before semantic locking can be built, semantic locking must work before conflict detection can use it, and conflict detection must be validated before the full CLI surface and protocol spec are worth writing. Each phase delivers a coherent, independently verifiable capability. The goal at the end of all four phases is a demonstrable end-to-end scenario: two agents, one repo, both declare intents, lock regions, one gets warned about a conflict, and no merge conflict occurs.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Daemon process, SQLite persistence, Unix socket API, and `wit init` — the skeleton everything plugs into (completed 2026-03-26)
- [ ] **Phase 2: Semantic Locking** - Tree-sitter WASM parsing for TS/JS and Python plus the full lock primitive (acquire, release, TTL, dependency graph)
- [ ] **Phase 3: Coordination** - Intent declaration, conflict detection, and agent-to-agent contracts — the full coordination loop
- [ ] **Phase 4: Polish** - Complete CLI surface, `wit watch`, intent-to-commit linkage, and open protocol spec

## Phase Details

### Phase 1: Foundation
**Goal**: A running daemon that accepts JSON-RPC requests over a Unix socket, persists coordination state to SQLite with ACID guarantees, and has a CLI that auto-starts the daemon and proxies commands
**Depends on**: Nothing (first phase)
**Requirements**: INFR-01, INFR-02, INFR-03, INFR-04, INFR-05, INFR-06, APIC-01, APIC-02
**Success Criteria** (what must be TRUE):
  1. Running `wit init` in a repo creates a `.wit/` directory with an initialized SQLite database and starts the daemon if not already running
  2. The daemon process persists across CLI calls — a second `wit` command within the same session connects to the same running daemon, not a new one
  3. If the daemon crashes and leaves a stale PID file, the next CLI command recovers automatically and starts a fresh daemon without user intervention
  4. Every request and response over the Unix socket carries a `protocolVersion` field; a version mismatch returns a structured `VERSION_MISMATCH` error
  5. An agent can register a name and session ID with the daemon; all subsequent locks and intents reference that session
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Project scaffold, shared contracts (paths + protocol types), and SQLite/Drizzle database layer
- [x] 01-02-PLAN.md — Daemon process: Hono server on Unix socket, JSON-RPC routing, version middleware, agent registration, lifecycle management
- [x] 01-03-PLAN.md — CLI entry point, connect-or-spawn client, and `wit init` command

### Phase 2: Semantic Locking
**Goal**: Agents can acquire and release symbol-level locks (functions, types, exports) using Tree-sitter AST parsing for TypeScript/JavaScript and Python, with TTL-based auto-cleanup and a full dependency graph for caller awareness
**Depends on**: Phase 1
**Requirements**: LOCK-01, LOCK-02, LOCK-03, LOCK-04, LOCK-05, LOCK-06, LOCK-07, LOCK-08
**Success Criteria** (what must be TRUE):
  1. An agent can lock a specific function by symbol path (e.g., `src/auth.ts:validateToken`) — not the whole file
  2. A lock auto-releases when the agent session disconnects; locks also expire via TTL and are cleared by a background daemon job without manual intervention
  3. Any agent can query the current lock state and see what symbols are locked, by which session, and how much TTL remains
  4. When an agent attempts to touch a symbol that calls into a locked symbol, the daemon returns a warning identifying which locked symbol is in the call chain
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md — Tree-sitter WASM parser service, TS/Python symbol extraction, and locks + symbol_deps schema
- [ ] 02-02-PLAN.md — Lock acquire/release/query RPC handlers, TTL cleanup loop, parser wired into daemon
- [ ] 02-03-PLAN.md — Call edge extraction, symbol_deps population on lock.acquire, caller warnings

### Phase 3: Coordination
**Goal**: The full pre-write coordination loop — agents declare intents, receive conflict warnings based on overlapping intents and locked regions, and can propose and accept interface contracts with other agents
**Depends on**: Phase 2
**Requirements**: INTN-01, INTN-02, INTN-03, CONF-01, CONF-02, CONF-03, CONF-04, CONT-01, CONT-02, CONT-03
**Success Criteria** (what must be TRUE):
  1. An agent can declare an intent describing planned work; all other agents can query and see that intent immediately
  2. When two agents declare intents targeting the same code region, both receive a structured conflict report identifying the overlap before either writes code
  3. When an agent's intent overlaps an active lock held by another agent, the daemon returns a conflict report synchronously at declare-time
  4. An agent can propose an interface contract (function signature or type shape) and another agent can accept or reject it; an accepted contract is enforced via a git pre-commit hook that blocks commits violating it
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

### Phase 4: Polish
**Goal**: Full CLI command surface, human-readable coordination output, `wit watch` for live state monitoring, intent-to-commit git linkage, and an open protocol spec document that enables third-party agent adoption
**Depends on**: Phase 3
**Requirements**: APIC-03, APIC-04, APIC-05, APIC-06, APIC-07, APIC-08, APIC-09, INTN-04
**Success Criteria** (what must be TRUE):
  1. `wit status` displays all active intents, locks, contracts, and conflicts in a human-readable format; `wit status --json` returns the same data as machine-readable JSON
  2. A developer can run `wit declare`, `wit lock`, and `wit release` from the CLI and all operations are reflected in `wit status` immediately
  3. `wit watch` displays live coordination state updates as they happen, without requiring manual polling
  4. When a commit is made that was preceded by a declared intent, the commit carries a git trailer linking it to the intent ID
  5. The open protocol spec document (markdown + JSON Schema) fully describes all API methods so a third-party agent can implement the protocol without reading the source code
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete    | 2026-03-26 |
| 2. Semantic Locking | 0/3 | Not started | - |
| 3. Coordination | 0/? | Not started | - |
| 4. Polish | 0/? | Not started | - |
