"use client";

import Link from "next/link";
import {
  ChevronRight,
  Download,
  FileCheck2,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { SimpleTable, type Column } from "@/components/shared/simple-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useLexFormat } from "@/lib/lex/ksa";
import type {
  Investigation,
  InvestigationApprovalTask,
  InvestigationEvidence,
  InvestigationPriority,
} from "@/lib/lex/investigations";
import { cn } from "@/lib/utils";
import type {
  InvestigationReportDraft,
  InvestigationReportFinding,
  InvestigationReportRecommendation,
} from "./investigation-report-model";
import {
  type InvestigationReportLabels,
  useInvestigationReportLabels,
} from "./investigation-report-labels";

interface InvestigationReportWorkspaceProps {
  investigation: Investigation;
  draft: InvestigationReportDraft;
  approvalTasks: InvestigationApprovalTask[];
  canEdit: boolean;
  canSubmit: boolean;
  saving: boolean;
  submitting: boolean;
  onDraftChange: (draft: InvestigationReportDraft) => void;
  onSave: () => void;
  onExport: () => void;
  onSubmit: () => void;
}

const cardClass = "rounded-xl border border-border/80 bg-card shadow-none";
const fieldClass =
  "h-auto min-h-0 rounded-md border-transparent bg-transparent px-2 py-1 shadow-none hover:border-border focus-visible:border-input focus-visible:bg-background";
const areaClass =
  "min-h-0 resize-none overflow-hidden rounded-md border-transparent bg-transparent px-2 py-1.5 leading-6 shadow-none hover:border-border focus-visible:border-input focus-visible:bg-background";

export function InvestigationReportWorkspace({
  investigation,
  draft,
  approvalTasks,
  canEdit,
  canSubmit,
  saving,
  submitting,
  onDraftChange,
  onSave,
  onExport,
  onSubmit,
}: InvestigationReportWorkspaceProps) {
  const t = useInvestigationReportLabels();
  const f = useLexFormat();
  const basePath = `/lex/investigations/${investigation.id}`;

  const updateFinding = (
    findingId: string,
    patch: Partial<InvestigationReportFinding>,
  ) => {
    onDraftChange({
      ...draft,
      findings: draft.findings.map((finding) =>
        finding.id === findingId ? { ...finding, ...patch } : finding,
      ),
    });
  };

  const updateRecommendation = (
    recommendationId: string,
    patch: Partial<InvestigationReportRecommendation>,
  ) => {
    onDraftChange({
      ...draft,
      recommendations: draft.recommendations.map((recommendation) =>
        recommendation.id === recommendationId
          ? { ...recommendation, ...patch }
          : recommendation,
      ),
    });
  };

  return (
    <div
      className="investigation-report space-y-6 motion-safe:animate-fade-up"
      data-testid="investigation-report"
    >
      <header className="space-y-4 print:space-y-2">
        <nav
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground print:hidden"
          aria-label="Breadcrumb"
        >
          <Link href="/lex" className="transition-colors hover:text-foreground">
            {t.suite}
          </Link>
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          <Link
            href="/lex/investigations"
            className="transition-colors hover:text-foreground"
          >
            {t.investigations}
          </Link>
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          <Link
            href={basePath}
            className="transition-colors hover:text-foreground"
          >
            {investigation.investigation_number}
          </Link>
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          <span className="font-medium text-foreground">{t.caseReport}</span>
        </nav>

        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[28px] sm:leading-9">
                {t.title}
                <span className="ms-2 font-normal text-muted-foreground">
                  — {t.casePrefix} {investigation.investigation_number}
                </span>
              </h1>
              <Badge variant="warning" size="sm">
                {t.draft} v{draft.version.toFixed(1)}
              </Badge>
            </div>
            {!canEdit ? (
              <p className="mt-2 text-sm text-muted-foreground print:hidden">
                {t.readonly}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap print:hidden">
            {canEdit ? (
              <Button
                type="button"
                variant="outline"
                loading={saving}
                onClick={onSave}
              >
                <Save className="me-2 h-4 w-4" aria-hidden />
                {t.saveDraft}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onExport}>
              <Download className="me-2 h-4 w-4" aria-hidden />
              {t.exportPdf}
            </Button>
            {canSubmit ? (
              <Button type="button" loading={submitting} onClick={onSubmit}>
                <Send className="me-2 h-4 w-4" aria-hidden />
                {t.submitReview}
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,2.15fr)_minmax(320px,.95fr)]">
        <main className="min-w-0 space-y-6">
          <ReportCard title={t.executiveSummary}>
            <Textarea
              aria-label={t.executiveSummary}
              value={draft.executiveSummary}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  executiveSummary: event.target.value,
                })
              }
              placeholder={t.executiveSummaryPlaceholder}
              readOnly={!canEdit}
              rows={4}
              className={cn(areaClass, "text-[15px] text-muted-foreground")}
              dir="auto"
            />
          </ReportCard>

          <ReportCard
            title={t.keyFindings}
            action={
              canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onDraftChange({
                      ...draft,
                      findings: [
                        ...draft.findings,
                        {
                          id: `finding-${Date.now()}`,
                          title: "",
                          description: "",
                          severity: "medium",
                        },
                      ],
                    })
                  }
                >
                  <Plus className="me-1.5 h-4 w-4" aria-hidden />
                  {t.addFinding}
                </Button>
              ) : undefined
            }
          >
            <div className="space-y-3">
              {draft.findings.map((finding, index) => (
                <div
                  key={finding.id}
                  className="group flex items-start gap-3 rounded-lg border border-border/70 bg-muted/25 p-4"
                >
                  <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-action/10 text-sm font-bold text-action">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                      <Input
                        aria-label={`${t.finding} ${index + 1}`}
                        value={finding.title}
                        onChange={(event) =>
                          updateFinding(finding.id, {
                            title: event.target.value,
                          })
                        }
                        placeholder={t.findingTitlePlaceholder}
                        readOnly={!canEdit}
                        className={cn(
                          fieldClass,
                          "flex-1 text-base font-semibold",
                        )}
                        dir="auto"
                      />
                      <SeverityControl
                        value={finding.severity}
                        labels={t}
                        editable={canEdit}
                        onChange={(severity) =>
                          updateFinding(finding.id, { severity })
                        }
                      />
                    </div>
                    <Textarea
                      aria-label={`${t.finding} ${index + 1} ${t.relevance}`}
                      value={finding.description}
                      onChange={(event) =>
                        updateFinding(finding.id, {
                          description: event.target.value,
                        })
                      }
                      placeholder={t.findingDescriptionPlaceholder}
                      readOnly={!canEdit}
                      rows={2}
                      className={cn(
                        areaClass,
                        "mt-1 text-sm text-muted-foreground",
                      )}
                      dir="auto"
                    />
                  </div>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground opacity-100 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      aria-label={`${t.remove} ${t.finding} ${index + 1}`}
                      onClick={() =>
                        onDraftChange({
                          ...draft,
                          findings: draft.findings.filter(
                            (item) => item.id !== finding.id,
                          ),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </ReportCard>

          <ReportCard title={t.evidenceGrid} contentClassName="p-0">
            <EvidenceGrid
              evidence={investigation.evidence ?? []}
              labels={t}
              formatDate={f.formatDate}
            />
          </ReportCard>
        </main>

        <aside className="min-w-0 space-y-6">
          <ReportCard
            title={t.recommendations}
            action={
              canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onDraftChange({
                      ...draft,
                      recommendations: [
                        ...draft.recommendations,
                        {
                          id: `recommendation-${Date.now()}`,
                          title: "",
                          description: "",
                          owner: investigation.department ?? "",
                          timing: "",
                        },
                      ],
                    })
                  }
                >
                  <Plus className="me-1.5 h-4 w-4" aria-hidden />
                  {t.addRecommendation}
                </Button>
              ) : undefined
            }
          >
            <div className="space-y-3">
              {draft.recommendations.map((recommendation, index) => (
                <RecommendationRow
                  key={recommendation.id}
                  index={index}
                  recommendation={recommendation}
                  labels={t}
                  editable={canEdit}
                  onChange={(patch) =>
                    updateRecommendation(recommendation.id, patch)
                  }
                  onRemove={() =>
                    onDraftChange({
                      ...draft,
                      recommendations: draft.recommendations.filter(
                        (item) => item.id !== recommendation.id,
                      ),
                    })
                  }
                />
              ))}
            </div>
          </ReportCard>

          <ReportCard title={t.approval}>
            <ApprovalWorkflow
              investigation={investigation}
              approvalTasks={approvalTasks}
              labels={t}
            />
          </ReportCard>
        </aside>
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm;
          }
          body {
            background: white !important;
          }
          .investigation-report {
            color: #102d2a;
          }
          .investigation-report textarea,
          .investigation-report input {
            border: 0 !important;
            box-shadow: none !important;
          }
          .investigation-report textarea {
            resize: none;
          }
        }
      `}</style>
    </div>
  );
}

function ReportCard({
  title,
  action,
  contentClassName,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <div className="print:hidden">{action}</div>
      </div>
      <div className={cn("px-5 pb-5 sm:px-6 sm:pb-6", contentClassName)}>
        {children}
      </div>
    </section>
  );
}

function SeverityControl({
  value,
  labels,
  editable,
  onChange,
}: {
  value: InvestigationPriority;
  labels: InvestigationReportLabels;
  editable: boolean;
  onChange: (value: InvestigationPriority) => void;
}) {
  const values: InvestigationPriority[] = ["critical", "high", "medium", "low"];

  if (!editable) {
    return (
      <StatusBadge status={value} label={labels.severity[value]} size="sm" />
    );
  }

  return (
    <select
      aria-label={labels.severity[value]}
      value={value}
      onChange={(event) =>
        onChange(event.target.value as InvestigationPriority)
      }
      className={cn(
        "h-8 shrink-0 rounded-full border px-2 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-action",
        value === "critical" && "border-error-300 bg-error-50 text-error-700",
        value === "high" && "border-error-200 bg-error-50 text-error-700",
        value === "medium" &&
          "border-warning-300 bg-warning-50 text-warning-700",
        value === "low" && "border-info-300 bg-info-50 text-info-700",
      )}
    >
      {values.map((severity) => (
        <option key={severity} value={severity}>
          {labels.severity[severity]}
        </option>
      ))}
    </select>
  );
}

function RecommendationRow({
  recommendation,
  index,
  labels,
  editable,
  onChange,
  onRemove,
}: {
  recommendation: InvestigationReportRecommendation;
  index: number;
  labels: InvestigationReportLabels;
  editable: boolean;
  onChange: (patch: Partial<InvestigationReportRecommendation>) => void;
  onRemove: () => void;
}) {
  const tones = [
    "border-error-200 bg-error-50/70",
    "border-info-200 bg-info-50/70",
    "border-warning-200 bg-warning-50/70",
  ];
  const titleTones = ["text-error-700", "text-info-700", "text-warning-700"];

  return (
    <div
      className={cn(
        "group rounded-lg border p-3.5",
        tones[index % tones.length],
      )}
    >
      <div className="flex items-start gap-1">
        <Input
          aria-label={`${labels.recommendation} ${index + 1}`}
          value={recommendation.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder={labels.recommendationTitlePlaceholder}
          readOnly={!editable}
          className={cn(
            fieldClass,
            "flex-1 px-0 text-sm font-semibold",
            titleTones[index % titleTones.length],
          )}
          dir="auto"
        />
        {editable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 opacity-100 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            aria-label={`${labels.remove} ${labels.recommendation} ${index + 1}`}
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
      <Textarea
        aria-label={`${labels.recommendation} ${index + 1} ${labels.relevance}`}
        value={recommendation.description}
        onChange={(event) => onChange({ description: event.target.value })}
        placeholder={labels.recommendationDescriptionPlaceholder}
        readOnly={!editable}
        rows={2}
        className={cn(areaClass, "px-0 text-xs text-muted-foreground")}
        dir="auto"
      />
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          aria-label={`${labels.owner} ${index + 1}`}
          value={recommendation.owner}
          onChange={(event) => onChange({ owner: event.target.value })}
          placeholder={labels.ownerPlaceholder}
          readOnly={!editable}
          className={cn(fieldClass, "px-0 text-xs text-muted-foreground")}
          dir="auto"
        />
        <Input
          aria-label={`${labels.timing} ${index + 1}`}
          value={recommendation.timing}
          onChange={(event) => onChange({ timing: event.target.value })}
          placeholder={labels.timingPlaceholder}
          readOnly={!editable}
          className={cn(fieldClass, "px-0 text-xs font-medium")}
          dir="auto"
        />
      </div>
    </div>
  );
}

function EvidenceGrid({
  evidence,
  labels,
  formatDate,
}: {
  evidence: InvestigationEvidence[];
  labels: InvestigationReportLabels;
  formatDate: (value?: string | Date | null) => string;
}) {
  if (evidence.length === 0) {
    return (
      <div className="px-5 pb-6 text-sm text-muted-foreground sm:px-6">
        {labels.evidenceEmpty}
      </div>
    );
  }

  const rows = evidence.map((item, index) => ({ item, index }));
  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: "artifact",
      header: labels.artifactId,
      className: "whitespace-nowrap",
      render: ({ item, index }) => (
        <span className="font-semibold text-action">
          {evidenceId(item, index)}
        </span>
      ),
    },
    {
      key: "relevance",
      header: labels.relevance,
      render: ({ item }) => (
        <div dir="auto">
          <p className="font-medium text-foreground">{item.title}</p>
          {item.description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {item.description}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "verification",
      header: labels.verification,
      render: ({ item }) => (
        <div>
          <p className="font-semibold text-success-600">
            {evidenceVerification(item, labels)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDate(item.collected_at ?? item.created_at)}
          </p>
        </div>
      ),
    },
  ];

  return (
    <SimpleTable
      columns={columns}
      data={rows}
      getRowKey={({ item }) => item.id}
      ariaLabel={labels.evidenceGrid}
      className="rounded-none border-x-0 border-b-0 shadow-none [&_.table-premium]:min-w-[680px]"
    />
  );
}

function ApprovalWorkflow({
  investigation,
  approvalTasks,
  labels,
}: {
  investigation: Investigation;
  approvalTasks: InvestigationApprovalTask[];
  labels: InvestigationReportLabels;
}) {
  const rows: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
    tone: "success" | "danger" | "warning" | "neutral";
  }> = [
    {
      id: "prepared",
      name: investigation.lead_investigator,
      role: labels.leadInvestigator,
      status: labels.prepared,
      tone: "success" as const,
    },
    ...approvalTasks.map((task, index) => {
      const token = String(task.status ?? "pending").toLowerCase();
      const approved = token.includes("approv") || token.includes("complet");
      const rejected = token.includes("reject");
      const name = String(
        task.title ??
          task.name ??
          task.assignee_role ??
          `${labels.inReview} ${index + 1}`,
      );
      return {
        id: String(task.id ?? index),
        name,
        role: String(task.assignee_role ?? labels.inReview),
        status: approved
          ? labels.approved
          : rejected
            ? labels.rejected
            : token === "pending"
              ? labels.pending
              : labels.inReview,
        tone: approved
          ? ("success" as const)
          : rejected
            ? ("danger" as const)
            : ("warning" as const),
      };
    }),
  ];

  if (
    approvalTasks.length === 0 &&
    investigation.status !== "pending_approval"
  ) {
    const decided =
      investigation.status === "approved" ||
      investigation.status === "rejected";
    rows.push({
      id: "not-started",
      name: decided ? labels.approval : labels.reviewNotStarted,
      role: labels.approval,
      status:
        investigation.status === "approved"
          ? labels.approved
          : investigation.status === "rejected"
            ? labels.rejected
            : labels.pending,
      tone:
        investigation.status === "approved"
          ? "success"
          : investigation.status === "rejected"
            ? "danger"
            : "neutral",
    });
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/25 px-3.5 py-3"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-action/10 text-action">
            <FileCheck2 className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-semibold text-foreground"
              dir="auto"
            >
              {row.name}
            </p>
            <p className="truncate text-xs text-muted-foreground" dir="auto">
              {row.role}
            </p>
          </div>
          <StatusBadge
            status={row.status}
            tone={row.tone}
            label={row.status}
            size="sm"
          />
        </div>
      ))}
    </div>
  );
}

function evidenceId(evidence: InvestigationEvidence, index: number): string {
  const metadataId = evidence.metadata?.artifact_id;
  if (typeof metadataId === "string" && metadataId.trim()) return metadataId;
  return `EVID-${String(index + 1).padStart(2, "0")}`;
}

function evidenceVerification(
  evidence: InvestigationEvidence,
  labels: InvestigationReportLabels,
): string {
  const metadata = evidence.metadata ?? {};
  const explicit =
    metadata.verification_standard ?? metadata.verification_status;
  if (typeof explicit === "string" && explicit.trim()) return explicit;
  const hash = metadata.sha256 ?? metadata.hash;
  if (typeof hash === "string" && hash.trim()) {
    const trimmed = hash.trim();
    const compact =
      trimmed.length > 18
        ? `${trimmed.slice(0, 9)}…${trimmed.slice(-5)}`
        : trimmed;
    return `SHA-256 ${labels.verified} · ${compact}`;
  }
  return labels.catalogued;
}
