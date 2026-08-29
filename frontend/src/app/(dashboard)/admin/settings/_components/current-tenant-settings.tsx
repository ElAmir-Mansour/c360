'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Building2, Palette, Settings2 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { KpiCard } from '@/components/shared/kpi-card';
import { RelativeTime } from '@/components/shared/relative-time';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { useTenant, useTenants, useTenantUsage } from '@/hooks/use-tenants';
import { tenantPlanConfig, tenantStatusConfig } from '@/lib/status-configs';
import { TenantBrandingForm } from '../../tenants/[tenantId]/_components/tenant-branding-form';
import { TenantSettingsForm } from '../../tenants/[tenantId]/_components/tenant-settings-form';
import { useAdminLabels } from '../../_lib/admin-i18n';

function formatStorage(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  }

  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)} MB`;
}

export function CurrentTenantSettings() {
  const labels = useAdminLabels();
  const ps = labels.platformSettings;
  const { user, hasPermission } = useAuth();
  const isSuperAdmin = hasPermission('*');
  const ownTenantId = user?.tenant_id ?? null;
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const tenantId = selectedTenantId ?? ownTenantId;

  // Fetch tenant list for super-admin picker
  const { data: tenantsPage } = useTenants(
    isSuperAdmin ? { page: 1, per_page: 100 } : undefined,
  );
  const tenantOptions = tenantsPage?.data ?? [];

  const {
    data: tenant,
    isLoading: tenantLoading,
    error: tenantError,
    refetch: refetchTenant,
  } = useTenant(tenantId ?? '', false);
  const {
    data: usage,
    isLoading: usageLoading,
    refetch: refetchUsage,
  } = useTenantUsage(tenantId ?? '');

  const enabledSuites = tenant?.settings?.enabled_suites ?? [];

  if (!tenantId) {
    return (
      <PermissionRedirect permission="tenant:write">
        <ErrorState
          title={labels.platformSettings.contextUnavailableTitle}
          message={labels.platformSettings.contextUnavailableMessage}
        />
      </PermissionRedirect>
    );
  }

  if (tenantLoading) {
    return (
      <PermissionRedirect permission="tenant:write">
        <div className="space-y-6">
          <LoadingSkeleton variant="card" count={1} />
          <LoadingSkeleton variant="card" count={3} />
        </div>
      </PermissionRedirect>
    );
  }

  if (tenantError || !tenant) {
    return (
      <PermissionRedirect permission="tenant:write">
        <ErrorState
          title={labels.platformSettings.loadFailedTitle}
          message={tenantError?.message ?? labels.platformSettings.loadFailedMessage}
          onRetry={() => {
            void refetchTenant();
            void refetchUsage();
          }}
        />
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="tenant:write">
      <div className="space-y-6">
        <PageHeader
          title={labels.platformSettings.title}
          description={labels.platformSettings.description}
          actions={
            <div className="flex items-center gap-3">
              {isSuperAdmin && tenantOptions.length > 1 && (
                <Select
                  value={tenantId ?? ''}
                  onValueChange={(v) => setSelectedTenantId(v === ownTenantId ? null : v)}
                >
                  <SelectTrigger className="w-[220px] h-9 text-sm">
                    <SelectValue placeholder={labels.platformSettings.selectTenant} />
                  </SelectTrigger>
                  <SelectContent>
                    {tenantOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}{t.id === ownTenantId ? ps.currentSuffix : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/tenants/${tenant.id}`}>
                  {labels.platformSettings.openRecord}
                  <ArrowRight className="ms-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <KpiCard
            title={labels.platformSettings.kpiStatus}
            value={tenant.status}
            description={tenant.domain ?? tenant.slug}
            icon={Building2}
            tone="slate"
            loading={tenantLoading}
          />
          <KpiCard
            title={labels.platformSettings.kpiSubscription}
            value={tenant.subscription_tier}
            description={ps.kpiSuitesEnabled.replace('{count}', String(enabledSuites.length))}
            icon={Settings2}
            tone="slate"
            loading={tenantLoading}
          />
          <KpiCard
            title={labels.platformSettings.kpiStorageUsed}
            value={usage ? formatStorage(usage.storage_used_bytes ?? 0) : labels.common.unavailable}
            description={
              tenant.settings?.max_storage_gb
                ? ps.kpiStorageLimit.replace('{value}', String(tenant.settings.max_storage_gb))
                : labels.platformSettings.kpiStorageNoLimit
            }
            icon={Palette}
            tone="sky"
            loading={usageLoading}
          />
          <KpiCard
            title={labels.platformSettings.kpiActiveUsers}
            value={usage?.active_users ?? 0}
            description={tenant.settings?.max_users ? ps.kpiUserLimit.replace('{value}', String(tenant.settings.max_users)) : labels.platformSettings.kpiNoUserLimit}
            icon={Building2}
            tone="sky"
            loading={usageLoading}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-3">
              {tenant.name}
              <StatusBadge status={tenant.status} config={tenantStatusConfig} />
              <StatusBadge status={tenant.subscription_tier} config={tenantPlanConfig} variant="outline" />
            </CardTitle>
            <CardDescription>{labels.platformSettings.recordDescription}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-muted-foreground">{labels.platformSettings.tenantId}</p>
              <p className="mt-1 font-mono text-xs">{tenant.id}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{labels.platformSettings.slug}</p>
              <p className="mt-1 font-medium">{tenant.slug}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{labels.platformSettings.created}</p>
              <p className="mt-1 font-medium">
                <RelativeTime date={tenant.created_at} />
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{labels.platformSettings.updated}</p>
              <p className="mt-1 font-medium">
                <RelativeTime date={tenant.updated_at} />
              </p>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="settings" className="space-y-6">
          <TabsList>
            <TabsTrigger value="settings">{labels.platformSettings.tabs.configuration}</TabsTrigger>
            <TabsTrigger value="branding">{labels.platformSettings.tabs.branding}</TabsTrigger>
            <TabsTrigger value="usage">{labels.platformSettings.tabs.usage}</TabsTrigger>
          </TabsList>

          <TabsContent value="settings">
            <TenantSettingsForm
              tenant={tenant}
              onSuccess={() => {
                void refetchTenant();
                void refetchUsage();
              }}
            />
          </TabsContent>

          <TabsContent value="branding">
            <TenantBrandingForm
              tenant={tenant}
              onSuccess={() => {
                void refetchTenant();
              }}
            />
          </TabsContent>

          <TabsContent value="usage">
            <Card>
              <CardHeader>
                <CardTitle>{labels.platformSettings.usageTitle}</CardTitle>
                <CardDescription>{labels.platformSettings.usageDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <KpiCard title={labels.platformSettings.usageApiCalls} value={usage?.api_calls ?? 0} tone="sky" loading={usageLoading} />
                  <KpiCard title={labels.platformSettings.usageBandwidth} value={usage ? formatStorage(usage.bandwidth_bytes ?? 0) : labels.common.unavailable} tone="sky" loading={usageLoading} />
                  <KpiCard title={labels.platformSettings.usageEnabledSuites} value={enabledSuites.length} description={enabledSuites.join(', ') || labels.common.none} tone="slate" />
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">{labels.platformSettings.suiteUsageHeading}</h3>
                  {usage && Object.keys(usage.suite_usage ?? {}).length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {Object.entries(usage.suite_usage).map(([suite, item]) => (
                        <div key={suite} className="rounded-xl border p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium capitalize">{suite}</p>
                            <span className="text-xs text-muted-foreground">
                              {item.last_accessed ? <RelativeTime date={item.last_accessed} /> : labels.platformSettings.noRecentActivity}
                            </span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <p className="text-muted-foreground">{labels.platformSettings.suiteApiCalls}</p>
                              <p className="font-semibold">{item.api_calls}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">{labels.platformSettings.suiteActiveUsers}</p>
                              <p className="font-semibold">{item.active_users}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{labels.platformSettings.usageUnavailable}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PermissionRedirect>
  );
}
