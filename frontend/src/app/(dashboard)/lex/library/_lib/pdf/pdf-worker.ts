/**
 * Lazy, one-time pdf.js worker + module bootstrap.
 *
 * pdf.js MUST run its parser off the main thread. The worker is served from a
 * STABLE same-origin path — `/pdfjs/pdf.worker.min.mjs` — which is a VENDORED
 * copy of `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` placed in `public/`
 * by `scripts/vendor-pdf-worker.mjs` (wired to postinstall/predev/prebuild). We
 * deliberately do NOT use `new URL('pdfjs-dist/build/pdf.worker.min.mjs',
 * import.meta.url)`: that webpack-asset URL is unreliable under Next **dev**
 * (it can 404 / mis-resolve and BLANK the viewer). No CDN is used — the library
 * is a sovereign, offline-capable KSA product, so no external host may be
 * required to read a document, and the vendored path works identically in dev,
 * `next build`, and the standalone server.
 *
 * `loadPdfjs()` dynamic-imports the (heavy) engine so it never lands in the
 * initial bundle and never executes during SSR. It is memoized: the module and
 * its worker are configured exactly once per page load. Any failure here (worker
 * asset 404, unsupported browser) rejects — the {@link PdfViewer} wrapper catches
 * it and falls back to the native `<iframe>`, so a worker problem degrades the
 * experience but never blanks the document.
 */

'use client';

// Kept as a compatibility re-export so the reference-library viewer retains
// its existing local import while document upload can share the same bootstrap.
export {
  PDF_WORKER_SRC,
  browserSupportsPdfjs,
  loadPdfjs,
  type Pdfjs,
} from '@/lib/documents/pdfjs';
