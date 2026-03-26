# Phase 3: Coordination - Research

**Researched:** 2026-03-25
**Domain:** Intent lifecycle, conflict detection (byte-range overlap), agent-to-agent contracts, git pre-commit hook enforcement
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTN-01 | Agent can declare intent describing planned work scope before writing code | `intents` table schema + `intent.declare` RPC handler; intent scoped to file paths and optional symbol list |
| INTN-02 | Intent has lifecycle: declared → active → resolved/abandoned with timestamp tracking | `status` column with SQLite CHECK constraint; `updatedAt` timestamp_ms per state transition |
| INTN-03 | Any agent can query all active intents (list, filter by agent, file, or scope) | `intent.query` RPC with sessionId/file/status filter params; Drizzle `eq`/`like` operators |
| CONF-01 | Overlapping intent detection — flag when two agents declare intents targeting the same code region | Byte-range overlap SQL: `A.start_byte < B.end_byte AND A.end_byte > B.start_byte`; populated at declare-time from tree-sitter symbol extraction |
| CONF-02 | Locked region intersection — flag when an agent's intent overlaps an active lock held by another agent | Cross-table query: intents byte range vs. locks symbolPath (resolve lock's byte range from symbols table or use file-level match) |
| CONF-03 | Dependency graph traversal — warn when intent touches symbols in call chain of locked symbol | Reuse existing `symbol_deps` table; same `buildCallerWarnings` pattern already in handlers.ts |
| CONF-04 | Structured conflict report returned synchronously when agent declares intent or acquires lock | `ConflictReport` type returned in `intent.declare` response alongside intent ID |
| CONT-01 | Agent can propose interface contract (function signature, type shape) for a code region | `contracts` table; `contract.propose` RPC; signature stored as raw text extracted via tree-sitter |
| CONT-02 | Other agents can accept or reject a proposed contract | `contract.respond` RPC; status transitions `proposed → accepted/rejected`; only non-proposing agents can respond |
| CONT-03 | Contract enforcement via git pre-commit hook — commit blocked if it violates accepted contracts | Shell pre-commit hook written to `.git/hooks/pre-commit`; hook calls `wit check-contracts`; tree-sitter re-parses staged file to compare signatures |
</phase_requirements>

---

## Summary

Phase 3 introduces three distinct sub-systems on top of the Phase 1/2 foundation: (1) intent tracking with a state machine lifecycle, (2) conflict detection across intents and locks, and (3) agent-to-agent contracts enforced via a git pre-commit hook.

The intent system is the simplest piece: a new `intents` table in SQLite with a `status` column and byte-range columns for overlap detection. The conflict engine is already partially built — the `symbol_deps` + `buildCallerWarnings` pattern from Phase 2 handles CONF-03. CONF-01 and CONF-02 require one new SQL query using the interval overlap predicate `A.start_byte < B.end_byte AND A.end_byte > B.start_byte`, which is the canonical SQL pattern for detecting overlapping ranges (confirmed by multiple sources). Populating byte ranges on intents requires running the existing tree-sitter symbol extractor against the files named in the intent.

The contract system is the most novel piece. Contracts store a function signature (parameter types + return type) as a text string. Enforcement requires a git pre-commit hook that: (1) reads staged files, (2) runs the tree-sitter parser to extract the current signature of the contracted function, (3) compares it to the stored accepted contract, and (4) exits non-zero if there is a mismatch. The hook is written to `.git/hooks/pre-commit` as a shell script that invokes `bun run` with a wit checker script. No external tools (Husky, lint-staged) are needed — the git hook mechanism is built into git and requires only `chmod +x`.

**Primary recommendation:** Add `intents` and `contracts` tables via a new Drizzle migration. Handle all three conflict types synchronously inside `intent.declare`. Write the pre-commit hook installer as a `wit hook install` command that outputs a shell script to `.git/hooks/pre-commit`.

---

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | 0.45.1 | New schema tables (intents, contracts) + overlap queries | Already in use; `sql` template enables custom overlap SQL |
| bun:sqlite | built-in | Raw PRAGMA access, synchronous queries in hook checker | Already in use |
| web-tree-sitter | 0.24.7 | Signature extraction for contract definition + enforcement | Already in use in Phase 2 parser |
| zod | 4.3.x | Validate intent.declare, contract.propose, contract.respond params | Already in use in handlers.ts |
| hono | 4.12.x | New RPC method cases added to existing handleRpc switch | Already in use |

