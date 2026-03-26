import { test, expect, describe, afterEach, beforeEach, mock } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writePidFile, cleanStaleSocket, setupShutdownHandlers, startTtlCleanup } from "./lifecycle";
import { createDatabase } from "../db/index";
import { runMigrations } from "../db/migrate";
import { locks } from "../db/schema";
import type { WitDatabase } from "../db/index";

describe("Daemon lifecycle", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("writePidFile", () => {
    test("writes current process.pid to the given path", async () => {
      tmpDir = mkdtempSync(join(tmpdir(), "wit-lifecycle-test-"));
      const pidPath = join(tmpDir, "daemon.pid");
      await writePidFile(pidPath);
      const content = readFileSync(pidPath, "utf8");
      expect(content).toBe(String(process.pid));
    });
  });

  describe("cleanStaleSocket", () => {
    test("deletes socket file if it exists", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "wit-lifecycle-test-"));
      const socketPath = join(tmpDir, "daemon.sock");
      writeFileSync(socketPath, "stale socket content");
      expect(existsSync(socketPath)).toBe(true);
      cleanStaleSocket(socketPath);
      expect(existsSync(socketPath)).toBe(false);
    });

    test("does not throw if socket file does not exist", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "wit-lifecycle-test-"));
      const socketPath = join(tmpDir, "nonexistent.sock");
      expect(() => cleanStaleSocket(socketPath)).not.toThrow();
    });
  });

  describe("setupShutdownHandlers", () => {
    test("registers handlers for SIGTERM and SIGINT", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "wit-lifecycle-test-"));

      const registeredSignals: string[] = [];
      const originalOn = process.on.bind(process);
      const mockOn = mock((signal: string, _handler: () => void) => {
        registeredSignals.push(signal);
        return process; // match NodeJS.EventEmitter return type
      });

      // Replace process.on temporarily
      const originalProcessOn = process.on;
      // @ts-ignore — monkey-patching for test
      process.on = mockOn;

      try {
        // Create minimal mock deps
        const mockSqlite = { close: mock(() => {}) } as unknown as import("bun:sqlite").Database;
        const mockServer = { stop: mock(() => {}) } as unknown as ReturnType<typeof import("bun").serve>;
        const pidPath = join(tmpDir, "daemon.pid");
        const socketPath = join(tmpDir, "daemon.sock");

        setupShutdownHandlers({
          sqlite: mockSqlite,
          pidPath,
          socketPath,
          server: mockServer,
        });

        expect(registeredSignals).toContain("SIGTERM");
        expect(registeredSignals).toContain("SIGINT");
      } finally {
        // @ts-ignore — restore
        process.on = originalProcessOn;
      }
    });
  });
});

describe("startTtlCleanup", () => {
  let tmpDir: string;
  let db: WitDatabase;
  let sqlite: import("bun:sqlite").Database["close"] extends (...args: never[]) => unknown ? import("bun:sqlite").Database : never;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wit-ttl-cleanup-test-"));
    const result = createDatabase(join(tmpDir, "test.db"));
    db = result.db;
    // @ts-ignore — safe, we only need .close() later
    sqlite = result.sqlite;
    await runMigrations(db);
  });

  afterEach(() => {
    // @ts-ignore
    sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns an interval handle that can be cleared", () => {
    // @ts-ignore
    const interval = startTtlCleanup(db);
    expect(typeof interval).toBe("object");
    clearInterval(interval);
  });

  test("deletes expired locks when cleanup runs", async () => {
    const pastDate = new Date(Date.now() - 10_000);

    // Insert an expired lock
    await db.insert(locks).values({
      symbolPath: "src/auth.ts:expiredFn",
      sessionId: "session-old",
      acquiredAt: pastDate,
      expiresAt: pastDate,
    });

    // Verify the lock is in the DB
    const before = await db.select().from(locks);
    expect(before).toHaveLength(1);

    // Run cleanup directly (don't wait for interval — test the logic, not the timer)
    // @ts-ignore — access internal cleanup via module function
    const { runTtlCleanup } = await import("./lifecycle");
    runTtlCleanup(db);

    const after = await db.select().from(locks);
    expect(after).toHaveLength(0);
  });

  test("preserves non-expired locks during cleanup", async () => {
    const futureDate = new Date(Date.now() + 60_000);
    const pastDate = new Date(Date.now() - 10_000);

    // Insert one expired and one active lock
    await db.insert(locks).values({
      symbolPath: "src/auth.ts:expiredFn",
      sessionId: "session-old",
      acquiredAt: pastDate,
      expiresAt: pastDate,
    });
    await db.insert(locks).values({
      symbolPath: "src/auth.ts:activeFn",
      sessionId: "session-active",
      acquiredAt: new Date(),
      expiresAt: futureDate,
    });

    // @ts-ignore
    const { runTtlCleanup } = await import("./lifecycle");
    runTtlCleanup(db);

    const after = await db.select().from(locks);
    expect(after).toHaveLength(1);
    expect(after[0]!.symbolPath).toBe("src/auth.ts:activeFn");
  });
});
