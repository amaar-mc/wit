export const PROTOCOL_VERSION = "1" as const;

export interface RpcRequest {
  jsonrpc: "2.0";
  witVersion: typeof PROTOCOL_VERSION;
  id: string;
  method: string;
  params: unknown;
}

export interface RpcSuccess<T = unknown> {
  jsonrpc: "2.0";
  witVersion: typeof PROTOCOL_VERSION;
  id: string;
  result: T;
}

export interface RpcError {
  jsonrpc: "2.0";
  witVersion: typeof PROTOCOL_VERSION;
  id: string | null;
  error: { code: number; message: string; data?: unknown };
}

export function createRpcRequest(method: string, params: unknown): RpcRequest {
  return {
    jsonrpc: "2.0",
    witVersion: PROTOCOL_VERSION,
    id: crypto.randomUUID(),
    method,
    params,
  };
}

export function createRpcSuccess<T>(id: string, result: T): RpcSuccess<T> {
  return {
    jsonrpc: "2.0",
    witVersion: PROTOCOL_VERSION,
    id,
    result,
  };
}

export function createRpcError(
  id: string | null,
  code: number,
  message: string,
  data?: unknown,
): RpcError {
  const error: RpcError["error"] = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return {
    jsonrpc: "2.0",
    witVersion: PROTOCOL_VERSION,
    id,
    error,
  };
}