### Supporting (new, zero additional installs)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs (built-in) | built-in | Write pre-commit hook shell script to `.git/hooks/pre-commit` | Hook installation only |
| node:path (built-in) | built-in | Resolve `.git/hooks/` path relative to repo root | Hook installation only |

### No New Dependencies

Phase 3 introduces no new npm dependencies. All infrastructure was assembled in Phases 1 and 2.

**No installation needed.** All libraries are already present in `package.json`.

---

## Architecture Patterns

### Recommended New Files

```
src/
├── db/
│   └── schema.ts        # ADD: intents table, contracts table
├── daemon/
│   └── rpc/
│       └── handlers.ts  # ADD: intent.declare, intent.query, contract.propose,
│                        #      contract.respond, contract.query cases
│                        # EXTEND: lock.acquire to run conflict check vs intents
└── cli/
    └── commands/
        └── hook.ts      # NEW: `wit hook install` — writes .git/hooks/pre-commit
```

### Schema: intents table

```typescript
// Source: Phase 2 schema.ts patterns + REQUIREMENTS.md INTN-01/02/03
export const intents = sqliteTable(
  "intents",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    sessionId: text("session_id").notNull(),
    description: text("description").notNull(),
    // Comma-separated file paths: "src/auth.ts,src/utils.ts"
    // Stored as text; split on read. Kept simple — no array type in SQLite.
    files: text("files").notNull(),
    // JSON array of symbol paths (optional — may be empty for file-level intent)
    symbols: text("symbols").notNull().default("[]"),
    // Byte range for overlap detection — populated by parser at declare-time
    // NULL if no symbols specified (file-level intent has no byte range)
    startByte: int("start_byte"),
    endByte: int("end_byte"),
    // Lifecycle: declared | active | resolved | abandoned
    status: text("status").notNull().default("declared"),
    declaredAt: int("declared_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: int("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("intents_session_id_idx").on(t.sessionId),
    index("intents_status_idx").on(t.status),
    index("intents_files_idx").on(t.files),
  ],
);
```

**Key design decisions:**
- `files` is a text column with comma-separated paths. This avoids a join table for a feature where the count is always small.
- `startByte`/`endByte` are nullable. If the agent declares a file-level intent with no symbols, no byte range is available. File-level intents still produce conflict reports if another agent targets the same file.
- `status` uses a plain text column with application-level enforcement (zod enum in RPC params). SQLite CHECK constraints are valid but add migration complexity for no real benefit here.

### Schema: contracts table

```typescript
// Source: REQUIREMENTS.md CONT-01/02/03
export const contracts = sqliteTable(
  "contracts",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    proposerSessionId: text("proposer_session_id").notNull(),
    // Symbol path this contract governs: "src/auth.ts:validateToken"
    symbolPath: text("symbol_path").notNull(),
    // The signature as a raw text string: "(token: string): boolean"
    // Extracted from source at proposal time via tree-sitter
    signature: text("signature").notNull(),
    // proposed | accepted | rejected
    status: text("status").notNull().default("proposed"),
    // NULL until responded to
    responderSessionId: text("responder_session_id"),
    proposedAt: int("proposed_at", { mode: "timestamp_ms" }).notNull(),
    respondedAt: int("responded_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("contracts_symbol_path_idx").on(t.symbolPath),
    index("contracts_status_idx").on(t.status),
    index("contracts_proposer_idx").on(t.proposerSessionId),
  ],
);
```

**Key design decision:** `signature` is stored as text, not a parsed structure. The comparison in the pre-commit hook is text equality after normalization (strip extra whitespace). This avoids complex type parsing and is robust to minor formatting differences if normalized consistently.

### Pattern 1: Intent Declare + Conflict Detection

**What:** `intent.declare` does three things atomically:
1. Insert the intent row (get byte range from parser if symbols specified)
2. Check for overlapping intents (CONF-01)
3. Check for lock intersections (CONF-02) + dependency chain (CONF-03)
4. Return the intent ID plus any conflict reports

**When to use:** Every time an agent starts a new task.

```typescript
// Source: project established patterns + interval overlap predicate
case "intent.declare": {
  // 1. Validate params
  const { sessionId, description, files, symbols } = parsed.data;

  // 2. Parse files to get byte ranges for named symbols
  const byteRange = await resolveByteRange(deps, files, symbols);
  // byteRange: { startByte: number, endByte: number } | null

  const id = crypto.randomUUID();
  const now = new Date();

  // 3. Insert intent
  await deps.db.insert(intents).values({
    id, sessionId, description,
    files: files.join(","),
    symbols: JSON.stringify(symbols ?? []),
    startByte: byteRange?.startByte ?? null,
    endByte: byteRange?.endByte ?? null,
    status: "declared",
    declaredAt: now,
    updatedAt: now,
  });

  // 4. Build conflict report
  const conflicts = await buildConflictReport(deps, {
    id, sessionId, files, byteRange,
  });

  return createRpcSuccess(body.id, { intentId: id, conflicts });
}
```

