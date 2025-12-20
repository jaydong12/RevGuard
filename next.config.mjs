/**
 * Workaround for Windows/OneDrive/AV file locking (EBUSY) in Next dev.
 *
 * NOTE: Next's `distDir` must be a path relative to the project root.
 * Using an absolute Windows path can crash dev server startup (ENOENT).
 *
 * We move the build output under `node_modules/.cache/next` which (in practice)
 * is less likely to be aggressively scanned/locked than `.next` in the repo root.
 */
const distDir =
  process.platform === 'win32'
    ? process.env.NODE_ENV === 'production'
      ? 'node_modules/.cache/next-build'
      : 'node_modules/.cache/next-dev'
    : '.next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
};

export default nextConfig;


