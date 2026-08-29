"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  CheckCircle2,
  Clock4,
  ExternalLink,
  KeyRound,
  LayoutGrid,
  PauseCircle,
  Plug,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  TestTube2,
  ToggleLeft,
  Trash2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, type PageHeaderTag } from "@/components/common/page-header";
import { PermissionRedirect } from "@/components/common/permission-redirect";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/shared/relative-time";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { IconBadge } from "@/components/shared/icon-badge";
import { KpiCard } from "@/components/shared/kpi-card";
import { MetricTile } from "@/components/shared/metric-tile";
import { StatusChip } from "@/components/shared/status-chip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiDelete, apiPost, apiPut } from "@/lib/api";
import type { ApiResponse } from "@/types/api";
import type { IntegrationProviderStatus, IntegrationRecord, IntegrationStatus, IntegrationType } from "@/types/integration";
import { IntegrationFormDialog } from "./_components/integration-form-dialog";
import { resolveProviderVisual } from "./_components/provider-visuals";
import {
  fetchIntegrations,
  fetchProviders,
  prepareOAuthInstall,
  summarizeIntegrationConfig,
} from "./_components/integration-utils";
import {
  configSummaryLabel,
  errorToastMessage,
  integrationStatusLabel,
  integrationTypeLabel,
  providerPresentation,
  technicalDiagnosticMessage,
  visibleDiagnosticMessage,
  useIntegrationsT,
} from "./_lib/integrations-i18n";

