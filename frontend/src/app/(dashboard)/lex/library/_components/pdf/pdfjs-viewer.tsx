'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Loader2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { loadPdfjs, type Pdfjs } from '../../_lib/pdf/pdf-worker';
import { findMatchRanges, normalizeArabic } from '../../_lib/pdf/pdf-arabic';
import type { PdfViewerCommand, PdfViewerLabels } from './pdf-viewer-types';

interface PdfJsViewerProps {
  url: string;
  fileName?: string;
  dir?: 'ltr' | 'rtl';
  height: number;
  command?: PdfViewerCommand;
  labels: PdfViewerLabels;
  onPageChange?: (page: number) => void;
  onNumPages?: (numPages: number) => void;
  onDownload?: () => void;
  /** Called when pdf.js cannot render — the wrapper swaps to the native iframe. */
  onFallback: (reason: unknown) => void;
}

const MIN_SCALE = 0.35;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;

type FitMode = 'width' | 'page' | null;

interface FlatMatch {
  page: number;
  /** Index of this match among matches ON its page (0-based). */
  indexInPage: number;
}

/**
 * The rich in-app PDF engine (pdf.js). Renders one page at a time to a HiDPI
 * canvas with a selectable text layer over it, plus: page navigation +
 * jump-to-page, zoom (fit-width / fit-page / step), a lazy thumbnail rail, and
 * Arabic-aware in-document search that jumps to and highlights matches. It is
 * dynamically imported (never in the initial bundle, never on the server) by the
 * {@link PdfViewer} wrapper, which supplies `onFallback` so ANY failure here
 * degrades to the native `<iframe>` rather than blanking the page.
 */
