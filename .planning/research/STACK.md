# Stack Research

**Domain:** Local daemon + CLI + open protocol for AI agent coordination on shared codebases
**Researched:** 2026-03-25
**Confidence:** MEDIUM-HIGH (most choices verified against official docs; a few version details estimated from npm/GitHub)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Bun | 1.3.x (latest: 1.3.11) | Runtime, package manager, bundler, test runner | Native TypeScript execution, built-in `bun:sqlite`, `bun compile` for standalone binaries, Unix socket support in `Bun.serve()` and `fetch()`. Cold starts ~3x faster than Node, critical for CLI responsiveness. One tool covers: runtime + package manager + bundler + test runner. |
| TypeScript | 5.x (bundled with Bun) | Language | Strict mode enforces correctness on concurrent mutation paths (lock state, intent registry). Bun transpiles natively — no `tsc` in the hot path. |
| Hono | 4.x | HTTP server layer for daemon API | Lightest footprint of any TS web framework (~14kb), works natively on Bun, excellent TypeScript inference on route handlers. Daemon exposes a local JSON-over-HTTP API — Hono is the right abstraction level. Elysia is an alternative but has steeper learning curve and less ecosystem maturity. |
| Drizzle ORM | 0.40.x | SQLite schema + type-safe queries | Native `bun:sqlite` adapter (`drizzle-orm/bun-sqlite`). Schema-as-code with full TS inference on query results. `drizzle-kit migrate` handles daemon-managed schema migrations at `.wit/db.sqlite` startup. 3-6x faster than `better-sqlite3` when using the native bun adapter. |
| web-tree-sitter | 0.24.7 | WASM-based AST parsing | The WASM binding to Tree-sitter. Version 0.24.7 is the last release before the 0.25.x type-export regression — use this until the TypeScript type issues in 0.25.x are resolved upstream. Zero native compilation: users `bun install` and get a working binary with no build step. |
| tree-sitter-typescript | 0.23.2 | TypeScript/TSX grammar WASM | The official grammar for TS and TSX. Provides `.wasm` files loadable at runtime via `Language.load()`. Pin this alongside web-tree-sitter version. |
| tree-sitter-python | 0.23.x | Python grammar WASM | Official Python grammar. Same loading pattern as TypeScript. Ship both grammars as bundled assets in the npm package. |
| clipanion | 3.2.x (stable) | CLI command framework | Type-safe, decorator-based command definitions. Powers Yarn — the most complex CLI in the JS ecosystem. Zero runtime dependencies. v4 is still RC (4.0.0-rc.4 as of research date) — stay on v3.2.x for stability. Commander.js lacks type inference on option values; clipanion provides compile-time enforcement on argument shapes. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-kit` | 0.30.x | Schema migrations CLI | Run at daemon startup to migrate `.wit/db.sqlite` to the current schema. Use `drizzle-kit migrate` (not push) for deterministic, logged migrations. |
| `zod` | 3.x | Runtime validation of protocol messages | Validate all incoming JSON-RPC/HTTP payloads before they touch daemon state. Particularly critical for the `declare`, `lock`, and `contract` endpoints where bad input causes lock corruption. |
| `@std/path` / `pathe` | latest | Cross-platform path handling | Bun runs on Windows too. Use `pathe` instead of Node's `path` for consistent separator handling in `.wit/` directory resolution. |
| `pino` | 9.x | Structured daemon logging | Daemon needs file-based logs in `.wit/logs/`. Pino is the fastest TS logger; outputs NDJSON by default. Use `pino-pretty` for development only. |
| `tsx` | 4.x | Development watch mode | `tsx watch src/daemon.ts` for hot-reload during development. Not needed in production — replaced by `bun --watch`. |
| `vitest` | 2.x | Unit tests | Bun's built-in test runner is fast but lacks mocking infrastructure for file system and process signals. Vitest runs under Bun and has better `vi.mock()` ergonomics for testing daemon lifecycle. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `bun compile` | Standalone binary generation | `bun build --compile --target=bun src/cli.ts --outfile=wit` produces a single self-contained binary. Cross-compile with `--target=bun-linux-x64`, `--target=bun-darwin-arm64`, `--target=bun-windows-x64`. Single entrypoint only — design CLI and daemon with a single `src/index.ts` entry. |
| `drizzle-kit generate` + `drizzle-kit migrate` | Schema migration workflow | Generate SQL files from schema changes; apply them at daemon init. Commit migration files to version control. |
| `bun --watch` | Hot reload in dev | Built into Bun runtime. `bun --watch src/daemon.ts` restarts daemon on file changes. |
| `biome` | Linting + formatting | Replaces ESLint + Prettier in one tool, runs in Bun natively. Opinionated defaults reduce configuration overhead. |

---

## IPC Transport Decision

The daemon exposes a **Unix domain socket** serving plain HTTP (not raw TCP). This is the right architecture for v1:

- `Bun.serve({ unix: '.wit/daemon.sock' })` — daemon listens on a socket file in the repo's `.wit/` directory
- Clients call `fetch('http://localhost/...', { unix: '.wit/daemon.sock' })` — this is a first-class Bun API
- Unix sockets are ~50% lower latency than TCP loopback (~130µs vs ~334µs) and are not network-exposed
- Fallback: `localhost:7337` HTTP for environments where Unix sockets aren't available (Windows without WSL)
- Protocol: JSON over HTTP. Not JSON-RPC 2.0 formally — the RPC overhead adds complexity without value for a local daemon with a small operation set. Use REST-like endpoints (`POST /intents`, `POST /locks`, `GET /status`) with a consistent JSON envelope.

Do not use raw WebSockets or a custom binary protocol. Overhead is negligible at this scale and JSON is debuggable without tooling.

---

## Installation

```bash
# Core runtime (users must have Bun installed)
bun add hono drizzle-orm zod pino pathe

