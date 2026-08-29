'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, Eye, Settings } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { LEX_ADMIN_NAV_PERMISSIONS } from '@/lib/permissions';
import { useAdminHomeLabels } from './_lib/admin-labels';
import { AdminHealthDashboard } from './_components/admin-health-dashboard';
import {
  ADMIN_HUB_CARDS,
  getAdminHubLabels,
  resolveCardState,
  type AdminCardState,
} from './_lib/admin-hub-cards';

/** Maps a kpi-theme key to the icon-badge + left-accent classes (literal strings for Tailwind JIT). */
const THEME_BADGE: Record<string, string> = {
  sky: 'kpi-theme-sky',
  emerald: 'kpi-theme-emerald',
  amber: 'kpi-theme-amber',
  violet: 'kpi-theme-violet',
  rose: 'kpi-theme-pink',
  teal: 'kpi-theme-teal',
  indigo: 'kpi-theme-indigo',
  cyan: 'kpi-theme-cyan',
};

/** State pill: READ_ONLY shows a "View only" badge, MANAGEABLE a "Manage" badge. */
function StateBadge({
  state,
  label,
}: {
  state: Exclude<AdminCardState, 'HIDDEN'>;
  label: string;
}) {
  const manageable = state === 'MANAGEABLE';
  return (
    <StatusBadge
      status={state}
      tone={manageable ? 'success' : 'neutral'}
      label={label}
      icon={manageable ? Settings : Eye}
      size="sm"
      data-testid={`card-state-${state}`}
    />
  );
}

export default function LexAdminPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const t = useAdminHomeLabels();
  const hub = useMemo(() => getAdminHubLabels(locale), [locale]);

  // §13: resolve each card to HIDDEN / READ_ONLY / MANAGEABLE from the caller's
  // effective permissions, then drop the hidden ones. The §8.7 route guards on
  // each destination remain the boundary; this only shapes the hub.
  const visibleCards = useMemo(
    () =>
      ADMIN_HUB_CARDS.map((card) => ({
        card,
        state: resolveCardState(hasPermission, card),
      })).filter((entry) => entry.state !== 'HIDDEN'),
    [hasPermission],
  );

  const hasAnyManage = visibleCards.some((e) => e.state === 'MANAGEABLE');

  return (
    <LexAccessGuard
      requirement={LEX_ADMIN_NAV_PERMISSIONS.group}
      resourceName={t.pageTitle}
    >
      <div dir={direction} lang={locale} className="space-y-6 motion-safe:animate-fade-up">
        <PageHeader title={t.pageTitle} description={t.pageDescription} eyebrow={t.eyebrow} />

        {visibleCards.length > 0 && !hasAnyManage ? (
          <div className="rounded-lg border border-warning-300/60 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:border-warning-700/60 dark:bg-warning-700/15 dark:text-warning-300">
            {t.readOnlyNotice}
          </div>
        ) : null}

        {/* Health linter is config oversight; show it whenever any card is visible. */}
        {visibleCards.length > 0 ? <AdminHealthDashboard /> : null}

        {visibleCards.length === 0 ? (
          <div
            data-testid="admin-hub-empty"
            className="card flex flex-col items-center gap-2 p-10 text-center"
          >
            <h2 className="text-h4 font-semibold text-foreground">{hub.emptyTitle}</h2>
            <p className="max-w-md text-sm text-muted-foreground">{hub.emptyBody}</p>
          </div>
        ) : (
          <div
            data-testid="admin-hub-grid"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {visibleCards.map(({ card, state }, index) => {
              const Icon = card.icon;
              const label = hub.cards[card.id];
              const stateLabel =
                state === 'MANAGEABLE' ? hub.state.manage : hub.state.readOnly;
              return (
                <Link
                  key={card.id}
                  href={card.href}
                  data-testid={`admin-card-${card.id}`}
                  data-card-state={state}
                  className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-safe:animate-fade-up"
                  style={{ animationDelay: `${Math.min(index * 55, 440)}ms` }}
                >
                  <div
                    className={cn(
                      'kpi-card-themed card-interactive relative h-full overflow-hidden p-5',
                      THEME_BADGE[card.theme] ?? 'kpi-theme-primary',
                    )}
                  >
                    <span
                      className="absolute inset-y-0 start-0 z-[1] w-1 bg-[var(--kpi-accent)]"
                      aria-hidden
                    />
                    <div className="flex items-start gap-3.5">
                      <span className="kpi-icon-badge motion-safe:duration-fast motion-safe:ease-emphasized">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-base font-semibold tracking-tight text-foreground">
                            {label?.title ?? card.id}
                          </h3>
                          <StateBadge
                            state={state as Exclude<AdminCardState, 'HIDDEN'>}
                            label={stateLabel}
                          />
                        </div>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {label?.description}
                        </p>
                      </div>
                    </div>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                      {hub.open}
                      <ArrowRight
                        className="h-4 w-4 transition-transform duration-fast ease-standard group-hover:translate-x-0.5 rtl:-scale-x-100"
                        aria-hidden
                      />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </LexAccessGuard>
  );
}
