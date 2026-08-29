'use client';

// Platform Console — Screen 2: Tenant detail (§E.2). Reuses the tabbed shell
// pattern from admin/tenants/[tenantId] extended with License (single-tenant
// license, EXISTS), Suites (resolved entitlements G10 + overrides G9) and an
// AI tab (G23, P2). Users/Audit tabs deep-link into the platform Identity/Audit
// screens scoped to this tenant. Overview KPIs come from the EXISTS tenant usage
// endpoint. The /platform/layout gates on `admin:console`, so no PermissionRedirect.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  KeyRound,
  Boxes,
  Users,
  ClipboardList,
  Brain,
  HardDrive,
  Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { RelativeTime } from '@/components/shared/relative-time';
import { tenantStatusConfig, tenantPlanConfig } from '@/lib/status-configs';
import { formatBytes, formatNumber } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import { useTenant, useTenantUsage } from '@/hooks/use-tenants';
import {
  useAdminTenant,
  useTenantEntitlements,
  useTenantOverrides,
  useTenantAiSummary,
} from '@/hooks/use-platform';
import type { TenantEntitlement, Override } from '@/types/platform';
import { useTenantLicense } from './use-tenant-license';
import { useLicenseStateConfig } from '../../_components/license-state-config';
import { TenantRowActions } from '../../_components/tenant-row-actions';

interface Props {
  tenantId: string;
}

// Widen for the lightweight SimpleTable's Record<string, unknown> row constraint.
type EntitlementRow = TenantEntitlement & Record<string, unknown>;
type OverrideRow = Override & Record<string, unknown>;

