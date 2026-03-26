import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// getSessionId reads the stable session ID from .wit/session.id.
// Throws an actionable error if the file does not exist.
export function getSessionId(witDir: string): string {
  const sessionPath = join(witDir, "session.id");
  try {
    return readFileSync(sessionPath, "utf-8").trim();
  } catch {
    throw new Error("No session found. Run `wit init` first.");
  }
}

// writeSessionId generates a stable session ID and persists it to .wit/session.id.
// The ID is derived from the current user and working directory so it survives
// CLI restarts without changing.
export function writeSessionId(witDir: string): string {
  const user = process.env["USER"] ?? "user";
  const cwd = process.cwd();
  const sessionId = `${user}@${cwd}`;
  writeFileSync(join(witDir, "session.id"), sessionId, "utf-8");
  return sessionId;
}
