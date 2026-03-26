import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

// Track open databases for cleanup
const openDbs: Database[] = [];

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    try { db.close(); } catch { /* already closed */ }
  }
});

function makeTempDbPath(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "wit-test-"));
  const dbPath = join(dir, "test.db");
  return {
    dbPath,
    cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

describe("createDatabase PRAGMA setup", () => {
  test("journal_mode is WAL after createDatabase", () => {
    const { dbPath, cleanup } = makeTempDbPath();
    try {
      const { createDatabase } = require("./index");
      const { sqlite } = createDatabase(dbPath);
      openDbs.push(sqlite);
      const row = sqlite.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      expect(row.journal_mode).toBe("wal");
    } finally {
      cleanup();
    }
  });

  test("busy_timeout is 5000 after createDatabase", () => {
    const { dbPath, cleanup } = makeTempDbPath();
    try {
      const { createDatabase } = require("./index");
      const { sqlite } = createDatabase(dbPath);
      openDbs.push(sqlite);
      const row = sqlite.prepare("PRAGMA busy_timeout").get() as { timeout: number };
      expect(row.timeout).toBe(5000);
    } finally {
      cleanup();
    }
  });

  test("synchronous is NORMAL (1) after createDatabase", () => {
    const { dbPath, cleanup } = makeTempDbPath();
    try {
      const { createDatabase } = require("./index");
      const { sqlite } = createDatabase(dbPath);
      openDbs.push(sqlite);
      const row = sqlite.prepare("PRAGMA synchronous").get() as { synchronous: number };
      expect(row.synchronous).toBe(1);
    } finally {
      cleanup();
    }
  });

  test("foreign_keys is ON (1) after createDatabase", () => {
    const { dbPath, cleanup } = makeTempDbPath();
    try {
      const { createDatabase } = require("./index");
      const { sqlite } = createDatabase(dbPath);
      openDbs.push(sqlite);
      const row = sqlite.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
      expect(row.foreign_keys).toBe(1);
    } finally {
      cleanup();
    }
  });
});

describe("agents table migration", () => {
  test("agents table exists after runMigrations", async () => {
    const { dbPath, cleanup } = makeTempDbPath();
    try {
      const { createDatabase } = require("./index");
      const { runMigrations } = await import("./migrate");
      const { db, sqlite } = createDatabase(dbPath);
      openDbs.push(sqlite);
      await runMigrations(db);
      const row = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'")
        .get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe("agents");
    } finally {
      cleanup();
    }
  });

  test("runMigrations is idempotent (no error on second run)", async () => {
    const { dbPath, cleanup } = makeTempDbPath();
    try {
      const { createDatabase } = require("./index");
      const { runMigrations } = await import("./migrate");
      const { db, sqlite } = createDatabase(dbPath);
      openDbs.push(sqlite);
      await runMigrations(db);
      // Second run should not throw
      await expect(runMigrations(db)).resolves.toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
