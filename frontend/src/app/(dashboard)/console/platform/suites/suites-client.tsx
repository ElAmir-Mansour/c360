'use client';

import { useMemo, useState } from 'react';
import { Boxes, Building2, KeyRound, ShieldAlert } from 'lucide-react';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { KpiCard } from '@/components/shared/kpi-card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useT } from '@/components/providers/locale-provider';
import {
  useGatewayRoutes,
  useFleetHealth,
  useAdminTenants,
} from '@/hooks/use-platform';
import type { AdminTenantSummary, FleetService } from '@/types/platform';
import {
  deriveCatalogFromRoutes,
  contractForSuite,
  type SuiteDescriptor,
} from './_components/suite-catalog';
import { SuiteCard } from './_components/suite-card';
import { RouteMapTable } from './_components/route-map-table';

/**
 * Interactive body of the Platform Suites hub. Owns every client hook
 * (gateway-route / fleet-health / tenant queries + tab state) so the server
 * `page.tsx` shell can stay static (metadata + Suspense fallback).
 * See docs/frontend/rsc-shell-pattern.md.
 */
export function PlatformSuitesClient() {
  // The /platform layout already wraps in <PermissionRedirect admin:console>,
  // but keep the page self-sufficient if mounted standalone.
  return (
    <PermissionRedirect permission="admin:console">
      <SuitesBody />
    </PermissionRedirect>
  );
}

/** Match a suite to its backing fleet service by binary name (§A.3 service column). */
function matchFleet(
  suite: SuiteDescriptor,
  services: FleetService[] | undefined,
): FleetService | undefined {
  if (!services) return undefined;
  return services.find(
    (s) => s.name === suite.service || s.name === suite.id || s.suite === suite.id,
  );
}

function SuitesBody() {
  const t = useT();
  const [tab, setTab] = useState<'catalog' | 'routes'>('catalog');

  // G13 — gateway route map (source of truth). On error we fall back to the
  // static §A.3 catalog, so a route-map gap never blanks the screen.
  const routesQuery = useGatewayRoutes();
  // G1 — fleet health drives the per-suite health badge.
  const fleetQuery = useFleetHealth();
  // G2 — every tenant, for the expand → per-tenant toggle list.
  const tenantsQuery = useAdminTenants({ per_page: 200 });

  const catalog = useMemo(
    () => deriveCatalogFromRoutes(routesQuery.data),
    [routesQuery.data],
  );

  const services = fleetQuery.data?.services;
  const tenants: AdminTenantSummary[] = tenantsQuery.data?.data ?? [];

  // KPI row (§E.3): # suites · # tenants · total active entitlements · suites
  // with a health alert. "Active entitlements" ≈ suites × tenants (each tenant
  // holds every suite by default unless an override revokes it); we report the
  // catalog × estate product as the headline, refined per-suite on expand.
  const suiteCount = catalog.length;
  const tenantCount =
    tenantsQuery.data?.meta?.total ?? tenants.length;
  const activeEntitlements = suiteCount * tenantCount;
  const healthAlerts = catalog.filter((s) => {
    const f = matchFleet(s, services);
    return f && (f.status === 'unhealthy' || f.status === 'degraded');
  }).length;

  // Only the tenants query is fatal for the catalog body (we always have a
  // catalog via fallback). Route/fleet errors degrade gracefully inline.
  const catalogReady = !tenantsQuery.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('platformConsole.eyebrow')}
        title={t('platformConsole.suites.title')}
        description={t('platformConsole.suites.subtitle')}
        tags={
          routesQuery.isError
            ? [
                {
                  label: t('platformConsole.suites.staticFallback'),
                  tone: 'warning',
                },
              ]
            : undefined
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t('platformConsole.suites.kpiSuites')}
          value={suiteCount}
          icon={Boxes}
          tone="emerald"
          loading={routesQuery.isLoading}
        />
        <KpiCard
          title={t('platformConsole.suites.kpiTenants')}
          value={tenantCount}
          icon={Building2}
          tone="sky"
          loading={tenantsQuery.isLoading}
        />
        <KpiCard
          title={t('platformConsole.suites.kpiEntitlements')}
          value={activeEntitlements}
          icon={KeyRound}
          tone="gold"
          loading={routesQuery.isLoading || tenantsQuery.isLoading}
        />
        <KpiCard
          title={t('platformConsole.suites.kpiHealthAlerts')}
          value={healthAlerts}
          icon={ShieldAlert}
          tone={healthAlerts > 0 ? 'rose' : 'slate'}
          loading={fleetQuery.isLoading}
        />
      </div>

      {/* Catalog + route-map tabs (§E.3) */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as 'catalog' | 'routes')}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="catalog">
            {t('platformConsole.suites.tabCatalog')}
          </TabsTrigger>
          <TabsTrigger value="routes">
            {t('platformConsole.suites.tabRouteMap')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalog">
          {tenantsQuery.isError ? (
            <ErrorState
              error={tenantsQuery.error}
              variant={detectVariant(tenantsQuery.error)}
              onRetry={() => tenantsQuery.refetch()}
            />
          ) : !catalogReady ? (
            <div className="space-y-4">
              <LoadingSkeleton variant="card" count={3} />
            </div>
          ) : catalog.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title={t('platformConsole.suites.empty')}
              description={t('platformConsole.suites.emptyDesc')}
            />
          ) : (
            <div className="space-y-4">
              {catalog.map((suite) => (
                <SuiteCard
                  key={suite.entitlement}
                  suite={suite}
                  contract={contractForSuite(suite, routesQuery.data)}
                  fleet={matchFleet(suite, services)}
                  tenants={tenants}
                  tenantsLoading={tenantsQuery.isLoading}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="routes">
          <RouteMapTable
            routes={routesQuery.data}
            loading={routesQuery.isLoading}
            isError={routesQuery.isError}
            error={routesQuery.error}
            onRetry={() => routesQuery.refetch()}
            usingFallback={routesQuery.isError || !routesQuery.data}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
