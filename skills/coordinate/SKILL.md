---
name: coordinate
description: Coordinate with other AI agents before editing code. Declares intents, acquires semantic locks, and checks for conflicts to prevent merge conflicts in multi-agent workflows.
---

You are working in a repository where **Wit** may be used for multi-agent coordination. Other AI agents may be working on this codebase simultaneously. Follow this protocol to prevent merge conflicts.

## On session start

1. Check if Wit is initialized:
   ```bash
   test -d .wit && echo "wit:active" || echo "wit:inactive"
   ```
2. If **active**: run `wit status` to see what other agents are doing.
3. If **inactive**: check if the `wit` command exists:
   ```bash
   command -v wit >/dev/null 2>&1 && echo "wit:installed" || echo "wit:not-installed"
   ```
   - If installed but not initialized: run `wit init` to start coordination.
   - If not installed: skip all coordination. Wit is not available in this environment.

## Before editing any file

1. **Declare your intent** — announce what you plan to work on:
   ```bash
   wit declare --description "Brief description of planned work" --files src/path/to/file.ts
   ```
   Check the response for `conflicts`. If `hasConflicts` is true, read the conflict items — another agent may be working in the same area. Adjust your approach if needed.

2. **Lock specific symbols** you plan to modify (functions, classes, types):
   ```bash
   wit lock --symbol "src/path/to/file.ts:functionName"
   ```
   If you get a `LOCK_CONFLICT`, another agent is actively editing that symbol. Work on a different part of the code instead.

3. **Check coordination state** at any time:
   ```bash
   wit status
   ```
   This shows all active intents, locks, and contracts across all agents.

## After finishing your work

4. **Release your locks**:
   ```bash
   wit release --symbol "src/path/to/file.ts:functionName"
   ```

## Rules

- Always declare intent BEFORE editing files, not after.
- Lock at the symbol level (function, class, type), not the file level.
- If you receive a conflict warning, do NOT ignore it — adjust your plan to avoid the conflicting region.
- If `wit` commands fail with connection errors, the daemon may not be running. Run `wit init` to restart it.
- Locks auto-expire after 30 minutes. Release them early when you finish.
- The `--json` flag on any command gives machine-readable output.

## When to skip coordination entirely

- If `wit` is not installed (`command -v wit` fails), skip all coordination silently.
- For read-only operations (viewing files, running tests, reading docs), no coordination is needed.
