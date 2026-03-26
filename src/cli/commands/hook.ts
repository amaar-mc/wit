import { Command, Option } from "clipanion";
import { mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { rpc } from "../client";

// The pre-commit hook shell script written to .git/hooks/pre-commit.
// Uses `git diff --cached --name-only` to get staged TS/Python files,
// then passes them as argv via xargs to `wit check-contracts`.
const PRE_COMMIT_SCRIPT = `#!/bin/sh
# Managed by wit. Do not edit -- run \`wit hook install\` to regenerate.
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\\.(ts|tsx|py)$')
if [ -z "$STAGED_FILES" ]; then exit 0; fi
REPO_ROOT=$(git rev-parse --show-toplevel)
echo "$STAGED_FILES" | xargs bun run --cwd "$REPO_ROOT" wit check-contracts
exit $?
`;

export class HookInstallCommand extends Command {
  static override paths = [["hook", "install"]];
  static override usage = Command.Usage({
    description: "Install a git pre-commit hook that enforces accepted contracts",
  });

  async execute(): Promise<number> {
    const repoRoot = process.cwd();

    // Resolve git hooks directory — respects core.hooksPath if set
    let hooksDir: string;
    try {
      const result = await Bun.$`git rev-parse --git-path hooks`.cwd(repoRoot).text();
      hooksDir = result.trim();
      // git rev-parse --git-path hooks may return a relative path
      if (!hooksDir.startsWith("/")) {
        hooksDir = join(repoRoot, hooksDir);
      }
    } catch {
      // Fallback when git command fails (not a git repo or git unavailable)
      hooksDir = join(repoRoot, ".git", "hooks");
    }

    // Create hooks directory if it doesn't exist (recursive is a no-op if it exists)
    mkdirSync(hooksDir, { recursive: true });

    const hookPath = join(hooksDir, "pre-commit");
    writeFileSync(hookPath, PRE_COMMIT_SCRIPT, { encoding: "utf-8" });
    // Make the hook executable
    chmodSync(hookPath, 0o755);

    this.context.stdout.write(`Pre-commit hook installed at ${hookPath}\n`);
    return 0;
  }
}

type CheckContractsViolation = {
  contractId: string;
  symbolPath: string;
  expected: string;
  actual: string;
};

type CheckContractsResult = {
  violations: CheckContractsViolation[];
};

export class CheckContractsCommand extends Command {
  static override paths = [["check-contracts"]];
  static override usage = Command.Usage({
    description:
      "Check staged files against accepted contracts (called by pre-commit hook via xargs)",
  });

  // File paths passed as remaining argv by xargs from the pre-commit hook
  files = Option.Rest({ required: 0 });

  async execute(): Promise<number> {
    if (this.files.length === 0) {
      return 0;
    }

    // Read staged content for each file via git show
    const fileEntries: Array<{ path: string; content: string }> = [];
    for (const filePath of this.files) {
      try {
        const content = await Bun.$`git show :${filePath}`.text();
        fileEntries.push({ path: filePath, content });
      } catch {
        // File might be new/untracked — skip it gracefully
      }
    }

    if (fileEntries.length === 0) {
      return 0;
    }

    let result: CheckContractsResult;
    try {
      result = await Promise.race([
        rpc<CheckContractsResult>("check-contracts", { files: fileEntries }),
        // Best-effort enforcement per research recommendation:
        // if daemon unreachable after 2 seconds, don't block the commit
        new Promise<CheckContractsResult>((resolve) =>
          setTimeout(() => resolve({ violations: [] }), 2000),
        ),
      ]);
    } catch {
      // Daemon unreachable — don't block commit (best-effort enforcement)
      return 0;
    }

    if (result.violations.length === 0) {
      return 0;
    }

    for (const v of result.violations) {
      this.context.stderr.write(
        `Contract violation: ${v.symbolPath}\n  expected: ${v.expected}\n  actual:   ${v.actual}\n`,
      );
    }

    return 1;
  }
}
