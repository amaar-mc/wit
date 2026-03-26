import { Command } from "clipanion";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WIT_DIR, DB_PATH } from "../../shared/paths";
import { createDatabase } from "../../db/index";
import { runMigrations } from "../../db/migrate";
import { ensureDaemon } from "../client";
import { writeSessionId } from "../session";

const CLAUDE_MD_CONTENT = `# Wit Coordination Protocol

This project uses Wit for multi-agent coordination. Multiple AI agents may be working on this codebase simultaneously. **You MUST follow this protocol.**

## On session start

Set a unique session identity so the daemon can distinguish you from other agents:
\`\`\`bash
export WIT_SESSION="agent-$(openssl rand -hex 8)"
\`\`\`

## Before editing any file

1. **Check coordination state first:**
   \`\`\`bash
   wit status
   \`\`\`

2. **Declare your intent — what you plan to work on:**
   \`\`\`bash
   wit declare --description "Brief description" --files src/path/to/file.ts
   \`\`\`
   If the response shows conflicts, read the details carefully and adjust your plan to avoid the conflicting region.

3. **Lock specific symbols you plan to modify:**
   \`\`\`bash
   wit lock --symbol "src/path/to/file.ts:functionName"
   \`\`\`
   If you get a \`LOCK_CONFLICT\`, another agent is actively editing that symbol. Do NOT edit it — work on other unlocked symbols first, then retry the locked symbol later.

4. **ALWAYS re-read the file immediately before editing it.** Another agent may have modified it since you last read it. If you edit without re-reading, your changes may conflict or overwrite the other agent's work.

## After finishing your work

5. **Release your locks:**
   \`\`\`bash
   wit release --symbol "src/path/to/file.ts:functionName"
   \`\`\`

## Handling locked symbols

When a symbol you need is locked by another agent:
- Do NOT give up or end your task early.
- Work on other parts of the task that are not locked.
- Periodically retry the locked symbol:
  \`\`\`bash
  wit lock --symbol "src/path/to/file.ts:functionName"
  \`\`\`
- Once the lock is acquired, re-read the file, then make your changes.
- Continue retrying until all parts of your task are complete.

## Rules

- ALWAYS run \`export WIT_SESSION=...\` at the start of your session. Never skip this.
- ALWAYS declare and lock BEFORE editing. Never skip this.
- ALWAYS re-read files before editing when conflicts were detected.
- If you get a LOCK_CONFLICT, do NOT skip that work permanently. Retry until the lock is released.
- Lock at the symbol level (function, class, type), not the file level.
- Release locks when you're done.
- Do NOT end your task with unfinished work due to lock conflicts. Keep working.
`;

export class InitCommand extends Command {
  static override paths = [["init"]];
  static override usage = Command.Usage({
    description: "Initialize wit in the current repository",
  });

  async execute(): Promise<number> {
    // Create .wit/ directory — recursive so it's a no-op if already exists
    mkdirSync(WIT_DIR, { recursive: true });

    // Persist a default session ID — multi-agent setups override via WIT_SESSION env
    writeSessionId(WIT_DIR);

    // Open/create the SQLite database and apply schema migrations
    const { db, sqlite } = createDatabase(DB_PATH);
    await runMigrations(db);
    // Close CLI's connection — the daemon opens its own independently
    sqlite.close();

    // Start the daemon if not already running (connect-or-spawn)
    await ensureDaemon();

    // Write or append CLAUDE.md with coordination instructions
    const repoRoot = process.env["WIT_REPO_ROOT"] ?? process.cwd();
    const claudeMdPath = join(repoRoot, "CLAUDE.md");
    if (!existsSync(claudeMdPath)) {
      writeFileSync(claudeMdPath, CLAUDE_MD_CONTENT, "utf-8");
      this.context.stdout.write("Wit initialized.\nCreated CLAUDE.md with coordination instructions.\n");
    } else {
      const existing = readFileSync(claudeMdPath, "utf-8");
      if (!existing.includes("Wit Coordination Protocol")) {
        writeFileSync(claudeMdPath, existing + "\n" + CLAUDE_MD_CONTENT, "utf-8");
        this.context.stdout.write("Wit initialized.\nAppended coordination instructions to CLAUDE.md.\n");
      } else {
        this.context.stdout.write("Wit initialized.\n");
      }
    }

    return 0;
  }
}
