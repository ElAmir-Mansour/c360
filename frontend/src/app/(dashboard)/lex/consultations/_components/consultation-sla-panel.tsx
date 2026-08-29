'use client';

import { useSyncExternalStore } from 'react';
import { AlarmClock, CheckCircle2, Clock, Timer, TrendingUp } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Consultation } from '@/lib/lex/consultations';
import { slaRisk, SLA_RISK_TONE, type SlaRiskLevel } from './consultation-sla-meta';
import { useConsultationLabels } from './labels';

/**
 * ConsultationSlaPanel — SLA visualization for a consultation (#2).
 *
 * Renders the ack + response SLA clock projected onto the consultation:
 *  - an overall risk badge (slaRisk → SLA_RISK_TONE),
 *  - acknowledgement state (done / ack-due),
 *  - a response-due progress bar (sla_started_at → sla_response_due_at vs now)
 *    with a live-ish countdown ("in {x}" / "overdue by {x}"),
 *  - escalation level (when > 0),
 *  - outcome (pending / met / breached) plus resolution time.
 *
 * Pure presentational: reads only the SLA fields on `Consultation`. When no SLA
 * clock ever materialised (`sla_started_at` empty) it shows a neutral empty
 * state. Public prop shape is stable: `{ consultation }`.
 */
export interface ConsultationSlaPanelProps {
  consultation: Consultation;
}

/* ----------------------------------------------------------------------- *
 * A 30s "now" ticker so the countdown / progress stay live without a render
 * loop. Shared module-level store; mirrors the cadence of <RelativeTime />.
 * ----------------------------------------------------------------------- */
const nowListeners = new Set<() => void>();
let nowTs = typeof window === 'undefined' ? 0 : Date.now();
let nowInterval: ReturnType<typeof setInterval> | null = null;

function subscribeNow(cb: () => void) {
  if (typeof window !== 'undefined' && nowInterval === null) {
    nowInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      nowTs = Date.now();
      nowListeners.forEach((fn) => fn());
    }, 30_000);
  }
  nowListeners.add(cb);
  return () => {
    nowListeners.delete(cb);
    if (nowListeners.size === 0 && nowInterval !== null) {
      clearInterval(nowInterval);
      nowInterval = null;
    }
  };
}

function useNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    () => nowTs,
    () => 0,
  );
}

