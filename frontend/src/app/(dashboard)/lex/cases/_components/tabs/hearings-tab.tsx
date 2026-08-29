'use client';

/**
 * Court Sessions Management (إدارة جلسات المحاكمة) — the case detail "hearings"
 * tab, composed as: a sessions map/path, the next-session details, a
 * required-documents checklist for the next session, the previous-sessions log,
 * and quick actions (schedule / adjourn). Every session detail beyond the base
 * hearing columns (session type, required action, attendees, required documents,
 * adjournment) is persisted on the hearing's `metadata` JSONB, round-tripped by
 * the backend. Post-session minutes/decisions use the hearing-reports endpoints.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  PencilLine,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { resolveLocalized } from '@/lib/i18n/localized';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { SlaAgingBadge } from '@/components/lex/sla-aging-badge';
import { cn } from '@/lib/utils';
import { useLexFormat, isKsaHoliday } from '@/lib/lex/ksa';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  casesApi,
  HEARING_REPORT_TYPE_OPTIONS,
  formatCaseToken,
  type CaseHearing,
  type CaseHearingReport,
  type HearingReportType,
} from '@/lib/lex/cases';
import {
  SESSION_TYPES,
  useSessionsLabels,
  type SessionsLabels,
  type SessionType,
} from './sessions/sessions-i18n';
import {
  buildSessionMetadata,
  chronological,
  isPast,
  isToday,
  newId,
  nextSession,
  pastSessions,
  readSessionMeta,
  type RequiredDoc,
  type SessionMeta,
} from './sessions/session-model';
import { useCaseUsers } from './sessions/use-case-users';

interface HearingsTabProps {
  caseId: string;
  hearings: CaseHearing[];
  canWrite: boolean;
  onChanged: () => Promise<void> | void;
}

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

interface SessionFormState {
  hearing_date: string;
  session_type: SessionType | 'none';
  title: string;
  location: string;
  chamber: string;
  presiding_judge: string;
  presiding_judge_title: string;
  status: SessionMeta['status'];
  duration_minutes: string;
  required_action: string;
  agenda: string;
  attendees: string[];
  attendee_names: string[];
  notes: string;
  decision: string;
  required_documents: RequiredDoc[];
}

function emptyForm(): SessionFormState {
  return {
    hearing_date: '',
    session_type: 'none',
    title: '',
    location: '',
    chamber: '',
    presiding_judge: '',
    presiding_judge_title: '',
    status: 'scheduled',
    duration_minutes: '',
    required_action: '',
    agenda: '',
    attendees: [],
    attendee_names: [],
    notes: '',
    decision: '',
    required_documents: [],
  };
}

function formToPayload(state: SessionFormState, existingMetadata: CaseHearing['metadata']) {
  const meta: SessionMeta = {
    session_type: state.session_type === 'none' ? null : state.session_type,
    session_number: readSessionMeta({ metadata: existingMetadata } as CaseHearing).session_number,
    title: state.title.trim(),
    agenda: state.agenda.trim(),
    chamber: state.chamber.trim(),
    presiding_judge: state.presiding_judge.trim(),
    presiding_judge_title: state.presiding_judge_title.trim(),
    attendee_names: state.attendee_names,
    status: state.status,
    duration_minutes: state.duration_minutes ? Number(state.duration_minutes) : null,
    required_action: state.required_action.trim(),
    attendees: state.attendees,
    required_documents: state.required_documents,
    adjournment: readSessionMeta({ metadata: existingMetadata } as CaseHearing).adjournment,
  };
  return {
    hearing_date: new Date(state.hearing_date).toISOString(),
    location: state.location.trim() || null,
    notes: state.notes.trim(),
    decision: state.decision.trim() || null,
    metadata: buildSessionMetadata(existingMetadata, meta),
  };
}

export function HearingsTab({ caseId, hearings, canWrite, onChanged }: HearingsTabProps) {
  const t = useSessionsLabels();
  const f = useLexFormat();
  const queryClient = useQueryClient();
  const users = useCaseUsers();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CaseHearing | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CaseHearing | null>(null);
  const [reportHearing, setReportHearing] = useState<CaseHearing | null>(null);
  const [adjournOpen, setAdjournOpen] = useState(false);

  const ordered = useMemo(() => chronological(hearings), [hearings]);
  const next = useMemo(() => nextSession(hearings), [hearings]);
  const past = useMemo(() => pastSessions(hearings), [hearings]);

  const refresh = async () => {
    await Promise.all([
      onChanged(),
      queryClient.invalidateQueries({ queryKey: ['lex-case', caseId] }),
    ]);
  };

  const addMutation = useMutation({
    mutationFn: (state: SessionFormState) => casesApi.addHearing(caseId, formToPayload(state, {})),
    onSuccess: async () => {
      showSuccess(t.toast.added);
      setAddOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const editMutation = useMutation({
    mutationFn: (input: { id: string; state: SessionFormState; existing: CaseHearing['metadata'] }) =>
      casesApi.updateHearing(caseId, input.id, formToPayload(input.state, input.existing)),
    onSuccess: async () => {
      showSuccess(t.toast.updated);
      setEditTarget(null);
      await refresh();
    },
    onError: showApiError,
  });

  const removeMutation = useMutation({
    mutationFn: (hearingId: string) => casesApi.deleteHearing(caseId, hearingId),
    onSuccess: async () => {
      showSuccess(t.toast.removed);
      setRemoveTarget(null);
      await refresh();
    },
    onError: showApiError,
  });

  // Required-documents checklist mutation (read-merge-write on the next session).
  const docsMutation = useMutation({
    mutationFn: (input: { hearing: CaseHearing; docs: RequiredDoc[] }) => {
      const meta = { ...readSessionMeta(input.hearing), required_documents: input.docs };
      return casesApi.updateHearing(caseId, input.hearing.id, {
        metadata: buildSessionMetadata(input.hearing.metadata, meta),
      });
    },
    onSuccess: async () => {
      showSuccess(t.toast.docsUpdated);
      await refresh();
    },
    onError: showApiError,
  });

  const adjournMutation = useMutation({
    mutationFn: async (input: { hearing: CaseHearing; newDate: string; reason: string; followUp: boolean }) => {
      const current = readSessionMeta(input.hearing);
      const toIso = input.newDate ? new Date(input.newDate).toISOString() : undefined;
      await casesApi.updateHearing(caseId, input.hearing.id, {
        metadata: buildSessionMetadata(input.hearing.metadata, {
          ...current,
          adjournment: {
            from_date: input.hearing.hearing_date,
            to_date: toIso,
            reason: input.reason.trim(),
            at: new Date().toISOString(),
          },
        }),
      });
      if (input.followUp && toIso) {
        await casesApi.addHearing(caseId, {
          hearing_date: toIso,
          location: input.hearing.location ?? null,
          notes: '',
          decision: null,
          metadata: buildSessionMetadata(
            {},
            {
              ...current,
              required_action: current.required_action,
              attendees: current.attendees,
              required_documents: current.required_documents.map((d) => ({ ...d, id: newId(), provided: false })),
              adjournment: null,
            },
          ),
        });
      }
    },
    onSuccess: async () => {
      showSuccess(t.toast.adjourned);
      setAdjournOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const headerAction = canWrite ? (
    <Button size="sm" onClick={() => setAddOpen(true)}>
      <CalendarPlus className="me-1.5 h-3.5 w-3.5" aria-hidden />
      {t.quick.addSession}
    </Button>
  ) : undefined;

  if (hearings.length === 0) {
    return (
      <SectionCard title={t.next.title} description={t.map.title} actions={headerAction}>
        <EmptyState icon={CalendarDays} title={t.emptyTitle} description={t.emptyDescription} />
        <SessionFormDialog
          open={addOpen}
          mode="add"
          initial={emptyForm()}
          saving={addMutation.isPending}
          labels={t}
          onCancel={() => setAddOpen(false)}
          onSubmit={(state) => addMutation.mutate(state)}
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <SessionsMap sessions={ordered} nextId={next?.id ?? null} labels={t} f={f} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <NextSessionCard hearing={next} labels={t} f={f} users={users} />
          <PastSessionsCard sessions={past} labels={t} f={f} />
        </div>
        <div className="space-y-4">
          <RequiredDocsCard
            hearing={next}
            canWrite={canWrite}
            saving={docsMutation.isPending}
            labels={t}
            onChange={(docs) => {
              if (next) docsMutation.mutate({ hearing: next, docs });
            }}
          />
          <QuickActionsCard
            canWrite={canWrite}
            hasNext={Boolean(next)}
            labels={t}
            onAdd={() => setAddOpen(true)}
            onAdjourn={() => setAdjournOpen(true)}
          />
        </div>
      </div>

      {/* Full Figma-aligned session workspace with live statistics/calendar. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <SectionCard title={t.past.title} description={t.map.title}>
          <div className="space-y-3">
            {chronological(hearings)
              .slice()
              .reverse()
              .map((hearing) => (
                <SessionRow
                  key={hearing.id}
                  hearing={hearing}
                  isNext={hearing.id === next?.id}
                  canWrite={canWrite}
                  labels={t}
                  f={f}
                  users={users}
                  onReports={() => setReportHearing(hearing)}
                  onEdit={() => setEditTarget(hearing)}
                  onRemove={() => setRemoveTarget(hearing)}
                />
              ))}
          </div>
        </SectionCard>
        <SessionInsights hearings={hearings} labels={t} f={f} />
      </div>

      {/* Dialogs */}
      <SessionFormDialog
        open={addOpen}
        mode="add"
        initial={emptyForm()}
        saving={addMutation.isPending}
        labels={t}
        onCancel={() => setAddOpen(false)}
        onSubmit={(state) => addMutation.mutate(state)}
      />
      <SessionFormDialog
        open={Boolean(editTarget)}
        mode="edit"
        initial={editTarget ? hearingToForm(editTarget) : emptyForm()}
        saving={editMutation.isPending}
        labels={t}
        onCancel={() => setEditTarget(null)}
        onSubmit={(state) => {
          if (editTarget) {
            editMutation.mutate({ id: editTarget.id, state, existing: editTarget.metadata });
          }
        }}
      />
      <AdjournDialog
        open={adjournOpen}
        target={next}
        saving={adjournMutation.isPending}
        labels={t}
        f={f}
        onCancel={() => setAdjournOpen(false)}
        onConfirm={(newDate, reason, followUp) => {
          if (next) adjournMutation.mutate({ hearing: next, newDate, reason, followUp });
        }}
      />
      <HearingReportsDialog
        caseId={caseId}
        hearing={reportHearing}
        canWrite={canWrite}
        labels={t}
        onOpenChange={(open) => {
          if (!open) setReportHearing(null);
        }}
      />
      {canWrite ? (
        <ConfirmDialog
          open={Boolean(removeTarget)}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
          title={t.confirmRemove.title}
          description={t.confirmRemove.description}
          confirmLabel={t.remove}
          variant="destructive"
          loading={removeMutation.isPending}
          onConfirm={async () => {
            if (removeTarget) await removeMutation.mutateAsync(removeTarget.id);
          }}
        />
      ) : null}
    </div>
  );
}

