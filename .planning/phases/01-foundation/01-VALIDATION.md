---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in) |
| **Config file** | none — bun test auto-discovers `*.test.ts` |
| **Quick run command** | `bun test --timeout 5000` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test --timeout 5000`
- **After every plan wave:** Run `bun test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | INFR-01 | integration | `bun test src/cli/client.test.ts -t "spawns daemon"` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | INFR-02 | unit | `bun test src/db/db.test.ts -t "WAL mode"` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | INFR-03 | unit | `bun test src/cli/client.test.ts -t "stale PID"` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | INFR-04 | unit | `bun test src/daemon/server.test.ts -t "version mismatch"` | ❌ W0 | ⬜ pending |
| 01-01-05 | 01 | 1 | INFR-05 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "register"` | ❌ W0 | ⬜ pending |
| 01-01-06 | 01 | 1 | INFR-06 | integration | `bun test src/daemon/lifecycle.test.ts -t "SIGTERM"` | ❌ W0 | ⬜ pending |
| 01-01-07 | 01 | 1 | APIC-01 | integration | `bun test src/daemon/server.test.ts -t "unix socket"` | ❌ W0 | ⬜ pending |
| 01-01-08 | 01 | 1 | APIC-02 | integration | `bun test src/cli/commands/init.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/client.test.ts` — stubs for INFR-01, INFR-03
- [ ] `src/db/db.test.ts` — stubs for INFR-02
- [ ] `src/daemon/server.test.ts` — stubs for INFR-04, APIC-01
- [ ] `src/daemon/rpc/handlers.test.ts` — stubs for INFR-05
- [ ] `src/daemon/lifecycle.test.ts` — stubs for INFR-06
- [ ] `src/cli/commands/init.test.ts` — stubs for APIC-02

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Daemon persists across CLI calls | INFR-01 | Requires two sequential CLI invocations in a real shell | 1. Run `wit init` 2. Run `wit status` 3. Verify same daemon PID |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
