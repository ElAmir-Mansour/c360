"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Globe,
  Monitor,
  Clock,
  Hash,
  Link2,
  Timer,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, type PageHeaderTag } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/error-state";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { RelativeTime } from "@/components/shared/relative-time";
import { useAuditLogDetail } from "@/hooks/use-audit";
import { resolveAuditSeverity } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import { ChangesDiff } from "./changes-diff";
import { JsonViewer } from "./json-viewer";
import type { AuditLogDetail } from "@/types/audit";
import { useAdminLabels } from "../../../../_lib/admin-i18n";

interface LogDetailProps {
  logId: string;
}

const SEVERITY_TONE: Record<string, NonNullable<PageHeaderTag["tone"]>> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "info",
  info: "neutral",
};

export function LogDetail({ logId }: LogDetailProps) {
  const labels = useAdminLabels();
  const { data: log, isLoading, error, refetch } = useAuditLogDetail(logId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton variant="card" className="h-32" label={labels.auditLog.loading} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <LoadingSkeleton variant="detail" />
            <LoadingSkeleton variant="detail" />
          </div>
          <LoadingSkeleton variant="detail" />
        </div>
      </div>
    );
  }

  if (error || !log) {
    return (
      <ErrorState
        error={error ?? undefined}
        variant={error ? undefined : "notFound"}
        title={error ? undefined : labels.auditLog.notFoundTitle}
        message={
          error
            ? error instanceof Error
              ? error.message
              : labels.auditLog.loadFailed
            : labels.auditLog.notFoundMessage
        }
        onRetry={error ? () => refetch() : undefined}
      />
    );
  }

  const severity = resolveAuditSeverity(log.action, log.severity);
  const headerTags: PageHeaderTag[] = [
    {
      label: log.resource_type,
      tone: "neutral",
    },
    {
      label: severity,
      tone: SEVERITY_TONE[severity] ?? "neutral",
    },
  ];
  if (log.response_status !== null) {
    headerTags.push({
      label: `HTTP ${log.response_status}`,
      tone: log.response_status < 400 ? "success" : "danger",
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={labels.auditLog.eyebrow}
        title={
          <span className="font-mono [font-size:clamp(1.4rem,1rem+1.4vw,2rem)]">
            {log.action}
          </span>
        }
        description={
          <span>
            {log.user_email
              ? labels.auditLog.recordedBy
                  .replace("{date}", formatDateTime(log.created_at))
                  .replace("{user}", log.user_email)
              : labels.auditLog.recordedSystem.replace("{date}", formatDateTime(log.created_at))}
          </span>
        }
        tags={headerTags}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/audit">
              <ArrowLeft className="me-1.5 h-4 w-4" />
              {labels.auditLog.backToLogs}
            </Link>
          </Button>
        }
      />

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - wide */}
        <div className="lg:col-span-2 space-y-6">
          {/* Event Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">
                {labels.auditLog.eventSummary}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    {labels.fields.action}
                  </p>
                  <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded mt-1 inline-block">
                    {log.action}
                  </code>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    {labels.fields.timestamp}
                  </p>
                  <p className="mt-0.5">{formatDateTime(log.created_at)}</p>
                  <p className="text-xs text-muted-foreground">
                    <RelativeTime date={log.created_at} />
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    {labels.fields.user}
                  </p>
                  <p className="mt-0.5">
                    {log.user_email || (
                      <span className="text-muted-foreground">{labels.common.system}</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    {labels.fields.resource}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-xs">
                      {log.resource_type}
                    </Badge>
                    {log.resource_id && (
                      <Link
                        href={`/admin/audit/timeline/${log.resource_id}`}
                        className="text-xs font-mono text-primary hover:underline"
                      >
                        {log.resource_id.slice(0, 8)}...
                      </Link>
                    )}
                  </div>
                </div>
                {log.service && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      {labels.fields.service}
                    </p>
                    <p className="mt-0.5">{log.service}</p>
                  </div>
                )}
                {log.response_status !== null && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      {labels.auditLog.responseStatus}
                    </p>
                    <Badge
                      variant={
                        log.response_status < 400
                          ? "default"
                          : "destructive"
                      }
                      className="mt-0.5"
                    >
                      {log.response_status}
                    </Badge>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Changes Diff */}
          {log.changes?.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">
                  {labels.auditLog.changesCount.replace("{count}", String(log.changes?.length ?? 0))}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChangesDiff changes={log.changes} />
              </CardContent>
            </Card>
          )}

          {/* Request Body */}
          {log.request_body && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">
                  {labels.auditLog.requestBody}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <JsonViewer data={log.request_body} />
              </CardContent>
            </Card>
          )}

          {/* Response Body */}
          {log.response_body && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">
                  {labels.auditLog.responseBody}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <JsonViewer data={log.response_body} defaultCollapsed />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column - narrow metadata */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">
                {labels.auditLog.metadata}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <MetadataRow icon={Globe} label={labels.fields.ipAddress}>
                <code className="text-xs font-mono">{log.ip_address}</code>
              </MetadataRow>
              <MetadataRow icon={Monitor} label={labels.fields.userAgent}>
                <p className="text-xs text-muted-foreground break-all">
                  {log.user_agent}
                </p>
              </MetadataRow>
              {log.geo_location && (
                <MetadataRow icon={Globe} label={labels.fields.location}>
                  <p className="text-sm">
                    {log.geo_location.city}, {log.geo_location.country}
                  </p>
                </MetadataRow>
              )}
              {log.session_id && (
                <MetadataRow icon={User} label={labels.fields.sessionId}>
                  <code className="text-xs font-mono break-all">
                    {log.session_id}
                  </code>
                </MetadataRow>
              )}
              {log.correlation_id && (
                <MetadataRow icon={Link2} label={labels.fields.correlationId}>
                  <code className="text-xs font-mono break-all">
                    {log.correlation_id}
                  </code>
                </MetadataRow>
              )}
              {log.duration_ms !== null && (
                <MetadataRow icon={Timer} label={labels.fields.duration}>
                  <p className="text-sm tabular-nums">
                    {log.duration_ms}ms
                  </p>
                </MetadataRow>
              )}
              {log.entry_hash && (
                <MetadataRow icon={Hash} label={labels.fields.entryHash}>
                  <code className="text-xs font-mono break-all text-muted-foreground">
                    {log.entry_hash}
                  </code>
                </MetadataRow>
              )}
              {log.previous_hash && (
                <MetadataRow icon={Hash} label={labels.fields.previousHash}>
                  <code className="text-xs font-mono break-all text-muted-foreground">
                    {log.previous_hash}
                  </code>
                </MetadataRow>
              )}
            </CardContent>
          </Card>

          {/* Navigation */}
          {log.resource_id && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">
                  {labels.auditLog.navigation}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link
                    href={`/admin/audit/timeline/${log.resource_id}`}
                  >
                    <Clock className="me-2 h-4 w-4" />
                    {labels.auditLog.viewTimeline}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function MetadataRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}
