import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * One throwaway parent directory for the whole run, handed to the workers via
 * the environment. Cleaning up here rather than in an `afterEach` is deliberate:
 * better-sqlite3 keeps the file handle until the process that opened it exits,
 * so a per-test `rmSync` fails with EPERM on Windows and silently leaks a
 * directory per test. This hook runs in the main process after the workers are
 * gone, when the handles are actually released.
 */
export function setup(): void {
  process.env.FP_TEST_ROOT = fs.mkdtempSync(
    path.join(os.tmpdir(), "financial-planner-tests-")
  );
}

export async function teardown(): Promise<void> {
  const root = process.env.FP_TEST_ROOT;
  if (!root) return;
  // Windows releases the sqlite handles a moment after the workers exit, so
  // the first attempt can still fail with EPERM. Retry briefly rather than
  // failing an otherwise green run.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  console.warn(`[tests] could not remove ${root}; remove it by hand`);
}
