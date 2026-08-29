'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { requesterLabels } from '../_lib/requester-i18n';

export interface RequesterFieldProps {
  /** Current requester name held by the parent wizard (`requesterName`). */
  value: string;
  /** Commit a resolved or typed requester name to the parent. */
  onChange: (name: string) => void;
  /** Validation message surfaced by the parent (destructive text). */
  error?: string;
}

/** A small palette of brand-adjacent tints for the initials avatar, picked
 * deterministically from the name so the same person keeps the same color. */
const AVATAR_TINTS = [
  'bg-primary/10 text-primary',
  'bg-brand-teal-500/10 text-brand-teal-700 dark:text-brand-teal-300',
  'bg-warning-500/10 text-warning-800 dark:text-warning-300',
  'bg-brand-accent-500/10 text-brand-accent-700 dark:text-brand-accent-300',
  'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  'bg-success-500/10 text-success-700 dark:text-success-300',
] as const;

function resolveInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function tintForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

/**
 * RequesterField — a COMPACT, read-only requester line for step 2 (per mockup:
 * "Submitting this request as yourself"). Reads the authenticated user and, by
 * default, renders a slim identity chip; it surfaces the resolved name to the
 * parent once on mount when `value` is empty. A subtle toggle lets the user act
 * on behalf of someone else, revealing a free-text input; turning it back off
 * restores the auth-user name. RTL-correct via logical props.
 */
export default function RequesterField({ value, onChange, error }: RequesterFieldProps) {
  const { locale } = useLocaleOrDefault();
  const t = locale === 'ar' ? requesterLabels.ar : requesterLabels.en;
  const { user } = useAuth();

  const resolvedName = useMemo(() => {
    if (!user) return '';
    const composed = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    return (user.full_name?.trim() || composed || user.email || '').trim();
  }, [user]);

  const [onBehalf, setOnBehalf] = useState(false);
  const didSeed = useRef(false);

  const inputId = useId();
  const errorId = `${inputId}-error`;

  // Surface the resolved auth-user name to the parent exactly once when the
  // parent has no value yet and a user is present. Never overwrite a value the
  // parent already holds (e.g. a restored draft).
  useEffect(() => {
    if (didSeed.current) return;
    if (!resolvedName) return;
    if (value.trim().length > 0) {
      didSeed.current = true;
      return;
    }
    didSeed.current = true;
    onChange(resolvedName);
    // value/onChange intentionally excluded: this is a one-shot seed guarded by
    // the didSeed ref; re-running on every keystroke would fight user input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedName]);

  const enterOnBehalf = () => {
    setOnBehalf(true);
    // Clear the prefilled "me" so the user starts from an empty input, but only
    // when it still matches the resolved auth name (don't wipe an edited value).
    if (value.trim() === resolvedName) onChange('');
  };

  const exitOnBehalf = () => {
    setOnBehalf(false);
    onChange(resolvedName);
  };

  const handleToggle = (next: boolean) => {
    if (next) enterOnBehalf();
    else exitOnBehalf();
  };

  // Graceful fallback: no authenticated user resolved — render a plain input so
  // the field is still usable and validated by the parent.
  if (!resolvedName) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>{t.fallbackLabel}</Label>
        <Input
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t.fallbackPlaceholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {error ? (
          <p id={errorId} className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border bg-muted/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              tintForName(resolvedName),
            )}
            role="img"
            aria-label={t.avatarAlt(resolvedName)}
          >
            {resolveInitials(resolvedName) || <UserRound className="h-4 w-4" aria-hidden />}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs text-foreground/70">{t.fieldLabel}:</span>
            {onBehalf ? null : (
              <>
                <span className="truncate text-sm font-medium">{resolvedName}</span>
                <Badge variant="secondary" size="sm">
                  {t.youBadge}
                </Badge>
                {user?.email ? (
                  <span className="truncate text-xs text-foreground/70">· {user.email}</span>
                ) : null}
              </>
            )}
          </div>
        </div>

        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-foreground/70">
          <span>{t.onBehalfToggle}</span>
          <Switch checked={onBehalf} onCheckedChange={handleToggle} aria-label={t.onBehalfToggle} />
        </label>
      </div>

      {onBehalf ? (
        <div className="space-y-1.5">
          <Label htmlFor={inputId} className="sr-only">
            {t.onBehalfInputLabel}
          </Label>
          <Input
            id={inputId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t.onBehalfPlaceholder}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          <p className="text-xs text-muted-foreground">{t.submittedBy(resolvedName)}</p>
        </div>
      ) : (
        <p className="ps-1 text-xs text-muted-foreground">{t.submittingAsYou}</p>
      )}

      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
