import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PdfViewer, resolveInitialEngine } from './pdf-viewer';
import type { PdfViewerLabels } from './pdf-viewer-types';

const labels: PdfViewerLabels = {
  frameTitle: 'PDF',
  nativeBadge: 'Basic',
  richBadge: 'Enhanced',
  useRich: 'Enhanced',
  useNative: 'Basic',
  download: 'Download',
  openNewTab: 'Open',
  loading: 'Loading',
  rendering: 'Rendering',
  unavailable: 'Unavailable',
  engineError: 'Error',
  prevPage: 'Prev',
  nextPage: 'Next',
  pageOf: (c, t) => `${c}/${t}`,
  jumpToPage: 'Go',
  zoomIn: 'In',
  zoomOut: 'Out',
  fitWidth: 'Fit width',
  fitPage: 'Fit page',
  zoomLevel: 'Zoom',
  thumbnails: 'Thumbs',
  showThumbnails: 'Show',
  hideThumbnails: 'Hide',
  thumbnailPage: (n) => `Page ${n}`,
  searchInDoc: 'Search',
  searchPlaceholder: 'Search…',
  nextMatch: 'Next match',
  prevMatch: 'Prev match',
  matchOf: (c, t) => `${c} of ${t}`,
  noMatches: 'No matches',
  searching: 'Searching',
  closeSearch: 'Close',
};

describe('resolveInitialEngine', () => {
  it('prefers pdf.js when supported', () => {
    expect(resolveInitialEngine({ supported: true })).toBe('pdfjs');
  });

  it('falls back to native when unsupported', () => {
    expect(resolveInitialEngine({ supported: false })).toBe('native');
  });

  it('honors an explicit native preference even when supported', () => {
    expect(resolveInitialEngine({ supported: true, preferNative: true })).toBe('native');
  });
});

describe('PdfViewer wrapper', () => {
  it('renders the native <iframe> fallback in a runtime without Web Workers (jsdom)', async () => {
    render(<PdfViewer url="blob:x" fileName="doc.pdf" labels={labels} />);
    // The wrapper decides the engine in an effect; jsdom lacks Worker, so it
    // must land on the native frame and show the PDF iframe.
    const frame = await screen.findByTitle('doc.pdf');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'blob:x');
  });

  it('renders the native frame when native is forced', async () => {
    render(
      <PdfViewer url="blob:y" fileName="forced.pdf" preferNative labels={labels} />,
    );
    const frame = await screen.findByTitle('forced.pdf');
    expect(frame.tagName).toBe('IFRAME');
  });
});
