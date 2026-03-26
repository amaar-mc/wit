---
phase: 04-polish
plan: 03
subsystem: docs
tags: [openrpc, json-schema, protocol, documentation]

# Dependency graph
requires:
  - phase: 03-coordination
    provides: "Complete implementation of all 12 RPC methods in handlers.ts"
  - phase: 02-semantic-locking
    provides: "Lock, symbol-dep, and caller-warning types"
  - phase: 01-foundation
    provides: "Protocol envelope types (RpcRequest, RpcSuccess, RpcError, ConflictReport)"
provides:
  - "docs/PROTOCOL.md: human-readable specification for third-party agent developers"
  - "docs/openrpc.json: machine-readable OpenRPC 1.4.0 spec for tooling integration"
affects: [third-party-clients, sdk-generation, api-tooling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OpenRPC 1.4.0 for machine-readable RPC specs"
    - "components/schemas with $ref for schema reuse across methods"
    - "Discriminated union via oneOf + discriminator.propertyName for ConflictItem"

key-files:
  created:
    - docs/PROTOCOL.md
    - docs/openrpc.json
  modified: []

key-decisions:
  - "PROTOCOL.md structured for top-to-bottom reading: transport -> envelope -> lifecycle -> methods -> types -> errors"
  - "openrpc.json uses components/schemas for CallerWarning, ConflictItem, ConflictReport, LockRecord, IntentRecord, ContractRecord, Violation — avoids inline duplication"
  - "ConflictItem modeled as oneOf with discriminator.propertyName: type — standard OpenRPC pattern for tagged unions"
  - "intent.query result includes raw storage format for files (comma-delimited) and symbols (JSON string) — documented as-is to match actual daemon behavior"

patterns-established:
  - "Protocol spec co-located in docs/ alongside openrpc.json for discoverability"
  - "Each RPC method in PROTOCOL.md has: description, params table, result table, errors table, request/response example"

requirements-completed: [APIC-09]

# Metrics
duration: 3min
completed: 2026-03-26
---

# Phase 4 Plan 3: Protocol Specification Summary

**Complete open protocol spec as PROTOCOL.md (976 lines) and openrpc.json covering all 12 RPC methods — enabling third-party agent developers to implement a wit client without reading source code**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-26T07:00:55Z
- **Completed:** 2026-03-26T07:03:25Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `docs/PROTOCOL.md`: 976-line human-readable specification covering transport, message envelope, connection lifecycle, symbol path format, all 12 methods with param/result/error tables and request/response examples, shared types, error code table, and intent/contract lifecycle state machines
- `docs/openrpc.json`: Valid OpenRPC 1.4.0 document with all 12 methods, complete JSON Schema definitions for every param and result, shared component schemas for reuse, and discriminated union for ConflictItem

## Task Commits

1. **Task 1: Write PROTOCOL.md human-readable specification** - `84b7d38` (docs)
2. **Task 2: Write openrpc.json machine-readable specification** - `3cbaf2c` (docs)

## Files Created/Modified

- `docs/PROTOCOL.md` - Human-readable protocol specification (976 lines). Covers all 12 RPC methods with full examples.
- `docs/openrpc.json` - Machine-readable OpenRPC 1.4.0 spec. 12 methods, shared component schemas, exact JSON Schema types matching Zod schemas in handlers.ts.

## Decisions Made

- PROTOCOL.md structured for top-to-bottom reading progression (transport first, methods in the middle, types/errors/lifecycles at end) — mirrors how a developer would onboard
- openrpc.json uses `components/schemas` with `$ref` to avoid duplicating ConflictItem, CallerWarning, and other shared types inline across methods
- ConflictItem modeled as `oneOf` with `discriminator.propertyName: "type"` — the standard OpenRPC approach for discriminated unions
- `intent.query` result documents the raw storage format for `files` (comma-delimited string) and `symbols` (JSON array string) as returned by the daemon, not a cleaned-up version — spec accuracy over aesthetics

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

5 pre-existing test failures in `src/cli/commands/init.test.ts` (daemon PID/socket file creation) were present before this plan and are unrelated to documentation changes. Logged as out-of-scope.

## Next Phase Readiness

- Protocol documentation is complete. Third-party developers can implement a wit client from docs/PROTOCOL.md alone.
- docs/openrpc.json can be consumed by OpenRPC tooling to generate client SDKs, mock servers, or interactive documentation.

---
*Phase: 04-polish*
*Completed: 2026-03-26*
