"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronRight,
  Clock3,
  Loader2,
  RotateCcw,
  ShieldAlert,
  UserRoundCog,
} from "lucide-react";
import { BarChart } from "@/components/shared/charts/bar-chart";
import { Combobox } from "@/components/shared/forms/combobox";
import {
  SimpleTable,
  type Column,
} from "@/components/shared/simple-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/components/providers/locale-provider";
import { apiPost } from "@/lib/api";
import { enterpriseApi } from "@/lib/enterprise/api";
import { useLexFormat } from "@/lib/lex/ksa";
import {
  lexRequestsApi,
  type SLAClockView,
} from "@/lib/lex/requests";
import { showApiError, showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { LexRouteGuard } from "../../_guards/lex-route-guard";
import { actionableRequestApprovalTasks } from "../../service-desk/_components/request-approval-task-eligibility";

const COPY = {
  en: {
    home: "WatheeqTech",
    approvals: "Approvals",
    title: "Escalation Management",
    description:
      "Monitor approval SLA breaches, reassign owners and force critical escalations.",
    level: (value: number) => `Level ${value}`,
    avgResolution: "Avg. Resolution",
    hours: "hrs",
    rules: "Escalation Rules & Thresholds",
    rule1: "Auto-escalate to manager",
    rule2: "Escalate to department head",
    rule3: "Escalate to executive sponsor",
    active: "Active Escalations",
    request: "Request",
    service: "Service",
    levelColumn: "Level",
    owner: "Current owner",
    overdue: "Overdue",
    actions: "Actions",
    reassign: "Reassign",
    force: "Force Escalate",
    view: "View request",
    unassigned: "Unassigned",
    noRows: "No active escalations.",
    trend: "Monthly Escalation Trend",
    critical: "Critical SLA",
    resolved: "Resolved",
    transferTitle: "Reassign escalation",
    transferDescription:
      "Transfer the request's active approval task to another manager.",
    manager: "Select a manager",
    search: "Search managers...",
    cancel: "Cancel",
    confirm: "Reassign request",
    transferSuccess: "Escalation reassigned.",
    forceSuccess: "Escalation advanced.",
    noTask: "This request has no actionable approval task to reassign.",
    error: "Escalation data could not be loaded.",
  },
  ar: {
    home: "وثيق تك",
    approvals: "الموافقات",
    title: "إدارة التصعيدات والتجاوزات",
    description:
      "راقب تجاوزات اتفاقية مستوى الخدمة، وأعد إسناد المالكين، وصعّد الحالات الحرجة.",
    level: (value: number) => `المستوى ${value}`,
    avgResolution: "متوسط الحل",
    hours: "ساعة",
    rules: "قواعد ومستويات التصعيد",
    rule1: "تصعيد آلي إلى المدير",
    rule2: "تصعيد إلى رئيس الإدارة",
    rule3: "تصعيد إلى الراعي التنفيذي",
    active: "التصعيدات النشطة",
    request: "الطلب",
    service: "الخدمة",
    levelColumn: "المستوى",
    owner: "المالك الحالي",
    overdue: "مدة التجاوز",
    actions: "الإجراءات",
    reassign: "إعادة إسناد",
    force: "تصعيد فوري",
    view: "عرض الطلب",
    unassigned: "غير مسند",
    noRows: "لا توجد تصعيدات نشطة.",
    trend: "اتجاه التصعيدات الشهري",
    critical: "تجاوزات حرجة",
    resolved: "تم الحل",
    transferTitle: "إعادة إسناد التصعيد",
    transferDescription: "حوّل مهمة الموافقة النشطة إلى مدير آخر.",
    manager: "اختر مديرًا",
    search: "ابحث عن مدير...",
    cancel: "إلغاء",
    confirm: "إعادة إسناد الطلب",
    transferSuccess: "تمت إعادة إسناد التصعيد.",
    forceSuccess: "تم رفع مستوى التصعيد.",
    noTask: "لا يتضمن هذا الطلب مهمة موافقة قابلة لإعادة الإسناد.",
    error: "تعذّر تحميل بيانات التصعيد.",
  },
} as const;

export default function EscalationManagementPage() {
  return (
    <LexRouteGuard route="/lex/approvals/escalations">
      <EscalationManagementContent />
    </LexRouteGuard>
  );
}

function EscalationManagementContent() {
  const { locale, direction } = useLocale();
  const t = COPY[locale];
  const f = useLexFormat();
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canManage =
    hasPermission("lex:escalation:manage") || hasPermission("workflow:write");
  const [reassignClock, setReassignClock] = useState<SLAClockView | null>(null);
  const [managerId, setManagerId] = useState("");
  const [recordScope, setRecordScope] = useState<{
    label: string;
    predicate: (clock: SLAClockView) => boolean;
  } | null>(null);

  const clocksQuery = useQuery({
    queryKey: ["lex-approval-escalation-clocks"],
    queryFn: () =>
      lexRequestsApi.listSlaClocks(
        { page: 1, per_page: 200, sort: "updated_at", order: "desc" },
        {},
      ),
    refetchInterval: 60_000,
  });
  const usersQuery = useQuery({
    queryKey: ["lex-escalation-managers"],
    queryFn: () =>
      enterpriseApi.users.list({
        page: 1,
        per_page: 100,
        sort: "first_name",
        order: "asc",
      }),
    enabled: canManage,
    staleTime: 300_000,
  });
  const managerOptions = (usersQuery.data?.data ?? [])
    .filter((candidate) => candidate.status === "active" && candidate.id !== user?.id)
    .map((candidate) => ({
      value: candidate.id,
      label:
        `${candidate.first_name} ${candidate.last_name}`.trim() ||
        candidate.email,
    }));

  const clocks = useMemo(
    () => clocksQuery.data?.data ?? [],
    [clocksQuery.data?.data],
  );
  const active = clocks.filter(
    (clock) =>
      clock.breached ||
      clock.escalation_level > 0 ||
      clock.ack_overdue ||
      clock.escalation_imminent,
  );
  const averageResolution = averageResolutionHours(clocks);
  const trend = useMemo(() => buildTrend(clocks, locale), [clocks, locale]);

  const reassignMutation = useMutation({
    mutationFn: async () => {
      if (!reassignClock || !managerId) return;
      const tasks = await lexRequestsApi.listApprovalTasks(
        reassignClock.legal_request_id,
      );
      const task = actionableRequestApprovalTasks(tasks)[0];
      if (!task) throw new Error(t.noTask);
      await apiPost(`/api/v1/workflows/tasks/${task.id}/delegate`, {
        delegate_to: managerId,
        reason: "Escalation ownership reassigned",
      });
    },
    onSuccess: async () => {
      showSuccess(t.transferSuccess);
      setReassignClock(null);
      setManagerId("");
      await queryClient.invalidateQueries({
        queryKey: ["lex-approval-escalation-clocks"],
      });
    },
    onError: (error) => {
      if (error instanceof Error && error.message === t.noTask) {
        showError(t.noTask);
        return;
      }
      showApiError(error);
    },
  });
  const escalateMutation = useMutation({
    mutationFn: (clock: SLAClockView) =>
      lexRequestsApi.escalateClock(clock.id),
    onSuccess: async () => {
      showSuccess(t.forceSuccess);
      await queryClient.invalidateQueries({
        queryKey: ["lex-approval-escalation-clocks"],
      });
    },
    onError: showApiError,
  });

  const kpis = [1, 2, 3].map((level) => ({
    id: `l${level}`,
    label: t.level(level),
    value: active.filter((clock) => escalationLevel(clock) === level).length,
    icon: level === 1 ? Clock3 : ShieldAlert,
    tone: level === 1 ? "amber" : level === 2 ? "orange" : "red",
  }));
  const scopedClocks = recordScope ? clocks.filter(recordScope.predicate) : active;
  const escalationRows: EscalationRow[] = scopedClocks.map((clock) => ({ clock }));
  const revealRecords = (
    label: string,
    predicate: (clock: SLAClockView) => boolean,
  ) => {
    setRecordScope({ label, predicate });
    requestAnimationFrame(() =>
      document.getElementById("approval-escalation-records")?.scrollIntoView({
        behavior: "smooth",
      }),
    );
  };
  const columns: Column<EscalationRow>[] = [
    {
      key: "request",
      header: t.request,
      render: ({ clock }) => (
        <Link
          href={`/lex/service-desk/${clock.legal_request_id}`}
          className="font-semibold text-foreground hover:text-primary hover:underline"
        >
          <bdi>{requestLabel(clock)}</bdi>
        </Link>
      ),
    },
    {
      key: "service",
      header: t.service,
      render: ({ clock }) => (
        <span className="text-muted-foreground">{clock.service_code}</span>
      ),
    },
    {
      key: "level",
      header: t.levelColumn,
      render: ({ clock }) => (
        <LevelBadge
          level={escalationLevel(clock)}
          label={t.level(escalationLevel(clock))}
        />
      ),
    },
    {
      key: "owner",
      header: t.owner,
      render: ({ clock }) => (
        <span className="text-muted-foreground">
          {clock.next_escalation_recipient || t.unassigned}
        </span>
      ),
    },
    {
      key: "overdue",
      header: t.overdue,
      render: ({ clock }) => (
        <span className="font-semibold text-destructive">
          {f.formatNumber(overdueHours(clock))} {t.hours}
        </span>
      ),
    },
    {
      key: "actions",
      header: t.actions,
      align: "right",
      className: "min-w-[18rem]",
      render: ({ clock }) => (
        <div className="flex justify-end gap-2">
          {canManage ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="shadow-none"
                onClick={() => setReassignClock(clock)}
              >
                <UserRoundCog className="me-1.5 h-4 w-4" aria-hidden />
                {t.reassign}
              </Button>
              <Button
                size="sm"
                disabled={escalateMutation.isPending}
                onClick={() => escalateMutation.mutate(clock)}
              >
                <ArrowUpRight className="me-1.5 h-4 w-4 rtl:-scale-x-100" aria-hidden />
                {t.force}
              </Button>
            </>
          ) : (
            <Button asChild size="sm" variant="outline" className="shadow-none">
              <Link href={`/lex/service-desk/${clock.legal_request_id}`}>
                {t.view}
              </Link>
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div dir={direction} lang={locale} className="space-y-6 pb-8">
      <nav className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Link href="/lex" className="hover:text-primary">{t.home}</Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        <Link href="/lex/approvals/requests" className="hover:text-primary">
          {t.approvals}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        <span>{t.title}</span>
      </nav>

      <header>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{t.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t.description}</p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <MetricCard
            key={kpi.id}
            label={kpi.label}
            value={f.formatNumber(kpi.value)}
            loading={clocksQuery.isLoading}
            tone={kpi.tone}
            icon={kpi.icon}
            onAction={() =>
              revealRecords(kpi.label, (clock) => escalationLevel(clock) === Number(kpi.id.slice(1)))
            }
          />
        ))}
        <MetricCard
          label={t.avgResolution}
          value={`${f.formatNumber(averageResolution)} ${t.hours}`}
          loading={clocksQuery.isLoading}
          tone="teal"
          icon={RotateCcw}
          onAction={() => revealRecords(t.avgResolution, (clock) => Boolean(clock.resolved_at))}
        />
      </section>

      <Card className="rounded-xl border-border/70 bg-card shadow-none">
        <CardHeader>
          <CardTitle className="text-lg">{t.rules}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {[
            { level: 1, hours: 24, label: t.rule1 },
            { level: 2, hours: 48, label: t.rule2 },
            { level: 3, hours: 72, label: t.rule3 },
          ].map((rule) => (
            <div key={rule.level} className="rounded-lg border border-border/70 bg-muted/25 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-foreground">{t.level(rule.level)}</span>
                <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                  {f.formatNumber(rule.hours)} {t.hours}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{rule.label}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card id="approval-escalation-records" className="scroll-mt-24 rounded-xl border-border/70 bg-card shadow-none">
        <CardHeader><CardTitle className="text-lg">{recordScope?.label ?? t.active}</CardTitle></CardHeader>
        <CardContent>
          {clocksQuery.isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : clocksQuery.isError ? (
            <p className="p-8 text-center text-sm text-destructive">{t.error}</p>
          ) : (
            <SimpleTable
              columns={columns}
              data={escalationRows}
              getRowKey={(row) => row.clock.id}
              emptyMessage={t.noRows}
              ariaLabel={t.active}
              className="rounded-lg border-border/70 shadow-none"
            />
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border/70 bg-card shadow-none">
        <CardHeader><CardTitle className="text-lg">{t.trend}</CardTitle></CardHeader>
        <CardContent>
          <BarChart
            data={trend}
            xKey="month"
            yKeys={[
              { key: "critical", label: t.critical, color: "hsl(var(--destructive))" },
              { key: "resolved", label: t.resolved, color: "hsl(var(--primary))" },
            ]}
            height={280}
            showLegend
            showGrid
            emptyMessage={t.noRows}
            onItemSelect={(datum, seriesKey) => {
              const monthKey = String(datum.key ?? "");
              revealRecords(
                `${String(datum.month)} · ${seriesKey === "resolved" ? t.resolved : t.critical}`,
                (clock) => {
                  const value = seriesKey === "resolved" ? clock.resolved_at : clock.created_at;
                  if (!value) return false;
                  const date = new Date(value);
                  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
                  return key === monthKey &&
                    (seriesKey !== "critical" || clock.breached || clock.escalation_level >= 2);
                },
              );
            }}
          />
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(reassignClock)}
        onOpenChange={(open) => {
          if (!open) {
            setReassignClock(null);
            setManagerId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.transferTitle}</DialogTitle>
            <DialogDescription>{t.transferDescription}</DialogDescription>
          </DialogHeader>
          <Combobox
            options={managerOptions}
            value={managerId}
            onChange={setManagerId}
            placeholder={t.manager}
            searchPlaceholder={t.search}
            disabled={usersQuery.isLoading || reassignMutation.isPending}
            className="w-full"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignClock(null)}>
              {t.cancel}
            </Button>
            <Button
              disabled={!managerId || reassignMutation.isPending}
              onClick={() => reassignMutation.mutate()}
            >
              {reassignMutation.isPending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {t.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type EscalationRow = { clock: SLAClockView } & Record<string, unknown>;

function escalationLevel(clock: SLAClockView): number {
  if (clock.escalation_level >= 3) return 3;
  if (clock.escalation_level === 2) return 2;
  return 1;
}

function overdueHours(clock: SLAClockView): number {
  const due = new Date(clock.turnaround_due_at).getTime();
  return Math.max(0, Math.ceil((Date.now() - due) / 3_600_000));
}

function averageResolutionHours(clocks: SLAClockView[]): number {
  const resolved = clocks.filter((clock) => clock.resolved_at);
  if (resolved.length === 0) return 0;
  return Math.round(
    resolved.reduce(
      (total, clock) =>
        total +
        (new Date(clock.resolved_at!).getTime() -
          new Date(clock.clock_started_at).getTime()) /
          3_600_000,
      0,
    ) / resolved.length,
  );
}

function buildTrend(clocks: SLAClockView[], locale: "en" | "ar") {
  const formatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", {
    month: "short",
  });
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - (5 - index));
    const sameMonth = (value: string) => {
      const candidate = new Date(value);
      return (
        candidate.getFullYear() === date.getFullYear() &&
        candidate.getMonth() === date.getMonth()
      );
    };
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      month: formatter.format(date),
      critical: clocks.filter(
        (clock) =>
          sameMonth(clock.created_at) &&
          (clock.breached || clock.escalation_level >= 2),
      ).length,
      resolved: clocks.filter(
        (clock) => Boolean(clock.resolved_at && sameMonth(clock.resolved_at)),
      ).length,
    };
  });
}

function requestLabel(clock: SLAClockView): string {
  const metadata = clock.metadata ?? {};
  for (const key of ["request_number", "requestNumber", "reference"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return clock.legal_request_id.slice(0, 12);
}

function LevelBadge({ level, label }: { level: number; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2.5 py-1 text-xs font-bold",
        level >= 3
          ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
          : level === 2
            ? "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
            : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
      )}
    >
      {label}
    </span>
  );
}

function MetricCard({
  label,
  value,
  loading,
  tone,
  icon: Icon,
  onAction,
}: {
  label: string;
  value: string;
  loading: boolean;
  tone: string;
  icon: typeof Clock3;
  onAction: () => void;
}) {
  const tones: Record<string, string> = {
    amber: "kpi-theme-amber",
    orange: "kpi-theme-orange",
    red: "kpi-theme-red",
    teal: "kpi-theme-teal",
  };
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onAction}
      className={cn(
        "kpi-card-themed h-auto min-h-28 items-stretch justify-start p-5 text-start font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tones[tone],
      )}
    >
      <span className="kpi-icon-badge absolute end-4 top-4">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="pe-12 text-sm font-semibold text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-4 h-8 w-16 rounded" />
      ) : (
        <p className="mt-3 text-2xl font-bold tabular-nums text-[color:var(--kpi-accent-resolved)]">
          {value}
        </p>
      )}
    </Button>
  );
}
