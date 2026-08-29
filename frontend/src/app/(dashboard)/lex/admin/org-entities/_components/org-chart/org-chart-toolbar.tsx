'use client';

import { useRef } from 'react';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  FileImage,
  Lock,
  Maximize2,
  Printer,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OrgChartLabels } from '../../_lib/org-chart-i18n';

interface OrgChartToolbarProps {
  t: OrgChartLabels;
  canWrite: boolean;
  searchValue: string;
  searchMatched: boolean;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
  onPrint: () => void;
}

/**
 * Floating control surface for the chart canvas: search-to-center, zoom, bulk
 * expand/collapse, and export actions. Direction-agnostic (logical spacing)
 * and renders a read-only chip when the viewer lacks write access.
 */
export function OrgChartToolbar({
  t,
  canWrite,
  searchValue,
  searchMatched,
  onSearchChange,
  onSearchSubmit,
  onZoomIn,
  onZoomOut,
  onFit,
  onExpandAll,
  onCollapseAll,
  onExportSvg,
  onExportPng,
  onPrint,
}: OrgChartToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const showNoMatch = searchValue.trim().length > 0 && !searchMatched;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative flex-1 basis-56">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSearchSubmit();
            }
          }}
          placeholder={t.toolbar.searchPlaceholder}
          aria-label={t.toolbar.searchPlaceholder}
          className="h-9 w-full rounded-md border border-border/80 bg-card/80 ps-9 pe-3 text-sm shadow-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
        />
        {showNoMatch ? (
          <span className="absolute -bottom-5 start-0 text-xs text-warning-700 dark:text-warning-300">
            {t.toolbar.searchNoMatch}
          </span>
        ) : null}
      </div>

      {/* Zoom cluster */}
      <div className="flex items-center gap-1 rounded-md border border-border/70 bg-card/70 p-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onZoomOut}
          title={t.toolbar.zoomOut}
          aria-label={t.toolbar.zoomOut}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onZoomIn}
          title={t.toolbar.zoomIn}
          aria-label={t.toolbar.zoomIn}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onFit}
          title={t.toolbar.fit}
          aria-label={t.toolbar.fit}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Expand / collapse */}
      <div className="flex items-center gap-1 rounded-md border border-border/70 bg-card/70 p-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onExpandAll}
          title={t.toolbar.expandAll}
          aria-label={t.toolbar.expandAll}
        >
          <ChevronsUpDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onCollapseAll}
          title={t.toolbar.collapseAll}
          aria-label={t.toolbar.collapseAll}
        >
          <ChevronsDownUp className="h-4 w-4" />
        </Button>
      </div>

      {/* Export / print */}
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="sm" onClick={onExportSvg}>
          <Download className="me-1.5 h-4 w-4" />
          {t.toolbar.exportSvg}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onExportPng}>
          <FileImage className="me-1.5 h-4 w-4" />
          {t.toolbar.exportPng}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onPrint}>
          <Printer className="me-1.5 h-4 w-4" />
          {t.toolbar.print}
        </Button>
      </div>

      {!canWrite ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden />
          {t.toolbar.readOnly}
        </span>
      ) : null}
    </div>
  );
}
