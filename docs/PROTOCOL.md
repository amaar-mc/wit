# Wit Agent Coordination Protocol v1

Wit is a coordination daemon for multiple AI agents working on the same codebase concurrently. It prevents merge conflicts by coordinating intent before code is written. This document specifies every RPC method available on the daemon, the message envelope format, transport layer, shared types, error codes, and lifecycle state machines. A developer can implement a wit-compatible client from this document alone — no source reading required.

---

## Table of Contents

1. [Transport](#transport)
2. [Message Envelope](#message-envelope)
3. [Connection Lifecycle](#connection-lifecycle)
4. [Symbol Path Format](#symbol-path-format)
5. [Methods](#methods)
   - [ping](#ping)
   - [register](#register)
   - [lock.acquire](#lockacquire)
   - [lock.release](#lockrelease)
   - [lock.query](#lockquery)
   - [intent.declare](#intentdeclare)
   - [intent.update](#intentupdate)
   - [intent.query](#intentquery)
   - [contract.propose](#contractpropose)
   - [contract.respond](#contractrespond)
   - [contract.query](#contractquery)
   - [check-contracts](#check-contracts)
6. [Shared Types](#shared-types)
7. [Error Codes](#error-codes)
8. [Intent Lifecycle](#intent-lifecycle)
9. [Contract Lifecycle](#contract-lifecycle)

---

## Transport

**Primary:** Unix domain socket at `.wit/daemon.sock` (relative to the repo root).

**Framing:** HTTP POST to `/rpc`. Set `Content-Type: application/json`.

The daemon starts automatically on first CLI use and runs in the background. Clients connect to the socket and send JSON-RPC requests over HTTP POST. The daemon responds synchronously.

**Example connection (Unix socket via curl):**

```bash
curl --unix-socket .wit/daemon.sock \
  -X POST http://localhost/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","witVersion":"1","id":"...","method":"ping","params":{}}'
```

---

## Message Envelope

All messages follow JSON-RPC 2.0 with an additional `witVersion` field. The `id` is always a UUID string (v4).

**Request:**

```json
{
  "jsonrpc": "2.0",
  "witVersion": "1",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "method": "lock.acquire",
  "params": {
    "symbolPath": "src/auth.ts:validateToken",
    "sessionId": "agent-abc-123"
  }
}
```

**Success response:**

```json
{
  "jsonrpc": "2.0",
  "witVersion": "1",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "result": {
    "symbolPath": "src/auth.ts:validateToken",
    "sessionId": "agent-abc-123",
    "acquiredAt": "2024-01-15T10:30:00.000Z",
    "expiresAt": "2024-01-15T11:00:00.000Z",
    "warnings": []
  }
}
```

**Error response:**

```json
{
  "jsonrpc": "2.0",
  "witVersion": "1",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "error": {
    "code": -32000,
    "message": "LOCK_CONFLICT",
    "data": {
      "heldBy": "agent-xyz-456",
      "expiresAt": "2024-01-15T11:00:00.000Z"
    }
  }
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `jsonrpc` | `"2.0"` | Always the literal string `"2.0"` |
| `witVersion` | `"1"` | Protocol version. Always `"1"` in the current release |
| `id` | `string` (UUID) | Correlates request to response. Use a UUID v4 |
| `method` | `string` | RPC method name (request only) |
| `params` | `object` | Method parameters (request only) |
| `result` | `any` | Success result (success response only) |
| `error` | `object` | Error details (error response only) |

---

## Connection Lifecycle

A typical agent session follows this flow:

1. **Start daemon** (automatic) — the `wit` CLI auto-starts the daemon on first use. Clients can also start it explicitly with `wit daemon start`.
2. **Connect** — open a connection to `.wit/daemon.sock`.
3. **Register** — call `register` with a unique agent name and session ID. The session ID must be stable across reconnects (e.g., derived from a UUID generated at agent startup). Registration is informational — it is not required for other methods, but omitting it means the daemon has no name for your session in query results.
4. **Coordinate** — use lock, intent, and contract methods to coordinate work with other agents.
5. **Release** — when done with a symbol, call `lock.release`. Locks also auto-expire per their TTL.

Sessions are identified by `sessionId` (a string you choose). There is no authentication — any client connected to the socket can use any session ID.

---

## Symbol Path Format

Many methods take a `symbolPath` parameter. The format is:

```
<relative-file-path>:<symbol-name>
```

Examples:
- `src/auth.ts:validateToken`
- `src/api/users.ts:createUser`
- `lib/crypto.py:hash_password`

The file path is relative to the repo root (the directory containing `.wit/`). The symbol name is the function, method, or variable name as it appears in source. The colon separator is required — methods validate that `symbolPath` contains a colon.

Supported file extensions: `.ts`, `.tsx`, `.js`, `.jsx` (TypeScript/JavaScript), `.py` (Python).

---

## Methods

### ping

Health check. Verifies the daemon is reachable.

**Params:** none (pass `{}` or omit)

**Result:** `"pong"` (string literal)

**Errors:** none

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "ping", "params": {}
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "result": "pong"
}
```

---

### register

Register an agent with the daemon, associating a human-readable name with a session ID.

**Params:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | `string` | yes | Human-readable agent name (e.g., `"claude-agent-1"`) |
| `sessionId` | `string` | yes | Stable unique identifier for this agent session |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | `number` | Auto-incremented row ID assigned to this registration |

**Errors:**

| Code | Message | When |
|------|---------|------|
| -32600 | INVALID_REQUEST | Missing or invalid params |

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "register",
  "params": { "name": "claude-agent-1", "sessionId": "sess-abc-123" }
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "result": { "agentId": 1 }
}
```

---

### lock.acquire

Acquire an exclusive lock on a symbol. If the symbol is already locked by a different session and the lock has not expired, returns a `LOCK_CONFLICT` error. If the lock is held by the same session, the TTL is refreshed. If the lock has expired, the new session takes it over.

Acquiring a lock also parses the locked file and builds a caller-dependency graph. The response includes `warnings` — a list of other symbols that call the locked symbol and are currently locked by a different session. Warnings are informational and never block the acquire.

**Params:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `symbolPath` | `string` | yes | Symbol to lock. Must contain `:` (e.g., `src/auth.ts:validateToken`) |
| `sessionId` | `string` | yes | Caller's session ID |
| `ttlMs` | `integer` | no | Lock TTL in milliseconds. Default: `1800000` (30 minutes) |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `symbolPath` | `string` | The locked symbol path |
| `sessionId` | `string` | The session holding the lock |
| `acquiredAt` | `string` | ISO 8601 timestamp when lock was acquired |
| `expiresAt` | `string` | ISO 8601 timestamp when lock expires |
| `warnings` | `CallerWarning[]` | List of dependency warnings (may be empty) |

**Errors:**

| Code | Message | When |
|------|---------|------|
| -32600 | INVALID_REQUEST | Missing/invalid params, symbolPath lacks `:` |
| -32000 | LOCK_CONFLICT | Symbol locked by a different active session. `data.heldBy` and `data.expiresAt` provided |

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "lock.acquire",
  "params": {
    "symbolPath": "src/auth.ts:validateToken",
    "sessionId": "sess-abc-123",
    "ttlMs": 3600000
  }
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...",
  "result": {
    "symbolPath": "src/auth.ts:validateToken",
    "sessionId": "sess-abc-123",
    "acquiredAt": "2024-01-15T10:30:00.000Z",
    "expiresAt": "2024-01-15T11:30:00.000Z",
    "warnings": [
      {
        "lockedSymbol": "src/api/routes.ts:handleLogin",
        "heldBy": "sess-xyz-456",
        "chain": ["src/api/routes.ts:handleLogin", "src/auth.ts:validateToken"]
      }
    ]
  }
}
```

---

### lock.release

Release a lock held by the caller's session.

**Params:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `symbolPath` | `string` | yes | Symbol path to release |
| `sessionId` | `string` | yes | Must match the session that holds the lock |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `released` | `boolean` | Always `true` on success |

**Errors:**

| Code | Message | When |
|------|---------|------|
| -32600 | INVALID_REQUEST | Missing/invalid params |
| -32000 | LOCK_NOT_FOUND | No lock exists for the given symbolPath |
| -32000 | LOCK_NOT_HELD | Lock exists but is held by a different session. `data.heldBy` provided |

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "lock.release",
  "params": { "symbolPath": "src/auth.ts:validateToken", "sessionId": "sess-abc-123" }
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "result": { "released": true }
}
```

---

### lock.query

Query active (non-expired) locks. Optionally filter by session.

**Params:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sessionId` | `string` | no | If provided, return only locks held by this session |

**Result:** Array of lock objects:

| Field | Type | Description |
|-------|------|-------------|
| `symbolPath` | `string` | The locked symbol path |
| `sessionId` | `string` | Session holding the lock |
| `acquiredAt` | `string` | ISO 8601 timestamp |
| `expiresAt` | `string` | ISO 8601 timestamp |
| `ttlRemainingMs` | `number` | Milliseconds until expiry |

**Errors:**

| Code | Message | When |
|------|---------|------|
| -32600 | INVALID_REQUEST | Invalid params |

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "lock.query",
  "params": {}
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...",
  "result": [
    {
      "symbolPath": "src/auth.ts:validateToken",
      "sessionId": "sess-abc-123",
      "acquiredAt": "2024-01-15T10:30:00.000Z",
      "expiresAt": "2024-01-15T11:00:00.000Z",
      "ttlRemainingMs": 1542000
    }
  ]
}
```

---

### intent.declare

Declare that an agent intends to modify a set of files (and optionally specific symbols). The daemon stores the intent, runs conflict detection, and returns a `ConflictReport`. The declare always succeeds — conflicts are returned as informational warnings, not errors.

Conflict detection runs three checks:
- **INTENT_OVERLAP**: another active intent touches the same file(s) and overlapping byte range
- **LOCK_INTERSECTION**: a declared symbol path is locked by another session
- **DEP_CHAIN**: a callee of a declared symbol is locked by another session

**Params:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sessionId` | `string` | yes | Caller's session ID |
| `description` | `string` | yes | Human-readable description of the intent |
| `files` | `string[]` | yes | Array of file paths (at least one). Relative to repo root |
| `symbols` | `string[]` | no | Symbol names (not paths) to associate with the intent |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `intentId` | `string` | UUID of the created intent |
| `conflicts` | `ConflictReport` | Conflict analysis result |

**Errors:**

| Code | Message | When |
|------|---------|------|
| -32600 | INVALID_REQUEST | Missing/invalid params, empty files array |

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "intent.declare",
  "params": {
    "sessionId": "sess-abc-123",
    "description": "Refactor token validation to use RS256",
    "files": ["src/auth.ts"],
    "symbols": ["validateToken", "createToken"]
  }
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...",
  "result": {
    "intentId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "conflicts": {
      "hasConflicts": true,
      "items": [
        {
          "type": "INTENT_OVERLAP",
          "overlappingIntentId": "a1b2c3d4-...",
          "overlappingSessionId": "sess-xyz-456",
          "description": "Update auth middleware"
        }
      ]
    }
  }
}
```

---

### intent.update

Update the status of an existing intent. Only the session that created the intent can update it. Status transitions are forward-only — see [Intent Lifecycle](#intent-lifecycle).

**Params:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `intentId` | `string` | yes | UUID of the intent to update |
| `sessionId` | `string` | yes | Must match the session that declared the intent |
| `status` | `"active" \| "resolved" \| "abandoned"` | yes | Target status |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `intentId` | `string` | The updated intent's UUID |
| `status` | `string` | The new status |
| `updatedAt` | `number` | Unix timestamp in milliseconds |

**Errors:**

| Code | Message | When |
|------|---------|------|
| -32600 | INVALID_REQUEST | Missing/invalid params |
| -32000 | INTENT_NOT_FOUND | No intent with the given ID |
| -32000 | INTENT_NOT_OWNED | Intent belongs to a different session |
| -32000 | INVALID_TRANSITION | Target status is not a valid transition from current status |

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "intent.update",
  "params": {
    "intentId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "sessionId": "sess-abc-123",
    "status": "resolved"
  }
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...",
  "result": {
    "intentId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "status": "resolved",
    "updatedAt": 1705317000000
  }
}
```

---

### intent.query

Query intents. Without filters, returns all `declared` and `active` intents. With an explicit `status` filter, returns intents with that specific status (including `resolved` and `abandoned`).

**Params:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sessionId` | `string` | no | Filter by session |
| `file` | `string` | no | Filter by file path (exact segment match) |
| `status` | `string` | no | Filter by status. When absent, defaults to `declared` + `active` |

**Result:** Array of intent objects:

| Field | Type | Description |
|-------|------|-------------|
| `intentId` | `string` | UUID |
| `sessionId` | `string` | Owning session |
| `description` | `string` | Human-readable description |
| `files` | `string` | Comma-delimited file list with leading/trailing commas |
| `symbols` | `string` | JSON array string of symbol names |
| `startByte` | `number \| null` | Start byte offset of symbol range in source |
| `endByte` | `number \| null` | End byte offset of symbol range in source |
| `status` | `string` | Current status |
| `declaredAt` | `number` | Unix timestamp in milliseconds |
| `updatedAt` | `number` | Unix timestamp in milliseconds |

**Errors:**

| Code | Message | When |
|------|---------|------|
| -32600 | INVALID_REQUEST | Invalid params |

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "intent.query",
  "params": { "file": "src/auth.ts" }
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...",
  "result": [
    {
      "intentId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "sessionId": "sess-abc-123",
      "description": "Refactor token validation to use RS256",
      "files": ",src/auth.ts,",
      "symbols": "[\"validateToken\",\"createToken\"]",
      "startByte": 120,
      "endByte": 450,
      "status": "active",
      "declaredAt": 1705316000000,
      "updatedAt": 1705316500000
    }
  ]
}
```

---

### contract.propose

Propose a function signature contract for a symbol. The daemon reads the symbol's current signature from disk (using tree-sitter), stores it as the contract's expected signature, and returns it. If the file does not exist or the symbol cannot be found, returns `SYMBOL_NOT_FOUND`.

A contract represents an agreement that a symbol's public interface will not change without coordination. After proposing, another agent must call `contract.respond` to accept or reject it.

**Params:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sessionId` | `string` | yes | Proposing agent's session ID |
| `symbolPath` | `string` | yes | Symbol whose signature to capture. Must contain `:` |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `contractId` | `string` | UUID of the created contract |
| `symbolPath` | `string` | The symbol path |
| `signature` | `string` | The captured function signature (params + optional return type) |

**Errors:**

| Code | Message | When |
|------|---------|------|
| -32600 | INVALID_REQUEST | Missing/invalid params, symbolPath lacks `:` |
| -32000 | SYMBOL_NOT_FOUND | File not found, unsupported language, or symbol not in file |

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "contract.propose",
  "params": {
    "sessionId": "sess-abc-123",
    "symbolPath": "src/auth.ts:validateToken"
  }
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...",
  "result": {
    "contractId": "c1d2e3f4-1234-5678-abcd-000000000001",
    "symbolPath": "src/auth.ts:validateToken",
    "signature": "(token: string): Promise<User | null>"
  }
}
```

---

### contract.respond

Accept or reject a proposed contract. A session cannot respond to its own contract (self-accept/self-reject). The contract must be in `proposed` status.

**Params:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `contractId` | `string` | yes | UUID of the contract to respond to |
| `sessionId` | `string` | yes | Responding agent's session ID (must differ from proposer) |
| `accept` | `boolean` | yes | `true` to accept, `false` to reject |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `contractId` | `string` | UUID of the contract |
| `status` | `"accepted" \| "rejected"` | New status |

**Errors:**

| Code | Message | When |
|------|---------|------|
| -32600 | INVALID_REQUEST | Missing/invalid params |
| -32000 | CONTRACT_NOT_FOUND | No contract with the given ID |
| -32000 | CONTRACT_ALREADY_RESOLVED | Contract is already accepted or rejected |
| -32000 | SELF_ACCEPT_NOT_ALLOWED | Responding session is the same as proposing session |

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "contract.respond",
  "params": {
    "contractId": "c1d2e3f4-1234-5678-abcd-000000000001",
    "sessionId": "sess-xyz-456",
    "accept": true
  }
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...",
  "result": {
    "contractId": "c1d2e3f4-1234-5678-abcd-000000000001",
    "status": "accepted"
  }
}
```

---

### contract.query

Query contracts, optionally filtered by symbol path and/or status.

**Params:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `symbolPath` | `string` | no | Filter by exact symbol path |
| `status` | `string` | no | Filter by status (`"proposed"`, `"accepted"`, `"rejected"`) |

**Result:** Array of contract objects:

| Field | Type | Description |
|-------|------|-------------|
| `contractId` | `string` | UUID |
| `proposerSessionId` | `string` | Session that proposed the contract |
| `symbolPath` | `string` | The symbol path |
| `signature` | `string` | Captured function signature |
| `status` | `string` | Current status |
| `responderSessionId` | `string \| null` | Session that responded (null if still proposed) |
| `proposedAt` | `number` | Unix timestamp in milliseconds |
| `respondedAt` | `number \| null` | Unix timestamp in milliseconds, or null |

**Errors:**

| Code | Message | When |
|------|---------|------|
| -32600 | INVALID_REQUEST | Invalid params |

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "contract.query",
  "params": { "status": "accepted" }
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...",
  "result": [
    {
      "contractId": "c1d2e3f4-1234-5678-abcd-000000000001",
      "proposerSessionId": "sess-abc-123",
      "symbolPath": "src/auth.ts:validateToken",
      "signature": "(token: string): Promise<User | null>",
      "status": "accepted",
      "responderSessionId": "sess-xyz-456",
      "proposedAt": 1705316000000,
      "respondedAt": 1705316500000
    }
  ]
}
```

---

### check-contracts

Check whether staged file contents violate any accepted contracts. This method is used by the git pre-commit hook — the hook passes staged file content directly so the daemon never reads from disk.

For each accepted contract whose symbol lives in one of the provided files, the daemon parses the staged content, extracts the current signature, and compares it to the contracted signature. A violation occurs when the signatures differ or the symbol cannot be found in the staged content.

**Params:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `files` | `FileInput[]` | yes | Array of staged file entries |

**FileInput object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | yes | Relative file path |
| `content` | `string` | yes | Full file content as a string |

**Result:**

| Field | Type | Description |
|-------|------|-------------|
| `violations` | `Violation[]` | List of contract violations. Empty array means no violations |

**Violation object:**

| Field | Type | Description |
|-------|------|-------------|
| `contractId` | `string` | UUID of the violated contract |
| `symbolPath` | `string` | The symbol path |
| `expected` | `string` | The contracted (expected) signature |
| `actual` | `string` | The current signature in staged content, or `"(symbol not found in staged content)"` |

**Errors:**

| Code | Message | When |
|------|---------|------|
| -32600 | INVALID_REQUEST | Invalid params |

**Example:**

```json
// Request
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...", "method": "check-contracts",
  "params": {
    "files": [
      {
        "path": "src/auth.ts",
        "content": "export function validateToken(token: string, opts: Options): User { ... }"
      }
    ]
  }
}

// Response
{
  "jsonrpc": "2.0", "witVersion": "1",
  "id": "...",
  "result": {
    "violations": [
      {
        "contractId": "c1d2e3f4-1234-5678-abcd-000000000001",
        "symbolPath": "src/auth.ts:validateToken",
        "expected": "(token: string): Promise<User | null>",
        "actual": "(token: string, opts: Options): User"
      }
    ]
  }
}
```

---

## Shared Types

### CallerWarning

Returned in `lock.acquire` result's `warnings` array. Informs the acquirer that a symbol which calls the newly locked symbol is itself locked by another session. This is informational — the acquire still succeeds.

```typescript
{
  lockedSymbol: string;  // Symbol path of the caller that is locked
  heldBy: string;        // Session ID holding the caller's lock
  chain: [string, string]; // [callerSymbolPath, newlyLockedSymbolPath]
}
```

### ConflictReport

Returned in `intent.declare` result. Summarizes all detected conflicts.

```typescript
{
  hasConflicts: boolean;  // True if items is non-empty
  items: ConflictItem[];  // Conflict details
}
```

### ConflictItem

A union type — one of three conflict kinds:

**INTENT_OVERLAP** — Another active intent overlaps the same file(s) and byte range:

```typescript
{
  type: "INTENT_OVERLAP";
  overlappingIntentId: string;   // UUID of the conflicting intent
  overlappingSessionId: string;  // Session that declared the conflicting intent
  description: string;           // That intent's description
}
```

**LOCK_INTERSECTION** — A symbol you declared intent for is locked by another session:

```typescript
{
  type: "LOCK_INTERSECTION";
  symbolPath: string;  // The locked symbol path
  heldBy: string;      // Session holding the lock
  expiresAt: string;   // ISO 8601 expiry timestamp
}
```

**DEP_CHAIN** — A callee of a symbol you declared intent for is locked by another session:

```typescript
{
  type: "DEP_CHAIN";
  intentSymbol: string;  // Your declared symbol path
  lockedCallee: string;  // The callee that is locked
  heldBy: string;        // Session holding the callee lock
}
```

---

## Error Codes

| Code | Message | Description |
|------|---------|-------------|
| -32600 | INVALID_REQUEST | Zod validation failure. Params are missing or have wrong types |
| -32601 | METHOD_NOT_FOUND | Unknown method name |
| -32000 | LOCK_CONFLICT | Attempted to acquire a lock held by another active session |
| -32000 | LOCK_NOT_FOUND | Attempted to release a lock that doesn't exist |
| -32000 | LOCK_NOT_HELD | Attempted to release a lock held by a different session |
| -32000 | INTENT_NOT_FOUND | Referenced intent ID does not exist |
| -32000 | INTENT_NOT_OWNED | Intent belongs to a different session |
| -32000 | INVALID_TRANSITION | Requested status transition is not valid from the current status |
| -32000 | SYMBOL_NOT_FOUND | Symbol not found in file (contract.propose) |
| -32000 | CONTRACT_NOT_FOUND | Referenced contract ID does not exist |
| -32000 | CONTRACT_ALREADY_RESOLVED | Contract is already accepted or rejected |
| -32000 | SELF_ACCEPT_NOT_ALLOWED | Proposer cannot respond to their own contract |

All `-32000` errors may include a `data` field with additional context (e.g., `heldBy`, `expiresAt`, `current`, `requested`).

---

## Intent Lifecycle

Intents follow a forward-only state machine. Once an intent reaches a terminal state (`resolved` or `abandoned`), it cannot be updated.

```
              declare
                 |
                 v
           [declared]
            /       \
          active   resolved
           |     \ /
           |      X
           |     / \
           v    /   v
       [active]   [resolved]
           |
           v
       [abandoned]
```

Valid transitions:

| From | To | Description |
|------|----|-------------|
| `declared` | `active` | Agent has started working on the intent |
| `declared` | `resolved` | Intent fulfilled without ever going active |
| `declared` | `abandoned` | Intent dropped without action |
| `active` | `resolved` | Work completed successfully |
| `active` | `abandoned` | Work stopped before completion |

Terminal states (`resolved`, `abandoned`) have no outgoing transitions. Attempting an invalid transition returns `INVALID_TRANSITION`.

The default `intent.query` filter returns `declared` and `active` intents only. To query terminal intents, pass an explicit `status` filter.

---

## Contract Lifecycle

Contracts follow a two-state lifecycle: one agent proposes, another responds.

```
  propose
     |
     v
 [proposed]
   /    \
accept  reject
   |      |
   v      v
[accepted] [rejected]
```

Valid transitions:

| From | To | Who | Description |
|------|----|-----|-------------|
| `proposed` | `accepted` | Responder (different session than proposer) | Agreeing to preserve the interface |
| `proposed` | `rejected` | Responder (different session than proposer) | Declining the contract |

`accepted` and `rejected` are terminal — `CONTRACT_ALREADY_RESOLVED` is returned if `contract.respond` is called on a non-proposed contract.

**Enforcement:** The git pre-commit hook calls `check-contracts` with staged content. If any accepted contract is violated (signature changed), the commit is blocked. The hook uses a 2-second timeout and fails open — if the daemon is unreachable, the commit proceeds.
