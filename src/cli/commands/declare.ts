import { Command, Option } from "clipanion";
import { rpc } from "../client";
import { getSessionId } from "../session";
import { WIT_DIR } from "../../shared/paths";

type ConflictItem = {
  type: string;
  description: string;
  conflictingIntentId?: string;
};

type IntentDeclareResult = {
  intentId: string;
  conflicts: {
    hasConflicts: boolean;
    items: ConflictItem[];
  };
};

export class DeclareCommand extends Command {
  static override paths = [["declare"]];
  static override usage = Command.Usage({
    description: "Declare intent to work on specific files and symbols",
  });

  description = Option.String("--description", {
    required: true,
    description: "Description of planned work",
  });

  files = Option.Array("--files", {
    required: true,
    description: "Files this intent targets",
  });

  symbols = Option.Array("--symbols", {
    required: false,
    description: "Symbol names within the files",
  });

  json = Option.Boolean("--json", false, {
    description: "Output machine-readable JSON",
  });

  async execute(): Promise<number> {
    try {
      const sessionId = getSessionId(WIT_DIR);
      const result = await rpc<IntentDeclareResult>("intent.declare", {
        sessionId,
        description: this.description,
        files: this.files,
        symbols: this.symbols ?? [],
      });

      if (this.json) {
        this.context.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        this.context.stdout.write(`Intent declared: ${result.intentId}\n`);
        if (result.conflicts.hasConflicts) {
          this.context.stdout.write("Conflicts detected:\n");
          for (const item of result.conflicts.items) {
            this.context.stdout.write(`  [${item.type}] ${item.description}\n`);
          }
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
