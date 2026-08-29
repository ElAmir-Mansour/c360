'use client';

/**
 * Right-rail People card for the consultation detail page. Replaces the plain
 * "Requester / Advisor" metadata rows with a real people surface: an initials
 * avatar + department + copyable id for the requester, the assigned advisor
 * (avatar + copyable id, or an "unassigned" note), and a muted "Created by"
 * footer.
 *
 * No avatar image URLs or emails exist on `Consultation`, so identity is
 * initials-only and there is no mailto — only copy-to-clipboard for ids.
 */

import { useState } from 'react';
import { CheckCircle2, Copy, UserCog } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { showSuccess } from '@/lib/toast';
import type { Consultation } from '@/lib/lex/consultations';
import { useConsultationDetailLabels } from './detail-extra-labels';

export interface ConsultationPeopleCardProps {
  consultation: Consultation;
  className?: string;
}

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
      // Clipboard write failed (permissions/insecure context) — the id stays
      // visible/selectable; no destructive UX for a low-stakes copy.
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

/** A person row: avatar + name + secondary line + optional copyable id. */
function PersonRow({
  role,
  name,
  secondary,
  id,
  copyLabel,
  copiedLabel,
}: {
  role: string;
  name: string;
  secondary?: string;
  id?: string | null;
  copyLabel: string;
  copiedLabel: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <InitialsAvatar name={name} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {role}
        </p>
        <p className="truncate text-sm font-medium text-foreground" dir="auto">
          {name}
        </p>
        {secondary ? (
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {secondary}
          </p>
        ) : null}
        {id ? (
          <div className="flex items-center gap-1">
            <p
              className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
              dir="ltr"
              title={id}
            >
              {id}
            </p>
            <CopyIdButton value={id} label={copyLabel} doneLabel={copiedLabel} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ConsultationPeopleCard({ consultation, className }: ConsultationPeopleCardProps) {
  const t = useConsultationDetailLabels().people;

  const requesterName = consultation.requester_name?.trim() || t.requesterUnknown;
  const advisorName = consultation.advisor_name?.trim();

  return (
    <SectionCard title={t.title} className={className}>
      <div className="space-y-4">
        <PersonRow
          role={t.requester}
          name={requesterName}
          secondary={consultation.department?.trim() || undefined}
          id={consultation.requester_user_id}
          copyLabel={t.copyId}
          copiedLabel={t.copied}
        />

        <div className="h-px bg-border/70" aria-hidden />

        {/* Assigned advisor — real row when assigned, muted placeholder otherwise. */}
        {advisorName ? (
          <PersonRow
            role={t.advisor}
            name={advisorName}
            id={consultation.advisor_id}
            copyLabel={t.copyId}
            copiedLabel={t.copied}
          />
        ) : (
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-dashed border-border bg-muted text-muted-foreground">
              <UserCog className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t.advisor}
              </p>
              <p className="text-sm text-muted-foreground">{t.advisorUnassigned}</p>
            </div>
          </div>
        )}

        {/* Created by */}
        <p
          className="truncate border-t border-border/60 pt-2 text-[11px] text-muted-foreground"
          title={consultation.created_by || undefined}
        >
          {t.createdBy(consultation.created_by?.trim() || '—')}
        </p>
      </div>
    </SectionCard>
  );
}