# Bun-specific: bun:sqlite is built-in, no extra install

# Dev dependencies
bun add -D drizzle-kit vitest biome @biomejs/biome

# Tree-sitter (WASM only — no native bindings)
bun add web-tree-sitter@0.24.7
bun add tree-sitter-typescript@0.23.2
bun add tree-sitter-python
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hono | Elysia | Elysia has a more ergonomic plugin system and slightly better performance benchmarks. Use Elysia if the team already knows it or if the API surface grows beyond ~10 endpoints. |
| Hono | Express | Never for new projects on Bun. Express is synchronous-first and not designed for Bun's runtime model. |
| Drizzle ORM | Raw `bun:sqlite` | Use raw `bun:sqlite` only if the schema is trivial (< 4 tables, no migrations needed). For Wit, schema evolves across versions — Drizzle's migration tooling is worth the dependency. |
| Drizzle ORM | Prisma | Prisma has a binary engine that doesn't work cleanly in Bun standalone binaries. Drizzle is pure TS, no extra process. |
| clipanion v3 | commander.js | Commander has no type inference on parsed arguments — you get `any`. For a tool with many subcommands and strict option types, clipanion's class-based pattern gives compile-time safety. Use commander only for simple one-off scripts. |
| clipanion v3 | oclif | Oclif generates file-per-command scaffolding that's heavy for a focused tool like Wit. Only worth it if you expect a plugin ecosystem. |
| web-tree-sitter | `tree-sitter` (native) | Use native bindings if you control the install environment and need maximum parse throughput (native is ~10x faster than WASM). For Wit, zero-install-friction is a stronger constraint than parse speed — WASM is correct here. |
| Unix socket + HTTP | Raw JSON-RPC 2.0 | JSON-RPC 2.0 adds a batch/notification format that Wit doesn't need in v1. The spec compliance overhead isn't worth it. Revisit if the protocol becomes multi-transport or if external integrators need standard JSON-RPC tooling. |
| pino | winston | Winston is significantly heavier and slower. Pino's NDJSON output is machine-parseable, which matters for daemon logs that tools might inspect. |
| vitest | `bun test` | Bun's built-in test runner is simpler and faster, but lacks `vi.mock()` depth. Use `bun test` for pure unit tests; use vitest for anything that requires mocking Bun APIs or daemon internals. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `tree-sitter` (native npm package) | Requires native compilation — breaks `bun compile` standalone binary workflow, adds install friction for users | `web-tree-sitter@0.24.7` with WASM grammars |
| `web-tree-sitter@0.25.x` | TypeScript type export regression in 0.25.0 and 0.25.1 — `"web-tree-sitter"` can't be resolved when respecting `package.json` exports in strict TS projects | Pin to `0.24.7` until upstream resolves the type issue |
| `better-sqlite3` | Node-native module, breaks in Bun standalone binaries | `bun:sqlite` (built-in, 3-6x faster, works in compiled binaries) |
| `sqlite3` (npm) | Callback-based, async overhead, Node-native | `bun:sqlite` |
| Prisma | Rust query engine binary embedded at runtime — incompatible with `bun compile` single-binary distribution | Drizzle ORM |
| ESLint + Prettier separately | Two tools with frequent config conflicts; Prettier 3 changed semicolon defaults and broke many setups | Biome (one tool, one config) |
| `node:child_process` IPC | Complex, fragile, doesn't give you HTTP semantics | Bun Unix socket HTTP (Bun.serve + fetch unix option) |
| NestJS or Fastify | Framework weight and abstraction levels designed for multi-instance services, not embedded daemons | Hono |
| `yargs` | Runtime argument parsing with weak TypeScript types; yargs objects are typed as `Arguments` not as the specific shape you declared | clipanion |

