'use client';

import { useEffect, useId, useState } from 'react';
import { Filter, RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { humanizeEntryType } from './ledger-format';
import type { LedgerExplorerCopy } from './ledger-labels';

/**
 * Applied, client-side filter state for the ledger explorer. `type`/`subject` map
 * directly to the real `DRAttestationLedgerFilters` server fields; `seqFrom`/`seqTo`
 * are applied client-side over the fetched window (the API has no seq-range param).
 */
export interface LedgerExplorerFilters {
  type: string;
  subject: string;
  seqFrom: number | null;
  seqTo: number | null;
  limit: number;
}

export const DEFAULT_LEDGER_FILTERS: LedgerExplorerFilters = {
  type: '',
  subject: '',
  seqFrom: null,
  seqTo: null,
  limit: 50,
};

const LIMIT_OPTIONS = [25, 50, 100, 200] as const;
const ALL_TYPES_VALUE = '__all__';

function parseSeq(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export interface LedgerFilterBarProps {
  copy: LedgerExplorerCopy;
  /** Currently applied filters (source of truth, owned by the page). */
  value: LedgerExplorerFilters;
  /** Entry-type tokens to offer in the type select (derived from fetched entries). */
  entryTypes: string[];
  /** Count of rows currently shown after all filters. */
  resultCount: number;
  onApply: (next: LedgerExplorerFilters) => void;
  onReset: () => void;
}

export function LedgerFilterBar({
  copy,
  value,
  entryTypes,
  resultCount,
  onApply,
  onReset,
}: LedgerFilterBarProps) {
  const headingId = useId();
  const typeId = useId();
  const subjectId = useId();
  const seqFromId = useId();
  const seqToId = useId();
  const limitId = useId();

  // Local draft so typing does not refetch on every keystroke; applied on submit.
  const [draft, setDraft] = useState<LedgerExplorerFilters>(value);

  // Keep the draft in sync when the page resets or deep-links change the source.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const hasActiveFilters =
    Boolean(value.type) ||
    Boolean(value.subject) ||
    value.seqFrom !== null ||
    value.seqTo !== null;

  const activeChips: string[] = [];
  if (value.type) activeChips.push(humanizeEntryType(value.type));
  if (value.subject) activeChips.push(`${copy.filterSubjectLabel}: ${value.subject}`);
  if (value.seqFrom !== null) activeChips.push(`${copy.filterSeqFromLabel} ${value.seqFrom}`);
  if (value.seqTo !== null) activeChips.push(`${copy.filterSeqToLabel} ${value.seqTo}`);

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId} className="flex items-center gap-2 text-base">
          <Filter className="h-4 w-4 shrink-0" aria-hidden />
          {copy.filtersHeading}
        </CardTitle>
        <CardDescription>
          {resultCount} {copy.tableResultCount}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12"
          onSubmit={(event) => {
            event.preventDefault();
            onApply(draft);
          }}
        >
          <div className="space-y-1.5 xl:col-span-3">
            <Label htmlFor={typeId}>{copy.filterTypeLabel}</Label>
            <Select
              value={draft.type || ALL_TYPES_VALUE}
              onValueChange={(next) =>
                setDraft((prev) => ({ ...prev, type: next === ALL_TYPES_VALUE ? '' : next }))
              }
            >
              <SelectTrigger id={typeId} aria-label={copy.filterTypeLabel}>
                <SelectValue placeholder={copy.filterTypeAll} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TYPES_VALUE}>{copy.filterTypeAll}</SelectItem>
                {entryTypes.map((entryType) => (
                  <SelectItem key={entryType} value={entryType}>
                    {humanizeEntryType(entryType)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 xl:col-span-4">
            <Label htmlFor={subjectId}>{copy.filterSubjectLabel}</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                id={subjectId}
                value={draft.subject}
                inputMode="text"
                placeholder={copy.filterSubjectPlaceholder}
                className="ps-9"
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, subject: event.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5 xl:col-span-2">
            <Label htmlFor={seqFromId}>{copy.filterSeqFromLabel}</Label>
            <Input
              id={seqFromId}
              type="number"
              min={0}
              inputMode="numeric"
              value={draft.seqFrom ?? ''}
              placeholder={copy.filterSeqPlaceholder}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, seqFrom: parseSeq(event.target.value) }))
              }
            />
          </div>

          <div className="space-y-1.5 xl:col-span-2">
            <Label htmlFor={seqToId}>{copy.filterSeqToLabel}</Label>
            <Input
              id={seqToId}
              type="number"
              min={0}
              inputMode="numeric"
              value={draft.seqTo ?? ''}
              placeholder={copy.filterSeqPlaceholder}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, seqTo: parseSeq(event.target.value) }))
              }
            />
          </div>

          <div className="space-y-1.5 xl:col-span-1">
            <Label htmlFor={limitId}>{copy.filterLimitLabel}</Label>
            <Select
              value={String(draft.limit)}
              onValueChange={(next) =>
                setDraft((prev) => ({ ...prev, limit: Number.parseInt(next, 10) }))
              }
            >
              <SelectTrigger id={limitId} aria-label={copy.filterLimitLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMIT_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-12">
            <Button type="submit">
              <Filter className="me-1.5 h-4 w-4" aria-hidden />
              {copy.filterApply}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasActiveFilters}
              onClick={onReset}
            >
              <RotateCcw className="me-1.5 h-4 w-4" aria-hidden />
              {copy.filterReset}
            </Button>
          </div>
        </form>

        {activeChips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {copy.filterActiveSummary}:
            </span>
            {activeChips.map((chip) => (
              <Badge key={chip} variant="secondary" className="normal-case tracking-normal">
                {chip}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
