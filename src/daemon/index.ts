import { mkdirSync } from "node:fs";
import { createDatabase } from "../db/index";
import { runMigrations } from "../db/migrate";
import { createApp } from "./server";
import { writePidFile, cleanStaleSocket, setupShutdownHandlers, startTtlCleanup } from "./lifecycle";
import { createParserService, defaultWasmPaths } from "../parser/loader";
import { SOCKET_PATH, PID_PATH, DB_PATH, WIT_DIR } from "../shared/paths";

// Ensure .wit/ directory exists before any file operations
mkdirSync(WIT_DIR, { recursive: true });

const { db, sqlite } = createDatabase(DB_PATH);
await runMigrations(db);

// Initialize parser service — WASM paths resolved relative to this file
// to match the CWD-independence pattern used by migrate.ts
const { wasmDir, treeSitterWasm } = defaultWasmPaths();
const parserService = await createParserService(wasmDir, treeSitterWasm);

// Remove stale socket from a previous crashed daemon before binding
cleanStaleSocket(SOCKET_PATH);

await writePidFile(PID_PATH);

const app = createApp({ db, sqlite, parserService });

const server = Bun.serve({
  unix: SOCKET_PATH,
  fetch: app.fetch,
});

// Start TTL cleanup loop — clears expired lock rows every 30 seconds
const cleanupInterval = startTtlCleanup(db);

setupShutdownHandlers({ sqlite, pidPath: PID_PATH, socketPath: SOCKET_PATH, server, cleanupInterval });

console.log(`wit daemon listening on ${SOCKET_PATH}`);