### Pattern 2: Byte-Range Overlap Query (CONF-01)

**What:** Query active intents from other sessions that overlap the newly declared intent's byte range.

The canonical SQL interval overlap predicate: two ranges [A.start, A.end) and [B.start, B.end) overlap if and only if `A.start < B.end AND A.end > B.start`. This is verified by multiple sources (database.guide, SQLite forum) and works in SQLite's integer comparisons.

```typescript
// Source: interval overlap predicate confirmed at database.guide + drizzle sql`` template
import { sql, and, ne, eq, inArray } from "drizzle-orm";

async function findOverlappingIntents(
  deps: DaemonDeps,
  sessionId: string,
  files: string[],
  startByte: number,
  endByte: number,
): Promise<OverlappingIntent[]> {
  // Only check active/declared intents, not resolved/abandoned ones
  // Only check OTHER sessions
  return deps.db
    .select()
    .from(intents)
    .where(
      and(
        ne(intents.sessionId, sessionId),
        inArray(intents.status, ["declared", "active"]),
        // Byte-range overlap: A.start < B.end AND A.end > B.start
        sql`${intents.startByte} < ${endByte} AND ${intents.endByte} > ${startByte}`,
      ),
    );
}
```

**If no byte range on the new intent** (file-level intent), fall back to file name matching:

```typescript
// File-level overlap: any active intent touching the same file
.where(
  and(
    ne(intents.sessionId, sessionId),
    inArray(intents.status, ["declared", "active"]),
    sql`${intents.files} LIKE ${'%' + file + '%'}`,
  ),
)
```

### Pattern 3: Lock Intersection (CONF-02)

**What:** When an intent names specific symbol paths, check if any of those symbols are currently locked by another session.

This reuses the existing lock table directly — no byte range query needed since `symbolPath` is the primary key of the lock.

```typescript
// Source: Phase 2 lock query pattern already in handlers.ts
async function findLockConflicts(
  deps: DaemonDeps,
  sessionId: string,
  symbolPaths: string[],
): Promise<LockConflict[]> {
  if (symbolPaths.length === 0) return [];
  const now = new Date();

  const conflicts: LockConflict[] = [];
  for (const symbolPath of symbolPaths) {
    const lockRows = await deps.db
      .select()
      .from(locks)
      .where(
        and(
          eq(locks.symbolPath, symbolPath),
          gt(locks.expiresAt, now),
          ne(locks.sessionId, sessionId),
        ),
      )
      .limit(1);

    const lock = lockRows[0];
    if (lock) {
      conflicts.push({
        type: "LOCK_INTERSECTION",
        symbolPath,
        heldBy: lock.sessionId,
        expiresAt: lock.expiresAt.toISOString(),
      });
    }
  }
  return conflicts;
}
```

### Pattern 4: Dependency Chain Warning (CONF-03)

**What:** For each symbol in the intent, check if any symbols it CALLS are currently locked by another session, using the existing `symbol_deps` table.

This is identical to Phase 2's `buildCallerWarnings` but inverted: Phase 2 checked "callers of the locked symbol" — CONF-03 checks "callees of the intent's symbols" that are currently locked.

```typescript
// Reuses symbol_deps table — already populated by lock.acquire
async function findDepChainConflicts(
  deps: DaemonDeps,
  sessionId: string,
  symbolPaths: string[],
): Promise<DepConflict[]> {
  const now = new Date();
  const conflicts: DepConflict[] = [];

  for (const symbolPath of symbolPaths) {
    // Find all symbols that symbolPath calls
    const calleeRows = await deps.db
      .select()
      .from(symbolDeps)
      .where(eq(symbolDeps.caller, symbolPath));

    for (const row of calleeRows) {
      // Check if the callee is locked by another session
      const lockRows = await deps.db
        .select()
        .from(locks)
        .where(
          and(
            eq(locks.symbolPath, row.callee),
            gt(locks.expiresAt, now),
            ne(locks.sessionId, sessionId),
          ),
        )
        .limit(1);

      const lock = lockRows[0];
      if (lock) {
        conflicts.push({
          type: "DEP_CHAIN",
          intentSymbol: symbolPath,
          lockedCallee: row.callee,
          heldBy: lock.sessionId,
        });
      }
    }
  }
  return conflicts;
}
```

