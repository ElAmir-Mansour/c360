"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Download,
  FileUp,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { LexRouteGuard } from "../../../../_guards/lex-route-guard";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleTable, type Column } from "@/components/shared/simple-table";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { useAuth } from "@/hooks/use-auth";
import { useLexFormat } from "@/lib/lex/ksa";
import {
  investigationsApi,
  type Investigation,
  type InvestigationEvidence,
  type UploadInvestigationEvidencePayload,
} from "@/lib/lex/investigations";
import { showApiError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { InvestigationEvidenceDialog } from "../../../_components/investigation-dialogs";

const cardClass = "rounded-xl border border-border/80 bg-card shadow-none";
type EvidenceScope = "all" | "digital" | "physical" | "verified" | "processing";

export function InvestigationEvidenceWorkspace() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const queryClient = useQueryClient();
  const { locale, direction } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  const f = useLexFormat();
  const isArabic = locale === "ar";
  const canWrite = hasPermission("lex:investigation:edit");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [evidenceScope, setEvidenceScope] = useState<EvidenceScope>("all");

  const query = useQuery({
    queryKey: ["lex-investigation", id],
    queryFn: () => investigationsApi.get(id),
    enabled: Boolean(id),
  });

  const refresh = async () => {
    await Promise.all([
      query.refetch(),
      queryClient.invalidateQueries({ queryKey: ["lex-investigation", id] }),
      queryClient.invalidateQueries({ queryKey: ["lex-investigations"] }),
    ]);
  };

  const uploadMutation = useMutation({
    mutationFn: (payload: UploadInvestigationEvidencePayload) =>
      investigationsApi.uploadEvidence(id, payload),
    onSuccess: async () => {
      showSuccess(isArabic ? "تم تسجيل الدليل" : "Evidence registered");
      setUploadOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (evidenceId: string) =>
      investigationsApi.deleteEvidence(id, evidenceId),
    onSuccess: async () => {
      showSuccess(isArabic ? "تم حذف الدليل" : "Evidence removed");
      await refresh();
    },
    onError: showApiError,
  });

  if (query.isLoading) {
    return (
      <LexRouteGuard route="/lex/investigations/[id]">
        <div className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Skeleton className="h-[560px] w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        </div>
      </LexRouteGuard>
    );
  }

  if (query.isError || !query.data) {
    return (
      <LexRouteGuard route="/lex/investigations/[id]">
        <PageHeader
          title={
            isArabic
              ? "جمع الأدلة والتحليل الفني"
              : "Evidence Collection & Analysis"
          }
          description={
            isArabic
              ? "تعذر تحميل ملف التحقيق."
              : "Unable to load the investigation."
          }
        />
        <ErrorState
          message={
            isArabic
              ? "تعذر تحميل ملف الأدلة"
              : "Unable to load the evidence workspace"
          }
          onRetry={() => void query.refetch()}
        />
      </LexRouteGuard>
    );
  }

  const investigation = query.data;
  const evidence = investigation.evidence ?? [];
  const digitalCount = evidence.filter((item) => !isPhysical(item)).length;
  const physicalCount = evidence.length - digitalCount;
  const verifiedCount = evidence.filter(
    (item) => evidenceStatus(item) === "verified",
  ).length;
  const processingCount = evidence.filter((item) =>
    ["processing", "pending", "acquisition", "analysis"].includes(
      evidenceStatus(item),
    ),
  ).length;
  const relationshipItems = evidence.slice(0, 3);
  type EvidenceRow = {
    item: InvestigationEvidence;
    index: number;
  } & Record<string, unknown>;
  const evidenceRows: EvidenceRow[] = evidence
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (evidenceScope === "digital") return !isPhysical(item);
      if (evidenceScope === "physical") return isPhysical(item);
      if (evidenceScope === "verified") return evidenceStatus(item) === "verified";
      if (evidenceScope === "processing") {
        return ["processing", "pending", "acquisition", "analysis"].includes(evidenceStatus(item));
      }
      return true;
    });
  const evidenceColumns: Column<EvidenceRow>[] = [
    {
      key: "reference",
      header: isArabic ? "معرف الدليل" : "Evidence ID",
      render: ({ item, index }) => (
        <span className="font-mono font-semibold text-primary">
          {evidenceReference(item, index)}
        </span>
      ),
    },
    {
      key: "description",
      header: isArabic ? "الوصف" : "Description",
      className: "max-w-72",
      render: ({ item }) => (
        <span className="line-clamp-2" dir="auto">
          {item.title}
        </span>
      ),
    },
    {
      key: "type",
      header: isArabic ? "النوع" : "Type",
      render: ({ item }) => (
        <span className="text-muted-foreground">{item.evidence_type}</span>
      ),
    },
    {
      key: "source",
      header: isArabic ? "المصدر" : "Source",
      className: "max-w-48",
      render: ({ item }) => (
        <span className="line-clamp-2 text-muted-foreground" dir="auto">
          {recordText(item.metadata, ["source", "host"]) || item.description}
        </span>
      ),
    },
    {
      key: "collected",
      header: isArabic ? "تاريخ الجمع" : "Collection Date",
      render: ({ item }) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {f.formatDate(item.collected_at || item.created_at)}
        </span>
      ),
    },
    {
      key: "status",
      header: isArabic ? "الحالة" : "Status",
      render: ({ item }) => (
        <Badge variant={evidenceStatusVariant(item)}>
          {evidenceStatus(item)}
        </Badge>
      ),
    },
    {
      key: "hash",
      header: isArabic ? "سلامة البصمة" : "Integrity (SHA-256)",
      render: ({ item }) => (
        <span className="font-mono text-xs">{evidenceHash(item)}</span>
      ),
    },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "",
            className: "w-14",
            render: ({ item }: EvidenceRow) => (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                aria-label={isArabic ? "حذف الدليل" : "Remove evidence"}
                loading={
                  deleteMutation.isPending &&
                  deleteMutation.variables === item.id
                }
                onClick={() => deleteMutation.mutate(item.id)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            ),
          } satisfies Column<EvidenceRow>,
        ]
      : []),
  ];

  const exportLog = () => {
    const rows = [
      [
        "Evidence ID",
        "Description",
        "Type",
        "Source",
        "Collected",
        "Status",
        "SHA-256",
      ],
      ...evidenceRows.map(({ item, index }) => [
        evidenceReference(item, index),
        item.title,
        item.evidence_type,
        recordText(item.metadata, ["source", "host"]) || item.description,
        item.collected_at || item.created_at,
        evidenceStatus(item),
        evidenceHash(item),
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `evidence-${investigation.investigation_number}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <LexRouteGuard route="/lex/investigations/[id]">
      <div
        className="space-y-6 motion-safe:animate-fade-up"
        dir={direction}
        lang={locale}
        data-testid="investigation-evidence"
      >
        <header className="space-y-4">
          <EvidenceBreadcrumb
            investigation={investigation}
            isArabic={isArabic}
          />
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">
                {isArabic
                  ? "جمع الأدلة والتحليل الفني"
                  : "Evidence Collection & Analysis"}
              </h1>
              <span className="text-xl text-muted-foreground">
                — {isArabic ? "القضية" : "Case"}{" "}
                {investigation.investigation_number}
              </span>
              <Badge
                variant={
                  investigation.priority === "critical"
                    ? "destructive"
                    : "warning"
                }
              >
                {investigation.priority}
              </Badge>
              <Badge variant="success">
                {investigation.status.replaceAll("_", " ")}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={exportLog}>
                <Download className="me-2 h-4 w-4" aria-hidden />
                {isArabic ? "تصدير السجل" : "Export Log"}
              </Button>
              {canWrite ? (
                <Button type="button" onClick={() => setUploadOpen(true)}>
                  <FileUp className="me-2 h-4 w-4" aria-hidden />
                  {isArabic ? "رفع دليل" : "Upload Evidence"}
                </Button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <main className="min-w-0 space-y-6">
            <section id="investigation-evidence-log" className={cn(cardClass, "scroll-mt-24 overflow-hidden")}>
              <div className="flex items-center justify-between px-6 py-5">
                <h2 className="text-lg font-bold">
                  {isArabic ? "سجل الأدلة الرقمية" : "Digital Evidence Log"}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {isArabic
                    ? `عرض ${evidenceRows.length} سجلات`
                    : `Showing ${evidenceRows.length} records`}
                </span>
              </div>
              <SimpleTable
                className="rounded-none border-x-0 border-b-0 shadow-none"
                ariaLabel={
                  isArabic ? "سجل الأدلة الرقمية" : "Digital evidence log"
                }
                columns={evidenceColumns}
                data={evidenceRows}
                getRowKey={({ item }) => item.id}
                emptyMessage={
                  isArabic
                    ? "لم يتم تسجيل أدلة بعد."
                    : "No evidence has been registered."
                }
              />
            </section>

            <section className={cn(cardClass, "p-6")}>
              <h2 className="text-lg font-bold">
                {isArabic ? "خريطة علاقات الأدلة" : "Evidence Relationship Map"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isArabic
                  ? "نموذج مرئي يوضح مصادر الأدلة والروابط المسجلة."
                  : "Visual model representing source dependencies in the registered evidence chain."}
              </p>
              {relationshipItems.length ? (
                <div className="mt-5 flex min-w-0 flex-col items-stretch gap-3 lg:flex-row lg:items-center">
                  {relationshipItems.map((item, index) => (
                    <div key={item.id} className="contents">
                      <div
                        className={cn(
                          cardClass,
                          "min-w-0 flex-1 border-primary/60 p-4",
                        )}
                      >
                        <p className="font-mono text-xs font-semibold text-primary">
                          {evidenceReference(item, index)}
                        </p>
                        <p
                          className="mt-2 truncate text-sm font-bold"
                          dir="auto"
                        >
                          {item.title}
                        </p>
                        <p
                          className="mt-1 truncate text-xs text-muted-foreground"
                          dir="auto"
                        >
                          {recordText(item.metadata, ["source", "host"]) ||
                            item.evidence_type}
                        </p>
                      </div>
                      {index < relationshipItems.length - 1 ? (
                        <div className="flex shrink-0 items-center justify-center text-xs text-muted-foreground">
                          <span className="hidden h-px w-8 border-t border-dashed border-primary lg:block" />
                          <span className="mx-2">
                            {isArabic
                              ? "ارتباط موثق"
                              : index === 0
                                ? "Logs match"
                                : "Linked"}
                          </span>
                          <span className="hidden h-px w-8 border-t border-dashed border-primary lg:block" />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {isArabic
                    ? "تظهر العلاقات بعد إضافة الأدلة."
                    : "Relationships appear after evidence is added."}
                </div>
              )}
            </section>
          </main>

          <aside className="space-y-6 xl:sticky xl:top-6">
            <EvidenceStatCard
              title={
                isArabic ? "إحصائيات الأحراز والأدلة" : "Evidence Statistics"
              }
              items={[
                { label: isArabic ? "إجمالي الأدلة" : "Total Artifacts", value: evidence.length, scope: "all" },
                { label: isArabic ? "أدلة فنية رقمية" : "Digital Evidence", value: digitalCount, scope: "digital" },
                { label: isArabic ? "أدلة مادية" : "Physical Evidence", value: physicalCount, scope: "physical" },
                { label: isArabic ? "سلامة موثقة" : "Verified Integrity", value: verifiedCount, scope: "verified" },
                { label: isArabic ? "قيد المعالجة" : "Active Processing", value: processingCount, scope: "processing" },
              ]}
              activeScope={evidenceScope}
              onAction={(scope) => {
                setEvidenceScope(scope);
                document.getElementById("investigation-evidence-log")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />

            <section className={cn(cardClass, "p-6")}>
              <h2 className="text-lg font-bold">
                {isArabic ? "سلسلة عهدة الأحراز" : "Chain of Custody"}
              </h2>
              <div className="mt-4 space-y-3">
                <div className="rounded-lg bg-muted/40 p-4">
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                    {isArabic ? "الحارس القضائي الحالي" : "Current Custodian"}
                  </p>
                  <p className="mt-1 font-semibold" dir="auto">
                    {latestCustodian(evidence) ||
                      investigation.lead_investigator}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isArabic
                      ? "قسم الشؤون القانونية والتحقيقات"
                      : "Legal & Forensics Department"}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/40 p-4">
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                    {isArabic ? "تصنيف السرية" : "Security Classification"}
                  </p>
                  <p className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-primary">
                    <ShieldCheck className="h-4 w-4" aria-hidden />
                    {recordText(investigation.metadata, [
                      "classification",
                      "confidentiality",
                    ]) || (isArabic ? "وصول مقيد" : "Restricted Access")}
                  </p>
                </div>
              </div>
            </section>

            <section className={cn(cardClass, "p-6")}>
              <h2 className="text-lg font-bold">
                {isArabic ? "حالة المختبر الجنائي" : "Forensic Lab Status"}
              </h2>
              <div className="mt-4 space-y-3">
                {evidence
                  .filter((item) => evidenceStatus(item) !== "verified")
                  .slice(0, 3)
                  .map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border bg-muted/20 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p
                          className="line-clamp-2 text-sm font-semibold"
                          dir="auto"
                        >
                          {item.title}
                        </p>
                        <Badge variant={evidenceStatusVariant(item)}>
                          {evidenceStatus(item)}
                        </Badge>
                      </div>
                      <p
                        className="mt-2 text-xs leading-5 text-muted-foreground"
                        dir="auto"
                      >
                        {recordText(item.metadata, [
                          "processing_note",
                          "lab_note",
                        ]) || item.description}
                      </p>
                    </div>
                  ))}
                {!evidence.some(
                  (item) => evidenceStatus(item) !== "verified",
                ) ? (
                  <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
                    {isArabic
                      ? "لا توجد أحراز قيد المعالجة."
                      : "No evidence is currently processing."}
                  </p>
                ) : null}
              </div>
            </section>
          </aside>
        </div>

        {canWrite ? (
          <InvestigationEvidenceDialog
            investigationId={id}
            open={uploadOpen}
            loading={uploadMutation.isPending}
            onOpenChange={setUploadOpen}
            onSubmit={(payload) => uploadMutation.mutate(payload)}
          />
        ) : null}
      </div>
    </LexRouteGuard>
  );
}

function EvidenceBreadcrumb({
  investigation,
  isArabic,
}: {
  investigation: Investigation;
  isArabic: boolean;
}) {
  return (
    <nav
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      aria-label="Breadcrumb"
    >
      <Link href="/lex">{isArabic ? "وثيق تيك" : "WatheeqTech"}</Link>
      <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      <Link href="/lex/investigations">
        {isArabic ? "القضايا والتحقيقات" : "Cases & Investigations"}
      </Link>
      <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      <Link
        href={`/lex/investigations/${investigation.id}`}
        className="font-mono"
      >
        {investigation.investigation_number}
      </Link>
      <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      <span className="font-semibold text-foreground">
        {isArabic ? "جمع الأدلة" : "Evidence Collection"}
      </span>
    </nav>
  );
}

function EvidenceStatCard({
  title,
  items,
  activeScope,
  onAction,
}: {
  title: string;
  items: Array<{ label: string; value: number; scope: EvidenceScope }>;
  activeScope: EvidenceScope;
  onAction: (scope: EvidenceScope) => void;
}) {
  return (
    <section className={cn(cardClass, "p-6")}>
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-4 divide-y">
        {items.map(({ label, value, scope }, index) => (
          <Button
            type="button"
            variant="ghost"
            key={scope}
            onClick={() => onAction(scope)}
            aria-pressed={activeScope === scope}
            className="h-auto w-full items-center justify-between gap-4 rounded px-1 py-3 text-start font-normal transition first:pt-0 last:pb-0 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className={cn("font-bold", index >= 3 && "text-action")}>
              {value}
            </span>
          </Button>
        ))}
      </div>
    </section>
  );
}

function recordText(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[],
): string {
  if (!metadata) return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function evidenceReference(item: InvestigationEvidence, index: number): string {
  return (
    recordText(item.metadata, ["evidence_number", "reference"]) ||
    `EVID-${String(index + 1).padStart(3, "0")}`
  );
}

function evidenceHash(item: InvestigationEvidence): string {
  const value =
    recordText(item.metadata, ["sha256", "hash", "checksum"]) ||
    item.file_id ||
    item.id;
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function evidenceStatus(item: InvestigationEvidence): string {
  return (
    recordText(item.metadata, ["status", "lab_status", "processing_status"]) ||
    "pending"
  ).toLowerCase();
}

function evidenceStatusVariant(
  item: InvestigationEvidence,
): "success" | "warning" | "info" | "neutral" {
  const status = evidenceStatus(item);
  if (status === "verified" || status === "preserved") return "success";
  if (status === "processing" || status === "analysis") return "warning";
  if (status === "pending" || status === "acquisition") return "info";
  return "neutral";
}

function isPhysical(item: InvestigationEvidence): boolean {
  return /(physical|document|paper|مادي|ورقي)/i.test(item.evidence_type);
}

function latestCustodian(evidence: InvestigationEvidence[]): string {
  return [...evidence].sort(
    (a, b) =>
      new Date(b.collected_at || b.created_at).getTime() -
      new Date(a.collected_at || a.created_at).getTime(),
  )[0]?.collected_by;
}
