import { test, expect, describe, afterEach, mock, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Cli } from "clipanion";

// Mock rpc for ActiveIntentsCommand tests
const mockRpc = mock(() => Promise.resolve([]));

mock.module("../client", () => ({
  rpc: mockRpc,
  ensureDaemon: mock(() => Promise.resolve()),
}));

// Import after mocking
const { HookInstallCommand } = await import("./hook");
const { ActiveIntentsCommand } = await import("./active-intents");

// Build a minimal Cli instance with HookInstallCommand for testing
function buildHookCli(): Cli {
  const cli = new Cli({ binaryLabel: "wit", binaryName: "wit", binaryVersion: "0.1.0" });
  cli.register(HookInstallCommand);
  return cli;
}

function buildActiveIntentsCli(): Cli {
  const cli = new Cli({ binaryLabel: "wit", binaryName: "wit", binaryVersion: "0.1.0" });
  cli.register(ActiveIntentsCommand);
  return cli;
}

// Helper to capture stdout from a cli.run() call
function captureStdout(): { stream: NodeJS.WriteStream; output(): string } {
  const lines: string[] = [];
  const stream = {
    write(data: string): boolean {
      lines.push(data);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, output: () => lines.join("") };
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
    const cli = buildHookCli();
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

    const cli = buildHookCli();
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

    const cli = buildHookCli();
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

    const cli = buildHookCli();
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

    const cli = buildHookCli();
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

    const cli = buildHookCli();
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

    const cli = buildHookCli();
    await cli.run(["hook", "install"], {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    });

    const hookPath = join(fakeRepoDir, ".git", "hooks", "pre-commit");
    expect(await Bun.file(hookPath).exists()).toBe(true);
  });

  test("installs prepare-commit-msg hook alongside pre-commit hook", async () => {
    const { hooksDir } = setup();
    const prepareCommitMsgPath = join(hooksDir, "prepare-commit-msg");

    const cli = buildHookCli();
    const outLines: string[] = [];
    await cli.run(["hook", "install"], {
      stdin: process.stdin,
      stdout: { write: (s: string) => { outLines.push(s); return true; } } as unknown as NodeJS.WriteStream,
      stderr: process.stderr,
    });

    // File should exist
    expect(await Bun.file(prepareCommitMsgPath).exists()).toBe(true);

    // Should be executable
    const stats = statSync(prepareCommitMsgPath);
    // eslint-disable-next-line no-bitwise
    const isExecutable = (stats.mode & 0o100) !== 0;
    expect(isExecutable).toBe(true);

    // Should contain Wit-Intent and interpret-trailers
    const content = await Bun.file(prepareCommitMsgPath).text();
    expect(content).toContain("Wit-Intent");
    expect(content).toContain("interpret-trailers");

    // Output should mention prepare-commit-msg
    const output = outLines.join("");
    expect(output).toContain("prepare-commit-msg");
    expect(output).toContain(prepareCommitMsgPath);
  });
});

describe("ActiveIntentsCommand", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue([]);
  });

  test("outputs intent IDs for a session — one UUID per line", async () => {
    const sessionId = "test-user@/home/test/project";

    mockRpc.mockImplementation((method: string, params: unknown) => {
      const p = params as { sessionId?: string };
      if (method === "intent.query" && p.sessionId === sessionId) {
        return Promise.resolve([
          {
            intentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            sessionId,
            description: "Refactor auth",
            files: ",src/auth.ts,",
            symbols: "",
            startByte: null,
            endByte: null,
            status: "declared",
            declaredAt: Date.now(),
            updatedAt: Date.now(),
          },
          {
            intentId: "11111111-2222-3333-4444-555555555555",
            sessionId,
            description: "Add tests",
            files: ",src/auth.test.ts,",
            symbols: "",
            startByte: null,
            endByte: null,
            status: "active",
            declaredAt: Date.now(),
            updatedAt: Date.now(),
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const cli = buildActiveIntentsCli();
    const { stream, output } = captureStdout();

    const exitCode = await cli.run(["_active-intents", sessionId], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(exitCode).toBe(0);
    const result = output();
    expect(result).toContain("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(result).toContain("11111111-2222-3333-4444-555555555555");
    // Each on its own line
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(2);
  });

  test("filters out resolved and abandoned intents", async () => {
    const sessionId = "test-user@/home/test/project";

    mockRpc.mockResolvedValue([
      {
        intentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        sessionId,
        description: "Done work",
        files: ",src/auth.ts,",
        symbols: "",
        startByte: null,
        endByte: null,
        status: "resolved",
        declaredAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        intentId: "11111111-2222-3333-4444-555555555555",
        sessionId,
        description: "Abandoned work",
        files: ",src/auth.ts,",
        symbols: "",
        startByte: null,
        endByte: null,
        status: "abandoned",
        declaredAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const cli = buildActiveIntentsCli();
    const { stream, output } = captureStdout();

    const exitCode = await cli.run(["_active-intents", sessionId], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(exitCode).toBe(0);
    // No output — resolved/abandoned should be filtered
    expect(output().trim()).toBe("");
  });

  test("exits silently (code 0) on rpc error — never blocks git", async () => {
    mockRpc.mockRejectedValue(new Error("daemon not running"));

    const cli = buildActiveIntentsCli();
    const { stream, output } = captureStdout();

    let exitCode: number | undefined;
    try {
      exitCode = await cli.run(["_active-intents", "some-session-id"], {
        stdin: process.stdin,
        stdout: stream,
        stderr: process.stderr,
      });
    } catch (err) {
      throw new Error(`ActiveIntentsCommand threw unexpectedly: ${err}`);
    }

    expect(exitCode).toBe(0);
    // Should produce no output on error
    expect(output().trim()).toBe("");
  });
});
