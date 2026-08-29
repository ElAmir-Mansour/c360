'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, EyeOff, Expand, GripVertical, Shrink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { BOARD_TEXT, pickText } from './board-i18n';
import type { WidgetDefinition } from './registry';

interface WidgetFrameProps {
  def: WidgetDefinition;
  /**
   * `static` — the frame is part of the plain stacked composition (identical
   * to the pre-board dashboard); `grid` — the frame lives inside a
   * react-grid-layout cell.
   */
  mode: 'static' | 'grid';
  editMode?: boolean;
  /** True when the user manually resized this widget's height (auto-height off). */
  manualHeight?: boolean;
  /** Staggered-reveal index (grid mode only; static mode uses the page Reveal). */
  revealIndex?: number;
  /** Stretch to the cell/row height (side-by-side rows in static mode). */
  fill?: boolean;
  /** Reports the frame's rendered height so the board can size its grid row. */
  onHeightChange: (id: string, px: number) => void;
  onRemove?: (id: string) => void;
  onMove?: (id: string, direction: -1 | 1) => void;
  onResize?: (id: string, direction: -1 | 1) => void;
}

/**
 * WidgetFrame wraps an existing dashboard widget for the board.
 *
 * It measures its own rendered height with a ResizeObserver and reports it up,
 * which is what lets auto-height grid rows track live content (tables loading,
 * banners self-hiding) instead of clipping. In edit mode it adds drag/remove
 * chrome and a placeholder for widgets that currently render nothing (e.g. the
 * critical-alerts banner with no critical alerts).
 */
export function WidgetFrame({
  def,
  mode,
  editMode = false,
  manualHeight = false,
  revealIndex,
  fill = false,
  onHeightChange,
  onRemove,
  onMove,
  onResize,
}: WidgetFrameProps) {
  const { locale } = useLocaleOrDefault();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [isEmpty, setIsEmpty] = React.useState(false);

  React.useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content) return;

    const report = () => {
      // A self-hiding widget (banner/checklist) renders ~0px of content.
      setIsEmpty(content.offsetHeight < 2);
      onHeightChange(def.id, root.offsetHeight);
    };

    report();
    // jsdom / very old browsers: fall back to the initial measurement only.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(root);
    observer.observe(content);
    return () => observer.disconnect();
  }, [def.id, editMode, manualHeight, mode, onHeightChange]);

  const title = pickText(def.title, locale);
  const Icon = def.icon;
  const grid = mode === 'grid';

  return (
    <div
      ref={rootRef}
      data-widget-id={def.id}
      className={cn(
        fill && 'h-full',
        grid && revealIndex !== undefined && 'animate-fade-up',
        grid && manualHeight && 'wb-frame-fixed',
        grid &&
          editMode &&
          'flex flex-col rounded-2xl border border-dashed border-primary/40 bg-card/70',
        grid && editMode && !manualHeight && 'overflow-hidden',
      )}
      style={
        grid && revealIndex !== undefined
          ? ({
              // Same token-anchored stagger as the page-level Reveal wrapper.
              animationDelay: `calc(${revealIndex} * (var(--ds-duration-fast) / 2))`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {grid && editMode && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-dashed border-primary/30 px-2 py-1.5">
          {/* Drag affordance — react-grid-layout binds pointer dragging to
              `.wb-drag-handle` (mouse/touch only; RGL has no keyboard DnD). */}
          <span
            className="wb-drag-handle flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground active:cursor-grabbing"
            aria-hidden="true"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate text-xs font-medium text-foreground">{title}</span>
          {onMove && (
            <div className="ms-auto flex items-center" role="group" aria-label={title}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onMove(def.id, -1)}
                aria-label={`${pickText(BOARD_TEXT.moveEarlier, locale)}: ${title}`}
                className="h-7 w-7 rounded-md text-muted-foreground"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onMove(def.id, 1)}
                aria-label={`${pickText(BOARD_TEXT.moveLater, locale)}: ${title}`}
                className="h-7 w-7 rounded-md text-muted-foreground"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
          {onResize && (
            <div className="flex items-center" role="group" aria-label={title}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onResize(def.id, -1)}
                aria-label={`${pickText(BOARD_TEXT.makeNarrower, locale)}: ${title}`}
                className="h-7 w-7 rounded-md text-muted-foreground"
              >
                <Shrink className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onResize(def.id, 1)}
                aria-label={`${pickText(BOARD_TEXT.makeWider, locale)}: ${title}`}
                className="h-7 w-7 rounded-md text-muted-foreground"
              >
                <Expand className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(def.id)}
              aria-label={`${pickText(BOARD_TEXT.removeWidget, locale)}: ${title}`}
              className="h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      )}

      <div
        ref={contentRef}
        className={cn(fill && 'wb-fill h-full', grid && editMode && 'p-2')}
      >
        <def.Component />
      </div>

      {grid && editMode && isEmpty && (
        <div className="flex items-center justify-center gap-2 px-4 py-5 text-xs text-muted-foreground">
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          {pickText(BOARD_TEXT.noContent, locale)}
        </div>
      )}
    </div>
  );
}
