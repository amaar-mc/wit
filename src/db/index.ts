import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

export type WitDatabase = BunSQLiteDatabase<typeof schema>;

export function createDatabase(dbPath: string): {
  db: WitDatabase;
  sqlite: Database;
} {
  const sqlite = new Database(dbPath, { create: true });

  // PRAGMAs must be set on the raw Database before Drizzle wraps it.
  // Order matters: WAL must be enabled before any write transaction.
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  const db = drizzle({ client: sqlite, schema });

  return { db, sqlite };
}
