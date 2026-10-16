/**
 * The static demo: `npm run build:demo` builds this directory as its own Next
 * project and exports plain HTML/JS/CSS to demo/out. No server, no SQLite.
 *
 * It renders the real components from the repository root (externalDir);
 * demo/tsconfig.json swaps "@/app/actions" for the in-memory demo/actions.ts.
 * The root middleware and app/ are not part of this project.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: "export",
  experimental: { externalDir: true },
};

export default nextConfig;