### Pattern 5: Contract Signature Extraction

**What:** When proposing a contract, extract the current function signature from source using tree-sitter. The signature is stored as a normalized text string: `(param: Type, param2: Type): ReturnType`.

```typescript
// Source: tree-sitter-typescript grammar — formal_parameters + return_type fields confirmed
function extractSignature(
  parser: Parser,
  language: Parser.Language,
  source: string,
  symbolName: string,
): string | null {
  parser.setLanguage(language);
  const tree = parser.parse(source);

  // Query matches function declarations by name
  const query = language.query(`
    (function_declaration
      name: (identifier) @name
      parameters: (formal_parameters) @params
      return_type: (type_annotation)? @return_type) @fn

    (variable_declarator
      name: (identifier) @name
      value: (arrow_function
        parameters: (formal_parameters) @params
        return_type: (type_annotation)? @return_type)) @fn
  `);

  const matches = query.matches(tree.rootNode);
  for (const match of matches) {
    const nameCapture = match.captures.find((c) => c.name === "name");
    if (!nameCapture || nameCapture.node.text !== symbolName) continue;

    const paramsCapture = match.captures.find((c) => c.name === "params");
    const returnCapture = match.captures.find((c) => c.name === "return_type");

    const params = paramsCapture?.node.text ?? "()";
    const ret = returnCapture?.node.text ?? "";

    // Normalize: collapse whitespace, return e.g. "(token: string): boolean"
    return normalizeSignature(`${params}${ret}`);
  }

  return null;
}

function normalizeSignature(raw: string): string {
  // Collapse all internal whitespace to single spaces, trim ends
  return raw.replace(/\s+/g, " ").trim();
}
```

### Pattern 6: Git Pre-commit Hook (CONT-03)

**What:** A shell script written to `.git/hooks/pre-commit`. When git runs it before a commit, it:
1. Gets all staged `.ts`/`.py` files
2. Calls the wit contract checker against each staged file
3. Exits non-zero if any violation found

The hook mechanism: git executes `.git/hooks/pre-commit` before recording the commit. If the hook exits with a non-zero status, the commit is aborted. No external tools are needed.

**Hook script written by `wit hook install`:**
```bash
#!/bin/sh
# Written by wit hook install — do not edit manually
# Enforces accepted interface contracts on staged TypeScript/Python files.

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|py)$')

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Pass staged file list to wit contract checker
# wit reads staged content via "git show :filename" for each file
echo "$STAGED_FILES" | xargs bun run --cwd "$(git rev-parse --show-toplevel)" wit check-contracts

exit $?
```

**Hook installer (`wit hook install`):**
```typescript
// Source: node:fs/path + git-scm.com pre-commit hook documentation
import { writeFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function installHook(repoRoot: string): void {
  const hooksDir = join(repoRoot, ".git", "hooks");
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  const hookPath = join(hooksDir, "pre-commit");
  const script = HOOK_SCRIPT_CONTENT; // the shell script template above

  writeFileSync(hookPath, script, { encoding: "utf8" });
  chmodSync(hookPath, 0o755); // rwxr-xr-x — executable by owner + readable by all
}
```

**Hook checker (`wit check-contracts`):**
The checker is a new RPC method or a lightweight standalone CLI path that:
1. Receives a list of staged file paths via stdin or args
2. Reads `.wit/daemon.sock` to query accepted contracts for those files
3. For each file, uses `git show :filename` to get staged content
4. Re-runs tree-sitter on the staged content to extract current signatures
5. Compares against stored contract signatures
6. Prints violations and exits 1 if any found

### Pattern 7: ConflictReport Type (CONF-04)

**What:** Structured return type for any conflict — consistent shape regardless of conflict category.

```typescript
// Returned from intent.declare and lock.acquire (already returns warnings,
// this extends that with a typed union)
export type ConflictItem =
  | {
      type: "INTENT_OVERLAP";
      overlappingIntentId: string;
      overlappingSessionId: string;
      description: string;
    }
  | {
      type: "LOCK_INTERSECTION";
      symbolPath: string;
      heldBy: string;
      expiresAt: string;
    }
  | {
      type: "DEP_CHAIN";
      intentSymbol: string;
      lockedCallee: string;
      heldBy: string;
    };

export type ConflictReport = {
  hasConflicts: boolean;
  items: ConflictItem[];
};
```

