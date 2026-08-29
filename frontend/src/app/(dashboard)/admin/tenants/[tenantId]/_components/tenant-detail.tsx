"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  Settings,
  Palette,
  Users,
  ClipboardList,
  ArrowLeft,
  Ban,
  CheckCircle,
  Loader2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/error-state";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { KpiCard } from "@/components/shared/kpi-card";
import { RelativeTime } from "@/components/shared/relative-time";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { tenantStatusConfig, tenantPlanConfig } from "@/lib/status-configs";
import { parseApiError } from "@/lib/format";
import { useTenant, useTenantUsage, useDeprovisionTenant } from "@/hooks/use-tenants";
import { RecordRecent } from "@/hooks/use-recent-items";
import { TenantSettingsForm } from "./tenant-settings-form";
import { TenantBrandingForm } from "./tenant-branding-form";
import api from "@/lib/api";
import Link from "next/link";
import { useAdminLabels } from "../../../_lib/admin-i18n";

interface TenantDetailContentProps {
  tenantId: string;
}

export function TenantDetailContent({ tenantId }: TenantDetailContentProps) {
  const labels = useAdminLabels();
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultTab = searchParams?.get("tab") ?? "overview";

  const [deprovisionOpen, setDeprovisionOpen] = useState(false);
  const deprovisionMutation = useDeprovisionTenant();

  const isTransitionalStatus = (status: string) =>
    status === "onboarding";

  const {
    data: tenant,
    isLoading,
    error,
    refetch,
  } = useTenant(tenantId, false);

  // Enable polling only when tenant is in a transitional state
  const { data: polledTenant } = useTenant(
    tenantId,
    tenant ? isTransitionalStatus(tenant.status) : false,
  );

  const activeTenant = polledTenant ?? tenant;

  const {
    data: usage,
    isLoading: usageLoading,
  } = useTenantUsage(tenantId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton variant="card" className="h-32" label={labels.tenantDetail.loading} />
        <LoadingSkeleton variant="kpi" count={4} />
        <LoadingSkeleton variant="detail" />
      </div>
    );
  }

  if (error || !activeTenant) {
    return (
      <ErrorState
        message={error?.message ?? labels.tenantDetail.loadFailed}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Feeds the global recents (Cmd+K palette Recent section). */}
      <RecordRecent
        type="tenant"
        id={activeTenant.id}
        title={activeTenant.name}
        href={`/admin/tenants/${activeTenant.id}`}
      />
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/tenants" aria-label={labels.common.backToTenants}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader
          title={
            <div className="flex items-center gap-3">
              {activeTenant.name}
              <StatusBadge status={activeTenant.status} config={tenantStatusConfig} />
              <StatusBadge status={activeTenant.subscription_tier} config={tenantPlanConfig} variant="outline" />
            </div>
          }
          description={
            <span>
              <code className="text-xs font-mono">{activeTenant.slug}</code>
              {activeTenant.domain && (
                <span className="ms-2 text-muted-foreground">· {activeTenant.domain}</span>
              )}
            </span>
          }
          actions={
            <div className="flex items-center gap-2">
              {activeTenant.status === "active" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await api.put(`/api/v1/tenants/${tenantId}`, { status: "suspended" });
                      toast.success(labels.tenantDetail.suspended);
                      refetch();
                    } catch (err) {
                      toast.error(parseApiError(err));
                    }
                  }}
                >
                  <Ban className="me-2 h-4 w-4" />
                  {labels.tenantDetail.suspend}
                </Button>
              )}
              {activeTenant.status === "suspended" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await api.put(`/api/v1/tenants/${tenantId}`, { status: "active" });
                      toast.success(labels.tenantDetail.activated);
                      refetch();
                    } catch (err) {
                      toast.error(parseApiError(err));
                    }
                  }}
                >
                  <CheckCircle className="me-2 h-4 w-4" />
                  {labels.tenantDetail.activate}
                </Button>
              )}
              {activeTenant.status !== "deprovisioned" && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeprovisionOpen(true)}
                >
                  <Trash2 className="me-2 h-4 w-4" />
                  {labels.tenantDetail.deprovision}
                </Button>
              )}
            </div>
          }
        />
      </div>

      {isTransitionalStatus(activeTenant.status) && (
        <Card className="border-info-300/70 bg-info-50 dark:border-info-700/60 dark:bg-info-700/15">
          <CardContent className="p-4 flex items-center gap-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-info-600 dark:text-info-300" aria-hidden />
            <p className="text-sm text-info-700 dark:text-info-300">
              {labels.tenantDetail.transitional.replace("{status}", activeTenant.status)}
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <Building2 className="h-4 w-4" />
            {labels.tenantDetail.tabs.overview}
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            {labels.tenantDetail.tabs.settings}
          </TabsTrigger>
          <TabsTrigger value="branding" className="gap-2">
            <Palette className="h-4 w-4" />
            {labels.tenantDetail.tabs.branding}
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            {labels.tenantDetail.tabs.users}
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            {labels.tenantDetail.tabs.audit}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {usage && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                title={labels.tenantDetail.kpiActiveUsers}
                value={String(usage.active_users ?? 0)}
                icon={Users}
                tone="sky"
                loading={usageLoading}
              />
              <KpiCard
                title={labels.tenantDetail.kpiApiCalls}
                value={String(usage.api_calls ?? 0)}
                icon={Settings}
                tone="sky"
                loading={usageLoading}
              />
              <KpiCard
                title={labels.tenantDetail.kpiStorageUsed}
                value={`${Math.round((usage.storage_used_bytes ?? 0) / (1024 * 1024 * 1024))} GB`}
                description={activeTenant.settings?.max_storage_gb ? labels.tenantDetail.kpiStorageOf.replace("{value}", String(activeTenant.settings.max_storage_gb)) : undefined}
                tone="sky"
                loading={usageLoading}
              />
              <KpiCard
                title={labels.tenantDetail.kpiBandwidth}
                value={`${Math.round((usage.bandwidth_bytes ?? 0) / (1024 * 1024))} MB`}
                tone="sky"
                loading={usageLoading}
              />
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{labels.tenantDetail.infoTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">{labels.tenantDetail.tenantId}</dt>
                  <dd className="font-mono text-xs mt-1">{activeTenant.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{labels.tenantDetail.subscriptionTier}</dt>
                  <dd className="mt-1 capitalize">{activeTenant.subscription_tier}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{labels.tenantDetail.created}</dt>
                  <dd className="mt-1">
                    <RelativeTime date={activeTenant.created_at} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{labels.tenantDetail.lastUpdated}</dt>
                  <dd className="mt-1">
                    <RelativeTime date={activeTenant.updated_at} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{labels.tenantDetail.mfaRequired}</dt>
                  <dd className="mt-1">
                    <Badge variant={activeTenant.settings?.mfa_required ? "default" : "secondary"}>
                      {activeTenant.settings?.mfa_required ? labels.common.yes : labels.common.no}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{labels.tenantDetail.sessionTimeout}</dt>
                  <dd className="mt-1">
                    {activeTenant.settings?.session_timeout_minutes
                      ? labels.tenantDetail.sessionMinutes.replace("{count}", String(activeTenant.settings.session_timeout_minutes))
                      : labels.tenantDetail.sessionDefault}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {usage?.suite_usage && Object.keys(usage.suite_usage).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{labels.tenantDetail.suiteUsageTitle}</CardTitle>
                <CardDescription>{labels.tenantDetail.suiteUsageDescription}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(usage.suite_usage).map(([key, su]) => (
                    <div key={key} className="rounded-lg border p-4">
                      <p className="font-medium text-sm capitalize">{su.suite}</p>
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <p>{labels.tenantDetail.suiteApiCalls}: {su.api_calls}</p>
                        <p>{labels.tenantDetail.suiteActiveUsers}: {su.active_users}</p>
                        {su.last_accessed && (
                          <p>
                            {labels.tenantDetail.suiteLastAccessed}: <RelativeTime date={su.last_accessed} />
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="settings">
          <TenantSettingsForm tenant={activeTenant} onSuccess={() => refetch()} />
        </TabsContent>

        <TabsContent value="branding">
          <TenantBrandingForm tenant={activeTenant} onSuccess={() => refetch()} />
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>{labels.tenantDetail.usersTitle}</CardTitle>
              <CardDescription>{labels.tenantDetail.usersDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {labels.tenantDetail.usersManageText}{" "}
                <Link href={`/admin/users?tenant_id=${tenantId}`} className="text-primary hover:underline">
                  {labels.tenantDetail.usersSection}
                </Link>.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>{labels.tenantDetail.auditTitle}</CardTitle>
              <CardDescription>{labels.tenantDetail.auditDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {labels.tenantDetail.auditManageText}{" "}
                <Link href={`/admin/audit?tenant_id=${tenantId}`} className="text-primary hover:underline">
                  {labels.tenantDetail.auditSection}
                </Link>.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deprovisionOpen}
        onOpenChange={setDeprovisionOpen}
        title={labels.tenantDetail.deprovisionTitle}
        description={labels.tenantDetail.deprovisionDescription.replace("{name}", activeTenant.name)}
        confirmLabel={labels.tenantDetail.deprovision}
        typeToConfirm={activeTenant.name}
        variant="destructive"
        loading={deprovisionMutation.isPending}
        onConfirm={async () => {
          await deprovisionMutation.mutateAsync(tenantId);
          refetch();
        }}
      />
    </div>
  );
}
