import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Cli } from "clipanion";

// Mock rpc to return controlled data — prevents real daemon connections in tests
const mockRpc = mock(() => Promise.resolve([]));

mock.module("../client", () => ({
  rpc: mockRpc,
  ensureDaemon: mock(() => Promise.resolve()),
}));

mock.module("../session", () => ({
  getSessionId: mock(() => "test-session"),
  writeSessionId: mock(() => "test-session"),
}));

// Import after mocking to ensure mocks are in place
const { StatusCommand } = await import("./status");

function buildCli(): Cli {
  const cli = new Cli({ binaryLabel: "wit", binaryName: "wit", binaryVersion: "0.1.0" });
  cli.register(StatusCommand);
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

describe("StatusCommand", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    // Default: all queries return empty arrays
    mockRpc.mockResolvedValue([]);
  });

  test("outputs human-readable status with section headers", async () => {
    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(["status"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    const result = output();
    expect(result).toContain("Intents:");
    expect(result).toContain("Locks:");
    expect(result).toContain("Contracts:");
  });

  test("outputs 'No active intents' when intents array is empty", async () => {
    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(["status"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(output()).toContain("No active intents.");
  });

  test("outputs JSON when --json flag is set", async () => {
    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(["status", "--json"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    const parsed = JSON.parse(output()) as { intents: unknown[]; locks: unknown[]; contracts: unknown[] };
    expect(parsed).toHaveProperty("intents");
    expect(parsed).toHaveProperty("locks");
    expect(parsed).toHaveProperty("contracts");
    expect(Array.isArray(parsed.intents)).toBe(true);
  });

  test("renders intents rows when intents are present", async () => {
    mockRpc.mockImplementation((method: string) => {
      if (method === "intent.query") {
        return Promise.resolve([
          {
            intentId: "abcdef1234567890",
            sessionId: "test-session",
            description: "Refactor auth",
            files: ",src/auth.ts,",
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

    const cli = buildCli();
    const { stream, output } = captureStdout();

    await cli.run(["status"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    expect(output()).toContain("abcdef12");
    expect(output()).toContain("active");
  });
});
