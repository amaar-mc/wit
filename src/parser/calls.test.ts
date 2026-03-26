import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ParserService } from "./loader";
import { createParserService, defaultWasmPaths } from "./loader";
import { extractSymbols } from "./symbols";
import { extractCallEdges, qualifyEdges } from "./calls";

let service: ParserService;

beforeAll(async () => {
  const paths = defaultWasmPaths();
  service = await createParserService(paths.wasmDir, paths.treeSitterWasm);
});

afterAll(() => {
  service.parser.delete();
});

describe("extractCallEdges - TypeScript", () => {
  test("function A calls function B produces edge { caller: 'A', callee: 'B' }", () => {
    const source = `function A(): void {
  B();
}
function B(): void {}`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const edges = extractCallEdges(service.parser, service.typescript, source, symbols);
    expect(edges).toContainEqual({ caller: "A", callee: "B" });
  });

  test("method inside class calls standalone function produces edge with method as caller", () => {
    const source = `function helper(): void {}
class MyClass {
  handleRequest(): void {
    helper();
  }
}`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const edges = extractCallEdges(service.parser, service.typescript, source, symbols);
    expect(edges).toContainEqual({ caller: "handleRequest", callee: "helper" });
  });

  test("arrow function calls another function produces edge with arrow variable name as caller", () => {
    const source = `function target(): void {}
const myArrow = (): void => {
  target();
};`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const edges = extractCallEdges(service.parser, service.typescript, source, symbols);
    expect(edges).toContainEqual({ caller: "myArrow", callee: "target" });
  });

  test("member expression call (obj.method()) produces callee as 'method' (property name only)", () => {
    const source = `function doWork(): void {
  obj.process();
}`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const edges = extractCallEdges(service.parser, service.typescript, source, symbols);
    expect(edges).toContainEqual({ caller: "doWork", callee: "process" });
  });

  test("call at module level (not inside any function) produces no edge", () => {
    const source = `function B(): void {}
B();`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const edges = extractCallEdges(service.parser, service.typescript, source, symbols);
    // Module-level call to B should not appear as caller
    const moduleLevelEdges = edges.filter((e) => e.callee === "B" && e.caller === "");
    expect(moduleLevelEdges).toHaveLength(0);
    // In fact, no edge should have an empty caller
    for (const edge of edges) {
      expect(edge.caller.length).toBeGreaterThan(0);
    }
  });

  test("nested function call: edge caller is the innermost containing function", () => {
    const source = `function outer(): void {
  function inner(): void {
    target();
  }
}
function target(): void {}`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const edges = extractCallEdges(service.parser, service.typescript, source, symbols);
    // target() is called inside inner(), so caller should be "inner" not "outer"
    const targetEdge = edges.find((e) => e.callee === "target");
    expect(targetEdge).toBeDefined();
    expect(targetEdge!.caller).toBe("inner");
  });
});

describe("extractCallEdges - Python", () => {
  test("function a calls function b produces edge { caller: 'a', callee: 'b' }", () => {
    const source = `def a():
    b()

def b():
    pass`;
    const symbols = extractSymbols(service.parser, service.python, source);
    const edges = extractCallEdges(service.parser, service.python, source, symbols);
    expect(edges).toContainEqual({ caller: "a", callee: "b" });
  });

  test("method inside class calls standalone function produces edge with method as caller", () => {
    const source = `def helper():
    pass

class MyClass:
    def handle(self):
        helper()`;
    const symbols = extractSymbols(service.parser, service.python, source);
    const edges = extractCallEdges(service.parser, service.python, source, symbols);
    expect(edges).toContainEqual({ caller: "handle", callee: "helper" });
  });

  test("attribute call (obj.method()) produces callee as 'method' (attribute name only)", () => {
    const source = `def do_work():
    obj.process()`;
    const symbols = extractSymbols(service.parser, service.python, source);
    const edges = extractCallEdges(service.parser, service.python, source, symbols);
    expect(edges).toContainEqual({ caller: "do_work", callee: "process" });
  });

  test("call at module level produces no edge", () => {
    const source = `def b():
    pass

b()`;
    const symbols = extractSymbols(service.parser, service.python, source);
    const edges = extractCallEdges(service.parser, service.python, source, symbols);
    // No edge with empty caller
    for (const edge of edges) {
      expect(edge.caller.length).toBeGreaterThan(0);
    }
  });
});

describe("qualifyEdges", () => {
  test("known callee in same file is qualified as filePath:calleeName", () => {
    const source = `function a(): void { b(); }
function b(): void {}`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const edges = extractCallEdges(service.parser, service.typescript, source, symbols);
    const qualified = qualifyEdges(edges, "src/auth.ts", symbols);
    expect(qualified).toContainEqual({
      caller: "src/auth.ts:a",
      callee: "src/auth.ts:b",
    });
  });

  test("unknown callee is qualified as '?:calleeName'", () => {
    const source = `function login(): void { externalFn(); }`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const edges = extractCallEdges(service.parser, service.typescript, source, symbols);
    const qualified = qualifyEdges(edges, "src/auth.ts", symbols);
    expect(qualified).toContainEqual({
      caller: "src/auth.ts:login",
      callee: "?:externalFn",
    });
  });

  test("caller is always qualified with file path", () => {
    const source = `function myFn(): void { someCall(); }`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const edges = extractCallEdges(service.parser, service.typescript, source, symbols);
    const qualified = qualifyEdges(edges, "src/utils.ts", symbols);
    for (const edge of qualified) {
      expect(edge.caller.startsWith("src/utils.ts:")).toBe(true);
    }
  });
});
