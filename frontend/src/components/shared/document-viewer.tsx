"use client";

import * as React from "react";
import { Download, FileText, FileQuestion, List } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/utils";

export interface DocumentViewerAnchor {
  id: string;
  label: string;
  page?: number;
}

export interface DocumentViewerProps {
  url?: string;
  mimeType?: string;
  fileName?: string;
  extractedText?: string;
  height?: number;
  anchors?: DocumentViewerAnchor[];
  className?: string;
  dir?: "ltr" | "rtl";
}

function isPdf(mimeType?: string, fileName?: string): boolean {
  if (mimeType?.toLowerCase().includes("pdf")) return true;
  return !!fileName && /\.pdf$/i.test(fileName);
}

function isImage(mimeType?: string, fileName?: string): boolean {
  if (mimeType?.toLowerCase().startsWith("image/")) return true;
  return !!fileName && /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(fileName);
}

/**
 * Renders a document inline:
 * - PDFs via a native <iframe> (browsers render PDFs natively — no pdfjs).
 * - Images via <img>.
 * - Word / other binaries: download link + extracted-text panel.
 * - extractedText only: scrollable readable panel.
 * Optional anchors render as a clickable side rail. Empty state when nothing to show.
 */
export function DocumentViewer({
  url,
  mimeType,
  fileName,
  extractedText,
  height = 600,
  anchors,
  className,
  dir,
}: DocumentViewerProps) {
  const pdf = url ? isPdf(mimeType, fileName) : false;
  const image = url ? isImage(mimeType, fileName) : false;
  const hasContent = !!url || !!extractedText;

  const handleAnchorClick = React.useCallback((anchor: DocumentViewerAnchor) => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(anchor.id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  if (!hasContent) {
    return (
      <div className={className} dir={dir}>
        <EmptyState
          icon={FileQuestion}
          title="No preview available"
          description="There is no document or extracted text to display."
          size="compact"
        />
      </div>
    );
  }

  const railSide = dir === "rtl" ? "order-last" : "order-first";

  const body = (() => {
    if (pdf && url) {
      return (
        <iframe
          src={url}
          title={fileName ?? "PDF document"}
          className="w-full rounded-lg border bg-muted/30"
          style={{ height }}
        />
      );
    }

    if (image && url) {
      return (
        <div
          className="flex w-full items-center justify-center overflow-auto rounded-lg border bg-muted/30 p-4"
          style={{ height }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={fileName ?? "Document image"}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      );
    }

    // Word / binary / other — offer a download link, then the extracted text.
    return (
      <div className="flex w-full flex-col gap-3" style={{ minHeight: height }}>
        {url && (
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate text-sm font-medium text-foreground">
                {fileName ?? "Document"}
              </span>
            </div>
            <Button asChild size="sm" variant="outline">
              <a href={url} download={fileName} target="_blank" rel="noopener noreferrer">
                <Download className="me-1.5 h-4 w-4" aria-hidden />
                Download
              </a>
            </Button>
          </div>
        )}
        {extractedText ? (
          <pre
            className="flex-1 overflow-auto rounded-lg border bg-card p-4 text-sm leading-6 text-foreground whitespace-pre-wrap break-words font-sans"
            style={{ maxHeight: height }}
          >
            {extractedText}
          </pre>
        ) : (
          !url && (
            <EmptyState
              icon={FileQuestion}
              title="No preview available"
              description="This file type cannot be previewed."
              size="compact"
            />
          )
        )}
      </div>
    );
  })();

  return (
    <div
      className={cn("flex w-full gap-4", className)}
      dir={dir}
    >
      {anchors && anchors.length > 0 && (
        <nav
          className={cn(
            "hidden w-48 shrink-0 flex-col gap-1 rounded-lg border bg-card p-2 md:flex",
            railSide,
          )}
          style={{ maxHeight: height, overflowY: "auto" }}
          aria-label="Document sections"
        >
          <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <List className="h-3.5 w-3.5" aria-hidden />
            Sections
          </div>
          {anchors.map((anchor) => (
            <button
              key={anchor.id}
              type="button"
              onClick={() => handleAnchorClick(anchor)}
              className={cn(
                "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-sm text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="truncate">{anchor.label}</span>
              {typeof anchor.page === "number" && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {anchor.page}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
}

export interface DocumentPreviewSheetProps extends DocumentViewerProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title?: string;
}

/** Wraps DocumentViewer in a side Sheet for quick preview. */
export function DocumentPreviewSheet({
  open,
  onOpenChange,
  title,
  dir,
  ...viewerProps
}: DocumentPreviewSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={dir === "rtl" ? "left" : "right"}
        dir={dir}
        className="w-full max-w-3xl sm:max-w-3xl overflow-y-auto"
        aria-describedby={undefined}
      >
        <SheetHeader>
          <SheetTitle>{title ?? viewerProps.fileName ?? "Document preview"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <DocumentViewer dir={dir} {...viewerProps} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
