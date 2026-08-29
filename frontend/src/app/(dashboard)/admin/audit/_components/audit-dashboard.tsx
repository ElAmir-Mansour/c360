"use client";

import { useAuditStats } from "@/hooks/use-audit";
import { AuditStatsCards } from "./audit-stats-cards";
import { AuditCharts } from "./audit-charts";
import { AuditTopTables } from "./audit-top-tables";
import type { AuditStatsParams } from "@/types/audit";
import { useAdminT } from "../../_lib/admin-i18n";

interface AuditDashboardProps {
  params?: AuditStatsParams;
}

export function AuditDashboard({ params }: AuditDashboardProps) {
  const labels = useAdminT();
  const { data: stats, isLoading, error, refetch } = useAuditStats(params);

  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : labels.audit.failedToLoadStats
    : undefined;

  return (
    <div className="space-y-6">
      <AuditStatsCards stats={stats} loading={isLoading} />
      <AuditCharts
        stats={stats}
        loading={isLoading}
        error={errorMessage}
        onRetry={() => refetch()}
      />
      <AuditTopTables stats={stats} loading={isLoading} />
    </div>
  );
}
