<p align="center">
  <img src="logo.png" alt="wit" width="400" />
</p>
<p align="center">
  <strong>Agent coordination protocol for shared codebases</strong>
</p>
<p align="center">
  Declare intents. Lock symbols. Detect conflicts. Before code is written.
</p>

---

**Wit** coordinates multiple AI coding agents working on the same repository simultaneously. It sits between your agents and git — git handles version control, Wit prevents the conflicts.

The name comes from the word itself: the intelligence to coordinate before colliding. It also stands for **W**orkspace **I**ntent **T**racker.

## The Problem

You have three Claude Code instances (or Cursor, Copilot, Devin — any combination) working on the same repo. Without coordination, they each write code independently and produce merge conflicts that waste time and break work.

Git detects conflicts **after** they happen. Wit prevents them **before** code is written.

## How It Works

Wit runs a lightweight daemon in the background. Agents communicate with it over a Unix socket using JSON-RPC. The daemon tracks four things:

| Primitive | What it does | Example |
|-----------|-------------|---------|
| **Intents** | Agent announces planned work scope | "I'm refactoring the auth module" |
| **Locks** | Agent reserves a specific function/type/class | Lock `src/auth.ts:validateToken` |
| **Conflicts** | Daemon warns when intents or locks overlap | "Agent B also declared intent on auth.ts" |
| **Contracts** | Agents agree on function signatures | "validateToken accepts string, returns boolean" |

Intents and locks are **warnings, not blocks**. Agents always get to decide what to do. The only hard enforcement is contracts — a git pre-commit hook blocks commits that violate an accepted contract signature.

## Quick Start

### Prerequisites

