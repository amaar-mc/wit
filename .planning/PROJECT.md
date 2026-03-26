# Wit — Agent Coordination Protocol

## What This Is

Wit is a daemon, CLI, and open protocol that coordinates multiple AI coding agents working simultaneously on the same codebase. It sits between agents and git — git handles version control, Wit prevents conflicts. Any AI coding agent (Claude Code, Cursor, Copilot, Devin, etc.) can use Wit to declare intent, lock semantic code regions, and negotiate interfaces with other agents before writing code.

## Core Value

Multiple AI agents can work on the same codebase concurrently without producing merge conflicts — coordination happens before code is written, not after.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Daemon process that watches repos and manages coordination state
- [ ] CLI interface (`wit init`, `wit declare`, `wit lock`, `wit status`, etc.)
- [ ] Local HTTP/JSON-RPC API for programmatic agent access (CLI wraps this)
- [ ] Intent tracking — agents declare what they plan to do, intents visible to all, commits link to intents
- [ ] Semantic locking — lock functions, types, exports (not files) via Tree-sitter AST parsing
- [ ] Lock dependency awareness — warn (not block) agents touching callers of locked symbols
- [ ] Conflict prevention — detect overlapping intents, locked regions, intersecting dependency graphs
- [ ] Agent-to-agent contracts — simple propose/accept/reject interface contracts
- [ ] Tree-sitter WASM grammars for TypeScript/JavaScript and Python
- [ ] SQLite-backed persistence in `.wit/` directory
- [ ] Open protocol spec (LSP-like, for agent-code coordination)
- [ ] npm package + standalone binary distribution

### Out of Scope

- Full negotiation with counter-proposals — v1 is propose/accept/reject only
- Transitive lock blocking — v1 warns callers, doesn't block them
- Languages beyond TS/JS and Python — extensible design but ship with two
- CI/CD integration — v1 is local daemon only
- Cloud/remote coordination — v1 is single-machine, same repo
- GUI/dashboard — CLI and API only
- Native Tree-sitter bindings — WASM only for zero build-step install

## Context

The problem: when multiple AI agents (e.g., several Claude Code instances) work on the same repo simultaneously, they produce merge conflicts. Git detects conflicts after the fact — Wit prevents them before code is written.

The coordination model has four primitives:
1. **Intent Tracking** — agents announce what they plan to do. All agents can see all intents. When code is committed, commits reference the intent that motivated them.
2. **Semantic Locking** — instead of file-level locks, Wit locks semantic code units (functions, types, exports) identified via Tree-sitter AST parsing. Lock state includes dependency edges so callers can be warned.
3. **Conflict Prevention** — the combination layer. Checks overlapping intents against locked regions and dependency graphs. Surfaces conflicts before any code is written.
4. **Contracts** — agents propose interface contracts (function signatures, type shapes) that other agents can accept or reject. Machine-readable and enforceable. v1 is simple propose/accept/reject.

The protocol is designed to be agent-agnostic — any tool that can shell out to a CLI or hit a local HTTP endpoint can participate. The daemon is the single source of truth for coordination state.

"Done" for v1: two agents, one repo, both declare intents, lock regions, one gets warned about a conflict — no merge conflict occurs. Demonstrable end-to-end.

## Constraints

- **Runtime**: Bun — fast startup matters for CLI, good TS support
- **Language**: TypeScript, strict mode
- **AST Parsing**: Tree-sitter WASM bindings only — no native compilation, no build step for users
- **Storage**: SQLite in `.wit/` — ACID guarantees, single file, survives daemon restarts
- **Distribution**: npm/bun global install + standalone compiled binary (Bun compile)
- **Protocol**: JSON-based messages over local transport (Unix socket or localhost HTTP)
- **Scope**: Single machine, single repo — no network coordination in v1

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Agent-agnostic protocol | Wit should work with any AI coding tool, not just Claude Code | — Pending |
| CLI wraps API (dual interface) | Humans use CLI, agents can use either CLI or HTTP — one source of truth | — Pending |
| SQLite over flat files | Need ACID for concurrent agent access, structured queries for dependency graphs | — Pending |
| WASM Tree-sitter only | Zero build step for users — frictionless install over raw performance | — Pending |
| Warn callers, don't block | Transitive blocking is too aggressive for v1 — false positives kill adoption | — Pending |
| Simple contracts (no counters) | Full negotiation adds complexity without clear v1 value — ship simple, iterate | — Pending |
| Bun runtime | Fast cold starts for CLI, native TS, `bun compile` for standalone binary | — Pending |

---
*Last updated: 2026-03-25 after initialization*
