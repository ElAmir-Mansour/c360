/**
 * Shared, lazy pdf.js bootstrap used by both the reference-library viewer and
 * document-upload text extraction.
 *
 * The worker is vendored by the frontend build at a deterministic same-origin
 * URL. Keeping the bootstrap here prevents each document surface from creating
 * its own pdf.js configuration and keeps the heavy module out of the initial
 * bundle.
 */

'use client';

import type * as PdfjsModule from 'pdfjs-dist';

export type Pdfjs = typeof PdfjsModule;

export const PDF_WORKER_SRC = '/pdfjs/pdf.worker.min.mjs';

let pdfjsPromise: Promise<Pdfjs> | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
  if (pdfjsPromise) return pdfjsPromise;

  pdfjsPromise = (async () => {
    const pdfjs = (await import('pdfjs-dist')) as unknown as Pdfjs;
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    return pdfjs;
  })().catch((error) => {
    // A transient worker/module failure must not poison all later attempts.
    pdfjsPromise = null;
    throw error;
  });

  return pdfjsPromise;
}

/** Cheap client capability probe used by the rich reference-library viewer. */
export function browserSupportsPdfjs(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof Worker === 'undefined') return false;
  if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    return typeof canvas.getContext === 'function' && !!canvas.getContext('2d');
  } catch {
    return false;
  }
}