Wit requires [Bun](https://bun.sh) (v1.0+). It uses Bun-native APIs for the daemon, SQLite, and process management. Install Bun if you don't have it:

```bash
curl -fsSL https://bun.sh/install | bash
```

### Install the CLI

**From npm:**
```bash
bun install -g wit-protocol
```

**From source:**
```bash
git clone https://github.com/amaarchughtai/wit.git
cd wit
bun install
bun link
```

After either method, the `wit` command is available globally.

### Initialize in your repo

```bash
cd your-project
wit init
```

This creates a `.wit/` directory, starts the daemon, and generates a session ID. You only run this once per project — the daemon auto-starts on subsequent commands.

> **With the Claude Code plugin:** Agents run `wit init` automatically on session start if the CLI is installed but `.wit/` doesn't exist. You never need to type `wit` commands yourself — the agents handle coordination end-to-end.

### Basic workflow

```bash
# See what's happening
wit status

# Declare intent before working
wit declare --description "Adding rate limiting to API" --files src/api.ts --files src/middleware.ts

# Lock a specific function you're about to modify
wit lock --symbol "src/api.ts:handleRequest"

# Check status — your intent and lock are visible to all agents
wit status

# Release when done
wit release --symbol "src/api.ts:handleRequest"

# Watch live updates (like htop for coordination)
wit watch
```

### What agents see

When Agent B tries to work in an area Agent A has claimed:

```bash
# Agent B declares intent on the same file
$ wit declare --description "Fixing auth bug" --files src/api.ts

# Response includes conflict warning:
# {
#   "intentId": "abc-123",
#   "conflicts": {
#     "hasConflicts": true,
#     "items": [{
#       "type": "INTENT_OVERLAP",
#       "message": "Agent A has active intent on src/api.ts"
#     }]
#   }
# }
```

Agent B sees the warning, checks what Agent A is doing, and chooses to work on a different part of the codebase.

## Claude Code Plugin

Wit ships as a Claude Code plugin. Once installed, agents automatically declare intents and lock symbols before editing — no manual configuration.

**Step 1:** Add the Wit marketplace (one-time)
```
/plugin marketplace add amaarchughtai/wit
```

**Step 2:** Install the plugin
```
/plugin install wit@amaarchughtai-wit
```

**Step 3:** Make sure the CLI is installed (see [Install the CLI](#install-the-cli) above)

**Step 4:** Initialize Wit in your project
```bash
wit init
```

That's it. Every Claude Code instance in the project now coordinates automatically.

**What the plugin provides:**

- **`wit:coordinate` skill** — Instructs agents to declare intents and acquire locks before editing code. Activates automatically when `.wit/` exists.
- **Session hook** — On session start, loads current coordination state so agents immediately see what other agents are working on.

**Without Claude Code:** Wit works with any AI agent that can run shell commands. Add instructions to your agent's system prompt to call `wit declare`, `wit lock`, `wit status`, and `wit release`. See the [Protocol Specification](#protocol-specification) for the raw JSON-RPC API.

## Commands

| Command | What it does |
|---------|-------------|
| `wit init` | Create `.wit/`, start daemon, generate session ID |
| `wit status` | Show all active intents, locks, contracts, and conflicts |
| `wit declare` | Announce intent to work on files/symbols |
| `wit lock` | Acquire a semantic lock on a specific symbol |
| `wit release` | Release a held lock |
| `wit watch` | Live dashboard of coordination state |
| `wit hook install` | Install git hooks for contract enforcement and intent tracking |

All commands support `--json` for machine-readable output.

## Semantic Locking

Wit doesn't lock files — it locks **symbols**. A symbol is a function, class, type, or export identified by its path:

```
src/auth.ts:validateToken      # a function
src/models.ts:User             # a type/class
src/utils.py:calculate_score   # a Python function
src/utils.py:RateLimiter       # a Python class
```

Wit uses [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) WASM grammars to parse your code and identify symbol boundaries — the exact byte range of each function, class, and type. Two agents can safely work on different functions in the same file.

**Supported languages:** TypeScript, JavaScript, Python.

## Conflict Detection

When an agent declares an intent, Wit runs three checks:

| Check | What it catches |
|-------|----------------|
| **Intent Overlap** | Two agents targeting the same code region |
| **Lock Intersection** | Intent targets a symbol locked by another agent |
| **Dependency Chain** | Intent targets a caller of a locked symbol |

All conflicts are **warnings**. The intent still succeeds. The agent decides what to do.

## Contracts

Agents can agree on function signatures. Once accepted, a git pre-commit hook enforces the contract — commits that change the agreed signature are blocked.

```bash
# Install enforcement hooks
wit hook install

# Now if an accepted contract's signature changes, the commit is rejected
git commit -m "changed params"
# ERROR: Contract violation — src/auth.ts:validateToken signature changed
```

Contracts are propose/accept/reject. No counter-proposals in v1.

## Intent-to-Commit Tracking

`wit hook install` also installs a `prepare-commit-msg` hook. Active intents are linked to commits via git trailers:

```
feat: add rate limiting

Wit-Intent: abc-123-def-456
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Claude A    │     │  Cursor B   │     │  Copilot C  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │       JSON-RPC over Unix socket         │
       │                    │                    │
       └────────────┬───────┴────────────────────┘
                    │
              ┌─────┴─────┐
              │ Wit Daemon │
              │            │
              │ Hono HTTP  │
              │ SQLite WAL │
              │ Tree-sitter│
              └────────────┘
                    │
              .wit/daemon.sock
              .wit/state.db
```

- **Daemon**: Bun process, Hono HTTP server, Unix domain socket
- **Storage**: SQLite with WAL mode for concurrent access
- **Parsing**: Tree-sitter WASM (zero native dependencies)
- **CLI**: Clipanion, auto-starts daemon on first use
- **Protocol**: JSON-RPC 2.0 with `witVersion` field

## Protocol Specification

Wit exposes 12 JSON-RPC methods. Full spec in two formats:

- **[`docs/PROTOCOL.md`](docs/PROTOCOL.md)** — Human-readable with request/response examples
- **[`docs/openrpc.json`](docs/openrpc.json)** — Machine-readable [OpenRPC 1.4.0](https://spec.open-rpc.org/) schema

Any tool that can POST JSON to a Unix socket can participate.

## `.wit/` Directory

| File | Purpose |
|------|---------|
| `daemon.sock` | Unix domain socket |
| `daemon.pid` | Daemon PID for lifecycle management |
| `state.db` | SQLite database (WAL mode) |
| `session.id` | Stable session identifier |

Add `.wit/` to your `.gitignore`.

## Limitations (v1)

- Single machine only — no network coordination
- TypeScript/JavaScript and Python — extensible to more languages
- CLI and API only — no GUI
- Warnings only — locks and conflicts never block (except contracts)
- Bun runtime required

## Development

```bash
git clone https://github.com/amaarchughtai/wit.git
cd wit
bun install
bun test
```

## License

MIT
