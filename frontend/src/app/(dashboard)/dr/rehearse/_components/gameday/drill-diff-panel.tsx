'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { DRDrillDiff, DRDrillResult } from '@/types/clario-dr';
import { useGameDayLabels, type DrillDiffLabels } from './gameday-labels';

export interface DrillDiffPanelProps {
  /** Drill results for the active group (the picker source). */
  results: DRDrillResult[];
  /** Currently selected result id (drives `useDRDrillDiff` upstream). */
  selectedResultId: string | null;
  onSelectResult: (resultId: string) => void;
  /** Diff for the selected result vs its predecessor. */
  diff: DRDrillDiff | null;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/**
 * Drill-diff (planned-vs-actual) reader. The operator picks a drill result and
 * the panel renders its {@link DRDrillDiff} against the predecessor: the pass
 * outcome change, signed RTO / RPO deltas, the step drift (newly failed / passed
 * / added / removed) and the asset drift (member and topology-edge changes).
 *
 * Read-only — no `dr:write` needed. Token-driven, bilingual, RTL-safe; numeric
 * deltas are kept `dir="ltr"` so the sign reads correctly under RTL.
 */
export function DrillDiffPanel({
  results,
  selectedResultId,
  onSelectResult,
  diff,
  loading = false,
  error,
  onRetry,
}: DrillDiffPanelProps) {
  const labels = useGameDayLabels();
  const L = labels.diff;

  const sortedResults = [...results].sort(
    (left, right) => timestampMs(right.observed_at) - timestampMs(left.observed_at),
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <CardTitle className="text-base">{L.heading}</CardTitle>
          <CardDescription>{L.description}</CardDescription>
        </div>
        {sortedResults.length > 0 ? (
          <div className="min-w-0 space-y-1.5 sm:w-72">
            <Label htmlFor="gameday-diff-result" className="text-xs text-muted-foreground">
              {L.resultSelectLabel}
            </Label>
            <Select value={selectedResultId ?? undefined} onValueChange={onSelectResult}>
              <SelectTrigger id="gameday-diff-result">
                <SelectValue placeholder={L.resultSelectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {sortedResults.map((result) => (
                  <SelectItem key={result.id} value={result.id}>
                    {L.resultOption(shortId(result.id), formatDate(result.observed_at))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {sortedResults.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {L.noResults}
          </p>
        ) : loading && !diff ? (
          <LoadingSkeleton variant="card" count={2} />
        ) : error && !diff ? (
          <ErrorState message={labels.errorDescription} onRetry={onRetry} />
        ) : !diff ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {L.noDiff}
          </p>
        ) : (
          <DiffBody diff={diff} L={L} />
        )}
      </CardContent>
    </Card>
  );
}

function DiffBody({ diff, L }: { diff: DRDrillDiff; L: DrillDiffLabels }) {
  const passChange = diff.newly_regressed
    ? { text: L.regressed, variant: 'destructive' as const }
    : diff.newly_recovered
      ? { text: L.recovered, variant: 'success' as const }
      : { text: L.unchanged, variant: 'outline' as const };

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-overline font-semibold uppercase text-muted-foreground">
            {L.passChangeLabel}
          </dt>
          <dd className="mt-1 space-y-1">
            <Badge variant={passChange.variant} className="normal-case">
              {passChange.text}
            </Badge>
            <p className="text-xs text-muted-foreground">
              {L.previousLabel}: {diff.previous_passed ? L.passedToken : L.failedToken} →{' '}
              {L.currentLabel}: {diff.current_passed ? L.passedToken : L.failedToken}
            </p>
          </dd>
        </div>
        <DeltaDatum label={L.rtoDeltaLabel} value={diff.rto_delta_seconds} regressed={diff.rto_regressed} L={L} />
        <DeltaDatum label={L.rpoDeltaLabel} value={diff.rpo_delta_seconds} regressed={diff.rpo_regressed} L={L} />
      </dl>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{L.stepDriftHeading}</h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DriftList label={L.newlyFailedSteps} items={diff.newly_failed_steps} tone="destructive" />
          <DriftList label={L.newlyPassedSteps} items={diff.newly_passed_steps} tone="success" />
          <DriftList label={L.addedSteps} items={diff.added_steps} tone="outline" />
          <DriftList label={L.removedSteps} items={diff.removed_steps} tone="outline" />
        </div>
        {!hasStepDrift(diff) ? (
          <p className="text-xs text-muted-foreground">{L.noStepDrift}</p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{L.assetDriftHeading}</h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DriftList label={L.addedMembers} items={diff.asset_drift.added_members} tone="success" />
          <DriftList label={L.removedMembers} items={diff.asset_drift.removed_members} tone="destructive" />
          <DriftList
            label={L.reorderedMembers}
            items={diff.asset_drift.reordered_members?.map((member) => member.site_id)}
            tone="warning"
          />
          <DriftList label={L.addedEdges} items={diff.asset_drift.added_edges} tone="success" />
          <DriftList label={L.removedEdges} items={diff.asset_drift.removed_edges} tone="destructive" />
        </div>
        {!hasAssetDrift(diff) ? (
          <p className="text-xs text-muted-foreground">{L.noAssetDrift}</p>
        ) : null}
      </section>
    </div>
  );
}

function DeltaDatum({
  label,
  value,
  regressed,
  L,
}: {
  label: string;
  value: number;
  regressed: boolean;
  L: DrillDiffLabels;
}) {
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <div className="min-w-0">
      <dt className="text-overline font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 inline-flex items-center gap-1 text-lg font-semibold',
          regressed ? 'text-destructive' : 'text-primary',
        )}
        dir="ltr"
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="tabular-nums">{L.secondsDelta(value)}</span>
      </dd>
    </div>
  );
}

function DriftList({
  label,
  items,
  tone,
}: {
  label: string;
  items?: string[];
  tone: 'success' | 'destructive' | 'warning' | 'outline';
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item} variant={tone} className="font-mono text-xs normal-case">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function hasStepDrift(diff: DRDrillDiff): boolean {
  return Boolean(
    diff.newly_failed_steps?.length ||
      diff.newly_passed_steps?.length ||
      diff.added_steps?.length ||
      diff.removed_steps?.length,
  );
}

function hasAssetDrift(diff: DRDrillDiff): boolean {
  const a = diff.asset_drift;
  return Boolean(
    a.added_members?.length ||
      a.removed_members?.length ||
      a.reordered_members?.length ||
      a.added_edges?.length ||
      a.removed_edges?.length,
  );
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}

function timestampMs(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}
