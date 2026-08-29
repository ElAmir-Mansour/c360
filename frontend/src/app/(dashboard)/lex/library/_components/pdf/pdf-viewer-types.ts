/**
 * Shared types for the reference-library PDF viewer stack. Kept in a leaf module
 * (no React, no pdf.js) so the wrapper, the pdf.js engine, the native fallback
 * and the label bundle can all import them without cycles.
 */

export type PdfViewerEngine = 'pdfjs' | 'native';

/**
 * An imperative-style deep-link into an already-open viewer. Bumping `nonce`
 * re-applies the command even when `page`/`term` repeat (e.g. clicking the same
 * citation twice). Used by citation chips and contents-search results to jump to
 * a page and highlight a snippet.
 */
export interface PdfViewerCommand {
  /** 1-based page to scroll to. */
  page?: number;
  /** Text to search + highlight (Arabic-folded). */
  term?: string;
  /** Monotonic token forcing re-application. */
  nonce: number;
}

/** Fully-localized string bundle for the viewer chrome (passed in, never hard-coded). */
export interface PdfViewerLabels {
  frameTitle: string;
  nativeBadge: string;
  richBadge: string;
  useRich: string;
  useNative: string;
  download: string;
  openNewTab: string;
  loading: string;
  rendering: string;
  unavailable: string;
  engineError: string;
  // paging
  prevPage: string;
  nextPage: string;
  pageOf: (current: string, total: string) => string;
  jumpToPage: string;
  // zoom
  zoomIn: string;
  zoomOut: string;
  fitWidth: string;
  fitPage: string;
  zoomLevel: string;
  // thumbnails
  thumbnails: string;
  showThumbnails: string;
  hideThumbnails: string;
  thumbnailPage: (n: string) => string;
  // search
  searchInDoc: string;
  searchPlaceholder: string;
  nextMatch: string;
  prevMatch: string;
  matchOf: (current: string, total: string) => string;
  noMatches: string;
  searching: string;
  closeSearch: string;
}
