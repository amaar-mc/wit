---
phase: 02-semantic-locking
verified: 2026-03-25T00:00:00Z
status: passed
score: 4/4 must-haves verified
human_verification:
  - test: "Confirm session-disconnect lock auto-release behavior is acceptable via TTL"
    expected: "When an agent process crashes or disconnects without calling lock.release, its locks expire within TTL window (default 30 min). No real-time disconnect detection exists."
    why_human: "The daemon uses stateless HTTP over Unix socket — no persistent connection exists to detect disconnect in real time. LOCK-02 says 'auto-releases on session disconnect'; the implementation satisfies this via TTL expiry (30s cleanup loop). Whether TTL-based release is an acceptable substitute for true disconnect detection requires a product decision, not code verification."
---

# Phase 2: Semantic Locking Verification Report

**Phase Goal:** Agents can acquire and release symbol-level locks (functions, types, exports) using Tree-sitter AST parsing for TypeScript/JavaScript and Python, with TTL-based auto-cleanup and a full dependency graph for caller awareness
**Verified:** 2026-03-25
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Agent can lock a specific function by symbol path (e.g. `src/auth.ts:validateToken`) — not the whole file | VERIFIED | `lock.acquire` handler in `handlers.ts` uses `symbolPath` with required `:` separator (zod refine), inserts into `locks` table keyed by `symbol_path`; 8 handler tests confirm acquire/conflict/idempotency |
| 2 | A lock auto-releases via TTL and is cleared by a background daemon job without manual intervention | VERIFIED | `startTtlCleanup` in `lifecycle.ts` runs `runTtlCleanup` every 30s; `runTtlCleanup` deletes `locks where expiresAt < now()`; 3 lifecycle tests confirm expired deleted, active preserved, interval clearable |
| 3 | Any agent can query the current lock state and see what symbols are locked, by which session, and how much TTL remains | VERIFIED | `lock.query` handler filters `gt(locks.expiresAt, now)`, optionally filtered by sessionId, maps rows to include `ttlRemainingMs = expiresAt - now`; 4 query tests confirm correct filtering and TTL computation |
| 4 | When an agent attempts to touch a symbol that calls into a locked symbol, the daemon returns a warning identifying which locked symbol is in the call chain | VERIFIED | `buildCallerWarnings` in `handlers.ts` queries `symbolDeps where callee = symbolPath`, checks each caller for active locks by different sessions; warnings included in `lock.acquire` success response; 5 integration tests with real ParserService confirm warning content and chain format |

**Score:** 4/4 truths verified

---

## Required Artifacts

### Plan 01 Artifacts (LOCK-03, LOCK-04)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/parser/loader.ts` | `createParserService()` + `defaultWasmPaths()` | VERIFIED | Exports `ParserService` type, `createParserService(wasmDir, treeSitterWasm)`, `defaultWasmPaths()`. Loads `tree-sitter-typescript.wasm` and `tree-sitter-python.wasm` via `Language.load(Uint8Array)`. |
| `src/parser/symbols.ts` | `extractSymbols()` + `SymbolInfo` type | VERIFIED | Exports `SymbolInfo` type with 6 TS kinds and 2 Python kinds. Implements `getQueryString()` with TS/Python auto-detection via grammar probe. Sorts by startLine. |
| `src/parser/loader.test.ts` | Smoke tests for WASM init | VERIFIED | 3 tests: service properties, TS parse, Python parse |
| `src/parser/symbols.test.ts` | TS and Python symbol extraction tests | VERIFIED | 11 tests covering all 6 TS symbol kinds + 4 Python tests (function, class, nested, decorated) |
| `src/db/schema.ts` | `locks` + `symbolDeps` table definitions | VERIFIED | Both tables present with correct columns, `timestamp_ms` mode on `acquiredAt`/`expiresAt`, `uniqueIndex` on `locks.symbolPath`, three indexes on `symbolDeps` |

