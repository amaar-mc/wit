import { unlinkSync, existsSync } from "node:fs";
import { witPaths } from "../shared/paths";
import { createRpcRequest } from "../shared/protocol";

export type WitPaths = ReturnType<typeof witPaths>;

// Lazy default — avoids importing module-level constants at load time,
// which would bake in the CWD at import. Callers in tests pass explicit paths.
function defaultPaths(): WitPaths {
  return witPaths(process.env["WIT_REPO_ROOT"] ?? process.cwd());
}

// isDaemonAlive checks if a daemon process is running by reading its PID file.
// If the PID file exists but the process is dead, the stale file is removed.
export async function isDaemonAlive(paths: WitPaths = defaultPaths()): Promise<boolean> {
  const pidFile = Bun.file(paths.PID_PATH);
  const pidExists = await pidFile.exists();
  if (!pidExists) {
    return false;
  }

  const pidText = await pidFile.text();
  const pid = parseInt(pidText.trim(), 10);

  if (isNaN(pid)) {
    // Corrupt PID file — treat as dead and remove it
    try {
      unlinkSync(paths.PID_PATH);
    } catch {
      // Already gone — ignore
    }
    return false;
  }

  try {
    // Signal 0 probes whether process exists without sending a real signal
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH = no such process — stale PID file, clean it up
    try {
      unlinkSync(paths.PID_PATH);
    } catch {
      // Already removed concurrently — ignore
    }
    return false;
  }
}

// spawnDaemon launches the daemon as a fully detached subprocess.
// The daemon process inherits WIT_REPO_ROOT so it knows which repo it serves.
// proc.unref() ensures the parent CLI process exits without waiting for the daemon.
export async function spawnDaemon(paths: WitPaths): Promise<void> {
  // Resolve path to daemon entry point relative to this module's location
  const daemonPath = new URL("../daemon/index.ts", import.meta.url).pathname;

  // WIT_REPO_ROOT for daemon = parent of .wit/ directory
  const repoRoot = paths.WIT_DIR.replace(/[/\\]\.wit$/, "");

  const proc = Bun.spawn(["bun", "run", daemonPath], {
    detached: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, WIT_REPO_ROOT: repoRoot },
  });

  // Unref the child — parent CLI must not block waiting for daemon lifecycle
  proc.unref();
}

// waitForSocket polls until the daemon's unix socket file appears or timeout expires.
// Uses node:fs existsSync because Bun.file().exists() returns false for socket files.
export async function waitForSocket(timeoutMs: number, paths: WitPaths): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (existsSync(paths.SOCKET_PATH)) {
      return;
    }
    await Bun.sleep(50);
  }

  throw new Error(`Daemon did not start within ${timeoutMs}ms`);
}

// ensureDaemon is the central connect-or-spawn idiom:
// if the daemon is already alive, return immediately; otherwise spawn it and wait.
export async function ensureDaemon(paths: WitPaths = defaultPaths()): Promise<void> {
  if (await isDaemonAlive(paths)) {
    return;
  }

  await spawnDaemon(paths);
  await waitForSocket(3000, paths);
}

// rpc sends a JSON-RPC 2.0 request to the daemon over its unix socket.
// It calls ensureDaemon first, so callers never need to start the daemon manually.
export async function rpc<T>(method: string, params: unknown, paths: WitPaths = defaultPaths()): Promise<T> {
  await ensureDaemon(paths);

  const response = await fetch("http://localhost/rpc", {
    unix: paths.SOCKET_PATH,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createRpcRequest(method, params)),
  });

  const body = (await response.json()) as {
    result?: T;
    error?: { code: number; message: string };
  };

  if (body.error) {
    throw new Error(`RPC error [${body.error.code}]: ${body.error.message}`);
  }

  return body.result as T;
}
