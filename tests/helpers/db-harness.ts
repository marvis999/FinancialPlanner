import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { vi } from "vitest";

import type { ImportTransaction } from "@/lib/types";

export type DbModule = typeof import("@/lib/db");

/**
 * Every throwaway database lives under the one directory global-setup creates
 * and removes, so nothing survives the run. Creating a parent of our own here
 * would leak it: better-sqlite3 holds the file handle until the owning process
 * exits, so only the teardown hook in the main process can delete these.
 */
function root(): string {
  const dir =
    process.env.FP_TEST_ROOT ??
    path.join(os.tmpdir(), "financial-planner-tests-fallback");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A fresh, empty directory under the managed root. */
export function freshDataDir(prefix = "db-"): string {
  const dir = fs.mkdtempSync(path.join(root(), prefix));
  process.env.DATA_DIR = dir;
  return dir;
}

/**
 * Load `lib/db` against a brand-new, empty database. `lib/db.ts` caches its
 * handle in a module-level `let db`, so a second import in the same process
 * would silently reuse the first database file; clearing the module registry
 * and re-importing gives every test its own instance, and re-runs the schema
 * DDL plus the migrations - which is where the first-import bugs live.
 */
export async function freshDb(): Promise<DbModule> {
  freshDataDir();
  vi.resetModules();
  return import("@/lib/db");
}

/** Minimal parsed booking, so tests state only what they are about. */
export function tx(
  date: string,
  amount: number,
  fingerprint: string,
  over: Partial<ImportTransaction> = {}
): ImportTransaction {
  return {
    date,
    valuta: date,
    name: "Testbuchung",
    amount,
    currency: "EUR",
    type: "SONSTIGER EINZUG",
    purpose: "Test",
    iban: "",
    bic: "",
    fingerprint,
    ...over,
  };
}
