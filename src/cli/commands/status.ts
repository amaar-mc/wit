import { Command, Option } from "clipanion";
import { rpc } from "../client";
import { renderStatus } from "../render";

export class StatusCommand extends Command {
  static override paths = [["status"]];
  static override usage = Command.Usage({
    description: "Show active intents, locks, and contracts",
  });

  json = Option.Boolean("--json", false, {
    description: "Output machine-readable JSON",
  });

  async execute(): Promise<number> {
    try {
      const [intents, locks, contracts] = await Promise.all([
        rpc<unknown[]>("intent.query", {}),
        rpc<unknown[]>("lock.query", {}),
        rpc<unknown[]>("contract.query", {}),
      ]);

      if (this.json) {
        this.context.stdout.write(JSON.stringify({ intents, locks, contracts }, null, 2) + "\n");
      } else {
        renderStatus(this.context.stdout, {
          intents: intents as Parameters<typeof renderStatus>[1]["intents"],
          locks: locks as Parameters<typeof renderStatus>[1]["locks"],
          contracts: contracts as Parameters<typeof renderStatus>[1]["contracts"],
        });
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
