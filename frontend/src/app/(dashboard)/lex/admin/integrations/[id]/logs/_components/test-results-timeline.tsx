'use client';

/**
 * TestResultsTimeline — a vertical timeline of on-demand connection-test results
 * (POST /integrations/{id}/test) the operator has run this session.
 *
 * Test results are NOT persisted by the backend as a ledger, so this keeps them
 * in session-local state (lifted into the parent page). The component renders the
 * "Run test" trigger, a running spinner, a friendly empty-state, and one entry
 * per probe (reachable/unreachable, latency, sample count, relative time). RTL-
 * safe; all copy via the bilingual label module.
 */
import { PlugZap, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ar as arLocale, enUS } from 'date-fns/locale';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { TestResult } from '@/lib/lex/integrations';
import type { IntegrationLogsLabels } from './logs-labels';
import { interpolate } from './logs-labels';

/** One session-local test entry (the probe result + a client receipt time). */
export interface TestResultEntry {
  /** Stable client id for the list key. */
  id: string;
  result: TestResult;
  /** Client-side receipt timestamp (ms epoch) for relative display. */
  at: number;
}

export interface TestResultsTimelineProps {
  entries: TestResultEntry[];
  running: boolean;
  /** Whether the operator may trigger a test (write permission). */
  canTest: boolean;
  onRunTest: () => void;
  local: IntegrationLogsLabels;
}

function relativeTime(at: number, justNow: string, locale: AppLocale): string {
  const delta = Date.now() - at;
  if (delta < 45_000) return justNow;
  try {
    return formatDistanceToNow(new Date(at), {
      addSuffix: true,
      locale: locale === 'ar' ? arLocale : enUS,
    });
  } catch {
    return justNow;
  }
}

export function TestResultsTimeline({
  entries,
  running,
  canTest,
  onRunTest,
  local,
}: TestResultsTimelineProps) {
  const { locale } = useLocaleOrDefault();

  return (
    <div className="space-y-4">
      {canTest ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{local.testLocalNote}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRunTest}
            disabled={running}
            className="shrink-0"
          >
            {running ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlugZap className="me-1.5 h-4 w-4" aria-hidden />
            )}
            {running ? local.testsRunning : local.testsRunNow}
          </Button>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          icon={PlugZap}
          size="compact"
          title={local.testsEmptyTitle}
          description={local.testsEmptyBody}
        />
      ) : (
        <ol className="relative space-y-4 border-s border-border/70 ps-5">
          {entries.map((entry) => {
            const { result } = entry;
            const ok = result.reachable;
            const Icon = ok ? CheckCircle2 : XCircle;
            return (
              <li key={entry.id} className="relative">
                <span
                  className={cn(
                    'absolute -start-[1.6rem] flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-background',
                    ok
                      ? 'bg-primary/15 text-primary'
                      : 'bg-error-100 text-error-500 dark:bg-error-700/30 dark:text-error-300',
                  )}
                  aria-hidden
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        ok
                          ? 'text-primary'
                          : 'text-error-600 dark:text-error-300',
                      )}
                    >
                      {ok ? local.testReachable : local.testUnreachable}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" aria-hidden />
                      {relativeTime(entry.at, local.testJustNow, locale)}
                    </span>
                  </div>

                  {result.detail ? (
                    <p className="mt-1 text-sm text-muted-foreground">{result.detail}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {interpolate(local.testLatency, { ms: Math.round(result.latency_millis) })}
                    </span>
                    <span className="tabular-nums">
                      {interpolate(local.testSamples, { n: result.sample_count })}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default TestResultsTimeline;
