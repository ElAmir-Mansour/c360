#!/usr/bin/env node
/**
 * Vendors the pdf.js web worker into `public/` so the WatheeqTech Reference
 * Library viewer can load it from a STABLE same-origin path
 * (`/pdfjs/pdf.worker.min.mjs`) in BOTH `next dev` and `next build`/standalone,
 * with NO CDN — the library is a sovereign, offline-capable KSA product.
 *
 * Why not `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`?
 * That webpack-asset pattern is unreliable under Next dev (the emitted URL can
 * 404 / mis-resolve), which blanks the viewer. A plain file in `public/` served
 * at the root is deterministic.
 *
 * The worker version MUST match the installed `pdfjs-dist` API version exactly,
 * so we always copy from the resolved `node_modules` build. Run automatically on
 * install and before dev/build (see package.json `postinstall`/`predev`/
 * `prebuild`); safe to run by hand: `node scripts/vendor-pdf-worker.mjs`.
 */
import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

function resolveWorkerSource() {
  // Resolve via the package entry so we honour the actual installed location.
  const pkgPath = require.resolve('pdfjs-dist/package.json');
  const distDir = dirname(pkgPath);
  const candidates = [
    join(distDir, 'build', 'pdf.worker.min.mjs'),
    join(distDir, 'build', 'pdf.worker.mjs'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `pdf.js worker not found under ${distDir}/build — is pdfjs-dist installed?`,
    );
  }
  const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  return { found, version };
}

try {
  const { found, version } = resolveWorkerSource();
  const destDir = join(ROOT, 'public', 'pdfjs');
  const dest = join(destDir, 'pdf.worker.min.mjs');
  mkdirSync(destDir, { recursive: true });
  copyFileSync(found, dest);
  console.log(
    `✓ vendored pdf.js worker (v${version}) → public/pdfjs/pdf.worker.min.mjs`,
  );
} catch (err) {
  // Never hard-fail install/dev/build over the vendored asset — the viewer
  // already degrades to the native <iframe> when the worker is missing.
  console.warn(`⚠ vendor-pdf-worker: ${err.message} (viewer will use native fallback)`);
}
