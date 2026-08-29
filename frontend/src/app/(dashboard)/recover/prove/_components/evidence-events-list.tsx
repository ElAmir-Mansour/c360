'use client';

import { useState } from 'react';
import {
  FileDown,
  FileText,
  ChevronRight,
  AlertTriangle,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { showError, showSuccess } from '@/lib/toast';
import { useRecoverEvidenceEvents } from '@/lib/recover/use-evidence';
import {
  downloadRecoverEvidenceExport,
  type RecoverEvidenceExportFormat,
} from '@/lib/recover/evidence';
import { EvidenceReportDetail } from './evidence-report-detail';
import { actionLabel, formatTimestamp, subSolutionLabel } from './labels';
import { useRecoverT } from '../../_lib/recover-i18n';
import type { RecoverAuditEventSummary } from '@/types/recover-evidence';

/**
 * The "Prove" event list: every audited recovery event for the tenant (from the
 * append-only audit log), with a one-click compliance export (CSV / PDF) per
 * event and an expandable, regulator-ready report. The export downloads through
 * the authenticated pipeline so the regulator-grade document is produced from
 * real server-side data — no client-side fabrication.
 */
export function EvidenceEventsList() {
  const t = useRecoverT();
  const { data, isLoading, isError, error } = useRecoverEvidenceEvents();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function onExport(eventId: string, format: RecoverEvidenceExportFormat) {
    const key = `${eventId}:${format}`;
    setBusy(key);
    try {
      await downloadRecoverEvidenceExport(eventId, format);
      showSuccess(t('prove.exportReady'), t('prove.exportReadyBody', { format: format.toUpperCase() }));
    } catch (err) {
      showError(
        t('prove.exportFailed'),
        err instanceof Error ? err.message : t('prove.exportFailedFallback'),
      );
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="evidence-events-loading">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="flex items-start gap-2 rounded-md border border-error-100 bg-error-50 p-4 text-sm text-error-600"
        role="alert"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error?.message ?? t('prove.eventsErrorFallback')}</span>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 p-8 text-center" data-testid="evidence-empty">
        <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium text-foreground">{t('prove.noEventsTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('prove.noEventsBody')}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2" data-testid="evidence-events">
      {data.map((ev) => (
        <li key={ev.event_id} className="card overflow-hidden p-0">
          <EventRow
            event={ev}
            expanded={expanded === ev.event_id}
            busy={busy}
            onToggle={() => setExpanded(expanded === ev.event_id ? null : ev.event_id)}
            onExport={onExport}
          />
          {expanded === ev.event_id && (
            <div className="border-t border-border/60 bg-muted/20 p-4">
              <EvidenceReportDetail eventId={ev.event_id} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function EventRow({
  event,
  expanded,
  busy,
  onToggle,
  onExport,
}: {
  event: RecoverAuditEventSummary;
  expanded: boolean;
  busy: string | null;
  onToggle: () => void;
  onExport: (eventId: string, format: RecoverEvidenceExportFormat) => void;
}) {
  const t = useRecoverT();
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-1 items-start gap-3 text-start"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge-neutral">{subSolutionLabel(t, event.sub_solution)}</span>
            <span className="text-sm font-medium text-foreground">{actionLabel(t, event.latest_action)}</span>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{event.event_id}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {event.action_count === 1
              ? t('prove.actionCountOne', { count: event.action_count, when: formatTimestamp(event.last_at) })
              : t('prove.actionCountMany', { count: event.action_count, when: formatTimestamp(event.last_at) })}
            {event.latest_actor && ` · ${event.latest_actor}`}
          </div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-2">
        <ExportButton
          label="CSV"
          icon={<FileDown className="h-4 w-4" />}
          loading={busy === `${event.event_id}:csv`}
          onClick={() => onExport(event.event_id, 'csv')}
        />
        <ExportButton
          label="PDF"
          icon={<FileText className="h-4 w-4" />}
          loading={busy === `${event.event_id}:pdf`}
          onClick={() => onExport(event.event_id, 'pdf')}
          primary
        />
      </div>
    </div>
  );
}

function ExportButton({
  label,
  icon,
  loading,
  onClick,
  primary,
}: {
  label: string;
  icon: React.ReactNode;
  loading: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  const t = useRecoverT();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
        primary ? 'btn-primary' : 'btn-secondary',
      )}
      aria-label={t('prove.exportAria', { label })}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  );
}