export function PlatformTenantDetail({ tenantId }: Props) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultTab = searchParams?.get('tab') ?? 'overview';

  const licenseStateConfig = useLicenseStateConfig();
  const { data: tenant, isLoading, error, refetch } = useTenant(tenantId, false);
  // The admin summary (AdminTenantSummary) carries the lifecycle status + slug
  // that <TenantRowActions/> needs for its status-aware menu and type-to-confirm
  // guard. useTenant returns the plain Tenant shape, so we fetch the single-
  // tenant summary directly (GET /admin/tenants/{id}) — this resolves for ANY
  // tenant regardless of which list page is cached.
  const { data: tenantSummary } = useAdminTenant(tenantId);
  const usage = useTenantUsage(tenantId);
  const license = useTenantLicense(tenantId);
  const entitlements = useTenantEntitlements(tenantId);
  const overrides = useTenantOverrides(tenantId);
  const ai = useTenantAiSummary(tenantId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton variant="card" className="h-32" label={t('platformConsole.tenants.loadingTenant')} />
        <LoadingSkeleton variant="kpi" count={4} />
        <LoadingSkeleton variant="detail" />
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <ErrorState
        variant={error ? detectVariant(error) : 'notFound'}
        error={error ?? undefined}
        message={error?.message ?? t('platformConsole.tenants.loadFailed')}
        onRetry={() => refetch()}
      />
    );
  }

  const u = usage.data;
  const lic = license.data;
  const aiKpis = ai.data?.kpis;

  const sourceLabel = (source: TenantEntitlement['source']) =>
    source === 'override'
      ? t('platformConsole.tenants.sourceOverride')
      : t('platformConsole.tenants.sourcePlan');

  const entitlementColumns: Column<TenantEntitlement>[] = [
    {
      key: 'key',
      header: t('platformConsole.tenants.entitlement'),
      render: (e) => (
        <span className="text-sm font-medium">
          {e.label ?? e.key}
          <code className="ms-2 text-xs font-mono text-muted-foreground">{e.key}</code>
        </span>
      ),
    },
    {
      key: 'enabled',
      header: t('platformConsole.tenants.stateColumn'),
      render: (e) => (
        <StatusBadge
          status={e.enabled ? 'active' : 'suspended'}
          config={licenseStateConfig}
          size="sm"
        />
      ),
    },
    {
      key: 'limit',
      header: t('platformConsole.tenants.limit'),
      align: 'right',
      render: (e) =>
        e.limit == null ? (
          <span className="text-muted-foreground">{t('platformConsole.tenants.unlimited')}</span>
        ) : (
          <span className="tabular-nums text-sm">{formatNumber(e.limit)}</span>
        ),
    },
    {
      key: 'used',
      header: t('platformConsole.tenants.used'),
      align: 'right',
      render: (e) => (
        <span className="tabular-nums text-sm">{formatNumber(e.used ?? 0)}</span>
      ),
    },
    {
      key: 'source',
      header: t('platformConsole.tenants.source'),
      render: (e) => (
        <span className="text-xs text-muted-foreground">{sourceLabel(e.source)}</span>
      ),
    },
  ];

  const overrideColumns: Column<Override>[] = [
    {
      key: 'key',
      header: t('platformConsole.tenants.override'),
      render: (o) => <code className="text-xs font-mono">{o.key}</code>,
    },
    {
      key: 'limit',
      header: t('platformConsole.tenants.limit'),
      align: 'right',
      render: (o) => (
        <span className="tabular-nums text-sm">
          {o.limit === 0 ? (
            <span className="text-destructive">{t('platformConsole.tenants.revoked')}</span>
          ) : (
            formatNumber(o.limit)
          )}
        </span>
      ),
    },
    {
      key: 'reason',
      header: t('platformConsole.tenants.reasonColumn'),
      render: (o) => <span className="text-sm text-muted-foreground">{o.reason ?? '—'}</span>,
    },
    {
      key: 'set_at',
      header: t('platformConsole.tenants.setColumn'),
      render: (o) =>
        o.set_at ? <RelativeTime date={o.set_at} /> : <span className="text-muted-foreground">—</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/platform/tenants" aria-label={t('platformConsole.tenants.backToTenants')}>
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </Button>
        <PageHeader
          eyebrow={t('platformConsole.eyebrow')}
          title={
            <div className="flex items-center gap-3">
              {tenant.name}
              <StatusBadge status={tenant.status} config={tenantStatusConfig} />
              <StatusBadge
                status={tenant.subscription_tier}
                config={tenantPlanConfig}
                variant="outline"
              />
            </div>
          }
          description={
            <span>
              <code className="text-xs font-mono">{tenant.slug}</code>
              {tenant.domain && (
                <span className="ms-2 text-muted-foreground">· {tenant.domain}</span>
              )}
            </span>
          }
          actions={
            // Lifecycle action menu (suspend/unsuspend/reprovision/deprovision/
            // reactivate/impersonate) — the same <TenantRowActions/> used on the
            // list, gated by the /platform layout's `admin:console` guard. Shown
            // once the admin summary (status + slug) resolves. onView navigates to
            // this tenant's detail (self), matching the list's view semantics.
            tenantSummary ? (
              <TenantRowActions
                tenant={tenantSummary}
                onView={(tnt) => router.push(`/platform/tenants/${tnt.id}`)}
              />
            ) : undefined
          }
        />
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <Building2 className="h-4 w-4" aria-hidden />
            {t('platformConsole.tenants.tabOverview')}
          </TabsTrigger>
          <TabsTrigger value="license" className="gap-2">
            <KeyRound className="h-4 w-4" aria-hidden />
            {t('platformConsole.tenants.tabLicense')}
          </TabsTrigger>
          <TabsTrigger value="suites" className="gap-2">
            <Boxes className="h-4 w-4" aria-hidden />
            {t('platformConsole.tenants.tabSuites')}
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" aria-hidden />
            {t('platformConsole.tenants.tabUsers')}
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <ClipboardList className="h-4 w-4" aria-hidden />
            {t('platformConsole.tenants.tabAudit')}
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-2">
            <Brain className="h-4 w-4" aria-hidden />
            {t('platformConsole.tenants.tabAi')}
          </TabsTrigger>
        </TabsList>

        {/* Overview — usage KPIs (EXISTS) + tenant info. */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <DetailStatCard
              label={t('platformConsole.tenants.activeUsers')}
              value={u ? formatNumber(u.active_users ?? 0) : '—'}
              tone="sky"
              icon={Users}
            />
            <DetailStatCard
              label={t('platformConsole.tenants.apiCalls')}
              value={u ? formatNumber(u.api_calls ?? 0) : '—'}
              tone="emerald"
              icon={Activity}
            />
            <DetailStatCard
              label={t('platformConsole.tenants.storageUsed')}
              value={u ? formatBytes(u.storage_used_bytes ?? 0) : '—'}
              tone="gold"
              icon={HardDrive}
            />
            <DetailStatCard
              label={t('platformConsole.tenants.bandwidth')}
              value={u ? formatBytes(u.bandwidth_bytes ?? 0) : '—'}
              tone="slate"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('platformConsole.tenants.tenantInformation')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t('platformConsole.tenants.tenantId')}</dt>
                  <dd className="mt-1 font-mono text-xs">{tenant.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('platformConsole.tenants.tier')}</dt>
                  <dd className="mt-1 capitalize">{tenant.subscription_tier}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('platformConsole.tenants.created')}</dt>
                  <dd className="mt-1">
                    <RelativeTime date={tenant.created_at} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('platformConsole.tenants.lastUpdated')}</dt>
                  <dd className="mt-1">
                    <RelativeTime date={tenant.updated_at} />
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {u?.suite_usage && Object.keys(u.suite_usage).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('platformConsole.tenants.suiteUsage')}</CardTitle>
                <CardDescription>{t('platformConsole.tenants.suiteUsageDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(u.suite_usage).map(([key, su]) => (
                    <div key={key} className="rounded-lg border p-4">
                      <p className="text-sm font-medium capitalize">{su.suite}</p>
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <p>{t('platformConsole.tenants.apiCalls')}: {formatNumber(su.api_calls)}</p>
                        <p>{t('platformConsole.tenants.activeUsers')}: {formatNumber(su.active_users)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* License — plan, seats, state, expiry/grace (EXISTS) + overrides (G9). */}
        <TabsContent value="license" className="space-y-6">
          {license.isLoading ? (
            <LoadingSkeleton variant="card" className="h-32" />
          ) : license.error ? (
            <ErrorState
              variant={detectVariant(license.error)}
              error={license.error}
              message={license.error.message}
              onRetry={() => license.refetch()}
            />
          ) : !lic ? (
            <EmptyState
              icon={KeyRound}
              title={t('platformConsole.tenants.noLicense')}
              description={t('platformConsole.tenants.noLicenseDesc')}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <DetailStatCard label={t('platformConsole.tenants.plan')} value={lic.plan_name ?? lic.plan_key ?? '—'} tone="slate" />
              <DetailStatCard
                label={t('platformConsole.tenants.licenseState')}
                value={
                  lic.state ? (
                    <StatusBadge status={lic.state} config={licenseStateConfig} size="sm" />
                  ) : (
                    '—'
                  )
                }
                tone="emerald"
              />
              <DetailStatCard
                label={t('platformConsole.tenants.seats')}
                value={
                  lic.seats == null
                    ? '—'
                    : `${formatNumber(lic.seats_used ?? 0)} / ${formatNumber(lic.seats)}`
                }
                tone="gold"
              />
              <DetailStatCard
                label={t('platformConsole.tenants.expires')}
                value={lic.expires_at ? <RelativeTime date={lic.expires_at} /> : '—'}
                helper={lic.grace_until ? t('platformConsole.tenants.licenseInGrace') : undefined}
                tone="rose"
              />
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('platformConsole.licensing.overrides')}</CardTitle>
              <CardDescription>{t('platformConsole.tenants.overridesDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {overrides.error ? (
                <div className="p-4">
                  <ErrorState
                    variant={detectVariant(overrides.error)}
                    error={overrides.error}
                    message={overrides.error.message}
                    onRetry={() => overrides.refetch()}
                  />
                </div>
              ) : (
                <SimpleTable<OverrideRow>
                  columns={overrideColumns as Column<OverrideRow>[]}
                  data={(overrides.data ?? []) as OverrideRow[]}
                  loading={overrides.isLoading}
                  emptyMessage={t('platformConsole.tenants.noOverrides')}
                  getRowKey={(o) => o.key}
                  ariaLabel={t('platformConsole.licensing.overrides')}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Suites — resolved entitlements (G10). */}
        <TabsContent value="suites">
          <Card>
            <CardHeader>
              <CardTitle>{t('platformConsole.suites.title')}</CardTitle>
              <CardDescription>{t('platformConsole.tenants.entitlementsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {entitlements.error ? (
                <div className="p-4">
                  <ErrorState
                    variant={detectVariant(entitlements.error)}
                    error={entitlements.error}
                    message={entitlements.error.message}
                    onRetry={() => entitlements.refetch()}
                  />
                </div>
              ) : (
                <SimpleTable<EntitlementRow>
                  columns={entitlementColumns as Column<EntitlementRow>[]}
                  data={(entitlements.data ?? []) as EntitlementRow[]}
                  loading={entitlements.isLoading}
                  emptyMessage={t('platformConsole.tenants.noEntitlements')}
                  getRowKey={(e) => e.key}
                  ariaLabel={t('platformConsole.suites.title')}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users — deep-link to platform Identity scoped to this tenant. */}
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>{t('platformConsole.identity.userSearch')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t('platformConsole.tenants.usersDeepLinkPrefix')}{' '}
                <Link
                  href={`/platform/identity?tenant_id=${tenantId}`}
                  className="text-primary hover:underline"
                >
                  {t('platformConsole.identity.title')}
                </Link>{' '}
                {t('platformConsole.tenants.deepLinkSuffix')}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Audit — deep-link to platform Audit scoped to this tenant. */}
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>{t('platformConsole.audit.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t('platformConsole.tenants.auditDeepLinkPrefix')}{' '}
                <Link
                  href={`/platform/audit?tenant_id=${tenantId}`}
                  className="text-primary hover:underline"
                >
                  {t('platformConsole.audit.title')}
                </Link>{' '}
                {t('platformConsole.tenants.deepLinkSuffix')}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI (P2) — per-tenant AI summary (G23). */}
        <TabsContent value="ai" className="space-y-6">
          {ai.isLoading ? (
            <LoadingSkeleton variant="kpi" count={4} />
          ) : ai.error ? (
            <ErrorState
              variant={detectVariant(ai.error)}
              error={ai.error}
              message={ai.error.message}
              onRetry={() => ai.refetch()}
            />
          ) : !aiKpis ? (
            <EmptyState
              icon={Brain}
              title={t('platformConsole.tenants.noAiData')}
              description={t('platformConsole.tenants.noAiDataDesc')}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <DetailStatCard
                label={t('platformConsole.ai.totalModels')}
                value={formatNumber(aiKpis.total_models ?? 0)}
                tone="slate"
              />
              <DetailStatCard
                label={t('platformConsole.ai.inProduction')}
                value={formatNumber(aiKpis.in_production ?? 0)}
                tone="emerald"
              />
              <DetailStatCard
                label={t('platformConsole.ai.shadow')}
                value={formatNumber(aiKpis.shadow_testing ?? 0)}
                tone="gold"
              />
              <DetailStatCard
                label={t('platformConsole.ai.driftAlerts')}
                value={formatNumber(aiKpis.drift_alerts ?? 0)}
                tone="rose"
              />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
