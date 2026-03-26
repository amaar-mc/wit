import { unlinkSync } from "node:fs";
import { lt } from "drizzle-orm";
import type { Database } from "bun:sqlite";
import type { WitDatabase } from "../db/index";
import { locks } from "../db/schema";

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

// Exported separately so tests can trigger cleanup logic without waiting for the interval
export function runTtlCleanup(db: WitDatabase): void {
  db.delete(locks).where(lt(locks.expiresAt, new Date())).run();
}

export function startTtlCleanup(db: WitDatabase): ReturnType<typeof setInterval> {
  return setInterval(() => {
    runTtlCleanup(db);
  }, 30_000);
}

export function setupShutdownHandlers(ctx: {
  sqlite: Database;
  pidPath: string;
  socketPath: string;
  server: { stop(): void };
  cleanupInterval?: ReturnType<typeof setInterval>;
}): void {
  const { sqlite, pidPath, socketPath, server, cleanupInterval } = ctx;

  const shutdown = (): void => {
    if (cleanupInterval !== undefined) {
      clearInterval(cleanupInterval);
    }
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
