'use client';

import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  HandHelping,
  History,
  Hourglass,
  Eye,
  Loader2,
  RefreshCw,
  Send,
  ShieldX,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  lexSupportApi,
  type LexSupportRequest,
  type LexSupportStatus,
} from '@/lib/lex/support';
import { cn } from '@/lib/utils';
import { useSupportLabels, type SupportDialogAction } from '../_lib/support-i18n';
import { LEX_SUPPORT_QUERY_KEY } from '@/components/lex/support-composer';
import { SupportRequestDetailsSheet } from './support-request-details-sheet';
import { SupportValidityCountdown } from './support-validity-countdown';

export type SupportView = 'incoming' | 'sent' | 'history';
/**
 * `approvals` is not a tab — it is the "Pending my approval" group rendered
 * above the incoming queue. It is a row-rendering mode, not a route.
 */
type SupportRowView = SupportView | 'approvals';
type SupportAction = SupportDialogAction;

const ACTIVE_STATUSES: LexSupportStatus[] = ['open', 'accepted'];
/**
 * The requester keeps sight of a request while it sits behind the gate —
 * otherwise an approval that has not happened yet looks like a lost request.
 * The colleague's inbox deliberately does NOT include it (the server excludes
 * pending rows from `box=inbox` regardless of any status filter).
 */
const SENT_STATUSES: LexSupportStatus[] = ['pending_manager_approval', ...ACTIVE_STATUSES];
const APPROVAL_STATUSES: LexSupportStatus[] = ['pending_manager_approval'];

const STATUS_META: Record<LexSupportStatus, { icon: LucideIcon; className: string }> = {
  pending_manager_approval: { icon: Hourglass, className: 'badge-warning' },
  open: { icon: CircleDot, className: 'badge-warning' },
  accepted: { icon: Check, className: 'badge-info' },
  resolved: { icon: CheckCircle2, className: 'badge-success' },
  declined: { icon: XCircle, className: 'badge-danger' },
  expired: { icon: Clock3, className: 'badge-neutral' },
  cancelled: { icon: Ban, className: 'badge-neutral' },
  rejected: { icon: ShieldX, className: 'badge-danger' },
};

const PAGE_SIZE = 25;

function queryFor(view: SupportView, page: number) {
  if (view === 'incoming') return { box: 'inbox' as const, status: ACTIVE_STATUSES, page, per_page: PAGE_SIZE };
  if (view === 'sent') return { box: 'sent' as const, status: SENT_STATUSES, page, per_page: PAGE_SIZE };
  return { box: 'all' as const, history: true, page, per_page: PAGE_SIZE };
}

function nameOf(person: LexSupportRequest['requester']): string {
  if (!person) return '';
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
}

