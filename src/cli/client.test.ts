import { test, expect, afterEach, beforeEach, describe } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { witPaths } from "../shared/paths";
import { isDaemonAlive, ensureDaemon, rpc } from "./client";

// Each test gets its own temp dir to avoid state pollution
let tempDir: string;
let paths: ReturnType<typeof witPaths>;

beforeEach(() => {
  tempDir = join("/tmp", `wit-test-client-${process.pid}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(join(tempDir, ".wit"), { recursive: true });
  paths = witPaths(tempDir);

  // Point module-level constants to temp dir
  process.env["WIT_REPO_ROOT"] = tempDir;
});

afterEach(async () => {
  // Kill any daemon we spawned (read PID from file if it still exists)
  if (existsSync(paths.PID_PATH)) {
    try {
      const pidStr = await Bun.file(paths.PID_PATH).text();
      const pid = parseInt(pidStr.trim(), 10);
      if (!isNaN(pid)) {
        process.kill(pid, "SIGTERM");
        // Give daemon time to shutdown
        await Bun.sleep(100);
      }
    } catch {
      // Already dead — fine
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("isDaemonAlive", () => {
  test("returns false when no PID file exists", async () => {
    // No PID file written — should return false immediately
    const alive = await isDaemonAlive(paths);
    expect(alive).toBe(false);
  });

  test("returns false and removes stale PID file when process is dead", async () => {
    // Use a PID that cannot be a running process (very large, unlikely to exist)
    // PID 999999 is well above typical OS limits and will not be running
    const deadPid = 999999;
    writeFileSync(paths.PID_PATH, String(deadPid));

    const alive = await isDaemonAlive(paths);
    expect(alive).toBe(false);

    // Stale PID file must be removed
    expect(existsSync(paths.PID_PATH)).toBe(false);
  });

  test("returns true when PID file contains live process PID", async () => {
    // Current process is definitely alive
    writeFileSync(paths.PID_PATH, String(process.pid));
    const alive = await isDaemonAlive(paths);
    expect(alive).toBe(true);
  });
});

describe("ensureDaemon", () => {
  test("spawns daemon when not alive, socket appears within timeout", async () => {
    expect(existsSync(paths.SOCKET_PATH)).toBe(false);
    await ensureDaemon(paths);
    // Socket should appear after daemon starts
    expect(existsSync(paths.SOCKET_PATH)).toBe(true);
  }, 8000);

  test("is idempotent — second call returns without spawning again", async () => {
    await ensureDaemon(paths);
    const pidBefore = await Bun.file(paths.PID_PATH).text();

    // Second call should detect alive daemon and skip spawn
    await ensureDaemon(paths);
    const pidAfter = await Bun.file(paths.PID_PATH).text();

    // Same PID means same daemon process — no new spawn
    expect(pidBefore.trim()).toBe(pidAfter.trim());
  }, 10000);
});

describe("rpc", () => {
  test("ping returns pong through real unix socket round trip", async () => {
    // Full integration: ensureDaemon + RPC call through actual daemon
    const result = await rpc<string>("ping", {}, paths);
    expect(result).toBe("pong");
  }, 10000);
});