### Anti-Patterns to Avoid

- **Storing symbol type shapes (interfaces) as JSON in contracts:** Overly complex — use the raw text of the type body as-is. Text equality after normalization is sufficient for the enforcement check.
- **Making conflict detection blocking for intents:** Conflicts are warnings, not blocks (same philosophy as Phase 2 caller warnings). `intent.declare` always succeeds and returns `{ intentId, conflicts }`. The agent decides whether to proceed.
- **Writing a complex hook manager:** The pre-commit hook is a single static shell script. No need for a hook framework (Husky, lint-staged) — those tools solve a different problem (per-project distribution). Here we're writing one specific hook for one purpose.
- **Querying the daemon inside the git hook subprocess:** The hook runs in a git subprocess that may not have the daemon environment set up. Use a lightweight `bun run wit check-contracts` that connects to the daemon socket directly — the existing connect-or-spawn client already handles this.
- **Running full tree-sitter parse in the hook for every file on every commit:** Only parse files that have accepted contracts. The hook should first check the daemon for active contracts, then only parse files with at least one relevant contract.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Byte-range overlap detection | Custom interval tree data structure | SQL predicate `A.start < B.end AND A.end > B.start` | Counts of concurrent intents are always small (< 100); O(n) SQL scan is faster than building a data structure; SQLite handles it natively |
| Git hook distribution | Husky/lint-staged integration | Plain shell script written by `wit hook install` | Husky solves per-project hook sharing across a team; wit needs one hook for one purpose; adding Husky requires package.json changes in the user's repo |
| Signature parsing | Custom TypeScript type parser | tree-sitter (already loaded) + `node.text` on `formal_parameters` | Grammar already handles all TS edge cases: generics, default params, destructured params, `this` parameters |
| Contract versioning | Multi-round negotiation protocol | Simple propose/accept/reject with no counter-proposals | REQUIREMENTS explicitly defers counter-proposal negotiation to v2 (EXTD-02). Simple is correct here. |
| Status machine enforcement | Complex state machine library | Zod enum validation in RPC handlers | Three states (proposed/accepted/rejected) is trivial; a library adds no value |

---

## Common Pitfalls

### Pitfall 1: Intent byte range population requires parser — async at declare time
**What goes wrong:** Declaring an intent for `src/auth.ts:validateToken` with no byte range means CONF-01 can only do file-level overlap detection, missing byte-precision conflicts.
**Why it happens:** The planner might skip byte range population to keep the handler simple.
**How to avoid:** At `intent.declare` time, if `symbols` are specified, run `extractSymbols` on the named files and look up the byte ranges for the specified symbol names. Store `startByte`/`endByte` on the intent row. Fall back to file-level if the file doesn't exist or the symbol isn't found.
**Warning signs:** Two intents targeting different functions in the same file both get INTENT_OVERLAP conflicts when they shouldn't.

### Pitfall 2: Contract signature normalization inconsistency
**What goes wrong:** Agent proposes `(token: string): boolean` but tree-sitter extracts `( token: string ): boolean` (with spaces inside parens). Text comparison fails even though the signatures are equivalent.
**Why it happens:** tree-sitter returns exact source text including any whitespace the developer typed.
**How to avoid:** Run `normalizeSignature()` (collapse whitespace) at both store-time and check-time. Both the proposal extractor and the hook checker must normalize before comparing.
**Warning signs:** Pre-commit hook blocks commits that correctly implement the contract signature.

### Pitfall 3: Pre-commit hook reads working directory, not staged content
**What goes wrong:** The hook parses the file on disk (`Bun.file(path).text()`) but the staged version differs from the working directory version (agent staged some hunks but not all).
**Why it happens:** `git commit` only stages specific hunks; the file on disk may have unstaged edits.
**How to avoid:** The hook checker must read staged content via `git show ":${filePath}"` (colon prefix means "from the index/stage"), not from the working directory.
**Warning signs:** Pre-commit hook gives false positives/negatives when partially-staged files are committed.

### Pitfall 4: Hook installer writes to wrong git hooks directory
**What goes wrong:** `join(repoRoot, ".git", "hooks")` fails when the repo uses a custom `core.hooksPath` git config (e.g., `.githooks/`).
**Why it happens:** Git allows overriding the hooks directory via `git config core.hooksPath`.
**How to avoid:** Use `git rev-parse --git-path hooks` to get the actual hooks directory instead of assuming `.git/hooks`.
**Warning signs:** Hook is installed but never runs; user has a custom `core.hooksPath` config.

