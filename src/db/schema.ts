import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: int("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sessionId: text("session_id").notNull().unique(),
  connectedAt: int("connected_at", { mode: "timestamp" }).notNull(),
});
