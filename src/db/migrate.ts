import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { WitDatabase } from "./index";

export async function runMigrations(db: WitDatabase): Promise<void> {
  await migrate(db, { migrationsFolder: "./drizzle" });
}
