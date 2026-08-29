'use client';

import { diffLines, diffWordsWithSpace, type Change } from 'diff';
import { GitCompareArrows } from 'lucide-react';
import { CopyButton } from '@/components/shared/copy-button';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  LexDraftingContractDraft,
  LexDraftingFallbackSet,
  LexDraftingTranslationResult,
} from '@/types/suites';

export type ResultCompareMode = 'words' | 'lines';
export type ResultCompareView = 'split' | 'inline' | 'both';

export type DraftingComparableResult =
  | string
  | LexDraftingContractDraft
  | LexDraftingTranslationResult
  | LexDraftingFallbackSet
  | null
  | undefined;

export interface ResultDiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
  count: number;
}

export interface ResultDiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

export interface ResultDiffCompareLabels {
  title: string;
  description: string;
  original: string;
  revised: string;
  inlineDiff: string;
  additions: string;
  removals: string;
  unchanged: string;
  empty: string;
  copyOriginal: string;
  copyRevised: string;
}

export interface ResultDiffCompareProps {
  original?: DraftingComparableResult;
  revised?: DraftingComparableResult;
  originalText?: string;
  revisedText?: string;
  mode?: ResultCompareMode;
  view?: ResultCompareView;
  className?: string;
  labels?: Partial<ResultDiffCompareLabels>;
}

const DEFAULT_LABELS: ResultDiffCompareLabels = {
  title: 'Result compare',
  description: 'Compare non-rewrite outputs before accepting a generated result.',
  original: 'Original',
  revised: 'Revised',
  inlineDiff: 'Inline diff',
  additions: 'Additions',
  removals: 'Removals',
  unchanged: 'Unchanged',
  empty: 'Nothing to compare yet.',
  copyOriginal: 'Copy original',
  copyRevised: 'Copy revised',
};

export function contractDraftToCompareText(draft: LexDraftingContractDraft): string {
  const parts = [draft.title, draft.summary ?? ''];
  for (const section of draft.sections) {
    parts.push(`${section.heading}\n${section.body}`);
  }
  if (draft.open_items?.length) {
    parts.push(`Open items\n${draft.open_items.map((item) => `- ${item}`).join('\n')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

export function translationResultToCompareText(result: LexDraftingTranslationResult): string {
  const parts = [result.translation];
  if (result.equivalence) {
    parts.push(`Equivalence: ${result.equivalence}`);
  }
  if (result.notes?.length) {
    parts.push(`Notes\n${result.notes.map((note) => `- ${note}`).join('\n')}`);
  }
  if (result.caveats?.length) {
    parts.push(`Caveats\n${result.caveats.map((caveat) => `- ${caveat}`).join('\n')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

export function fallbackSetToCompareText(result: LexDraftingFallbackSet): string {
  return result.fallbacks
    .map((fallback, index) => {
      const parts = [
        fallback.label ?? `Fallback ${index + 1}`,
        fallback.concession_level ? `Concession: ${fallback.concession_level}` : '',
        fallback.text,
        fallback.when_to_use ? `When to use: ${fallback.when_to_use}` : '',
      ];
      return parts.filter(Boolean).join('\n');
    })
    .join('\n\n');
}

export function draftingComparableToText(result: DraftingComparableResult): string {
  if (!result) {
    return '';
  }
  if (typeof result === 'string') {
    return result;
  }
  if (isContractDraft(result)) {
    return contractDraftToCompareText(result);
  }
  if (isTranslationResult(result)) {
    return translationResultToCompareText(result);
  }
  if (isFallbackSet(result)) {
    return fallbackSetToCompareText(result);
  }
  return '';
}

export function buildResultTextDiff(
  originalText: string,
  revisedText: string,
  mode: ResultCompareMode = 'words',
): ResultDiffPart[] {
  const changes = mode === 'lines' ? diffLines(originalText, revisedText) : diffWordsWithSpace(originalText, revisedText);
  return changes.map((change) => ({
    value: change.value,
    added: change.added,
    removed: change.removed,
    count: countChangeUnits(change, mode),
  }));
}

export function summarizeResultTextDiff(parts: ResultDiffPart[]): ResultDiffStats {
  return parts.reduce<ResultDiffStats>(
    (stats, part) => {
      if (part.added) {
        stats.added += part.count;
      } else if (part.removed) {
        stats.removed += part.count;
      } else {
        stats.unchanged += part.count;
      }
      return stats;
    },
    { added: 0, removed: 0, unchanged: 0 },
  );
}

export function ResultDiffCompare({
  original,
  revised,
  originalText,
  revisedText,
  mode = 'words',
  view = 'both',
  className,
  labels,
}: ResultDiffCompareProps) {
  const t = { ...DEFAULT_LABELS, ...labels };
  const leftText = originalText ?? draftingComparableToText(original);
  const rightText = revisedText ?? draftingComparableToText(revised);
  const hasContent = leftText.trim().length > 0 || rightText.trim().length > 0;
  const diffParts = buildResultTextDiff(leftText, rightText, mode);
  const stats = summarizeResultTextDiff(diffParts);
  const showSplit = view === 'split' || view === 'both';
  const showInline = view === 'inline' || view === 'both';

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
          {t.title}
        </span>
      }
      description={t.description}
      className={className}
    >
      {hasContent ? (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">
              {t.additions}: {stats.added}
            </Badge>
            <Badge variant={stats.removed ? 'warning' : 'outline'}>
              {t.removals}: {stats.removed}
            </Badge>
            <Badge variant="outline">
              {t.unchanged}: {stats.unchanged}
            </Badge>
          </div>

          {showSplit ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <ComparePanel label={t.original} copyLabel={t.copyOriginal} text={leftText} />
              <ComparePanel label={t.revised} copyLabel={t.copyRevised} text={rightText} />
            </div>
          ) : null}

          {showInline ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t.inlineDiff}</p>
              <pre className="max-h-[34rem] overflow-auto rounded-lg border bg-muted/30 p-4 text-sm leading-7 whitespace-pre-wrap">
                {diffParts.map((part, index) => (
                  <span
                    key={`${index}-${part.value.slice(0, 12)}`}
                    className={cn(
                      part.added && 'bg-primary/15 text-primary',
                      part.removed && 'bg-destructive/10 text-destructive line-through',
                    )}
                  >
                    {part.value}
                  </span>
                ))}
              </pre>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t.empty}
        </div>
      )}
    </SectionCard>
  );
}

function ComparePanel({
  label,
  copyLabel,
  text,
}: {
  label: string;
  copyLabel: string;
  text: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <CopyButton value={text} label={copyLabel} size="sm" />
      </div>
      <pre className="min-h-48 max-h-96 overflow-auto rounded-lg border bg-muted/30 p-4 text-sm leading-7 whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}

function countChangeUnits(change: Change, mode: ResultCompareMode): number {
  if (typeof change.count === 'number') {
    return change.count;
  }
  if (mode === 'lines') {
    return change.value.split(/\r?\n/).filter(Boolean).length;
  }
  return change.value.trim() ? change.value.trim().split(/\s+/).length : 0;
}

function isContractDraft(value: object): value is LexDraftingContractDraft {
  return 'title' in value && 'sections' in value && Array.isArray(value.sections);
}

function isTranslationResult(value: object): value is LexDraftingTranslationResult {
  return 'translation' in value && typeof value.translation === 'string';
}

function isFallbackSet(value: object): value is LexDraftingFallbackSet {
  return 'fallbacks' in value && Array.isArray(value.fallbacks);
}
