import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// getSessionId returns a unique session ID for this agent.
//
// Priority:
// 1. WIT_SESSION env var — set by the agent or user for explicit identity
// 2. CLAUDE_SESSION_ID env var — set automatically by Claude Code per session
// 3. .wit/session.id file — fallback for single-agent use
//
// This ensures multiple agents in the same repo get different session IDs.
export function getSessionId(witDir: string): string {
  const envSession = process.env["WIT_SESSION"] ?? process.env["CLAUDE_SESSION_ID"];
  if (envSession) {
    return envSession;
  }

  const sessionPath = join(witDir, "session.id");
  try {
    return readFileSync(sessionPath, "utf-8").trim();
  } catch {
    throw new Error("No session found. Run `wit init` first, or set WIT_SESSION env var.");
  }
}

// writeSessionId generates a default session ID and persists it to .wit/session.id.
// This is the fallback for single-agent use. Multi-agent setups should use
// WIT_SESSION env var instead so each agent has a unique identity.
export function writeSessionId(witDir: string): string {
  const sessionId = `wit_${randomBytes(16).toString("hex")}`;
  writeFileSync(join(witDir, "session.id"), sessionId, "utf-8");
  return sessionId;
}
