'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FilePlus2,
  FileText,
  PencilLine,
  Plus,
  Share2,
  ShieldCheck,
  Trash2,
  UserRoundSearch,
} from 'lucide-react';
import {
  caseStatusMap,
  severityMap,
  StatusBadge,
} from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLexFormat } from '@/lib/lex/ksa';
import type {
  Investigation,
  InvestigationAuditEntry,
  InvestigationEvidence,
  InvestigationParty,
} from '@/lib/lex/investigations';
import { cn } from '@/lib/utils';
import {
  formatInvestigationToken,
  type InvestigationLabels,
} from '../../_components/labels';
import { InitialsAvatar } from './rail-bits';
import { useInvestigationDetailSurfaceLabels } from './investigation-detail-surface-labels';

interface InvestigationDetailSurfaceProps {
  investigation: Investigation;
  auditEntries: InvestigationAuditEntry[];
  labels: InvestigationLabels;
  canWrite: boolean;
  lifecycle?: ReactNode;
  /**
   * Record-scoped header action slot (e.g. "Ask for support"). The page owns the
   * permission gate and passes the bound record context, so this surface stays
   * presentational.
   */
  headerActions?: ReactNode;
  onEdit: () => void;
  onShare: () => void;
  onAddParty: () => void;
  onEditParty: (party: InvestigationParty) => void;
  onRemoveParty: (party: InvestigationParty) => void;
  onAddEvidence: () => void;
  onRemoveEvidence: (evidence: InvestigationEvidence) => void;
  onRecordStatement: () => void;
  onGenerateReport: () => void;
  onOpenTimeline: () => void;
}

interface DetailTimelineEntry {
  id: string;
  date: string;
  title: string;
  description?: string;
  current?: boolean;
}

const flatCardClass =
  'rounded-xl border border-border/80 bg-card shadow-none dark:border-border';

