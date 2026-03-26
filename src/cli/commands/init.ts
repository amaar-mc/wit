import { Command } from "clipanion";
import { mkdirSync } from "node:fs";
import { WIT_DIR, DB_PATH } from "../../shared/paths";
import { createDatabase } from "../../db/index";
import { runMigrations } from "../../db/migrate";
import { ensureDaemon } from "../client";
import { writeSessionId } from "../session";

export class InitCommand extends Command {
  static override paths = [["init"]];
  static override usage = Command.Usage({
    description: "Initialize wit in the current repository",
  });

  async execute(): Promise<number> {
    // Create .wit/ directory — recursive so it's a no-op if already exists
    mkdirSync(WIT_DIR, { recursive: true });

    // Persist a stable session ID derived from user@cwd — survives CLI restarts
    writeSessionId(WIT_DIR);

    // Open/create the SQLite database and apply schema migrations
    const { db, sqlite } = createDatabase(DB_PATH);
    await runMigrations(db);
    // Close CLI's connection — the daemon opens its own independently
    sqlite.close();

    // Start the daemon if not already running (connect-or-spawn)
    await ensureDaemon();

    this.context.stdout.write("Wit initialized.\n");
    return 0;
  }
}
