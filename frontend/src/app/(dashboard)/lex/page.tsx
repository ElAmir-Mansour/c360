'use client';

import { downloadBlob } from '@/lib/format';
import { createLexDashboardCsv } from '@/lib/lex-watheeq';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { useLocale } from '@/components/providers/locale-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { useLexContext } from '@/lib/lex/use-lex-context';
import { RoleDashboard } from './_components/role-dashboard/role-dashboard';
import { useLexOverviewDashboard } from './_lib/use-lex-command-center';
import landingTheme from './_styles/lex-landing-theme.module.css';

/**
 * Watheeq Legal Affairs landing — a per-ROLE dashboard.
 *
 * The `/lex` landing renders a bespoke dashboard for the caller's active
 * persona (KPI row + role-tailored list/donut/bar/alerts panels), resolved from
 * the server-authoritative role and wired to the live fail-soft command-center
 * data. A user with no recognised persona falls back to the generic legal
 * overview. The dashboard composition lives in `_components/role-dashboard` +
 * `_lib/role-dashboards`; this file only resolves the persona and mounts it.
 */
export default function LexPage() {
  const { locale, direction } = useLocale();
  const dashboardQuery = useLexOverviewDashboard();
  const { activeRole, loading: personaLoading } = useLexContext();

  // CSV export of the contract dashboard. Reuses the SHARED
  // ['lex-overview','dashboard'] fetch (deduped by react-query), so the export
  // action does not trigger an extra round-trip.
  const exportDashboard = () => {
    const dashboard = dashboardQuery.data;
    if (!dashboard) {
      return;
    }
    downloadBlob(
      new Blob([createLexDashboardCsv(dashboard)], {
        type: 'text/csv;charset=utf-8',
      }),
      `watheeq-legal-dashboard-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  return (
    <LexAccessGuard routeKey="/lex">
      {personaLoading ? (
        <LexLandingSkeleton direction={direction} locale={locale} />
      ) : (
        <div
          className={`${landingTheme.root} space-y-6 motion-safe:animate-fade-up`}
          dir={direction}
          lang={locale}
          data-lex-landing-theme="watheeq"
        >
          <RoleDashboard
            roleSlug={activeRole?.slug ?? null}
            onExport={exportDashboard}
            exportDisabled={!dashboardQuery.data}
          />
        </div>
      )}
    </LexAccessGuard>
  );
}

/**
 * Keeps the Watheeq first paint calm while the server-authoritative persona is
 * resolving. This prevents the generic surface from flashing — and avoids
 * mounting its query fan-out — before the user's real role arrives.
 */
function LexLandingSkeleton({
  direction,
  locale,
}: {
  direction: 'ltr' | 'rtl';
  locale: string;
}) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={`${landingTheme.root} space-y-6`}
      dir={direction}
      lang={locale}
      data-testid="lex-landing-skeleton"
      data-lex-landing-theme="watheeq"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32 rounded-soft" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-softest" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Skeleton className="h-72 rounded-softest" />
        <Skeleton className="h-72 rounded-softest" />
      </div>
    </div>
  );
}
