'use client';

import * as React from 'react';
import { Columns2, AlignLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  computeRedline,
  type RedlineGranularity,
  type RedlineSegment,
} from '@/lib/lex/redline';

export interface RedlineViewProps {
  original: string;
  revised: string;
  /** `inline` interleaves changes in one column; `split` shows two columns. */
  mode?: 'inline' | 'split';
  granularity?: RedlineGranularity;
  originalLabel?: string;
  revisedLabel?: string;
  className?: string;
  dir?: 'ltr' | 'rtl';
}

const segmentClass: Record<RedlineSegment['type'], string> = {
  equal: 'text-foreground',
  added:
    'rounded-[2px] bg-success-50 text-success-700 dark:bg-success-700/30 dark:text-success-300',
  removed:
    'rounded-[2px] bg-error-50 text-error-600 line-through decoration-error-300/70 dark:bg-error-700/30 dark:text-error-300',
};

const srLabel: Record<RedlineSegment['type'], string | null> = {
  equal: null,
  added: 'inserted: ',
  removed: 'deleted: ',
};

function Segment({ segment }: { segment: RedlineSegment }) {
  const note = srLabel[segment.type];
  return (
    <span className={cn('whitespace-pre-wrap break-words', segmentClass[segment.type])}>
      {note ? <span className="sr-only">{note}</span> : null}
      {segment.value}
    </span>
  );
}

interface ToggleButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

function ToggleButton({ active, onClick, icon: Icon, label }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </button>
  );
}

export function RedlineView({
  original,
  revised,
  mode = 'inline',
  granularity = 'word',
  originalLabel = 'Original',
  revisedLabel = 'Revised',
  className,
  dir,
}: RedlineViewProps) {
  const [activeMode, setActiveMode] = React.useState<'inline' | 'split'>(mode);

  React.useEffect(() => {
    setActiveMode(mode);
  }, [mode]);

  const segments = React.useMemo(
    () => computeRedline(original, revised, { granularity }),
    [original, revised, granularity],
  );

  // Split view: deletions belong to the original column, insertions to the
  // revised column; equal runs appear in both.
  const originalSegments = React.useMemo(
    () => segments.filter((s) => s.type !== 'added'),
    [segments],
  );
  const revisedSegments = React.useMemo(
    () => segments.filter((s) => s.type !== 'removed'),
    [segments],
  );

  return (
    <div
      dir={dir}
      className={cn('flex flex-col gap-3 text-sm leading-relaxed', className)}
    >
      <div className="flex items-center justify-end">
        <div
          className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5"
          role="group"
          aria-label="Redline display mode"
        >
          <ToggleButton
            active={activeMode === 'inline'}
            onClick={() => setActiveMode('inline')}
            icon={AlignLeft}
            label="Inline"
          />
          <ToggleButton
            active={activeMode === 'split'}
            onClick={() => setActiveMode('split')}
            icon={Columns2}
            label="Split"
          />
        </div>
      </div>

      {activeMode === 'inline' ? (
        <div className="rounded-lg border bg-card p-4">
          <p className="m-0">
            {segments.map((segment, i) => (
              <Segment key={i} segment={segment} />
            ))}
            {segments.length === 0 ? (
              <span className="text-muted-foreground">No content to compare.</span>
            ) : null}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col rounded-lg border bg-card">
            <div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {originalLabel}
            </div>
            <p className="m-0 p-4">
              {originalSegments.map((segment, i) => (
                <Segment key={i} segment={segment} />
              ))}
              {originalSegments.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-col rounded-lg border bg-card">
            <div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {revisedLabel}
            </div>
            <p className="m-0 p-4">
              {revisedSegments.map((segment, i) => (
                <Segment key={i} segment={segment} />
              ))}
              {revisedSegments.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : null}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
