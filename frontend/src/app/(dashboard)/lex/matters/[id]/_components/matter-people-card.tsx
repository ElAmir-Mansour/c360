'use client';

/**
 * #5 People card — right-rail SectionCard for the Matters detail page. Renders
 * the two identities a matter always carries: its OWNER (the accountable legal
 * user) and its REQUESTER (the business originator), each as an initials avatar
 * + role label + optional copyable user id, plus a muted "Created by" footer.
 *
 * Driven entirely by the `matter` prop — no network round-trip. Matters carry no
 * avatar image URLs or emails on their API surface, so identity is initials-only
 * (no mailto) with copy-to-clipboard for the underlying user ids.
 */

import { useState } from 'react';
import { CheckCircle2, Copy } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { showSuccess } from '@/lib/toast';
import type { LexMatter } from '@/types/suites';
import { useMatterPeopleCardLabels } from './matter-detail-labels';

export interface MatterPeopleCardProps {
  matter: LexMatter;
  className?: string;
}

/* Fixed dark swatches — each verified >= 4.5:1 contrast against white text in
 * both light and dark app themes. */
const AVATAR_PALETTE = [
  '#0F766E',
  '#4338CA',
  '#BE123C',
  '#92400E',
  '#047857',
  '#1D4ED8',
  '#6D28D9',
  '#475569',
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

function InitialsAvatar({ name, className }: { name: string; className?: string }) {
  const seed = name.trim() || '?';
  const color = AVATAR_PALETTE[hashToIndex(seed, AVATAR_PALETTE.length)];
  return (
    <div
      aria-hidden
      className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white',
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
      // Clipboard write failed (permissions/insecure context) — non-destructive;
      // the id remains visible/selectable.
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

function PersonRow({
  role,
  name,
  userId,
  subtitle,
  copyLabel,
  copiedLabel,
}: {
  role: string;
  name: string;
  userId?: string | null;
  subtitle?: string | null;
  copyLabel: string;
  copiedLabel: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <InitialsAvatar name={name} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
          {role}
        </p>
        <p className="truncate text-sm font-medium text-foreground" dir="auto">
          {name}
        </p>
        {subtitle ? (
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {subtitle}
          </p>
        ) : null}
        {userId ? (
          <div className="flex items-center gap-1">
            <p
              className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
              dir="ltr"
              title={userId}
            >
              {userId}
            </p>
            <CopyIdButton value={userId} label={copyLabel} doneLabel={copiedLabel} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MatterPeopleCard({ matter, className }: MatterPeopleCardProps) {
  const labels = useMatterPeopleCardLabels();

  const ownerName = matter.owner_name?.trim() || labels.ownerUnassigned;
  const requesterName = matter.requester_name?.trim() || labels.requesterUnknown;
  const department = matter.department?.trim() || undefined;

  return (
    <SectionCard title={labels.title} className={className}>
      <div className="space-y-4">
        <PersonRow
          role={labels.owner}
          name={ownerName}
          userId={matter.owner_user_id}
          subtitle={department ? `${labels.department}: ${department}` : undefined}
          copyLabel={labels.copyId}
          copiedLabel={labels.copied}
        />

        <div className="h-px bg-border/70" aria-hidden />

        <PersonRow
          role={labels.requester}
          name={requesterName}
          userId={matter.requester_user_id}
          copyLabel={labels.copyId}
          copiedLabel={labels.copied}
        />

        <p
          className="truncate border-t border-border/60 pt-2 text-[11px] text-muted-foreground"
          title={matter.created_by || undefined}
        >
          {labels.createdBy(matter.created_by?.trim() || '—')}
        </p>
      </div>
    </SectionCard>
  );
}
