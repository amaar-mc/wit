import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ParserService } from "./loader";
import { createParserService, defaultWasmPaths } from "./loader";
import { extractSymbols } from "./symbols";

let service: ParserService;

beforeAll(async () => {
  const paths = defaultWasmPaths();
  service = await createParserService(paths.wasmDir, paths.treeSitterWasm);
});

afterAll(() => {
  service.parser.delete();
});

describe("extractSymbols - TypeScript", () => {
  test("function_declaration 'greet' extracted with correct startLine/endLine and kind 'function'", () => {
    const source = `function greet(name: string): string {
  return name;
}`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const greet = symbols.find((s) => s.name === "greet");

    expect(greet).toBeDefined();
    expect(greet!.kind).toBe("function");
    expect(greet!.startLine).toBe(0);
    expect(greet!.endLine).toBe(2);
  });

  test("arrow function assigned to const 'validate' extracted with kind 'arrow' and name from variable_declarator", () => {
    const source = `const validate = (input: string): boolean => {
  return input.length > 0;
};`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const validate = symbols.find((s) => s.name === "validate");

    expect(validate).toBeDefined();
    expect(validate!.kind).toBe("arrow");
  });

  test("method_definition 'handleRequest' inside class extracted with kind 'method'", () => {
    const source = `class Server {
  handleRequest(req: Request): Response {
    return new Response("ok");
  }
}`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const method = symbols.find((s) => s.name === "handleRequest");

    expect(method).toBeDefined();
    expect(method!.kind).toBe("method");
  });

  test("type_alias_declaration 'UserId' extracted with kind 'type'", () => {
    const source = `type UserId = string;`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const userId = symbols.find((s) => s.name === "UserId");

    expect(userId).toBeDefined();
    expect(userId!.kind).toBe("type");
  });

  test("interface_declaration 'Config' extracted with kind 'interface'", () => {
    const source = `interface Config {
  host: string;
  port: number;
}`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const config = symbols.find((s) => s.name === "Config");

    expect(config).toBeDefined();
    expect(config!.kind).toBe("interface");
  });

  test("class_declaration 'AuthService' extracted with kind 'class'", () => {
    const source = `class AuthService {
  private token: string = "";
}`;
    const symbols = extractSymbols(service.parser, service.typescript, source);
    const authService = symbols.find((s) => s.name === "AuthService");

    expect(authService).toBeDefined();
    expect(authService!.kind).toBe("class");
  });

  test("multiple symbols in one file all extracted with correct non-overlapping line ranges", () => {
    const source = `function first(): void {}

function second(): void {}

const third = (): void => {};`;
    const symbols = extractSymbols(service.parser, service.typescript, source);

    expect(symbols.length).toBeGreaterThanOrEqual(3);

    const sorted = [...symbols].sort((a, b) => a.startLine - b.startLine);
    for (let i = 1; i < sorted.length; i++) {
      // Ranges should be non-overlapping or at most touching
      const current = sorted[i];
      const previous = sorted[i - 1];
      if (current && previous) {
        expect(current.startLine).toBeGreaterThanOrEqual(previous.endLine);
      }
    }
  });
});

describe("extractSymbols - Python", () => {
  test("function_definition 'greet' extracted with kind 'function'", () => {
    const source = `def greet(name: str) -> str:
    return name`;
    const symbols = extractSymbols(service.parser, service.python, source);
    const greet = symbols.find((s) => s.name === "greet");

    expect(greet).toBeDefined();
    expect(greet!.kind).toBe("function");
  });

  test("class_definition 'AuthService' extracted with kind 'class'", () => {
    const source = `class AuthService:
    def __init__(self):
        self.token = ""`;
    const symbols = extractSymbols(service.parser, service.python, source);
    const authService = symbols.find((s) => s.name === "AuthService");

    expect(authService).toBeDefined();
    expect(authService!.kind).toBe("class");
  });

  test("nested function inside class method extracted as separate symbol", () => {
    const source = `class MyClass:
    def outer(self):
        def inner():
            pass`;
    const symbols = extractSymbols(service.parser, service.python, source);
    const inner = symbols.find((s) => s.name === "inner");

    expect(inner).toBeDefined();
    expect(inner!.kind).toBe("function");
  });

  test("decorated function still extracted correctly (decorator does not break name capture)", () => {
    const source = `@property
def value(self):
    return self._value`;
    const symbols = extractSymbols(service.parser, service.python, source);
    const value = symbols.find((s) => s.name === "value");

    expect(value).toBeDefined();
    expect(value!.kind).toBe("function");
  });
});
