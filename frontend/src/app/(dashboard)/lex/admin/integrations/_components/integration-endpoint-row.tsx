'use client';

/**
 * One registered endpoint inside a kind card: a selection checkbox (for bulk
 * actions), health-grade dot + name/code, status badge, last-checked relative
 * time, encrypted hint, a per-connector uptime SPARKLINE (Feature 6), a Test
 * quick-action, and a compact pass/fail summary of the last test's diagnostic
 * steps (Feature 2). Clicking the name navigates to the detail/edit surface.
 */
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Lock, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';
import type {
  DiagnosticStep,
  HealthCheckRecord,
  IntegrationEndpoint,
  IntegrationHealth,
  TestResult,
} from '@/lib/lex/integrations';
import {
  gradeFor,
  HEALTH_DOT_CLASS,
  isInactive,
  relativeTime,
  statusBadgeConfig,
} from '../_lib/health-presentation';
import type { IntegrationsListLabels } from '../_lib/integrations-i18n';
import { HealthSparkline } from './health-sparkline';

/** Tally a TestResult's diagnostic steps into a compact pass/warn/fail summary. */
export interface StepTally {
  total: number;
  ok: number;
  warn: number;
  fail: number;
  skip: number;
}

export function tallySteps(steps: DiagnosticStep[] | undefined): StepTally | null {
  if (!steps || steps.length === 0) return null;
  const tally: StepTally = { total: steps.length, ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const s of steps) {
    switch (s.status) {
      case 'ok':
        tally.ok += 1;
        break;
      case 'warn':
        tally.warn += 1;
        break;
      case 'fail':
        tally.fail += 1;
        break;
      case 'skip':
        tally.skip += 1;
        break;
    }
  }
  return tally;
}

interface IntegrationEndpointRowProps {
  endpoint: IntegrationEndpoint;
  probe?: IntegrationHealth | null;
  href: string;
  locale: 'ar' | 'en';
  direction: 'ltr' | 'rtl';
  labels: IntegrationsListLabels;
  canWrite: boolean;
  testing?: boolean;
  onTest?: () => void;
  /** Recent health-probe series for this endpoint (Feature 6 sparkline). */
  history?: HealthCheckRecord[];
  /** True while the shared history query is loading. */
  historyLoading?: boolean;
  /** True when the shared history query failed for this endpoint. */
  historyDegraded?: boolean;
  /** Last connection-test outcome for this endpoint (Feature 2 summary). */
  lastTest?: TestResult | null;
  /** Whether bulk selection is enabled (operator has MANAGE) — shows checkbox. */
  selectable?: boolean;
  /** Whether this row is currently selected for a bulk action. */
  selected?: boolean;
  onSelectChange?: (checked: boolean) => void;
}

export function IntegrationEndpointRow({
  endpoint,
  probe,
  href,
  locale,
  direction,
  labels: t,
  canWrite,
  testing = false,
  onTest,
  history,
  historyLoading = false,
  historyDegraded = false,
  lastTest,
  selectable = false,
  selected = false,
  onSelectChange,
}: IntegrationEndpointRowProps) {
  const grade = gradeFor(endpoint, probe);
  const checked = relativeTime(endpoint.last_checked_at, locale, t);
  const Chevron = direction === 'rtl' ? ChevronLeft : ChevronRight;
  const gradeLabel = t.grade[grade];
  const tally = tallySteps(lastTest?.steps);

  return (
    <div
      className={cn(
        'group flex flex-col gap-2 rounded-lg border px-3 py-2.5 transition-colors hover:bg-secondary/40',
        selected ? 'border-primary/50 bg-primary/5' : 'border-border/60',
        isInactive(endpoint.status) && 'opacity-80',
      )}
      data-testid="integration-endpoint-row"
      data-selected={selected || undefined}
    >
      <div className="flex items-center gap-3">
        {/* Bulk-selection checkbox (only when selectable). */}
        {selectable ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onSelectChange?.(v === true)}
            aria-label={`${t.selectRow}: ${endpoint.name || t.defaultName}`}
            className="shrink-0"
          />
        ) : null}

        {/* Health-grade dot */}
        <span
          role="img"
          className={cn('h-2.5 w-2.5 shrink-0 rounded-full', HEALTH_DOT_CLASS[grade])}
          title={gradeLabel}
          aria-label={gradeLabel}
        />

        {/* Name + code + last checked */}
        <Link href={href} className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium group-hover:underline">
              {endpoint.name || t.defaultName}
            </span>
            {endpoint.encrypted ? (
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t.encrypted} />
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-caption text-muted-foreground">
            <span className="font-mono">{endpoint.code}</span>
            <span aria-hidden>·</span>
            <span>
              {t.lastChecked}: {checked || t.neverChecked}
            </span>
          </div>
        </Link>

        {/* Status badge */}
        <StatusBadge
          status={endpoint.status}
          config={statusBadgeConfig(t)}
          variant="outline"
          size="sm"
          className="hidden shrink-0 sm:inline-flex"
        />

        {/* Test quick-action */}
        {canWrite ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2"
            disabled={testing}
            onClick={onTest}
            title={t.test}
          >
            <PlugZap
              className={cn('h-3.5 w-3.5', testing && 'animate-pulse')}
              aria-hidden
            />
            <span className="ms-1.5 hidden md:inline">{testing ? t.testing : t.test}</span>
          </Button>
        ) : null}

        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>

      {/* Secondary line: uptime sparkline (start) + last-test summary (end). */}
      <div className="flex items-end justify-between gap-3 ps-[18px]">
        {(history ?? []).length > 0 && !historyLoading && !historyDegraded ? (
          <Link href={href} className="min-w-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <HealthSparkline history={history ?? []} labels={t} className="min-w-0" />
          </Link>
        ) : (
          <HealthSparkline
            history={history ?? []}
            labels={t}
            loading={historyLoading}
            degraded={historyDegraded}
            className="min-w-0"
          />
        )}

        {lastTest ? (
          <TestSummary tally={tally} reachable={lastTest.reachable} labels={t} href={href} />
        ) : null}
      </div>
    </div>
  );
}

/** Compact pass/fail chip-row from a TestResult's diagnostic steps. */
function TestSummary({
  tally,
  reachable,
  labels: t,
  href,
}: {
  tally: StepTally | null;
  reachable: boolean;
  labels: IntegrationsListLabels;
  href: string;
}) {
  // No layered steps — fall back to the single reachable boolean.
  if (!tally) {
    return (
      <Link
        href={href}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-caption font-semibold',
          reachable ? 'badge-success' : 'badge-danger',
        )}
        title={t.testNoSteps}
      >
        {reachable ? t.grade.healthy : t.grade.down}
      </Link>
    );
  }

  return (
    <Link href={href} className="flex shrink-0 items-center gap-1 rounded text-caption font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span
        className={cn(
          'inline-flex items-center rounded-full px-1.5 py-0.5',
          tally.fail > 0 ? 'badge-warning' : 'badge-success',
        )}
        title={t.testStepsSummary(tally.ok, tally.total)}
      >
        {t.testStepsSummary(tally.ok, tally.total)}
      </span>
      {tally.warn > 0 ? (
        <span className="badge-warning inline-flex items-center rounded-full px-1.5 py-0.5">
          {t.testWarnSteps(tally.warn)}
        </span>
      ) : null}
      {tally.fail > 0 ? (
        <span className="badge-danger inline-flex items-center rounded-full px-1.5 py-0.5">
          {t.testFailedSteps(tally.fail)}
        </span>
      ) : null}
    </Link>
  );
}

export default IntegrationEndpointRow;
