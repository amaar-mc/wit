import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HookInstallCommand } from "./hook";
import { Cli } from "clipanion";

// Build a minimal Cli instance with HookInstallCommand for testing
function buildCli(): Cli {
  const cli = new Cli({ binaryLabel: "wit", binaryName: "wit", binaryVersion: "0.1.0" });
  cli.register(HookInstallCommand);
  return cli;
}

describe("HookInstallCommand", () => {
  let tmpDir: string;
  let origCwd: string;

  afterEach(() => {
    // Restore cwd before cleanup
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function setup(): { fakeRepoDir: string; hooksDir: string } {
    origCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "wit-hook-test-"));

    // Create a fake git repo structure
    const fakeRepoDir = join(tmpDir, "repo");
    const hooksDir = join(fakeRepoDir, ".git", "hooks");
    mkdirSync(hooksDir, { recursive: true });

    // Change cwd to the fake repo
    process.chdir(fakeRepoDir);

    return { fakeRepoDir, hooksDir };
  }

  test("writes pre-commit file to .git/hooks/pre-commit", async () => {
    const { hooksDir } = setup();
    const hookPath = join(hooksDir, "pre-commit");

    // Run the command
    const cli = buildCli();
    const out: string[] = [];
    await cli.run(["hook", "install"], {
      stdin: process.stdin,
      stdout: { write: (s: string) => { out.push(s); return true; } } as unknown as NodeJS.WriteStream,
      stderr: process.stderr,
    });

    const file = Bun.file(hookPath);
    expect(await file.exists()).toBe(true);
  });

  test("written hook file is executable (mode 0o755)", async () => {
    const { hooksDir } = setup();
    const hookPath = join(hooksDir, "pre-commit");

    const cli = buildCli();
    await cli.run(["hook", "install"], {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    });

    const stats = statSync(hookPath);
    // Check executable bits for owner (user)
    // eslint-disable-next-line no-bitwise
    const isExecutable = (stats.mode & 0o100) !== 0;
    expect(isExecutable).toBe(true);
  });

  test("written hook contains the expected shebang line", async () => {
    const { hooksDir } = setup();
    const hookPath = join(hooksDir, "pre-commit");

    const cli = buildCli();
    await cli.run(["hook", "install"], {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    });

    const content = await Bun.file(hookPath).text();
    expect(content.startsWith("#!/bin/sh\n")).toBe(true);
  });

  test("written hook checks staged TS and Python files", async () => {
    const { hooksDir } = setup();
    const hookPath = join(hooksDir, "pre-commit");

    const cli = buildCli();
    await cli.run(["hook", "install"], {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    });

    const content = await Bun.file(hookPath).text();
    // Grep filter for TS/TSX/Python extensions
    expect(content).toContain("ts");
    expect(content).toContain("py");
    // Uses git diff --cached
    expect(content).toContain("git diff --cached");
  });

  test("written hook uses xargs to pass staged file paths as argv to wit check-contracts", async () => {
    const { hooksDir } = setup();
    const hookPath = join(hooksDir, "pre-commit");

    const cli = buildCli();
    await cli.run(["hook", "install"], {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    });

    const content = await Bun.file(hookPath).text();
    expect(content).toContain("xargs");
    expect(content).toContain("check-contracts");
  });

  test("prints confirmation message including the hook path", async () => {
    const { hooksDir } = setup();
    const hookPath = join(hooksDir, "pre-commit");

    const cli = buildCli();
    const outLines: string[] = [];
    await cli.run(["hook", "install"], {
      stdin: process.stdin,
      stdout: { write: (s: string) => { outLines.push(s); return true; } } as unknown as NodeJS.WriteStream,
      stderr: process.stderr,
    });

    const output = outLines.join("");
    expect(output).toContain("pre-commit");
    // Should contain the path to the installed hook
    expect(output).toContain(hookPath);
  });

  test("creates hooks directory if it does not exist", async () => {
    const { fakeRepoDir } = setup();
    // Remove the hooks directory
    rmSync(join(fakeRepoDir, ".git", "hooks"), { recursive: true, force: true });

    const cli = buildCli();
    await cli.run(["hook", "install"], {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    });

    const hookPath = join(fakeRepoDir, ".git", "hooks", "pre-commit");
    expect(await Bun.file(hookPath).exists()).toBe(true);
  });
});
