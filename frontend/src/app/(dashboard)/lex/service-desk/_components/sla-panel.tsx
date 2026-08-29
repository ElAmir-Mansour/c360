'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { LexStatusChip } from '@/components/lex/status-chip';
import { SlaCountdown } from '@/components/lex/sla-countdown';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLexFormat } from '@/lib/lex/ksa';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import {
  lexRequestsApi,
  requestCanHaveSlaClock,
  type RequestStatus,
  type EscalationRecipient,
  type SLAClock,
  type SLAClockOutcome,
} from '@/lib/lex/requests';
import { useServiceDeskLabels } from './labels';
import { useSlaExtraLabels } from './sla-extra-labels';
import { useReviewRoundLabels } from './review-rounds';

interface SlaPanelProps {
  requestId: string;
  status: RequestStatus;
}

export function SlaPanel({ requestId, status }: SlaPanelProps) {
  const labels = useServiceDeskLabels();
  const t = labels.sla;
  const extra = useSlaExtraLabels();
  const { locale } = useLocale();
  const f = useLexFormat();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  // §9 — SLA acknowledge/escalate are request edits.
  const canWrite = hasPermission('lex:request:edit');
  const clockExpected = requestCanHaveSlaClock(status);

  const clockQuery = useQuery({
    queryKey: ['lex-sla-clock', requestId],
    queryFn: () => lexRequestsApi.getRequestClock(requestId),
    enabled: Boolean(requestId) && clockExpected,
    retry: false,
  });

  const clock: SLAClock | undefined = clockExpected ? (clockQuery.data ?? undefined) : undefined;
  const beneficiaryEntityId = clock?.beneficiary_entity_id ?? undefined;
  const isResolved = Boolean(clock?.resolved_at);

  // Named escalation chain (feature #13): resolve the org ladder for the clock's
  // beneficiary entity so each L1/L2/L3 rung carries a recipient name.
  const ladderQuery = useQuery({
    queryKey: ['lex-org-escalation', beneficiaryEntityId],
    queryFn: () => lexRequestsApi.getOrgEntityEscalation(beneficiaryEntityId as string),
    enabled: Boolean(beneficiaryEntityId),
    retry: false,
  });

  // Index recipients by level for O(1) lookup against the due-date rungs. A
  // coverage gap simply leaves a level unmapped (handled at render time).
  const recipientByLevel = useMemo(() => {
    const map = new Map<number, EscalationRecipient>();
    for (const r of ladderQuery.data?.recipients ?? []) {
      map.set(r.level, r);
    }
    return map;
  }, [ladderQuery.data]);

  const ackMutation = useMutation({
    mutationFn: (clockId: string) => lexRequestsApi.acknowledgeClock(clockId),
    onSuccess: async () => {
      showSuccess(t.toast.acknowledged);
      await qc.invalidateQueries({ queryKey: ['lex-sla-clock', requestId] });
    },
    onError: showApiError,
  });

  const escalateMutation = useMutation({
    mutationFn: (clockId: string) => lexRequestsApi.escalateClock(clockId),
    onSuccess: async () => {
      showSuccess(extra.escalateSuccess);
      await qc.invalidateQueries({ queryKey: ['lex-sla-clock', requestId] });
    },
    onError: showApiError,
  });

  return (
    <SectionCard title={t.title} description={t.description}>
      {clockExpected && clockQuery.isLoading ? (
        <LoadingSkeleton variant="list-item" count={2} />
      ) : !clock ? (
        <EmptyState icon={Clock} title={t.none} description="" />
      ) : (
        <div className="space-y-4">
          {/*
            Round banner. A request returned to the requester stops its SLA and
            starts a fresh one on resubmission, so the clock below belongs to a
            specific round. Shown only from round 2 — on a request that was never
            returned there is only one clock and the banner would be noise.
          */}
          {clock.cycle > 1 || clock.outcome === 'stopped' ? (
            <SlaRoundBanner cycle={clock.cycle} outcome={clock.outcome} />
          ) : null}

          {/* Acknowledgement rung */}
          <SlaRung
            label={t.ackLabel}
            tone={clock.ack_done ? 'emerald' : 'gold'}
            icon={clock.ack_done ? CheckCircle2 : Clock}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <p className="text-muted-foreground">
                  {t.ackDue}: {f.formatDual(clock.ack_due_at)}
                </p>
                <p>
                  {clock.ack_done ? (
                    <span className="text-success-600 dark:text-success-300">
                      {t.ackDone}
                      {clock.ack_done_at ? ` · ${f.formatDual(clock.ack_done_at)}` : ''}
                    </span>
                  ) : (
                    <span className="text-warning-700 dark:text-warning-300">{t.ackPending}</span>
                  )}
                </p>
              </div>
              {canWrite && !clock.ack_done ? (
                <Button
                  size="sm"
                  onClick={() => ackMutation.mutate(clock.id)}
                  disabled={ackMutation.isPending}
                >
                  {ackMutation.isPending ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {t.acknowledge}
                </Button>
              ) : null}
            </div>
          </SlaRung>

          {/* Turnaround rung — #20 live countdown bar + breach ring */}
          <SlaRung
            label={t.turnaroundLabel}
            tone={clock.breached ? 'rose' : 'sky'}
            icon={clock.breached ? AlertTriangle : Clock}
          >
            <p className="text-sm text-muted-foreground">
              {t.turnaroundDue}: {f.formatDual(clock.turnaround_due_at)}
            </p>
            {clock.turnaround_from_due_at &&
            clock.turnaround_from_due_at !== clock.turnaround_due_at ? (
              <p className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'أقرب إنجاز متوقع' : 'Earliest delivery'}:{' '}
                {f.formatDual(clock.turnaround_from_due_at)}
              </p>
            ) : null}
            <SlaCountdown
              dueAt={clock.turnaround_due_at}
              startAt={clock.clock_started_at}
              fromAt={clock.turnaround_from_due_at}
              label={t.turnaroundLabel}
              className="mt-2"
            />
            {clock.breached ? (
              <p className="mt-2 text-sm font-medium text-destructive">
                {t.breached}
                {clock.breached_at ? ` · ${f.formatDual(clock.breached_at)}` : ''}
              </p>
            ) : (
              <p className="mt-2 text-sm text-success-600 dark:text-success-300">{t.onTrack}</p>
            )}
          </SlaRung>

          {/* Escalation ladder + named chain (feature #13) */}
          <SlaRung
            label={t.escalationLabel}
            tone={clock.escalation_level > 0 ? 'rose' : 'slate'}
            icon={AlertTriangle}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm">
                  {clock.escalation_level > 0
                    ? t.escalationLevel(clock.escalation_level)
                    : t.noEscalation}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {clock.escalation_level >= MAX_ESCALATION_LEVEL
                    ? extra.atTopLevel
                    : extra.advancesTo(clock.escalation_level, clock.escalation_level + 1)}
                </p>
              </div>
              {canWrite && !isResolved && clock.escalation_level < MAX_ESCALATION_LEVEL ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => escalateMutation.mutate(clock.id)}
                  disabled={escalateMutation.isPending}
                >
                  {escalateMutation.isPending ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {escalateMutation.isPending ? extra.escalating : extra.escalateNow}
                </Button>
              ) : null}
            </div>

            <p className="mt-3 text-xs font-medium text-muted-foreground">{extra.chainTitle}</p>
            <ul className="mt-1 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-3">
              {ESCALATION_RUNGS.map(({ level, dueAt }) => {
                const recipient = recipientByLevel.get(level);
                const name = recipient ? resolveLocalized(recipient.label, locale) : '';
                return (
                  <li key={level} className="rounded-md bg-muted/40 px-2 py-1.5">
                    <p className="font-medium">
                      L{level}: {f.formatDual(clock[dueAt])}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      {!beneficiaryEntityId ? (
                        extra.noChain
                      ) : name ? (
                        name
                      ) : (
                        <span className="italic">{extra.noRecipient}</span>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          </SlaRung>

          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <span className="text-sm text-muted-foreground">{t.outcomeLabel}</span>
            <LexStatusChip
              value={clock.outcome}
              domain="sla"
              labels={t.outcomeOptions}
              size="sm"
            />
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/** Top rung of the L1/L2/L3 escalation ladder. */
const MAX_ESCALATION_LEVEL = 3;

/** SLAClock keys that hold the (non-null) L1/L2/L3 escalation due dates. */
type EscalationDueKey =
  | 'escalation_l1_due_at'
  | 'escalation_l2_due_at'
  | 'escalation_l3_due_at';

/** Maps each ladder level to its SLAClock due-date field, in order. */
const ESCALATION_RUNGS = [
  { level: 1, dueAt: 'escalation_l1_due_at' },
  { level: 2, dueAt: 'escalation_l2_due_at' },
  { level: 3, dueAt: 'escalation_l3_due_at' },
] as const satisfies ReadonlyArray<{ level: number; dueAt: EscalationDueKey }>;

const TONE_ACCENT: Record<string, string> = {
  emerald: 'bg-success-300/70',
  gold: 'bg-warning-300/70',
  sky: 'bg-sky-400/70',
  rose: 'bg-destructive/60',
  slate: 'bg-muted-foreground/40',
};

function SlaRung({
  label,
  tone,
  icon: Icon,
  children,
}: {
  label: string;
  tone: keyof typeof TONE_ACCENT;
  icon: typeof Clock;
  children: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5">
      <span className={cn('absolute inset-y-0 start-0 w-1', TONE_ACCENT[tone])} aria-hidden />
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Round banner for the SLA panel.
 *
 * A returned request stops its SLA and starts a fresh one when the requester
 * sends it back, so the deadlines below belong to one specific round. This says
 * which — and, when the round was stopped, says plainly that the pause is not a
 * breach, since a halted clock next to a passed deadline otherwise reads as one.
 */
function SlaRoundBanner({
  cycle,
  outcome,
}: {
  cycle: number;
  outcome: SLAClockOutcome;
}) {
  const labels = useReviewRoundLabels();
  const format = useLexFormat();
  const stopped = outcome === 'stopped';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border px-4 py-2.5',
        stopped ? 'border-border bg-muted/40' : 'border-border',
      )}
      data-sla-round={cycle}
    >
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
        {labels.roundHeading(format.formatNumber(cycle))}
      </span>
      {/*
        Not LexStatusChip: that resolves a BACKEND status token through the lex
        status catalogue, and "SLA stopped" is panel copy, not a token.
      */}
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[11px] font-medium',
          stopped
            ? 'bg-muted text-muted-foreground'
            : 'bg-info-50 text-info-700 dark:bg-info-950 dark:text-info-300',
        )}
      >
        {stopped ? labels.slaStopped : labels.slaRunning}
      </span>
      {stopped ? (
        <p className="w-full text-[11px] leading-snug text-muted-foreground">
          {labels.slaStoppedHint}
        </p>
      ) : null}
    </div>
  );
}
