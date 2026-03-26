# Requirements: Wit

**Defined:** 2026-03-25
**Core Value:** Multiple AI agents can work on the same codebase concurrently without producing merge conflicts — coordination happens before code is written, not after.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Daemon & Infrastructure

- [x] **INFR-01**: Daemon process starts automatically on first CLI/API use and persists coordination state
- [x] **INFR-02**: SQLite database in `.wit/` with WAL mode, busy_timeout, and ACID guarantees
- [x] **INFR-03**: PID file management with stale PID detection and automatic recovery after crash
- [x] **INFR-04**: Protocol version field in every request/response with structured VERSION_MISMATCH error
- [x] **INFR-05**: Agent registers with name and session ID on connect; all locks/intents attributed to session
- [x] **INFR-06**: Daemon clean shutdown on SIGTERM/SIGINT with state flush

### Intent Tracking

- [x] **INTN-01**: Agent can declare intent describing planned work scope before writing code
- [x] **INTN-02**: Intent has lifecycle: declared → active → resolved/abandoned with timestamp tracking
- [x] **INTN-03**: Any agent can query all active intents (list, filter by agent, file, or scope)
- [ ] **INTN-04**: Intent-to-commit linkage via git trailer connecting declared intent to actual commit

### Semantic Locking

- [x] **LOCK-01**: Agent can acquire lock on semantic code unit (function, type, export) identified by symbol path
- [x] **LOCK-02**: Agent can release lock explicitly; lock auto-releases on session disconnect
- [x] **LOCK-03**: Tree-sitter WASM parsing extracts symbol boundaries for TypeScript/JavaScript files
- [x] **LOCK-04**: Tree-sitter WASM parsing extracts symbol boundaries for Python files
- [x] **LOCK-05**: Every lock has TTL; daemon background job clears expired locks automatically
- [x] **LOCK-06**: Any agent can query lock status: what's locked, by whom, TTL remaining
- [x] **LOCK-07**: Dependency graph (call edges between symbols) stored in SQLite and updated on parse
- [x] **LOCK-08**: Agents touching callers of a locked symbol receive a warning (not a block)

### Conflict Prevention

- [x] **CONF-01**: Overlapping intent detection — flag when two agents declare intents targeting the same code region
- [x] **CONF-02**: Locked region intersection — flag when an agent's intent overlaps an active lock held by another agent
- [x] **CONF-03**: Dependency graph traversal — warn when intent touches symbols in the call chain of a locked symbol
- [x] **CONF-04**: Structured conflict report returned synchronously when agent declares intent or acquires lock

### Contracts

- [x] **CONT-01**: Agent can propose an interface contract (function signature, type shape) for a code region
- [x] **CONT-02**: Other agents can accept or reject a proposed contract
- [x] **CONT-03**: Contract enforcement via git pre-commit hook — commit blocked if it violates accepted contracts

### API & CLI

- [x] **APIC-01**: HTTP/JSON-RPC API exposed over Unix domain socket at `.wit/daemon.sock`
- [x] **APIC-02**: CLI command `wit init` creates `.wit/` directory and initializes SQLite schema
- [x] **APIC-03**: CLI command `wit status` shows all active intents, locks, contracts, and conflicts
- [x] **APIC-04**: CLI command `wit declare` registers an intent for the calling agent
- [x] **APIC-05**: CLI command `wit lock` acquires a semantic lock on a specified symbol
- [x] **APIC-06**: CLI command `wit release` releases a held lock
- [x] **APIC-07**: All CLI commands support `--json` flag for machine-readable output
- [ ] **APIC-08**: `wit watch` command polls and displays live coordination state changes
- [x] **APIC-09**: Open protocol spec document (markdown + JSON Schema) describing all API methods

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Distribution

- **DIST-01**: Standalone compiled binary via `bun compile` for zero-dependency install
- **DIST-02**: npm and bun global install (`npm install -g wit` / `bun install -g wit`)

### Extended Features

- **EXTD-01**: `wit log` command showing resolved session history (intent → commit mapping)
- **EXTD-02**: Counter-proposal negotiation for contracts (propose → counter → accept)
- **EXTD-03**: Additional language grammars beyond TS/JS and Python (Go, Rust, Java)
- **EXTD-04**: Push notifications via SSE/WebSocket for real-time lock state changes

## Out of Scope

| Feature | Reason |
|---------|--------|
| Remote/multi-machine coordination | Requires distributed consensus (Raft/Paxos) — enormous scope, not needed for v1 local use case |
| CI/CD integration | CI is post-write and runs on remote machines without a daemon — contradicts pre-write prevention model |
| GUI/dashboard | CLI + API sufficient for both humans and agents; frontend build pipeline adds unnecessary complexity |
| Transitive lock blocking (hard block on callers) | Cursor's post-mortem showed this kills throughput via false positives; warn instead |
| Optimistic concurrency control | Cursor showed agents become risk-averse under OCC; explicit pessimistic locks are the right model |
| Automatic merge conflict resolution | Semantic-aware auto-merge is a research problem, not a product feature |
| Languages beyond TS/JS and Python | Extensible architecture but each language needs validated grammar quality; ship two well |
| Windows support | Unix domain sockets are primary transport; Windows named-pipe fallback deferred |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFR-01 | Phase 1 | Complete |
| INFR-02 | Phase 1 | Complete |
| INFR-03 | Phase 1 | Complete |
| INFR-04 | Phase 1 | Complete |
| INFR-05 | Phase 1 | Complete |
| INFR-06 | Phase 1 | Complete |
| APIC-01 | Phase 1 | Complete |
| APIC-02 | Phase 1 | Complete |
| LOCK-01 | Phase 2 | Complete |
| LOCK-02 | Phase 2 | Complete |
| LOCK-03 | Phase 2 | Complete |
| LOCK-04 | Phase 2 | Complete |
| LOCK-05 | Phase 2 | Complete |
| LOCK-06 | Phase 2 | Complete |
| LOCK-07 | Phase 2 | Complete |
| LOCK-08 | Phase 2 | Complete |
| INTN-01 | Phase 3 | Complete |
| INTN-02 | Phase 3 | Complete |
| INTN-03 | Phase 3 | Complete |
| CONF-01 | Phase 3 | Complete |
| CONF-02 | Phase 3 | Complete |
| CONF-03 | Phase 3 | Complete |
| CONF-04 | Phase 3 | Complete |
| CONT-01 | Phase 3 | Complete |
| CONT-02 | Phase 3 | Complete |
| CONT-03 | Phase 3 | Complete |
| APIC-03 | Phase 4 | Complete |
| APIC-04 | Phase 4 | Complete |
| APIC-05 | Phase 4 | Complete |
| APIC-06 | Phase 4 | Complete |
| APIC-07 | Phase 4 | Complete |
| APIC-08 | Phase 4 | Pending |
| APIC-09 | Phase 4 | Complete |
| INTN-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 34 total
- Mapped to phases: 34
- Unmapped: 0

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-25 after roadmap creation*
