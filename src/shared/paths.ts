import { join } from "node:path";

export function witPaths(root: string): {
  WIT_DIR: string;
  SOCKET_PATH: string;
  PID_PATH: string;
  DB_PATH: string;
} {
  const WIT_DIR = join(root, ".wit");
  return {
    WIT_DIR,
    SOCKET_PATH: join(WIT_DIR, "daemon.sock"),
    PID_PATH: join(WIT_DIR, "daemon.pid"),
    DB_PATH: join(WIT_DIR, "state.db"),
  };
}

const _base = witPaths(process.env["WIT_REPO_ROOT"] ?? process.cwd());

export const WIT_DIR = _base.WIT_DIR;
export const SOCKET_PATH = _base.SOCKET_PATH;
export const PID_PATH = _base.PID_PATH;
export const DB_PATH = _base.DB_PATH;
