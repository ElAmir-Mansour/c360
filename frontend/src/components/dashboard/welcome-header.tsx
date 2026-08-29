'use client';

import { format } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';

export function WelcomeHeader() {
  const { user, tenant } = useAuth();
  const firstName = user?.first_name || user?.email?.split('@')[0] || 'there';
  const today = format(new Date(), 'MMMM d, yyyy');

  return (
    <div className="relative overflow-hidden rounded-softest border border-[color:var(--panel-border)] bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(19,49,42,0.95))] px-6 py-7 text-white shadow-elevation-1">
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/3 bg-[radial-gradient(circle_at_center,rgba(250,204,21,0.18),transparent_56%)] lg:block" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-card/10 px-3 py-1 text-overline font-semibold uppercase tracking-caps-wide text-primary/50">
            <span className="h-2 w-2 rounded-full bg-primary/70" aria-hidden="true" />
            Operational Overview
          </span>
          <div>
            <h1 className="text-h1 font-semibold">
              Welcome back, {firstName}.
            </h1>
            {tenant && (
              <p className="mt-2 max-w-2xl text-sm leading-7 text-foreground/30 sm:text-base">
                Monitoring cross-suite activity for {tenant.name}.
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 rounded-3xl border border-white/10 bg-card/8 px-5 py-4 backdrop-blur-sm">
          <p className="text-overline font-semibold uppercase tracking-caps-wide text-foreground/30">
            Today
          </p>
          <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
            {today}
          </p>
        </div>
      </div>
    </div>
  );
}
