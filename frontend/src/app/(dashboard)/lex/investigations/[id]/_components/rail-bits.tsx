'use client';

/**
 * Tiny shared building blocks for the investigations detail right-rail cards:
 * a deterministic initials avatar (no image URLs exist on this API surface) and
 * a copy-to-clipboard icon button for governance ids. Mirrors the Service Desk
 * `request-people-card.tsx` primitives, extracted so the People + Related rail
 * cards share one implementation.
 */

import { useState } from 'react';
import { CheckCircle2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { showSuccess } from '@/lib/toast';

/** Fixed dark swatches — each verified >= 4.5:1 contrast against white text
 * in both the light and dark app themes. */
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

export function InitialsAvatar({
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

export function CopyIdButton({
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
      // Clipboard write failed (permissions / insecure context) — no
      // destructive UX for a low-stakes copy; the id stays visible/selectable.
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
