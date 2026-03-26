# Phase 2: Semantic Locking - Research

**Researched:** 2026-03-25
**Domain:** Tree-sitter WASM parsing, semantic lock primitives, SQLite dependency graphs, TTL cleanup
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LOCK-01 | Agent acquires lock on semantic code unit identified by symbol path | Symbol path format `file:symbol`, lock table schema, acquire/conflict RPC handler |
| LOCK-02 | Agent releases lock explicitly; lock auto-releases on session disconnect | `locks.release()` RPC + ON DELETE CASCADE from agents table OR explicit cleanup on disconnect |
| LOCK-03 | Tree-sitter WASM parsing extracts symbol boundaries for TypeScript/JavaScript | web-tree-sitter 0.24.7 + tree-sitter-wasms WASM files, TS grammar node types confirmed |
| LOCK-04 | Tree-sitter WASM parsing extracts symbol boundaries for Python | Same infrastructure, Python `function_definition`/`class_definition` node types confirmed |
| LOCK-05 | Every lock has TTL; daemon background job clears expired locks automatically | `setInterval` cleanup loop on `locks.expiresAt < Date.now()`, no external dependency needed |
| LOCK-06 | Any agent can query lock status: what's locked, by whom, TTL remaining | `locks.query` RPC returns `{symbolPath, sessionId, agentName, expiresAt, ttlMs}` |
| LOCK-07 | Dependency graph (call edges) stored in SQLite and updated on parse | `symbol_deps` table with `caller/callee/file` columns, rebuilt on each file parse |
| LOCK-08 | Agents touching callers of a locked symbol receive a warning (not a block) | Transitive graph walk at lock-acquire time, returns `{warnings: [{lockedSymbol, chain}]}` |
</phase_requirements>

---

## Summary

Phase 2 has two clearly separated sub-problems: (1) a Tree-sitter WASM integration layer that parses TypeScript/JavaScript and Python files into symbol tables and call graphs, and (2) a lock primitive layer that uses those symbol tables to implement acquire/release/TTL/query/warn operations on top of the existing SQLite+Drizzle+Hono foundation.

