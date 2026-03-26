import { Command, Option } from "clipanion";
import { rpc } from "../client";
import { getSessionId } from "../session";
import { WIT_DIR } from "../../shared/paths";

type CallerWarning = {
  type: string;
  message: string;
};

type LockAcquireResult = {
  symbolPath: string;
  sessionId: string;
  acquiredAt: string;
  expiresAt: string;
  warnings: CallerWarning[];
};

export class LockCommand extends Command {
  static override paths = [["lock"]];
  static override usage = Command.Usage({
    description: "Acquire a semantic lock on a symbol",
  });

  symbol = Option.String("--symbol", {
    required: true,
    description: "Symbol path to lock (e.g. src/auth.ts:validate)",
  });

  ttl = Option.String("--ttl", {
    required: false,
    description: "TTL in milliseconds",
  });

  json = Option.Boolean("--json", false, {
    description: "Output machine-readable JSON",
  });

  async execute(): Promise<number> {
    try {
      const sessionId = getSessionId(WIT_DIR);
      const result = await rpc<LockAcquireResult>("lock.acquire", {
        symbolPath: this.symbol,
        sessionId,
        ttlMs: this.ttl !== undefined ? parseInt(this.ttl, 10) : undefined,
      });

      if (this.json) {
        this.context.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        this.context.stdout.write(
          `Lock acquired: ${result.symbolPath} (expires ${result.expiresAt})\n`,
        );
        for (const warning of result.warnings) {
          this.context.stdout.write(`  Warning [${warning.type}]: ${warning.message}\n`);
        }
      }

      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.json) {
        this.context.stdout.write(JSON.stringify({ error: message }) + "\n");
        return 1;
      }
      throw err;
    }
  }
}
