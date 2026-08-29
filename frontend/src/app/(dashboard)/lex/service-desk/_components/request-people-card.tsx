'use client';

/**
 * #7 People card — right-rail SectionCard for the Legal Service Desk request
 * detail page. Replaces the plain-text "Admin User" treatment with a real
 * people surface: an initials avatar + department + copyable id for the
 * requester, a compact beneficiary-entity row (when linked), the workflow
 * approval tasks (avatar + humanized role/name + status + SLA-breach flag),
 * and a muted "Created by" footer.
 *
 * Fetches approval tasks itself via the exact `['lex-approval-tasks',
 * request.id]` query key already used by `ApprovalPanel` (see
 * `./approval-panel.tsx`) so the two components share one cached fetch. The
 * approvers subsection degrades quietly on error (no toast, no inline error
 * copy) so a broken/absent workflow never blocks the requester identity from
 * rendering — that block is driven entirely by the `request` prop and never
 * depends on the tasks query.
 *
 * No avatar image URLs or requester email are present on `LegalRequest` /
 * `ApprovalTask`, so identity is initials-only and there is no mailto —
 * only copy-to-clipboard for ids.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, CheckCircle2, Copy, Users } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { cn, slugToTitle } from '@/lib/utils';
import { showSuccess } from '@/lib/toast';
import {
  lexRequestsApi,
  requestCanHaveApprovalTasks,
  type ApprovalTask,
  type LegalRequest,
} from '@/lib/lex/requests';
import {
  useRequestPeopleCardLabels,
  type ApprovalTaskStatusToken,
} from './request-people-card-labels';

export interface RequestPeopleCardProps {
  request: LegalRequest;
  className?: string;
}

/* ------------------------------------------------------------------------- *
 * InitialsAvatar — tiny local avatar, no image URLs exist on this API surface
 * so identity is initials-only. Background is a deterministic hash-of-name
 * pick from a fixed, absolute (non-theme-token) palette chosen so `text-white`
 * clears WCAG AA (>=4.5:1) contrast in both the light and dark app themes.
 * ------------------------------------------------------------------------- */

/** Fixed dark swatches — each verified >= 4.5:1 contrast against white text. */
const AVATAR_PALETTE = [
  '#0F766E', // teal-700
  '#4338CA', // indigo-700
  '#BE123C', // rose-700
  '#92400E', // amber-800
  '#047857', // emerald-700
  '#1D4ED8', // blue-700
  '#6D28D9', // violet-700
  '#475569', // slate-600
] as const;

function hashToIndex(value: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash) % modulo;
}

function getNameInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface InitialsAvatarProps {
  name: string;
  size?: 'sm' | 'md';
  className?: string;
}

function InitialsAvatar({ name, size = 'md', className }: InitialsAvatarProps) {
  const seed = name.trim() || '?';
  const color = AVATAR_PALETTE[hashToIndex(seed, AVATAR_PALETTE.length)];
  return (
    <div
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold text-white',
        size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs',
        className,
      )}
      style={{ backgroundColor: color }}
    >
      {getNameInitials(name)}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * CopyIdButton — small icon button mirroring the copy affordance already
 * established in `service-desk/new/_components/submission-success.tsx`
 * (ghost icon button, Copy -> CheckCircle2 flash, `showSuccess` toast).
 * ------------------------------------------------------------------------- */

