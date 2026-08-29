"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock3, FileSearch, Star } from "lucide-react";

import { useLocale } from "@/components/providers/locale-provider";
import {
  StatusBadge,
  slaMap,
  type StatusToneMap,
} from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveLocalized } from "@/lib/i18n/localized";
import { useLexFormat } from "@/lib/lex/ksa";
import {
  lexReportsApi,
  type LexDetailedAnalyticsDrilldownDimension,
  type LexDetailedAnalyticsContributor,
  type LexReportQuery,
} from "@/lib/lex/reports";
import { useServiceTypeLabel } from "../../../service-desk/_components/lex-enums-i18n";
import {
  type DetailedAnalyticsLabels,
  useDetailedAnalyticsLabels,
} from "../_lib/detailed-analytics-labels";

const PER_PAGE = 20;

const requestStatusMap: StatusToneMap = {
  draft: { tone: "neutral", label: "Draft", labelAr: "مسودة" },
  submitted: { tone: "info", label: "Submitted", labelAr: "مُقدّم" },
  pending_requester_approval: {
    tone: "warning",
    label: "Requester approval",
    labelAr: "بانتظار موافقة مقدم الطلب",
  },
  pending_provider_approval: {
    tone: "warning",
    label: "Provider approval",
    labelAr: "بانتظار موافقة مقدم الخدمة",
  },
  approved: { tone: "primary", label: "Approved", labelAr: "معتمد" },
  routed: { tone: "info", label: "Routed", labelAr: "موجّه" },
  in_execution: { tone: "info", label: "In execution", labelAr: "قيد التنفيذ" },
  delivered: { tone: "success", label: "Delivered", labelAr: "تم التسليم" },
  closed: { tone: "success", label: "Closed", labelAr: "مغلق" },
  returned: { tone: "warning", label: "Returned", labelAr: "مُعاد" },
  cancelled: { tone: "neutral", label: "Cancelled", labelAr: "ملغى" },
};

const requestPriorityMap: StatusToneMap = {
  emergency: { tone: "critical", label: "Emergency", labelAr: "طارئ" },
  urgent: { tone: "danger", label: "Urgent", labelAr: "عاجل" },
  normal: { tone: "info", label: "Normal", labelAr: "عادي" },
};

export interface AnalyticsDrilldownSelection {
  dimension: LexDetailedAnalyticsDrilldownDimension;
  key?: string;
  keys?: string[];
  queryOverrides?: Partial<LexReportQuery>;
  title: string;
  description?: string;
}

