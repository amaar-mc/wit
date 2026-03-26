import { test, expect, describe, afterEach, mock } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writePidFile, cleanStaleSocket, setupShutdownHandlers } from "./lifecycle";

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
