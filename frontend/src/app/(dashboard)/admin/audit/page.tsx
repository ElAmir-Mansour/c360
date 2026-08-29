"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  BarChart3,
  List,
  Download,
  HardDrive,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/page-header";
import { DataTable } from "@/components/shared/data-table/data-table";
import { SearchInput } from "@/components/shared/forms/search-input";
import { RelativeTime } from "@/components/shared/relative-time";
import { SeverityIndicator } from "@/components/shared/severity-indicator";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { useDataTable } from "@/hooks/use-data-table";
import api from "@/lib/api";
import {
  AUDIT_SEVERITY_FILTER_OPTIONS,
  buildAuditLogQueryParams,
  getDefaultAuditDateRange,
  resolveAuditSeverity,
} from "@/lib/audit";
import type { ColumnDef } from "@tanstack/react-table";
import type { AuditLog } from "@/types/models";
import type { PaginatedResponse } from "@/types/api";
import type { FetchParams, FilterConfig } from "@/types/table";
import { AuditDashboard } from "./_components/audit-dashboard";
import { AuditExportForm } from "./_components/audit-export-form";
import { AuditVerifyPanel } from "./_components/audit-verify-panel";
import { AuditPartitions } from "./_components/audit-partitions";
import { useAdminT, resolveAdminLabels } from "../_lib/admin-i18n";

type AuditLabels = ReturnType<typeof resolveAdminLabels>["audit"];

async function fetchAuditLogs(
  params: FetchParams,
  defaultDateRange = getDefaultAuditDateRange()
): Promise<PaginatedResponse<AuditLog>> {
  const { data } = await api.get<PaginatedResponse<AuditLog>>(
    "/api/v1/audit/logs",
    {
      params: buildAuditLogQueryParams(params, defaultDateRange),
    }
  );
  return data;
}

function buildAuditFilters(labels: AuditLabels): FilterConfig[] {
  return [
    {
      key: "service",
      label: labels.colService,
      type: "select",
      options: [
        { label: labels.svcIam, value: "iam-service" },
        { label: labels.svcCyber, value: "cyber-service" },
        { label: labels.svcData, value: "data-service" },
        { label: labels.svcFile, value: "file-service" },
        { label: labels.svcNotification, value: "notification-service" },
        { label: labels.svcAudit, value: "audit-service" },
      ],
    },
    {
      key: "severity",
      label: labels.colSeverity,
      type: "select",
      options: AUDIT_SEVERITY_FILTER_OPTIONS,
    },
  ];
}

function buildAuditColumns(labels: AuditLabels): ColumnDef<AuditLog>[] {
  return [
    {
      id: "created_at",
      header: labels.colTimestamp,
      accessorKey: "created_at",
      enableSorting: true,
      cell: ({ row }) => <RelativeTime date={row.original.created_at} />,
    },
    {
      id: "user_email",
      header: labels.colUser,
      accessorKey: "user_email",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-body-sm">
          {row.original.user_email || (
            <span className="text-muted-foreground">{labels.system}</span>
          )}
        </span>
      ),
    },
    {
      id: "action",
      header: labels.colAction,
      accessorKey: "action",
      enableSorting: true,
      cell: ({ row }) => (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-caption">
          {row.original.action}
        </code>
      ),
    },
    {
      id: "resource_type",
      header: labels.colResource,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <Badge variant="outline">{row.original.resource_type}</Badge>
          {row.original.resource_id && (
            <code className="font-mono text-caption text-muted-foreground">
              {row.original.resource_id.slice(0, 8)}
            </code>
          )}
        </div>
      ),
    },
    {
      id: "severity",
      header: labels.colSeverity,
      enableSorting: false,
      cell: ({ row }) => (
        <SeverityIndicator
          severity={resolveAuditSeverity(
            row.original.action,
            row.original.severity
          )}
          size="sm"
        />
      ),
    },
    {
      id: "ip_address",
      header: labels.colIp,
      accessorKey: "ip_address",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-caption text-muted-foreground">
          {row.original.ip_address}
        </span>
      ),
    },
  ];
}

export default function AuditLogsPage() {
  const router = useRouter();
  const { audit: t } = useAdminT();
  const auditColumns = useMemo(() => buildAuditColumns(t), [t]);
  const auditFilters = useMemo(() => buildAuditFilters(t), [t]);
  const defaultDateRange = useMemo(() => getDefaultAuditDateRange(), []);
  const fetchAuditLogsWithDefaults = useCallback(
    (params: FetchParams) => fetchAuditLogs(params, defaultDateRange),
    [defaultDateRange]
  );

  const { tableProps } = useDataTable<AuditLog>({
    fetchFn: fetchAuditLogsWithDefaults,
    queryKey: "audit-logs",
    defaultPageSize: 50,
    defaultSort: { column: "created_at", direction: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        description={t.description}
        tags={[
          {
            label: t.tagTamperEvident,
            icon: <ShieldCheck className="h-3.5 w-3.5" aria-hidden />,
            tone: "success",
          },
        ]}
      />

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            {t.tabDashboard}
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-1.5">
            <List className="h-4 w-4" />
            {t.tabLogs}
          </TabsTrigger>
          <TabsTrigger value="export" className="gap-1.5">
            <Download className="h-4 w-4" />
            {t.tabExport}
          </TabsTrigger>
          <TabsTrigger value="integrity" className="gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            {t.tabIntegrity}
          </TabsTrigger>
          <TabsTrigger value="partitions" className="gap-1.5">
            <HardDrive className="h-4 w-4" />
            {t.tabPartitions}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <AuditDashboard params={defaultDateRange} />
        </TabsContent>

        <TabsContent value="logs">
          <DataTable
            {...tableProps}
            columns={auditColumns}
            filters={auditFilters}
            savedViews={{ routeKey: "admin-audit-logs" }}
            onRowClick={(log) => router.push(`/admin/audit/logs/${log.id}`)}
            searchSlot={
              <SearchInput
                value={tableProps.searchValue ?? ""}
                onChange={tableProps.onSearchChange ?? (() => {})}
                placeholder={t.searchPlaceholder}
                loading={tableProps.isLoading}
              />
            }
            enableExport
            onExport={(format) =>
              toast.info(t.exportingLogs(format.toUpperCase()))
            }
            emptyState={{
              icon: ShieldCheck,
              title: t.noAuditLogs,
              description: t.noAuditLogsDescription,
            }}
            stickyHeader
          />
        </TabsContent>

        <TabsContent value="export">
          <AuditExportForm />
        </TabsContent>

        <TabsContent value="integrity">
          <AuditVerifyPanel />
        </TabsContent>

        <TabsContent value="partitions">
          <AuditPartitions />
        </TabsContent>
      </Tabs>
    </div>
  );
}
