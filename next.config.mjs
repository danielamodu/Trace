import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Pin Turbopack's project root to this repo. Without it, a pnpm-workspace.yaml
// in a parent directory (e.g. the user's home dir) hijacks root inference — in
// dev that made every route 404 (the app/ dir was resolved outside the repo).
const repoRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal Next.js config for TRACE. No image optimization, no telemetry surprises.
 *
 * `outputFileTracing*`: TRACE reads its evidence from disk at RUNTIME —
 * fixtures/** (euler.ts/ftx.ts `readFileSync(new URL(...))`) and the bundled
 * complete case in data/shipped/**. Those paths are computed at runtime, so
 * Next's static tracer can't see them and a serverless target (Vercel) would
 * ship functions WITHOUT the files → runtime ENOENT. Listing them here forces
 * them into every route's bundle. `*` applies the include to all routes; the
 * root is pinned so the globs resolve against the repo, not an inferred parent.
 */
const nextConfig = {
  reactStrictMode: true,
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    '*': ['./fixtures/**/*', './data/shipped/**/*'],
  },
};

export default nextConfig;
