"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlarmClock,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  CircleX,
  ListFilter,
  Loader2,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { LexRouteGuard } from "../../_guards/lex-route-guard";
import { useLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useDataTable } from "@/hooks/use-data-table";
import { resolveLocalized } from "@/lib/i18n/localized";
import { useLexFormat } from "@/lib/lex/ksa";
import {
  lexRequestsApi,
  requestCanHaveApprovalTasks,
  type ApprovalTask,
  type LegalRequest,
  type RequestStatus,
  type ReturnIncompleteReasonCode,
  type SLAClock,
} from "@/lib/lex/requests";
import { showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  REQUEST_PRIORITY_OPTIONS,
  REQUEST_STATUS_OPTIONS,
  useServiceDeskLabels,
} from "./labels";
import { useServiceTypeLabel } from "./lex-enums-i18n";
import { actionableRequestApprovalTasks } from "./request-approval-task-eligibility";
import { RETURN_REASON_CODES } from "./return-reason-codes";

const ALL = "__all__";
const PAGE_SIZE = 8;

const copy = {
  en: {
    breadcrumbHome: "WatheeqTech",
    breadcrumbRequests: "Requests",
    title: "Requests",
    approvalTitle: "Pending Approvals",
    approvalDescription:
      "Review requests awaiting your decision, act in bulk and keep approval SLAs on track.",
    description:
      "Review every legal-service request, monitor approvals and keep SLA commitments on track.",
    newRequest: "New Service Request",
    search: "Search by request ID, title or client name…",
    service: "Service",
    status: "Status",
    priority: "Priority",
    all: "All",
    metrics: {
      pending: "Pending Approvals",
      approved: "Approved",
      approvedToday: "Approved Today",
      returned: "Returned",
      breached: "SLA Breached",
    },
    categories: {
      all: "All Requests",
      contracts: "Contract Review",
      consultations: "Consultations",
      investigations: "Investigations",
      execution: "Execution",
    },
    selectAll: "Select all requests on this page",
    selected: (count: string) => `${count} selected`,
    approveSelected: "Approve Selected",
    rejectSelected: "Reject Selected",
    approve: "Approve",
    reject: "Reject",
    details: "View Details",
    noRequester: "Unknown client",
    noDepartment: "Not specified",
    noService: "General legal request",
    noTitle: "Untitled legal request",
    noSla: "SLA not started",
    checking: "Checking SLA…",
    completed: "Completed",
    breached: "SLA breached",
    hours: (value: string) => `${value}h remaining`,
    days: (value: string) => `${value}d remaining`,
    previous: "Previous page",
    next: "Next page",
    pageOf: (page: string, total: string) => `Page ${page} of ${total}`,
    showing: (from: string, to: string, total: string) =>
      `Showing ${from}–${to} of ${total} requests`,
    empty: "No requests found",
    emptyHint: "Try changing the search, category or filters.",
    error: "The requests workspace could not be loaded.",
    retry: "Try again",
    decisionRecorded: "Approval decision recorded",
    decisionsRecorded: (updated: string, failed: string) =>
      failed === "0"
        ? `${updated} requests updated.`
        : `${updated} updated and ${failed} failed.`,
    nothingToApprove: "No selected request has an approval task assigned to you.",
    decisionFailed: "The approval decision could not be recorded.",
    rejectTitle: "Reject this approval?",
    rejectDescription:
      "The request will be returned and your decision will be recorded in the audit trail.",
    rejectSelectedTitle: "Reject selected approvals?",
    rejectSelectedDescription:
      "Every selected approval task assigned to you will be rejected and returned.",
    reason: "Decision reason",
    reasonPlaceholder: "Select a reason",
    cancel: "Cancel",
  },
  ar: {
    breadcrumbHome: "وثيق تك",
    breadcrumbRequests: "الطلبات",
    title: "الطلبات",
    approvalTitle: "الموافقات المعلّقة",
    approvalDescription:
      "راجع الطلبات التي تنتظر قرارك، ونفّذ الإجراءات الجماعية، وتابع مواعيد الموافقات.",
    description:
      "راجع جميع طلبات الخدمات القانونية، وتابع الموافقات، وحافظ على الالتزام بمواعيد مستوى الخدمة.",
    newRequest: "طلب خدمة جديد",
    search: "ابحث برقم الطلب أو العنوان أو اسم العميل…",
    service: "الخدمة",
    status: "الحالة",
    priority: "الأولوية",
    all: "الكل",
    metrics: {
      pending: "الموافقات المعلّقة",
      approved: "الطلبات المعتمدة",
      approvedToday: "المعتمدة اليوم",
      returned: "الطلبات المعادة",
      breached: "تجاوز مستوى الخدمة",
    },
    categories: {
      all: "جميع الطلبات",
      contracts: "مراجعة العقود",
      consultations: "الاستشارات",
      investigations: "التحقيقات",
      execution: "التنفيذ",
    },
    selectAll: "تحديد جميع طلبات هذه الصفحة",
    selected: (count: string) => `تم تحديد ${count}`,
    approveSelected: "اعتماد المحدد",
    rejectSelected: "رفض المحدد",
    approve: "موافقة",
    reject: "رفض",
    details: "عرض التفاصيل",
    noRequester: "عميل غير معروف",
    noDepartment: "غير محددة",
    noService: "طلب قانوني عام",
    noTitle: "طلب قانوني بلا عنوان",
    noSla: "لم يبدأ مستوى الخدمة",
    checking: "جارٍ التحقق من مستوى الخدمة…",
    completed: "مكتمل",
    breached: "تم تجاوز مستوى الخدمة",
    hours: (value: string) => `متبقٍ ${value} ساعة`,
    days: (value: string) => `متبقٍ ${value} يوم`,
    previous: "الصفحة السابقة",
    next: "الصفحة التالية",
    pageOf: (page: string, total: string) => `الصفحة ${page} من ${total}`,
    showing: (from: string, to: string, total: string) =>
      `عرض ${from}–${to} من أصل ${total} طلبًا`,
    empty: "لا توجد طلبات",
    emptyHint: "جرّب تغيير البحث أو الفئة أو عوامل التصفية.",
    error: "تعذّر تحميل مساحة عمل الطلبات.",
    retry: "إعادة المحاولة",
    decisionRecorded: "تم تسجيل قرار الموافقة",
    decisionsRecorded: (updated: string, failed: string) =>
      failed === "٠"
        ? `تم تحديث ${updated} من الطلبات.`
        : `تم تحديث ${updated} وتعذّر تحديث ${failed}.`,
    nothingToApprove: "لا يتضمن التحديد مهمة موافقة مسندة إليك.",
    decisionFailed: "تعذّر تسجيل قرار الموافقة.",
    rejectTitle: "رفض هذه الموافقة؟",
    rejectDescription:
      "سيُعاد الطلب ويُسجّل قرارك في سجل التدقيق.",
    rejectSelectedTitle: "رفض الموافقات المحددة؟",
    rejectSelectedDescription:
      "سيتم رفض جميع مهام الموافقة المحددة والمسندة إليك وإعادة طلباتها.",
    reason: "سبب القرار",
    reasonPlaceholder: "اختر سببًا",
    cancel: "إلغاء",
  },
};