---

## Stack Patterns by Context

**Daemon entry point:**
- Use `Bun.serve({ unix: '.wit/daemon.sock', fetch: app.fetch })` where `app` is a Hono instance
- Run DB migrations via drizzle-kit at daemon startup before accepting connections
- Write a PID file to `.wit/daemon.pid` to detect stale daemon processes

**CLI entry point:**
- One binary entry `src/index.ts` — Clipanion `Cli` with registered command classes
- Commands call `fetch('http://localhost/...', { unix: '.wit/daemon.sock' })` against the daemon
- Fall back to spawning the daemon if not running (check PID file before connecting)

**WASM grammar loading:**
- Bundle `.wasm` files as binary assets in the npm package under `src/grammars/`
- Load at runtime: `await Parser.init(); const lang = await Language.load(new URL('../grammars/tree-sitter-typescript.wasm', import.meta.url))`
- `import.meta.url` is stable in Bun and works correctly in both dev and compiled binary contexts

**Schema migrations:**
- Drizzle schema in `src/db/schema.ts`
- Migration files in `src/db/migrations/` (committed to git)
- Daemon startup: `import { migrate } from 'drizzle-orm/bun-sqlite/migrator'; migrate(db, { migrationsFolder: './migrations' })`

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `web-tree-sitter@0.24.7` | `tree-sitter-typescript@0.23.2`, `tree-sitter-python@0.23.x` | Grammar WASM files must be compiled with the same ABI version as the parser. 0.23.x grammars work with web-tree-sitter 0.24.7. Do NOT mix 0.24/0.25 parser with 0.22 grammars. |
| `drizzle-orm@0.40.x` | `bun:sqlite` (built into Bun 1.3.x) | Import from `drizzle-orm/bun-sqlite`. No extra SQLite package needed. |
| `clipanion@3.2.x` | Bun 1.3.x, TypeScript 5.x | Pure ESM, no native dependencies. Works out of the box with Bun. |
| `hono@4.x` | Bun 1.3.x | Use `hono` package directly — no adapter needed for Bun. Hono uses the Web Standards `Request`/`Response` API which Bun implements natively. |
| `bun compile` | Single entrypoint only | Cannot take `--outdir` or multiple entrypoints. Design CLI + daemon launcher under one `src/index.ts`. Daemon forks itself or runs inline based on argv. |

---

## Sources

- Bun official docs (bun.com/docs) — `bun:sqlite`, Unix socket support, `bun compile` targets — HIGH confidence
- Bun 1.2 / 1.3 release notes (socket.dev, render.com changelog) — version confirmation — MEDIUM confidence
- tree-sitter GitHub releases page — v0.26.7 current, WASM asset confirmation — HIGH confidence
- tree-sitter-typescript GitHub — v0.23.2 latest release — HIGH confidence
- tree-sitter/tree-sitter GitHub issue #4187 — web-tree-sitter 0.25.x TypeScript type regression — HIGH confidence (official issue tracker)
- npm web-tree-sitter page (via search) — 0.25.x as latest; 0.24.7 type-safe version — MEDIUM confidence
- drizzle.team/docs/connect-bun-sqlite (WebFetch) — integration pattern, sync/async API — HIGH confidence
- clipanion GitHub + libraries.io — v4 still RC (4.0.0-rc.4), v3.2.x is stable — MEDIUM confidence
- Bun unix socket fetch guide (bun.sh/guides/http/fetch-unix) — confirmed first-class API — HIGH confidence
- WebSearch: Hono 4 + Bun integration, multiple community sources — MEDIUM confidence
- WebSearch: pino vs winston comparison, multiple sources — MEDIUM confidence

---

*Stack research for: Wit — agent coordination protocol daemon + CLI*
*Researched: 2026-03-25*