export function AnalyticsDrilldownSheet({
  selection,
  query,
  open,
  onOpenChange,
}: {
  selection: AnalyticsDrilldownSelection | null;
  query: LexReportQuery;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { direction } = useLocale();
  const f = useLexFormat();
  const labels = useDetailedAnalyticsLabels();
  const serviceTypeLabel = useServiceTypeLabel();
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [selection]);

  const contributorsQuery = useQuery({
    queryKey: ["lex-detailed-analytics-contributors", query, selection, page],
    queryFn: () =>
      lexReportsApi.getDetailedAnalyticsContributors({
        ...query,
        ...selection!.queryOverrides,
        dimension: selection!.dimension,
        key: selection!.key,
        keys: selection!.keys,
        page,
        per_page: PER_PAGE,
      }),
    enabled: open && selection !== null,
  });

  const meta = contributorsQuery.data?.meta;
  const total = meta?.total ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={direction === "rtl" ? "left" : "right"}
        dir={direction}
        className="flex w-full flex-col overflow-hidden sm:max-w-2xl"
      >
        <SheetHeader className="text-start">
          <SheetTitle className="flex items-center gap-2 text-start">
            <FileSearch className="h-5 w-5 text-primary" aria-hidden />
            {selection?.title ?? labels.drilldown.contributors}
          </SheetTitle>
          <SheetDescription className="text-start">
            {contributorsQuery.isLoading
              ? labels.drilldown.loading
              : contributorsQuery.isError
                ? labels.drilldown.loadError
                : [
                    selection?.description,
                    labels.drilldown.recordCount(f.formatNumber(total)),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pe-1">
          {contributorsQuery.isLoading ? (
            <div
              className="space-y-3"
              role="status"
              aria-label={labels.drilldown.loading}
            >
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : contributorsQuery.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-center">
              <p className="text-sm text-destructive">
                {labels.drilldown.loadError}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void contributorsQuery.refetch()}
              >
                {labels.drilldown.retry}
              </Button>
            </div>
          ) : contributorsQuery.data?.data.length ? (
            <div className="space-y-3">
              {contributorsQuery.data.data.map((item, index) => (
                <ContributorCard
                  key={[
                    item.request_id,
                    item.processing_hours,
                    item.satisfaction_rating,
                    item.sla_outcome,
                    index,
                  ].join("-")}
                  item={item}
                  labels={labels}
                  serviceTypeLabel={serviceTypeLabel}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {labels.drilldown.empty}
            </p>
          )}
        </div>

        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || contributorsQuery.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {labels.drilldown.previous}
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {f.formatNumber(page)} / {f.formatNumber(meta.total_pages)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= meta.total_pages || contributorsQuery.isFetching}
              onClick={() =>
                setPage((current) => Math.min(meta.total_pages, current + 1))
              }
            >
              {labels.drilldown.next}
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ContributorCard({
  item,
  labels,
  serviceTypeLabel,
}: {
  item: LexDetailedAnalyticsContributor;
  labels: DetailedAnalyticsLabels;
  serviceTypeLabel: (value: string) => string;
}) {
  const { locale } = useLocale();
  const f = useLexFormat();
  const title =
    resolveLocalized(item.title, locale) ||
    item.request_number ||
    labels.drilldown.unspecified;

  return (
    <Link
      href={`/lex/service-desk/${item.request_id}`}
      className="group block rounded-xl border border-border/70 bg-card p-4 transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={labels.drilldown.viewContributors(title)}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {item.request_number}
            </span>
            <StatusBadge status={item.status} map={requestStatusMap} size="sm" />
            <StatusBadge
              status={item.priority}
              map={requestPriorityMap}
              size="sm"
            />
          </div>
          <p
            dir="auto"
            className="mt-2 line-clamp-2 font-semibold text-foreground"
          >
            {title}
          </p>
        </div>
        <ArrowUpRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary rtl:-scale-x-100"
          aria-hidden
        />
      </div>

      <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        <ContributorField
          label={labels.drilldown.requester}
          value={item.requester_name || labels.drilldown.unspecified}
        />
        <ContributorField
          label={labels.drilldown.created}
          value={f.formatDate(item.created_at, { dateStyle: "medium" })}
        />
        <ContributorField
          label={labels.drilldown.department}
          value={item.department || labels.drilldown.unspecified}
        />
        <ContributorField
          label={labels.drilldown.serviceType}
          value={serviceTypeLabel(item.request_type)}
        />
      </dl>

      {item.processing_hours != null ||
      item.satisfaction_rating != null ||
      item.sla_outcome ||
      item.advisor_name ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3 text-xs text-muted-foreground">
          {item.processing_hours != null ? (
            <Observation
              icon={Clock3}
              label={`${labels.drilldown.processingHours}: ${f.formatNumber(
                Number(item.processing_hours.toFixed(1)),
              )} ${labels.metrics.hours}`}
            />
          ) : null}
          {item.satisfaction_rating != null ? (
            <Observation
              icon={Star}
              label={`${labels.drilldown.satisfaction}: ${f.formatNumber(
                item.satisfaction_rating,
              )}/5`}
            />
          ) : null}
          {item.sla_outcome ? (
            <span>
              {labels.drilldown.slaOutcome}:{" "}
              <StatusBadge status={item.sla_outcome} map={slaMap} size="sm" />
            </span>
          ) : null}
          {item.advisor_name ? (
            <span>
              {labels.drilldown.advisor}: {item.advisor_name}
            </span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}

function ContributorField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd dir="auto" className="mt-0.5 truncate font-medium text-foreground">
        {value}
      </dd>
    </div>
  );
}

function Observation({
  icon: Icon,
  label,
}: {
  icon: typeof Clock3;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}