export function SupportRequestsPanel({
  view,
  canRespond,
  canCancel,
}: {
  view: SupportView;
  canRespond: boolean;
  canCancel: boolean;
}) {
  const labels = useSupportLabels();
  const format = useLexFormat();
  const query = useInfiniteQuery({
    queryKey: [...LEX_SUPPORT_QUERY_KEY, view],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => lexSupportApi.list(queryFor(view, pageParam)),
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.total_pages ? lastPage.meta.page + 1 : undefined,
    staleTime: 30_000,
    retry: false,
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeAction, setActiveAction] = useState<{
    request: LexSupportRequest;
    action: SupportAction;
  } | null>(null);
  const [detailRequest, setDetailRequest] = useState<LexSupportRequest | null>(null);
  const loadedItems = useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );
  const items = useMemo(
    () => view === 'history'
      ? loadedItems
      : loadedItems.filter((request) => {
          if (!request.expires_at) return true;
          const expiresAt = new Date(request.expires_at).getTime();
          return !Number.isFinite(expiresAt) || expiresAt > nowMs;
        }),
    [loadedItems, nowMs, view],
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (view === 'history') return;
    const nearestExpiry = loadedItems.reduce<number | null>((nearest, request) => {
      if (!request.expires_at) return nearest;
      const value = new Date(request.expires_at).getTime();
      if (!Number.isFinite(value) || value <= nowMs) return nearest;
      return nearest === null || value < nearest ? value : nearest;
    }, null);
    if (nearestExpiry === null) return;
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
      void query.refetch();
    }, Math.min(nearestExpiry - nowMs + 25, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [loadedItems, nowMs, query, view]);

  // The approval queue is a separate server scope, so it survives — and is
  // still actionable — when the colleague queue below it fails to load.
  const approvals = view === 'incoming' ? (
    <SupportApprovalsGroup
      onAction={(request, action) => setActiveAction({ request, action })}
      onViewDetails={setDetailRequest}
    />
  ) : null;
  const overlays = (
    <>
      <SupportActionDialog active={activeAction} onClose={() => setActiveAction(null)} />
      <SupportRequestDetailsSheet request={detailRequest} onOpenChange={(open) => { if (!open) setDetailRequest(null); }} />
    </>
  );

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        {approvals}
        <div aria-busy="true" aria-label={labels.loading}>
          <Skeleton.Table rows={4} cols={3} />
        </div>
        {overlays}
      </div>
    );
  }

  if (query.isError && !query.data) {
    return (
      <div className="space-y-6">
        {approvals}
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <XCircle className="mx-auto h-8 w-8 text-destructive" aria-hidden />
          <h3 className="mt-3 text-base font-semibold text-foreground">{labels.errorTitle}</h3>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{labels.errorDescription}</p>
          <Button type="button" variant="secondary" className="mt-4 gap-2" onClick={() => query.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            {labels.retry}
          </Button>
        </div>
        {overlays}
      </div>
    );
  }

  const empty = labels.empty[view];
  const description = view === 'incoming'
    ? labels.incomingDescription
    : view === 'sent'
      ? labels.sentDescription
      : labels.historyDescription;

  return (
    <div className="space-y-6">
      {approvals}
      <section aria-labelledby={`support-${view}-title`} className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id={`support-${view}-title`} className="text-base font-semibold text-foreground">
              {labels.tabs[view]}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-base badge-neutral tabular-nums text-foreground">
              {format.formatNumber(query.data?.pages[0]?.meta.total ?? items.length)}
            </span>
            <Button type="button" variant="ghost" size="icon" aria-label={labels.refresh} onClick={() => query.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </header>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
            {view === 'sent' ? <Send className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden /> : view === 'history' ? <History className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden /> : <HandHelping className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />}
            <h3 className="mt-3 text-sm font-semibold text-foreground">{empty.title}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{empty.description}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((request) => (
              <li key={request.id}>
                <SupportRequestRow
                  request={request}
                  view={view}
                  canRespond={canRespond}
                  canCancel={canCancel}
                  onAction={(action) => setActiveAction({ request, action })}
                  onViewDetails={() => setDetailRequest(request)}
                />
              </li>
            ))}
          </ul>
        )}

        {query.hasNextPage ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="secondary"
              className="gap-2"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : null}
              {query.isFetchingNextPage ? labels.loadingMore : labels.loadMore}
            </Button>
          </div>
        ) : null}
        {query.isFetchNextPageError ? (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-center text-sm text-destructive">
            <p>{labels.paginationError}</p>
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => void query.fetchNextPage()}>{labels.retry}</Button>
          </div>
        ) : null}
      </section>
      {overlays}
    </div>
  );
}

/**
 * "Pending my approval" — the manager's side of the gate (design §4.4).
 *
 * Authorization is the server's `box=approvals` scope, which returns only rows
 * whose frozen `approver_user_id` is the caller. A user who is nobody's approver
 * gets an empty page and this renders nothing at all — so the group never
 * offers a control the server would refuse, and never claims an empty approval
 * queue to someone who simply has no approval role.
 */
