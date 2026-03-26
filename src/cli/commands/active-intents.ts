import { Command, Option } from "clipanion";
import { rpc } from "../client";

type IntentQueryResult = {
  intentId: string;
  sessionId: string;
  description: string;
  files: string;
  symbols: string;
  startByte: number | null;
  endByte: number | null;
  status: string;
  declaredAt: number;
  updatedAt: number;
};

// ACTIVE_STATUSES are the intent lifecycle states that represent in-progress work.
// Only these statuses contribute a Wit-Intent trailer to the commit message.
const ACTIVE_STATUSES = new Set(["declared", "active"]);

// QUERY_TIMEOUT_MS is the maximum time to wait for the daemon response.
// If the daemon doesn't respond within this window, we exit silently (code 0)
// to avoid blocking git operations.
const QUERY_TIMEOUT_MS = 500;

export class ActiveIntentsCommand extends Command {
  static override paths = [["_active-intents"]];
  static override usage = Command.Usage({
    description: "List active intent IDs for a session (internal)",
    hidden: true,
  });

  sessionId = Option.String({ required: true, name: "sessionId" });

  async execute(): Promise<number> {
    try {
      const results = await Promise.race<IntentQueryResult[]>([
        rpc<IntentQueryResult[]>("intent.query", { sessionId: this.sessionId }),
        new Promise<IntentQueryResult[]>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), QUERY_TIMEOUT_MS),
        ),
      ]);

      const activeIntents = results.filter((intent) => ACTIVE_STATUSES.has(intent.status));

      for (const intent of activeIntents) {
        this.context.stdout.write(`${intent.intentId}\n`);
      }
    } catch {
      // Daemon unreachable, timed out, or any other error — exit silently.
      // Never block git operations.
      return 0;
    }

    return 0;
  }
}
