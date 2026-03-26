import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "web-tree-sitter";

export type ParserService = {
  typescript: Parser.Language;
  python: Parser.Language;
  parser: Parser;
};

// Resolve WASM paths relative to this file's location — same CWD-independence
// pattern as migrate.ts, since the daemon has unpredictable CWD after detach.
export function defaultWasmPaths(): { wasmDir: string; treeSitterWasm: string } {
  const thisDir = fileURLToPath(new URL(".", import.meta.url));
  const nodeModules = join(thisDir, "../../node_modules");

  return {
    wasmDir: join(nodeModules, "tree-sitter-wasms/out"),
    treeSitterWasm: join(nodeModules, "web-tree-sitter/tree-sitter.wasm"),
  };
}

export async function createParserService(
  wasmDir: string,
  treeSitterWasm: string,
): Promise<ParserService> {
  await Parser.init({
    // locateFile is required — without it the Emscripten runtime looks for
    // tree-sitter.wasm relative to CWD, which fails in daemon context.
    locateFile: () => treeSitterWasm,
  });

  const tsBytes = await Bun.file(join(wasmDir, "tree-sitter-typescript.wasm")).bytes();
  const pyBytes = await Bun.file(join(wasmDir, "tree-sitter-python.wasm")).bytes();

  const typescript = await Parser.Language.load(tsBytes);
  const python = await Parser.Language.load(pyBytes);
  const parser = new Parser();

  return { typescript, python, parser };
}
