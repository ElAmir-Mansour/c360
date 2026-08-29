'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { browserSupportsPdfjs } from '../../_lib/pdf/pdf-worker';
import { NativePdfFrame } from './native-pdf-frame';
import type {
  PdfViewerCommand,
  PdfViewerEngine,
  PdfViewerLabels,
} from './pdf-viewer-types';

export type {
  PdfViewerCommand,
  PdfViewerEngine,
  PdfViewerLabels,
} from './pdf-viewer-types';

/** Sentinel reason meaning the USER chose the native viewer (not a failure). */
export const USER_REQUESTED_NATIVE = 'user-requested';

/**
 * Pure engine-selection policy (unit-tested). pdf.js is the default RICH engine;
 * the native `<iframe>` is the guaranteed baseline. We only pick pdf.js when the
 * runtime supports it AND the caller didn't force native.
 */
export function resolveInitialEngine(opts: {
  supported: boolean;
  preferNative?: boolean;
}): PdfViewerEngine {
  if (opts.preferNative) return 'native';
  return opts.supported ? 'pdfjs' : 'native';
}

// Heavy engine: dynamically imported so it never enters the initial bundle and
// never runs during SSR. The wrapper only mounts it once a byte URL exists.
const PdfJsViewer = dynamic(
  () => import('./pdfjs-viewer').then((m) => m.PdfJsViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center rounded-lg border bg-muted/30 py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    ),
  },
);

export interface PdfViewerProps {
  /** Blob object-URL (or same-origin URL) of the PDF; undefined while loading. */
  url?: string;
  fileName?: string;
  dir?: 'ltr' | 'rtl';
  height?: number;
  loading?: boolean;
  /** Deep-link command (jump to page / highlight term). */
  command?: PdfViewerCommand;
  /** Force the native engine (tests / low-power hosts). */
  preferNative?: boolean;
  labels: PdfViewerLabels;
  onPageChange?: (page: number) => void;
  onNumPages?: (numPages: number) => void;
  onDownload?: () => void;
  className?: string;
}

/**
 * The reference-library PDF viewer abstraction. It chooses between the rich
 * pdf.js engine (page nav / zoom / thumbnails / in-doc Arabic search / deep-link
 * jump) and the native `<iframe>` fallback, and — critically — swaps to the
 * native frame on ANY pdf.js failure so a worker/parse problem degrades the
 * experience instead of blanking the document. Users can also toggle engines by
 * hand. All chrome text is passed in via `labels` (fully bilingual/RTL upstream).
 */
export function PdfViewer({
  url,
  fileName,
  dir,
  height = 560,
  loading = false,
  command,
  preferNative = false,
  labels,
  onPageChange,
  onNumPages,
  onDownload,
  className,
}: PdfViewerProps) {
  const [engine, setEngine] = useState<PdfViewerEngine | null>(null);
  const [supported, setSupported] = useState(false);
  const [pdfjsFailed, setPdfjsFailed] = useState(false);

  // Decide the engine on the client only (progressive enhancement, no hydration
  // mismatch — the server never renders a specific engine).
  useEffect(() => {
    const canRich = browserSupportsPdfjs();
    setSupported(canRich);
    setEngine(resolveInitialEngine({ supported: canRich, preferNative }));
  }, [preferNative]);

  const handleFallback = (reason: unknown) => {
    if (reason !== USER_REQUESTED_NATIVE) setPdfjsFailed(true);
    setEngine('native');
  };

  if (engine === null) {
    return (
      <div className={className}>
        <div
          className="flex items-center justify-center rounded-lg border bg-muted/30"
          style={{ height }}
        >
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      </div>
    );
  }

  if (engine === 'pdfjs' && url) {
    return (
      <div className={className}>
        <PdfJsViewer
          url={url}
          fileName={fileName}
          dir={dir}
          height={height}
          command={command}
          labels={labels}
          onPageChange={onPageChange}
          onNumPages={onNumPages}
          onDownload={onDownload}
          onFallback={handleFallback}
        />
      </div>
    );
  }

  return (
    <div className={className}>
      <NativePdfFrame
        url={url}
        fileName={fileName}
        height={height}
        dir={dir}
        loading={loading || (engine === 'pdfjs' && !url)}
        labels={labels}
        onUseRich={supported && !pdfjsFailed ? () => setEngine('pdfjs') : undefined}
        onDownload={onDownload}
      />
    </div>
  );
}