function CopyIdButton({
  value,
  label,
  doneLabel,
}: {
  value: string;
  label: string;
  doneLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(doneLabel);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed (permissions/insecure context) — no destructive
      // UX for a low-stakes copy affordance; the id remains visible/selectable.
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={onCopy}
      aria-label={label}
      title={label}
    >
      {copied ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-success-600 dark:text-success-300" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </Button>
  );
}

/* ------------------------------------------------------------------------- *
 * Approval task -> display name / badge variant.
 * ------------------------------------------------------------------------- */

function resolveAssigneeDisplayName(task: ApprovalTask): string {
  if (task.assignee_role) return slugToTitle(task.assignee_role);
  if (task.assignee_id) return task.assignee_id;
  return task.name;
}

const TASK_STATUS_VARIANT: Record<ApprovalTaskStatusToken, BadgeProps['variant']> = {
  pending: 'warning',
  claimed: 'info',
  completed: 'success',
  rejected: 'destructive',
  escalated: 'warning',
  cancelled: 'neutral',
};

function isKnownStatus(status: string): status is ApprovalTaskStatusToken {
  return status in TASK_STATUS_VARIANT;
}

/* ------------------------------------------------------------------------- *
 * RequestPeopleCard
 * ------------------------------------------------------------------------- */

export function RequestPeopleCard({ request, className }: RequestPeopleCardProps) {
  const labels = useRequestPeopleCardLabels();
  const hasWorkflow = requestCanHaveApprovalTasks(request.workflow_instance_id);

  // Reuses the exact query key `ApprovalPanel` uses (`./approval-panel.tsx`)
  // so both components share one cached fetch of the request's approval tasks.
  const tasksQuery = useQuery({
    queryKey: ['lex-approval-tasks', request.id],
    queryFn: () => lexRequestsApi.listApprovalTasks(request.id),
    enabled: Boolean(request.id) && hasWorkflow,
    retry: false,
  });

  const requesterName = request.requester_name?.trim() || labels.requesterUnknown;
  const tasks = tasksQuery.data ?? [];

  return (
    <SectionCard title={labels.title} className={className}>
      <div className="space-y-4">
        {/* Requester */}
        <div className="flex items-start gap-3">
          <InitialsAvatar name={requesterName} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-sm font-medium text-foreground">{requesterName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {request.department?.trim() || '—'}
            </p>
            {request.requester_user_id ? (
              <div className="flex items-center gap-1">
                <p
                  className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
                  dir="ltr"
                  title={request.requester_user_id}
                >
                  {request.requester_user_id}
                </p>
                <CopyIdButton
                  value={request.requester_user_id}
                  label={labels.copyId}
                  doneLabel={labels.copied}
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* Beneficiary entity (only when linked) */}
        {request.beneficiary_entity_id ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-muted-foreground">{labels.beneficiary}</p>
              <p
                className="truncate font-mono text-xs text-foreground"
                dir="ltr"
                title={request.beneficiary_entity_id}
              >
                {request.beneficiary_entity_id}
              </p>
            </div>
            <CopyIdButton
              value={request.beneficiary_entity_id}
              label={labels.copyId}
              doneLabel={labels.copied}
            />
          </div>
        ) : null}

        <div className="h-px bg-border/70" aria-hidden />

        {/* Approvers / assignees — quietly hidden (whole subsection) on
            fetch error so a broken/absent workflow never blocks the
            requester identity above from rendering. */}
        {hasWorkflow && !tasksQuery.isError ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {labels.approvers}
            </p>

            {tasksQuery.isLoading ? (
              <LoadingSkeleton variant="list-item" count={2} />
            ) : tasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">{labels.noApprovers}</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((task) => {
                  const displayName = resolveAssigneeDisplayName(task);
                  const variant = isKnownStatus(task.status)
                    ? TASK_STATUS_VARIANT[task.status]
                    : 'secondary';
                  const statusLabel = isKnownStatus(task.status)
                    ? labels.taskStatusLabels[task.status]
                    : slugToTitle(task.status);
                  return (
                    <li key={task.id} className="flex items-center gap-2">
                      <InitialsAvatar name={displayName} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                        {displayName}
                      </span>
                      <Badge variant={variant} size="sm">
                        {statusLabel}
                      </Badge>
                      {task.sla_breached ? (
                        <Badge variant="destructive" size="sm">
                          {labels.slaBreached}
                        </Badge>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {/* Created by */}
        <p
          className="truncate border-t border-border/60 pt-2 text-[11px] text-muted-foreground"
          title={request.created_by || undefined}
        >
          {labels.createdBy(request.created_by?.trim() || '—')}
        </p>
      </div>
    </SectionCard>
  );
}
