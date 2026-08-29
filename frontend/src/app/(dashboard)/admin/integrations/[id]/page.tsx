"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  RefreshCw,
  RotateCcw,
  Settings2,
  TestTube2,
  ToggleLeft,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/common/error-state";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { PermissionRedirect } from "@/components/common/permission-redirect";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { RelativeTime } from "@/components/shared/relative-time";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { ApiResponse } from "@/types/api";
import type { IntegrationStatus } from "@/types/integration";
import { DeliveryLogTable } from "../_components/delivery-log-table";
import { IntegrationFormDialog } from "../_components/integration-form-dialog";
import { TicketLinksTable } from "../_components/ticket-links-table";
import {
  fetchDeliveries,
  fetchIntegration,
  fetchProviders,
  fetchTicketLinks,
  getSetupPendingFields,
  statusBadgeVariant,
  summarizeIntegrationConfig,
} from "../_components/integration-utils";
import {
  configSummaryLabel,
  errorToastMessage,
  integrationStatusLabel,
  integrationTypeLabel,
  technicalDiagnosticMessage,
  useIntegrationsT,
  visibleDiagnosticMessage,
} from "../_lib/integrations-i18n";

export default function IntegrationDetailPage() {
  const t = useIntegrationsT();
  const { locale } = useLocaleOrDefault();
  const dateLocale = locale === "ar" ? "ar" : "en-US";
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState("all");
  const [deliveryEventType, setDeliveryEventType] = useState("");
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [syncingTicketId, setSyncingTicketId] = useState<string | null>(null);

  const providersQuery = useQuery({
    queryKey: ["integration-providers"],
    queryFn: fetchProviders,
  });
  const integrationQuery = useQuery({
    queryKey: ["integration-detail", id],
    queryFn: () => fetchIntegration(id),
    refetchInterval: 60000,
  });
  const deliveriesQuery = useQuery({
    queryKey: ["integration-deliveries", id, deliveryPage, deliveryStatus, deliveryEventType],
    queryFn: () =>
      fetchDeliveries(id, {
        page: deliveryPage,
        per_page: 20,
        status: deliveryStatus === "all" ? undefined : deliveryStatus,
        event_type: deliveryEventType.trim() || undefined,
      }),
  });
  const ticketLinksQuery = useQuery({
    queryKey: ["integration-ticket-links", id],
    queryFn: () => fetchTicketLinks(id),
  });

  const integration = integrationQuery.data;
  const providers = providersQuery.data ?? [];
  const setupPendingFields = integration ? getSetupPendingFields(integration) : [];
  const configSummary = useMemo(() => (integration ? summarizeIntegrationConfig(integration) : []), [integration]);

  const handleTest = async () => {
    setBusyKey("test");
    try {
      const response = await apiPost<ApiResponse<{ response_code: number }>>(`/api/v1/integrations/${id}/test`);
      toast.success(t.testCompleted(response.data.response_code));
      await deliveriesQuery.refetch();
    } catch (err) {
      toast.error(errorToastMessage(t, err, t.testFailed));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRetry = async () => {
    setBusyKey("retry");
    try {
      const response = await apiPost<ApiResponse<{ retried_count: number }>>(`/api/v1/integrations/${id}/retry-failed`);
      toast.success(t.requeued(response.data.retried_count));
      await deliveriesQuery.refetch();
      await integrationQuery.refetch();
    } catch (err) {
      toast.error(errorToastMessage(t, err, t.retryToastFailed));
    } finally {
      setBusyKey(null);
    }
  };

  const handleStatus = async (nextStatus: Exclude<IntegrationStatus, "setup_pending">) => {
    setBusyKey("status");
    try {
      await apiPut<ApiResponse<{ status: string }>>(`/api/v1/integrations/${id}/status`, { status: nextStatus });
      toast.success(t.integrationMarked(integrationStatusLabel(t, nextStatus)));
      await integrationQuery.refetch();
    } catch (err) {
      toast.error(errorToastMessage(t, err, t.statusUpdateFailed));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async () => {
    setBusyKey("delete");
    try {
      await apiDelete(`/api/v1/integrations/${id}`);
      toast.success(t.integrationDeleted);
      router.push("/admin/integrations");
    } catch (err) {
      toast.error(errorToastMessage(t, err, t.deleteFailed));
      throw err;
    } finally {
      setBusyKey(null);
    }
  };

  const handleSyncTicketLink = async (linkID: string) => {
    setSyncingTicketId(linkID);
    try {
      await apiGetSync(linkID);
      toast.success(t.ticketLinkSynced);
      await ticketLinksQuery.refetch();
      await deliveriesQuery.refetch();
    } catch (err) {
      toast.error(errorToastMessage(t, err, t.ticketLinkSyncFailed));
    } finally {
      setSyncingTicketId(null);
    }
  };

  if (integrationQuery.isLoading) {
    return (
      <PermissionRedirect permission="tenant:write">
        <div className="space-y-6">
          <LoadingSkeleton variant="card" count={2} />
        </div>
      </PermissionRedirect>
    );
  }

  if (integrationQuery.error || !integration) {
    return (
      <PermissionRedirect permission="tenant:write">
        <ErrorState
          title={t.integrationUnavailableTitle}
          message={t.integrationUnavailableMessage}
          onRetry={() => void integrationQuery.refetch()}
        />
      </PermissionRedirect>
    );
  }

  const nextStatus = integration.status === "active" ? "inactive" : "active";
  const integrationTypeText = integrationTypeLabel(t, integration.type);
  const integrationStatusText = integrationStatusLabel(t, integration.status);

  return (
    <PermissionRedirect permission="tenant:write">
      <div className="space-y-6">
        <PageHeader
          title={
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/admin/integrations")}
                className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="truncate">{integration.name}</span>
            </div>
          }
          description={
            <div className="flex flex-wrap items-center gap-3 ps-11 text-sm">
              <Badge variant={statusBadgeVariant(integration.status)}>{integrationStatusText}</Badge>
              <span className="text-muted-foreground">{integrationTypeText}</span>
              <span className="text-muted-foreground">{t.updated} <RelativeTime date={integration.updated_at} /></span>
            </div>
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void integrationQuery.refetch()} disabled={integrationQuery.isFetching}>
                <RefreshCw className={`me-2 h-4 w-4 ${integrationQuery.isFetching ? "animate-spin" : ""}`} />
                {t.refresh}
              </Button>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Settings2 className="me-2 h-4 w-4" />
                {t.edit}
              </Button>
              <Button variant="outline" onClick={() => void handleTest()} disabled={busyKey === "test"}>
                <TestTube2 className="me-2 h-4 w-4" />
                {t.test}
              </Button>
              <Button variant="outline" onClick={() => void handleRetry()} disabled={busyKey === "retry"}>
                <RotateCcw className="me-2 h-4 w-4" />
                {t.retryFailed}
              </Button>
              {integration.status !== "setup_pending" ? (
                <Button variant="outline" onClick={() => void handleStatus(nextStatus)} disabled={busyKey === "status"}>
                  <ToggleLeft className="me-2 h-4 w-4" />
                  {integration.status === "active" ? t.disable : t.enable}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="me-2 h-4 w-4" />
                {t.delete}
              </Button>
            </div>
          }
        />

        {integration.status === "setup_pending" ? (
          <Alert>
            <AlertTitle>{t.setupPendingTitle}</AlertTitle>
            <AlertDescription>
              {setupPendingFields.length > 0
                ? t.setupPendingWithFields(setupPendingFields.join(", "))
                : t.setupPendingNoFields}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.usageTitle}</CardTitle>
              <CardDescription>{t.usageDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <KeyValue label={t.deliveries} value={integration.delivery_count.toLocaleString()} />
              <KeyValue label={t.consecutiveErrors} value={String(integration.error_count)} />
              <KeyValue label={t.lastUsed} value={integration.last_used_at ? t.recently : t.never} />
              <KeyValue label={t.created} value={new Date(integration.created_at).toLocaleString(dateLocale)} />
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{t.configurationSummaryTitle}</CardTitle>
              <CardDescription>{t.configurationSummaryDescription}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {configSummary.length > 0 ? (
                configSummary.map((entry) => (
                  <KeyValue key={entry.key} label={configSummaryLabel(t, entry.key)} value={entry.value} />
                ))
              ) : (
                <KeyValue label={t.configurationLabel} value={t.noConfigValues} />
              )}
            </CardContent>
          </Card>
        </div>

        {integration.error_message ? (
          <Alert variant={integration.status === "error" ? "destructive" : "default"}>
            <AlertTitle>{integration.status === "error" ? t.integrationErrorTitle : t.attentionRequired}</AlertTitle>
            <AlertDescription>
              {visibleDiagnosticMessage(t, integration.error_message, t.integrationDiagnosticMessage)}
              {technicalDiagnosticMessage(t, integration.error_message) ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-muted-foreground">{t.technicalDetails}</summary>
                  <p dir="ltr" className="mt-1 break-words font-mono text-xs">
                    {technicalDiagnosticMessage(t, integration.error_message)}
                  </p>
                </details>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <Tabs defaultValue="overview">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">{t.overviewTab}</TabsTrigger>
            <TabsTrigger value="deliveries">{t.deliveryLogTab}</TabsTrigger>
            <TabsTrigger value="tickets">{t.ticketLinksTab}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.integrationNotesTitle}</CardTitle>
                <CardDescription>{integration.description || t.noDescription}</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <KeyValue label={t.typeLabel} value={integrationTypeText} />
                <KeyValue label={t.statusLabel} value={integrationStatusText} />
                <KeyValue
                  label={t.updated}
                  value={new Date(integration.updated_at).toLocaleString(dateLocale)}
                />
                <KeyValue label={t.createdByLabel} value={integration.created_by} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="deliveries" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.filtersTitle}</CardTitle>
                <CardDescription>{t.filtersDescription}</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium">{t.statusFilterLabel}</div>
                  <Select
                    value={deliveryStatus}
                    onValueChange={(value) => {
                      setDeliveryPage(1);
                      setDeliveryStatus(value);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t.all}</SelectItem>
                      <SelectItem value="pending">{t.pending}</SelectItem>
                      <SelectItem value="retrying">{t.retrying}</SelectItem>
                      <SelectItem value="delivered">{t.delivered}</SelectItem>
                      <SelectItem value="failed">{t.failed}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <div className="text-sm font-medium">{t.eventTypeFilterLabel}</div>
                  <Input
                    value={deliveryEventType}
                    onChange={(event) => setDeliveryEventType(event.target.value)}
                    onBlur={() => setDeliveryPage(1)}
                    placeholder="alert.created"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.deliveryRecordsTitle}</CardTitle>
                <CardDescription>
                  {t.deliveryRecordsDescription(deliveriesQuery.data?.meta.total ?? 0)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {deliveriesQuery.isLoading ? (
                  <LoadingSkeleton variant="table-row" count={6} />
                ) : deliveriesQuery.error ? (
                  <ErrorState message={t.loadDeliveriesError} onRetry={() => void deliveriesQuery.refetch()} />
                ) : (
                  <>
                    <DeliveryLogTable items={deliveriesQuery.data?.data ?? []} />
                    <PaginationControls
                      page={deliveriesQuery.data?.meta.page ?? 1}
                      totalPages={deliveriesQuery.data?.meta.total_pages ?? 1}
                      pageLabel={t.page}
                      ofLabel={t.of}
                      previousLabel={t.previous}
                      nextLabel={t.next}
                      onPrev={() => setDeliveryPage((current) => Math.max(1, current - 1))}
                      onNext={() =>
                        setDeliveryPage((current) =>
                          Math.min(deliveriesQuery.data?.meta.total_pages ?? current, current + 1),
                        )
                      }
                    />
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tickets" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.externalTicketLinksTitle}</CardTitle>
                <CardDescription>{t.externalTicketLinksDescription}</CardDescription>
              </CardHeader>
              <CardContent>
                {ticketLinksQuery.isLoading ? (
                  <LoadingSkeleton variant="table-row" count={4} />
                ) : ticketLinksQuery.error ? (
                  <ErrorState message={t.loadTicketLinksError} onRetry={() => void ticketLinksQuery.refetch()} />
                ) : (
                  <TicketLinksTable
                    items={ticketLinksQuery.data ?? []}
                    syncingId={syncingTicketId}
                    onSync={(linkID) => void handleSyncTicketLink(linkID)}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <IntegrationFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={(updated) => {
            toast.success(t.configUpdated);
            setEditOpen(false);
            integrationQuery.refetch();
          }}
          providers={providers}
          integration={integration}
          initialType={integration.type}
        />

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t.deleteIntegrationTitle}
          description={t.deleteIntegrationDesc(integration.name)}
          confirmLabel={t.delete}
          variant="destructive"
          onConfirm={handleDelete}
        />
      </div>
    </PermissionRedirect>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="break-all text-sm">{value}</div>
    </div>
  );
}

function PaginationControls({
  page,
  totalPages,
  pageLabel,
  ofLabel,
  previousLabel,
  nextLabel,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  pageLabel: string;
  ofLabel: string;
  previousLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-sm text-muted-foreground">
        {pageLabel} {page} {ofLabel} {totalPages}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onPrev} disabled={page <= 1}>
          {previousLabel}
        </Button>
        <Button variant="outline" size="sm" onClick={onNext} disabled={page >= totalPages}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}

async function apiGetSync(linkID: string) {
  await apiGet<ApiResponse<{ status: string }>>(`/api/v1/integrations/ticket-links/${linkID}/sync`);
}
