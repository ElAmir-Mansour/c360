'use client';

import { ArrowRightLeft, Building2, CircleSlash, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import type { AppLocale } from '@/lib/i18n';
import type { WhatIfLevel } from '../../_lib/escalation-whatif';
import type { WhatIfLabels } from '../../_lib/escalation-whatif-i18n';

interface WhatIfRecipientRowProps {
  /** Resolved rung after toggles are applied. */
  level: WhatIfLevel;
  labels: WhatIfLabels;
  locale: AppLocale;
  /**
   * The user id whose "on leave" switch this row controls. This is the BASE
   * holder's user id for the level (so toggling models the original holder going
   * on leave); `null` when the base ladder had no rung here (a pre-existing gap),
   * in which case the switch is hidden.
   */
  baseUserId: string | null;
  /** Whether `baseUserId` is currently flagged on leave. */
  unavailable: boolean;
  onToggle: (userId: string, next: boolean) => void;
}

export function WhatIfRecipientRow({
  level,
  labels,
  locale,
  baseUserId,
  unavailable,
  onToggle,
}: WhatIfRecipientRowProps) {
  const roleLabel = labels.roleKeys[level.roleKey];
  const { status, recipient } = level;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between',
        status === 'uncovered' && 'border-rose-300 bg-rose-50/60',
        status === 'substituted' && 'border-warning-300 bg-warning-50/50',
        status === 'original' && 'bg-card',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {/* Level badge */}
        <Badge
          variant="outline"
          className="mt-0.5 shrink-0 px-1.5 py-0 tracking-normal"
          aria-hidden
        >
          {labels.levelBadge(level.level)}
        </Badge>

        <div className="min-w-0 flex-1 space-y-1">
          {/* Role name + status pill */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{roleLabel}</span>
            <StatusPill status={status} labels={labels} />
          </div>

          {recipient ? (
            <>
              {/* Recipient holder */}
              <div className="flex items-center gap-1.5 text-sm">
                <User className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">
                  {resolveLocalized(recipient.label, locale) || recipient.user_id}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  ({recipient.user_id})
                </span>
              </div>
              {/* Source entity — the EXACT ancestor that supplies the holder */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="size-3.5 shrink-0" aria-hidden />
                <span className="font-medium">{labels.fromEntity}</span>
                <span className="font-mono">{recipient.entity_code}</span>
                <span className="truncate">
                  · {resolveLocalized(recipient.entity_name, locale)}
                </span>
              </div>
              {status === 'substituted' ? (
                <div className="flex items-center gap-1.5 text-xs font-medium text-warning-700 dark:text-warning-300">
                  <ArrowRightLeft className="size-3.5 shrink-0" aria-hidden />
                  {labels.substitutedFrom(recipient.entity_code)}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex items-center gap-1.5 text-sm font-semibold text-rose-700">
              <CircleSlash className="size-4 shrink-0" aria-hidden />
              {labels.uncoveredRow}
            </div>
          )}
        </div>
      </div>

      {/* On-leave toggle (only when the level has a base holder to take offline) */}
      {baseUserId ? (
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
          <span className={cn(unavailable ? 'font-medium text-rose-700' : 'text-muted-foreground')}>
            {labels.onLeaveLabel}
          </span>
          <Switch
            checked={unavailable}
            onCheckedChange={(next) => onToggle(baseUserId, next)}
            aria-label={labels.onLeaveAria(roleLabel)}
          />
        </label>
      ) : (
        <span className="shrink-0 text-xs italic text-muted-foreground">{labels.gapRow}</span>
      )}
    </div>
  );
}

function StatusPill({
  status,
  labels,
}: {
  status: WhatIfLevel['status'];
  labels: WhatIfLabels;
}) {
  if (status === 'uncovered') {
    return (
      <Badge variant="destructive" className="px-1.5 py-0 tracking-normal">
        {labels.statusUncovered}
      </Badge>
    );
  }
  if (status === 'substituted') {
    return (
      <Badge variant="warning" className="px-1.5 py-0 tracking-normal">
        {labels.statusSubstituted}
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="px-1.5 py-0 tracking-normal">
      {labels.statusOriginal}
    </Badge>
  );
}