The core technical risk — confirmed resolved — is that `Language.load()` in web-tree-sitter 0.24.7 accepts a `Uint8Array` directly. This means WASM bytes can be loaded from disk using `Bun.file(wasmPath).bytes()` with no `locateFile` ceremony, no HTTP serving, and no bundler configuration. The language WASM files ship as a sidecar via `tree-sitter-wasms` npm package (36 languages, 2.34 MB TypeScript, 476 kB Python, all confirmed present in that package's `/out/` directory).

The dependency graph (LOCK-07/LOCK-08) cannot be built purely with tree-sitter queries. The constraint "you cannot skip nodes in a query" means a query alone cannot map a `call_expression` inside a function body back to its containing function. The correct approach is: run a simple `call_expression` query to get all call sites, then walk each call node's `.parent` chain upward until you reach a function boundary node. This is a two-pass algorithm: first capture all symbols (LOCK-03/04), then capture all calls + walk parents (LOCK-07).

**Primary recommendation:** Use `tree-sitter-wasms` for WASM files, `Language.load(await Bun.file(path).bytes())` for initialization, two-pass parse for symbol + call extraction, `setInterval` for TTL cleanup, and a single `symbol_deps` table for the dependency graph.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| web-tree-sitter | 0.24.7 (pinned) | WASM bindings to tree-sitter parser | 0.25.x has unresolved TypeScript type regression in exports field — confirmed broken as of Feb 2025 |
| tree-sitter-wasms | 0.1.13 | Prebuilt WASM grammar files for 36 languages | No build step; ships tree-sitter-typescript.wasm (2.34 MB), tree-sitter-tsx.wasm (2.41 MB), tree-sitter-python.wasm (476 kB) |
| drizzle-orm (existing) | 0.45.x | ORM for new `locks` + `symbol_deps` schema tables | Already in use; bun-sqlite dialect; gt()/lt() operators for TTL queries |
| bun:sqlite (existing) | built-in | Raw SQLite handle for PRAGMAs | Already in use; no additional dep |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod (existing) | 4.x | Validate lock RPC request params | Already used for `register` handler; same pattern |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tree-sitter-wasms | @vscode/tree-sitter-wasm | VSCode's version is opinionated and bundles extra tooling; tree-sitter-wasms is thinner |
| tree-sitter-wasms | Bun compile embedded WASM | `bun compile` WASM embedding (import with `type: "file"`) was broken until June 2025 fix; sidecar in node_modules is reliable for dev use, v2 distribution can embed |
| setInterval TTL cleanup | External cron/job queue | setInterval inside the already-running daemon is zero-dependency and sufficient for this use case |

**Installation:**
```bash
bun add web-tree-sitter@0.24.7 tree-sitter-wasms
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── shared/
│   ├── paths.ts         # existing — no changes
│   └── protocol.ts      # existing — add lock method types
├── db/
│   ├── schema.ts        # ADD: locks table, symbol_deps table
│   ├── index.ts         # existing — no changes
│   └── migrate.ts       # existing — no changes
├── parser/
│   ├── loader.ts        # Parser singleton: init web-tree-sitter, load language WASM
│   ├── symbols.ts       # Extract symbol table from AST (LOCK-03, LOCK-04)
│   ├── calls.ts         # Extract call edges from AST (LOCK-07)
│   └── parser.test.ts   # Unit tests for symbol/call extraction
├── daemon/
│   ├── server.ts        # existing — add ParserService to DaemonDeps
│   ├── lifecycle.ts     # existing — add TTL cleanup setInterval on start
│   └── rpc/
│       └── handlers.ts  # existing — add lock.acquire, lock.release, lock.query cases
└── cli/                 # Phase 4 — not touched in Phase 2
```

### Pattern 1: Parser Initialization (Singleton with lazy load)

**What:** Initialize web-tree-sitter once at daemon startup, load language WASM files from `node_modules/tree-sitter-wasms/out/` using `Bun.file().bytes()` which returns a `Uint8Array` that `Language.load()` accepts directly.

**When to use:** Called once in `lifecycle.ts` at daemon startup; stored in `DaemonDeps`.

```typescript
// Source: web-tree-sitter binding_web README + Language.load Uint8Array signature
import Parser from "web-tree-sitter";
import { join } from "node:path";

export type ParserService = {
  typescript: Parser.Language;
  python: Parser.Language;
  parser: Parser;
};

export async function createParserService(
  wasmDir: string, // path to node_modules/tree-sitter-wasms/out/
  treeSitterWasm: string, // path to node_modules/web-tree-sitter/tree-sitter.wasm
): Promise<ParserService> {
  await Parser.init({
    locateFile: () => treeSitterWasm,
  });

  const tsBytes = await Bun.file(join(wasmDir, "tree-sitter-typescript.wasm")).bytes();
  const pyBytes = await Bun.file(join(wasmDir, "tree-sitter-python.wasm")).bytes();

  const typescript = await Parser.Language.load(tsBytes);
  const python = await Parser.Language.load(pyBytes);
  const parser = new Parser();

  return { typescript, python, parser };
}
```

**Note:** `locateFile` is required to tell the Emscripten module where `tree-sitter.wasm` lives. Without it, the loader tries to fetch it from the working directory and fails in a daemon context with unpredictable CWD (same CWD pitfall already documented in Phase 1 for migrations).

### Pattern 2: Symbol Extraction (Two-pass parse)

**What:** First pass extracts symbol declarations (functions, methods, types, classes, interfaces). Second pass extracts call edges by querying `call_expression` and walking parent nodes. This is the correct approach — pure queries cannot jump from a call site back to its containing function.

**When to use:** Called on every `lock.acquire` for the target file, and stored in `symbol_deps`.

```typescript
// Source: web-tree-sitter query API + parsiya.net tree-sitter query article
const SYMBOL_QUERY_TS = `
  (function_declaration name: (identifier) @name) @definition
  (arrow_function) @definition
  (method_definition name: (property_identifier) @name) @definition
  (function_signature name: (identifier) @name) @definition
  (type_alias_declaration name: (type_identifier) @name) @definition
  (interface_declaration name: (type_identifier) @name) @definition
  (class_declaration name: (type_identifier) @name) @definition
`;

const CALL_QUERY_TS = `
  (call_expression function: [
    (identifier) @callee
    (member_expression property: (property_identifier) @callee)
  ]) @call
`;

export type SymbolInfo = {
  name: string;
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number;
  kind: "function" | "method" | "type" | "interface" | "class" | "arrow";
};

export function extractSymbols(
  parser: Parser,
  language: Parser.Language,
  source: string,
): SymbolInfo[] { /* ... */ }

export type CallEdge = { caller: string; callee: string };

export function extractCallEdges(
  parser: Parser,
  language: Parser.Language,
  source: string,
  symbols: SymbolInfo[],
): CallEdge[] {
  // 1. Run CALL_QUERY to get all call nodes
  // 2. For each call node, walk .parent chain until reaching a function boundary
  // 3. The function boundary node's name is the "caller"
  // This two-pass approach is required because tree-sitter queries cannot skip nodes
}
```

### Pattern 3: Symbol Path Format

**What:** A symbol path is `{relativeFilePath}:{symbolName}`. File paths are relative to the repo root (the directory containing `.wit/`). This uniquely identifies a symbol across a project.

**Example:** `src/auth.ts:validateToken`, `api/routes.ts:handleLogin`

**Rules:**
- File separator: always `/` (normalize on Windows if ever supported)
- Symbol name: the identifier text as extracted by tree-sitter (no type suffix, no signature)
- Disambiguation: if multiple functions share a name (overloads), the first by line order wins for locking purposes. Note this in the `symbol_info` table with `startLine` for disambiguation.

### Pattern 4: TTL Cleanup Loop

**What:** `setInterval` in the daemon lifecycle that deletes expired locks every 30 seconds.

**When to use:** Started once on daemon startup in `lifecycle.ts`, cleared on SIGTERM/SIGINT.

```typescript
// Source: Bun setInterval (standard Web API) + drizzle lt() operator
import { lt } from "drizzle-orm";
import { locks } from "../db/schema";

export function startTtlCleanup(db: WitDatabase): ReturnType<typeof setInterval> {
  return setInterval(() => {
    db.delete(locks).where(lt(locks.expiresAt, new Date())).run();
  }, 30_000); // 30 second sweep
}
```

### Pattern 5: Lock Acquire with Conflict Check

**What:** On `lock.acquire`, check for an existing lock on the same symbol path. If locked by another session, return `LOCK_CONFLICT`. If same session already holds it, return success (idempotent re-lock). Then check the dependency graph for callers of the target symbol that are locked by other sessions and return warnings.

```typescript
// Source: drizzle-orm/bun-sqlite query patterns + project existing handler pattern
case "lock.acquire": {
  const { symbolPath, sessionId, ttlMs } = parsed.data;

  // 1. Check existing lock
  const existing = await db.select().from(locks)
    .where(eq(locks.symbolPath, symbolPath))
    .limit(1);

  if (existing[0] && existing[0].sessionId !== sessionId) {
    return createRpcError(body.id, -32000, "LOCK_CONFLICT", {
      heldBy: existing[0].sessionId,
      expiresAt: existing[0].expiresAt,
    });
  }

  // 2. Upsert lock
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(locks)
    .values({ symbolPath, sessionId, expiresAt, acquiredAt: new Date() })
    .onConflictDoUpdate({ target: locks.symbolPath, set: { expiresAt, sessionId } });

  // 3. Check callers of this symbol for existing locks by OTHER sessions
  const warnings = await buildCallerWarnings(db, symbolPath, sessionId);

  return createRpcSuccess(body.id, { warnings });
}
```

### Anti-Patterns to Avoid

- **Using tree-sitter queries to span parent-child boundaries for call graphs:** Queries cannot skip nodes. Use query-to-get-all-calls + parent walk instead.
- **Storing WASM paths as absolute paths:** The daemon detaches with unpredictable CWD (established in Phase 1). Resolve WASM paths at module load time using `import.meta.url`-relative paths or injected WitPaths, same as migrations.
- **Sharing one Parser instance across concurrent parses without locking:** The `Parser` object is not thread-safe. In Bun's single-threaded event loop this is safe, but never await between `parser.setLanguage()` and `parser.parse()`.
- **Initializing web-tree-sitter multiple times:** `Parser.init()` is idempotent but expensive. Call it once at daemon startup, not per-request.
- **Using `integer({ mode: 'timestamp' })` for TTL comparison:** Use `integer({ mode: 'timestamp_ms' })` and compare with `Date.now()` as a number to avoid Date object conversion overhead in the cleanup loop.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parsing TypeScript/Python to find symbol boundaries | Custom regex/string-scanning parser | web-tree-sitter + grammar WASM | Unicode edge cases, template literals, nested functions, decorators — all handled by the grammar |
| WASM file distribution | Bundling WASM into JS source | tree-sitter-wasms npm package | Pre-built, versioned, tested against specific tree-sitter core versions |
| Timestamp comparison queries | Raw SQL strings | drizzle `lt()`, `gt()` operators | Type-safe, prevents SQL injection, already in dependency |
| Conflict detection across callers | Building your own graph traversal algorithm | Simple SQLite recursive CTE or iterative loop on `symbol_deps` | Depth is shallow (< 5 hops for practical code), SQLite handles it |

**Key insight:** The tree-sitter grammar handles every edge case that regex-based symbol extraction gets wrong: arrow functions assigned to variables, destructured exports, generator functions, async functions, overloaded TypeScript signatures, and Python decorators.

---

## Common Pitfalls

### Pitfall 1: Daemon CWD for WASM file paths
**What goes wrong:** `Language.load('./node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm')` works in dev but fails when the daemon detaches because CWD changes.
**Why it happens:** Established Phase 1 pattern — daemon forks and the child has the parent's CWD, which may not be the repo root.
**How to avoid:** Resolve WASM paths the same way migrations are resolved: use `import.meta.url` or inject paths via `WitPaths`. Pass `wasmDir` into `createParserService()` rather than computing it inside.
**Warning signs:** Tests pass, daemon startup in a different directory fails with "file not found".

### Pitfall 2: web-tree-sitter 0.25.x type regression
**What goes wrong:** TypeScript compilation fails with "There are types at web-tree-sitter.d.ts but this result could not be resolved when respecting package.json exports."
**Why it happens:** The 0.25.0 exports field misconfiguration broke TypeScript module resolution. Fix was merged but not published as of Feb 2025.
**How to avoid:** Pin `web-tree-sitter@0.24.7`. Do not upgrade without verifying the type exports work under `"moduleResolution": "bundler"`.
**Warning signs:** `import Parser from 'web-tree-sitter'` triggers type errors even though the WASM runtime works fine.

### Pitfall 3: Missing `locateFile` in Parser.init()
**What goes wrong:** `Parser.init()` without a `locateFile` option tries to load `tree-sitter.wasm` from the current working directory (or a relative path baked into the Emscripten build). In a daemon context this always fails.
**Why it happens:** web-tree-sitter's Emscripten runtime uses `locateFile` to find the core WASM. Without it, it constructs a URL from `scriptDirectory + "tree-sitter.wasm"` which is meaningless in a CLI/daemon environment.
**How to avoid:** Always pass `locateFile: () => absolutePathToTreeSitterWasm` in `Parser.init()`.
**Warning signs:** `RuntimeError: abort(Module not found)` or `ENOENT tree-sitter.wasm` on daemon start.

### Pitfall 4: Arrow functions and variable-assigned functions missed in symbol extraction
**What goes wrong:** `const validateToken = (token: string) => { ... }` is not matched by `(function_declaration ...)` query.
**Why it happens:** Arrow functions assigned to variables are `variable_declarator` containing `arrow_function`, not a `function_declaration` node.
**How to avoid:** Include a separate query pattern: `(variable_declarator name: (identifier) @name (arrow_function) @definition)`. The `startByte`/`endByte` of the `variable_declarator` parent node covers the full symbol.
**Warning signs:** Locking a file after refactoring from `function foo()` to `const foo = () =>` stops working.

### Pitfall 5: Symbol name collisions in the dependency graph
**What goes wrong:** Two files each have a `handleRequest` function, and the dep graph conflates them.
**Why it happens:** The `symbol_deps` table stores `caller` and `callee` as bare names if not qualified with file path.
**How to avoid:** Store all dep table entries as fully-qualified symbol paths: `src/auth.ts:validateToken`, not just `validateToken`. The call-extraction step must qualify the callee by looking for a matching symbol in the same file first, then fall back to unresolved.
**Warning signs:** Warning fires for the wrong file when two functions share a name.

### Pitfall 6: Stale dependency graph after file edits
**What goes wrong:** A file was edited, the dep graph still contains old call edges, and warnings fire for removed calls.
**Why it happens:** The `symbol_deps` table is append-only unless you delete-before-insert on parse.
**How to avoid:** On every parse of a file, delete all existing `symbol_deps` rows where `file = <that file>` before inserting new edges. Treat parse as a full refresh, not incremental.
**Warning signs:** Locks are warned about calls that no longer exist in the code.

---

## Code Examples

Verified patterns from official sources and cross-verified:

### web-tree-sitter Initialization with Uint8Array (Language.load)
```typescript
// Source: web-tree-sitter npm package Language.load signature confirmed as:
// static load(input: string | Uint8Array): Promise<Language>

import Parser from "web-tree-sitter";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = fileURLToPath(new URL(".", import.meta.url));

await Parser.init({
  locateFile: () =>
    join(__dir, "../../node_modules/web-tree-sitter/tree-sitter.wasm"),
});

const tsWasm = await Bun.file(
  join(__dir, "../../node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm"),
).bytes();

const TypeScriptLang = await Parser.Language.load(tsWasm);
const parser = new Parser();
parser.setLanguage(TypeScriptLang);

const tree = parser.parse(`function greet(name: string): string { return name; }`);
console.log(tree.rootNode.toString());
```

### Query for Symbol Declarations
```typescript
// Source: web-tree-sitter query API (confirmed from dev.to/shrsv example pattern)
// query.matches(rootNode) returns: Array<{ pattern: number, captures: Array<{ name: string, node: Parser.SyntaxNode }> }>

const symbolQuery = TypeScriptLang.query(`
  (function_declaration
    name: (identifier) @name) @definition.function

  (variable_declarator
    name: (identifier) @name
    value: (arrow_function)) @definition.arrow

  (method_definition
    name: (property_identifier) @name) @definition.method

  (type_alias_declaration
    name: (type_identifier) @name) @definition.type

  (interface_declaration
    name: (type_identifier) @name) @definition.interface

  (class_declaration
    name: (type_identifier) @name) @definition.class
`);

const matches = symbolQuery.matches(tree.rootNode);
for (const match of matches) {
  const nameCapture = match.captures.find((c) => c.name === "name");
  const defCapture = match.captures.find((c) => c.name.startsWith("definition"));
  if (nameCapture && defCapture) {
    console.log({
      name: nameCapture.node.text,
      startLine: defCapture.node.startPosition.row,
      endLine: defCapture.node.endPosition.row,
    });
  }
}
```

### Two-Pass Call Edge Extraction
```typescript
// Source: parsiya.net "Knee Deep in tree-sitter Queries" — confirmed that queries
// cannot skip nodes; parent chain walk is the correct approach.

const callQuery = TypeScriptLang.query(`
  (call_expression
    function: [
      (identifier) @callee
      (member_expression property: (property_identifier) @callee)
    ]) @call
`);

const FUNCTION_BOUNDARY_TYPES = new Set([
  "function_declaration",
  "arrow_function",
  "method_definition",
  "function",
]);

function findContainingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let current = node.parent;
  while (current !== null) {
    if (FUNCTION_BOUNDARY_TYPES.has(current.type)) return current;
    current = current.parent;
  }
  return null;
}

const callMatches = callQuery.matches(tree.rootNode);
const edges: Array<{ caller: string; callee: string }> = [];

for (const match of callMatches) {
  const calleeCapture = match.captures.find((c) => c.name === "callee");
  if (!calleeCapture) continue;

  const containingFn = findContainingFunction(calleeCapture.node);
  if (!containingFn) continue;

  // Get the name node of the containing function
  const callerNameNode = containingFn.childForFieldName("name");
  if (!callerNameNode) continue;

  edges.push({
    caller: callerNameNode.text,
    callee: calleeCapture.node.text,
  });
}
```

### Python Symbol + Call Extraction Queries
```typescript
// Source: tree-sitter-python tags.scm confirmed node types:
// function_definition, class_definition, call (not call_expression)

const PY_SYMBOL_QUERY = `
  (function_definition
    name: (identifier) @name) @definition.function

  (class_definition
    name: (identifier) @name) @definition.class
`;

const PY_CALL_QUERY = `
  (call
    function: [
      (identifier) @callee
      (attribute attribute: (identifier) @callee)
    ]) @call
`;

// IMPORTANT: Python uses (call ...) not (call_expression ...)
// Python uses (attribute ...) not (member_expression ...)
```

### Drizzle Schema for Locks + Symbol Deps
```typescript
// Source: drizzle-orm/sqlite-core column types, established Phase 1 patterns

import { int, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const locks = sqliteTable(
  "locks",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    symbolPath: text("symbol_path").notNull(),  // "src/auth.ts:validateToken"
    sessionId: text("session_id").notNull(),
    acquiredAt: int("acquired_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: int("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("locks_symbol_path_unique").on(t.symbolPath)],
);

export const symbolDeps = sqliteTable(
  "symbol_deps",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    file: text("file").notNull(),              // relative path: "src/auth.ts"
    caller: text("caller").notNull(),           // qualified: "src/auth.ts:login"
    callee: text("callee").notNull(),           // qualified: "src/auth.ts:validateToken" (best effort)
  },
  (t) => [
    index("symbol_deps_callee_idx").on(t.callee),
    index("symbol_deps_caller_idx").on(t.caller),
    index("symbol_deps_file_idx").on(t.file),
  ],
);
```

### TTL Cleanup with Drizzle lt()
```typescript
// Source: drizzle-orm operators documentation — lt() confirmed for SQLite

import { lt } from "drizzle-orm";

// In lifecycle.ts startDaemon():
const cleanupInterval = setInterval(() => {
  deps.db
    .delete(locks)
    .where(lt(locks.expiresAt, new Date()))
    .run();
}, 30_000);

// Clear on shutdown (existing SIGTERM/SIGINT handlers):
clearInterval(cleanupInterval);
```

### Lock Query Handler
```typescript
// Returns current lock state with TTL remaining
case "lock.query": {
  const now = new Date();
  const activeLocks = await deps.db
    .select({
      symbolPath: locks.symbolPath,
      sessionId: locks.sessionId,
      acquiredAt: locks.acquiredAt,
      expiresAt: locks.expiresAt,
    })
    .from(locks)
    .where(gt(locks.expiresAt, now));

  const result = activeLocks.map((l) => ({
    ...l,
    ttlRemainingMs: l.expiresAt.getTime() - now.getTime(),
  }));

  return createRpcSuccess(body.id, result);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Native tree-sitter bindings (node-gyp, prebuilds) | WASM-only bindings via web-tree-sitter | ~2019 onward | Zero build step for users; no native compilation; works in all JS runtimes |
| Building WASM grammars from source | Prebuilt WASM packages (tree-sitter-wasms) | 2022 onward | No Emscripten toolchain required at install time |
| Optimistic concurrency for agent locks | Explicit pessimistic locks with TTL | Cursor post-mortem 2024 | Agents become risk-averse under OCC; pessimistic is correct model |
| Transitive blocking on caller chain | Warning only (not block) on callers | Cursor post-mortem 2024 | Transitive blocking kills throughput via false positives |

**Deprecated/outdated:**
- `web-tree-sitter@0.25.x`: TypeScript type exports broken as of Feb 2025, fix not yet published to npm. Do not use.
- `node-tree-sitter` (native bindings): Requires node-gyp, breaks in Bun's `bun compile`. WASM-only is the right approach for this project.

---

## Open Questions

1. **Arrow function locking granularity for variable-assigned functions**
   - What we know: `const foo = () => {}` is a `variable_declarator` with an `arrow_function` child; the symbol name comes from the declarator's identifier.
   - What's unclear: If the user specifies `src/utils.ts:foo`, do we lock the entire `variable_declarator` (which includes the const keyword) or just the `arrow_function` node? This matters for byte-range reporting.
   - Recommendation: Lock the `variable_declarator` node range; it covers the whole logical "function" including its name binding.

2. **Callee qualification across file boundaries**
   - What we know: When extracting call edges, we can only see the callee name as a string. Resolving `validateToken` to `src/auth.ts:validateToken` requires knowing which file defines it.
   - What's unclear: Phase 2 doesn't include an import resolver. Should cross-file calls be stored as unqualified names or skipped?
   - Recommendation: Store intra-file calls as fully qualified. Store cross-file calls as `?:calleeName` (unknown file prefix). The dep graph is a best-effort warning system, not a hard enforcer. Full qualification can be added in a later phase via import analysis.

3. **Default TTL value**
   - What we know: TTL is per-lock, set at acquire time. The REQUIREMENTS say "locks expire via TTL."
   - What's unclear: What should the default TTL be if the agent doesn't specify one?
   - Recommendation: Default to 30 minutes (1_800_000 ms). This is long enough for realistic agent work sessions but short enough to not permanently block files after a crash.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bun:test (built-in, no additional install) |
| Config file | package.json `scripts.test` |
| Quick run command | `bun test src/parser/` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOCK-01 | Agent acquires lock by symbol path, returned lock ID | unit | `bun test src/daemon/rpc/handlers.test.ts` | ❌ Wave 0 |
| LOCK-01 | Acquiring a locked symbol by another session returns LOCK_CONFLICT | unit | `bun test src/daemon/rpc/handlers.test.ts` | ❌ Wave 0 |
| LOCK-02 | Explicit release deletes lock row | unit | `bun test src/daemon/rpc/handlers.test.ts` | ❌ Wave 0 |
| LOCK-02 | Session disconnect triggers auto-release | unit | `bun test src/daemon/lifecycle.test.ts` | ✅ exists (extend) |
| LOCK-03 | TypeScript function_declaration extracted by parser | unit | `bun test src/parser/symbols.test.ts` | ❌ Wave 0 |
| LOCK-03 | TypeScript arrow function extracted by parser | unit | `bun test src/parser/symbols.test.ts` | ❌ Wave 0 |
| LOCK-04 | Python function_definition extracted by parser | unit | `bun test src/parser/symbols.test.ts` | ❌ Wave 0 |
| LOCK-05 | TTL cleanup loop deletes expired lock rows | unit | `bun test src/daemon/lifecycle.test.ts` | ✅ exists (extend) |
| LOCK-05 | Expired lock not returned in query results | unit | `bun test src/daemon/rpc/handlers.test.ts` | ❌ Wave 0 |
| LOCK-06 | lock.query returns active locks with TTL remaining | unit | `bun test src/daemon/rpc/handlers.test.ts` | ❌ Wave 0 |
| LOCK-07 | Call edges extracted and stored in symbol_deps | unit | `bun test src/parser/calls.test.ts` | ❌ Wave 0 |
| LOCK-08 | lock.acquire warns when callee of locked symbol | unit | `bun test src/daemon/rpc/handlers.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test src/parser/`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/parser/symbols.test.ts` — covers LOCK-03, LOCK-04 (symbol extraction for TS + Python)
- [ ] `src/parser/calls.test.ts` — covers LOCK-07 (call edge extraction + parent walk)
- [ ] `src/parser/loader.test.ts` — covers Parser init + language load (sanity smoke test)
- [ ] New test cases in `src/daemon/rpc/handlers.test.ts` — covers LOCK-01, LOCK-02 (explicit release), LOCK-05 (expired lock not returned), LOCK-06, LOCK-08
- [ ] New test cases in `src/daemon/lifecycle.test.ts` — covers LOCK-02 (disconnect auto-release), LOCK-05 (cleanup interval)
- [ ] New migration file in `drizzle/` — `locks` table + `symbol_deps` table (generated via `bun run drizzle-kit generate`)

---

## Sources

### Primary (HIGH confidence)

- web-tree-sitter binding_web README (github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md) — Parser.init(), Language.load(), locateFile pattern
- web-tree-sitter npm package search result — confirmed `Language.load(input: string | Uint8Array)` signature; latest version 0.26.6 (active project)
- tree-sitter GitHub issue #4187 — confirmed exact type regression in 0.25.0/0.25.1: exports field misconfiguration; fix merged but not published as of Feb 2025
- tree-sitter-python tags.scm — confirmed `function_definition`, `class_definition`, `call`, `attribute` node types
- tree-sitter-typescript queries/tags.scm — confirmed `function_signature`, `method_signature`, `abstract_method_signature`, `interface_declaration`, `abstract_class_declaration`, `module` node types
- tree-sitter-typescript common/define-grammar.js — confirmed `function_declaration`, `arrow_function`, `method_definition`, `type_alias_declaration`, `interface_declaration`, `class_declaration`, `call_expression`
- app.unpkg.com/tree-sitter-wasms@latest/files/out — confirmed tree-sitter-typescript.wasm (2.34 MB), tree-sitter-tsx.wasm (2.41 MB), tree-sitter-python.wasm (476 kB) all present
- Bun executables documentation (bun.com/docs/bundler/executables) — confirmed `import ... with { type: "file" }` WASM embedding, `Bun.embeddedFiles` API; confirmed WASM compile issue (#6567) was closed/fixed June 2025
- drizzle-orm operators documentation — confirmed `gt()`, `lt()`, `lte()`, `gte()` work with integer timestamp columns
- parsiya.net "Knee Deep in tree-sitter Queries" — confirmed constraint: "queries cannot skip nodes"; parent chain walk is the required pattern for caller identification

### Secondary (MEDIUM confidence)

- dev.to/shrsv tree-sitter query examples — query.matches() return shape `{ pattern, captures: [{ name, node }] }` confirmed with Node.js-style tree-sitter (binding API matches web-tree-sitter)
- tree-sitter-wasms GitHub (Gregoor/tree-sitter-wasms) — confirmed import path pattern `import wasm from "tree-sitter-wasms/out/tree-sitter-typescript.wasm"`

### Tertiary (LOW confidence)

- Medium/@shsax CodeRAG article — DFS tree traversal for call graph extraction; confirmed the "traverse to find call_expression then walk up" approach but implementation details are language-specific

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — web-tree-sitter 0.24.7 pin confirmed by bug report; tree-sitter-wasms WASM files confirmed present; drizzle operators confirmed in docs
- Architecture: HIGH — Parser.init locateFile pattern confirmed; Language.load Uint8Array confirmed; two-pass query+walk confirmed by tree-sitter query constraint article
- Pitfalls: HIGH — CWD pitfall is established Phase 1 pattern; type regression confirmed by GitHub issue; locateFile required confirmed by README; arrow function pattern confirmed by grammar file

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (30 days — web-tree-sitter is stable; grammar node types rarely change)
