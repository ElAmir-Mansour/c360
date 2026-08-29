'use client';

import {
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Clock,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useRecoverEvidenceReport } from '@/lib/recover/use-evidence';
import {
  actionLabel,
  formatSeconds,
  formatTimestamp,
  subSolutionLabel,
} from './labels';
import { useRecoverT } from '../../_lib/recover-i18n';
import type { RecoverEvidenceReport } from '@/types/recover-evidence';

/**
 * The full regulator-ready evidence report for one recovery event, rendered
 * inline from the REAL composed backend payload: the runbook executed (RTO vs
 * RTA from the Metastore seam), the approvals, the integrity-check results (for
 * cyber recovery), and the append-only audit timeline. Every section reflects
 * real data; an empty section means the event has no such records.
 */
export function EvidenceReportDetail({ eventId }: { eventId: string }) {
  const t = useRecoverT();
  const { data, isLoading, isError, error } = useRecoverEvidenceReport(eventId);

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="evidence-report-loading">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div
        className="flex items-start gap-2 rounded-md border border-error-100 bg-error-50 p-4 text-sm text-error-600"
        role="alert"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error?.message ?? t('prove.reportErrorFallback')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="evidence-report">
      <ReportHeader report={data} />
      <RunbookSection report={data} />
      <ApprovalsSection report={data} />
      <IntegritySection report={data} />
      <TimelineSection report={data} />
    </div>
  );
}

function ReportHeader({ report }: { report: RecoverEvidenceReport }) {
  const t = useRecoverT();
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {subSolutionLabel(t, report.sub_solution)}
      </div>
      <h3 className="text-h4 font-semibold text-foreground">
        {report.application_name ?? t('prove.recoveryEvent')}
        {report.application_key && (
          <span className="ms-2 text-sm font-normal text-muted-foreground">
            {report.application_key}
          </span>
        )}
      </h3>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{report.event_id}</p>
    </div>
  );
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
      {icon}
      {title}
    </div>
  );
}

function RunbookSection({ report }: { report: RecoverEvidenceReport }) {
  const t = useRecoverT();
  const e = report.runbook_execution;
  return (
    <section>
      <SectionHeading icon={<FileText className="h-4 w-4" />} title={t('prove.runbookExecuted')} />
      {!e ? (
        <p className="text-sm text-muted-foreground">{t('prove.noRunbookLinked')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-border/60 p-3 text-sm sm:grid-cols-3">
          <KeyVal label={t('prove.fieldRunbook')} value={e.runbook_name} />
          <KeyVal label={t('prove.fieldMode')} value={e.mode} />
          <KeyVal label={t('prove.fieldStatus')} value={e.status} />
          <KeyVal label={t('prove.fieldRtoTarget')} value={formatSeconds(e.rto_target_seconds)} />
          <KeyVal label={t('prove.fieldRtaActual')} value={formatSeconds(e.rta_actual_seconds)} />
          <KeyVal
            label={t('prove.fieldRtoOutcome')}
            value={
              e.rta_actual_seconds === undefined ? (
                <span className="text-muted-foreground">{t('prove.notYetCaptured')}</span>
              ) : e.rta_breach ? (
                <span className="font-semibold text-error-500">
                  {t('prove.breachedBy', { amount: formatSeconds(e.breach_seconds) })}
                </span>
              ) : (
                <span className="font-medium text-success-600">{t('prove.withinTarget')}</span>
              )
            }
          />
        </div>
      )}
    </section>
  );
}

function ApprovalsSection({ report }: { report: RecoverEvidenceReport }) {
  const t = useRecoverT();
  return (
    <section>
      <SectionHeading icon={<ShieldCheck className="h-4 w-4" />} title={t('prove.approvals')} />
      {report.approvals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('prove.noApprovals')}</p>
      ) : (
        <ul className="space-y-2">
          {report.approvals.map((a, i) => (
            <li key={i} className="rounded-md border border-border/60 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{a.approver}</span>
                <span className="text-xs text-muted-foreground">{formatTimestamp(a.approved_at)}</span>
              </div>
              {a.note && <p className="mt-1 text-muted-foreground">{a.note}</p>}
              {a.scan_id && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {t('prove.pinnedToScan', { id: a.scan_id })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IntegritySection({ report }: { report: RecoverEvidenceReport }) {
  const t = useRecoverT();
  return (
    <section>
      <SectionHeading icon={<ShieldCheck className="h-4 w-4" />} title={t('prove.integrityResults')} />
      {report.integrity_checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('prove.noIntegrityResults')}</p>
      ) : (
        <ul className="space-y-2">
          {report.integrity_checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2 rounded-md border border-border/60 p-3 text-sm">
              {c.passed ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-error-500" />
              )}
              <div>
                <div className={cn('font-semibold', c.passed ? 'text-success-600' : 'text-error-500')}>
                  {c.verdict}
                </div>
                <div className="text-xs text-muted-foreground">{formatTimestamp(c.checked_at)}</div>
                {c.detail && <p className="mt-1 text-muted-foreground">{c.detail}</p>}
                {c.scan_id && (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{t('prove.scanRef', { id: c.scan_id })}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TimelineSection({ report }: { report: RecoverEvidenceReport }) {
  const t = useRecoverT();
  return (
    <section>
      <SectionHeading icon={<Clock className="h-4 w-4" />} title={t('prove.fullTimeline')} />
      {report.timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('prove.noTimeline')}</p>
      ) : (
        <ol className="space-y-3 border-s border-border/60 ps-4">
          {report.timeline.map((entry, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[1.30rem] top-1 h-2 w-2 rounded-full bg-primary" aria-hidden />
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{actionLabel(t, entry.action)}</span>
                <span className="text-xs text-muted-foreground">{formatTimestamp(entry.at)}</span>
              </div>
              <div className="text-xs text-muted-foreground">{entry.actor}</div>
              {entry.summary && <p className="mt-0.5 text-sm text-muted-foreground">{entry.summary}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function KeyVal({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-foreground">{value || '—'}</div>
    </div>
  );
}
