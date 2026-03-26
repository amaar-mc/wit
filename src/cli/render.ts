// Type aliases matching RPC response shapes from daemon handlers
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

// formatTtl converts milliseconds into a human-readable "Nm Ns" string.
function formatTtl(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

// formatFiles strips leading/trailing commas from the stored comma-delimited
// files string and renders a human-readable comma-space separated list.
function formatFiles(raw: string): string {
  return raw
    .replace(/^,|,$/g, "")
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .join(", ");
}

// renderStatus writes human-readable sections for intents, locks, and contracts
// to the provided writable stream. Uses simple fixed-width padding — no deps.
export function renderStatus(
  stream: NodeJS.WritableStream,
  data: {
    intents: IntentQueryResult[];
    locks: LockQueryResult[];
    contracts: ContractQueryResult[];
  },
): void {
  // --- Intents ---
  stream.write("Intents:\n");
  if (data.intents.length === 0) {
    stream.write("  No active intents.\n");
  } else {
    const ID_W = 10;
    const SESSION_W = 20;
    const STATUS_W = 12;
    const FILES_W = 30;
    const header =
      "  " +
      "ID".padEnd(ID_W) +
      "Session".padEnd(SESSION_W) +
      "Status".padEnd(STATUS_W) +
      "Description".padEnd(FILES_W) +
      "Files\n";
    stream.write(header);
    for (const intent of data.intents) {
      const id = intent.intentId.slice(0, 8).padEnd(ID_W);
      const session = intent.sessionId.slice(0, 18).padEnd(SESSION_W);
      const status = intent.status.padEnd(STATUS_W);
      const description = intent.description.slice(0, 28).padEnd(FILES_W);
      const files = formatFiles(intent.files);
      stream.write(`  ${id}${session}${status}${description}${files}\n`);
    }
  }

  stream.write("\n");

  // --- Locks ---
  stream.write("Locks:\n");
  if (data.locks.length === 0) {
    stream.write("  No active locks.\n");
  } else {
    const SYMBOL_W = 40;
    const SESSION_W = 20;
    const header =
      "  " +
      "Symbol".padEnd(SYMBOL_W) +
      "Session".padEnd(SESSION_W) +
      "TTL Remaining\n";
    stream.write(header);
    for (const lock of data.locks) {
      const symbol = lock.symbolPath.padEnd(SYMBOL_W);
      const session = lock.sessionId.slice(0, 18).padEnd(SESSION_W);
      const ttl = formatTtl(lock.ttlRemainingMs);
      stream.write(`  ${symbol}${session}${ttl}\n`);
    }
  }

  stream.write("\n");

  // --- Contracts ---
  stream.write("Contracts:\n");
  if (data.contracts.length === 0) {
    stream.write("  No active contracts.\n");
  } else {
    const SYMBOL_W = 30;
    const SIG_W = 20;
    const STATUS_W = 12;
    const header =
      "  " +
      "Symbol".padEnd(SYMBOL_W) +
      "Signature".padEnd(SIG_W) +
      "Status".padEnd(STATUS_W) +
      "Proposer\n";
    stream.write(header);
    for (const contract of data.contracts) {
      const symbol = contract.symbolPath.padEnd(SYMBOL_W);
      const sig = contract.signature.slice(0, 18).padEnd(SIG_W);
      const status = contract.status.padEnd(STATUS_W);
      const proposer = contract.proposerSessionId.slice(0, 18);
      stream.write(`  ${symbol}${sig}${status}${proposer}\n`);
    }
  }
}
