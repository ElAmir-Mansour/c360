'use client';

import { useEffect, useState } from 'react';
import { Eye, X } from 'lucide-react';
import { useImpersonationStore } from '@/stores/impersonation-store';
import { useStopImpersonation } from '@/hooks/use-platform';
import { useT } from '@/components/providers/locale-provider';

/**
 * Sticky banner shown while a platform operator is impersonating ("viewing as")
 * a tenant. Surfaces the target tenant, a hard-TTL countdown, and a Stop button
 * (§E.2 hard requirement #5). When the grant expires the banner auto-stops the
 * session so a stale read-only context can't linger. Uses logical-property
 * Tailwind classes (ms-/me-) to stay correct under RTL.
 */
export function ImpersonationBanner() {
  const t = useT();
  const active = useImpersonationStore((s) => s.active);
  const tenantName = useImpersonationStore((s) => s.tenantName);
  const tenantId = useImpersonationStore((s) => s.tenantId);
  const expiresAt = useImpersonationStore((s) => s.expiresAt);
  const stopImpersonation = useStopImpersonation();
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!active || !expiresAt) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const secs = Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
      setRemaining(secs);
      if (secs <= 0) {
        // Hard TTL reached — end the session.
        void stopImpersonation();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, expiresAt, stopImpersonation]);

  if (!active) return null;

  const mm = Math.floor(remaining / 60)
    .toString()
    .padStart(2, '0');
  const ss = (remaining % 60).toString().padStart(2, '0');
  const label = tenantName ?? tenantId ?? '';

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-900 backdrop-blur dark:text-amber-100"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Eye className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate font-medium">
          {t('platformConsole.impersonation.viewingAs').replace('{tenant}', label)}
        </span>
        <span className="rounded-full bg-amber-500/25 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
          {t('platformConsole.impersonation.readOnly')}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-mono tabular-nums text-xs" aria-label={t('platformConsole.impersonation.expiresIn')}>
          {mm}:{ss}
        </span>
        <button
          type="button"
          onClick={() => void stopImpersonation()}
          className="inline-flex items-center gap-1 rounded-md border border-amber-600/40 bg-amber-500/20 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-amber-500/35 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          {t('platformConsole.impersonation.stop')}
        </button>
      </div>
    </div>
  );
}
