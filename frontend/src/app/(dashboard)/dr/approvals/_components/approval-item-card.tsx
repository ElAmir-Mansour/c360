'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  RotateCcw,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
import { cn } from '@/lib/utils';
import type { ApprovalItem } from '../../_lib/collaboration';
import { type ApprovalsInboxLabels, useApprovalsInboxLabels } from './approvals-labels';

/**
 * A single pending-approval row in the `/dr/approvals` inbox.
 *
 * Renders the real `ApprovalItem` (kind / id / title / since / route) from the
 * `itemsNeedingApproval` selector: a plain-language headline, the run id, how
 * long it has been waiting, a deep link into the full context, and the one-click
 * approve CTA wired by the parent to the real recovery action for this kind.
 *
 * The approve CTA is `dr:write`-gated: when `canWrite` is false the button is
 * disabled and explains itself via a tooltip (reachable by keyboard + assistive
 * tech). Tone pairs an ICON + TEXT with the state-* colour token — never colour
 * alone (WCAG 2.1 AA). All spacing is logical (`me-`/`gap-`) for RTL safety.
 */

export interface ApprovalItemCardProps {
  item: ApprovalItem;
  canWrite: boolean;
  pending: boolean;
  onApprove: (item: ApprovalItem, reason?: string) => void;
  /** Pre-formatted "since" string (locale-aware) from the parent. */
  sinceLabel: string;
}

interface KindMeta {
  icon: LucideIcon;
  kindLabel: string;
  approveLabel: string;
  contextLabel: string;
  /**
   * Semantic tone for the kind chip: a failover at the approval gate is the
   * higher-risk recovery decision (rose); a failback cutback is a return-to-
   * primary type/category (slate). Conveyed by icon + text + tone accent — never
   * colour alone (WCAG 2.1 AA).
   */
  tone: StatTone;
}

function metaForKind(kind: ApprovalItem['kind'], L: ApprovalsInboxLabels): KindMeta {
  if (kind === 'failback_cutback') {
    return {
      icon: RotateCcw,
      kindLabel: L.kindFailbackCutback,
      approveLabel: L.approveCutbackCta,
      contextLabel: L.openRecoverContext,
      tone: 'slate',
    };
  }
  return {
    icon: ShieldAlert,
    kindLabel: L.kindFailover,
    approveLabel: L.approveFailoverCta,
    contextLabel: L.openRunContext,
    tone: 'rose',
  };
}

export function ApprovalItemCard({
  item,
  canWrite,
  pending,
  onApprove,
  sinceLabel,
}: ApprovalItemCardProps) {
  const L = useApprovalsInboxLabels();
  const meta = metaForKind(item.kind, L);
  const [decisionReason, setDecisionReason] = useState('');
  const KindIcon = meta.icon;
  const disabledReason = canWrite ? null : L.noWriteTooltip;
  const quorumLabel = useMemo(() => formatQuorum(item, L), [item, L]);

  return (
    <Card data-testid="approval-item" data-approval-kind={item.kind} data-approval-id={item.id}>
      <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Kind chip: tone accent (risk=rose / type=slate) via the tone's
                `--kpi-accent`, paired with an icon + text label for WCAG AA. */}
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-button border px-2.5 py-1 text-caption font-medium',
                TONE_THEME_CLASS[meta.tone],
              )}
              style={{
                color: 'var(--kpi-accent)',
                borderColor: 'color-mix(in srgb, var(--kpi-accent) 40%, transparent)',
                backgroundColor: 'color-mix(in srgb, var(--kpi-accent) 10%, transparent)',
              }}
            >
              <KindIcon className="h-3.5 w-3.5" aria-hidden />
              {meta.kindLabel}
            </span>
            <Badge variant="outline" className="font-mono normal-case" dir="ltr" title={item.id}>
              <span className="me-1 text-content-muted">{L.runIdLabel}</span>
              {item.id}
            </Badge>
          </div>

          <p className="text-base font-medium text-content-primary">{item.title}</p>

          {/* Waiting-since = the approval SLA/age — gold (time) tone accent. */}
          <p
            className={cn('inline-flex items-center gap-1.5 text-sm text-content-muted', TONE_THEME_CLASS.gold)}
          >
            <Clock className="h-3.5 w-3.5 text-[color:var(--kpi-accent)]" aria-hidden />
            <span>{L.waitingSince}</span>
            <time dateTime={item.since} dir="ltr">
              {sinceLabel}
            </time>
          </p>

          <dl className="grid gap-2 rounded-lg border border-border/70 bg-muted/25 p-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-content-primary">{L.reasonLabel}</dt>
              <dd className="mt-1 text-content-muted">
                {item.approvalReason?.trim() || L.reasonFallback}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-content-primary">{L.quorumLabel}</dt>
              <dd className="mt-1 text-content-muted">{quorumLabel}</dd>
            </div>
          </dl>

          <div className="space-y-1.5">
            <Label htmlFor={`approval-reason-${item.kind}-${item.id}`}>{L.decisionReasonLabel}</Label>
            <Textarea
              id={`approval-reason-${item.kind}-${item.id}`}
              rows={2}
              value={decisionReason}
              onChange={(event) => setDecisionReason(event.target.value)}
              placeholder={L.decisionReasonPlaceholder}
              disabled={!canWrite || pending}
            />
            <p className="text-xs text-content-muted">{L.decisionReasonHelp}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={item.route} aria-label={meta.contextLabel}>
              <span className="me-1.5">{L.openContextCta}</span>
              <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </Link>
          </Button>

          <ApproveButton
            label={meta.approveLabel}
            approvingLabel={L.approvingCta}
            onClick={() => onApprove(item, decisionReason)}
            pending={pending}
            disabledReason={disabledReason}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function formatQuorum(item: ApprovalItem, L: ApprovalsInboxLabels): string {
  const quorum = item.approvalQuorum;
  if (quorum?.required != null && quorum?.received != null) {
    return L.quorumProgress(quorum.received, quorum.required);
  }
  return item.approvalQuorumStatus?.trim() || quorum?.status?.trim() || L.quorumFallback;
}

interface ApproveButtonProps {
  label: string;
  /** Resolved "Approving…" copy shown while the mutation is in flight. */
  approvingLabel: string;
  onClick: () => void;
  pending: boolean;
  disabledReason: string | null;
}

/** A write-gated approve CTA that disables + explains itself via a tooltip. */
function ApproveButton({ label, approvingLabel, onClick, pending, disabledReason }: ApproveButtonProps) {
  const disabled = disabledReason !== null || pending;
  const button = (
    <Button
      type="button"
      variant="default"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
    >
      {pending ? (
        <Spinner size="sm" className="me-1.5" />
      ) : (
        <BadgeCheck className="me-1.5 h-4 w-4" aria-hidden />
      )}
      {pending ? approvingLabel : label}
    </Button>
  );

  if (!disabledReason) return button;

  return (
    <Tooltip>
      {/* Disabled buttons swallow pointer events, so wrap for the tooltip trigger. */}
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
