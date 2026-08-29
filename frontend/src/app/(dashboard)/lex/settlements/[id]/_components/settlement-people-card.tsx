'use client';

/**
 * Right-rail "Parties & people" card for the Settlement detail page. Surfaces
 * the human side of a settlement:
 *
 *   1. COUNTERPARTY — the other party to the settlement: an initials avatar +
 *      name, with copyable contact + identifier (PII, encrypted at rest; the
 *      detail surface already displays these to authorized viewers).
 *   2. NEGOTIATORS — the distinct `proposed_by` parties drawn from the recorded
 *      negotiation rounds, each with a round count.
 *   3. APPROVED BY / OPENED BY — the approval actor (when approved) and a muted
 *      "opened by" footer.
 *
 * Fully driven by the `settlement` prop (no extra fetch). No avatar image URLs
 * or emails exist on this API surface, so identity is initials-only and there
 * is only copy-to-clipboard for ids — never a mailto.
 */

import { useMemo, useState } from 'react';
import { CheckCircle2, Copy, ShieldCheck, Users } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { showSuccess } from '@/lib/toast';
import type { Settlement } from '@/lib/lex/settlements';
import { useSettlementDetailExtraLabels } from './detail-extra-labels';

export interface SettlementPeopleCardProps {
  settlement: Settlement;
  className?: string;
}

/* ------------------------------------------------------------------------- *
 * InitialsAvatar — deterministic hash-of-name pick from a fixed palette whose
 * swatches each clear WCAG AA (>=4.5:1) against white text in light + dark.
 * ------------------------------------------------------------------------- */

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
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function InitialsAvatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
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
      // Low-stakes copy affordance — the value stays visible/selectable.
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
 * Card.
 * ------------------------------------------------------------------------- */

export function SettlementPeopleCard({ settlement, className }: SettlementPeopleCardProps) {
  const t = useSettlementDetailExtraLabels().people;

  const counterpartyName = settlement.counterparty_name?.trim() || t.counterpartyUnknown;

  // Distinct negotiating parties (proposed_by) drawn from the recorded rounds.
  const negotiators = useMemo(() => {
    const counts = new Map<string, number>();
    for (const round of settlement.rounds ?? []) {
      const who = round.proposed_by?.trim();
      if (!who) continue;
      counts.set(who, (counts.get(who) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, rounds]) => ({ name, rounds }));
  }, [settlement.rounds]);

  return (
    <SectionCard title={t.title} className={className}>
      <div className="space-y-4">
        {/* Counterparty */}
        <div className="flex items-start gap-3">
          <InitialsAvatar name={counterpartyName} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t.counterparty}
            </p>
            <p className="truncate text-sm font-medium text-foreground" dir="auto">
              {counterpartyName}
            </p>
            {settlement.counterparty_contact ? (
              <p className="truncate text-xs text-muted-foreground" dir="auto">
                {settlement.counterparty_contact}
              </p>
            ) : null}
            {settlement.counterparty_id_number ? (
              <div className="flex items-center gap-1">
                <p
                  className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
                  dir="ltr"
                  title={settlement.counterparty_id_number}
                >
                  {settlement.counterparty_id_number}
                </p>
                <CopyIdButton
                  value={settlement.counterparty_id_number}
                  label={t.copyId}
                  doneLabel={t.copied}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="h-px bg-border/70" aria-hidden />

        {/* Negotiators */}
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {t.negotiators}
          </p>
          {negotiators.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.noNegotiators}</p>
          ) : (
            <ul className="space-y-2">
              {negotiators.map((n) => (
                <li key={n.name} className="flex items-center gap-2">
                  <InitialsAvatar name={n.name} size="sm" />
                  <span
                    className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
                    dir="auto"
                  >
                    {n.name}
                  </span>
                  <Badge variant="neutral" size="sm" className="tabular-nums">
                    {t.roundsBy(n.rounds)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Approved by */}
        {settlement.approved_by ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-success-600 dark:text-success-300" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-muted-foreground">{t.approvedBy}</p>
              <p className="truncate font-mono text-xs text-foreground" dir="ltr" title={settlement.approved_by}>
                {settlement.approved_by}
              </p>
            </div>
            <CopyIdButton value={settlement.approved_by} label={t.copyId} doneLabel={t.copied} />
          </div>
        ) : null}

        {/* Opened by */}
        <p
          className="truncate border-t border-border/60 pt-2 text-[11px] text-muted-foreground"
          title={settlement.created_by || undefined}
        >
          {t.createdBy(settlement.created_by?.trim() || '—')}
        </p>
      </div>
    </SectionCard>
  );
}
