'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  CalendarDays,
  Download,
  FileSignature,
  FileText,
  Gavel,
  History,
  Info,
  ListChecks,
  Plus,
  Printer,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLexFormat } from '@/lib/lex/ksa';
import { useCaseUsers } from '../tabs/sessions/use-case-users';
import {
  casesApi,
  formatCaseToken,
  type CaseHearing,
  type CaseMilestone,
  type CaseMilestoneStatus,
  type CaseMilestoneType,
  type CaseTask,
  type LegalCase,
  type LegalCaseAuditEntry,
  type LegalDefendantCase,
  type LegalExpertAssignment,
  type LegalJudgment,
  type LegalPleading,
} from '@/lib/lex/cases';
import { cn } from '@/lib/utils';
import { showApiError, showSuccess } from '@/lib/toast';
import { useCaseLabels } from '../labels';
import { useDetailWorkspaceLabels } from './workspace-labels';

interface CaseTimelineTabProps {
  legalCase: LegalCase;
  title: string;
  hearings: CaseHearing[];
  tasks: CaseTask[];
  auditEntries: LegalCaseAuditEntry[];
  pleadings: LegalPleading[];
  experts: LegalExpertAssignment[];
  judgments: LegalJudgment[];
  defendantCases: LegalDefendantCase[];
  loading: boolean;
  error: boolean;
  plaintiffTrackEnabled: boolean;
  defendantTrackEnabled: boolean;
  canWrite: boolean;
  onRetry: () => void;
}

type TimelineKind =
  | 'metadata'
  | 'milestone'
  | 'hearing'
  | 'task'
  | 'audit'
  | 'pleading'
  | 'expert'
  | 'judgment'
  | 'defendant';
type TimelineKindFilter = TimelineKind | 'all';
type TimelineWindowFilter = 'all' | 'upcoming' | 'past' | 'next30' | 'next90';

const TIMELINE_KINDS: TimelineKind[] = [
  'metadata',
  'milestone',
  'hearing',
  'task',
  'audit',
  'pleading',
  'expert',
  'judgment',
  'defendant',
];

interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  date: string;
  title: string;
  description?: string;
  badge?: string;
  /** Real actor user-id (audit + case-created events only); resolved to a name. */
  actorUserId?: string;
  /** Real attached file names for this event, when the source hydrates them. */
  files?: string[];
}