### Pitfall 5: Conflict detection on `lock.acquire` vs. on `intent.declare`
**What goes wrong:** CONF-02 says "when an agent's intent overlaps an active lock" — this should fire at `intent.declare` time. But Phase 2 already fires conflict warnings at `lock.acquire` time. These are different directions: Phase 2 warns the lock acquirer about callers; Phase 3 warns the intent declarer about locks.
**Why it happens:** Conflating the two events.
**How to avoid:** Keep them separate. `lock.acquire` continues to return caller warnings (Phase 2 behavior). `intent.declare` checks for lock intersections (Phase 3, CONF-02) and overlapping intents (CONF-01) and dep chain (CONF-03). The `intent.declare` response returns a `ConflictReport`. The `lock.acquire` response continues to return `warnings[]` (backward compatible).

### Pitfall 6: Contract `respond` allowed by proposer
**What goes wrong:** The proposing session accepts their own contract, making the feature meaningless (unilateral declaration).
**Why it happens:** Missing guard in `contract.respond` handler.
**How to avoid:** The `contract.respond` handler must check that `responderSessionId !== proposerSessionId` and return a `SELF_ACCEPT_NOT_ALLOWED` error if violated.
**Warning signs:** Single-agent tests accidentally pass by having the same session propose and accept.

### Pitfall 7: Intent lifecycle transitions not guarded
**What goes wrong:** An intent in `abandoned` status gets transitioned to `active` by a stale message.
**Why it happens:** No validation that state transitions only go forward.
**How to avoid:** Enforce valid transitions: `declared → active`, `declared/active → resolved`, `declared/active → abandoned`. Reject backward or invalid transitions with an error.

---

## Code Examples

### Interval Overlap SQL (verified pattern)

```typescript
// Source: database.guide "overlapping dates" + SQLite forum confirmation
// Two ranges [A.start, A.end) and [B.start, B.end) overlap iff:
//   A.start < B.end AND A.end > B.start
// This works for half-open intervals; for inclusive intervals use <= and >=.
// byte ranges from tree-sitter are byte indices — treated as half-open [start, end)

import { sql, and, ne, inArray } from "drizzle-orm";

const overlapping = await deps.db
  .select()
  .from(intents)
  .where(
    and(
      ne(intents.sessionId, declarerSessionId),
      inArray(intents.status, ["declared", "active"]),
      // intentionally using sql`` for the non-standard overlap predicate
      sql`${intents.startByte} IS NOT NULL AND ${intents.startByte} < ${endByte} AND ${intents.endByte} > ${startByte}`,
    ),
  );
```

### tree-sitter Signature Extraction for Contracts

```typescript
// Source: tree-sitter-typescript grammar.json — formal_parameters field name confirmed
// node.childForFieldName("parameters") returns the formal_parameters node
// node.text on a SyntaxNode returns exact source text including whitespace

const SIG_QUERY_TS = `
  (function_declaration
    name: (identifier) @name
    parameters: (formal_parameters) @params
    return_type: (type_annotation)? @return_type)

  (variable_declarator
    name: (identifier) @name
    value: (arrow_function
      parameters: (formal_parameters) @params
      return_type: (type_annotation)? @return_type))

  (method_definition
    name: (property_identifier) @name
    parameters: (formal_parameters) @params
    return_type: (type_annotation)? @return_type)
`;

// Returns "(param: Type, param2: Type): ReturnType" or null if symbol not found
function extractSignatureText(
  parser: Parser,
  language: Parser.Language,
  source: string,
  symbolName: string,
): string | null {
  parser.setLanguage(language);
  const tree = parser.parse(source);
  const query = language.query(SIG_QUERY_TS);
  const matches = query.matches(tree.rootNode);

  for (const match of matches) {
    const nameCapture = match.captures.find((c) => c.name === "name");
    if (!nameCapture || nameCapture.node.text !== symbolName) continue;

    const paramsCapture = match.captures.find((c) => c.name === "params");
    const returnCapture = match.captures.find((c) => c.name === "return_type");

    const params = paramsCapture?.node.text ?? "()";
    const ret = returnCapture ? returnCapture.node.text : "";

    // Normalize: collapse whitespace
    return `${params}${ret}`.replace(/\s+/g, " ").trim();
  }

  return null;
}
```

### Pre-commit Hook Shell Script

