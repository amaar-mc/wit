import { Command, Option } from "clipanion";
import readline from "node:readline";
import { rpc } from "../client";
import { renderStatus } from "../render";

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

type LockQueryResult = {
  symbolPath: string;
  sessionId: string;
  acquiredAt: string;
  expiresAt: string;
  ttlRemainingMs: number;
};

type ContractQueryResult = {
  contractId: string;
  proposerSessionId: string;
  symbolPath: string;
  signature: string;
  status: string;
  responderSessionId: string | null;
  proposedAt: number;
  respondedAt: number | null;
};

export class WatchCommand extends Command {
  static override paths = [["watch"]];
  static override usage = Command.Usage({
    description: "Watch coordination state in real-time",
  });

  interval = Option.String("--interval", "2000", {
    description: "Poll interval in milliseconds (default: 2000)",
  });

  async execute(): Promise<number> {
    const intervalMs = parseInt(this.interval, 10);

    const redraw = async (): Promise<void> => {
      try {
        const [intents, locks, contracts] = await Promise.all([
          rpc<IntentQueryResult[]>("intent.query", {}),
          rpc<LockQueryResult[]>("lock.query", {}),
          rpc<ContractQueryResult[]>("contract.query", {}),
        ]);
        readline.cursorTo(process.stdout, 0, 0);
        readline.clearScreenDown(process.stdout);
        this.context.stdout.write("wit watch (Ctrl+C to exit)\n\n");
        renderStatus(this.context.stdout, { intents, locks, contracts });
      } catch (err: unknown) {
        readline.cursorTo(process.stdout, 0, 0);
        readline.clearScreenDown(process.stdout);
        const msg = err instanceof Error ? err.message : String(err);
        this.context.stdout.write(`wit watch: error polling daemon: ${msg}\n`);
      }
    };

    await redraw();

    const timer = setInterval(async () => {
      await redraw();
    }, intervalMs);

    await new Promise<void>((resolve) => {
      process.once("SIGINT", () => {
        clearInterval(timer);
        this.context.stdout.write("\n");
        resolve();
      });
    });

    return 0;
  }
}
