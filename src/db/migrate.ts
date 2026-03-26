import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { join } from "node:path";
import type { WitDatabase } from "./index";

// Resolve migrations folder relative to this file, not the process CWD.
// The daemon is spawned as a detached subprocess — its CWD is unpredictable.
const MIGRATIONS_DIR = join(new URL(".", import.meta.url).pathname, "../../drizzle");

export async function runMigrations(db: WitDatabase): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