### Plan 02 Artifacts (LOCK-01, LOCK-02, LOCK-05, LOCK-06)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/daemon/rpc/handlers.ts` | `lock.acquire`, `lock.release`, `lock.query` RPC handlers | VERIFIED | All three cases present in switch; zod schemas validated; conflict detection, idempotent upsert, ownership checks, TTL computation |
| `src/daemon/lifecycle.ts` | `startTtlCleanup()` returning interval handle | VERIFIED | Exports `startTtlCleanup(db)` and `runTtlCleanup(db)`; `setupShutdownHandlers` accepts optional `cleanupInterval` |
| `src/daemon/server.ts` | `DaemonDeps` extended with `parserService` | VERIFIED | `DaemonDeps` type includes `parserService: ParserService`; import from `../parser/loader` present |
| `src/daemon/index.ts` | Parser init + TTL cleanup at startup | VERIFIED | `createParserService(wasmDir, treeSitterWasm)` called after migrations; `startTtlCleanup(db)` called; `cleanupInterval` passed to `setupShutdownHandlers` |
| `src/daemon/rpc/handlers.test.ts` | Lock handler tests | VERIFIED | 21 tests covering acquire/release/query — conflict, idempotency, expiry, LOCK_NOT_FOUND, LOCK_NOT_HELD, INVALID_REQUEST variants |
| `src/daemon/lifecycle.test.ts` | TTL cleanup loop tests | VERIFIED | 3 dedicated TTL tests: interval handle, expired deleted, active preserved |

### Plan 03 Artifacts (LOCK-07, LOCK-08)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/parser/calls.ts` | `extractCallEdges()` + `qualifyEdges()` + `CallEdge` type | VERIFIED | Exports `CallEdge`, `QualifiedCallEdge`, `extractCallEdges`, `qualifyEdges`. TS and Python queries, parent-walk boundary detection, deduplication via Set, module-level call filtering |
| `src/parser/calls.test.ts` | Call edge extraction tests for TS and Python | VERIFIED | 13 tests: TS function/method/arrow/member/module-level/nested + Python function/method/attribute/module-level + qualifyEdges (3 tests) |
| `src/daemon/rpc/handlers.ts` | `buildCallerWarnings` + `parseFileAndRefreshDeps` wired into `lock.acquire` | VERIFIED | Both helpers present; `parseFileAndRefreshDeps` parses file, deletes+inserts `symbolDeps` rows; `buildCallerWarnings` queries callers then checks each for active locks by other sessions; warnings in success response |
| `src/daemon/rpc/handlers.test.ts` | Caller warning behavior tests | VERIFIED | 5 integration tests using real ParserService + temp repo dir: symbol_deps populated, cross-session warning issued, same-session no warning, non-existent file succeeds, stale edge replacement |

---

## Key Link Verification

### Plan 01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/parser/loader.ts` | `node_modules/web-tree-sitter` | `Parser.init()` + `Language.load(Uint8Array)` | WIRED | `Parser.init({ locateFile: () => treeSitterWasm })` at line 27; `Language.load(tsBytes)` at line 36 |
| `src/parser/loader.ts` | `node_modules/tree-sitter-wasms/out/` | `Bun.file().bytes()` for WASM files | WIRED | `join(wasmDir, "tree-sitter-typescript.wasm")` and `tree-sitter-python.wasm` via `defaultWasmPaths()` pointing to `tree-sitter-wasms/out` |
| `src/parser/symbols.ts` | `src/parser/loader.ts` | Accepts `Parser.Language` from `ParserService` | WIRED | `extractSymbols(parser: Parser, language: Parser.Language, source: string)` — callers pass `service.typescript` or `service.python` |