function SupportApprovalsGroup({
  onAction,
  onViewDetails,
}: {
  onAction: (request: LexSupportRequest, action: SupportAction) => void;
  onViewDetails: (request: LexSupportRequest) => void;
}) {
  const labels = useSupportLabels();
  const format = useLexFormat();
  const query = useInfiniteQuery({
    queryKey: [...LEX_SUPPORT_QUERY_KEY, 'approvals'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      lexSupportApi.list({
        box: 'approvals',
        status: APPROVAL_STATUSES,
        page: pageParam,
        per_page: PAGE_SIZE,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.total_pages ? lastPage.meta.page + 1 : undefined,
    staleTime: 30_000,
    retry: false,
  });
  // Belt and braces with the server scope: only a still-pending row is
  // approvable, so anything else is dropped rather than shown with dead buttons.
  const items = useMemo(
    () =>
      (query.data?.pages.flatMap((page) => page.data) ?? []).filter(
        (request) => request.status === 'pending_manager_approval',
      ),
    [query.data],
  );

  if (query.isLoading) return null;

  if (query.isError && !query.data) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground"
      >
        <span>{labels.approval.error}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => query.refetch()}>
          {labels.approval.retry}
        </Button>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="support-approvals-title" className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="support-approvals-title" className="text-base font-semibold text-foreground">
            {labels.approval.groupTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{labels.approval.groupDescription}</p>
        </div>
        <span className="badge-base badge-warning tabular-nums">
          {format.formatNumber(query.data?.pages[0]?.meta.total ?? items.length)}
        </span>
      </header>
      <ul className="space-y-3">
        {items.map((request) => (
          <li key={request.id}>
            <SupportRequestRow
              request={request}
              view="approvals"
              canRespond={false}
              canCancel={false}
              onAction={(action) => onAction(request, action)}
              onViewDetails={() => onViewDetails(request)}
            />
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            className="gap-2"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : null}
            {query.isFetchingNextPage ? labels.approval.loadingMore : labels.approval.loadMore}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The approval provenance of a request, stated honestly.
 *
 * The two automatic routes cleared the gate with nobody in it, so they say so
 * instead of naming an approver — a request that skipped human approval must
 * say so on its face.
 */
function SupportApprovalTrail({
  request,
  view,
}: {
  request: LexSupportRequest;
  view: SupportRowView;
}) {
  const labels = useSupportLabels();
  const format = useLexFormat();
  const approverName = nameOf(request.approver) || labels.approval.unknownApprover;
  const decidedOn = request.approval_decided_at
    ? ` ${labels.approval.decidedOn(format.formatDate(request.approval_decided_at, { dateStyle: 'medium' }))}`
    : '';

  if (request.status === 'pending_manager_approval') {
    // In the approver's own group the heading already says who holds it.
    if (view === 'approvals') return null;
    return <p className="mt-3 text-xs text-muted-foreground">{labels.approval.awaitingBy(approverName)}</p>;
  }

  if (request.status === 'rejected') {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-xs text-muted-foreground">{`${labels.approval.rejectedBy(approverName)}${decidedOn}`}</p>
        {request.approval_note ? (
          <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{labels.approval.rejectionNote}: </span>
            {request.approval_note}
          </p>
        ) : null}
      </div>
    );
  }

  const route = request.approval_route;
  if (route === 'auto_no_manager' || route === 'auto_self') {
    return <p className="mt-3 text-xs text-muted-foreground">{labels.approval.auto[route]}</p>;
  }
  if ((route === 'manager' || route === 'unit_head') && request.approval_decided_at) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">{`${labels.approval.approvedBy(approverName)}${decidedOn}`}</p>
    );
  }
  return null;
}

function SupportRequestRow({
  request,
  view,
  canRespond,
  canCancel,
  onAction,
  onViewDetails,
}: {
  request: LexSupportRequest;
  view: SupportRowView;
  canRespond: boolean;
  canCancel: boolean;
  onAction: (action: SupportAction) => void;
  onViewDetails: () => void;
}) {
  const labels = useSupportLabels();
  const { locale } = useLocaleOrDefault();
  const format = useLexFormat();
  const statusMeta = STATUS_META[request.status];
  const StatusIcon = statusMeta.icon;
  const otherParty = view === 'sent' ? nameOf(request.assignee) : nameOf(request.requester);
  const entityName = request.target_entity
    ? (locale === 'ar' ? request.target_entity.name.ar : request.target_entity.name.en)
      || request.target_entity.name.en
      || request.target_entity.name.ar
    : '';
  const partyPrefix = view === 'sent' ? labels.assignedTo : labels.requestedBy;
  const isActive = request.status === 'open' || request.status === 'accepted';
  // A request behind the gate has no validity clock, but the requester can
  // still withdraw it — the server allows cancel on any non-terminal status.
  const isCancellable = isActive || request.status === 'pending_manager_approval';

  return (
    <article className="rounded-xl border border-border/70 bg-card p-4 shadow-elevation-1">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('badge-base gap-1', statusMeta.className)}>
              <StatusIcon className="h-3.5 w-3.5" aria-hidden />
              {labels.status[request.status]}
            </span>
            <span className="badge-base badge-neutral text-foreground">{labels.priority[request.priority]}</span>
            {request.subject_type ? (
              <span className="badge-base badge-neutral text-foreground">{labels.subjectType[request.subject_type]}</span>
            ) : null}
          </div>
          <h3 className="mt-3 break-words text-sm font-semibold text-foreground">{request.subject}</h3>
          {request.body ? <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{request.body}</p> : null}
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <div className="flex gap-1"><dt>{partyPrefix}:</dt><dd className="font-medium text-foreground">{otherParty || labels.unknownColleague}</dd></div>
            {view === 'approvals' ? (
              <div className="flex gap-1">
                <dt>{labels.assignedTo}:</dt>
                <dd className="font-medium text-foreground">{nameOf(request.assignee) || labels.unknownColleague}</dd>
              </div>
            ) : null}
            {entityName ? <div className="flex gap-1"><dt>{labels.targetEntity}:</dt><dd>{entityName}</dd></div> : null}
            <div className="flex gap-1"><dt>{labels.createdAt}:</dt><dd>{format.formatDate(request.created_at, { dateStyle: 'medium' })}</dd></div>
            {!isActive && request.closed_at ? <div className="flex gap-1"><dt>{labels.closedAt}:</dt><dd>{format.formatDate(request.closed_at, { dateStyle: 'medium' })}</dd></div> : null}
          </dl>
          {request.resolution_note ? (
            <p className="mt-3 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{labels.resolutionNote}: </span>
              {request.resolution_note}
            </p>
          ) : null}
          <SupportApprovalTrail request={request} view={view} />
        </div>

        <div className="flex shrink-0 flex-col gap-3 lg:items-end">
          {isActive ? (
            <SupportValidityCountdown
              createdAt={request.created_at}
              expiresAt={request.expires_at}
              label={labels.validityLabel}
              noExpiryLabel={labels.noDeadline}
              reachedLabel={labels.validityEnded}
              remainingLabel={labels.validityRemaining}
              className="w-full lg:w-56"
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" className="gap-2" onClick={onViewDetails}>
              <Eye className="h-4 w-4" aria-hidden />
              {labels.viewDetails}
            </Button>
            {view === 'incoming' && canRespond && request.status === 'open' ? (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={() => onAction('accept')}>{labels.actions.accept}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onAction('decline')}>{labels.actions.decline}</Button>
              </>
            ) : null}
            {view === 'incoming' && canRespond && request.status === 'accepted' ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => onAction('resolve')}>{labels.actions.resolve}</Button>
            ) : null}
            {view === 'sent' && canCancel && isCancellable ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => onAction('cancel')}>{labels.actions.cancel}</Button>
            ) : null}
            {view === 'approvals' && request.status === 'pending_manager_approval' ? (
              <>
                <Button type="button" size="sm" onClick={() => onAction('approve')}>{labels.approval.approve}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onAction('reject')}>{labels.approval.reject}</Button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function SupportActionDialog({
  active,
  onClose,
}: {
  active: { request: LexSupportRequest; action: SupportAction } | null;
  onClose: () => void;
}) {
  const labels = useSupportLabels();
  const { locale, direction } = useLocaleOrDefault();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error('No support action selected');
      if (active.action === 'accept') return lexSupportApi.accept(active.request.id);
      if (active.action === 'decline') return lexSupportApi.decline(active.request.id, note);
      if (active.action === 'resolve') return lexSupportApi.resolve(active.request.id, note);
      if (active.action === 'approve') return lexSupportApi.approve(active.request.id);
      if (active.action === 'reject') return lexSupportApi.reject(active.request.id, note);
      return lexSupportApi.cancel(active.request.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LEX_SUPPORT_QUERY_KEY });
      toast.success(labels.actionDialog.success);
      closeDialog();
    },
    onError: () => toast.error(labels.actionDialog.failure),
  });

  const action = active?.action;
  const showNote = action === 'decline' || action === 'resolve' || action === 'reject';
  const noteError = Array.from(note).length > 10_000
    ? labels.actionDialog.noteTooLong
    : null;

  function closeDialog() {
    setNote('');
    onClose();
  }

  return (
    <Dialog
      open={Boolean(active)}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) {
          closeDialog();
        }
      }}
    >
      {active && action ? (
        <DialogContent dir={direction} lang={locale}>
          <DialogHeader className="text-start">
            <DialogTitle>{labels.actionDialog.title[action]}</DialogTitle>
            <DialogDescription>{labels.actionDialog.description[action]}</DialogDescription>
          </DialogHeader>
          <p className="rounded-lg bg-muted/40 p-3 text-sm font-medium text-foreground">{active.request.subject}</p>
          {showNote ? (
            <div className="space-y-2">
              <Label htmlFor="support-action-note">{labels.actionDialog.note}</Label>
              <Textarea
                id="support-action-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={labels.actionDialog.notePlaceholder}
                maxLength={10_000}
                aria-invalid={Boolean(noteError)}
                aria-describedby={noteError ? 'support-action-note-error' : undefined}
              />
              {noteError ? <p id="support-action-note-error" className="text-xs text-destructive">{noteError}</p> : null}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={closeDialog}>{labels.actionDialog.close}</Button>
            <Button type="button" className="gap-2" disabled={mutation.isPending || Boolean(noteError)} onClick={() => mutation.mutate()}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : null}
              {mutation.isPending ? labels.actionDialog.saving : labels.actionDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
