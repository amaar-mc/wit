---
phase: 4
slug: polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in) |
| **Config file** | none — bun test discovers *.test.ts |
| **Quick run command** | `bun test --testPathPattern "commands/"` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~12 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test --testPathPattern "commands/" --timeout 10000`
- **After every plan wave:** Run `bun test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 12 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | APIC-03, APIC-07 | unit | `bun test src/cli/commands/status.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | APIC-04, APIC-07 | unit | `bun test src/cli/commands/declare.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | APIC-05, APIC-06, APIC-07 | unit | `bun test src/cli/commands/lock.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | APIC-08 | unit | `bun test src/cli/commands/watch.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | INTN-04 | unit | `bun test src/cli/commands/hook.test.ts` | ✅ extend | ⬜ pending |
| 04-03-01 | 03 | 3 | APIC-09 | manual | validate openrpc.json structure | ❌ N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/commands/status.test.ts` — stubs for APIC-03, APIC-07
- [ ] `src/cli/commands/declare.test.ts` — stubs for APIC-04, APIC-07
- [ ] `src/cli/commands/lock.test.ts` — stubs for APIC-05, APIC-06, APIC-07
- [ ] `src/cli/commands/watch.test.ts` — stubs for APIC-08
- [ ] Extend `src/cli/commands/hook.test.ts` — stubs for INTN-04

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `wit watch` live terminal redraw | APIC-08 | Requires interactive terminal | 1. Start daemon 2. Run `wit watch` 3. In another terminal, `wit declare` 4. Verify watch updates |
| OpenRPC spec completeness | APIC-09 | Requires human review of doc quality | 1. Read PROTOCOL.md 2. Validate openrpc.json schema 3. Verify all methods documented |
| Git trailer in commit | INTN-04 | Requires real git commit flow | 1. `wit init` + `wit hook install` 2. `wit declare` 3. Stage + commit 4. Check `git log --format="%B"` for Wit-Intent trailer |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 12s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