### Plan 02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/daemon/rpc/handlers.ts` | `src/db/schema.ts` | Drizzle queries on `locks` table | WIRED | `deps.db.select().from(locks)`, `deps.db.insert(locks)`, `deps.db.delete(locks)` throughout `lock.acquire`, `lock.release`, `lock.query` |
| `src/daemon/lifecycle.ts` | `src/db/schema.ts` | `lt(locks.expiresAt, new Date())` delete | WIRED | `db.delete(locks).where(lt(locks.expiresAt, new Date())).run()` in `runTtlCleanup` |
| `src/daemon/index.ts` | `src/parser/loader.ts` | `createParserService()` called at startup | WIRED | `import { createParserService, defaultWasmPaths } from "../parser/loader"` + call at lines 17-18 |
| `src/daemon/index.ts` | `src/daemon/lifecycle.ts` | `startTtlCleanup()` + `clearInterval` on shutdown | WIRED | `startTtlCleanup(db)` at line 33; `cleanupInterval` passed to `setupShutdownHandlers` which calls `clearInterval(cleanupInterval)` |

### Plan 03 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/parser/calls.ts` | `src/parser/symbols.ts` | Uses `SymbolInfo[]` in `qualifyEdges` | WIRED | `import type { SymbolInfo } from "./symbols"` at line 2; `symbols.map(s => s.name)` in `qualifyEdges` |
| `src/daemon/rpc/handlers.ts` | `src/parser/calls.ts` | `extractCallEdges` called during `lock.acquire` | WIRED | `import { extractCallEdges, qualifyEdges } from "../../parser/calls"` at line 14; called in `parseFileAndRefreshDeps` |
| `src/daemon/rpc/handlers.ts` | `src/db/schema.ts` | Queries `symbolDeps` table | WIRED | `deps.db.delete(symbolDeps)`, `deps.db.insert(symbolDeps)` in `parseFileAndRefreshDeps`; `deps.db.select().from(symbolDeps)` in `buildCallerWarnings` |
| `src/daemon/rpc/handlers.ts` | `src/parser/symbols.ts` | `extractSymbols` called during `lock.acquire` | WIRED | `import { extractSymbols } from "../../parser/symbols"` at line 13; called in `parseFileAndRefreshDeps` |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LOCK-01 | 02-02-PLAN | Agent can acquire lock on semantic code unit identified by symbol path | SATISFIED | `lock.acquire` RPC handler inserts into `locks` table keyed by `symbolPath`; conflict detection returns `LOCK_CONFLICT` with holder info |
| LOCK-02 | 02-02-PLAN | Agent can release lock explicitly; lock auto-releases on session disconnect | SATISFIED (partial — see human note) | `lock.release` RPC deletes lock with ownership check; "session disconnect" fulfilled via TTL expiry (no real-time disconnect detection in stateless HTTP transport) |
| LOCK-03 | 02-01-PLAN | Tree-sitter WASM parsing extracts symbol boundaries for TypeScript/JavaScript | SATISFIED | `extractSymbols()` with `TS_SYMBOL_QUERY` extracts function, arrow, method, type, interface, class; 11 tests pass |
| LOCK-04 | 02-01-PLAN | Tree-sitter WASM parsing extracts symbol boundaries for Python | SATISFIED | `extractSymbols()` with `PY_SYMBOL_QUERY` extracts function_definition and class_definition; 4 Python tests pass |
| LOCK-05 | 02-02-PLAN | Every lock has TTL; daemon background job clears expired locks automatically | SATISFIED | `expiresAt` column with `timestamp_ms` mode; `startTtlCleanup` runs every 30s; 3 lifecycle tests confirm cleanup |
| LOCK-06 | 02-02-PLAN | Any agent can query lock status: what's locked, by whom, TTL remaining | SATISFIED | `lock.query` RPC returns `{symbolPath, sessionId, acquiredAt, expiresAt, ttlRemainingMs}` for all non-expired locks |
| LOCK-07 | 02-03-PLAN | Dependency graph (call edges between symbols) stored in SQLite and updated on parse | SATISFIED | `symbol_deps` table populated via `parseFileAndRefreshDeps` on every `lock.acquire`; delete+insert ensures no stale edges |
| LOCK-08 | 02-03-PLAN | Agents touching callers of a locked symbol receive a warning (not a block) | SATISFIED | `buildCallerWarnings` queries `symbolDeps` for callers of the locked symbol, checks each for active locks by other sessions; warnings array in success response (non-blocking) |

