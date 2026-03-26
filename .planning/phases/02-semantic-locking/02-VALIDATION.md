---
phase: 2
slug: semantic-locking
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in) |
| **Config file** | package.json `scripts.test` |
| **Quick run command** | `bun test src/parser/` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test src/parser/ --timeout 5000`
- **After every plan wave:** Run `bun test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | LOCK-03 | unit | `bun test src/parser/symbols.test.ts -t "TypeScript"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | LOCK-03 | unit | `bun test src/parser/symbols.test.ts -t "arrow function"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | LOCK-04 | unit | `bun test src/parser/symbols.test.ts -t "Python"` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | LOCK-01 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "lock.acquire"` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | LOCK-02 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "lock.release"` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 2 | LOCK-05 | unit | `bun test src/daemon/lifecycle.test.ts -t "TTL cleanup"` | ✅ extend | ⬜ pending |
| 02-02-04 | 02 | 2 | LOCK-06 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "lock.query"` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 3 | LOCK-07 | unit | `bun test src/parser/calls.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 3 | LOCK-08 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "caller warning"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/parser/symbols.test.ts` — stubs for LOCK-03, LOCK-04 (TS + Python symbol extraction)
- [ ] `src/parser/calls.test.ts` — stubs for LOCK-07 (call edge extraction)
- [ ] `src/parser/loader.test.ts` — stubs for Parser init + language load smoke
- [ ] New test cases in `src/daemon/rpc/handlers.test.ts` — stubs for LOCK-01, LOCK-02 (explicit), LOCK-05 (expired), LOCK-06, LOCK-08
- [ ] New test cases in `src/daemon/lifecycle.test.ts` — stubs for LOCK-02 (disconnect), LOCK-05 (cleanup interval)
- [ ] New migration in `drizzle/` — `locks` + `symbol_deps` tables

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WASM files load from node_modules at runtime | LOCK-03, LOCK-04 | Requires real WASM binaries on disk | 1. Run `bun src/daemon/index.ts` 2. Send parse request via curl 3. Verify symbols returned |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 8s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
