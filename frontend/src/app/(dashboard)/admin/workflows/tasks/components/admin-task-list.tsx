"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, CheckCircle2, AlarmClock, ArrowUpCircle } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { API_ENDPOINTS } from "@/lib/constants";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { DataTable } from "@/components/shared/data-table/data-table";
import { ErrorState } from "@/components/common/error-state";
import { useDataTable } from "@/hooks/use-data-table";
import { useRealtimeData } from "@/hooks/use-realtime-data";
import { SearchInput } from "@/components/shared/forms/search-input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fetchRoleFilterOptions } from "@/components/workflows/task-filters";
import { showError, showSuccess } from "@/lib/toast";
import {
  useLocaleOrDefault,
  useT,
} from "@/components/providers/locale-provider";
import type { HumanTask, TaskCounts } from "@/types/models";
import type { PaginatedResponse } from "@/types/api";
import {
  createAdminTaskFilters,
  getAdminWorkflowLabels,
} from "../_lib/admin-workflow-i18n";
import { AdminTaskStatusTabs } from "./admin-task-status-tabs";
import { getAdminTaskColumns } from "./admin-task-columns";
import { AdminTaskDelegateDialog } from "./admin-task-delegate-dialog";

const TAB_PARAMS: Record<string, Record<string, string>> = {
  all: { sort: "created_at", order: "desc" },
  pending: { status: "pending" },
  claimed: { status: "claimed" },
  completed: { status: "completed" },
  overdue: { status: "pending,claimed", sla_breached: "true" },
};

const TASK_WS_TOPICS = [
  "task.assigned",
  "task.completed",
  "task.escalated",
  "task.overdue",
  "workflow.task.created",
  "workflow.task.completed",
  "workflow.task.escalated",
];

const KPI_HOVER = "";

