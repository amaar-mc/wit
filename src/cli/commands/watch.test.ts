import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Cli } from "clipanion";

// Mock readline before any imports that use it
// readline is a default import, so we need both default and named exports
const mockCursorTo = mock((_stream: unknown, _x: number, _y: number) => {});
const mockClearScreenDown = mock((_stream: unknown) => {});
const readlineMock = {
  cursorTo: mockCursorTo,
  clearScreenDown: mockClearScreenDown,
};
mock.module("node:readline", () => ({
  default: readlineMock,
  cursorTo: mockCursorTo,
  clearScreenDown: mockClearScreenDown,
}));

// Mock rpc to return controlled data — prevents real daemon connections in tests
const mockRpc = mock(() => Promise.resolve([]));

mock.module("../client", () => ({
  rpc: mockRpc,
  ensureDaemon: mock(() => Promise.resolve()),
}));

// Import after mocking
const { WatchCommand } = await import("./watch");

function buildCli(): Cli {
  const cli = new Cli({ binaryLabel: "wit", binaryName: "wit", binaryVersion: "0.1.0" });
  cli.register(WatchCommand);
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

describe("WatchCommand", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    // Default: all queries return empty arrays
    mockRpc.mockResolvedValue([]);
  });

  test("performs initial draw on execute — calls rpc 3 times and renders status", async () => {
    // We need SIGINT to resolve the blocking promise after the initial draw
    // Use a trick: emit SIGINT immediately after execute starts so it resolves after redraw
    const cli = buildCli();
    const { stream, output } = captureStdout();

    // Schedule SIGINT emission after a tick so initial redraw completes first
    setTimeout(() => {
      process.emit("SIGINT");
    }, 10);

    await cli.run(["watch", "--interval", "60000"], {
      stdin: process.stdin,
      stdout: stream,
      stderr: process.stderr,
    });

    // rpc should have been called 3 times: intent.query, lock.query, contract.query
    expect(mockRpc.mock.calls.length).toBe(3);

    const calledMethods = mockRpc.mock.calls.map((call) => call[0] as string);
    expect(calledMethods).toContain("intent.query");
    expect(calledMethods).toContain("lock.query");
    expect(calledMethods).toContain("contract.query");

    // renderStatus output should be present — section headers
    const result = output();
    expect(result).toContain("Intents:");
    expect(result).toContain("Locks:");
    expect(result).toContain("Contracts:");
  });

  test("handles rpc error without crashing — continues watching", async () => {
    // Make rpc throw on the first call
    mockRpc.mockRejectedValue(new Error("daemon unreachable"));

    const cli = buildCli();
    const { stream, output } = captureStdout();

    // Emit SIGINT after brief delay so watch resolves cleanly
    setTimeout(() => {
      process.emit("SIGINT");
    }, 10);

    // Should not throw
    let exitCode: number | undefined;
    try {
      exitCode = await cli.run(["watch", "--interval", "60000"], {
        stdin: process.stdin,
        stdout: stream,
        stderr: process.stderr,
      });
    } catch (err) {
      // Should not reach here
      throw new Error(`WatchCommand threw unexpectedly: ${err}`);
    }

    // Exit code should be 0 (clean exit via SIGINT)
    expect(exitCode).toBe(0);

    // Error message should be shown inline
    const result = output();
    expect(result).toContain("error polling daemon");
    expect(result).toContain("daemon unreachable");
  });
});
