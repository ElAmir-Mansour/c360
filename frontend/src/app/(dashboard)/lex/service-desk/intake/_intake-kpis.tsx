'use client';

/**
 * Compact KPI header for the Intake Triage Queue, extracted from `page.tsx`.
 *
 * A `page.tsx` in the App Router may only export the default page (plus Next's
 * recognised special exports), so this component — which is also imported by
 * `intake-kpis.test.tsx` for focused visual/RTL regression tests — lives here
 * as a private (`_`-prefixed) sibling module instead.
 */

import { AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { StatTile } from '@/components/shared/stat-tile';
import { useLexFormat } from '@/lib/lex/ksa';
import { useIntakeLabels } from './_labels';

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

interface IntakeKpisProps {
  stats: { pending: number; processed: number; errored: number };
  loadedCount: number;
  loading: boolean;
  activeScope?: IntakeKpiScope | null;
  onScopeChange?: (scope: IntakeKpiScope) => void;
}

export type IntakeKpiScope = 'pending' | 'processed' | 'errored';

/** Compact KPI group extracted for focused visual and RTL regression tests. */
export function IntakeKpis({
  stats,
  loadedCount,
  loading,
  activeScope,
  onScopeChange,
}: IntakeKpisProps) {
  const f = useLexFormat();
  const labels = useIntakeLabels();
  const pendingShare = percent(stats.pending, loadedCount);
  const processedShare = percent(stats.processed, loadedCount);
  const erroredShare = percent(stats.errored, loadedCount);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <StatTile
        label={labels.stats.pending}
        value={f.formatNumber(stats.pending)}
        themeClass="kpi-theme-amber"
        icon={Clock}
        progress={pendingShare}
        progressLabel={labels.statDetails.intakeShare}
        detail={labels.statDetails.loadedMessages}
        detailValue={f.formatNumber(loadedCount)}
        loading={loading}
        size="md"
        appearance="operational"
        pressed={activeScope === 'pending'}
        onAction={() => onScopeChange?.('pending')}
      />
      <StatTile
        label={labels.stats.processed}
        value={f.formatNumber(stats.processed)}
        themeClass="kpi-theme-emerald"
        icon={CheckCircle}
        progress={processedShare}
        progressLabel={labels.statDetails.intakeShare}
        detail={labels.stats.processed}
        detailValue={`${f.formatNumber(processedShare)}%`}
        loading={loading}
        size="md"
        appearance="operational"
        pressed={activeScope === 'processed'}
        onAction={() => onScopeChange?.('processed')}
      />
      <StatTile
        label={labels.stats.errored}
        value={f.formatNumber(stats.errored)}
        themeClass="kpi-theme-red"
        icon={AlertTriangle}
        progress={erroredShare}
        progressLabel={labels.statDetails.intakeShare}
        detail={labels.stats.errored}
        detailValue={`${f.formatNumber(erroredShare)}%`}
        loading={loading}
        size="md"
        appearance="operational"
        pressed={activeScope === 'errored'}
        onAction={() => onScopeChange?.('errored')}
      />
    </div>
  );
}
