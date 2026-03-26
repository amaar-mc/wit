import { describe, expect, test } from "bun:test";
import { createParserService, defaultWasmPaths } from "./loader";

describe("createParserService", () => {
  test("resolves without error and returns object with typescript, python, parser properties", async () => {
    const paths = defaultWasmPaths();
    const service = await createParserService(paths.wasmDir, paths.treeSitterWasm);

    expect(service).toBeDefined();
    expect(service.typescript).toBeDefined();
    expect(service.python).toBeDefined();
    expect(service.parser).toBeDefined();
  });

  test("parser can parse a trivial TypeScript string without throwing", async () => {
    const paths = defaultWasmPaths();
    const service = await createParserService(paths.wasmDir, paths.treeSitterWasm);

    service.parser.setLanguage(service.typescript);
    const tree = service.parser.parse("function hello(): void {}");

    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.type).toBe("program");
  });

  test("parser can parse a trivial Python string without throwing", async () => {
    const paths = defaultWasmPaths();
    const service = await createParserService(paths.wasmDir, paths.treeSitterWasm);

    service.parser.setLanguage(service.python);
    const tree = service.parser.parse("def hello(): pass");

    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.type).toBe("module");
  });
});
