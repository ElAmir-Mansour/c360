'use client';

import { Download, ExternalLink, FileQuestion, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PdfViewerLabels } from './pdf-viewer-types';

interface NativePdfFrameProps {
  url?: string;
  fileName?: string;
  height: number;
  dir?: 'ltr' | 'rtl';
  loading?: boolean;
  labels: PdfViewerLabels;
  /** Offered only when the browser can run the rich pdf.js engine. */
  onUseRich?: () => void;
  onDownload?: () => void;
  className?: string;
}

/**
 * The guaranteed-baseline PDF surface: the browser's own native `<iframe>` PDF
 * renderer. It is the graceful fallback whenever pdf.js is unsupported or fails,
 * and it renders born-digital Arabic PDFs correctly with zero JS. A slim toolbar
 * offers download / open-in-new-tab and, when the runtime supports it, a switch
 * to the rich (pdf.js) viewer.
 */
export function NativePdfFrame({
  url,
  fileName,
  height,
  dir,
  loading = false,
  labels,
  onUseRich,
  onDownload,
  className,
}: NativePdfFrameProps) {
  return (
    <div className={cn('flex w-full flex-col gap-2', className)} dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{labels.nativeBadge}</span>
        <div className="flex items-center gap-1.5">
          {onUseRich ? (
            <Button type="button" size="sm" variant="ghost" onClick={onUseRich}>
              <Sparkles className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {labels.useRich}
            </Button>
          ) : null}
          {onDownload ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onDownload}
              disabled={!url}
            >
              <Download className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {labels.download}
            </Button>
          ) : null}
          <Button
            asChild={!!url}
            type="button"
            size="sm"
            variant="outline"
            disabled={!url}
            aria-disabled={!url}
            className={cn(!url && 'pointer-events-none opacity-50')}
          >
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {labels.openNewTab}
              </a>
            ) : (
              <span>
                <ExternalLink className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {labels.openNewTab}
              </span>
            )}
          </Button>
        </div>
      </div>

      {loading && !url ? (
        <div
          className="flex items-center justify-center rounded-lg border bg-muted/30"
          style={{ height }}
        >
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {labels.loading}
          </span>
        </div>
      ) : url ? (
        <iframe
          src={url}
          title={fileName ?? labels.frameTitle}
          className="w-full rounded-lg border bg-muted/30"
          style={{ height }}
        />
      ) : (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-muted/30 text-center"
          style={{ height }}
        >
          <FileQuestion className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{labels.unavailable}</p>
        </div>
      )}
    </div>
  );
}
