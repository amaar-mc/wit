import { mkdirSync } from "node:fs";
import { createDatabase } from "../db/index";
import { runMigrations } from "../db/migrate";
import { createApp } from "./server";
import { writePidFile, cleanStaleSocket, setupShutdownHandlers } from "./lifecycle";
import { SOCKET_PATH, PID_PATH, DB_PATH, WIT_DIR } from "../shared/paths";

// Ensure .wit/ directory exists before any file operations
mkdirSync(WIT_DIR, { recursive: true });

const { db, sqlite } = createDatabase(DB_PATH);
await runMigrations(db);

// Remove stale socket from a previous crashed daemon before binding
cleanStaleSocket(SOCKET_PATH);

await writePidFile(PID_PATH);

const app = createApp({ db, sqlite });

const server = Bun.serve({
  unix: SOCKET_PATH,
  fetch: app.fetch,
});

setupShutdownHandlers({ sqlite, pidPath: PID_PATH, socketPath: SOCKET_PATH, server });

console.log(`wit daemon listening on ${SOCKET_PATH}`);
