import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Point every test at a throwaway database before any module loads. Without
 * this a test that forgets `freshDb()` would open the real `data/` database and
 * `importTransactions` would rewrite every balance in it.
 */
const root =
  process.env.FP_TEST_ROOT ??
  fs.mkdtempSync(path.join(os.tmpdir(), "financial-planner-tests-"));

process.env.DATA_DIR = fs.mkdtempSync(path.join(root, "worker-"));