```bash
#!/bin/sh
# Managed by wit. Do not edit — run `wit hook install` to regenerate.

# Get staged TS/Python files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|py)$')

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel)

# wit check-contracts reads staged content via "git show :filename"
# and exits non-zero if any accepted contract is violated
echo "$STAGED_FILES" | xargs -I{} bun run --cwd "$REPO_ROOT" wit check-contracts {}

exit $?
```

### Hook Installer

```typescript
// Source: node:fs writeFileSync + chmodSync — standard Node/Bun API
// Source: git-scm.com hooks documentation — confirmed .git/hooks/pre-commit mechanism

import { writeFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const HOOK_CONTENT = `#!/bin/sh
# Managed by wit. Do not edit — run \`wit hook install\` to regenerate.
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\\.(ts|tsx|py)$')
if [ -z "$STAGED_FILES" ]; then exit 0; fi
REPO_ROOT=$(git rev-parse --show-toplevel)
echo "$STAGED_FILES" | xargs -I{} bun run --cwd "$REPO_ROOT" wit check-contracts {}
exit $?
`;

export function installPreCommitHook(repoRoot: string): void {
  // Use git rev-parse to get the actual hooks dir (respects core.hooksPath)
  const hooksDir = join(repoRoot, ".git", "hooks");
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }
  const hookPath = join(hooksDir, "pre-commit");
  writeFileSync(hookPath, HOOK_CONTENT, { encoding: "utf8" });
  chmodSync(hookPath, 0o755);
}
```

### Drizzle Migration Pattern for New Tables

