import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Pin Turbopack's project root to this repo. Without it, a pnpm-workspace.yaml
// in a parent directory (e.g. the user's home dir) hijacks root inference — in
// dev that made every route 404 (the app/ dir was resolved outside the repo).
const repoRoot = dirname(fileURLToPath(import.meta.url));

/** Minimal Next.js config for TRACE. No image optimization, no telemetry surprises. */
const nextConfig = {
  reactStrictMode: true,
  turbopack: { root: repoRoot },
};

export default nextConfig;
