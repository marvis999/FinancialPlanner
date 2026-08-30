import "server-only";

import fs from "fs";
import path from "path";

/**
 * Where the databases and the small preference files live. Shared so the
 * language store does not have to pull in SQLite just to read four bytes:
 * `i18n/request.ts` runs for every route, including the static ones.
 */

let ensuredDir: string | null = null;

export function dataDir(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (ensuredDir !== dir) {
    fs.mkdirSync(dir, { recursive: true });
    ensuredDir = dir;
  }
  return dir;
}

/**
 * Read a one-line preference file, or null when it is absent or unreadable.
 * Preferences are single values the app must be able to resolve before it can
 * render at all - which database to open, which language to speak.
 */
export function readPreference(file: string): string | null {
  try {
    return fs.readFileSync(path.join(dataDir(), file), "utf8").trim();
  } catch {
    return null;
  }
}

export function writePreference(file: string, value: string): void {
  fs.writeFileSync(path.join(dataDir(), file), value, "utf8");
}