function toTs(value?: string | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/** Map a risk level onto the matching translated risk label. */
function riskLabel(level: SlaRiskLevel, L: ReturnType<typeof useConsultationLabels>['sla']): string {
  switch (level) {
    case 'breached':
      return L.breached;
    case 'due_soon':
      return L.dueSoon;
    case 'on_track':
      return L.onTrack;
    default:
      return L.pending;
  }
}

export function ConsultationSlaPanel({ consultation: c }: ConsultationSlaPanelProps) {
  const L = useConsultationLabels();
  const sla = L.sla;
  const now = useNow() || Date.now();

  const startedTs = toTs(c.sla_started_at);

  // No SLA clock ever materialised → neutral empty state.
  if (!startedTs) {
    return (
      <SectionCard title={L.columns.dueSla} description={sla.responseDue}>
        <EmptyState icon={Timer} size="compact" title={sla.pending} description={L.detail.fallbackDescription} />
      </SectionCard>
    );
  }

  const risk = slaRisk(
    {
      breached: c.sla_breached,
      responseDueAt: c.sla_response_due_at,
      ackDone: c.sla_ack_done,
    },
    now,
  );
  const riskTone = SLA_RISK_TONE[risk.level];

  /* -- Acknowledgement ------------------------------------------------- */
  const ackDone = c.sla_ack_done === true;
  const ackDueTs = toTs(c.sla_ack_due_at);
  const ackDoneTs = toTs(c.sla_ack_done_at);
  const ackValue = ackDone
    ? sla.acknowledged
    : ackDueTs
      ? `${sla.ackDue} ${formatDateTime(c.sla_ack_due_at!)}`
      : L.detail.notSet;
  const ackHelper = ackDone
    ? ackDoneTs
      ? formatDateTime(c.sla_ack_done_at!)
      : undefined
    : ackDueTs && ackDueTs - now <= 0
      ? sla.overdueBy(formatDuration(Math.round((now - ackDueTs) / 1000)))
      : ackDueTs
        ? sla.inDuration(formatDuration(Math.round((ackDueTs - now) / 1000)))
        : undefined;

  /* -- Response progress + countdown ----------------------------------- */
  const responseDueTs = toTs(c.sla_response_due_at);
  const overdue = responseDueTs !== null && responseDueTs - now <= 0;
  let progress = 0;
  if (responseDueTs !== null) {
    const span = responseDueTs - startedTs;
    progress = span <= 0 ? 100 : Math.min(100, Math.max(0, ((now - startedTs) / span) * 100));
  }
  const countdown =
    responseDueTs === null
      ? L.detail.notSet
      : overdue
        ? sla.overdueBy(formatDuration(Math.round((now - responseDueTs) / 1000)))
        : sla.inDuration(formatDuration(Math.round((responseDueTs - now) / 1000)));
  const responseValue = responseDueTs ? formatDateTime(c.sla_response_due_at!) : L.detail.notSet;

  /* -- Outcome --------------------------------------------------------- */
  const outcome = c.sla_outcome ?? 'pending';
  const resolvedTs = toTs(c.sla_resolved_at);
  const escalation = c.sla_escalation_level ?? 0;

  let outcomeTone: typeof riskTone = 'slate';
  let outcomeValue = sla.pending;
  let outcomeHelper: string | undefined;
  if (outcome === 'on_time') {
    outcomeTone = 'emerald';
    outcomeValue = sla.met;
    outcomeHelper = resolvedTs ? formatDateTime(c.sla_resolved_at!) : undefined;
  } else if (outcome === 'breached') {
    outcomeTone = 'rose';
    outcomeValue = sla.breached;
    outcomeHelper = toTs(c.sla_breached_at)
      ? sla.breachedAt(formatDateTime(c.sla_breached_at!))
      : resolvedTs
        ? formatDateTime(c.sla_resolved_at!)
        : undefined;
  } else {
    // pending → live tracking copy.
    outcomeHelper = responseDueTs ? countdown : undefined;
  }

  return (
    <SectionCard
      title={L.columns.dueSla}
      description={sla.responseDue}
      actions={<Badge variant={riskBadgeVariant(risk.level)}>{riskLabel(risk.level, sla)}</Badge>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailStatCard
            tone={ackDone ? 'emerald' : 'gold'}
            icon={ackDone ? CheckCircle2 : AlarmClock}
            label={sla.acknowledged}
            value={ackValue}
            helper={ackHelper}
            href="#consultation-sla-timeline"
          />
          <DetailStatCard
            tone={outcomeTone}
            icon={overdue ? AlarmClock : Clock}
            label={sla.responseDue}
            value={responseValue}
            helper={countdown}
            href="#consultation-sla-timeline"
          />
          <DetailStatCard
            tone={outcomeTone}
            icon={TrendingUp}
            label={sla.outcome}
            value={outcomeValue}
            helper={outcomeHelper}
            badge={escalation > 0 ? <Badge variant="warning">{sla.escalationLevel(escalation)}</Badge> : undefined}
            href="#consultation-sla-timeline"
          />
        </div>

        {/* Response-due progress bar (start → due against now). */}
        {responseDueTs !== null ? (
          <div id="consultation-sla-timeline" className="scroll-mt-24 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{sla.responseDue}</span>
              <span className={cn(overdue && 'font-medium text-error-500')}>{countdown}</span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-500',
                  overdue ? 'bg-error-500' : progress >= 75 ? 'bg-warning-500' : 'bg-primary',
                )}
                style={{ inlineSize: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{formatDateTime(c.sla_started_at!)}</span>
              <span>{responseValue}</span>
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function riskBadgeVariant(level: SlaRiskLevel): 'destructive' | 'warning' | 'success' | 'secondary' {
  switch (level) {
    case 'breached':
      return 'destructive';
    case 'due_soon':
      return 'warning';
    case 'on_track':
      return 'success';
    default:
      return 'secondary';
  }
}
