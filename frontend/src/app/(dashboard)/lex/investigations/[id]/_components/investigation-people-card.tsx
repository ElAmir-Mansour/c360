'use client';

/**
 * People card — right-rail SectionCard for the investigations detail page. A
 * read-only identity surface that complements (never replaces) the editable
 * Parties section in the main column:
 *
 *   1. LEAD INVESTIGATOR — initials avatar + name + owning department.
 *   2. PARTY ROSTER — the first few registered parties (avatar + name + a
 *      localized role badge), with a "+N more" affordance and a header counter.
 *   3. APPROVAL ASSIGNEES — the workflow approval tasks (assignee + status),
 *      shown only while an approval chain exists.
 *   4. CREATED BY — a muted governance footer.
 *
 * Fully prop-driven from the parent's already-loaded `investigation` +
 * `approvalTasks` — no extra network round-trips. No avatar image URLs exist on
 * this API surface, so identity is initials-only.
 */

import { Users } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn, slugToTitle } from '@/lib/utils';
import type { Investigation, InvestigationApprovalTask } from '@/lib/lex/investigations';
import { usePartyRoleLabel } from './investigation-enums-i18n';
import { useInvestigationPeopleCardLabels } from './investigation-people-card-labels';
import { CopyIdButton, InitialsAvatar } from './rail-bits';

export interface InvestigationPeopleCardProps {
  investigation: Investigation;
  approvalTasks: InvestigationApprovalTask[];
  className?: string;
}

/** Rail is compact — only the first few parties are worth the space. */
const MAX_PARTIES = 5;

const TASK_STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  pending: 'warning',
  in_progress: 'info',
  claimed: 'info',
  completed: 'success',
  approved: 'success',
  rejected: 'destructive',
  escalated: 'warning',
  cancelled: 'neutral',
};

function resolveAssigneeName(task: InvestigationApprovalTask, fallback: string): string {
  if (task.assignee_role) return slugToTitle(task.assignee_role);
  if (task.assignee_user_id) return task.assignee_user_id;
  return task.title || task.name || fallback;
}

export function InvestigationPeopleCard({
  investigation,
  approvalTasks,
  className,
}: InvestigationPeopleCardProps) {
  const labels = useInvestigationPeopleCardLabels();
  const roleLabel = usePartyRoleLabel();

  const parties = investigation.parties ?? [];
  const shownParties = parties.slice(0, MAX_PARTIES);
  const overflow = parties.length - shownParties.length;
  const leadName = investigation.lead_investigator?.trim() || labels.leadUnknown;

  return (
    <SectionCard title={labels.title} className={className}>
      <div className="space-y-4">
        {/* Lead investigator */}
        <div className="flex items-start gap-3">
          <InitialsAvatar name={leadName} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-sm font-medium text-foreground" dir="auto">
              {leadName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{labels.lead}</p>
            {investigation.department?.trim() ? (
              <p className="truncate text-xs text-muted-foreground" dir="auto">
                {investigation.department}
              </p>
            ) : null}
          </div>
        </div>

        <div className="h-px bg-border/70" aria-hidden />

        {/* Party roster */}
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {labels.parties}
            {parties.length > 0 ? (
              <Badge variant="neutral" size="sm" className="ms-auto tabular-nums">
                {parties.length}
              </Badge>
            ) : null}
          </p>
          {parties.length === 0 ? (
            <p className="text-xs text-muted-foreground">{labels.noParties}</p>
          ) : (
            <ul className="space-y-2">
              {shownParties.map((party) => (
                <li key={party.id} className="flex items-center gap-2">
                  <InitialsAvatar name={party.name} size="sm" />
                  <span
                    className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
                    dir="auto"
                  >
                    {party.name}
                  </span>
                  <Badge variant="outline" size="sm">
                    {roleLabel(party.role)}
                  </Badge>
                </li>
              ))}
              {overflow > 0 ? (
                <li className="ps-9 text-xs text-muted-foreground">
                  {labels.moreParties(overflow)}
                </li>
              ) : null}
            </ul>
          )}
        </div>

        {/* Approval assignees — only when an approval chain exists. */}
        {approvalTasks.length > 0 ? (
          <>
            <div className="h-px bg-border/70" aria-hidden />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{labels.approvers}</p>
              <ul className="space-y-2">
                {approvalTasks.map((task) => {
                  const name = resolveAssigneeName(task, labels.assigneeUnknown);
                  const statusToken = String(task.status ?? '').toLowerCase();
                  const variant = TASK_STATUS_VARIANT[statusToken] ?? 'secondary';
                  const statusLabel = statusToken
                    ? labels.taskStatusLabels[statusToken] ?? slugToTitle(statusToken)
                    : null;
                  return (
                    <li key={task.id} className="flex items-center gap-2">
                      <InitialsAvatar name={name} size="sm" />
                      <span
                        className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
                        dir="auto"
                      >
                        {name}
                      </span>
                      {statusLabel ? (
                        <Badge variant={variant} size="sm">
                          {statusLabel}
                        </Badge>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        ) : null}

        {/* Created by */}
        {investigation.created_by ? (
          <div
            className={cn(
              'flex items-center gap-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground',
            )}
          >
            <span className="min-w-0 truncate" title={investigation.created_by} dir="auto">
              {labels.createdBy(investigation.created_by)}
            </span>
            <CopyIdButton
              value={investigation.created_by}
              label={labels.copyId}
              doneLabel={labels.copied}
            />
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
