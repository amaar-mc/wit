import Parser from "web-tree-sitter";
import type { SymbolInfo } from "./symbols";

export type CallEdge = {
  caller: string;
  callee: string;
};

export type QualifiedCallEdge = {
  caller: string;
  callee: string;
};

// Tree-sitter query for TypeScript call expressions.
// Captures the callee identifier for both plain calls `fn()` and member
// expression calls `obj.method()`.
const TS_CALL_QUERY = `
  (call_expression
    function: [
      (identifier) @callee
      (member_expression property: (property_identifier) @callee)
    ]) @call
`;

// Tree-sitter query for Python call expressions.
const PY_CALL_QUERY = `
  (call
    function: [
      (identifier) @callee
      (attribute attribute: (identifier) @callee)
    ]) @call
`;

// Node types that form a function boundary when walking up the parent chain.
const TS_FUNCTION_BOUNDARY_TYPES = new Set([
  "function_declaration",
  "arrow_function",
  "method_definition",
]);

const PY_FUNCTION_BOUNDARY_TYPES = new Set(["function_definition"]);

// Determine whether this language uses the TS or Python query by trying to
// compile the TS query. Matching symbols.ts's approach.
function getQueryString(language: Parser.Language): {
  queryString: string;
  boundaryTypes: Set<string>;
} {
  try {
    language.query(TS_CALL_QUERY);
    return { queryString: TS_CALL_QUERY, boundaryTypes: TS_FUNCTION_BOUNDARY_TYPES };
  } catch {
    return { queryString: PY_CALL_QUERY, boundaryTypes: PY_FUNCTION_BOUNDARY_TYPES };
  }
}

// Walk up the parent chain from `node` to find the innermost function boundary.
// Returns the function name, or null if the call is at module level.
function findContainingFunctionName(
  node: Parser.SyntaxNode,
  boundaryTypes: Set<string>,
): string | null {
  let current: Parser.SyntaxNode | null = node.parent;

  while (current !== null) {
    if (boundaryTypes.has(current.type)) {
      if (current.type === "arrow_function") {
        // Arrow function: walk up to parent variable_declarator to get its name
        const parent = current.parent;
        if (parent && parent.type === "variable_declarator") {
          const nameNode = parent.childForFieldName("name");
          return nameNode?.text ?? null;
        }
        // Arrow function not assigned to a variable — treat as anonymous, skip
        return null;
      }

      const nameNode = current.childForFieldName("name");
      return nameNode?.text ?? null;
    }
    current = current.parent;
  }

  // Reached root without finding a function boundary — module-level call
  return null;
}

export function extractCallEdges(
  parser: Parser,
  language: Parser.Language,
  source: string,
  _symbols: SymbolInfo[],
): CallEdge[] {
  // IMPORTANT: Do not await anything between setLanguage and parse —
  // the Parser object is not thread-safe and must not be interrupted.
  parser.setLanguage(language);
  const tree = parser.parse(source);

  const { queryString, boundaryTypes } = getQueryString(language);
  const query = language.query(queryString);
  const matches = query.matches(tree.rootNode);

  const edges: CallEdge[] = [];
  // Deduplicate: the same (caller, callee) pair can appear multiple times if
  // a function calls the same callee more than once.
  const seen = new Set<string>();

  for (const match of matches) {
    const calleeCapture = match.captures.find((c) => c.name === "callee");
    if (!calleeCapture) continue;

    const callee = calleeCapture.node.text;
    const callNode = match.captures.find((c) => c.name === "call");
    if (!callNode) continue;

    const caller = findContainingFunctionName(callNode.node, boundaryTypes);
    if (caller === null) continue; // module-level call, no edge

    const key = `${caller}:${callee}`;
    if (seen.has(key)) continue;
    seen.add(key);

    edges.push({ caller, callee });
  }

  return edges;
}

export function qualifyEdges(
  edges: CallEdge[],
  filePath: string,
  symbols: SymbolInfo[],
): QualifiedCallEdge[] {
  const knownNames = new Set(symbols.map((s) => s.name));

  return edges.map((edge) => ({
    caller: `${filePath}:${edge.caller}`,
    callee: knownNames.has(edge.callee)
      ? `${filePath}:${edge.callee}`
      : `?:${edge.callee}`,
  }));
}
