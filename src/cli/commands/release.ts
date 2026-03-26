import { Command, Option } from "clipanion";
import { rpc } from "../client";
import { getSessionId } from "../session";
import { WIT_DIR } from "../../shared/paths";

type LockReleaseResult = {
  released: boolean;
};

export class ReleaseCommand extends Command {
  static override paths = [["release"]];
  static override usage = Command.Usage({
    description: "Release a held semantic lock on a symbol",
  });

  symbol = Option.String("--symbol", {
    required: true,
    description: "Symbol path to release",
  });

  json = Option.Boolean("--json", false, {
    description: "Output machine-readable JSON",
  });

  async execute(): Promise<number> {
    try {
      const sessionId = getSessionId(WIT_DIR);
      const result = await rpc<LockReleaseResult>("lock.release", {
        symbolPath: this.symbol,
        sessionId,
      });

      if (this.json) {
        this.context.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        this.context.stdout.write(`Lock released: ${this.symbol}\n`);
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