interface FilterOption {
  value: string;
  label: string;
}

interface RequestCategory {
  id: string;
  label: string;
  requestType?: string;
}

export default function RequestInboxPage() {
  return (
    <LexRouteGuard route="/lex/service-desk">
      <RequestInboxContent mode="all" />
    </LexRouteGuard>
  );
}

export function RequestInboxContent({
  mode = "all",
}: {
  mode?: "all" | "approvals";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const t = copy[locale];
  const format = useLexFormat();
  const desk = useServiceDeskLabels();
  const serviceTypeLabel = useServiceTypeLabel();
  const canApprove = hasPermission("lex:request:approve");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkReasonCode, setBulkReasonCode] =
    useState<ReturnIncompleteReasonCode | "">("");
  const [bulkDecisionPending, setBulkDecisionPending] = useState(false);

  const {
    tableProps,
    totalRows,
    searchValue,
    setSearch,
    activeFilters,
    setFilter,
  } = useDataTable<LegalRequest>({
    queryKey:
      mode === "approvals"
        ? "lex-my-approval-requests"
        : "lex-legal-requests",
    fetchFn:
      mode === "approvals"
        ? lexRequestsApi.listMyApprovalRequests
        : lexRequestsApi.listRequests,
    defaultPageSize: PAGE_SIZE,
    defaultSort: { column: "created_at", direction: "desc" },
    wsTopics: ["lex.legal-requests"],
  });

  const rows = tableProps.data;
  useEffect(() => {
    setSelectedIds(new Set());
  }, [tableProps.page, searchValue, activeFilters]);

  const servicesQuery = useQuery({
    queryKey: ["lex-service-catalog", "request-inbox-options"],
    queryFn: () => lexRequestsApi.listServices({ page: 1, per_page: 100 }),
    staleTime: 300_000,
  });
  const serviceOptions = useMemo<FilterOption[]>(
    () =>
      (servicesQuery.data?.data ?? []).map((service) => ({
        value: service.id,
        label:
          locale === "ar"
            ? service.name.ar?.trim() ||
              serviceTypeLabel(service.request_type) ||
              t.noService
            : resolveLocalized(service.name, locale) || service.code,
      })),
    [locale, serviceTypeLabel, servicesQuery.data?.data, t.noService],
  );
  const serviceNames = useMemo(
    () => new Map(serviceOptions.map((option) => [option.value, option.label])),
    [serviceOptions],
  );
  const statusOptions = useMemo(
    () =>
      REQUEST_STATUS_OPTIONS.map((value) => ({
        value,
        label: desk.statusOptions[value] ?? value,
      })),
    [desk.statusOptions],
  );
  const priorityOptions = useMemo(
    () =>
      REQUEST_PRIORITY_OPTIONS.map((value) => ({
        value,
        label: desk.priorityOptions[value] ?? value,
      })),
    [desk.priorityOptions],
  );

  const queueMetricQueries = useQueries({
    queries: [
      {
        queryKey: ["lex-request-queue-kpi", "pending-requester"],
        queryFn: () =>
          lexRequestsApi.listRequests({
            page: 1,
            per_page: 1,
            filters: { status: "pending_requester_approval" },
          }),
        staleTime: 60_000,
      },
      {
        queryKey: ["lex-request-queue-kpi", "pending-provider"],
        queryFn: () =>
          lexRequestsApi.listRequests({
            page: 1,
            per_page: 1,
            filters: { status: "pending_provider_approval" },
          }),
        staleTime: 60_000,
      },
      {
        queryKey: ["lex-request-queue-kpi", "approved"],
        queryFn: () =>
          lexRequestsApi.listRequests({
            page: 1,
            per_page: 100,
            filters: { status: "approved" },
          }),
        staleTime: 60_000,
      },
      {
        queryKey: ["lex-request-queue-kpi", "returned"],
        queryFn: () =>
          lexRequestsApi.listRequests({
            page: 1,
            per_page: 1,
            filters: { status: "returned" },
          }),
        staleTime: 60_000,
      },
      {
        queryKey: ["lex-request-queue-kpi", "sla-breached"],
        queryFn: () =>
          lexRequestsApi.listSlaClocks(
            { page: 1, per_page: 1 },
            { breached: true },
          ),
        staleTime: 60_000,
      },
    ],
  });

  const clocks = useQueries({
    queries: rows.map((request) => ({
      queryKey: ["lex-request-sla-clock", request.id],
      queryFn: () => lexRequestsApi.getRequestClock(request.id),
      staleTime: 60_000,
      retry: false,
      enabled: mode === "all",
    })),
  });
  const approvalTasks = useQueries({
    queries: rows.map((request) => ({
      queryKey: ["lex-approval-tasks", request.id],
      queryFn: () => lexRequestsApi.listApprovalTasks(request.id),
      staleTime: 30_000,
      retry: false,
      enabled:
        mode === "approvals" &&
        requestCanHaveApprovalTasks(request.workflow_instance_id),
    })),
  });
  const clockByRequest = new Map(
    rows.map((request, index) => [
      request.id,
      {
        clock: clocks[index]?.data ?? null,
        loading: clocks[index]?.isLoading ?? false,
      },
    ]),
  );
  const taskByRequest = new Map(
    rows.map((request, index) => [
      request.id,
      {
        task: actionableRequestApprovalTasks(
          approvalTasks[index]?.data ?? [],
        )[0] as ApprovalTask | undefined,
        loading: approvalTasks[index]?.isLoading ?? false,
      },
    ]),
  );

  const categories: RequestCategory[] = [
    { id: "all", label: t.categories.all },
    {
      id: "contracts",
      label: t.categories.contracts,
      requestType: "contract_review",
    },
    {
      id: "consultations",
      label: t.categories.consultations,
      requestType: "consultation",
    },
    {
      id: "investigations",
      label: t.categories.investigations,
      requestType: "investigation",
    },
    {
      id: "execution",
      label: t.categories.execution,
      requestType: "enforcement",
    },
  ];
  const activeRequestType = filterValue(activeFilters.request_type);

  const totalPages = Math.max(1, Math.ceil(totalRows / tableProps.pageSize));
  const pages = paginationWindow(tableProps.page, totalPages);
  const from =
    totalRows === 0 ? 0 : (tableProps.page - 1) * tableProps.pageSize + 1;
  const to =
    totalRows === 0
      ? 0
      : Math.min(tableProps.page * tableProps.pageSize, totalRows);
  const allSelected =
    rows.length > 0 && rows.every((request) => selectedIds.has(request.id));
  const someSelected = rows.some((request) => selectedIds.has(request.id));
  const selectedRows = rows.filter((request) => selectedIds.has(request.id));
  const approvalEligibleRows = selectedRows.filter(
    (request) =>
      isPendingApproval(request.status) &&
      requestCanHaveApprovalTasks(request.workflow_instance_id),
  );

  const openRequestRecords = (params: Record<string, string>) => {
    const query = new URLSearchParams(params);
    query.set("page", "1");
    router.push(`/lex/service-desk?${query.toString()}`);
  };

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  const metricCards = [
    {
      id: "pending",
      label: t.metrics.pending,
      value:
        metricTotal(queueMetricQueries[0]) +
        metricTotal(queueMetricQueries[1]),
      loading:
        queueMetricQueries[0].isLoading || queueMetricQueries[1].isLoading,
      icon: AlarmClock,
      tone: "sky",
      onAction: () =>
        openRequestRecords({
          status: "pending_requester_approval,pending_provider_approval",
        }),
    },
    {
      id: "approved",
      label: t.metrics.approved,
      value:
        mode === "approvals"
          ? countUpdatedToday(queueMetricQueries[2].data?.data ?? [])
          : metricTotal(queueMetricQueries[2]),
      loading: queueMetricQueries[2].isLoading,
      icon: CheckCircle2,
      tone: "emerald",
      onAction: () =>
        openRequestRecords({
          status: "approved",
          ...(mode === "approvals"
            ? {
                updated_from: todayStart.toISOString(),
                updated_to: tomorrowStart.toISOString(),
              }
            : {}),
        }),
    },
    {
      id: "returned",
      label: t.metrics.returned,
      value: metricTotal(queueMetricQueries[3]),
      loading: queueMetricQueries[3].isLoading,
      icon: RotateCcw,
      tone: "amber",
      onAction: () => openRequestRecords({ status: "returned" }),
    },
    {
      id: "breached",
      label: t.metrics.breached,
      value: metricTotal(queueMetricQueries[4]),
      loading: queueMetricQueries[4].isLoading,
      icon: CircleX,
      tone: "rose",
      onAction: () => router.push("/lex/service-desk/sla-board?breached=true"),
    },
  ] as const;

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(rows.map((request) => request.id)) : new Set());
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const refreshQueue = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lex-legal-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["lex-my-approval-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["lex-request-queue-kpi"] }),
    ]);
  };

  const decideSelected = async (
    decision: "approve" | "reject",
    returnReasonCode?: ReturnIncompleteReasonCode,
  ) => {
    if (approvalEligibleRows.length === 0) {
      showError(t.nothingToApprove);
      return;
    }
    setBulkDecisionPending(true);
    try {
      const results = await Promise.allSettled(
        approvalEligibleRows.map(async (request) => {
          const tasks = await lexRequestsApi.listApprovalTasks(request.id);
          const task = actionableRequestApprovalTasks(tasks)[0];
          if (!task) throw new Error("No actionable approval task");
          return lexRequestsApi.decideApprovalTask(
            request.id,
            task.instance_id,
            task.id,
            {
              decision,
              ...(returnReasonCode
                ? { return_reason_code: returnReasonCode }
                : {}),
            },
          );
        }),
      );
      const updated = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - updated;
      showSuccess(
        t.decisionRecorded,
        t.decisionsRecorded(
          format.formatNumber(updated),
          format.formatNumber(failed),
        ),
      );
      setSelectedIds(new Set());
      await refreshQueue();
    } finally {
      setBulkDecisionPending(false);
      setBulkRejectOpen(false);
      setBulkReasonCode("");
    }
  };

  return (
    <div
      dir={direction}
      lang={locale}
      className="space-y-6 pb-8"
      data-testid="requests-inbox"
    >
      <nav
        aria-label={t.breadcrumbRequests}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
      >
        <Link href="/lex" className="transition-colors hover:text-primary">
          {t.breadcrumbHome}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        <span>
          {mode === "approvals" ? t.approvalTitle : t.breadcrumbRequests}
        </span>
      </nav>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {mode === "approvals" ? t.approvalTitle : t.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {mode === "approvals" ? t.approvalDescription : t.description}
          </p>
        </div>
        {mode === "all" && hasPermission("lex:request:add") ? (
          <Button
            className="h-11 rounded-xl px-5 text-sm font-semibold shadow-none"
            onClick={() => router.push("/lex/service-desk/new")}
          >
            <Plus className="me-2 h-4 w-4" aria-hidden />
            {t.newRequest}
          </Button>
        ) : null}
      </header>

      <section
        aria-label={mode === "approvals" ? t.approvalTitle : t.title}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {metricCards.map((metric) => (
          <QueueMetric
            key={metric.id}
            label={
              mode === "approvals" && metric.id === "approved"
                ? t.metrics.approvedToday
                : metric.label
            }
            value={format.formatNumber(metric.value)}
            icon={metric.icon}
            tone={metric.tone}
            loading={metric.loading}
            onAction={metric.onAction}
          />
        ))}
      </section>

      <section className="space-y-4">
        <div
          role="tablist"
          aria-label={t.breadcrumbRequests}
          className="flex flex-wrap items-center gap-2"
        >
          {categories.map((category) => {
            const active = category.requestType
              ? activeRequestType === category.requestType
              : !activeRequestType;
            return (
              <Button
                key={category.id}
                type="button"
                role="tab"
                variant="outline"
                aria-selected={active}
                onClick={() =>
                  setFilter("request_type", category.requestType)
                }
                className={cn(
                  "min-h-10 rounded-xl border px-5 text-sm font-semibold transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border/80 bg-card text-foreground hover:border-primary/30 hover:bg-primary/5",
                )}
              >
                {category.label}
              </Button>
            );
          })}
        </div>

        <div className="grid gap-3 rounded-2xl border border-border/70 bg-card p-3 shadow-sm lg:grid-cols-[minmax(20rem,1fr)_12rem_11rem_11rem]">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={searchValue}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.search}
              aria-label={t.search}
              className="h-11 rounded-xl border-0 bg-muted/35 ps-11 shadow-none focus-visible:bg-background"
            />
          </div>
          <InboxFilter
            label={t.service}
            allLabel={t.all}
            value={filterValue(activeFilters.service_id)}
            options={serviceOptions}
            onChange={(value) => setFilter("service_id", value)}
          />
          <InboxFilter
            label={t.status}
            allLabel={t.all}
            value={filterValue(activeFilters.status)}
            options={statusOptions}
            onChange={(value) => setFilter("status", value)}
          />
          <InboxFilter
            label={t.priority}
            allLabel={t.all}
            value={filterValue(activeFilters.priority)}
            options={priorityOptions}
            onChange={(value) => setFilter("priority", value)}
          />
        </div>

        <div className="flex min-h-16 flex-col gap-3 rounded-2xl border border-border/65 bg-muted/35 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-foreground">
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={(checked) => toggleAll(checked === true)}
              aria-label={t.selectAll}
              className="h-5 w-5 rounded-md"
            />
            <span>
              {t.selectAll}
              {selectedIds.size > 0 ? (
                <span className="ms-2 text-primary">
                  ({t.selected(format.formatNumber(selectedIds.size))})
                </span>
              ) : null}
            </span>
          </label>

          {canApprove ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={
                  approvalEligibleRows.length === 0 || bulkDecisionPending
                }
                onClick={() => void decideSelected("approve")}
                className="h-10 rounded-xl bg-emerald-600 px-5 text-white hover:bg-emerald-700"
              >
                {bulkDecisionPending ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="me-2 h-4 w-4" aria-hidden />
                )}
                {t.approveSelected}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={
                  approvalEligibleRows.length === 0 || bulkDecisionPending
                }
                onClick={() => setBulkRejectOpen(true)}
                className="h-10 rounded-xl px-5"
              >
                <CircleX className="me-2 h-4 w-4" aria-hidden />
                {t.rejectSelected}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-live="polite">
        {tableProps.isLoading && rows.length === 0 ? (
          <RequestCardSkeletons />
        ) : tableProps.error ? (
          <MessageCard
            title={t.error}
            action={
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={tableProps.onRetry}
              >
                {t.retry}
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <MessageCard title={t.empty} description={t.emptyHint} />
        ) : (
          <div className="space-y-3">
            {rows.map((request) => {
              const state = clockByRequest.get(request.id);
              const approvalState = taskByRequest.get(request.id);
              const serviceName =
                (request.service_id &&
                  serviceNames.get(request.service_id)) ||
                (request.request_type
                  ? serviceTypeLabel(request.request_type)
                  : t.noService);
              const title =
                locale === "ar"
                  ? request.title.ar?.trim() || t.noTitle
                  : resolveLocalized(request.title, locale) || t.noTitle;
              return (
                <RequestCard
                  key={request.id}
                  request={request}
                  title={title}
                  serviceName={serviceName}
                  clock={state?.clock ?? null}
                  clockLoading={state?.loading ?? false}
                  approvalTask={
                    mode === "approvals" ? approvalState?.task : undefined
                  }
                  approvalTaskLoading={
                    mode === "approvals"
                      ? approvalState?.loading ?? false
                      : false
                  }
                  detailHref={
                    mode === "approvals"
                      ? `/lex/approvals/requests/${request.id}`
                      : `/lex/service-desk/${request.id}`
                  }
                  selected={selectedIds.has(request.id)}
                  onSelectedChange={(checked) =>
                    toggleOne(request.id, checked)
                  }
                  canApprove={canApprove}
                  labels={t}
                  priorityLabel={
                    desk.priorityOptions[request.priority] ?? request.priority
                  }
                  statusLabel={
                    desk.statusOptions[request.status] ?? request.status
                  }
                  reasonLabels={desk.returnDialog.reasons}
                  date={format.formatDate(request.created_at, {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                  formatNumber={format.formatNumber}
                  onChanged={refreshQueue}
                />
              );
            })}
          </div>
        )}
      </section>

      <footer className="flex flex-col items-center gap-3 pt-2">
        <nav
          aria-label={t.title}
          className="flex items-center justify-center gap-2"
        >
          <PageButton
            disabled={tableProps.page <= 1}
            aria-label={t.previous}
            onClick={() => tableProps.onPageChange(tableProps.page - 1)}
          >
            <ChevronRight className="h-4 w-4 rotate-180 rtl:rotate-0" aria-hidden />
          </PageButton>
          {pages.map((page) => (
            <PageButton
              key={page}
              active={page === tableProps.page}
              aria-current={page === tableProps.page ? "page" : undefined}
              aria-label={`${t.title} ${format.formatNumber(page)}`}
              onClick={() => tableProps.onPageChange(page)}
            >
              {format.formatNumber(page)}
            </PageButton>
          ))}
          <PageButton
            disabled={tableProps.page >= totalPages || totalRows === 0}
            aria-label={t.next}
            onClick={() => tableProps.onPageChange(tableProps.page + 1)}
          >
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </PageButton>
        </nav>
        <p className="text-xs text-muted-foreground">
          {t.pageOf(
            format.formatNumber(tableProps.page),
            format.formatNumber(totalPages),
          )}
          <span className="mx-2" aria-hidden>
            ·
          </span>
          {t.showing(
            format.formatNumber(from),
            format.formatNumber(to),
            format.formatNumber(totalRows),
          )}
        </p>
      </footer>

      <Dialog
        open={bulkRejectOpen}
        onOpenChange={(open) => {
          setBulkRejectOpen(open);
          if (!open) setBulkReasonCode("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.rejectSelectedTitle}</DialogTitle>
            <DialogDescription>{t.rejectSelectedDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t.reason}</Label>
            <Select
              value={bulkReasonCode}
              onValueChange={(value) =>
                setBulkReasonCode(value as ReturnIncompleteReasonCode)
              }
            >
              <SelectTrigger>
                <span>
                  {bulkReasonCode
                    ? desk.returnDialog.reasons[bulkReasonCode]
                    : t.reasonPlaceholder}
                </span>
              </SelectTrigger>
              <SelectContent>
                {RETURN_REASON_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {desk.returnDialog.reasons[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkRejectOpen(false)}
              disabled={bulkDecisionPending}
            >
              {t.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={!bulkReasonCode || bulkDecisionPending}
              onClick={() =>
                void decideSelected("reject", bulkReasonCode || undefined)
              }
            >
              {bulkDecisionPending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {t.rejectSelected}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RequestCard({
  request,
  title,
  serviceName,
  clock,
  clockLoading,
  approvalTask,
  approvalTaskLoading,
  detailHref,
  selected,
  onSelectedChange,
  canApprove,
  labels,
  priorityLabel,
  statusLabel,
  reasonLabels,
  date,
  formatNumber,
  onChanged,
}: {
  request: LegalRequest;
  title: string;
  serviceName: string;
  clock: SLAClock | null;
  clockLoading: boolean;
  approvalTask?: ApprovalTask;
  approvalTaskLoading: boolean;
  detailHref: string;
  selected: boolean;
  onSelectedChange: (checked: boolean) => void;
  canApprove: boolean;
  labels: (typeof copy)["en"];
  priorityLabel: string;
  statusLabel: string;
  reasonLabels: Record<ReturnIncompleteReasonCode, string>;
  date: string;
  formatNumber: (value: number) => string;
  onChanged: () => Promise<void>;
}) {
  return (
    <article
      className={cn(
        "grid gap-4 rounded-2xl border bg-card p-4 shadow-sm transition-all md:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:px-5 lg:py-4",
        selected
          ? "border-primary/45 bg-primary/[0.025] shadow-md"
          : "border-border/75 hover:border-primary/25 hover:shadow-md",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(checked) => onSelectedChange(checked === true)}
        aria-label={`${labels.selectAll}: ${request.request_number}`}
        className="mt-1 h-5 w-5 rounded-md lg:mt-0"
      />

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={detailHref}
            className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            <bdi>{request.request_number || "—"}</bdi>
          </Link>
          <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-foreground/80">
            {serviceName}
          </span>
          <StatusPill value={request.status} label={statusLabel} />
        </div>

        <Link
          href={detailHref}
          className="block truncate text-[15px] font-bold leading-6 text-foreground underline-offset-4 hover:text-primary hover:underline"
        >
          {title}
        </Link>

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground">
          <span>{request.requester_name || labels.noRequester}</span>
          <span aria-hidden>•</span>
          <span>{request.department || labels.noDepartment}</span>
        </p>
      </div>

      <div className="col-start-2 flex flex-col gap-3 lg:col-start-auto lg:min-w-[31rem] lg:flex-row lg:items-center lg:justify-end">
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <span className="min-w-[7.5rem] text-xs font-medium tabular-nums text-muted-foreground">
            {date}
          </span>
          <PriorityPill value={request.priority} label={priorityLabel} />
          {approvalTask || approvalTaskLoading ? (
            <ApprovalTaskSlaPill
              task={approvalTask}
              loading={approvalTaskLoading}
              labels={labels}
              formatNumber={formatNumber}
            />
          ) : (
            <SlaPill
              status={request.status}
              clock={clock}
              loading={clockLoading}
              labels={labels}
              formatNumber={formatNumber}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <InlineDecisionActions
            request={request}
            canApprove={canApprove}
            labels={labels}
            reasonLabels={reasonLabels}
            onChanged={onChanged}
          />
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-9 rounded-xl px-4 text-xs font-semibold shadow-none"
          >
            <Link href={detailHref}>
              {labels.details}
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

function InlineDecisionActions({
  request,
  canApprove,
  labels,
  reasonLabels,
  onChanged,
}: {
  request: LegalRequest;
  canApprove: boolean;
  labels: (typeof copy)["en"];
  reasonLabels: Record<ReturnIncompleteReasonCode, string>;
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reasonCode, setReasonCode] =
    useState<ReturnIncompleteReasonCode | "">("");
  const enabled =
    canApprove &&
    isPendingApproval(request.status) &&
    requestCanHaveApprovalTasks(request.workflow_instance_id);
  const tasksQuery = useQuery({
    queryKey: ["lex-approval-tasks", request.id],
    queryFn: () => lexRequestsApi.listApprovalTasks(request.id),
    enabled,
    retry: false,
  });
  const task = actionableRequestApprovalTasks(tasksQuery.data ?? [])[0];
  const decisionMutation = useMutation({
    mutationFn: ({
      decision,
      returnReasonCode,
    }: {
      decision: "approve" | "reject";
      returnReasonCode?: ReturnIncompleteReasonCode;
    }) => {
      if (!task) throw new Error("No actionable approval task");
      return lexRequestsApi.decideApprovalTask(
        request.id,
        task.instance_id,
        task.id,
        {
          decision,
          ...(returnReasonCode
            ? { return_reason_code: returnReasonCode }
            : {}),
        },
      );
    },
    onSuccess: async () => {
      showSuccess(labels.decisionRecorded);
      setRejectOpen(false);
      setReasonCode("");
      await queryClient.invalidateQueries({
        queryKey: ["lex-approval-tasks", request.id],
      });
      await onChanged();
    },
    onError: () => showError(labels.decisionFailed),
  });

  if (!enabled) return null;

  const disabled =
    tasksQuery.isLoading || !task || decisionMutation.isPending;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => decisionMutation.mutate({ decision: "approve" })}
        className="h-9 rounded-xl bg-emerald-50 px-4 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        {decisionMutation.isPending ? (
          <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : null}
        {labels.approve}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setRejectOpen(true)}
        className="h-9 rounded-xl bg-rose-50 px-4 text-xs font-semibold text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
      >
        {labels.reject}
      </Button>
      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open);
          if (!open) setReasonCode("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.rejectTitle}</DialogTitle>
            <DialogDescription>{labels.rejectDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{labels.reason}</Label>
            <Select
              value={reasonCode}
              onValueChange={(value) =>
                setReasonCode(value as ReturnIncompleteReasonCode)
              }
            >
              <SelectTrigger>
                <span>
                  {reasonCode
                    ? reasonLabels[reasonCode]
                    : labels.reasonPlaceholder}
                </span>
              </SelectTrigger>
              <SelectContent>
                {RETURN_REASON_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {reasonLabels[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              {labels.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={!reasonCode || decisionMutation.isPending}
              onClick={async () => {
                if (!reasonCode) return;
                await decisionMutation.mutateAsync({
                  decision: "reject",
                  returnReasonCode: reasonCode,
                });
              }}
            >
              {decisionMutation.isPending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {labels.reject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function QueueMetric({
  label,
  value,
  icon: Icon,
  tone,
  loading,
  onAction,
}: {
  label: string;
  value: string;
  icon: typeof BarChart3;
  tone: "sky" | "emerald" | "amber" | "rose";
  loading: boolean;
  onAction: () => void;
}) {
  const toneClasses = {
    sky: "kpi-theme-sky",
    emerald: "kpi-theme-emerald",
    amber: "kpi-theme-amber",
    rose: "kpi-theme-red",
  };

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onAction}
      className={cn(
        "kpi-card-themed h-auto min-h-32 items-stretch justify-start p-5 text-start font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        toneClasses[tone],
      )}
    >
      <span className="kpi-icon-badge absolute end-4 top-4">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="pe-12 text-sm font-semibold text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-5 h-8 w-16 rounded-md" />
      ) : (
        <p className="mt-4 text-3xl font-bold tabular-nums text-[color:var(--kpi-accent-resolved)]">
          {value}
        </p>
      )}
    </Button>
  );
}

function InboxFilter({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value?: string;
  options: FilterOption[];
  onChange: (value: string | undefined) => void;
}) {
  const selected =
    options.find((option) => option.value === value)?.label ?? allLabel;
  return (
    <Select
      value={value || ALL}
      onValueChange={(next) => onChange(next === ALL ? undefined : next)}
    >
      <SelectTrigger
        aria-label={`${label}: ${selected}`}
        className="h-11 rounded-xl border-0 bg-muted/35 px-4 text-sm text-muted-foreground shadow-none [&>svg:last-child]:hidden"
      >
        <span className="truncate">
          {label}: <span>{selected}</span>
        </span>
        <ListFilter className="ms-2 h-4 w-4 shrink-0" aria-hidden />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PriorityPill({ value, label }: { value: string; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-md px-2.5 py-1 text-xs font-semibold",
        value === "emergency"
          ? "bg-red-100 text-red-700 dark:bg-red-950/45 dark:text-red-300"
          : value === "urgent"
            ? "bg-rose-100 text-rose-700 dark:bg-rose-950/45 dark:text-rose-300"
            : "bg-sky-100 text-sky-700 dark:bg-sky-950/45 dark:text-sky-300",
      )}
    >
      {label}
    </span>
  );
}

function ApprovalTaskSlaPill({
  task,
  loading,
  labels,
  formatNumber,
}: {
  task?: ApprovalTask;
  loading: boolean;
  labels: (typeof copy)["en"];
  formatNumber: (value: number) => string;
}) {
  if (loading) {
    return <Skeleton className="h-7 w-24 rounded-md" />;
  }
  if (!task?.sla_deadline) {
    return (
      <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
        {labels.noSla}
      </span>
    );
  }

  const hours = (new Date(task.sla_deadline).getTime() - Date.now()) / 3_600_000;
  const breached = task.sla_breached || hours <= 0;
  const value =
    Math.abs(hours) >= 24
      ? labels.days(formatNumber(Math.ceil(Math.abs(hours) / 24)))
      : labels.hours(formatNumber(Math.max(1, Math.ceil(Math.abs(hours)))));

  return (
    <span
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums",
        breached
          ? "bg-red-100 text-red-700 dark:bg-red-950/45 dark:text-red-300"
          : hours <= 24
            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/45 dark:text-amber-300"
            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300",
      )}
    >
      {breached ? labels.breached : value}
    </span>
  );
}

function StatusPill({ value, label }: { value: RequestStatus; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-md px-2.5 py-1 text-xs font-semibold",
        statusTone(value),
      )}
    >
      {label}
    </span>
  );
}

function SlaPill({
  status,
  clock,
  loading,
  labels,
  formatNumber,
}: {
  status: RequestStatus;
  clock: SLAClock | null;
  loading: boolean;
  labels: (typeof copy)["en"];
  formatNumber: (value: number) => string;
}) {
  const text = formatSla(status, clock, loading, labels, formatNumber);
  const breached =
    clock?.breached || clock?.outcome === "breached";
  const completed = status === "closed" || Boolean(clock?.resolved_at);
  const dueSoon =
    clock?.turnaround_due_at &&
    new Date(clock.turnaround_due_at).getTime() - Date.now() <= 24 * 3_600_000;
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-md px-2.5 py-1 text-xs font-semibold",
        loading
          ? "bg-muted text-muted-foreground"
          : breached
            ? "bg-rose-100 text-rose-700 dark:bg-rose-950/45 dark:text-rose-300"
            : completed
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300"
              : dueSoon
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/45 dark:text-amber-300"
                : "bg-muted text-muted-foreground",
      )}
    >
      {text}
    </span>
  );
}

function statusTone(status: RequestStatus): string {
  if (status === "closed" || status === "delivered") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300";
  }
  if (
    status === "pending_requester_approval" ||
    status === "pending_provider_approval" ||
    status === "in_execution"
  ) {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/45 dark:text-amber-300";
  }
  if (status === "returned" || status === "cancelled") {
    return "bg-rose-100 text-rose-700 dark:bg-rose-950/45 dark:text-rose-300";
  }
  if (status === "draft") {
    return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  }
  return "bg-sky-100 text-sky-700 dark:bg-sky-950/45 dark:text-sky-300";
}

function MessageCard({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/75 bg-card px-6 py-16 text-center shadow-sm">
      <p className="font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

function RequestCardSkeletons() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="flex min-h-28 items-center gap-4 rounded-2xl border border-border/75 bg-card p-5"
        >
          <Skeleton className="h-5 w-5 rounded-md" />
          <div className="flex-1 space-y-3">
            <div className="flex gap-2">
              <Skeleton className="h-6 w-28 rounded-md" />
              <Skeleton className="h-6 w-32 rounded-md" />
            </div>
            <Skeleton className="h-5 w-2/3 rounded-md" />
            <Skeleton className="h-4 w-48 rounded-md" />
          </div>
          <Skeleton className="hidden h-9 w-28 rounded-xl md:block" />
        </div>
      ))}
    </div>
  );
}

function PageButton({
  active,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { active?: boolean }) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      className={cn(
        "h-9 min-w-9 rounded-xl px-3 text-xs shadow-none",
        active && "pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}

function filterValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function paginationWindow(page: number, total: number) {
  if (total <= 3) return Array.from({ length: total }, (_, index) => index + 1);
  const start = Math.min(Math.max(1, page - 1), total - 2);
  return [start, start + 1, start + 2];
}

function metricTotal(query: { data?: { meta: { total: number } } }): number {
  return query.data?.meta.total ?? 0;
}

function countUpdatedToday(requests: LegalRequest[]): number {
  const today = new Date();
  return requests.filter((request) => {
    const updated = new Date(request.updated_at);
    return (
      updated.getFullYear() === today.getFullYear() &&
      updated.getMonth() === today.getMonth() &&
      updated.getDate() === today.getDate()
    );
  }).length;
}

function isPendingApproval(status: RequestStatus): boolean {
  return (
    status === "pending_requester_approval" ||
    status === "pending_provider_approval"
  );
}

function formatSla(
  status: RequestStatus,
  clock: SLAClock | null,
  loading: boolean,
  labels: (typeof copy)["en"],
  formatNumber: (value: number) => string,
) {
  if (loading) return labels.checking;
  if (status === "closed" || clock?.resolved_at) return labels.completed;
  if (clock?.breached || clock?.outcome === "breached") return labels.breached;
  if (!clock?.turnaround_due_at) return labels.noSla;
  const remaining = new Date(clock.turnaround_due_at).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return labels.breached;
  const hours = Math.max(1, Math.ceil(remaining / 3_600_000));
  return hours <= 48
    ? labels.hours(formatNumber(hours))
    : labels.days(formatNumber(Math.ceil(hours / 24)));
}
