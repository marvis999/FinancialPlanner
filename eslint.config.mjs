import { dirname } from "path";
import { fileURLToPath } from "url";

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

// eslint-config-next is still an eslintrc-style shareable config, so it is
// bridged into flat config through FlatCompat rather than imported directly.
const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // A leading underscore marks a binding that exists only to be discarded,
      // as in the `{ idx: _idx, ...rest }` omit-keys destructuring.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // CLAUDE.md forbids shadowing a name that is in scope for a different
      // thing. Two tag functions in lib/db.ts compared a parameter with itself
      // because a callback re-used its name; this makes that a build error.
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
    },
  },
];

export default config;
