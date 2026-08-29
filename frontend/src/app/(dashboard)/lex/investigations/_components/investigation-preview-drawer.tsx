'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Bot,
  CalendarClock,
  FileSearch,
  Link2,
  ListChecks,
  UsersRound,
} from 'lucide-react';
import { RelativeTime } from '@/components/shared/relative-time';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatDateTime } from '@/lib/utils';
import {
  investigationsApi,
  type Investigation,
  type InvestigationStatus,
} from '@/lib/lex/investigations';
import {
  formatInvestigationToken,
  type InvestigationLabels,
  useInvestigationLabels,
} from './labels';

interface InvestigationPreviewDrawerProps {
  investigation: Investigation | null;
  onClose: () => void;
}

export function InvestigationPreviewDrawer({
  investigation,
  onClose,
}: InvestigationPreviewDrawerProps) {
  const labels = useInvestigationLabels();
  const detailQuery = useQuery({
    queryKey: ['lex-investigation-preview', investigation?.id],
    queryFn: () => investigationsApi.get(investigation?.id ?? ''),
    enabled: Boolean(investigation?.id),
    staleTime: 60_000,
  });

  const record = detailQuery.data ?? investigation;
  const latestKnownDate = useMemo(() => latestDate(record), [record]);
  const nextAction = record
    ? nextActionFor(
        record.status,
        {
          hasFindings: Boolean(record.findings?.trim()),
          hasRecommendations: Boolean(record.recommendations?.trim()),
          evidenceCount: Array.isArray(record.evidence) ? record.evidence.length : undefined,
        },
        labels,
      )
    : null;

  const statusLabel = record
    ? labels.filters.statusOptions[record.status] ?? formatInvestigationToken(record.status)
    : '';
  const priorityLabel = record
    ? labels.filters.priorityOptions[record.priority] ?? formatInvestigationToken(record.priority)
    : '';

  return (
    <Sheet
      open={Boolean(investigation)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-full overflow-hidden p-0 sm:max-w-2xl">
        {record ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-border/70 px-6 py-5">
              <SheetHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{record.investigation_number}</Badge>
                  <StatusBadge status={statusLabel} size="sm" />
                  <Badge
                    variant={
                      record.priority === 'critical' || record.priority === 'high'
                        ? 'destructive'
                        : record.priority === 'medium'
                          ? 'warning'
                          : 'secondary'
                    }
                  >
                    {priorityLabel}
                  </Badge>
                  {record.ai_drafted ? (
                    <Badge variant="outline">
                      <Bot className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      {labels.detail.aiBadge}
                    </Badge>
                  ) : null}
                </div>
                <div className="min-w-0 pe-8">
                  <SheetTitle className="truncate text-xl">{record.subject}</SheetTitle>
                  <SheetDescription>
                    {record.lead_investigator || labels.detail.notSet}
                  </SheetDescription>
                </div>
              </SheetHeader>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button type="button" asChild variant="outline" size="sm">
                  <Link href={`/lex/investigations/${record.id}`}>
                    {labels.preview.openRecord}
                    <ArrowUpRight className="ms-1.5 h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-5 px-6 py-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <PreviewField
                    label={labels.detail.metadata.lead}
                    value={record.lead_investigator}
                    fallback={labels.preview.notSet}
                  />
                  <PreviewField
                    label={labels.detail.metadata.department}
                    value={record.department || labels.detail.notSet}
                    fallback={labels.preview.notSet}
                  />
                  <PreviewField
                    label={labels.detail.metadata.linkedCase}
                    value={record.case_id || labels.detail.none}
                    icon={Link2}
                    mono={Boolean(record.case_id)}
                    fallback={labels.preview.notSet}
                  />
                  <PreviewField
                    label={labels.preview.nextAction}
                    value={nextAction ?? labels.detail.notSet}
                    icon={ListChecks}
                    fallback={labels.preview.notSet}
                  />
                  <PreviewField
                    label={labels.detail.metricParties}
                    value={countLabel(record.parties, detailQuery.isLoading, labels)}
                    icon={UsersRound}
                    fallback={labels.preview.notSet}
                  />
                  <PreviewField
                    label={labels.detail.metricEvidence}
                    value={countLabel(record.evidence, detailQuery.isLoading, labels)}
                    icon={FileSearch}
                    fallback={labels.preview.notSet}
                  />
                  <PreviewField
                    label={labels.preview.latestKnownDate}
                    value={latestKnownDate ? formatDateTime(latestKnownDate) : labels.detail.notSet}
                    icon={CalendarClock}
                    fallback={labels.preview.notSet}
                  />
                  <div className="rounded-lg border border-border/70 bg-card/60 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {labels.preview.updated}
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      <RelativeTime date={record.updated_at} />
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="grid gap-3">
                  <Snippet
                    label={labels.detail.findingsLabel}
                    value={record.findings}
                    empty={labels.detail.findingsEmpty}
                  />
                  <Snippet
                    label={labels.detail.recommendationsTitle}
                    value={record.recommendations}
                    empty={labels.detail.recommendationsEmpty}
                  />
                </div>
              </div>
            </ScrollArea>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function countLabel(
  items: unknown[] | undefined,
  loading: boolean,
  labels: InvestigationLabels,
): string {
  if (Array.isArray(items)) return items.length.toLocaleString();
  return loading ? labels.preview.loading : labels.preview.notAvailable;
}

function latestDate(record: Investigation | null | undefined): string | null {
  if (!record) return null;
  const candidates: Array<string | null | undefined> = [
    record.updated_at,
    record.created_at,
    ...(record.parties ?? []).map((item) => item.updated_at || item.created_at),
    ...(record.statements ?? []).flatMap((item) => [item.updated_at, item.taken_at, item.created_at]),
    ...(record.evidence ?? []).flatMap((item) => [
      item.updated_at,
      item.collected_at,
      item.created_at,
    ]),
  ];

  let newest: string | null = null;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const time = Date.parse(candidate);
    if (Number.isFinite(time) && time > newestTime) {
      newest = candidate;
      newestTime = time;
    }
  }
  return newest;
}

function nextActionFor(
  status: InvestigationStatus,
  context: {
    hasFindings: boolean;
    hasRecommendations: boolean;
    evidenceCount?: number;
  },
  labels: InvestigationLabels,
): string {
  const n = labels.preview.next;
  switch (status) {
    case 'registered':
      return n.beginFactGathering;
    case 'in_progress':
      if (context.evidenceCount === 0) return n.collectEvidence;
      return context.hasFindings ? n.recordRecommendations : n.recordFindings;
    case 'results_recorded':
      return context.hasRecommendations ? n.submitForApproval : n.recordRecommendations;
    case 'pending_approval':
      return n.awaitApprovalDecision;
    case 'approved':
      return n.closeInvestigation;
    case 'rejected':
      return n.reviseFindings;
    case 'closed':
      return n.closed;
    case 'cancelled':
      return n.cancelled;
    default:
      return formatInvestigationToken(status);
  }
}

function PreviewField({
  label,
  value,
  icon: Icon,
  mono = false,
  fallback,
}: {
  label: string;
  value: string;
  icon?: typeof Link2;
  mono?: boolean;
  fallback: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        <span>{label}</span>
      </div>
      <p className={mono ? 'mt-1 break-all font-mono text-xs' : 'mt-1 text-sm font-medium'}>
        {value || fallback}
      </p>
    </div>
  );
}

function Snippet({
  label,
  value,
  empty,
}: {
  label: string;
  value: string | null | undefined;
  empty: string;
}) {
  const resolved = value?.trim();
  return (
    <section className="rounded-lg border border-border/70 bg-card/60 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 max-h-36 overflow-hidden whitespace-pre-wrap text-sm leading-6 text-foreground">
        {resolved || empty}
      </p>
    </section>
  );
}
