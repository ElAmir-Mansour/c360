'use client';

/**
 * Premium row treatment for the documents repository list.
 *
 * The shared `DataTable` does not expose a per-row `className` hook, so instead of
 * tinting the whole `<tr>` (rowAccentClass) we carry the row's confidentiality
 * accent into the leading cell: a color-coded document "thumbnail" tile (file
 * glyph seated in a confidentiality-tinted gradient disc) plus a matching
 * `<DocumentConfidentialityChip>` that replaces the raw confidentiality badge.
 *
 * Confidentiality is the document domain's risk axis (public → privileged), so it
 * drives the accent: privileged = danger, confidential = warning, internal = info,
 * public = neutral. All colours come from the shared design-system semantic tokens
 * and `.badge-*` primitives so the treatment re-themes in dark mode and reads as
 * the same product as every other Lex chip.
 *
 * RTL-safe: logical spacing only; the thumbnail and chip flip automatically.
 */

import { File, FileLock2, Lock, Shield, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LexDocumentConfidentiality } from '@/types/suites';

type ConfidentialityTone = 'danger' | 'warning' | 'info' | 'neutral';

interface ConfidentialityStyle {
  tone: ConfidentialityTone;
  icon: LucideIcon;
  /** Tinted gradient + ring for the thumbnail disc. */
  thumb: string;
  /** Shared badge primitive for the chip. */
  badge: string;
}

const CONFIDENTIALITY_STYLE: Record<LexDocumentConfidentiality, ConfidentialityStyle> = {
  privileged: {
    tone: 'danger',
    icon: Lock,
    thumb:
      'bg-error-500/12 text-[hsl(var(--ds-error-500))] ring-error-500/25',
    badge: 'badge-danger',
  },
  confidential: {
    tone: 'warning',
    icon: FileLock2,
    thumb:
      'bg-warning-500/12 text-[hsl(var(--ds-warning-500))] ring-warning-500/25',
    badge: 'badge-warning',
  },
  internal: {
    tone: 'info',
    icon: Shield,
    thumb:
      'bg-info-500/12 text-[hsl(var(--ds-info-500))] ring-info-500/25',
    badge: 'badge-info',
  },
  public: {
    tone: 'neutral',
    icon: ShieldCheck,
    thumb: 'bg-muted/60 text-muted-foreground ring-border/60',
    badge: 'badge-neutral',
  },
};

function resolveStyle(value: LexDocumentConfidentiality): ConfidentialityStyle {
  return CONFIDENTIALITY_STYLE[value] ?? CONFIDENTIALITY_STYLE.internal;
}

/**
 * The color-coded document thumbnail tile. The leading cell's stand-in for a
 * page preview: a file glyph in a confidentiality-tinted gradient disc, with a
 * small lock overlay for privileged documents.
 */
export function DocumentThumb({
  confidentiality,
  className,
}: {
  confidentiality: LexDocumentConfidentiality;
  className?: string;
}) {
  const style = resolveStyle(confidentiality);
  const Icon = style.icon;
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset',
        'duration-fast ease-standard',
        style.thumb,
        className,
      )}
    >
      <File className="h-[18px] w-[18px]" />
      {confidentiality === 'privileged' ? (
        <Lock className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full bg-card p-px text-[hsl(var(--ds-error-500))] ring-1 ring-error-500/30" />
      ) : null}
    </span>
  );
}

/**
 * Confidentiality chip built on the shared `.badge-*` primitives, with a leading
 * icon so meaning is never colour-alone (WCAG 1.4.1).
 */
export function DocumentConfidentialityChip({
  confidentiality,
  label,
  className,
}: {
  confidentiality: LexDocumentConfidentiality;
  label: string;
  className?: string;
}) {
  const style = resolveStyle(confidentiality);
  const Icon = style.icon;
  return (
    <span className={cn('badge-base inline-flex items-center gap-1', style.badge, className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}