export function PdfJsViewer({
  url,
  fileName,
  dir,
  height,
  command,
  labels,
  onPageChange,
  onNumPages,
  onDownload,
  onFallback,
}: PdfJsViewerProps) {
  const [pdfjs, setPdfjs] = useState<Pdfjs | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1.25);
  const [fitMode, setFitMode] = useState<FitMode>('width');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rendering, setRendering] = useState(false);
  const [showThumbs, setShowThumbs] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [layerVersion, setLayerVersion] = useState(0);

  // Search state.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [committedTerm, setCommittedTerm] = useState('');
  const [flatMatches, setFlatMatches] = useState<FlatMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);
  const [indexing, setIndexing] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textSnapshotRef = useRef<string>('');
  const pageTextsRef = useRef<string[] | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const onPageChangeRef = useRef(onPageChange);
  const onFallbackRef = useRef(onFallback);
  onPageChangeRef.current = onPageChange;
  onFallbackRef.current = onFallback;

  // ---- pdf.js bootstrap + document load -----------------------------------
  useEffect(() => {
    let cancelled = false;
    let settled = false;
    setStatus('loading');
    setDoc(null);
    setNumPages(0);
    setPage(1);
    pageTextsRef.current = null;
    let localTask: ReturnType<Pdfjs['getDocument']> | null = null;

    // Single, idempotent failure path. ANY problem (worker 404/parse/blob) — or
    // a silent hang where the worker never answers — must switch the wrapper to
    // the native <iframe>. The document must NEVER be left blank.
    const failToNative = (err: unknown) => {
      if (cancelled || settled) return;
      settled = true;
      console.error('reference-library pdf.js load failed', err);
      setStatus('error');
      onFallbackRef.current(err);
    };

    // Watchdog: if neither a resolve NOR a reject arrives (e.g. the worker
    // script loads but never posts back), give up and fall back rather than
    // showing an empty canvas forever.
    const watchdog = setTimeout(() => {
      failToNative(new Error('pdf.js load timed out'));
    }, 20_000);

    void (async () => {
      try {
        const lib = await loadPdfjs();
        if (cancelled) return;
        setPdfjs(lib);
        // Feed pdf.js the raw BYTES, not the blob URL: reading the object URL back
        // into an ArrayBuffer and passing `{ data }` makes pdf.js parse locally with
        // NO network/fetch transport. That (a) sidesteps pdf.js's request-header
        // construction (which was throwing "Failed to construct 'Headers': Invalid
        // name" and forcing the iframe fallback) and (b) renders to <canvas> in every
        // environment (incl. headless), so the document is never blank.
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        if (cancelled) return;
        // getDocument can throw synchronously on malformed data as well as reject —
        // the try/catch covers both.
        localTask = lib.getDocument({ data: bytes });
        const loaded = await localTask.promise;
        if (cancelled || settled) return;
        settled = true;
        clearTimeout(watchdog);
        docRef.current = loaded;
        setDoc(loaded);
        setNumPages(loaded.numPages);
        onNumPages?.(loaded.numPages);
        setStatus('ready');
      } catch (err) {
        clearTimeout(watchdog);
        if (cancelled) return;
        failToNative(err);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      try {
        renderTaskRef.current?.cancel();
      } catch {
        /* noop */
      }
      const prev = docRef.current;
      docRef.current = null;
      void prev?.destroy().catch(() => undefined);
      void localTask?.destroy?.().catch?.(() => undefined);
    };
    // onNumPages intentionally omitted — identity may change per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ---- container width tracking (drives fit modes) ------------------------
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- fit-mode → scale derivation ----------------------------------------
  useEffect(() => {
    if (!doc || !fitMode || containerWidth <= 0) return;
    let cancelled = false;
    void doc.getPage(page).then((p) => {
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const horizontalPadding = 32;
      const widthScale = (containerWidth - horizontalPadding) / base.width;
      let next = widthScale;
      if (fitMode === 'page') {
        const heightScale = (height - 24) / base.height;
        next = Math.min(widthScale, heightScale);
      }
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
      setScale((prev) => (Math.abs(prev - clamped) > 0.001 ? clamped : prev));
    });
    return () => {
      cancelled = true;
    };
  }, [doc, page, fitMode, containerWidth, height]);

  // ---- page + text-layer render -------------------------------------------
  useEffect(() => {
    if (!doc || !pdfjs || status !== 'ready') return;
    let cancelled = false;
    let pageProxy: PDFPageProxy | null = null;
    setRendering(true);

    (async () => {
      try {
        pageProxy = await doc.getPage(page);
        if (cancelled) return;
        const viewport = pageProxy.getViewport({ scale });
        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2d canvas context unavailable');

        const outputScale = Math.min(window.devicePixelRatio || 1, 2.5);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        try {
          renderTaskRef.current?.cancel();
        } catch {
          /* previous task already settled */
        }
        const task = pageProxy.render({
          canvasContext: ctx,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;

        // Text layer (selectable + highlightable).
        if (textLayerDiv) {
          textLayerDiv.replaceChildren();
          textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
          textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
          textLayerDiv.style.setProperty('--scale-factor', String(scale));
          try {
            const textContent = await pageProxy.getTextContent();
            if (cancelled) return;
            const textLayer = new pdfjs.TextLayer({
              textContentSource: textContent,
              container: textLayerDiv,
              viewport,
            });
            await textLayer.render();
            if (cancelled) return;
            textSnapshotRef.current = textLayerDiv.innerHTML;
          } catch {
            // A missing/broken text layer only costs selection + highlight, not
            // the visible page — keep going.
            textSnapshotRef.current = '';
          }
        }
        setLayerVersion((v) => v + 1);
      } catch (err) {
        if (cancelled) return;
        if (isCancelException(pdfjs, err)) return;
        console.error('reference-library page render failed', err);
        onFallbackRef.current(err);
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTaskRef.current?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [doc, pdfjs, status, page, scale]);

  // ---- keep page input + reported page in sync ----------------------------
  useEffect(() => {
    setPageInput(String(page));
    onPageChangeRef.current?.(page);
  }, [page]);

  // ---- search: build the per-page text index (lazy) -----------------------
  const buildIndex = useCallback(async (): Promise<string[]> => {
    if (pageTextsRef.current) return pageTextsRef.current;
    const d = docRef.current;
    if (!d) return [];
    setIndexing(true);
    try {
      const texts: string[] = [];
      for (let i = 1; i <= d.numPages; i += 1) {
        const p = await d.getPage(i);
        const tc = await p.getTextContent();
        const raw = tc.items
          .map((it) => ('str' in it ? it.str : ''))
          .join(' ');
        texts.push(raw);
      }
      pageTextsRef.current = texts;
      return texts;
    } finally {
      setIndexing(false);
    }
  }, []);

  const runSearch = useCallback(
    async (term: string, opts: { jump?: boolean } = {}) => {
      const jump = opts.jump ?? true;
      const trimmed = normalizeArabic(term).trim();
      setCommittedTerm(term);
      if (!trimmed) {
        setFlatMatches([]);
        setActiveMatch(0);
        return;
      }
      const texts = await buildIndex();
      const flat: FlatMatch[] = [];
      texts.forEach((text, i) => {
        const ranges = findMatchRanges(text, term);
        ranges.forEach((_, idx) => flat.push({ page: i + 1, indexInPage: idx }));
      });
      setFlatMatches(flat);
      setActiveMatch(0);
      // Jump to the first hit UNLESS the caller pinned a page (e.g. a citation
      // that carries its own page — the highlight should stay on that page).
      if (jump && flat.length > 0) setPage(flat[0].page);
    },
    [buildIndex],
  );

  const gotoMatch = useCallback(
    (nextIndex: number) => {
      if (flatMatches.length === 0) return;
      const wrapped = (nextIndex + flatMatches.length) % flatMatches.length;
      setActiveMatch(wrapped);
      setPage(flatMatches[wrapped].page);
    },
    [flatMatches],
  );

  // ---- highlight pass (runs after each render or match change) -------------
  useEffect(() => {
    const container = textLayerRef.current;
    if (!container) return;
    // Restore pristine spans, then (re)apply highlights.
    if (textSnapshotRef.current) container.innerHTML = textSnapshotRef.current;
    if (!committedTerm.trim()) return;

    const activeOnPage =
      flatMatches[activeMatch]?.page === page
        ? flatMatches[activeMatch].indexInPage
        : -1;

    let markSeq = 0;
    let activeMarkEl: HTMLElement | null = null;
    const spans = Array.from(container.querySelectorAll<HTMLElement>('span'));
    for (const span of spans) {
      if (span.childElementCount > 0) continue; // skip marked-content wrappers
      const text = span.textContent ?? '';
      const ranges = findMatchRanges(text, committedTerm);
      if (ranges.length === 0) continue;
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const range of ranges) {
        if (range.start > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, range.start)));
        }
        const mark = document.createElement('mark');
        mark.className = 'rl-pdf-mark';
        if (markSeq === activeOnPage) {
          mark.dataset.active = 'true';
          activeMarkEl = mark;
        }
        mark.textContent = text.slice(range.start, range.end);
        frag.appendChild(mark);
        cursor = range.end;
        markSeq += 1;
      }
      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }
      span.replaceChildren(frag);
    }
    if (activeMarkEl) {
      activeMarkEl.scrollIntoView({ block: 'center', inline: 'center' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerVersion, committedTerm, activeMatch, page]);

  // ---- external deep-link command (citation / contents-search) ------------
  const lastNonceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!command || command.nonce === lastNonceRef.current) return;
    // Wait until the document is loaded so page targets clamp against the REAL
    // page count (a deep-link arriving pre-load must not be stranded on page 1).
    if (numPages <= 0) return;
    lastNonceRef.current = command.nonce;
    const hasPage = typeof command.page === 'number' && command.page >= 1;
    if (hasPage) {
      setPage(Math.min(Math.max(1, command.page as number), Math.max(1, numPages)));
    }
    if (command.term && command.term.trim()) {
      setSearchOpen(true);
      setSearchTerm(command.term);
      // A pinned page wins — don't let the search auto-jump away from it.
      void runSearch(command.term, { jump: !hasPage });
    }
  }, [command, numPages, runSearch]);

  // ---- navigation helpers --------------------------------------------------
  const goTo = useCallback(
    (target: number) => {
      setPage((prev) => {
        const next = Math.min(Math.max(1, target), Math.max(1, numPages));
        return next === prev ? prev : next;
      });
    },
    [numPages],
  );

  const zoomBy = useCallback((factor: number) => {
    setFitMode(null);
    setScale((prev) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor)));
  }, []);

  const commitPageInput = useCallback(() => {
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isFinite(parsed)) goTo(parsed);
    else setPageInput(String(page));
  }, [pageInput, goTo, page]);

  const zoomPercent = useMemo(() => `${Math.round(scale * 100)}%`, [scale]);
  const isRtl = dir === 'rtl';

  return (
    <div className="flex w-full flex-col gap-2" dir={dir}>
      <style>{PDF_LAYER_CSS}</style>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card/60 px-2 py-1.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => setShowThumbs((v) => !v)}
          aria-label={showThumbs ? labels.hideThumbnails : labels.showThumbnails}
          title={showThumbs ? labels.hideThumbnails : labels.showThumbnails}
        >
          {showThumbs ? (
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          ) : (
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
          )}
        </Button>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden />

        {/* Paging */}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => goTo(page - 1)}
          disabled={page <= 1}
          aria-label={labels.prevPage}
          title={labels.prevPage}
        >
          <ChevronUp className="h-4 w-4" aria-hidden />
        </Button>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={commitPageInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitPageInput();
              }
            }}
            inputMode="numeric"
            aria-label={labels.jumpToPage}
            className="h-8 w-12 px-1 text-center tabular-nums"
          />
          <span className="tabular-nums" aria-live="polite">
            {labels.pageOf(String(page), String(numPages || '—'))}
          </span>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => goTo(page + 1)}
          disabled={numPages > 0 && page >= numPages}
          aria-label={labels.nextPage}
          title={labels.nextPage}
        >
          <ChevronDown className="h-4 w-4" aria-hidden />
        </Button>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden />

        {/* Zoom */}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={scale <= MIN_SCALE + 0.001}
          aria-label={labels.zoomOut}
          title={labels.zoomOut}
        >
          <Minus className="h-4 w-4" aria-hidden />
        </Button>
        <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground">
          {zoomPercent}
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={scale >= MAX_SCALE - 0.001}
          aria-label={labels.zoomIn}
          title={labels.zoomIn}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={fitMode === 'width' ? 'secondary' : 'ghost'}
          className="h-8"
          onClick={() => setFitMode('width')}
        >
          {labels.fitWidth}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={fitMode === 'page' ? 'secondary' : 'ghost'}
          className="h-8"
          onClick={() => setFitMode('page')}
        >
          {labels.fitPage}
        </Button>

        <div className="ms-auto flex items-center gap-1.5">
          <Button
            type="button"
            size="icon"
            variant={searchOpen ? 'secondary' : 'ghost'}
            className="h-8 w-8"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label={labels.searchInDoc}
            title={labels.searchInDoc}
          >
            <Search className="h-4 w-4" aria-hidden />
          </Button>
          {onDownload ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={onDownload}
              aria-label={labels.download}
              title={labels.download}
            >
              <Download className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
          <Button
            asChild
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={labels.openNewTab}
            title={labels.openNewTab}
          >
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </Button>
        </div>
      </div>

      {/* Search bar */}
      {searchOpen ? (
        <form
          className="flex items-center gap-1.5 rounded-lg border bg-card/60 px-2 py-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(searchTerm);
          }}
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            dir="auto"
            placeholder={labels.searchPlaceholder}
            className="h-8 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            aria-label={labels.searchInDoc}
          />
          {indexing ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : committedTerm.trim() ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {flatMatches.length > 0
                ? labels.matchOf(String(activeMatch + 1), String(flatMatches.length))
                : labels.noMatches}
            </span>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => gotoMatch(activeMatch - 1)}
            disabled={flatMatches.length === 0}
            aria-label={labels.prevMatch}
            title={labels.prevMatch}
          >
            <ChevronUp className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => gotoMatch(activeMatch + 1)}
            disabled={flatMatches.length === 0}
            aria-label={labels.nextMatch}
            title={labels.nextMatch}
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => {
              setSearchTerm('');
              setCommittedTerm('');
              setFlatMatches([]);
              setSearchOpen(false);
            }}
            aria-label={labels.closeSearch}
            title={labels.closeSearch}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </form>
      ) : null}

      {/* Body: thumbnails + page */}
      <div className="flex gap-2" style={{ height }}>
        {showThumbs && doc ? (
          <div
            className={cn(
              'w-[132px] shrink-0 overflow-y-auto rounded-lg border bg-muted/20 p-2',
              isRtl ? 'order-last' : 'order-first',
            )}
            aria-label={labels.thumbnails}
          >
            <div className="flex flex-col gap-2">
              {Array.from({ length: numPages }).map((_, i) => (
                <Thumbnail
                  key={i + 1}
                  doc={doc}
                  pageNumber={i + 1}
                  active={page === i + 1}
                  label={labels.thumbnailPage(String(i + 1))}
                  onClick={() => goTo(i + 1)}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="relative flex-1 overflow-auto rounded-lg border bg-muted/30"
        >
          {status === 'loading' ? (
            <div className="flex h-full items-center justify-center">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {labels.loading}
              </span>
            </div>
          ) : (
            <div className="flex min-h-full w-full justify-center p-4">
              <div className="relative shadow-elevation-2" style={{ direction: 'ltr' }}>
                <canvas ref={canvasRef} className="block bg-white" />
                <div
                  ref={textLayerRef}
                  className="rl-pdf-text-layer"
                  aria-hidden={false}
                />
                {rendering ? (
                  <div className="pointer-events-none absolute end-2 top-2 rounded-full bg-background/80 p-1 shadow">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3" aria-hidden />
        {labels.richBadge}
        <span aria-hidden>·</span>
        <button
          type="button"
          className="underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onFallback('user-requested')}
        >
          {labels.useNative}
        </button>
      </p>
    </div>
  );
}

function isCancelException(pdfjs: Pdfjs, err: unknown): boolean {
  return (
    err instanceof pdfjs.RenderingCancelledException ||
    (err instanceof Error && err.name === 'RenderingCancelledException')
  );
}

/** Lazily rendered thumbnail — only rasterizes once scrolled into view. */
function Thumbnail({
  doc,
  pageNumber,
  active,
  label,
  onClick,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    void doc.getPage(pageNumber).then((p) => {
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const targetWidth = 108;
      const s = targetWidth / base.width;
      const viewport = p.getViewport({ scale: s });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = p.render({ canvasContext: ctx, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [visible, doc, pageNumber]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-col items-center gap-1 rounded-md border p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary/10'
          : 'border-border/60 bg-background hover:border-primary/40',
      )}
    >
      <div className="flex h-[140px] w-full items-center justify-center overflow-hidden bg-white">
        {visible ? (
          <canvas ref={canvasRef} className="max-h-full max-w-full" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        )}
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">{pageNumber}</span>
    </button>
  );
}

/**
 * Minimal text-layer CSS (mirrors pdf.js `pdf_viewer.css` essentials) plus our
 * search-highlight marks. Scoped to `.rl-pdf-text-layer` so it never collides
 * with app styles. The spans pdf.js injects position themselves with
 * `calc(var(--scale-factor) * …)`, which we set on the container per render.
 */
const PDF_LAYER_CSS = `
.rl-pdf-text-layer {
  position: absolute;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  text-align: initial;
  transform-origin: 0 0;
  forced-color-adjust: none;
  z-index: 2;
}
.rl-pdf-text-layer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}
.rl-pdf-text-layer ::selection { background: rgba(13, 167, 168, 0.35); }
.rl-pdf-text-layer .rl-pdf-mark {
  color: transparent;
  background: rgba(171, 183, 5, 0.45);
  border-radius: 2px;
}
.rl-pdf-text-layer .rl-pdf-mark[data-active='true'] {
  background: rgba(171, 183, 5, 0.70);
  box-shadow: 0 0 0 1px rgba(171, 183, 5, 0.95);
}
`;
