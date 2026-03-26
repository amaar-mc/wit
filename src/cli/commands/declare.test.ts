import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Cli } from "clipanion";

// Mock rpc to capture calls and return controlled results
const mockRpc = mock(() =>
  Promise.resolve({
    intentId: "test-intent-id-123",
    conflicts: { hasConflicts: false, items: [] },
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

const { DeclareCommand } = await import("./declare");

function buildCli(): Cli {
  const cli = new Cli({ binaryLabel: "wit", binaryName: "wit", binaryVersion: "0.1.0" });
  cli.register(DeclareCommand);
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

describe("DeclareCommand", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({
      intentId: "test-intent-id-123",
      conflicts: { hasConflicts: false, items: [] },
    });
  });

  test("calls intent.declare with correct params", async () => {
    const cli = buildCli();
    const { stream } = captureStdout();

    await cli.run(["declare", "--description", "Refactor auth module", "--files", "src/auth.ts"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "intent.declare",
      expect.objectContaining({
        sessionId: "test-session",
        description: "Refactor auth module",
        files: ["src/auth.ts"],
      }),
    );
  });

  test("outputs intent ID to human-readable stdout", async () => {
    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(["declare", "--description", "Fix bug", "--files", "src/fix.ts"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(output()).toContain("test-intent-id-123");
  });

  test("outputs JSON result when --json flag is set", async () => {
    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(
      ["declare", "--description", "Add feature", "--files", "src/feature.ts", "--json"],
      {
        stdin: process.stdin,
        stdout: stream,
        stderr: process.stderr,
      },
    );

    const parsed = JSON.parse(output()) as { intentId: string; conflicts: unknown };
    expect(parsed.intentId).toBe("test-intent-id-123");
    expect(parsed).toHaveProperty("conflicts");
  });

  test("shows conflict info when hasConflicts is true", async () => {
    mockRpc.mockResolvedValue({
      intentId: "conflict-intent-id",
      conflicts: {
        hasConflicts: true,
        items: [
          {
            type: "file-overlap",
            description: "Overlaps with another intent on src/auth.ts",
            conflictingIntentId: "other-intent",
          },
        ],
      },
    });

    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(["declare", "--description", "Conflict test", "--files", "src/auth.ts"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(output()).toContain("conflict");
  });
});
