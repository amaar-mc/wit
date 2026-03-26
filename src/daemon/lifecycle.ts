import { unlinkSync } from "node:fs";
import type { Database } from "bun:sqlite";

export async function writePidFile(pidPath: string): Promise<void> {
  await Bun.write(pidPath, String(process.pid));
}

export function cleanStaleSocket(socketPath: string): void {
  try {
    unlinkSync(socketPath);
  } catch {
    // No-op if file does not exist — this is expected on fresh start
  }
}

export function setupShutdownHandlers(ctx: {
  sqlite: Database;
  pidPath: string;
  socketPath: string;
  server: { stop(): void };
}): void {
  const { sqlite, pidPath, socketPath, server } = ctx;

  const shutdown = (): void => {
    server.stop();
    sqlite.close();
    try {
      unlinkSync(pidPath);
    } catch {
      // No-op if already removed
    }
    try {
      unlinkSync(socketPath);
    } catch {
      // No-op if already removed
    }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
