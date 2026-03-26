import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Cli } from "clipanion";

const mockRpc = mock(() =>
  Promise.resolve({
    released: true,
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

const { ReleaseCommand } = await import("./release");

function buildCli(): Cli {
  const cli = new Cli({ binaryLabel: "wit", binaryName: "wit", binaryVersion: "0.1.0" });
  cli.register(ReleaseCommand);
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

describe("ReleaseCommand", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ released: true });
  });

  test("calls lock.release with correct symbolPath and sessionId", async () => {
    const cli = buildCli();
    const { stream } = captureStdout();

    await cli.run(["release", "--symbol", "src/auth.ts:validate"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "lock.release",
      expect.objectContaining({
        symbolPath: "src/auth.ts:validate",
        sessionId: "test-session",
      }),
    );
  });

  test("outputs confirmation message to stdout", async () => {
    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(["release", "--symbol", "src/auth.ts:validate"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(output()).toContain("Lock released");
    expect(output()).toContain("src/auth.ts:validate");
  });

  test("outputs JSON when --json flag is set", async () => {
    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(["release", "--symbol", "src/auth.ts:validate", "--json"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    const parsed = JSON.parse(output()) as { released: boolean };
    expect(parsed.released).toBe(true);
  });

  test("outputs error JSON when release fails in --json mode", async () => {
    mockRpc.mockRejectedValue(new Error("Symbol not locked by this session"));

    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(["release", "--symbol", "src/auth.ts:validate", "--json"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    const parsed = JSON.parse(output()) as { error: string };
    expect(parsed).toHaveProperty("error");
    expect(parsed.error).toContain("Symbol not locked");
  });
});
