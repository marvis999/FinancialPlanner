import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url))
  .split(path.sep)
  .join("/")
  .replace(/\/$/, "");

export default defineConfig({
  resolve: {
    alias: {
      "server-only": `${root}/tests/stubs/server-only.ts`,
      // The real one needs an RSC request scope the runner cannot provide.
      "next-intl/server": `${root}/tests/stubs/next-intl-server.ts`,
      "@": root,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Forks, not threads: lib/db.ts never closes its better-sqlite3 handle, so
    // with threads the worker shares the main process and the files are still
    // locked when globalSetup's teardown tries to remove them.
    pool: "forks",
    // Otherwise the local-date tests only assert whatever zone CI happens to use.
    env: { TZ: "Europe/Berlin" },
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
  },
});