function hearingToForm(hearing: CaseHearing): SessionFormState {
  const meta = readSessionMeta(hearing);
  return {
    hearing_date: toDateTimeLocal(hearing.hearing_date),
    session_type: meta.session_type ?? 'none',
    title: meta.title,
    location: hearing.location ?? '',
    chamber: meta.chamber,
    presiding_judge: meta.presiding_judge,
    presiding_judge_title: meta.presiding_judge_title,
    status: meta.status,
    duration_minutes: meta.duration_minutes == null ? '' : String(meta.duration_minutes),
    required_action: meta.required_action,
    agenda: meta.agenda,
    attendees: meta.attendees,
    attendee_names: meta.attendee_names,
    notes: hearing.notes ?? '',
    decision: hearing.decision ?? '',
    required_documents: meta.required_documents,
  };
}

/* ------------------------------------------------------------------------- *
 * Sessions map / path
 * ------------------------------------------------------------------------- */

function SessionsMap({
  sessions,
  nextId,
  labels,
  f,
}: {
  sessions: CaseHearing[];
  nextId: string | null;
  labels: SessionsLabels;
  f: ReturnType<typeof useLexFormat>;
}) {
  return (
    <SectionCard title={labels.map.title}>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-stretch">
          {sessions.map((hearing, index) => {
            const meta = readSessionMeta(hearing);
            const past = isPast(hearing.hearing_date);
            const isNext = hearing.id === nextId;
            const typeLabel = meta.session_type ? labels.sessionTypes[meta.session_type] : labels.next.badge;
            return (
              <div key={hearing.id} className="flex flex-col items-center" style={{ minWidth: '9.5rem' }}>
                <div className="flex w-full items-center">
                  <span
                    className={cn('h-0.5 flex-1', index === 0 ? 'opacity-0' : 'bg-border')}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-caption font-bold',
                      past
                        ? 'border-success-500 bg-success-500 text-white'
                        : isNext
                          ? 'border-primary bg-primary/10 text-primary ring-4 ring-primary/15'
                          : 'border-border bg-card text-muted-foreground',
                    )}
                  >
                    {past ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : f.formatNumber(index + 1)}
                  </span>
                  <span
                    className={cn('h-0.5 flex-1', index === sessions.length - 1 ? 'opacity-0' : 'bg-border')}
                    aria-hidden
                  />
                </div>
                <div className="mt-2 max-w-[9rem] px-1 text-center">
                  <p
                    className={cn(
                      'truncate text-caption font-semibold',
                      isNext ? 'text-primary' : 'text-foreground',
                    )}
                    title={typeLabel}
                  >
                    {typeLabel}
                  </p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {f.formatDate(hearing.hearing_date)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {labels.map.hijri} · {f.formatHijri(hearing.hearing_date)}
                  </p>
                  {past ? (
                    <Badge variant="secondary" className="mt-1">
                      {labels.map.done}
                    </Badge>
                  ) : isNext ? (
                    <Badge variant="default" className="mt-1">
                      {labels.map.next}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="mt-1">
                      {labels.map.upcoming}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Next session details
 * ------------------------------------------------------------------------- */

function NextSessionCard({
  hearing,
  labels,
  f,
  users,
}: {
  hearing: CaseHearing | null;
  labels: SessionsLabels;
  f: ReturnType<typeof useLexFormat>;
  users: ReturnType<typeof useCaseUsers>;
}) {
  if (!hearing) {
    return (
      <SectionCard title={labels.next.title}>
        <p className="text-body-sm text-muted-foreground">{labels.next.none}</p>
      </SectionCard>
    );
  }
  const meta = readSessionMeta(hearing);
  const holiday = isKsaHoliday(hearing.hearing_date);
  const typeLabel = meta.session_type ? labels.sessionTypes[meta.session_type] : labels.next.badge;

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" aria-hidden />
          {labels.next.title}
        </span>
      }
      actions={<Badge variant="warning">{typeLabel}</Badge>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-h4 font-bold tabular-nums text-foreground">
            {f.formatDate(hearing.hearing_date)}
          </span>
          <Badge variant="secondary">
            {labels.map.hijri} · {f.formatHijri(hearing.hearing_date)}
          </Badge>
          {isToday(hearing.hearing_date) ? <Badge variant="warning">{labels.badges.today}</Badge> : null}
          {holiday ? (
            <Badge variant="destructive">
              {labels.badges.holiday}
              {holiday.name ? ` · ${resolveLocalized(holiday.name, f.locale)}` : ''}
            </Badge>
          ) : null}
          <SlaAgingBadge dueAt={hearing.hearing_date} size="sm" />
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field icon={Building2} label={labels.next.court} value={hearing.location?.trim() || labels.next.noCourt} />
          <Field icon={ClipboardList} label={labels.next.requiredAction} value={meta.required_action || labels.next.noAction} />
        </dl>

        <div>
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-caption uppercase tracking-label text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {labels.next.team}
          </p>
          {meta.attendees.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{labels.next.noTeam}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {meta.attendees.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 py-1 pe-3 ps-1"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                    {users.initialsOf(id)}
                  </span>
                  <span className="text-caption font-medium text-foreground" dir="auto">
                    {users.nameOf(id)}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {hearing.notes?.trim() ? (
          <p className="whitespace-pre-line rounded-lg bg-muted/30 px-3 py-2 text-body-sm text-muted-foreground" dir="auto">
            {hearing.notes}
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}

function Field({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="inline-flex items-center gap-1.5 text-caption uppercase tracking-label text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </dt>
      <dd className="mt-0.5 text-body-sm font-medium text-foreground" dir="auto">
        {value}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Required documents for the next session
 * ------------------------------------------------------------------------- */

function RequiredDocsCard({
  hearing,
  canWrite,
  saving,
  labels,
  onChange,
}: {
  hearing: CaseHearing | null;
  canWrite: boolean;
  saving: boolean;
  labels: SessionsLabels;
  onChange: (docs: RequiredDoc[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const docs = hearing ? readSessionMeta(hearing).required_documents : [];
  const doneCount = docs.filter((d) => d.provided).length;

  const add = () => {
    const label = draft.trim();
    if (!label || !hearing) return;
    onChange([...docs, { id: newId(), label, provided: false }]);
    setDraft('');
  };

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" aria-hidden />
          {labels.requiredDocs.title}
        </span>
      }
      description={labels.requiredDocs.forNext}
      actions={
        docs.length > 0 ? (
          <Badge variant="secondary" className="tabular-nums">
            {labels.requiredDocs.progress(String(doneCount), String(docs.length))}
          </Badge>
        ) : undefined
      }
    >
      {!hearing ? (
        <p className="text-body-sm text-muted-foreground">{labels.next.none}</p>
      ) : (
        <div className="space-y-2.5">
          {docs.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{labels.requiredDocs.empty}</p>
          ) : (
            <ul className="space-y-2">
              {docs.map((doc) => {
                const id = `reqdoc-${doc.id}`;
                return (
                  <li
                    key={doc.id}
                    className="flex items-start gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5"
                  >
                    <Checkbox
                      id={id}
                      checked={doc.provided}
                      disabled={!canWrite || saving}
                      onCheckedChange={(v) =>
                        onChange(docs.map((d) => (d.id === doc.id ? { ...d, provided: v === true } : d)))
                      }
                      className="mt-0.5"
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                      <span
                        className={cn(
                          'block text-body-sm',
                          doc.provided ? 'text-muted-foreground line-through' : 'text-foreground',
                        )}
                        dir="auto"
                      >
                        {doc.label}
                      </span>
                      <span className={cn('text-caption', doc.provided ? 'text-success-600 dark:text-success-400' : 'text-muted-foreground')}>
                        {doc.provided ? labels.requiredDocs.provided : labels.requiredDocs.pending}
                      </span>
                    </label>
                    {canWrite ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-error-600"
                        disabled={saving}
                        aria-label={labels.requiredDocs.remove}
                        onClick={() => onChange(docs.filter((d) => d.id !== doc.id))}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {canWrite ? (
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add();
                  }
                }}
                placeholder={labels.requiredDocs.addPlaceholder}
                className="h-8"
                disabled={saving}
              />
              <Button type="button" size="sm" variant="outline" onClick={add} disabled={!draft.trim() || saving}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Previous sessions log
 * ------------------------------------------------------------------------- */

interface PastSessionVM extends Record<string, unknown> {
  id: string;
  dateLabel: string;
  hijriLabel: string;
  sessionType: SessionType | null;
  adjourned: boolean;
  outcome: string;
  hasOutcome: boolean;
  nextAction: string;
}

function PastSessionsCard({
  sessions,
  labels,
  f,
}: {
  sessions: CaseHearing[];
  labels: SessionsLabels;
  f: ReturnType<typeof useLexFormat>;
}) {
  const rows = useMemo<PastSessionVM[]>(
    () =>
      sessions.map((hearing) => {
        const meta = readSessionMeta(hearing);
        const outcome = hearing.decision?.trim() || hearing.notes?.trim() || '';
        return {
          id: hearing.id,
          dateLabel: f.formatDate(hearing.hearing_date),
          hijriLabel: f.formatHijri(hearing.hearing_date),
          sessionType: meta.session_type,
          adjourned: Boolean(meta.adjournment),
          outcome: outcome || labels.past.noOutcome,
          hasOutcome: Boolean(outcome),
          nextAction: meta.required_action || labels.past.noNextAction,
        };
      }),
    [sessions, f, labels.past.noOutcome, labels.past.noNextAction],
  );

  const columns: Column<PastSessionVM>[] = [
    {
      key: 'dateLabel',
      header: labels.past.columns.date,
      render: (item) => (
        <div>
          <p className="text-body-sm font-medium tabular-nums text-foreground">{item.dateLabel}</p>
          <p className="text-[11px] text-muted-foreground">{item.hijriLabel}</p>
        </div>
      ),
    },
    {
      key: 'sessionType',
      header: labels.past.columns.type,
      render: (item) => (
        <span className="text-body-sm text-muted-foreground">
          {item.sessionType ? labels.sessionTypes[item.sessionType] : '—'}
          {item.adjourned ? (
            <Badge variant="warning" className="ms-1.5">
              {labels.badges.adjourned}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'outcome',
      header: labels.past.columns.outcome,
      render: (item) => (
        <span className={cn('text-body-sm', item.hasOutcome ? 'text-foreground' : 'text-muted-foreground')} dir="auto">
          {item.outcome}
        </span>
      ),
    },
    {
      key: 'nextAction',
      header: labels.past.columns.nextAction,
      render: (item) => (
        <span className="text-body-sm text-muted-foreground" dir="auto">
          {item.nextAction}
        </span>
      ),
    },
  ];

  return (
    <SectionCard title={labels.past.title}>
      <SimpleTable<PastSessionVM>
        columns={columns}
        data={rows}
        emptyMessage={labels.past.empty}
        ariaLabel={labels.past.title}
        getRowKey={(item) => item.id}
      />
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Quick actions
 * ------------------------------------------------------------------------- */

function QuickActionsCard({
  canWrite,
  hasNext,
  labels,
  onAdd,
  onAdjourn,
}: {
  canWrite: boolean;
  hasNext: boolean;
  labels: SessionsLabels;
  onAdd: () => void;
  onAdjourn: () => void;
}) {
  if (!canWrite) return null;
  return (
    <SectionCard title={labels.quick.title}>
      <div className="space-y-2">
        <Button className="w-full justify-start" onClick={onAdd}>
          <CalendarPlus className="me-2 h-4 w-4" aria-hidden />
          {labels.quick.addSession}
        </Button>
        <Button variant="outline" className="w-full justify-start" onClick={onAdjourn} disabled={!hasNext}>
          <CalendarClock className="me-2 h-4 w-4" aria-hidden />
          {labels.quick.adjourn}
        </Button>
      </div>
    </SectionCard>
  );
}

function SessionInsights({
  hearings,
  labels,
  f,
}: {
  hearings: CaseHearing[];
  labels: SessionsLabels;
  f: ReturnType<typeof useLexFormat>;
}) {
  const ar = f.locale === 'ar';
  const now = Date.now();
  const completed = hearings.filter((hearing) => {
    const meta = readSessionMeta(hearing);
    return meta.status === 'completed' || new Date(hearing.hearing_date).getTime() < now;
  });
  const upcoming = chronological(hearings).filter(
    (hearing) =>
      new Date(hearing.hearing_date).getTime() >= now &&
      !['completed', 'cancelled'].includes(readSessionMeta(hearing).status ?? ''),
  );
  const durations = completed
    .map((hearing) => readSessionMeta(hearing).duration_minutes)
    .filter((value): value is number => value != null && value > 0);
  const average = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
    : null;
  const next = upcoming[0] ?? null;
  const nextTime = next ? new Date(next.hearing_date).getTime() : null;
  const countdownHours = nextTime == null ? null : Math.max(0, Math.ceil((nextTime - now) / 3_600_000));
  const countdown =
    countdownHours == null
      ? ar
        ? 'لا توجد جلسة قادمة'
        : 'No upcoming session'
      : ar
        ? `${f.formatNumber(Math.floor(countdownHours / 24))} يوم، ${f.formatNumber(countdownHours % 24)} ساعة`
        : `${Math.floor(countdownHours / 24)} days, ${countdownHours % 24} hours`;

  return (
    <aside className="space-y-4">
      <SectionCard title={ar ? 'إحصاءات الجلسات' : 'Session statistics'}>
        <dl className="space-y-3 text-sm">
          <StatRow
            label={ar ? 'إجمالي الجلسات المجدولة' : 'Total scheduled sessions'}
            value={f.formatNumber(hearings.length)}
          />
          <StatRow
            label={ar ? 'الجلسات المنعقدة' : 'Completed hearings'}
            value={f.formatNumber(completed.length)}
            tone="success"
          />
          <StatRow
            label={ar ? 'الجلسات القادمة' : 'Upcoming hearings'}
            value={f.formatNumber(upcoming.length)}
            tone="warning"
          />
          <StatRow
            label={ar ? 'متوسط مدة الجلسة' : 'Average session duration'}
            value={
              average == null
                ? '—'
                : ar
                  ? `${f.formatNumber(average)} دقيقة`
                  : `${average} min`
            }
          />
        </dl>
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            {ar ? 'الوقت المتبقي للجلسة القادمة' : 'Next session countdown'}
          </p>
          <p className="mt-1 text-sm font-bold text-warning-700 dark:text-warning-300">
            {countdown}
          </p>
        </div>
      </SectionCard>
      <SessionCalendar hearings={hearings} labels={labels} f={f} />
    </aside>
  );
}

function StatRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning';
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'font-bold tabular-nums',
          tone === 'success' && 'text-success-700 dark:text-success-300',
          tone === 'warning' && 'text-warning-700 dark:text-warning-300',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function SessionCalendar({
  hearings,
  labels,
  f,
}: {
  hearings: CaseHearing[];
  labels: SessionsLabels;
  f: ReturnType<typeof useLexFormat>;
}) {
  const reference = nextSession(hearings)?.hearing_date ?? chronological(hearings)[0]?.hearing_date;
  const month = reference ? new Date(reference) : new Date();
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const previousMonthDays = new Date(year, monthIndex, 0).getDate();
  const hearingDays = new Set(
    hearings
      .map((hearing) => new Date(hearing.hearing_date))
      .filter((date) => date.getFullYear() === year && date.getMonth() === monthIndex)
      .map((date) => date.getDate()),
  );
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstDay + 1;
    if (day < 1) return { day: previousMonthDays + day, muted: true };
    if (day > daysInMonth) return { day: day - daysInMonth, muted: true };
    return { day, muted: false };
  });
  const weekdays =
    f.locale === 'ar' ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const monthLabel = new Intl.DateTimeFormat(f.locale === 'ar' ? 'ar-SA' : 'en-US', {
    month: 'long',
    year: 'numeric',
  }).format(month);

  return (
    <SectionCard
      title={f.locale === 'ar' ? 'تقويم الجلسات' : 'Session calendar'}
      actions={<Badge variant="outline">{monthLabel}</Badge>}
    >
      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdays.map((day, index) => (
          <span key={`${day}-${index}`} className="py-1 text-[10px] font-bold text-muted-foreground">
            {day}
          </span>
        ))}
        {cells.map((cell, index) => {
          const active = !cell.muted && hearingDays.has(cell.day);
          return (
            <span
              key={`${cell.day}-${index}`}
              className={cn(
                'flex aspect-square items-center justify-center rounded-full text-xs tabular-nums',
                cell.muted && 'text-muted-foreground/40',
                active && 'bg-primary font-bold text-primary-foreground',
              )}
              aria-label={
                active
                  ? `${labels.map.title}: ${f.formatNumber(cell.day)}`
                  : f.formatNumber(cell.day)
              }
            >
              {f.formatNumber(cell.day)}
            </span>
          );
        })}
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Single session row (full list, with per-session actions)
 * ------------------------------------------------------------------------- */

function SessionRow({
  hearing,
  isNext,
  canWrite,
  labels,
  f,
  users,
  onReports,
  onEdit,
  onRemove,
}: {
  hearing: CaseHearing;
  isNext: boolean;
  canWrite: boolean;
  labels: SessionsLabels;
  f: ReturnType<typeof useLexFormat>;
  users: ReturnType<typeof useCaseUsers>;
  onReports: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const meta = readSessionMeta(hearing);
  const past = isPast(hearing.hearing_date);
  const accent = past ? 'bg-muted-foreground/40' : isNext ? 'bg-primary' : 'bg-sky-400/70';
  const typeLabel = meta.session_type ? labels.sessionTypes[meta.session_type] : null;
  const status = meta.status || (past ? 'completed' : isNext ? 'upcoming' : 'scheduled');
  const sessionTitle = meta.title || typeLabel || labels.next.badge;
  const attendeeNames = [
    ...meta.attendees.map((id) => users.nameOf(id)),
    ...meta.attendee_names,
  ].filter(Boolean);

  return (
    <article className="relative overflow-hidden rounded-xl border border-border/80 bg-card px-4 py-4 ps-5 shadow-elevation-1">
      <span className={cn('absolute inset-y-0 start-0 w-1', accent)} aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {meta.session_number
                ? `#${f.formatNumber(meta.session_number)}`
                : typeLabel || labels.next.badge}
            </Badge>
            <h3 className="text-sm font-bold text-foreground" dir="auto">
              {sessionTitle}
            </h3>
            <Badge variant={status === 'completed' ? 'secondary' : status === 'upcoming' ? 'warning' : 'outline'}>
              {formatCaseToken(status)}
            </Badge>
            {meta.adjournment ? <Badge variant="warning">{labels.badges.adjourned}</Badge> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onReports}>
            <FileText className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {labels.reports}
          </Button>
          {canWrite ? (
            <>
              <Button size="sm" variant="outline" onClick={onEdit}>
                <PencilLine className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {labels.edit}
              </Button>
              <Button size="sm" variant="outline" onClick={onRemove}>
                <Trash2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {labels.remove}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 border-b border-border pb-4 sm:grid-cols-3">
        <SessionFact
          label={f.locale === 'ar' ? 'التاريخ والوقت' : 'Time & date'}
          value={`${f.formatHijri(hearing.hearing_date)} · ${f.formatDate(hearing.hearing_date)}`}
        />
        <SessionFact
          label={f.locale === 'ar' ? 'المحكمة والدائرة' : 'Court & chamber'}
          value={[hearing.location, meta.chamber].filter(Boolean).join(' · ')}
        />
        <SessionFact
          label={f.locale === 'ar' ? 'القاضي رئيس الجلسة' : 'Presiding judge'}
          value={[meta.presiding_judge, meta.presiding_judge_title].filter(Boolean).join(' · ')}
        />
      </dl>
      {meta.agenda || hearing.decision || hearing.notes ? (
        <div className="mt-4">
          <p className="text-xs font-bold text-foreground">
            {past
              ? f.locale === 'ar'
                ? 'ملخص النتائج والقرارات'
                : 'Key outcomes & decisions'
              : f.locale === 'ar'
                ? 'جدول أعمال الجلسة والتحضيرات'
                : 'Session agenda & preparations'}
          </p>
          <p className="mt-1 whitespace-pre-line text-xs leading-5 text-muted-foreground" dir="auto">
            {meta.agenda || hearing.decision || hearing.notes}
          </p>
        </div>
      ) : null}
      {attendeeNames.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-foreground">
            {f.locale === 'ar' ? 'الحاضرون:' : 'Attending counsel:'}
          </span>
          {attendeeNames.map((name) => (
            <Badge key={name} variant="outline" dir="auto">
              {name}
            </Badge>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function SessionFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-xs font-semibold text-foreground" dir="auto">
        {value || '—'}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Session add/edit dialog
 * ------------------------------------------------------------------------- */

function SessionFormDialog({
  open,
  mode,
  initial,
  saving,
  labels,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  initial: SessionFormState;
  saving: boolean;
  labels: SessionsLabels;
  onCancel: () => void;
  onSubmit: (state: SessionFormState) => void;
}) {
  const [state, setState] = useState<SessionFormState>(initial);
  const [docDraft, setDocDraft] = useState('');
  const [dateError, setDateError] = useState(false);
  const f = useLexFormat();
  const ar = f.locale === 'ar';

  useEffect(() => {
    if (open) {
      setState(initial);
      setDocDraft('');
      setDateError(false);
    }
    // Re-seed the form only when the dialog opens (initial is derived per open).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () => {
    if (!state.hearing_date) {
      setDateError(true);
      return;
    }
    onSubmit(state);
  };

  const addDoc = () => {
    const label = docDraft.trim();
    if (!label) return;
    setState((s) => ({
      ...s,
      required_documents: [...s.required_documents, { id: newId(), label, provided: false }],
    }));
    setDocDraft('');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onCancel() : undefined)}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? labels.form.addTitle : labels.form.editTitle}</DialogTitle>
          <DialogDescription>{labels.form.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="session-title">{ar ? 'عنوان الجلسة' : 'Session title'}</Label>
            <Input
              id="session-title"
              value={state.title}
              onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
              placeholder={ar ? 'مثال: جلسة المرافعات والدفوع' : 'e.g. Oral arguments and defenses'}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="session-date">
                {labels.form.date} <span className="text-error-500">*</span>
              </Label>
              <Input
                id="session-date"
                type="datetime-local"
                value={state.hearing_date}
                onChange={(e) => setState((s) => ({ ...s, hearing_date: e.target.value }))}
              />
              {dateError ? <p className="text-caption text-error-600">{labels.form.errors.dateRequired}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="session-type">{labels.form.sessionType}</Label>
              <Select
                value={state.session_type}
                onValueChange={(v) => setState((s) => ({ ...s, session_type: v as SessionType | 'none' }))}
              >
                <SelectTrigger id="session-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {SESSION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {labels.sessionTypes[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="session-location">{labels.form.location}</Label>
              <Input
                id="session-location"
                value={state.location}
                onChange={(e) => setState((s) => ({ ...s, location: e.target.value }))}
                placeholder={labels.form.locationPlaceholder}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="session-action">{labels.form.requiredAction}</Label>
              <Input
                id="session-action"
                value={state.required_action}
                onChange={(e) => setState((s) => ({ ...s, required_action: e.target.value }))}
                placeholder={labels.form.requiredActionPlaceholder}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="session-chamber">{ar ? 'الدائرة' : 'Court chamber'}</Label>
              <Input
                id="session-chamber"
                value={state.chamber}
                onChange={(e) => setState((s) => ({ ...s, chamber: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="session-judge">{ar ? 'القاضي رئيس الجلسة' : 'Presiding judge'}</Label>
              <Input
                id="session-judge"
                value={state.presiding_judge}
                onChange={(e) => setState((s) => ({ ...s, presiding_judge: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="session-judge-title">{ar ? 'صفة القاضي' : 'Judge title'}</Label>
              <Input
                id="session-judge-title"
                value={state.presiding_judge_title}
                onChange={(e) =>
                  setState((s) => ({ ...s, presiding_judge_title: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="session-status">{ar ? 'حالة الجلسة' : 'Session status'}</Label>
              <Select
                value={state.status ?? 'scheduled'}
                onValueChange={(value) =>
                  setState((s) => ({ ...s, status: value as SessionMeta['status'] }))
                }
              >
                <SelectTrigger id="session-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['scheduled', 'upcoming', 'completed', 'adjourned', 'cancelled'].map((value) => (
                    <SelectItem key={value} value={value}>
                      {formatCaseToken(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="session-duration">{ar ? 'المدة بالدقائق' : 'Duration (minutes)'}</Label>
              <Input
                id="session-duration"
                type="number"
                min="0"
                value={state.duration_minutes}
                onChange={(e) => setState((s) => ({ ...s, duration_minutes: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="session-agenda">{ar ? 'جدول الأعمال والتحضيرات' : 'Agenda and preparations'}</Label>
            <Textarea
              id="session-agenda"
              rows={3}
              value={state.agenda}
              onChange={(e) => setState((s) => ({ ...s, agenda: e.target.value }))}
            />
          </div>

          {/* Attendees */}
          <div className="space-y-1.5">
            <Label>{labels.form.attendees}</Label>
            {state.attendees.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {state.attendees.map((id) => (
                  <AttendeeChip
                    key={id}
                    id={id}
                    onRemove={() =>
                      setState((s) => ({ ...s, attendees: s.attendees.filter((a) => a !== id) }))
                    }
                  />
                ))}
              </div>
            ) : null}
            <TenantUserPicker
              ariaLabel={labels.form.attendeesAdd}
              value=""
              excludeUserIds={state.attendees}
              onChange={(userId) => {
                if (userId) setState((s) => ({ ...s, attendees: [...s.attendees, userId] }));
              }}
              labels={{ select: labels.form.attendeesAdd, search: labels.form.attendeesAdd }}
            />
          </div>

          {/* Required documents */}
          <div className="space-y-1.5">
            <Label>{labels.form.requiredDocs}</Label>
            {state.required_documents.length > 0 ? (
              <ul className="space-y-1.5">
                {state.required_documents.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-1.5">
                    <span className="flex-1 text-body-sm text-foreground" dir="auto">
                      {doc.label}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-error-600"
                      aria-label={labels.requiredDocs.remove}
                      onClick={() =>
                        setState((s) => ({
                          ...s,
                          required_documents: s.required_documents.filter((d) => d.id !== doc.id),
                        }))
                      }
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-center gap-2">
              <Input
                value={docDraft}
                onChange={(e) => setDocDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addDoc();
                  }
                }}
                placeholder={labels.form.requiredDocsPlaceholder}
                className="h-8"
              />
              <Button type="button" size="sm" variant="outline" onClick={addDoc} disabled={!docDraft.trim()}>
                {labels.form.requiredDocsAdd}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="session-notes">{labels.form.notes}</Label>
            <Textarea
              id="session-notes"
              rows={3}
              value={state.notes}
              onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
              placeholder={labels.form.notesPlaceholder}
            />
          </div>

          {mode === 'edit' ? (
            <div className="space-y-1.5">
              <Label htmlFor="session-decision">{labels.form.decision}</Label>
              <Textarea
                id="session-decision"
                rows={2}
                value={state.decision}
                onChange={(e) => setState((s) => ({ ...s, decision: e.target.value }))}
                placeholder={labels.form.decisionPlaceholder}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {labels.form.cancel}
          </Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            {mode === 'add' ? labels.form.submit : labels.form.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttendeeChip({ id, onRemove }: { id: string; onRemove: () => void }) {
  const users = useCaseUsers();
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 py-1 pe-1 ps-3">
      <span className="text-caption font-medium text-foreground" dir="auto">
        {users.nameOf(id)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5 text-muted-foreground hover:text-error-600"
        aria-label="remove"
        onClick={onRemove}
      >
        <X className="h-3 w-3" aria-hidden />
      </Button>
    </span>
  );
}

/* ------------------------------------------------------------------------- *
 * Adjournment dialog
 * ------------------------------------------------------------------------- */

function AdjournDialog({
  open,
  target,
  saving,
  labels,
  f,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  target: CaseHearing | null;
  saving: boolean;
  labels: SessionsLabels;
  f: ReturnType<typeof useLexFormat>;
  onCancel: () => void;
  onConfirm: (newDate: string, reason: string, followUp: boolean) => void;
}) {
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');
  const [followUp, setFollowUp] = useState(true);
  const [errors, setErrors] = useState<{ date?: boolean; reason?: boolean }>({});

  useEffect(() => {
    if (open) {
      setNewDate('');
      setReason('');
      setFollowUp(true);
      setErrors({});
    }
  }, [open]);

  const confirm = () => {
    const nextErrors = { date: followUp && !newDate, reason: !reason.trim() };
    setErrors(nextErrors);
    if (nextErrors.date || nextErrors.reason) return;
    onConfirm(newDate, reason, followUp);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onCancel() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.adjourn.title}</DialogTitle>
          <DialogDescription>
            {target ? labels.adjourn.description(f.formatDate(target.hearing_date)) : labels.adjourn.noTarget}
          </DialogDescription>
        </DialogHeader>

        {target ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="adjourn-reason">
                {labels.adjourn.reason} <span className="text-error-500">*</span>
              </Label>
              <Textarea
                id="adjourn-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={labels.adjourn.reasonPlaceholder}
              />
              {errors.reason ? <p className="text-caption text-error-600">{labels.adjourn.errors.reasonRequired}</p> : null}
            </div>
            <label className="flex items-center gap-2">
              <Checkbox checked={followUp} onCheckedChange={(v) => setFollowUp(v === true)} />
              <span className="text-body-sm text-foreground">{labels.adjourn.createFollowUp}</span>
            </label>
            {followUp ? (
              <div className="space-y-1.5">
                <Label htmlFor="adjourn-date">
                  {labels.adjourn.newDate} <span className="text-error-500">*</span>
                </Label>
                <Input
                  id="adjourn-date"
                  type="datetime-local"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
                {errors.date ? <p className="text-caption text-error-600">{labels.adjourn.errors.dateRequired}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {labels.adjourn.cancel}
          </Button>
          <Button type="button" onClick={confirm} disabled={saving || !target}>
            {saving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            {labels.adjourn.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Hearing reports (minutes / decisions) — post-session outputs
 * ------------------------------------------------------------------------- */

function HearingReportsDialog({
  caseId,
  hearing,
  canWrite,
  labels,
  onOpenChange,
}: {
  caseId: string;
  hearing: CaseHearing | null;
  canWrite: boolean;
  labels: SessionsLabels;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const hearingId = hearing?.id ?? '';
  const [removeTarget, setRemoveTarget] = useState<CaseHearingReport | null>(null);
  const [type, setType] = useState<HearingReportType>('minutes');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [decision, setDecision] = useState('');
  const [titleError, setTitleError] = useState(false);

  const reportsQuery = useQuery({
    queryKey: ['lex-case-hearing-reports', caseId, hearingId],
    queryFn: () => casesApi.listHearingReports(caseId, hearingId),
    enabled: Boolean(hearing),
  });

  useEffect(() => {
    if (hearing) {
      setType('minutes');
      setTitle('');
      setBody('');
      setDecision('');
      setTitleError(false);
    }
  }, [hearing]);

  const addMutation = useMutation({
    mutationFn: () =>
      casesApi.createHearingReport(caseId, hearingId, { type, title: title.trim(), body, decision }),
    onSuccess: async () => {
      showSuccess(labels.toast.updated);
      setTitle('');
      setBody('');
      setDecision('');
      await queryClient.invalidateQueries({ queryKey: ['lex-case-hearing-reports', caseId, hearingId] });
    },
    onError: showApiError,
  });

  const removeMutation = useMutation({
    mutationFn: (reportId: string) => casesApi.deleteHearingReport(caseId, hearingId, reportId),
    onSuccess: async () => {
      showSuccess(labels.toast.removed);
      setRemoveTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['lex-case-hearing-reports', caseId, hearingId] });
    },
    onError: showApiError,
  });

  const reports = reportsQuery.data ?? [];

  const submit = () => {
    if (!title.trim()) {
      setTitleError(true);
      return;
    }
    addMutation.mutate();
  };

  return (
    <Dialog open={Boolean(hearing)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.reports}</DialogTitle>
          <DialogDescription>{labels.past.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {reportsQuery.isLoading ? (
            <div className="h-14 animate-pulse rounded-lg bg-muted/50" />
          ) : reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">{labels.past.noOutcome}</p>
          ) : (
            reports.map((report) => (
              <div key={report.id} className="rounded-lg border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{report.title}</p>
                    <p className="text-xs text-muted-foreground">{formatCaseToken(report.type)}</p>
                  </div>
                  {canWrite ? (
                    <Button size="sm" variant="outline" onClick={() => setRemoveTarget(report)}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  ) : null}
                </div>
                {report.body ? (
                  <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{report.body}</p>
                ) : null}
                {report.decision ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {labels.past.columns.outcome}: {report.decision}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>

        {canWrite ? (
          <div className="space-y-4 border-t pt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="report-type">{labels.form.sessionType}</Label>
                <Select value={type} onValueChange={(v) => setType(v as HearingReportType)}>
                  <SelectTrigger id="report-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HEARING_REPORT_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>
                        {formatCaseToken(o)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-title">
                  {labels.past.columns.outcome} <span className="text-error-500">*</span>
                </Label>
                <Input id="report-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                {titleError ? <p className="text-caption text-error-600">{labels.form.errors.dateRequired}</p> : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-body">{labels.form.notes}</Label>
              <Textarea id="report-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-decision">{labels.form.decision}</Label>
              <Textarea id="report-decision" rows={2} value={decision} onChange={(e) => setDecision(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.form.cancel}
              </Button>
              <Button type="button" onClick={submit} disabled={addMutation.isPending}>
                {addMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
                {labels.form.save}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {canWrite ? (
          <ConfirmDialog
            open={Boolean(removeTarget)}
            onOpenChange={(open) => {
              if (!open) setRemoveTarget(null);
            }}
            title={labels.confirmRemove.title}
            description={labels.confirmRemove.description}
            confirmLabel={labels.remove}
            variant="destructive"
            loading={removeMutation.isPending}
            onConfirm={async () => {
              if (removeTarget) await removeMutation.mutateAsync(removeTarget.id);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
