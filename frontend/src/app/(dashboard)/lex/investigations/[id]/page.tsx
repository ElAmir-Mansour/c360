"use client";

import { type ReactNode, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ClipboardCheck,
  FileText,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { LexRouteGuard } from "../../_guards/lex-route-guard";
import { SectionCard } from "@/components/suites/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { AskForSupportButton } from "@/components/lex/support-composer";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { useLexFormat } from "@/lib/lex/ksa";
import { cn } from "@/lib/utils";
import { showApiError, showSuccess } from "@/lib/toast";
import {
  type AddInvestigationPartyPayload,
  type Investigation,
  type InvestigationApprovalTask,
  type InvestigationEvidence,
  type InvestigationParty,
  type InvestigationStatement,
  type InvestigationStatus,
  type RecordInvestigationRecommendationsPayload,
  type RecordInvestigationResultsPayload,
  type RecordInvestigationStatementPayload,
  type StartInvestigationApprovalPayload,
  type UploadInvestigationEvidencePayload,
  investigationsApi,
} from "@/lib/lex/investigations";
import {
  cancelAction,
  nextAction,
  type InvestigationCancelAction,
  type InvestigationLifecycleAction,
  type InvestigationLifecycleActionKind,
  type InvestigationLifecycleBlockReason,
} from "@/lib/lex/investigation-lifecycle";
import { useInvestigationLabels } from "../_components/labels";
import { InvestigationFormDialog } from "../_components/investigation-form-dialog";
import { InvestigationTimeline } from "../_components/investigation-timeline";
import { InvestigationApprovalOperationsPanel } from "../_components/investigation-approval-operations-panel";
import {
  InvestigationApprovalDialog,
  InvestigationEvidenceDialog,
  InvestigationPartyDialog,
  InvestigationRecommendationsDialog,
  InvestigationResultsDialog,
  InvestigationStatementDialog,
  InvestigationStatusDialog,
} from "../_components/investigation-dialogs";
import { InvestigationDetailSurface } from "./_components/investigation-detail-surface";
import { InvestigationLifecycleStepper } from "./_components/investigation-lifecycle-stepper";
import {
  useInvestigationLifecycleLabels,
  type InvestigationLifecycleLabels,
} from "./_components/investigation-lifecycle-stepper-labels";

export default function LexInvestigationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user, hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const id = params?.id ?? "";
  const canWrite = hasPermission("lex:investigation:edit");
  const canApprove = hasPermission("lex:investigation:approve");
  const canClose = hasPermission("lex:investigation:close");
  // Support requests are raised from the record, not just the inbox/top bar.
  // Same verb the inbox uses for its own "Ask for support" entry point.
  const canAskSupport = hasPermission("lex:support:create");
  const L = useInvestigationLabels();
  const lifecycleLabels = useInvestigationLifecycleLabels();
  const labels = L.detail;
  const operationsRef = useRef<HTMLDetailsElement>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusOptions, setStatusOptions] = useState<InvestigationStatus[]>([]);
  const [partyOpen, setPartyOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [recommendationsOpen, setRecommendationsOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editParty, setEditParty] = useState<InvestigationParty | null>(null);
  const [removeParty, setRemoveParty] = useState<InvestigationParty | null>(
    null,
  );
  const [removeStatement, setRemoveStatement] =
    useState<InvestigationStatement | null>(null);
  const [removeEvidence, setRemoveEvidence] =
    useState<InvestigationEvidence | null>(null);

  const q = useQuery({
    queryKey: ["lex-investigation", id],
    queryFn: () => investigationsApi.get(id),
    enabled: Boolean(id),
  });

  const approvalQuery = useQuery({
    queryKey: ["lex-investigation-approval", id],
    queryFn: () => investigationsApi.listApprovalTasks(id),
    enabled: Boolean(id) && q.data?.status === "pending_approval",
  });

  const auditQuery = useQuery({
    queryKey: ["lex-investigation-audit", id],
    queryFn: () => investigationsApi.listAudit(id),
    enabled: Boolean(id),
  });

  const refresh = async () => {
    await Promise.all([
      q.refetch(),
      qc.invalidateQueries({ queryKey: ["lex-investigations"] }),
      qc.invalidateQueries({ queryKey: ["lex-investigation-approval", id] }),
      qc.invalidateQueries({ queryKey: ["lex-investigation-audit", id] }),
    ]);
  };

  const statusMutation = useMutation({
    mutationFn: ({ status, lateJustification }: { status: InvestigationStatus; lateJustification?: string }) =>
      investigationsApi.updateStatus(id, {
        status,
        ...(lateJustification ? { late_justification: lateJustification } : {}),
      }),
    onSuccess: async () => {
      showSuccess(L.toast.statusUpdated);
      setStatusOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const partyMutation = useMutation({
    mutationFn: (payload: AddInvestigationPartyPayload) =>
      investigationsApi.addParty(id, payload),
    onSuccess: async () => {
      showSuccess(L.toast.partyAdded);
      setPartyOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const updatePartyMutation = useMutation({
    mutationFn: ({
      partyId,
      payload,
    }: {
      partyId: string;
      payload: AddInvestigationPartyPayload;
    }) => investigationsApi.updateParty(id, partyId, payload),
    onSuccess: async () => {
      showSuccess(L.toast.updated);
      setEditParty(null);
      await refresh();
    },
    onError: showApiError,
  });

  const deletePartyMutation = useMutation({
    mutationFn: (partyId: string) => investigationsApi.deleteParty(id, partyId),
    onSuccess: async () => {
      showSuccess(L.toast.partyRemoved);
      setRemoveParty(null);
      await refresh();
    },
    onError: showApiError,
  });

  const statementMutation = useMutation({
    mutationFn: (payload: RecordInvestigationStatementPayload) =>
      investigationsApi.recordStatement(id, payload),
    onSuccess: async () => {
      showSuccess(L.toast.statementRecorded);
      setStatementOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const deleteStatementMutation = useMutation({
    mutationFn: (statementId: string) =>
      investigationsApi.deleteStatement(id, statementId),
    onSuccess: async () => {
      showSuccess(L.toast.statementRemoved);
      setRemoveStatement(null);
      await refresh();
    },
    onError: showApiError,
  });

  const evidenceMutation = useMutation({
    mutationFn: (payload: UploadInvestigationEvidencePayload) =>
      investigationsApi.uploadEvidence(id, payload),
    onSuccess: async () => {
      showSuccess(L.toast.evidenceUploaded);
      setEvidenceOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const deleteEvidenceMutation = useMutation({
    mutationFn: (evidenceId: string) =>
      investigationsApi.deleteEvidence(id, evidenceId),
    onSuccess: async () => {
      showSuccess(L.toast.evidenceRemoved);
      setRemoveEvidence(null);
      await refresh();
    },
    onError: showApiError,
  });

  const resultsMutation = useMutation({
    mutationFn: (payload: RecordInvestigationResultsPayload) =>
      investigationsApi.recordResults(id, payload),
    onSuccess: async () => {
      showSuccess(L.toast.resultsRecorded);
      setResultsOpen(false);
      await refresh();
      if (!q.data?.recommendations?.trim()) setRecommendationsOpen(true);
    },
    onError: showApiError,
  });

  const recommendationsMutation = useMutation({
    mutationFn: (payload: RecordInvestigationRecommendationsPayload) =>
      investigationsApi.recordRecommendations(id, payload),
    onSuccess: async () => {
      showSuccess(L.toast.recommendationsRecorded);
      setRecommendationsOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const approvalMutation = useMutation({
    mutationFn: (payload: StartInvestigationApprovalPayload) =>
      investigationsApi.startApproval(id, payload),
    onSuccess: async () => {
      showSuccess(L.toast.approvalStarted);
      setApprovalOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const decideMutation = useMutation({
    mutationFn: ({
      task,
      decision,
      notes,
      lateJustification,
    }: {
      task: InvestigationApprovalTask;
      decision: "approve" | "reject";
      notes?: string;
      lateJustification?: string;
    }) =>
      investigationsApi.decideApproval(
        id,
        String(task.workflow_instance_id ?? q.data?.workflow_instance_id ?? ""),
        String(task.id),
        {
          decision,
          notes: notes ?? null,
          ...(lateJustification
            ? { late_justification: lateJustification }
            : {}),
        },
      ),
    onSuccess: async () => {
      showSuccess(L.toast.approvalDecided);
      await refresh();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: () => investigationsApi.remove(id),
    onSuccess: async () => {
      showSuccess(L.toast.deleted);
      await qc.invalidateQueries({ queryKey: ["lex-investigations"] });
      router.push("/lex/investigations");
    },
    onError: showApiError,
  });

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const title = q.data
      ? `${q.data.investigation_number} — ${q.data.subject}`
      : labels.loadingTitle;

    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        showSuccess(
          locale === "ar" ? "تم نسخ رابط التحقيق" : "Investigation link copied",
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      showApiError(error);
    }
  };

  const openFullTimeline = () => {
    if (operationsRef.current) operationsRef.current.open = true;
    window.requestAnimationFrame(() => {
      document
        .getElementById("investigation-timeline")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const openOperationsAt = (elementId: string) => {
    if (operationsRef.current) operationsRef.current.open = true;
    window.requestAnimationFrame(() => {
      document.getElementById(elementId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  if (q.isLoading) {
    return (
      <LexRouteGuard route="/lex/investigations/[id]">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            title={labels.loadingTitle}
            description={labels.loadingDescription}
          />
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton.Card key={index} />
            ))}
          </div>
        </div>
      </LexRouteGuard>
    );
  }

  if (q.isError || !q.data) {
    return (
      <LexRouteGuard route="/lex/investigations/[id]">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            title={labels.loadingTitle}
            description={labels.fallbackDescription}
          />
          <ErrorState
            message={labels.errorMessage}
            onRetry={() => void q.refetch()}
          />
        </div>
      </LexRouteGuard>
    );
  }

  const investigation: Investigation = q.data;
  const statements = investigation.statements ?? [];
  const approvalTasks = approvalQuery.data ?? [];
  const audit = auditQuery.data ?? [];
  const canStartApproval =
    investigation.status === "results_recorded" &&
    Boolean(investigation.findings?.trim()) &&
    Boolean(investigation.recommendations?.trim());
  const violatesFourEyes =
    Boolean(user?.id) && user?.id === investigation.created_by;
  const canDecide = canApprove && !violatesFourEyes;
  const canModifyContent =
    canWrite &&
    ["registered", "in_progress", "results_recorded"].includes(
      investigation.status,
    );
  const canDelete = canClose;
  const lifecycleContext = {
    status: investigation.status,
    createdBy: investigation.created_by,
    currentUserId: user?.id,
    permissions: { canEdit: canWrite, canApprove, canClose },
    readiness: {
      hasFindings: Boolean(investigation.findings?.trim()),
      hasRecommendations: Boolean(investigation.recommendations?.trim()),
      approvalTasksLoading: approvalQuery.isLoading,
      hasActionableApprovalTask: approvalTasks.some(isActionableApprovalTask),
    },
  } as const;
  const primaryAction = nextAction(lifecycleContext);
  const secondaryCancelAction = cancelAction(lifecycleContext);
  const primaryPending =
    statusMutation.isPending ||
    resultsMutation.isPending ||
    approvalMutation.isPending ||
    decideMutation.isPending;
  const performPrimaryAction = () => {
    if (!primaryAction.enabled || primaryPending) return;
    switch (primaryAction.kind) {
      case "start_investigation":
      case "reopen_for_rework":
        if (primaryAction.targetStatus) {
          statusMutation.mutate({ status: primaryAction.targetStatus });
        }
        return;
      case "close_investigation":
        setStatusOptions(["closed"]);
        setStatusOpen(true);
        return;
      case "record_findings":
        setResultsOpen(true);
        return;
      case "send_for_approval":
        setApprovalOpen(true);
        return;
      case "decide_approval":
        openOperationsAt("investigation-approval-tasks");
        return;
      case "terminal":
        return;
    }
  };
  const openCancelDialog = () => {
    if (!secondaryCancelAction?.enabled) return;
    setStatusOptions(["cancelled"]);
    setStatusOpen(true);
  };
  const partyDialogOpen = partyOpen || Boolean(editParty);

  return (
    <LexRouteGuard route="/lex/investigations/[id]">
      <div
        className="space-y-6 motion-safe:animate-fade-up"
        dir={direction}
        lang={locale}
      >
        <InvestigationDetailSurface
          investigation={investigation}
          auditEntries={audit}
          labels={L}
          canWrite={canModifyContent}
          headerActions={
            /*
              Context is passed EXPLICITLY rather than derived from the URL so
              the nested evidence / interviews / report routes bind to this
              investigation too.
            */
            canAskSupport ? (
              <AskForSupportButton
                context={{ subjectType: "investigation", subjectId: investigation.id }}
              />
            ) : null
          }
          lifecycle={
            <InvestigationLifecycleStepper
              status={investigation.status}
              auditEntries={audit}
              actionSlot={
                primaryAction.kind !== "terminal" ? (
                  <LifecycleActions
                    action={primaryAction}
                    cancel={secondaryCancelAction}
                    labels={lifecycleLabels}
                    pending={primaryPending}
                    onPrimary={performPrimaryAction}
                    onCancel={openCancelDialog}
                    onRecordRecommendations={() => setRecommendationsOpen(true)}
                  />
                ) : undefined
              }
            />
          }
          onEdit={() => setEditOpen(true)}
          onShare={() => void handleShare()}
          onAddParty={() => setPartyOpen(true)}
          onEditParty={setEditParty}
          onRemoveParty={setRemoveParty}
          onAddEvidence={() =>
            router.push(`/lex/investigations/${id}/evidence`)
          }
          onRemoveEvidence={setRemoveEvidence}
          onRecordStatement={() =>
            router.push(`/lex/investigations/${id}/interviews`)
          }
          onGenerateReport={() =>
            router.push(`/lex/investigations/${id}/report`)
          }
          onOpenTimeline={openFullTimeline}
        />

        {investigation.late_justification ? (
          <SectionCard
            title={
              locale === "ar"
                ? "مبرر تجاوز اتفاقية مستوى الخدمة"
                : "SLA delay justification"
            }
            description={
              locale === "ar"
                ? "معلومة خاصة للمدير القانوني ومدير القضايا القانونية."
                : "Private to the Legal Director and Legal Cases Manager."
            }
          >
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {investigation.late_justification}
            </p>
          </SectionCard>
        ) : null}

        <details
          ref={operationsRef}
          className="group rounded-xl border border-border/80 bg-card shadow-none"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-foreground marker:hidden sm:px-6 [&::-webkit-details-marker]:hidden">
            <span>
              {labels.statementsTitle} · {labels.resultsTitle} ·{" "}
              {labels.recommendationsTitle} · {labels.approvalTitle}
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>

          <div className="space-y-6 border-t border-border/70 p-5 sm:p-6">
            <SectionCard
              title={labels.statementsTitle}
              description={labels.statementsDescription}
              actions={
                canModifyContent ? (
                  <Button size="sm" onClick={() => setStatementOpen(true)}>
                    {labels.recordStatement}
                  </Button>
                ) : undefined
              }
            >
              {statements.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  title={labels.statementsEmptyTitle}
                  description={labels.statementsEmptyDescription}
                />
              ) : (
                <div className="space-y-3">
                  {statements.map((statement) => (
                    <AccentRow
                      key={statement.id}
                      accent="bg-warning-300/70"
                      align="start"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{statement.deponent_name}</p>
                        <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                          {statement.statement}
                        </p>
                        <p
                          className="mt-1 text-xs text-muted-foreground"
                          dir="auto"
                        >
                          {labels.takenBy(statement.taken_by)} •{" "}
                          {f.formatDate(statement.taken_at)}
                        </p>
                      </div>
                      {canModifyContent ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRemoveStatement(statement)}
                        >
                          {labels.delete}
                        </Button>
                      ) : null}
                    </AccentRow>
                  ))}
                </div>
              )}
            </SectionCard>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <SectionCard
                title={labels.resultsTitle}
                description={labels.resultsDescription}
                actions={
                  canWrite && investigation.status === "in_progress" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setResultsOpen(true)}
                    >
                      <FileText className="me-1.5 h-3.5 w-3.5" aria-hidden />
                      {labels.recordResults}
                    </Button>
                  ) : undefined
                }
              >
                {investigation.ai_drafted && investigation.findings ? (
                  <Badge variant="outline" className="mb-2">
                    {labels.aiBadge}
                  </Badge>
                ) : null}
                <p className="whitespace-pre-line text-sm text-muted-foreground">
                  {investigation.findings || labels.findingsEmpty}
                </p>
              </SectionCard>

              <SectionCard
                title={labels.recommendationsTitle}
                description={labels.recommendationsDescription}
                actions={
                  canWrite && investigation.status === "results_recorded" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRecommendationsOpen(true)}
                    >
                      <FileText className="me-1.5 h-3.5 w-3.5" aria-hidden />
                      {labels.recordRecommendations}
                    </Button>
                  ) : undefined
                }
              >
                <p className="whitespace-pre-line text-sm text-muted-foreground">
                  {investigation.recommendations || labels.recommendationsEmpty}
                </p>
              </SectionCard>
            </div>

            <InvestigationApprovalOperationsPanel
              investigation={investigation}
              approvalTasks={approvalTasks}
              auditEntries={audit}
              loading={approvalQuery.isLoading}
              error={approvalQuery.isError}
              canApprove={canDecide}
              canStartApproval={canStartApproval}
              decisionPending={decideMutation.isPending}
              onRetry={() => void approvalQuery.refetch()}
              onDecide={(task, decision, notes, lateJustification) =>
                decideMutation.mutate({ task, decision, notes, lateJustification })
              }
            />

            <InvestigationTimeline
              investigation={investigation}
              auditEntries={audit}
              approvalTasks={approvalTasks}
              auditLoading={auditQuery.isLoading}
              approvalLoading={approvalQuery.isLoading}
              auditError={auditQuery.isError}
              approvalError={approvalQuery.isError}
              onRetryAudit={() => void auditQuery.refetch()}
              onRetryApproval={() => void approvalQuery.refetch()}
            />

            {canDelete ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="me-1.5 h-4 w-4" aria-hidden />
                  {labels.delete}
                </Button>
              </div>
            ) : null}
          </div>
        </details>

        {canWrite || canDelete ? (
          <>
            <InvestigationFormDialog
              open={editOpen}
              investigation={investigation}
              onOpenChange={setEditOpen}
              onSaved={() => void refresh()}
            />
            <InvestigationStatusDialog
              open={statusOpen}
              options={statusOptions}
              slaDeadline={investigation.sla_deadline}
              loading={statusMutation.isPending}
              onOpenChange={setStatusOpen}
              onSubmit={(status, lateJustification) =>
                statusMutation.mutate({ status, lateJustification })
              }
            />
            <InvestigationPartyDialog
              open={partyDialogOpen}
              party={editParty}
              loading={partyMutation.isPending || updatePartyMutation.isPending}
              onOpenChange={(open) => {
                if (!open) {
                  setPartyOpen(false);
                  setEditParty(null);
                } else {
                  setPartyOpen(true);
                }
              }}
              onSubmit={(payload) => {
                if (editParty) {
                  updatePartyMutation.mutate({
                    partyId: editParty.id,
                    payload,
                  });
                  return;
                }
                partyMutation.mutate(payload);
              }}
            />
            <InvestigationStatementDialog
              open={statementOpen}
              loading={statementMutation.isPending}
              onOpenChange={setStatementOpen}
              onSubmit={(payload) => statementMutation.mutate(payload)}
            />
            <InvestigationEvidenceDialog
              investigationId={id}
              open={evidenceOpen}
              loading={evidenceMutation.isPending}
              onOpenChange={setEvidenceOpen}
              onSubmit={(payload) => evidenceMutation.mutate(payload)}
            />
            <InvestigationResultsDialog
              open={resultsOpen}
              initialFindings={investigation.findings}
              loading={resultsMutation.isPending}
              onOpenChange={setResultsOpen}
              onSubmit={(payload) => resultsMutation.mutate(payload)}
            />
            <InvestigationRecommendationsDialog
              open={recommendationsOpen}
              initialValue={investigation.recommendations}
              loading={recommendationsMutation.isPending}
              onOpenChange={setRecommendationsOpen}
              onSubmit={(payload) => recommendationsMutation.mutate(payload)}
            />
            <InvestigationApprovalDialog
              open={approvalOpen}
              loading={approvalMutation.isPending}
              onOpenChange={setApprovalOpen}
              onSubmit={(payload) => approvalMutation.mutate(payload)}
            />
            <ConfirmDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              title={L.confirm.deleteTitle}
              description={L.confirm.deleteDescription(investigation.subject)}
              confirmLabel={labels.delete}
              variant="destructive"
              loading={deleteMutation.isPending}
              onConfirm={async () => {
                await deleteMutation.mutateAsync();
              }}
            />
            <ConfirmDialog
              open={Boolean(removeParty)}
              onOpenChange={(open) => {
                if (!open) setRemoveParty(null);
              }}
              title={L.confirm.removePartyTitle}
              description={L.confirm.removePartyDescription(
                removeParty?.name ?? "",
              )}
              confirmLabel={L.confirm.confirm}
              variant="destructive"
              loading={deletePartyMutation.isPending}
              onConfirm={() => {
                if (removeParty) deletePartyMutation.mutate(removeParty.id);
              }}
            />
            <ConfirmDialog
              open={Boolean(removeStatement)}
              onOpenChange={(open) => {
                if (!open) setRemoveStatement(null);
              }}
              title={L.confirm.removeStatementTitle}
              description={L.confirm.removeStatementDescription(
                removeStatement?.deponent_name ?? "",
              )}
              confirmLabel={L.confirm.confirm}
              variant="destructive"
              loading={deleteStatementMutation.isPending}
              onConfirm={() => {
                if (removeStatement)
                  deleteStatementMutation.mutate(removeStatement.id);
              }}
            />
            <ConfirmDialog
              open={Boolean(removeEvidence)}
              onOpenChange={(open) => {
                if (!open) setRemoveEvidence(null);
              }}
              title={L.confirm.removeEvidenceTitle}
              description={L.confirm.removeEvidenceDescription(
                removeEvidence?.title ?? "",
              )}
              confirmLabel={L.confirm.confirm}
              variant="destructive"
              loading={deleteEvidenceMutation.isPending}
              onConfirm={() => {
                if (removeEvidence)
                  deleteEvidenceMutation.mutate(removeEvidence.id);
              }}
            />
          </>
        ) : null}
      </div>
    </LexRouteGuard>
  );
}

function AccentRow({
  accent,
  children,
  align = "center",
}: {
  accent: string;
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border/70 bg-muted/20 px-4 py-3",
        "flex flex-col gap-3 sm:flex-row sm:justify-between",
        align === "center" ? "sm:items-center" : "sm:items-start",
      )}
    >
      <span
        className={cn("absolute inset-y-0 start-0 w-1", accent)}
        aria-hidden
      />
      {children}
    </div>
  );
}

function LifecycleActions({
  action,
  cancel,
  labels,
  pending,
  onPrimary,
  onCancel,
  onRecordRecommendations,
}: {
  action: InvestigationLifecycleAction;
  cancel: InvestigationCancelAction | null;
  labels: InvestigationLifecycleLabels;
  pending: boolean;
  onPrimary: () => void;
  onCancel: () => void;
  onRecordRecommendations: () => void;
}) {
  if (action.kind === "terminal") return null;
  const blockedText = action.blockedReason
    ? lifecycleBlockedReason(labels, action.blockedReason)
    : null;
  const helper =
    blockedText ?? labels.helpers[action.kind as Exclude<InvestigationLifecycleActionKind, "terminal">];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {labels.nextStep}
        </p>
        <Button
          type="button"
          className="mt-2"
          disabled={!action.enabled || pending}
          onClick={onPrimary}
          aria-describedby="investigation-next-step-helper"
        >
          {pending ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <LifecycleActionIcon kind={action.kind} />
          )}
          {labels.actions[action.kind]}
        </Button>
        <p
          id="investigation-next-step-helper"
          className={cn(
            "mt-2 max-w-2xl text-sm",
            blockedText ? "text-warning-700 dark:text-warning-300" : "text-muted-foreground",
          )}
          role={blockedText ? "status" : undefined}
        >
          {helper}
        </p>
        {action.blockedReason === "recommendations_required" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            data-testid="record-recommendations-remediation"
            onClick={onRecordRecommendations}
          >
            <FileText className="me-2 h-4 w-4" aria-hidden />
            {labels.recordRecommendations}
          </Button>
        ) : null}
      </div>

      {cancel ? (
        <div className="shrink-0 lg:text-end">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {labels.alsoAvailable}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={!cancel.enabled || pending}
            onClick={onCancel}
          >
            <XCircle className="me-2 h-4 w-4" aria-hidden />
            {labels.actions.cancel_investigation}
          </Button>
          {cancel.blockedReason ? (
            <p className="mt-2 max-w-sm text-xs text-warning-700 dark:text-warning-300">
              {lifecycleBlockedReason(labels, cancel.blockedReason)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LifecycleActionIcon({ kind }: { kind: InvestigationLifecycleActionKind }) {
  switch (kind) {
    case "start_investigation":
      return <Play className="me-2 h-4 w-4" aria-hidden />;
    case "record_findings":
      return <FileText className="me-2 h-4 w-4" aria-hidden />;
    case "send_for_approval":
      return <ShieldCheck className="me-2 h-4 w-4" aria-hidden />;
    case "decide_approval":
      return <ClipboardCheck className="me-2 h-4 w-4" aria-hidden />;
    case "close_investigation":
      return <ShieldCheck className="me-2 h-4 w-4" aria-hidden />;
    case "reopen_for_rework":
      return <RefreshCw className="me-2 h-4 w-4" aria-hidden />;
    case "terminal":
      return null;
  }
}

function lifecycleBlockedReason(
  labels: InvestigationLifecycleLabels,
  reason: InvestigationLifecycleBlockReason,
): string {
  return labels.blockedReasons[reason];
}

function isActionableApprovalTask(task: InvestigationApprovalTask): boolean {
  const status = String(task.status ?? "").toLowerCase();
  if (task.completed_at) return false;
  if (!status) return true;
  return ![
    "approved",
    "rejected",
    "complete",
    "completed",
    "done",
    "cancelled",
    "canceled",
    "closed",
  ].includes(status);
}
