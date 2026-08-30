import createNextIntlPlugin from "next-intl/plugin";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module — keep it out of the bundler so it
  // runs directly from node_modules in the Node.js runtime.
  serverExternalPackages: ["better-sqlite3"],
};

// Points next-intl at i18n/request.ts, which resolves the stored language.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
