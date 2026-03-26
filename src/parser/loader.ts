import { join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Parser from "web-tree-sitter";

export type ParserService = {
  typescript: Parser.Language;
  python: Parser.Language;
  parser: Parser;
};

// Resolve WASM paths by searching up from this file's location.
// Bun global install hoists deps to a parent node_modules, so we walk
// upward until we find the WASM files rather than assuming a fixed depth.
export function defaultWasmPaths(): { wasmDir: string; treeSitterWasm: string } {
  const thisDir = fileURLToPath(new URL(".", import.meta.url));
  let dir = thisDir;

  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "node_modules");
    const tsWasm = join(candidate, "web-tree-sitter/tree-sitter.wasm");
    if (existsSync(tsWasm)) {
      return {
        wasmDir: join(candidate, "tree-sitter-wasms/out"),
        treeSitterWasm: tsWasm,
      };
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback to original relative path
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