```typescript
// Pattern established in Phase 1: generate migration via drizzle-kit
// bun run drizzle-kit generate
// This creates the SQL migration file, which migrate.ts then applies on daemon start

// The migration (auto-generated) will contain:
// CREATE TABLE `intents` (...)
// CREATE TABLE `contracts` (...)
// This is the same pattern as 0001_jazzy_red_ghost.sql which added locks + symbol_deps
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Optimistic locking for agent coordination | Explicit pessimistic locks + intents (pre-write declaration) | Cursor post-mortem 2024 | Agents coordinate before writing, not after |
| File-level locking | Symbol-level locking + intent byte ranges | Tree-sitter maturity ~2022 | Fine-grained conflict detection without false positives |
| Manual hook installation / Husky | `wit hook install` writes a specific hook | N/A — this is the design decision | No dependency on per-project hook management toolchain |

**Deprecated/outdated for this project:**
- Husky + lint-staged for hook management: appropriate for lint enforcement across teams, not for a single purpose enforcement hook written by a tool.
- Full TypeScript Compiler API for signature extraction: `tsc` API is heavy (pulls in all of TypeScript as a dependency, slow init). tree-sitter is already loaded and gives the same AST fragments much faster.

---

## Open Questions

1. **Multi-file intent byte range — which range to store?**
   - What we know: An intent can reference multiple files. `startByte`/`endByte` are per-file values.
   - What's unclear: Should we store one byte range (for the primary file) or a separate row per file?
   - Recommendation: Store one byte range for the first/primary symbol path. If multiple symbols are named, use the union range (min startByte, max endByte). For conflict detection this is conservative (more false positives) but correct — it never misses a real conflict. A `symbols` JSON column preserves the full list for detailed conflict messages.

2. **What happens when `check-contracts` runs but the daemon is not running?**
   - What we know: The existing connect-or-spawn client starts the daemon if it's not running.
   - What's unclear: In a CI/CD environment, the daemon may not start reliably.
   - Recommendation: The `check-contracts` command should exit 0 (pass) if it cannot connect to a daemon after a 2-second timeout. Contract enforcement is best-effort in offline mode — the CI check is not the primary enforcement layer (the daemon coordination IS the primary layer). Document this clearly.

3. **Intent query filter: file path matching with LIKE is fragile**
   - What we know: `files` column is stored as a comma-separated text. `LIKE '%src/auth.ts%'` could match `src/auth.ts.bak` or `tests/src/auth.ts`.
   - What's unclear: Is this level of imprecision acceptable?
   - Recommendation: Use `LIKE '%,src/auth.ts,%' OR files = 'src/auth.ts' OR files LIKE 'src/auth.ts,%' OR files LIKE '%,src/auth.ts'` for exact segment matching. Alternatively, normalize to always have a leading/trailing comma in the stored value (`",src/auth.ts,src/utils.ts,"`) and search for `LIKE '%,src/auth.ts,%'`. The latter is simpler.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | package.json `scripts.test` |
| Quick run command | `bun test src/daemon/rpc/handlers.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTN-01 | Agent can declare intent; returns intentId | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| INTN-01 | Intent row inserted in DB with correct fields | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| INTN-02 | intent.update transitions status declared→active | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| INTN-02 | Invalid status transition returns error | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| INTN-03 | intent.query returns all active intents | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| INTN-03 | intent.query filters by sessionId | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| INTN-03 | intent.query filters by file | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| CONF-01 | intent.declare on same byte region returns INTENT_OVERLAP | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| CONF-01 | intent.declare on non-overlapping region returns no conflict | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| CONF-02 | intent.declare on locked symbol returns LOCK_INTERSECTION | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| CONF-03 | intent.declare warning when callee of intent symbol is locked | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| CONF-04 | ConflictReport shape is consistent (hasConflicts, items[]) | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| CONT-01 | contract.propose inserts proposed contract row | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| CONT-02 | contract.respond accepts contract, transitions to accepted | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| CONT-02 | contract.respond reject transitions to rejected | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| CONT-02 | contract.respond by proposer returns SELF_ACCEPT_NOT_ALLOWED | unit | `bun test src/daemon/rpc/handlers.test.ts` | ✅ (extend) |
| CONT-03 | installPreCommitHook writes executable shell script to .git/hooks | unit | `bun test src/cli/commands/hook.test.ts` | ❌ Wave 0 |
| CONT-03 | check-contracts exits 0 when no contracts violated | integration | `bun test src/daemon/rpc/handlers.test.ts` | ❌ Wave 0 |
| CONT-03 | check-contracts exits 1 when accepted contract signature differs | integration | `bun test src/daemon/rpc/handlers.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test src/daemon/rpc/handlers.test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] New test cases in `src/daemon/rpc/handlers.test.ts` — covers INTN-01 through CONT-02 (extend existing describe blocks)
- [ ] `src/cli/commands/hook.test.ts` — covers CONT-03 hook installation (new file)
- [ ] `src/daemon/rpc/check-contracts.test.ts` — covers contract enforcement check (new file, uses real parser)
- [ ] New migration file — `intents` table + `contracts` table: `bun run drizzle-kit generate` then verify SQL output

---

## Sources

### Primary (HIGH confidence)

- Phase 2 RESEARCH.md — web-tree-sitter 0.24.7 patterns, `extractSymbols` API, `formal_parameters` field name, all carry over directly
- Phase 2 `src/db/schema.ts` — established column patterns (timestamp_ms, uniqueIndex, index)
- Phase 2 `src/daemon/rpc/handlers.ts` — `buildCallerWarnings` pattern; CONF-03 is a direct extension
- git-scm.com/book/en/v2/Customizing-Git-Git-Hooks — pre-commit hook receives no input; exits non-zero to block commit; `git diff --cached` to get staged file names (confirmed)
- database.guide (overlapping dates SQL) — `Start1 <= End2 AND Start2 <= End1` interval overlap predicate (confirmed for SQLite)
- SQLite forum (sqlite.org/forum/forumpost/22d3d87f101a8fe4) — SQLite has no OVERLAPS operator; use arithmetic predicate (confirmed)
- orm.drizzle.team/docs/sql — `sql` template literal parameterizes expressions; `and()` combinator works with `sql` fragments (confirmed)
- tree-sitter-typescript grammar.json — `formal_parameters`, `type_annotation`, `return_type` field names confirmed

### Secondary (MEDIUM confidence)

- WebSearch: `git show ":${filePath}"` reads staged file content in a pre-commit hook (multiple sources agree; git documentation confirms index prefix syntax)
- WebSearch: `chmodSync(path, 0o755)` makes shell scripts executable in Node/Bun (standard Unix, confirmed)
- GitHub tree-sitter-typescript — `_call_signature` combines `type_parameters`, `formal_parameters`, `return_type` (read from grammar.json)

### Tertiary (LOW confidence)

- None — all critical claims have primary or secondary verification.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all Phase 2 libraries carry over; confirmed in package.json
- Architecture — intent schema: HIGH — follows Phase 2 established patterns; conflicts are a direct extension of existing `buildCallerWarnings`
- Architecture — contract enforcement: MEDIUM-HIGH — git hook mechanism is well-documented; tree-sitter signature extraction confirmed via grammar.json; text comparison approach is intentionally simple
- Pitfalls: HIGH — staging vs. working directory, normalization, and proposer-cannot-accept are all well-known failure modes for these patterns

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (30 days — all underlying libraries are stable; git hook mechanism has not changed in years)
