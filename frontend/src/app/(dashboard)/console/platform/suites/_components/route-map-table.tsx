'use client';

import { useMemo, useState } from 'react';
import { Route as RouteIcon, Globe, Lock } from 'lucide-react';
import { StatusBadge } from '@/components/shared/status-badge';
import type { StatusConfig } from '@/lib/status-configs';
import { SearchInput } from '@/components/shared/forms/search-input';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useT } from '@/components/providers/locale-provider';
import type { GatewayRoute } from '@/types/platform';
import { formatRouteContract } from './suite-catalog';

interface RouteMapTableProps {
  /** Live route map (G13). Undefined while loading; empty/error => static note. */
  routes: GatewayRoute[] | undefined;
  loading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  /** True when the live route endpoint failed and we have no live data. */
  usingFallback: boolean;
}

/**
 * §E.3 — Route → entitlement map: read-only table of
 * {prefix, service, entitlement, public, group, contract}. Source is the
 * compiled gateway route slice surfaced by G13 (useGatewayRoutes). When that
 * endpoint is unbuilt/errors the catalog tab still renders from the static
 * fallback, but this raw map needs live data — so we show an explicit error /
 * empty state here rather than a misleading partial table.
 */
export function RouteMapTable({
  routes,
  loading,
  isError,
  error,
  onRetry,
  usingFallback,
}: RouteMapTableProps) {
  const t = useT();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const list = routes ?? [];
    const q = query.trim().toLowerCase();
    const sorted = [...list].sort(
      (a, b) =>
        (a.service ?? '').localeCompare(b.service ?? '') ||
        a.prefix.localeCompare(b.prefix),
    );
    if (!q) return sorted;
    return sorted.filter(
      (r) =>
        r.prefix.toLowerCase().includes(q) ||
        (r.service ?? '').toLowerCase().includes(q) ||
        (r.entitlement ?? '').toLowerCase().includes(q) ||
        (r.group ?? '').toLowerCase().includes(q),
    );
  }, [routes, query]);

  const accessConfig: StatusConfig = {
    public: {
      label: t('platformConsole.suites.routeAccessPublic'),
      color: 'orange',
      icon: Globe,
    },
    protected: {
      label: t('platformConsole.suites.routeAccessProtected'),
      color: 'green',
      icon: Lock,
    },
  };

  if (loading) {
    return <LoadingSkeleton variant="table" count={6} />;
  }

  if (isError && usingFallback) {
    return (
      <ErrorState
        error={error}
        variant={detectVariant(error)}
        title={t('platformConsole.suites.routeMapErrorTitle')}
        message={t('platformConsole.suites.routeMapErrorDesc')}
        onRetry={onRetry}
      />
    );
  }

  if (!routes || routes.length === 0) {
    return (
      <EmptyState
        icon={RouteIcon}
        title={t('platformConsole.suites.routeMapEmpty')}
        description={t('platformConsole.suites.routeMapEmptyDesc')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" id="route-map-caption">
          {t('platformConsole.suites.routeMapDesc')}
        </p>
        <div className="w-full sm:w-72">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('platformConsole.suites.routeMapSearch')}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={RouteIcon}
          title={t('platformConsole.suites.routeMapNoResults')}
          description={t('platformConsole.suites.routeMapNoResultsDesc')}
          size="compact"
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm" aria-describedby="route-map-caption">
            <caption className="sr-only">
              {t('platformConsole.suites.routeMapCaption')}
            </caption>
            <thead>
              <tr className="border-b border-border text-start text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {t('platformConsole.suites.routeColPrefix')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {t('platformConsole.suites.routeColService')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {t('platformConsole.suites.routeColEntitlement')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {t('platformConsole.suites.routeColGroup')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {t('platformConsole.suites.routeColContract')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {t('platformConsole.suites.routeColAccess')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={`${r.service}::${r.prefix}`}
                  className="border-t border-border/60 hover:bg-secondary/30"
                >
                  <td className="px-4 py-2.5">
                    <code className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-caption text-foreground">
                      {r.prefix}
                    </code>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {r.service || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.entitlement ? (
                      <code className="font-mono text-xs text-foreground">
                        {r.entitlement}
                      </code>
                    ) : (
                      <span className="text-muted-foreground">
                        {t('platformConsole.suites.routeCore')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {r.group || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {formatRouteContract(r.contract) || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge
                      status={r.public ? 'public' : 'protected'}
                      config={accessConfig}
                      size="sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
