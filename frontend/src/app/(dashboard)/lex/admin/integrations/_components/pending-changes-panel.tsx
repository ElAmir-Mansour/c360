'use client';

/**
 * PendingChangesPanel (#13) — the maker-checker review queue.
 *
 * Lists configuration {@link PendingChange change requests} for protected
 * connectors with a SECRET-MASKED field-level diff (old → new), the requester +
 * timestamp, and Approve / Reject actions (each captures a note; reject requires
 * one). When the active operator is the requester, a separation-of-duties (SoD)
 * hint disables Approve so a second operator must review it.
 *
 * SECRET SAFETY. A diff field flagged `secret:true` NEVER renders plaintext — the
 * backend already masks `old`/`new` to a sentinel or an external reference, and
 * this panel renders "•••••• (secret)" (or the reference string, tagged as such)
 * rather than the value.
 *
 * Reads use an explicit degraded flag so failures are not confused with an empty
 * review queue; manage actions are gated on `lex:integration:manage` (passed via
 * `canManage`). Mirrors the
 * reliability DlqConsole + org-entities admin patterns: SectionCard-friendly,
 * react-query, bilingual via resolveLocalized + governance labels, RTL.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ShieldAlert, ShieldQuestion, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { RelativeTime } from '@/components/shared/relative-time';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showSuccess, showBackendError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  approveChange,
  getPendingChangesResult,
  rejectChange,
  type ChangeDiff,
  type PendingChange,
  type PendingChangeStatus,
} from '@/lib/lex/integrations';
import { kindMeta } from '../_lib/integration-kinds';
import {
  useGovernanceLabels,
  fillGovernanceToken,
  buildPendingStatusConfig,
  type GovernanceLabels,
} from '../_lib/governance-labels';

export const PENDING_CHANGES_KEY = ['lex-integrations', 'pending-changes'] as const;

type QueueFilter = 'all' | PendingChangeStatus;

interface PendingChangesPanelProps {
  /** Manage gate (`lex:integration:manage`); read-only users see no actions. */
  canManage: boolean;
}