/** Status → StatusChip tone (color is always paired with the text label below). */
function statusChipTone(status: IntegrationStatus): "success" | "neutral" | "danger" | "warning" {
  switch (status) {
    case "active":
      return "success";
    case "error":
      return "danger";
    case "setup_pending":
      return "warning";
    case "inactive":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Status → StatusChip leading icon. */
function statusChipIcon(status: IntegrationStatus): LucideIcon {
  switch (status) {
    case "active":
      return CheckCircle2;
    case "error":
      return AlertTriangle;
    case "setup_pending":
      return Clock4;
    case "inactive":
      return PauseCircle;
    default:
      return Plug;
  }
}

/** Skeleton silhouette matching a catalogue tile (chip + lines + CTA). */
function TileSkeleton() {
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
      <Skeleton className="h-6 w-44 rounded-full" />
      <Skeleton className="mt-auto h-9 w-full" />
    </div>
  );
}

export default function AdminIntegrationsPage() {
  const t = useIntegrationsT();
  const [providers, setProviders] = useState<IntegrationProviderStatus[]>([]);
  const [items, setItems] = useState<IntegrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<IntegrationType | null>(null);
  const [editing, setEditing] = useState<IntegrationRecord | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<IntegrationRecord | null>(null);

  const countsByType = useMemo(() => {
    return items.reduce<Record<string, number>>((acc, item) => {
      acc[item.type] = (acc[item.type] ?? 0) + 1;
      return acc;
    }, {});
  }, [items]);

  const fleet = useMemo(() => {
    return {
      activeCount: items.filter((item) => item.status === "active").length,
      pendingCount: items.filter((item) => item.status === "setup_pending").length,
      errorCount: items.filter((item) => item.status === "error" || item.error_count > 0).length,
      totalDeliveries: items.reduce((sum, item) => sum + item.delivery_count, 0),
    };
  }, [items]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [providerData, integrationData] = await Promise.all([fetchProviders(), fetchIntegrations()]);
      setProviders(providerData);
      setItems(integrationData);
    } catch (err) {
      setError(errorToastMessage(t, err, t.loadIntegrationsError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSaved = (integration: IntegrationRecord) => {
    setItems((current) => {
      const existing = current.find((item) => item.id === integration.id);
      if (existing) {
        return current.map((item) => (item.id === integration.id ? integration : item));
      }
      return [integration, ...current];
    });
    setEditing(null);
    setDialogType(null);
  };

  const handleTest = async (integrationId: string) => {
    setBusyKey(`test:${integrationId}`);
    try {
      const response = await apiPost<ApiResponse<{ response_code: number; success: boolean }>>(`/api/v1/integrations/${integrationId}/test`);
      toast.success(t.testCompleted(response.data.response_code));
    } catch (err) {
      toast.error(errorToastMessage(t, err, t.testFailed));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRetry = async (integrationId: string) => {
    setBusyKey(`retry:${integrationId}`);
    try {
      const response = await apiPost<ApiResponse<{ retried_count: number }>>(`/api/v1/integrations/${integrationId}/retry-failed`);
      toast.success(t.requeued(response.data.retried_count));
      await load();
    } catch (err) {
      toast.error(errorToastMessage(t, err, t.retryToastFailed));
    } finally {
      setBusyKey(null);
    }
  };

  const handleStatus = async (integrationId: string, nextStatus: Exclude<IntegrationStatus, "setup_pending">) => {
    setBusyKey(`status:${integrationId}`);
    try {
      await apiPut<ApiResponse<{ status: string }>>(`/api/v1/integrations/${integrationId}/status`, { status: nextStatus });
      toast.success(t.integrationMarked(integrationStatusLabel(t, nextStatus)));
      await load();
    } catch (err) {
      toast.error(errorToastMessage(t, err, t.statusUpdateFailed));
    } finally {
      setBusyKey(null);
    }
  };

  const handleOAuthInstall = async (provider: IntegrationProviderStatus) => {
    if (provider.type !== "slack" && provider.type !== "jira") {
      toast.error(t.oauthNotAvailable);
      return;
    }
    setBusyKey(`oauth:${provider.type}`);
    try {
      const url = await prepareOAuthInstall(provider.type);
      window.location.assign(url);
    } catch (err) {
      toast.error(errorToastMessage(t, err, t.unableToStartOAuth));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async (integrationId: string) => {
    setBusyKey(`delete:${integrationId}`);
    try {
      await apiDelete(`/api/v1/integrations/${integrationId}`);
      setItems((current) => current.filter((item) => item.id !== integrationId));
      toast.success(t.integrationDeleted);
    } catch (err) {
      toast.error(errorToastMessage(t, err, t.deleteFailed));
      throw err;
    } finally {
      setBusyKey(null);
    }
  };

  const heroTags: PageHeaderTag[] = [
    { label: `${providers.length} ${t.providersChip}`, icon: <LayoutGrid className="h-3.5 w-3.5" />, tone: "neutral" },
  ];
  if (fleet.activeCount > 0) {
    heroTags.push({ label: `${fleet.activeCount} ${t.activeChip}`, icon: <Plug className="h-3.5 w-3.5" />, tone: "success" });
  }
  if (fleet.pendingCount > 0) {
    heroTags.push({ label: `${fleet.pendingCount} ${t.setupPendingChip}`, icon: <Clock4 className="h-3.5 w-3.5" />, tone: "warning" });
  }
  if (fleet.errorCount > 0) {
    heroTags.push({ label: `${fleet.errorCount} ${t.withErrorsChip}`, icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: "danger" });
  }

  return (
    <PermissionRedirect permission="tenant:write">
      <div className="space-y-8">
        <PageHeader
          eyebrow={t.integrationHub}
          title={t.pageTitle}
          description={t.pageDescription}
          tags={heroTags}
          actions={
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(null);
                  setDialogType("webhook");
                  setDialogOpen(true);
                }}
              >
                <Settings2 className="me-2 h-4 w-4" />
                {t.manualSetup}
              </Button>
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`me-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {t.refresh}
              </Button>
            </div>
          }
        />

        {/* Fleet-health KPI strip — computed from already-loaded data, no extra fetch. */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard title={t.kpiTotalConnectors} value={items.length} icon={Boxes} tone="sky" loading={loading} />
          <KpiCard title={t.kpiActive} value={fleet.activeCount} icon={Plug} tone="emerald" loading={loading} />
          <KpiCard title={t.kpiDeliveries} value={fleet.totalDeliveries.toLocaleString()} icon={Send} tone="gold" loading={loading} />
          <KpiCard
            title={t.kpiErrors}
            value={fleet.errorCount}
            icon={AlertTriangle}
            tone={fleet.errorCount > 0 ? "rose" : "slate"}
            loading={loading}
          />
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t.loadErrorTitle}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-h4 font-semibold">{t.providerReadinessTitle}</h2>
              <p className="text-sm text-muted-foreground">{t.providerReadinessDescription}</p>
            </div>
            {!loading ? <StatusChip tone="neutral" size="sm" label={String(providers.length)} /> : null}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <TileSkeleton key={index} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {providers.map((provider) => {
                const visual = resolveProviderVisual(provider.type);
                const count = countsByType[provider.type] ?? 0;
                const presentation = providerPresentation(t, provider);
                return (
                  <div key={provider.type} className="card card-interactive group flex h-full flex-col gap-3 p-5">
                    <div className="flex items-start gap-3">
                      <IconBadge
                        icon={visual.icon}
                        tone="muted"
                        size="lg"
                        label={presentation.name}
                        className={cn("duration-200", visual.badgeClassName)}
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-semibold text-foreground">{presentation.name}</h3>
                        <p className="line-clamp-2 text-sm text-muted-foreground">{presentation.description}</p>
                      </div>
                      {provider.configured ? (
                        <StatusChip tone="success" size="sm" icon={CheckCircle2} label={t.ready} />
                      ) : (
                        <StatusChip tone="warning" size="sm" icon={Clock4} label={t.runtimeConfigNeeded} />
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <StatusChip
                        tone="neutral"
                        size="sm"
                        icon={provider.setup_mode === "oauth" ? Workflow : KeyRound}
                        label={provider.setup_mode === "oauth" ? t.oauth : t.manualMode}
                      />
                      {provider.supports_inbound ? (
                        <StatusChip tone="info" size="sm" icon={ArrowDownToLine} label={t.inbound} />
                      ) : null}
                      {provider.supports_outbound ? (
                        <StatusChip tone="info" size="sm" icon={ArrowUpFromLine} label={t.outbound} />
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Boxes className="h-3.5 w-3.5" />
                      {t.configuredCountLabel(count)}
                    </div>

                    {!provider.configured && provider.missing_config?.length ? (
                      <div className="flex flex-col gap-1.5 rounded-lg border border-warning-300/60 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:border-warning-700/60 dark:bg-warning-700/15 dark:text-warning-300">
                        <div className="flex items-center gap-1.5 font-medium">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {t.runtimeValuesMissingTitle}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {provider.missing_config.map((name) => (
                            <span
                              key={name}
                              className="rounded bg-warning-100/70 px-1.5 py-0.5 font-mono text-overline dark:bg-warning-700/20"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-auto flex flex-wrap gap-2 pt-2">
                      {provider.oauth_enabled ? (
                        <Button
                          variant="default"
                          size="sm"
                          className="min-h-0"
                          disabled={!provider.configured || busyKey === `oauth:${provider.type}`}
                          onClick={() => void handleOAuthInstall(provider)}
                        >
                          <ExternalLink className="me-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                          {t.connectViaOAuth}
                        </Button>
                      ) : null}
                      <Button
                        variant={provider.oauth_enabled ? "outline" : "default"}
                        size="sm"
                        className={provider.oauth_enabled ? undefined : "min-h-0"}
                        onClick={() => {
                          setEditing(null);
                          setDialogType(provider.type);
                          setDialogOpen(true);
                        }}
                      >
                        <Settings2 className="me-2 h-4 w-4" />
                        {t.advancedSetup}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-h4 font-semibold">{t.configuredTitle}</h2>
              <p className="text-sm text-muted-foreground">{t.configuredDescription}</p>
            </div>
            {!loading && items.length > 0 ? <StatusChip tone="neutral" size="sm" label={String(items.length)} /> : null}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <TileSkeleton key={index} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="card p-10">
              <EmptyState icon={Plug} title={t.noIntegrationsTitle} description={t.noIntegrationsDescription} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const visual = resolveProviderVisual(item.type);
                const summary = summarizeIntegrationConfig(item);
                const nextStatus = item.status === "active" ? "inactive" : "active";
                const statusActionLabel = item.status === "active" ? t.disable : t.enable;
                const itemTypeLabel = integrationTypeLabel(t, item.type);
                const itemStatusLabel = integrationStatusLabel(t, item.status);
                return (
                  <div key={item.id} className="card card-interactive group flex h-full flex-col gap-3 p-5">
                    <div className="flex items-start gap-3">
                      <IconBadge
                        icon={visual.icon}
                        tone="muted"
                        size="md"
                        label={itemTypeLabel}
                        className={cn("duration-200", visual.badgeClassName)}
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-semibold text-foreground">{item.name}</h3>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{itemTypeLabel}</p>
                      </div>
                      <StatusChip
                        tone={statusChipTone(item.status)}
                        size="sm"
                        icon={statusChipIcon(item.status)}
                        label={itemStatusLabel}
                      />
                    </div>

                    {item.description ? (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
                    ) : null}

                    <div className="grid grid-cols-2 gap-2">
                      <MetricTile label={t.deliveries} value={item.delivery_count.toLocaleString()} icon={Send} tone="info" />
                      <MetricTile
                        label={t.errors}
                        value={item.error_count}
                        icon={AlertTriangle}
                        tone={item.error_count > 0 ? "danger" : "success"}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 truncate">
                        {t.lastUsed}: {item.last_used_at ? <RelativeTime date={item.last_used_at} /> : t.never}
                      </span>
                      <span className="inline-flex items-center gap-1 truncate">
                        {t.updated}: <RelativeTime date={item.updated_at} />
                      </span>
                    </div>

                    {summary.length > 0 ? (
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t.configurationLabel}
                        </div>
                        <div className="space-y-1.5">
                          {summary.slice(0, 3).map((entry) => (
                            <div key={entry.key} className="flex items-start justify-between gap-3 text-sm">
                              <span className="text-muted-foreground">{configSummaryLabel(t, entry.key)}</span>
                              <span className="max-w-[60%] truncate text-end font-mono text-xs">{entry.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {item.error_message ? (
                      <div className="flex flex-col gap-1 rounded-lg border border-error-300/60 bg-error-50 px-3 py-2 text-xs text-error-700 dark:border-error-700/60 dark:bg-error-700/15 dark:text-error-300">
                        <div className="flex items-center gap-1.5 font-medium">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {item.status === "error" ? t.deliveryIssue : t.attentionNeeded}
                        </div>
                        <span className="break-words">
                          {visibleDiagnosticMessage(t, item.error_message, t.integrationDiagnosticMessage)}
                        </span>
                        {technicalDiagnosticMessage(t, item.error_message) ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-muted-foreground">{t.technicalDetails}</summary>
                            <p dir="ltr" className="mt-1 break-words font-mono text-[11px]">
                              {technicalDiagnosticMessage(t, item.error_message)}
                            </p>
                          </details>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg border border-success-300/60 bg-success-50 px-3 py-2 text-xs text-success-700 dark:border-success-700/60 dark:bg-success-700/15 dark:text-success-300">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        {t.noErrorRecorded}
                      </div>
                    )}

                    <div className="mt-auto flex flex-wrap gap-2 pt-1">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/integrations/${item.id}`}>{t.viewDetails}</Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(item);
                          setDialogType(item.type);
                          setDialogOpen(true);
                        }}
                      >
                        <Settings2 className="me-2 h-4 w-4" />
                        {t.edit}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleTest(item.id)}
                        disabled={busyKey === `test:${item.id}`}
                      >
                        <TestTube2 className="me-2 h-4 w-4" />
                        {t.test}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRetry(item.id)}
                        disabled={busyKey === `retry:${item.id}`}
                      >
                        <RotateCcw className="me-2 h-4 w-4" />
                        {t.retryFailed}
                      </Button>
                      {item.status !== "setup_pending" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleStatus(item.id, nextStatus)}
                          disabled={busyKey === `status:${item.id}`}
                        >
                          <ToggleLeft className="me-2 h-4 w-4" />
                          {statusActionLabel}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteCandidate(item)}
                      >
                        <Trash2 className="me-2 h-4 w-4" />
                        {t.delete}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <IntegrationFormDialog
          open={dialogOpen}
          onOpenChange={(next) => {
            setDialogOpen(next);
            if (!next) {
              setEditing(null);
              setDialogType(null);
            }
          }}
          onSaved={handleSaved}
          providers={providers}
          integration={editing}
          initialType={dialogType}
        />

        {deleteCandidate ? (
          <ConfirmDialog
            open={Boolean(deleteCandidate)}
            onOpenChange={(next) => !next && setDeleteCandidate(null)}
            title={t.deleteIntegrationTitle}
            description={t.deleteIntegrationDesc(deleteCandidate.name)}
            confirmLabel={t.delete}
            variant="destructive"
            onConfirm={() => handleDelete(deleteCandidate.id)}
          />
        ) : null}
      </div>
    </PermissionRedirect>
  );
}
