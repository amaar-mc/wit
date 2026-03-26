---
phase: 3
slug: coordination
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in) |
| **Config file** | package.json `scripts.test` |
| **Quick run command** | `bun test src/daemon/rpc/handlers.test.ts` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test src/daemon/rpc/handlers.test.ts --timeout 10000`
- **After every plan wave:** Run `bun test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | INTN-01 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "intent.declare"` | ✅ extend | ⬜ pending |
| 03-01-02 | 01 | 1 | INTN-02 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "intent.update"` | ✅ extend | ⬜ pending |
| 03-01-03 | 01 | 1 | INTN-03 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "intent.query"` | ✅ extend | ⬜ pending |
| 03-02-01 | 02 | 2 | CONF-01 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "INTENT_OVERLAP"` | ✅ extend | ⬜ pending |
| 03-02-02 | 02 | 2 | CONF-02 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "LOCK_INTERSECTION"` | ✅ extend | ⬜ pending |
| 03-02-03 | 02 | 2 | CONF-03 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "dep chain"` | ✅ extend | ⬜ pending |
| 03-02-04 | 02 | 2 | CONF-04 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "ConflictReport"` | ✅ extend | ⬜ pending |
| 03-03-01 | 03 | 3 | CONT-01 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "contract.propose"` | ✅ extend | ⬜ pending |
| 03-03-02 | 03 | 3 | CONT-02 | unit | `bun test src/daemon/rpc/handlers.test.ts -t "contract.respond"` | ✅ extend | ⬜ pending |
| 03-03-03 | 03 | 3 | CONT-03 | integration | `bun test src/cli/commands/hook.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test cases in `src/daemon/rpc/handlers.test.ts` — stubs for INTN-01 through CONT-02
- [ ] `src/cli/commands/hook.test.ts` — stubs for CONT-03 (hook install + contract check)
- [ ] New migration in `drizzle/` — `intents` + `contracts` tables

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pre-commit hook blocks commit with violated contract | CONT-03 | Requires real git repo with staged changes | 1. `wit hook install` 2. Accept contract 3. Change signature 4. `git commit` 5. Verify rejection |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