export function PendingChangesPanel({ canManage }: PendingChangesPanelProps) {
  const g = useGovernanceLabels();
  const { locale, direction } = useLocaleOrDefault();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<QueueFilter>('pending');

  const q = useQuery({
    queryKey: PENDING_CHANGES_KEY,
    // Never throws; degraded=true means the queue could not be read.
    queryFn: () => getPendingChangesResult(),
  });

  const changes = useMemo<PendingChange[]>(() => q.data?.changes ?? [], [q.data]);
  const degraded = q.data?.degraded ?? false;
  const pendingCount = useMemo(
    () => changes.filter((c) => c.status === 'pending').length,
    [changes],
  );
  const filtered = useMemo(
    () => (filter === 'all' ? changes : changes.filter((c) => c.status === filter)),
    [changes, filter],
  );

  const FILTERS: { key: QueueFilter; label: string }[] = [
    { key: 'pending', label: g.queueFilterPending },
    { key: 'approved', label: g.queueFilterApproved },
    { key: 'rejected', label: g.queueFilterRejected },
    { key: 'all', label: g.queueFilterAll },
  ];

  if (q.isLoading) {
    return <LoadingSkeleton variant="card" count={3} />;
  }
  if (q.isError || degraded) {
    return (
      <ErrorState
        variant="generic"
        title={g.queueErrorTitle}
        message={g.queueErrorBody}
        onRetry={() => void q.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4" dir={direction} lang={locale}>
      {/* Filter bar + pending tally. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              type="button"
              size="sm"
              variant={filter === f.key ? 'default' : 'outline'}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {pendingCount > 0 ? (
          <Badge variant="outline" className="gap-1.5 border-warning-300/60 text-warning-700">
            <ShieldQuestion className="h-3.5 w-3.5" aria-hidden />
            {fillGovernanceToken(g.queuePendingCount, 'n', pendingCount)}
          </Badge>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={g.queueEmpty}
          description={g.queueEmptyHint}
          size="compact"
        />
      ) : (
        <ul className="space-y-4">
          {filtered.map((change) => (
            <li key={change.id}>
              <ChangeCard
                change={change}
                canManage={canManage}
                currentUser={user}
                locale={locale}
                g={g}
                onActed={() => void qc.invalidateQueries({ queryKey: PENDING_CHANGES_KEY })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------- *
 * One change-request card.
 * --------------------------------------------------------------------------- */

interface ChangeCardProps {
  change: PendingChange;
  canManage: boolean;
  currentUser: ReturnType<typeof useAuth>['user'];
  locale: ReturnType<typeof useLocaleOrDefault>['locale'];
  g: GovernanceLabels;
  onActed: () => void;
}

/** True when the active operator is the change's requester (SoD self-review). */
function isSelfRequested(
  change: PendingChange,
  user: ReturnType<typeof useAuth>['user'],
): boolean {
  if (!user) return false;
  const candidates = [user.email, user.id, user.full_name].filter(Boolean) as string[];
  const by = change.requested_by?.toLowerCase() ?? '';
  return candidates.some((c) => c.toLowerCase() === by);
}

function ChangeCard({ change, canManage, currentUser, locale, g, onActed }: ChangeCardProps) {
  const meta = kindMeta(change.kind);
  const statusConfig = buildPendingStatusConfig(g);
  const isPending = change.status === 'pending';
  const selfRequested = isSelfRequested(change, currentUser);

  const [note, setNote] = useState('');
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const approve = useMutation({
    mutationFn: () => approveChange(change.id, note.trim() || undefined),
    onSuccess: () => {
      showSuccess(g.toastApproved);
      onActed();
    },
    onError: (e) => showBackendError(e, g.toastError),
  });

  const reject = useMutation({
    mutationFn: () => rejectChange(change.id, note.trim()),
    onSuccess: () => {
      showSuccess(g.toastRejected);
      onActed();
    },
    onError: (e) => showBackendError(e, g.toastError),
  });

  const noteMissing = note.trim().length === 0;
  const busy = approve.isPending || reject.isPending;

  return (
    <div className="card overflow-hidden rounded-xl border">
      {/* Header: endpoint + status + requester. */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/20 px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <meta.icon className={cn('h-4 w-4 shrink-0', meta.accent)} aria-hidden />
            <span className="truncate font-semibold">
              {change.endpoint_name || resolveLocalized(meta.name, locale)}
            </span>
            {meta.govGated ? (
              <Badge variant="outline" className="border-warning-300/60 text-warning-700">
                {resolveLocalized(meta.name, locale)}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {g.changeRequestedBy}: <span className="font-medium">{change.requested_by}</span>
            {' · '}
            {g.changeRequestedAt} <RelativeTime date={change.requested_at} />
          </p>
        </div>
        <StatusBadge status={change.status} config={statusConfig} />
      </div>

      {/* Secret-masked diff. */}
      <div className="px-4 py-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {g.changeDiffTitle}
        </h4>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-start font-medium">{g.changeField}</th>
                <th className="px-3 py-1.5 text-start font-medium">{g.changeOld}</th>
                <th className="px-3 py-1.5 text-start font-medium">{g.changeNew}</th>
              </tr>
            </thead>
            <tbody>
              {change.diff.map((d) => (
                <DiffRow key={d.field} diff={d} g={g} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reviewer footer (resolved) or action area (pending). */}
      {isPending ? (
        canManage ? (
          <div className="space-y-3 border-t px-4 py-3">
            {selfRequested ? (
              <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-800/20 dark:text-warning-300">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  <p className="font-medium">{g.sodHintTitle}</p>
                  <p>{g.sodSelfBlocked}</p>
                </div>
              </div>
            ) : null}

            <div className="space-y-1">
              <label htmlFor={`note-${change.id}`} className="text-xs font-medium">
                {g.changeNote}
              </label>
              <Textarea
                id={`note-${change.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={g.changeNotePlaceholder}
                rows={2}
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">{g.changeNoteOptional}</p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRejectOpen(true)}
                disabled={busy || noteMissing}
                title={noteMissing ? g.changeNoteRequired : undefined}
              >
                {reject.isPending ? (
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <XCircle className="me-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                {reject.isPending ? g.rejecting : g.reject}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setApproveOpen(true)}
                disabled={busy || selfRequested}
                title={selfRequested ? g.sodSelfBlocked : undefined}
              >
                {approve.isPending ? (
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                {approve.isPending ? g.approving : g.approve}
              </Button>
            </div>

            {noteMissing ? (
              <p className="text-end text-xs text-muted-foreground">{g.changeNoteRequiredHint}</p>
            ) : null}
          </div>
        ) : null
      ) : (
        <ResolvedFooter change={change} g={g} />
      )}

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={g.approveConfirmTitle}
        description={g.approveConfirmBody}
        confirmLabel={g.approve}
        loading={approve.isPending}
        onConfirm={async () => {
          await approve.mutateAsync();
        }}
      />
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={g.rejectConfirmTitle}
        description={g.rejectConfirmBody}
        confirmLabel={g.reject}
        variant="destructive"
        loading={reject.isPending}
        onConfirm={async () => {
          await reject.mutateAsync();
        }}
      />
    </div>
  );
}

/** Resolved (approved/rejected) reviewer + note line. */
function ResolvedFooter({ change, g }: { change: PendingChange; g: GovernanceLabels }) {
  if (!change.reviewer && !change.note) return null;
  return (
    <div className="space-y-1 border-t bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
      {change.reviewer ? (
        <p>
          {g.changeReviewer}: <span className="font-medium">{change.reviewer}</span>
          {change.reviewed_at ? (
            <>
              {' · '}
              {g.changeReviewedAt} <RelativeTime date={change.reviewed_at} />
            </>
          ) : null}
        </p>
      ) : null}
      {change.note ? (
        <p className="text-foreground/80">
          {g.changeNote}: {change.note}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------- *
 * One diff row — SECRET-MASKED. A `secret:true` field never renders plaintext.
 * --------------------------------------------------------------------------- */

function DiffRow({ diff, g }: { diff: ChangeDiff; g: GovernanceLabels }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-1.5 align-top font-mono text-xs" dir="ltr">
        {diff.field}
      </td>
      <td className="px-3 py-1.5 align-top">
        <DiffValue value={diff.old} secret={diff.secret} g={g} tone="old" />
      </td>
      <td className="px-3 py-1.5 align-top">
        <DiffValue value={diff.new} secret={diff.secret} g={g} tone="new" />
      </td>
    </tr>
  );
}

/**
 * Render one side of a diff. SECRETS NEVER show plaintext:
 *   - a secret value that is an external reference (kms://|vault://) is shown
 *     verbatim (it is non-secret) with an "external reference" tag;
 *   - any other secret value collapses to a masked sentinel chip.
 * Non-secret values render as monospace text (or "Not set" when empty).
 */
function DiffValue({
  value,
  secret,
  g,
  tone,
}: {
  value: unknown;
  secret: boolean;
  g: GovernanceLabels;
  tone: 'old' | 'new';
}) {
  const isRef =
    typeof value === 'string' && (value.startsWith('kms://') || value.startsWith('vault://'));
  const empty = value === undefined || value === null || value === '';

  if (secret && !isRef) {
    return (
      <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
        {empty ? g.changeNoValue : g.changeSecretMasked}
      </span>
    );
  }

  if (empty) {
    return <span className="text-xs italic text-muted-foreground">{g.changeNoValue}</span>;
  }

  return (
    <span
      className={cn(
        'inline-flex flex-wrap items-center gap-1.5 break-all font-mono text-xs',
        tone === 'new' ? 'text-foreground' : 'text-muted-foreground line-through',
      )}
      dir="ltr"
    >
      {String(value)}
      {isRef ? (
        <Badge variant="outline" className="font-sans text-caption">
          {g.changeSecretRef}
        </Badge>
      ) : null}
    </span>
  );
}