**Requirement coverage:** 8/8 LOCK-0X requirements accounted for. No orphaned requirements found.

---

## Anti-Patterns Found

No blockers or stubs detected.

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/parser/calls.ts:75,85` | `return null` in `findContainingFunctionName` | Info | Correct behavior — null signals module-level call (no containing function); consumed correctly in `extractCallEdges` to filter out module-level edges |
| `src/daemon/rpc/handlers.ts:48` | `return null` in `detectLanguageId` | Info | Correct behavior — null for unknown extension causes `parseFileAndRefreshDeps` to exit early silently, which is the intended behavior |
| `src/daemon/rpc/handlers.ts:115` | `return []` in `buildCallerWarnings` | Info | Correct early return — no callers means no warnings possible |

---

## Human Verification Required

### 1. Session Disconnect Lock Auto-Release

**Test:** Start the daemon, register two agents, have agent A acquire a lock, then kill agent A's process without calling `lock.release`. Check `lock.query` immediately after kill and again after 30+ minutes.
**Expected:** Immediately after kill, the lock still appears in `lock.query` (there is no connection state to detect the disconnect). After the TTL window (default 30 min), the lock is gone.
**Why human:** The daemon transport is stateless HTTP over Unix socket — each RPC call is an independent request with no persistent connection. There is no socket event or heartbeat mechanism to detect that the calling agent process has died. LOCK-02 says "lock auto-releases on session disconnect"; the current architecture satisfies this only via TTL. A product decision is needed to confirm whether this is acceptable or whether a heartbeat/keepalive mechanism should be added.

---

## Test Suite Results

| File | Tests | Status |
|------|-------|--------|
| `src/parser/loader.test.ts` | 3 | Pass |
| `src/parser/symbols.test.ts` | 11 | Pass |
| `src/parser/calls.test.ts` | 13 | Pass |
| `src/daemon/lifecycle.test.ts` | 7 | Pass |
| `src/daemon/rpc/handlers.test.ts` | 33+ | Pass |
| All other files | remainder | Pass |
| **Total** | **94** | **All pass** |

TypeScript: `bun run tsc --noEmit` exits clean (zero errors).

---

## Database Migration

Migration `drizzle/0001_jazzy_red_ghost.sql` creates:
- `locks` table with `symbol_path` unique index and `timestamp_ms` integer columns for TTL
- `symbol_deps` table with `callee_idx`, `caller_idx`, `file_idx` indexes

Both tables confirmed in `src/db/schema.ts` with matching Drizzle definitions.

---

## Summary

Phase 2 goal is achieved. All four observable truths from the phase goal are verified against the codebase:

1. Symbol-level locking (not file-level) is implemented and tested via the `lock.acquire` RPC with `symbolPath` format validation.
2. TTL-based auto-cleanup is implemented via `startTtlCleanup`/`runTtlCleanup` in lifecycle.ts, wired into daemon startup, with the interval cleared on shutdown.
3. Lock state query is fully implemented in `lock.query` with session filtering and computed TTL remaining.
4. Caller-chain warnings are fully implemented: `extractCallEdges` + `qualifyEdges` populate `symbol_deps` on each `lock.acquire`, and `buildCallerWarnings` queries that table to produce informational (non-blocking) warnings.

One human verification item exists: the "session disconnect" part of LOCK-02 is satisfied only via TTL in the current stateless HTTP architecture, not via real-time disconnect detection. This is an architectural characteristic worth confirming is acceptable.

---

_Verified: 2026-03-25_
_Verifier: Claude (gsd-verifier)_
