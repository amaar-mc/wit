import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: int("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sessionId: text("session_id").notNull().unique(),
  connectedAt: int("connected_at", { mode: "timestamp" }).notNull(),
});

export const locks = sqliteTable(
  "locks",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    // Symbol path format: "src/auth.ts:validateToken"
    symbolPath: text("symbol_path").notNull(),
    // References agents.sessionId logically — not a FK because agent may disconnect
    // before lock expires via TTL
    sessionId: text("session_id").notNull(),
    // timestamp_ms for numeric comparison in TTL cleanup (avoids Date object overhead)
    acquiredAt: int("acquired_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: int("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    // One lock per symbol — enforced at DB level
    uniqueIndex("locks_symbol_path_unique").on(t.symbolPath),
  ],
);

export const symbolDeps = sqliteTable(
  "symbol_deps",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    // Relative file path: "src/auth.ts"
    file: text("file").notNull(),
    // Fully-qualified caller symbol: "src/auth.ts:login"
    caller: text("caller").notNull(),
    // Fully-qualified callee: "src/auth.ts:validateToken" or "?:unknownFn" for cross-file
    callee: text("callee").notNull(),
  },
  (t) => [
    index("symbol_deps_callee_idx").on(t.callee),
    index("symbol_deps_caller_idx").on(t.caller),
    index("symbol_deps_file_idx").on(t.file),
  ],
);
