import { Command } from "clipanion";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WIT_DIR, DB_PATH } from "../../shared/paths";
import { createDatabase } from "../../db/index";
import { runMigrations } from "../../db/migrate";
import { ensureDaemon } from "../client";
import { writeSessionId } from "../session";

const CLAUDE_MD_CONTENT = `# Wit Coordination Protocol

This project uses Wit for multi-agent coordination. **You MUST follow this protocol before editing any file.**

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
   If the response shows \`hasConflicts: true\`, another agent is working in the same area. Read the conflict details and adjust your plan to avoid the conflicting region.

3. **Lock specific symbols you plan to modify:**
   \`\`\`bash
   wit lock --symbol "src/path/to/file.ts:functionName"
   \`\`\`
   If you get a \`LOCK_CONFLICT\`, another agent is actively editing that symbol. Do NOT edit it — work on something else instead.

## After finishing your work

4. **Release your locks:**
   \`\`\`bash
   wit release --symbol "src/path/to/file.ts:functionName"
   \`\`\`

## Rules

- ALWAYS run \`export WIT_SESSION=...\` at the start of your session. Never skip this.
- ALWAYS declare and lock BEFORE editing. Never skip this.
- If you get a conflict or lock error, do NOT proceed with editing that symbol. Adjust your approach.
- Lock at the symbol level (function, class, type), not the file level.
- Release locks when you're done.
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
