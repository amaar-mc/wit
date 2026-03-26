import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Cli } from "clipanion";

const mockRpc = mock(() =>
  Promise.resolve({
    symbolPath: "src/auth.ts:validate",
    sessionId: "test-session",
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    warnings: [],
  }),
);

mock.module("../client", () => ({
  rpc: mockRpc,
  ensureDaemon: mock(() => Promise.resolve()),
}));

mock.module("../session", () => ({
  getSessionId: mock(() => "test-session"),
  writeSessionId: mock(() => "test-session"),
}));

const { LockCommand } = await import("./lock");

function buildCli(): Cli {
  const cli = new Cli({ binaryLabel: "wit", binaryName: "wit", binaryVersion: "0.1.0" });
  cli.register(LockCommand);
  return cli;
}

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

describe("LockCommand", () => {
  const expiresAt = new Date(Date.now() + 300000).toISOString();

  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({
      symbolPath: "src/auth.ts:validate",
      sessionId: "test-session",
      acquiredAt: new Date().toISOString(),
      expiresAt,
      warnings: [],
    });
  });

  test("calls lock.acquire with correct symbolPath and sessionId", async () => {
    const cli = buildCli();
    const { stream } = captureStdout();

    await cli.run(["lock", "--symbol", "src/auth.ts:validate"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "lock.acquire",
      expect.objectContaining({
        symbolPath: "src/auth.ts:validate",
        sessionId: "test-session",
      }),
    );
  });

  test("outputs lock acquired confirmation to stdout", async () => {
    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(["lock", "--symbol", "src/auth.ts:validate"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(output()).toContain("Lock acquired");
    expect(output()).toContain("src/auth.ts:validate");
  });

  test("outputs JSON when --json flag is set", async () => {
    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(["lock", "--symbol", "src/auth.ts:validate", "--json"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    const parsed = JSON.parse(output()) as { symbolPath: string; expiresAt: string };
    expect(parsed.symbolPath).toBe("src/auth.ts:validate");
    expect(parsed).toHaveProperty("expiresAt");
  });

  test("passes ttlMs when --ttl is provided", async () => {
    const cli = buildCli();
    const { stream } = captureStdout();

    await cli.run(["lock", "--symbol", "src/auth.ts:validate", "--ttl", "60000"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "lock.acquire",
      expect.objectContaining({
        ttlMs: 60000,
      }),
    );
  });
});
