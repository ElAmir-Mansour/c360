'use client';

import { CheckCircle2, GitCommitHorizontal, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
import type { DRConsistencyBarrier } from '@/types/clario-dr';
import { useConsistencyPointLabels } from '../../_lib/dr-action-labels';

/**
 * App-consistent point trigger for the Recover route.
 *
 * Wraps `useRecoveryActions().triggerConsistencyPoint` — it freezes/thaws the
 * application via the configured provider and seals an app-consistent recovery
 * point for the selected group. The action is `dr:write`-gated (disabled +
 * tooltip when absent, or when no group is selected) and shows the last sealed
 * barrier returned by the mutation. Consumes the real `DRConsistencyBarrier`
 * shape; no invented fields.
 */
export function ConsistencyPointCard({
  selectedGroupName,
  latestBarrier,
  pending,
  disabledReason,
  onTrigger,
}: {
  selectedGroupName: string | null;
  latestBarrier: DRConsistencyBarrier | null;
  pending: boolean;
  disabledReason: string | null;
  onTrigger: () => void;
}) {
  const t = useConsistencyPointLabels();
  const disabled = disabledReason !== null || pending;

  const button = (
    <Button type="button" size="sm" onClick={onTrigger} disabled={disabled} aria-disabled={disabled || undefined}>
      {pending ? <Spinner size="sm" className="me-1.5" /> : <GitCommitHorizontal className="me-1.5 h-4 w-4" aria-hidden />}
      {t.triggerButton}
    </Button>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">{t.cardTitle}</CardTitle>
            <CardDescription>
              {t.cardDescription(selectedGroupName ?? t.selectedGroupFallback)}
            </CardDescription>
          </div>
          {disabledReason ? (
            <Tooltip>
              {/* Disabled buttons swallow pointer events, so wrap for the tooltip trigger. */}
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex">
                  {button}
                </span>
              </TooltipTrigger>
              <TooltipContent>{disabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            button
          )}
        </CardHeader>
        {latestBarrier ? (
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={latestBarrier.success ? 'success' : 'destructive'} className="normal-case">
                {latestBarrier.success ? (
                  <CheckCircle2 className="me-1 h-3.5 w-3.5" aria-hidden />
                ) : (
                  <XCircle className="me-1 h-3.5 w-3.5" aria-hidden />
                )}
                {latestBarrier.success ? t.sealed : t.failed}
              </Badge>
              <Badge variant="outline" className="normal-case">{latestBarrier.consistency_level}</Badge>
              <Badge variant="outline" className="normal-case">{latestBarrier.provider}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Datum label={t.barrier} value={shortID(latestBarrier.id)} tone="sky" />
              <Datum label={t.recoveryPoint} value={shortID(latestBarrier.recovery_point_id)} tone="gold" />
              <Datum label={t.quiesced} value={latestBarrier.quiesced ? t.yes : t.no} tone="emerald" />
              <Datum label={t.thawed} value={latestBarrier.thawed ? t.yes : t.no} tone="emerald" />
            </div>
            <div className={cn('rounded-lg border bg-[var(--kpi-bg)] border-[var(--kpi-border)] px-3 py-2', TONE_THEME_CLASS.sky)}>
              <div className="text-xs font-semibold uppercase text-[color:var(--kpi-accent)]">{t.barrierLsn}</div>
              <div className="mt-1 truncate font-mono text-xs">{latestBarrier.barrier_lsn || 'n/a'}</div>
            </div>
            {latestBarrier.error ? (
              <div className="rounded-lg border border-error-300 bg-error-50 px-3 py-2 text-sm text-error-700 dark:border-error-700/50 dark:bg-error-700/20 dark:text-error-300">
                {latestBarrier.error}
              </div>
            ) : null}
          </CardContent>
        ) : null}
      </Card>
    </TooltipProvider>
  );
}

/**
 * App-consistent barrier datum. `tone` is a decorative accent only, bridged onto
 * the shared `StatTone` vocabulary via `TONE_THEME_CLASS` (the theme class wires
 * the `--kpi-*` custom properties): toned tiles render the compact faded-gradient
 * surface with an accented label while the value text stays neutral. With no
 * `tone` (default) the original flat, borderless treatment is unchanged.
 */
function Datum({ label, value, tone }: { label: string; value: string; tone?: StatTone }) {
  const toned = tone !== undefined && tone !== 'neutral';
  if (!toned) {
    return (
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div>
        <div className="mt-1 truncate font-medium">{value}</div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        TONE_THEME_CLASS[tone],
        'min-w-0 rounded-lg border bg-[var(--kpi-bg)] border-[var(--kpi-border)] px-2.5 py-2',
      )}
    >
      <div className="text-xs font-semibold uppercase text-[color:var(--kpi-accent)]">{label}</div>
      <div className="mt-1 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}

function shortID(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}