export function CaseTimelineTab({
  legalCase,
  title,
  hearings,
  tasks,
  auditEntries,
  pleadings,
  experts,
  judgments,
  defendantCases,
  loading,
  error,
  plaintiffTrackEnabled,
  defendantTrackEnabled,
  canWrite,
  onRetry,
}: CaseTimelineTabProps) {
  const caseLabels = useCaseLabels();
  const labels = useDetailWorkspaceLabels();
  const f = useLexFormat();
  const users = useCaseUsers();
  const queryClient = useQueryClient();
  const t = labels.timeline;
  const [kindFilter, setKindFilter] = useState<TimelineKindFilter>('all');
  const [windowFilter, setWindowFilter] = useState<TimelineWindowFilter>('all');
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const milestonesQuery = useQuery({
    queryKey: ['lex-case-milestones', legalCase.id],
    queryFn: () => casesApi.listMilestones(legalCase.id),
    enabled: Boolean(legalCase.id),
  });
  const milestones = useMemo(() => milestonesQuery.data ?? [], [milestonesQuery.data]);
  const entries = useMemo(
    () =>
      buildTimelineEntries({
        legalCase,
        title,
        hearings,
        tasks,
        auditEntries,
        pleadings,
        experts,
        judgments,
        defendantCases,
        milestones,
        caseLabels,
        labels: t,
      }),
    [
      auditEntries,
      caseLabels,
      defendantCases,
      experts,
      hearings,
      judgments,
      legalCase,
      milestones,
      pleadings,
      t,
      tasks,
      title,
    ],
  );
  const filteredEntries = useMemo(
    () => filterTimelineEntries(entries, kindFilter, windowFilter),
    [entries, kindFilter, windowFilter],
  );
  const countsByKind = useMemo(() => countTimelineKinds(entries), [entries]);
  const { upcoming, history } = splitTimeline(filteredEntries);
  const noEvents = entries.length === 0 && !loading;
  const noFilteredEvents = entries.length > 0 && filteredEntries.length === 0 && !loading;

  return (
    <SectionCard
      title={t.title}
      description={t.description}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {loading || milestonesQuery.isLoading ? <Badge variant="outline">{t.loading}</Badge> : null}
          {canWrite ? (
            <Button size="sm" onClick={() => setMilestoneOpen(true)}>
              <Plus className="me-1.5 h-3.5 w-3.5" />
              {t.addMilestone}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              printTimeline({
                title,
                caseNumber: legalCase.case_number,
                entries: filteredEntries,
                formatDate: (date) => f.formatDual(date),
                actorName: (id) => users.nameOf(id),
              })
            }
            disabled={filteredEntries.length === 0}
          >
            <Printer className="me-1.5 h-3.5 w-3.5" />
            {t.exportPdf}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              exportTimelineCsv({
                title,
                caseNumber: legalCase.case_number,
                entries: filteredEntries,
                formatDate: (date) => f.formatDual(date),
                actorName: (id) => users.nameOf(id),
              })
            }
            disabled={filteredEntries.length === 0}
          >
            <Download className="me-1.5 h-3.5 w-3.5" />
            {t.exportCsv}
          </Button>
          {error ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="me-1.5 h-3.5 w-3.5" />
              {t.retry}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        {error ? (
          <div className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:text-warning-300">
            {t.partialError}
          </div>
        ) : null}
        {entries.length > 0 ? (
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  <span>{t.typeFilter}</span>
                  <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as TimelineKindFilter)}>
                    <SelectTrigger className="h-9 bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t.allTypes}</SelectItem>
                      {TIMELINE_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {timelineKindLabel(kind, t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  <span>{t.windowFilter}</span>
                  <Select value={windowFilter} onValueChange={(value) => setWindowFilter(value as TimelineWindowFilter)}>
                    <SelectTrigger className="h-9 bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t.allDates}</SelectItem>
                      <SelectItem value="upcoming">{t.upcomingOnly}</SelectItem>
                      <SelectItem value="past">{t.pastOnly}</SelectItem>
                      <SelectItem value="next30">{t.next30}</SelectItem>
                      <SelectItem value="next90">{t.next90}</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <Badge variant="outline">{t.showing(filteredEntries.length, entries.length)}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">{t.counts}</span>
              {TIMELINE_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={countsByKind[kind] === 0}
                  onClick={() => setKindFilter(kind)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-45',
                    kindFilter === kind && 'border-primary/40 bg-primary/10 text-primary',
                  )}
                >
                  <TimelineIcon kind={kind} />
                  <span>{timelineKindLabel(kind, t)}</span>
                  <span className="font-semibold">{countsByKind[kind]}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {loading && entries.length === 0 ? <LoadingSkeleton variant="list-item" count={4} /> : null}

        {noEvents ? (
          <EmptyState icon={Activity} title={t.emptyTitle} description={t.emptyDescription} />
        ) : noFilteredEvents ? (
          <EmptyState icon={Activity} title={t.emptyFilteredTitle} description={t.emptyFilteredDescription} />
        ) : (
          <>
            {upcoming.length > 0 ? (
              <TimelineSection title={t.upcoming} entries={upcoming} f={f} users={users} t={t} />
            ) : null}
            {history.length > 0 ? (
              <TimelineSection title={t.history} entries={history} f={f} users={users} t={t} />
            ) : null}
          </>
        )}

        {plaintiffTrackEnabled && !loading && pleadings.length === 0 && experts.length === 0 && judgments.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-4">
            <p className="text-sm font-semibold">{t.plaintiffTrack}</p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Placeholder label={t.noPleadings} icon={<FileSignature className="h-4 w-4" />} />
              <Placeholder label={t.noExperts} icon={<UserCheck className="h-4 w-4" />} />
              <Placeholder label={t.noJudgments} icon={<Gavel className="h-4 w-4" />} />
            </div>
          </div>
        ) : null}
        {defendantTrackEnabled && !loading && defendantCases.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-4">
            <p className="text-sm font-semibold">{caseLabels.defendant.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{caseLabels.defendant.emptyDescription}</p>
          </div>
        ) : null}
      </div>
      <MilestoneDialog
        caseId={legalCase.id}
        open={milestoneOpen}
        onOpenChange={setMilestoneOpen}
        onCreated={async () => {
          await queryClient.invalidateQueries({
            queryKey: ['lex-case-milestones', legalCase.id],
          });
        }}
      />
    </SectionCard>
  );
}

const MILESTONE_TYPES: CaseMilestoneType[] = [
  'filing',
  'hearing',
  'submission',
  'decision',
  'deadline',
  'custom',
];
const MILESTONE_STATUSES: CaseMilestoneStatus[] = ['planned', 'completed', 'cancelled'];

interface MilestoneDraft {
  title: string;
  description: string;
  milestone_type: CaseMilestoneType;
  status: CaseMilestoneStatus;
  milestone_date: string;
  source_reference: string;
}

function emptyMilestoneDraft(): MilestoneDraft {
  return {
    title: '',
    description: '',
    milestone_type: 'custom',
    status: 'completed',
    milestone_date: new Date().toISOString().slice(0, 16),
    source_reference: '',
  };
}

function MilestoneDialog({
  caseId,
  open,
  onOpenChange,
  onCreated,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const f = useLexFormat();
  const ar = f.locale === 'ar';
  const [draft, setDraft] = useState<MilestoneDraft>(() => emptyMilestoneDraft());
  const mutation = useMutation({
    mutationFn: () =>
      casesApi.createMilestone(caseId, {
        title: draft.title.trim(),
        description: draft.description.trim(),
        milestone_type: draft.milestone_type,
        status: draft.status,
        milestone_date: new Date(draft.milestone_date).toISOString(),
        completed_at:
          draft.status === 'completed' ? new Date(draft.milestone_date).toISOString() : null,
        source: 'manual',
        source_reference: draft.source_reference.trim() || null,
      }),
    onSuccess: async () => {
      showSuccess(ar ? 'تمت إضافة المحطة الرئيسية.' : 'Milestone added.');
      setDraft(emptyMilestoneDraft());
      onOpenChange(false);
      await onCreated();
    },
    onError: showApiError,
  });
  const valid = draft.title.trim() && draft.milestone_date;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{ar ? 'إضافة محطة رئيسية' : 'Add milestone'}</DialogTitle>
          <DialogDescription>
            {ar
              ? 'أضف حدثًا موثقًا إلى المسار الزمني للقضية.'
              : 'Add a persisted event to the case timeline.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="milestone-title">{ar ? 'العنوان' : 'Title'}</Label>
            <Input
              id="milestone-title"
              value={draft.title}
              onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
              placeholder={ar ? 'مثال: تقديم المذكرة النهائية' : 'e.g. Final brief submitted'}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="milestone-type">{ar ? 'نوع الحدث' : 'Event type'}</Label>
            <Select
              value={draft.milestone_type}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  milestone_type: value as CaseMilestoneType,
                }))
              }
            >
              <SelectTrigger id="milestone-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MILESTONE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {formatCaseToken(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="milestone-status">{ar ? 'الحالة' : 'Status'}</Label>
            <Select
              value={draft.status}
              onValueChange={(value) =>
                setDraft((current) => ({ ...current, status: value as CaseMilestoneStatus }))
              }
            >
              <SelectTrigger id="milestone-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MILESTONE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {formatCaseToken(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="milestone-date">{ar ? 'التاريخ والوقت' : 'Date and time'}</Label>
            <Input
              id="milestone-date"
              type="datetime-local"
              value={draft.milestone_date}
              onChange={(event) =>
                setDraft((value) => ({ ...value, milestone_date: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="milestone-attachment">
              {ar ? 'مرجع المرفق' : 'Attachment reference'}
            </Label>
            <Input
              id="milestone-attachment"
              value={draft.source_reference}
              onChange={(event) =>
                setDraft((value) => ({ ...value, source_reference: event.target.value }))
              }
              placeholder={ar ? 'اسم الملف أو رقمه المرجعي' : 'File name or reference'}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="milestone-description">{ar ? 'الوصف' : 'Description'}</Label>
            <Textarea
              id="milestone-description"
              rows={4}
              value={draft.description}
              onChange={(event) =>
                setDraft((value) => ({ ...value, description: event.target.value }))
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {ar ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button
            type="button"
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {ar ? 'إضافة' : 'Add milestone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TimelineSection({
  title,
  entries,
  f,
  users,
  t,
}: {
  title: string;
  entries: TimelineEntry[];
  f: ReturnType<typeof useLexFormat>;
  users: ReturnType<typeof useCaseUsers>;
  t: ReturnType<typeof useDetailWorkspaceLabels>['timeline'];
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-muted-foreground">{title}</p>
      <ol className="relative space-y-4 border-s ps-5">
        {entries.map((entry) => {
          const actorName = entry.actorUserId ? users.nameOf(entry.actorUserId) : null;
          return (
            <li key={entry.id} className="relative">
              <span className="absolute -start-[1.45rem] top-1 flex h-5 w-5 items-center justify-center rounded-full border bg-card text-primary">
                <TimelineIcon kind={entry.kind} />
              </span>
              <div className="rounded-lg border bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{entry.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="tabular-nums">{f.formatDate(entry.date)}</span>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{f.formatHijri(entry.date)}</span>
                      {actorName ? (
                        <>
                          <span aria-hidden>·</span>
                          <span dir="auto">{t.by(actorName)}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {entry.badge ? <Badge variant="outline">{entry.badge}</Badge> : null}
                </div>
                {entry.description ? (
                  <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{entry.description}</p>
                ) : null}
                {entry.files && entry.files.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entry.files.map((fileName, index) => (
                      <span
                        key={`${entry.id}-file-${index}`}
                        className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        <FileText className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate" dir="auto">
                          {fileName}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TimelineIcon({ kind }: { kind: TimelineKind }) {
  if (kind === 'milestone') return <ShieldCheck className="h-3 w-3" />;
  if (kind === 'hearing') return <CalendarDays className="h-3 w-3" />;
  if (kind === 'task') return <ListChecks className="h-3 w-3" />;
  if (kind === 'audit') return <History className="h-3 w-3" />;
  if (kind === 'pleading') return <FileSignature className="h-3 w-3" />;
  if (kind === 'expert') return <UserCheck className="h-3 w-3" />;
  if (kind === 'judgment') return <Gavel className="h-3 w-3" />;
  if (kind === 'defendant') return <ShieldCheck className="h-3 w-3" />;
  return <Info className="h-3 w-3" />;
}

function Placeholder({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
      <span className="text-primary">{icon}</span>
      {label}
    </div>
  );
}

function timelineKindLabel(kind: TimelineKind, labels: ReturnType<typeof useDetailWorkspaceLabels>['timeline']) {
  if (kind === 'metadata') return labels.metadata;
  if (kind === 'milestone') return labels.milestone;
  if (kind === 'hearing') return labels.hearing;
  if (kind === 'task') return labels.task;
  if (kind === 'audit') return labels.audit;
  if (kind === 'pleading') return labels.pleading;
  if (kind === 'expert') return labels.expert;
  if (kind === 'judgment') return labels.judgment;
  return labels.defendant;
}

function filterTimelineEntries(
  entries: TimelineEntry[],
  kindFilter: TimelineKindFilter,
  windowFilter: TimelineWindowFilter,
): TimelineEntry[] {
  const todayTime = todayStartTime();
  const next30 = todayTime + 30 * 86_400_000;
  const next90 = todayTime + 90 * 86_400_000;

  return entries.filter((entry) => {
    if (kindFilter !== 'all' && entry.kind !== kindFilter) return false;

    const entryTime = timestamp(entry.date);
    if (windowFilter === 'upcoming') return entryTime >= todayTime;
    if (windowFilter === 'past') return entryTime < todayTime;
    if (windowFilter === 'next30') return entryTime >= todayTime && entryTime <= next30;
    if (windowFilter === 'next90') return entryTime >= todayTime && entryTime <= next90;
    return true;
  });
}

function countTimelineKinds(entries: TimelineEntry[]): Record<TimelineKind, number> {
  const counts = Object.fromEntries(TIMELINE_KINDS.map((kind) => [kind, 0])) as Record<TimelineKind, number>;
  for (const entry of entries) {
    counts[entry.kind] += 1;
  }
  return counts;
}

/** Extract real attached-file names from a source's attachments/documents array. */
function fileNames(
  items: ReadonlyArray<{ file_name?: string | null }> | null | undefined,
): string[] | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const names = items
    .map((item) => item.file_name?.trim())
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names : undefined;
}

interface TimelineExportArgs {
  title: string;
  caseNumber: string;
  entries: TimelineEntry[];
  formatDate: (date: string) => string;
  actorName: (id: string) => string;
}

function printTimeline({ title, caseNumber, entries, formatDate, actorName }: TimelineExportArgs) {
  if (typeof window === 'undefined') return;

  const rows = entries
    .map((entry) => {
      const actor = entry.actorUserId ? ` · ${escapeHtml(actorName(entry.actorUserId))}` : '';
      const files = entry.files && entry.files.length > 0
        ? `<div class="files">${entry.files.map((name) => escapeHtml(name)).join(' · ')}</div>`
        : '';
      return `
        <li>
          <div class="meta">${escapeHtml(entry.kind)} · ${escapeHtml(formatDate(entry.date))}${actor}</div>
          <div class="title">${escapeHtml(entry.title)}</div>
          ${entry.badge ? `<div class="badge">${escapeHtml(entry.badge)}</div>` : ''}
          ${entry.description ? `<p>${escapeHtml(entry.description).replace(/\n/g, '<br />')}</p>` : ''}
          ${files}
        </li>
      `;
    })
    .join('');
  const documentHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)} timeline</title>
        <style>
          body { font-family: Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; margin: 32px; color: #06352F; }
          h1 { margin: 0; font-size: 22px; }
          .case { margin-top: 4px; color: #6C7874; font-size: 13px; }
          ol { margin-top: 24px; padding-left: 24px; }
          li { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #D1D8D5; }
          .meta { color: #6C7874; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
          .title { margin-top: 4px; font-weight: 700; }
          .badge { display: inline-block; margin-top: 6px; border: 1px solid #D1D8D5; border-radius: 999px; padding: 2px 8px; font-size: 11px; }
          .files { margin-top: 6px; color: #6C7874; font-size: 12px; }
          p { margin: 8px 0 0; white-space: normal; color: #06352F; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <div class="case">${escapeHtml(caseNumber)}</div>
        <ol>${rows}</ol>
      </body>
    </html>
  `;
  const printWindow = window.open('', '_blank', 'width=960,height=720');
  if (!printWindow) {
    window.print();
    return;
  }

  printWindow.opener = null;
  printWindow.document.write(documentHtml);
  printWindow.document.close();
  printWindow.focus();
  printWindow.setTimeout(() => printWindow.print(), 100);
}

function exportTimelineCsv({ title, caseNumber, entries, formatDate, actorName }: TimelineExportArgs) {
  if (typeof document === 'undefined') return;

  const rows = [
    ['type', 'title', 'date', 'actor', 'badge', 'description', 'files'],
    ...entries.map((entry) => [
      entry.kind,
      entry.title,
      formatDate(entry.date),
      entry.actorUserId ? actorName(entry.actorUserId) : '',
      entry.badge ?? '',
      entry.description ?? '',
      entry.files && entry.files.length > 0 ? entry.files.join(' | ') : '',
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitizeFilename(caseNumber || title || 'case')}-timeline-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFilename(value: string): string {
  return value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'case';
}

function buildTimelineEntries({
  legalCase,
  title,
  hearings,
  tasks,
  auditEntries,
  pleadings,
  experts,
  judgments,
  defendantCases,
  milestones,
  caseLabels,
  labels,
}: {
  legalCase: LegalCase;
  title: string;
  hearings: CaseHearing[];
  tasks: CaseTask[];
  auditEntries: LegalCaseAuditEntry[];
  pleadings: LegalPleading[];
  experts: LegalExpertAssignment[];
  judgments: LegalJudgment[];
  defendantCases: LegalDefendantCase[];
  milestones: CaseMilestone[];
  caseLabels: ReturnType<typeof useCaseLabels>;
  labels: ReturnType<typeof useDetailWorkspaceLabels>['timeline'];
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    {
      id: `case-created:${legalCase.id}`,
      kind: 'metadata',
      date: legalCase.created_at,
      title: labels.created,
      description: `${title} • ${legalCase.case_number || formatCaseToken(legalCase.case_type)}`,
      badge: caseLabels.filters.statusOptions[legalCase.status] ?? formatCaseToken(legalCase.status),
      actorUserId: legalCase.created_by || undefined,
    },
    {
      id: `case-updated:${legalCase.id}`,
      kind: 'metadata',
      date: legalCase.updated_at,
      title: labels.updated,
      description: legalCase.responsible_lawyer || legalCase.department || undefined,
      badge: caseLabels.filters.priorityOptions[legalCase.priority] ?? formatCaseToken(legalCase.priority),
    },
  ];

  for (const milestone of milestones) {
    entries.push({
      id: `milestone:${milestone.id}`,
      kind: 'milestone',
      date: milestone.milestone_date,
      title: milestone.title,
      description: milestone.description || undefined,
      badge: formatCaseToken(milestone.milestone_type),
      actorUserId: milestone.owner_id || milestone.created_by || undefined,
      files: milestone.source_reference ? [milestone.source_reference] : undefined,
    });
  }

  for (const hearing of hearings) {
    entries.push({
      id: `hearing:${hearing.id}`,
      kind: 'hearing',
      date: hearing.hearing_date,
      title: labels.hearing,
      description: [hearing.location, hearing.decision, hearing.notes].filter(Boolean).join('\n'),
    });
  }

  for (const task of tasks) {
    entries.push({
      id: `task:${task.id}`,
      kind: 'task',
      date: task.due_date || task.created_at,
      title: task.title,
      description: caseLabels.filters.taskStatusOptions[task.status] ?? formatCaseToken(task.status),
      badge: caseLabels.filters.priorityOptions[task.priority] ?? formatCaseToken(task.priority),
    });
  }

  for (const entry of auditEntries) {
    entries.push({
      id: `audit:${entry.id}`,
      kind: 'audit',
      date: entry.created_at,
      title: formatCaseToken(entry.action),
      description: entry.from_status || entry.to_status
        ? `${formatCaseToken(entry.from_status ?? '')} -> ${formatCaseToken(entry.to_status ?? '')}`
        : undefined,
      actorUserId: entry.actor_user_id || undefined,
    });
  }

  for (const pleading of pleadings) {
    entries.push({
      id: `pleading:${pleading.id}`,
      kind: 'pleading',
      date: pleading.filed_at || pleading.updated_at,
      title: pleading.title,
      description: pleading.pleading_number,
      badge: caseLabels.filters.pleadingStatusOptions[pleading.status] ?? formatCaseToken(pleading.status),
      files: fileNames(pleading.attachments),
    });
  }

  for (const expert of experts) {
    entries.push({
      id: `expert:${expert.id}`,
      kind: 'expert',
      date: expert.report_due_date || expert.appointed_at || expert.created_at,
      title: expert.expert_name,
      description: expert.specialization,
      badge: caseLabels.filters.expertStatusOptions[expert.status] ?? formatCaseToken(expert.status),
      files: fileNames(expert.documents),
    });
  }

  for (const judgment of judgments) {
    entries.push({
      id: `judgment:${judgment.id}`,
      kind: 'judgment',
      date: judgment.objection_deadline || judgment.judgment_date || judgment.created_at,
      title: judgment.judgment_ref,
      description: judgment.summary || judgment.study_notes || undefined,
      badge:
        caseLabels.filters.judgmentRecommendationOptions[judgment.recommendation] ??
        formatCaseToken(judgment.recommendation),
    });
  }

  for (const defendantCase of defendantCases) {
    const najiz = [
      caseLabels.filters.najizStatusOptions[defendantCase.najiz_status] ??
        formatCaseToken(defendantCase.najiz_status),
      defendantCase.najiz_reference,
    ].filter(Boolean).join(' • ');

    entries.push({
      id: `defendant:${defendantCase.id}:registered`,
      kind: 'defendant',
      date: defendantCase.notification_date || defendantCase.created_at,
      title: `${caseLabels.defendant.plaintiffName}: ${defendantCase.plaintiff_name}`,
      description: [
        defendantCase.court_name,
        najiz ? `${caseLabels.defendant.najizStatus}: ${najiz}` : undefined,
        defendantCase.concerned_department
          ? `${caseLabels.defendant.concernedDept}: ${defendantCase.concerned_department}`
          : undefined,
      ].filter(Boolean).join('\n'),
      badge:
        caseLabels.filters.defendantStatusOptions[defendantCase.status] ??
        formatCaseToken(defendantCase.status),
      files: fileNames(defendantCase.attachments),
    });

    if (defendantCase.dept_notified_at) {
      entries.push({
        id: `defendant:${defendantCase.id}:department`,
        kind: 'defendant',
        date: defendantCase.dept_notified_at,
        title: caseLabels.toast.deptNotified,
        description: defendantCase.concerned_department || undefined,
      });
    }

    if (defendantCase.response_approved_at) {
      entries.push({
        id: `defendant:${defendantCase.id}:approved`,
        kind: 'defendant',
        date: defendantCase.response_approved_at,
        title:
          caseLabels.filters.defendantStatusOptions.response_approved ??
          formatCaseToken('response_approved'),
        description: defendantCase.response_approved_by || undefined,
      });
    }
  }

  return entries.filter((entry) => Boolean(entry.date));
}

function splitTimeline(entries: TimelineEntry[]) {
  const todayTime = todayStartTime();
  const upcoming = entries
    .filter((entry) => timestamp(entry.date) >= todayTime)
    .sort((a, b) => timestamp(a.date) - timestamp(b.date));
  const history = entries
    .filter((entry) => timestamp(entry.date) < todayTime)
    .sort((a, b) => timestamp(b.date) - timestamp(a.date));
  return { upcoming, history };
}

function todayStartTime(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

function timestamp(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