export function InvestigationDetailSurface({
  investigation,
  auditEntries,
  labels,
  canWrite,
  lifecycle,
  headerActions,
  onEdit,
  onShare,
  onAddParty,
  onEditParty,
  onRemoveParty,
  onAddEvidence,
  onRemoveEvidence,
  onRecordStatement,
  onGenerateReport,
  onOpenTimeline,
}: InvestigationDetailSurfaceProps) {
  const t = useInvestigationDetailSurfaceLabels();
  const f = useLexFormat();
  const parties = investigation.parties ?? [];
  const evidence = investigation.evidence ?? [];
  const metadata = investigation.metadata;
  const statusLabel =
    labels.filters.statusOptions[investigation.status] ??
    formatInvestigationToken(investigation.status);
  const timeline = buildDetailTimeline(investigation, auditEntries, t);

  const overview = [
    {
      label: t.investigationType,
      value:
        readMetadataString(metadata, ['investigation_type', 'type']) ??
        t.internalInvestigation,
    },
    {
      label: t.targetDivision,
      value: investigation.department?.trim() || t.notSet,
    },
    {
      label: t.openedDate,
      value: f.formatDate(investigation.created_at),
    },
    {
      label: t.leadInvestigator,
      value: investigation.lead_investigator?.trim() || t.notSet,
    },
    {
      label: t.estimatedCompletion,
      value: formatOptionalDate(
        readMetadataString(metadata, [
          'estimated_completion',
          'estimated_completion_date',
          'target_completion_date',
        ]),
        f.formatDate,
        t.notSet,
      ),
    },
    {
      label: t.currentPhase,
      value:
        readMetadataString(metadata, ['current_phase', 'phase']) ??
        statusLabel,
    },
  ];

  const confidentiality =
    readMetadataString(metadata, [
      'confidentiality_label',
      'confidentiality',
      'classification',
    ]) ?? t.confidentialityLevel;
  const confidentialityText =
    readMetadataString(metadata, [
      'confidentiality_note',
      'classification_note',
      'access_note',
    ]) ?? t.confidentialityText;

  return (
    <div className="space-y-6" data-testid="investigation-detail-surface">
      <header className="space-y-4">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          <Link href="/lex" className="transition-colors hover:text-foreground">
            {t.brand}
          </Link>
          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          <Link
            href="/lex/investigations"
            className="transition-colors hover:text-foreground"
          >
            {t.casesAndInvestigations}
          </Link>
          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          <span className="font-medium text-foreground" dir="ltr">
            {investigation.investigation_number}
          </span>
        </nav>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1
                className="font-mono text-3xl font-semibold tracking-tight text-foreground"
                dir="ltr"
              >
                {investigation.investigation_number}
              </h1>
              <StatusBadge
                status={investigation.priority}
                map={severityMap}
                label={labels.filters.priorityOptions[investigation.priority]}
                size="sm"
              />
              <StatusBadge
                status={investigation.status}
                map={caseStatusMap}
                label={labels.filters.statusOptions[investigation.status]}
                size="sm"
              />
            </div>
            <p className="text-lg text-muted-foreground" dir="auto">
              {investigation.subject}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canWrite ? (
              <Button type="button" variant="outline" onClick={onEdit}>
                <PencilLine className="me-2 h-4 w-4" aria-hidden />
                {t.editFile}
              </Button>
            ) : null}
            {headerActions}
            <Button type="button" onClick={onShare}>
              <Share2 className="me-2 h-4 w-4" aria-hidden />
              {t.shareAccess}
            </Button>
          </div>
        </div>
      </header>

      {lifecycle}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,2.15fr)_minmax(320px,.95fr)]">
        <main className="min-w-0 space-y-6">
          <DetailCard title={t.overview}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 2xl:grid-cols-6">
              {overview.map((item) => (
                <div key={item.label} className="min-w-0">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd
                    className="mt-1 break-words text-sm font-semibold leading-5 text-foreground"
                    dir="auto"
                  >
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </DetailCard>

          <DetailCard
            title={t.personsOfInterest}
            action={
              canWrite ? (
                <Button type="button" variant="ghost" size="sm" onClick={onAddParty}>
                  <Plus className="me-1.5 h-4 w-4" aria-hidden />
                  {t.addPerson}
                </Button>
              ) : undefined
            }
          >
            {parties.length === 0 ? (
              <EmptyDetailRow icon={<UserRoundSearch className="h-5 w-5" />} text={t.noPeople} />
            ) : (
              <ul className="space-y-3">
                {parties.map((party) => (
                  <li
                    key={party.id}
                    className="group flex min-w-0 items-center gap-3 rounded-lg bg-muted/35 px-4 py-3"
                  >
                    <InitialsAvatar name={party.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground" dir="auto">
                        {party.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" dir="auto">
                        {partySubtitle(party, labels)}
                      </p>
                    </div>
                    <Badge variant="neutral" size="sm" className="hidden sm:inline-flex">
                      {partyAccessLabel(party, t)}
                    </Badge>
                    {canWrite ? (
                      <div className="flex items-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => onEditParty(party)}
                          aria-label={`${t.editPerson}: ${party.name}`}
                          title={t.editPerson}
                        >
                          <PencilLine className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => onRemoveParty(party)}
                          aria-label={`${t.removePerson}: ${party.name}`}
                          title={t.removePerson}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DetailCard>

          <DetailCard
            title={t.evidenceChain}
            action={
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={onOpenTimeline}
                className="h-auto min-h-0 p-0 text-sm font-semibold"
              >
                {t.viewAllLogbook}
              </Button>
            }
          >
            {evidence.length === 0 ? (
              <EmptyDetailRow icon={<FileText className="h-5 w-5" />} text={t.noEvidence} />
            ) : (
              <ul className="space-y-3">
                {evidence.map((item, index) => (
                  <li
                    key={item.id}
                    className="group flex min-w-0 items-start gap-3 rounded-lg bg-muted/35 px-4 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground" dir="auto">
                        {evidenceLabel(item, index)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                        <span dir="auto">
                          <span className="font-medium text-foreground">{t.custodian}:</span>{' '}
                          {item.collected_by || t.notSet}
                        </span>
                        <span className="font-mono text-primary" dir="ltr">
                          {t.sha256}: {evidenceHash(item)}
                        </span>
                      </div>
                    </div>
                    <time
                      className="shrink-0 text-xs text-muted-foreground"
                      dateTime={item.collected_at || item.created_at}
                    >
                      {f.formatDate(item.collected_at || item.created_at)}
                    </time>
                    {canWrite ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-destructive opacity-100 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                        onClick={() => onRemoveEvidence(item)}
                        aria-label={`${t.removeEvidence}: ${item.title}`}
                        title={t.removeEvidence}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DetailCard>
        </main>

        <aside className="space-y-6 xl:sticky xl:top-6">
          <section
            className={cn(flatCardClass, 'border-2 border-primary/80 p-5')}
            aria-labelledby="investigation-confidentiality-title"
          >
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" aria-hidden />
              <h2
                id="investigation-confidentiality-title"
                className="text-sm font-bold uppercase tracking-wide"
              >
                {t.confidentialityTitle}
              </h2>
            </div>
            <p className="mt-3 text-sm leading-5 text-muted-foreground">
              <span className="font-semibold text-foreground">{confidentiality}.</span>{' '}
              {confidentialityText}
            </p>
          </section>

          <DetailCard title={t.quickActions}>
            <div className="space-y-3">
              <QuickAction
                icon={<FilePlus2 className="h-5 w-5" />}
                label={t.addEvidence}
                onClick={onAddEvidence}
                disabled={!canWrite}
              />
              <QuickAction
                icon={<CalendarDays className="h-5 w-5" />}
                label={t.scheduleWitness}
                onClick={onRecordStatement}
                disabled={!canWrite}
              />
              <QuickAction
                icon={<ClipboardList className="h-5 w-5" />}
                label={t.generateProgressReport}
                onClick={onGenerateReport}
                disabled={!canWrite}
              />
            </div>
          </DetailCard>

          <DetailCard title={t.timeline} contentClassName="pb-5">
            <ol className="relative">
              {timeline.map((entry, index) => (
                <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
                  <div className="flex w-3 shrink-0 flex-col items-center">
                    <span
                      className={cn(
                        'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-card',
                        entry.current ? 'bg-primary' : 'bg-border',
                      )}
                      aria-hidden
                    />
                    {index < timeline.length - 1 ? (
                      <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {entry.current ? t.currentStatus : f.formatDate(entry.date)}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold leading-5 text-foreground" dir="auto">
                      {entry.title}
                    </p>
                    {entry.description ? (
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground" dir="auto">
                        {entry.description}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </DetailCard>
        </aside>
      </div>
    </div>
  );
}

function DetailCard({
  title,
  action,
  children,
  contentClassName,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <section className={flatCardClass}>
      <div className="flex items-center justify-between gap-4 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      <div className={cn('px-5 pb-6 sm:px-6', contentClassName)}>{children}</div>
    </section>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      className="flex h-auto min-h-12 w-full items-center justify-start gap-3 rounded-lg bg-muted/35 px-4 py-3 text-start text-sm font-semibold text-primary shadow-none hover:bg-primary/10 hover:text-primary disabled:text-muted-foreground disabled:opacity-60"
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      <span>{label}</span>
    </Button>
  );
}

function EmptyDetailRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/35 px-4 py-5 text-sm text-muted-foreground">
      <span className="text-primary" aria-hidden>
        {icon}
      </span>
      <span>{text}</span>
    </div>
  );
}

function partySubtitle(party: InvestigationParty, labels: InvestigationLabels): string {
  const title = readMetadataString(party.metadata, ['title', 'job_title', 'position']);
  if (title) return title;
  if (party.contact?.trim()) return party.contact.trim();
  return labels.filters.roleOptions[party.role] ?? formatInvestigationToken(party.role);
}

function partyAccessLabel(
  party: InvestigationParty,
  labels: ReturnType<typeof useInvestigationDetailSurfaceLabels>,
): string {
  const raw = readMetadataString(party.metadata, ['access_level', 'access']);
  if (raw) return formatInvestigationToken(raw);
  if (party.role === 'subject') return labels.restrictedAccess;
  if (party.role === 'witness' || party.role === 'complainant') return labels.limitedAccess;
  if (party.role === 'other') return labels.noInternalAccess;
  return labels.restrictedAccess;
}

function evidenceLabel(item: InvestigationEvidence, index: number): string {
  const number = String(index + 1).padStart(2, '0');
  return `EVID-${number}: ${item.title}`;
}

function evidenceHash(item: InvestigationEvidence): string {
  const raw =
    readMetadataString(item.metadata, ['sha256', 'checksum', 'hash']) ??
    item.file_id ??
    item.id;
  if (raw.length <= 16) return raw;
  return `${raw.slice(0, 8)}…${raw.slice(-4)}`;
}

function formatOptionalDate(
  value: string | undefined,
  formatDate: (value: string) => string,
  fallback: string,
): string {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? formatDate(value) : value;
}

export function readMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[],
): string | undefined {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function buildDetailTimeline(
  investigation: Investigation,
  auditEntries: InvestigationAuditEntry[],
  labels: ReturnType<typeof useInvestigationDetailSurfaceLabels>,
): DetailTimelineEntry[] {
  const events: DetailTimelineEntry[] = [
    {
      id: `opened:${investigation.id}`,
      date: investigation.created_at,
      title: labels.openedEvent,
      description: investigation.subject,
    },
  ];

  for (const party of investigation.parties ?? []) {
    events.push({
      id: `party:${party.id}`,
      date: party.created_at,
      title: labels.partyAdded(party.name),
      description: party.contact || party.identifier || undefined,
    });
  }

  for (const item of investigation.evidence ?? []) {
    events.push({
      id: `evidence:${item.id}`,
      date: item.collected_at || item.created_at,
      title: labels.evidenceAdded(item.title),
      description: item.description || undefined,
    });
  }

  for (const statement of investigation.statements ?? []) {
    events.push({
      id: `statement:${statement.id}`,
      date: statement.taken_at || statement.created_at,
      title: labels.statementAdded(statement.deponent_name),
      description: statement.statement || undefined,
    });
  }

  for (const entry of auditEntries) {
    const normalizedAction = entry.action.toLowerCase();
    const representedByStructuredRecord =
      (normalizedAction.includes('party') && (investigation.parties?.length ?? 0) > 0) ||
      (normalizedAction.includes('statement') &&
        (investigation.statements?.length ?? 0) > 0) ||
      (normalizedAction.includes('evidence') && (investigation.evidence?.length ?? 0) > 0);
    if (representedByStructuredRecord) continue;

    const transition =
      entry.from_status || entry.to_status
        ? [entry.from_status, entry.to_status]
            .filter(Boolean)
            .map((value) => formatInvestigationToken(String(value)))
            .join(' → ')
        : undefined;
    events.push({
      id: `audit:${entry.id}`,
      date: entry.created_at,
      title:
        formatInvestigationToken(entry.action.replace(/[.:/]+/g, '_')) ||
        labels.updatedEvent,
      description: transition,
    });
  }

  const ordered = events
    .filter((entry) => Number.isFinite(new Date(entry.date).getTime()))
    .sort(
      (a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime() ||
        a.id.localeCompare(b.id),
    );
  const visible =
    ordered.length <= 5
      ? ordered
      : [ordered[0], ...ordered.slice(-4)];

  return [
    ...visible,
    {
      id: `current:${investigation.id}`,
      date: investigation.updated_at,
      title: formatInvestigationToken(investigation.status),
      description: readMetadataString(investigation.metadata, ['current_phase', 'phase']),
      current: true,
    },
  ];
}
