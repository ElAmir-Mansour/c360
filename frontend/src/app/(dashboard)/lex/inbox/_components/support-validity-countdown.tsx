'use client';

import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';

import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';

interface SupportValidityCountdownProps {
  createdAt: string;
  expiresAt?: string | null;
  label: string;
  noExpiryLabel: string;
  reachedLabel: string;
  remainingLabel: (relative: string) => string;
  className?: string;
  /** Deterministic seam for tests and gallery states. Live surfaces omit it. */
  now?: number;
}

const CLOCK_TICK_MS = 30_000;

/**
 * A neutral, live support-validity indicator. It intentionally has no SLA,
 * breach, warning, or destructive semantics: expiry only controls inbox
 * visibility and is not a performance judgement.
 */
export function SupportValidityCountdown({
  createdAt,
  expiresAt,
  label,
  noExpiryLabel,
  reachedLabel,
  remainingLabel,
  className,
  now,
}: SupportValidityCountdownProps) {
  const format = useLexFormat();
  const [clock, setClock] = useState(() => now ?? Date.now());

  useEffect(() => {
    if (now !== undefined) {
      setClock(now);
      return;
    }
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(interval);
  }, [now]);

  if (!expiresAt) {
    return (
      <div
        className={cn('flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-foreground', className)}
        role="status"
      >
        <Clock3 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span>{noExpiryLabel}</span>
      </div>
    );
  }

  const createdMs = new Date(createdAt).getTime();
  const expiresMs = new Date(expiresAt).getTime();
  const validDates = Number.isFinite(createdMs) && Number.isFinite(expiresMs) && expiresMs > createdMs;
  const reached = Number.isFinite(expiresMs) && expiresMs <= clock;
  const relative = reached
    ? reachedLabel
    : remainingLabel(format.formatRelative(expiresAt, new Date(clock)));
  const progress = validDates
    ? Math.max(0, Math.min(100, ((expiresMs - clock) / (expiresMs - createdMs)) * 100))
    : 0;
  const formattedExpiry = format.formatDate(expiresAt, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div
      className={cn('w-full rounded-lg border border-border bg-muted/30 px-3 py-2', className)}
      role="group"
      aria-label={label}
    >
      <div className="flex items-start gap-2">
        <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">{relative}</p>
          <p className="mt-0.5 text-xs text-foreground">{formattedExpiry}</p>
        </div>
      </div>
      {validDates ? (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-valuetext={relative}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-normal motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
