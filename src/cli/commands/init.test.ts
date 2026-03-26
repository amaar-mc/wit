import { test, expect, afterEach, beforeEach, describe } from "bun:test";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { witPaths } from "../../shared/paths";
import { Database } from "bun:sqlite";

// We test InitCommand programmatically via clipanion CLI runner
import { Cli, Builtins } from "clipanion";
import { InitCommand } from "./init";

let tempDir: string;
let paths: ReturnType<typeof witPaths>;
let cli: Cli;

beforeEach(() => {
  tempDir = join("/tmp", `wit-test-init-${process.pid}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  paths = witPaths(tempDir);

  // Point all path resolution to temp dir
  process.env["WIT_REPO_ROOT"] = tempDir;

  // Build a fresh CLI instance for each test
  cli = new Cli({ binaryLabel: "wit", binaryName: "wit", binaryVersion: "0.1.0" });
  cli.register(Builtins.HelpCommand);
  cli.register(InitCommand);
});

afterEach(async () => {
  // Kill any daemon spawned by init
  if (existsSync(paths.PID_PATH)) {
    try {
      const pidStr = await Bun.file(paths.PID_PATH).text();
      const pid = parseInt(pidStr.trim(), 10);
      if (!isNaN(pid) && pid !== process.pid) {
        process.kill(pid, "SIGTERM");
        await Bun.sleep(150);
      }
    } catch {
      // Already dead — fine
    }
  }
  delete process.env["WIT_REPO_ROOT"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("wit init", () => {
  test("creates .wit/ directory in the repo root", async () => {
    expect(existsSync(paths.WIT_DIR)).toBe(false);

    await cli.run(["init"]);

    expect(existsSync(paths.WIT_DIR)).toBe(true);
  }, 10000);

  test("creates state.db with agents table", async () => {
    await cli.run(["init"]);

    expect(existsSync(paths.DB_PATH)).toBe(true);

    // Verify agents table exists
    const sqlite = new Database(paths.DB_PATH, { readonly: true });
    const row = sqlite
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'")
      .get() as { name: string } | null;
    sqlite.close();

    expect(row).not.toBeNull();
    expect(row?.name).toBe("agents");
  }, 10000);

  test("starts daemon — PID file appears in .wit/", async () => {
    await cli.run(["init"]);
    expect(existsSync(paths.PID_PATH)).toBe(true);
  }, 10000);

  test("starts daemon — socket file appears in .wit/", async () => {
    await cli.run(["init"]);
    expect(existsSync(paths.SOCKET_PATH)).toBe(true);
  }, 10000);

  test("prints 'Wit initialized.' to stdout", async () => {
    let output = "";
    const stdout = {
      write(data: string): void {
        output += data;
      },
    };

    await cli.run(["init"], { stdout: stdout as unknown as NodeJS.WriteStream });

    expect(output).toContain("Wit initialized.");
  }, 10000);

  test("is idempotent — second run produces no error and daemon keeps running", async () => {
    await cli.run(["init"]);

    const pidBefore = await Bun.file(paths.PID_PATH).text();

    // Second init should succeed
    const exitCode = await cli.run(["init"]);
    expect(exitCode).toBe(0);

    const pidAfter = await Bun.file(paths.PID_PATH).text();
    // Same daemon — PID did not change
    expect(pidBefore.trim()).toBe(pidAfter.trim());
  }, 15000);
});
