/**
 * RoleHolderChip — a compact, reusable avatar + name chip that resolves a raw
 * `user_id` to a named person via the shared people directory.
 *
 * Graceful degradation chain (never renders a bare blank):
 *   resolved person  →  provided `label`  →  the raw `userId`
 *
 * The chip is intentionally self-contained: it owns its own directory lookup
 * (the hook is cache-shared, so mounting many chips triggers a single fetch) and
 * shows initials in a styled avatar fallback while the directory loads. It is
 * used both in the responsibility-directory table and, by the orchestrator, in
 * the entity detail role list.
 */
'use client';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { LocalizedText } from '@/types/forms';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { usePeopleDirectory } from '../../_lib/org-people';
import { peopleLabels } from '../../_lib/people-i18n';

export interface RoleHolderChipProps {
  /** Raw org-role user id to resolve. */
  userId: string;
  /** Optional bilingual fallback label (used when the user can't be resolved). */
  label?: LocalizedText;
  /** Compact (`sm`) for dense tables, `md` for detail panels. Defaults to `md`. */
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE_TOKENS = {
  sm: {
    avatar: 'h-7 w-7',
    initials: 'text-caption',
    name: 'text-xs',
    subtitle: 'text-caption',
    gap: 'gap-2',
  },
  md: {
    avatar: 'h-9 w-9',
    initials: 'text-xs',
    name: 'text-sm',
    subtitle: 'text-xs',
    gap: 'gap-2.5',
  },
} as const;

function RoleHolderChip({ userId, label, size = 'md', className }: RoleHolderChipProps) {
  const { locale } = useLocaleOrDefault();
  const t = locale === 'ar' ? peopleLabels.ar : peopleLabels.en;
  const directory = usePeopleDirectory();

  const resolved = directory.has(userId);
  const fallbackLabel = resolveLocalized(label, locale);

  // Primary line: person name → provided label → raw id.
  const primary = resolved
    ? directory.fullName(userId)
    : fallbackLabel || userId;

  // Subtitle: email when resolved; otherwise the unresolved hint (only when we
  // actually fell back to the id, not when a friendly label was supplied).
  const email = directory.email(userId);
  const usedRawId = !resolved && !fallbackLabel;
  const subtitle = resolved
    ? email ?? t.chip.unknownEmail
    : usedRawId
      ? t.chip.unresolved
      : undefined;

  const tokens = SIZE_TOKENS[size];
  const initials = resolved ? directory.initials(userId) : deriveFallbackInitials(primary);

  return (
    <span
      className={cn('inline-flex min-w-0 items-center', tokens.gap, className)}
      title={resolved ? `${primary}${email ? ` · ${email}` : ''}` : t.chip.unresolved}
    >
      <Avatar className={cn(tokens.avatar, 'border border-border/60')}>
        <AvatarFallback
          className={cn(
            'bg-primary/10 font-semibold uppercase text-primary',
            tokens.initials,
          )}
        >
          {initials}
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={cn('truncate font-medium text-foreground', tokens.name)}>
          {primary}
        </span>
        {subtitle ? (
          <span className={cn('truncate text-muted-foreground', tokens.subtitle)}>
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** Initials for the unresolved fallback path (label or id, no directory entry). */
function deriveFallbackInitials(display: string): string {
  const tokens = display
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return '?';
  }
  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
}

export default RoleHolderChip;
