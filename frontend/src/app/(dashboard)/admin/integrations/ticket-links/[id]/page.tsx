"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/common/error-state";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { PermissionRedirect } from "@/components/common/permission-redirect";
import { RelativeTime } from "@/components/shared/relative-time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet } from "@/lib/api";
import type { ApiResponse } from "@/types/api";
import { fetchTicketLink } from "../../_components/integration-utils";
import {
  entityTypeLabel,
  errorToastMessage,
  externalStatusLabel,
  externalSystemLabel,
  priorityLabel,
  syncDirectionLabel,
  technicalDiagnosticMessage,
  useIntegrationsT,
  visibleDiagnosticMessage,
} from "../../_lib/integrations-i18n";

export default function TicketLinkDetailPage() {
  const t = useIntegrationsT();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const query = useQuery({
    queryKey: ["integration-ticket-link", id],
    queryFn: () => fetchTicketLink(id),
  });

  const link = query.data;
  const externalSystemText = link ? externalSystemLabel(t, link.external_system) : "";
  const entityTypeText = link ? entityTypeLabel(t, link.entity_type) : "";

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiGet<ApiResponse<{ status: string }>>(`/api/v1/integrations/ticket-links/${id}/sync`);
      toast.success(t.ticketLinkSynced);
      await query.refetch();
    } catch (err) {
      toast.error(errorToastMessage(t, err, t.ticketLinkSyncError));
    } finally {
      setSyncing(false);
    }
  };

  if (query.isLoading) {
    return (
      <PermissionRedirect permission="tenant:write">
        <LoadingSkeleton variant="card" count={2} />
      </PermissionRedirect>
    );
  }

  if (query.error || !link) {
    return (
      <PermissionRedirect permission="tenant:write">
        <ErrorState message={t.ticketLinkUnavailable} onRetry={() => void query.refetch()} />
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="tenant:write">
      <div className="space-y-6">
        <PageHeader
          title={
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push(`/admin/integrations/${link.integration_id}`)}
                className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="truncate">{link.external_key}</span>
            </div>
          }
          description={t.linkedTicketDescription(externalSystemText, entityTypeText, link.entity_id)}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
                <RefreshCw className={`me-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
                {t.refresh}
              </Button>
              <Button variant="outline" onClick={() => void handleSync()} disabled={syncing}>
                <RefreshCw className={`me-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {t.forceSync}
              </Button>
              <Button asChild variant="outline">
                <a href={link.external_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="me-2 h-4 w-4" />
                  {t.openTicket}
                </a>
              </Button>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.externalRecordTitle}</CardTitle>
              <CardDescription>{t.externalRecordDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <KeyValue label={t.system} value={externalSystemText} />
              <KeyValue label={t.key} value={link.external_key} />
              <KeyValue label={t.externalIdLabel} value={link.external_id} />
              <KeyValue label={t.statusLabel} value={externalStatusLabel(t, link.external_status)} />
              <KeyValue label={t.priorityLabel} value={priorityLabel(t, link.external_priority)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.clarioLinkageTitle}</CardTitle>
              <CardDescription>{t.clarioLinkageDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <KeyValue label={t.integrationLabel} value={link.integration_id} />
              <KeyValue label={t.entityTypeLabel} value={entityTypeText} />
              <KeyValue label={t.entityIdLabel} value={link.entity_id} />
              <KeyValue label={t.syncDirectionLabel} value={syncDirectionLabel(t, link.sync_direction)} />
              <KeyValue label={t.lastSyncDirectionLabel} value={syncDirectionLabel(t, link.last_sync_direction)} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.timestampsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.created}</div>
              <div className="mt-1">
                <RelativeTime date={link.created_at} />
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.updated}</div>
              <div className="mt-1">
                <RelativeTime date={link.updated_at} />
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.lastSynced}</div>
              <div className="mt-1">{link.last_synced_at ? <RelativeTime date={link.last_synced_at} /> : t.never}</div>
            </div>
          </CardContent>
        </Card>

        {link.sync_error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.lastSyncErrorTitle}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-destructive">
              {visibleDiagnosticMessage(t, link.sync_error, t.ticketSyncDiagnosticMessage)}
              {technicalDiagnosticMessage(t, link.sync_error) ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-muted-foreground">{t.technicalDetails}</summary>
                  <p dir="ltr" className="mt-1 break-words font-mono text-xs">
                    {technicalDiagnosticMessage(t, link.sync_error)}
                  </p>
                </details>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/admin/integrations/${link.integration_id}`}>{t.backToIntegration}</Link>
          </Button>
        </div>
      </div>
    </PermissionRedirect>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-all">{value}</div>
    </div>
  );
}
