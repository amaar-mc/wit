import Parser from "web-tree-sitter";

export type SymbolInfo = {
  name: string;
  kind: "function" | "method" | "type" | "interface" | "class" | "arrow";
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number;
};

// Capture name suffix maps to SymbolInfo.kind — e.g. "definition.function" -> "function"
const KIND_MAP: Record<string, SymbolInfo["kind"]> = {
  function: "function",
  method: "method",
  type: "type",
  interface: "interface",
  class: "class",
  arrow: "arrow",
};

const TS_SYMBOL_QUERY = `
  (function_declaration
    name: (identifier) @name) @definition.function

  (variable_declarator
    name: (identifier) @name
    value: (arrow_function)) @definition.arrow

  (method_definition
    name: (property_identifier) @name) @definition.method

  (type_alias_declaration
    name: (type_identifier) @name) @definition.type

  (interface_declaration
    name: (type_identifier) @name) @definition.interface

  (class_declaration
    name: (type_identifier) @name) @definition.class
`;

const PY_SYMBOL_QUERY = `
  (function_definition
    name: (identifier) @name) @definition.function

  (class_definition
    name: (identifier) @name) @definition.class
`;

// Determine whether source is TypeScript/JS or Python by testing the query.
// We use the language object itself to pick the right query string.
function getQueryString(language: Parser.Language): string {
  // Attempt to compile the TS query — if it works, use it; otherwise use Python.
  // In practice callers know which language they're passing, but the query string
  // selection here is determined by what the grammar supports.
  try {
    language.query(TS_SYMBOL_QUERY);
    return TS_SYMBOL_QUERY;
  } catch {
    return PY_SYMBOL_QUERY;
  }
}

export function extractSymbols(
  parser: Parser,
  language: Parser.Language,
  source: string,
): SymbolInfo[] {
  // IMPORTANT: Do not await anything between setLanguage and parse — the Parser
  // object is not thread-safe and must not be interrupted between these two calls.
  parser.setLanguage(language);
  const tree = parser.parse(source);

  const queryString = getQueryString(language);
  const query = language.query(queryString);
  const matches = query.matches(tree.rootNode);

  const symbols: SymbolInfo[] = [];

  for (const match of matches) {
    const nameCapture = match.captures.find((c) => c.name === "name");
    const defCapture = match.captures.find((c) => c.name.startsWith("definition."));

    if (!nameCapture || !defCapture) continue;

    const kindSuffix = defCapture.name.slice("definition.".length);
    const kind = KIND_MAP[kindSuffix];
    if (!kind) continue;

    symbols.push({
      name: nameCapture.node.text,
      kind,
      startLine: defCapture.node.startPosition.row,
      endLine: defCapture.node.endPosition.row,
      startByte: defCapture.node.startIndex,
      endByte: defCapture.node.endIndex,
    });
  }

  // Sort by startLine ascending so callers get a predictable order
  symbols.sort((a, b) => a.startLine - b.startLine);

  return symbols;
}