export function AdminTaskList() {
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = pathname ?? "/admin/workflows/tasks";
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const activeTab = searchParams?.get("tab") ?? "all";
  const [delegateTask, setDelegateTask] = useState<HumanTask | null>(null);
  const t = useT("admin");
  const { locale } = useLocaleOrDefault();
  const labels = getAdminWorkflowLabels(locale);

  const {
    data: counts,
    error: countsError,
    mutate: refetchCounts,
  } = useRealtimeData<TaskCounts>(API_ENDPOINTS.WORKFLOWS_TASKS_COUNT, {
    wsTopics: TASK_WS_TOPICS,
    pollInterval: 30000,
  });

  const { data: roleOptions = [] } = useQuery({
    queryKey: ["task-filter-roles"],
    queryFn: fetchRoleFilterOptions,
    staleTime: 60_000,
  });

  const claimTaskMutation = useMutation({
    mutationFn: (taskId: string) =>
      apiPost(`/api/v1/workflows/tasks/${taskId}/claim`),
    onSuccess: async () => {
      showSuccess(t("atl.claimed"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-tasks"] }),
        queryClient.invalidateQueries({
          queryKey: [API_ENDPOINTS.WORKFLOWS_TASKS_COUNT],
        }),
      ]);
    },
    onError: (error: unknown) => {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number((error as { status?: number }).status)
          : undefined;

      if (status === 409) {
        showError(t("atl.claimedByOther"));
      } else if (status === 403) {
        showError(t("atl.noRole"));
      } else {
        showError(t("atl.failedClaim"));
      }

      void queryClient.invalidateQueries({ queryKey: ["admin-tasks"] });
    },
  });

  const filters = useMemo(
    () => createAdminTaskFilters(locale, roleOptions),
    [locale, roleOptions],
  );

  const taskTable = useDataTable<HumanTask>({
    queryKey: "admin-tasks",
    defaultPageSize: 25,
    defaultSort: { column: "created_at", direction: "desc" },
    wsTopics: TASK_WS_TOPICS,
    fetchFn: async (params) => {
      const filtersMap = params.filters ?? {};
      const queryParams: Record<string, unknown> = {
        ...TAB_PARAMS[activeTab],
        page: params.page,
        per_page: params.per_page,
        sort: params.sort ?? "created_at",
        order: params.order ?? "desc",
        scope: "tenant",
      };

      if (params.search) {
        queryParams.search = params.search;
      }

      for (const [key, value] of Object.entries(filtersMap)) {
        queryParams[key] = Array.isArray(value) ? value.join(",") : value;
      }

      return apiGet<PaginatedResponse<HumanTask>>(
        API_ENDPOINTS.WORKFLOWS_TASKS,
        queryParams,
      );
    },
  });

  const columns = getAdminTaskColumns({
    locale,
    onOpen: (task) => router.push(`/admin/workflows/tasks/${task.id}`),
    onClaim: (task) => claimTaskMutation.mutate(task.id),
    onDelegate: (task) => setDelegateTask(task),
    onViewWorkflow: (task) =>
      router.push(`/admin/workflows/instances/${task.instance_id}`),
    currentUser: null,
  });

  const handleTabChange = (tab: string) => {
    const nextParams = new URLSearchParams(searchParams?.toString() ?? "");
    if (tab === "all") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", tab);
    }
    nextParams.set("page", "1");
    router.push(`${currentPath}?${nextParams.toString()}`);
  };

  const countsLoading = !counts && !countsError;

  if (taskTable.error || countsError) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={t("td.eyebrow")}
          title={t("atl.title")}
          description={t("atl.descShort")}
        />
        <ErrorState
          message={t("atl.failedLoad")}
          onRetry={() => {
            void taskTable.refetch();
            void refetchCounts();
          }}
        />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <PageHeader
          eyebrow={t("td.eyebrow")}
          title={t("atl.title")}
          description={t("atl.desc")}
          tags={[
            {
              label: t("atl.pendingCount", {
                n: (counts?.pending ?? 0).toLocaleString(),
              }),
              tone: (counts?.pending ?? 0) > 0 ? "warning" : "neutral",
              icon: <Inbox className="h-3.5 w-3.5" aria-hidden />,
            },
            {
              label: t("atl.overdueCount", {
                n: (counts?.overdue ?? 0).toLocaleString(),
              }),
              tone: (counts?.overdue ?? 0) > 0 ? "danger" : "neutral",
            },
          ]}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title={t("atl.kpiPending")}
            value={counts?.pending ?? 0}
            icon={Inbox}
            tone="gold"
            loading={countsLoading}
            className={KPI_HOVER}
          />
          <KpiCard
            title={t("atl.kpiCompleted")}
            value={counts?.completed ?? 0}
            icon={CheckCircle2}
            tone="emerald"
            loading={countsLoading}
            className={KPI_HOVER}
          />
          <KpiCard
            title={t("atl.kpiOverdue")}
            value={counts?.overdue ?? 0}
            icon={AlarmClock}
            tone="rose"
            loading={countsLoading}
            className={KPI_HOVER}
          />
          <KpiCard
            title={t("atl.kpiEscalated")}
            value={counts?.escalated ?? 0}
            icon={ArrowUpCircle}
            tone="rose"
            loading={countsLoading}
            className={KPI_HOVER}
          />
        </div>

        <AdminTaskStatusTabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          counts={counts}
          locale={locale}
        />

        <DataTable
          columns={columns}
          filters={filters}
          emptyState={{
            icon: Inbox,
            title: labels.taskEmpty.title,
            description: labels.taskEmpty.description,
          }}
          searchSlot={
            <SearchInput
              value={taskTable.searchValue}
              onChange={taskTable.setSearch}
              placeholder={t("atl.searchPlaceholder")}
            />
          }
          {...taskTable.tableProps}
          onRowClick={(row) => router.push(`/admin/workflows/tasks/${row.id}`)}
        />

        {delegateTask && (
          <AdminTaskDelegateDialog
            task={delegateTask}
            open={Boolean(delegateTask)}
            onOpenChange={(open) => {
              if (!open) setDelegateTask(null);
            }}
            onSuccess={() => {
              setDelegateTask(null);
              queryClient.invalidateQueries({ queryKey: ["admin-tasks"] });
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
