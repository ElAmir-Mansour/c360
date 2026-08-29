"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { showApiError, showSuccess } from "@/lib/toast";
import {
  type Investigation,
  type StartInvestigationApprovalPayload,
  investigationsApi,
} from "@/lib/lex/investigations";
import { LexRouteGuard } from "../../../_guards/lex-route-guard";
import { InvestigationApprovalDialog } from "../../_components/investigation-dialogs";
import { InvestigationReportWorkspace } from "./_components/investigation-report-workspace";
import { useInvestigationReportLabels } from "./_components/investigation-report-labels";
import {
  buildInvestigationReportDraft,
  investigationReportMetadata,
  type InvestigationReportDraft,
  nextReportVersion,
  serializeReportFindings,
  serializeReportRecommendations,
} from "./_components/investigation-report-model";

const IMMUTABLE_STATUSES = new Set([
  "pending_approval",
  "approved",
  "closed",
  "cancelled",
]);

export default function InvestigationReportPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const t = useInvestigationReportLabels();
  const [draft, setDraft] = useState<InvestigationReportDraft | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);

  const investigationQuery = useQuery({
    queryKey: ["lex-investigation", id],
    queryFn: () => investigationsApi.get(id),
    enabled: Boolean(id),
  });

  const investigation = investigationQuery.data;
  const approvalQuery = useQuery({
    queryKey: ["lex-investigation-approval", id],
    queryFn: () => investigationsApi.listApprovalTasks(id),
    enabled: Boolean(id) && Boolean(investigation?.workflow_instance_id),
    retry: false,
  });

  const initialDraft = useMemo(
    () =>
      investigation
        ? buildInvestigationReportDraft(investigation, {
            finding: t.finding,
            recommendation: t.recommendation,
            owner: investigation.department ?? t.owner,
          })
        : null,
    [investigation, t.finding, t.owner, t.recommendation],
  );

  useEffect(() => {
    if (initialDraft) setDraft(initialDraft);
  }, [initialDraft]);

  const refresh = async () => {
    await Promise.all([
      investigationQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ["lex-investigations"] }),
      queryClient.invalidateQueries({
        queryKey: ["lex-investigation-approval", id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["lex-investigation-audit", id],
      }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async (currentDraft: InvestigationReportDraft) => {
      if (!investigation) throw new Error(t.error);
      const savedDraft = {
        ...currentDraft,
        version: nextReportVersion(currentDraft.version),
        savedAt: new Date().toISOString(),
      };
      const updated = await investigationsApi.update(id, {
        metadata: investigationReportMetadata(investigation, savedDraft),
      });
      return { updated, savedDraft };
    },
    onSuccess: async ({ savedDraft }) => {
      setDraft(savedDraft);
      showSuccess(t.draftSaved);
      await refresh();
    },
    onError: showApiError,
  });

  const submitMutation = useMutation({
    mutationFn: async ({
      currentDraft,
      approval,
    }: {
      currentDraft: InvestigationReportDraft;
      approval: StartInvestigationApprovalPayload;
    }) => {
      if (!investigation) throw new Error(t.error);
      const findings = serializeReportFindings(currentDraft.findings);
      const recommendations = serializeReportRecommendations(
        currentDraft.recommendations,
      );
      if (!findings || !recommendations) throw new Error(t.validation);

      const savedDraft = {
        ...currentDraft,
        version: nextReportVersion(currentDraft.version),
        savedAt: new Date().toISOString(),
      };

      await investigationsApi.update(id, {
        metadata: investigationReportMetadata(investigation, savedDraft),
      });
      await investigationsApi.recordResults(id, {
        findings,
        generate_ai: false,
        findings_prompt: "",
      });
      await investigationsApi.recordRecommendations(id, {
        recommendations,
        generate_ai: false,
        recommendations_prompt: "",
      });
      const updated = await investigationsApi.startApproval(id, approval);
      return { updated, savedDraft };
    },
    onSuccess: async ({ savedDraft }) => {
      setDraft(savedDraft);
      setApprovalOpen(false);
      showSuccess(t.reviewStarted);
      await refresh();
    },
    onError: showApiError,
  });

  if (investigationQuery.isLoading) {
    return (
      <LexRouteGuard route="/lex/investigations/[id]/report">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            title={t.loadingTitle}
            description={t.loadingDescription}
          />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,2.15fr)_minmax(320px,.95fr)]">
            <div className="space-y-6">
              <Skeleton.Card />
              <Skeleton.Card />
            </div>
            <Skeleton.Card />
          </div>
        </div>
      </LexRouteGuard>
    );
  }

  if (investigationQuery.isError || !investigation || !draft) {
    return (
      <LexRouteGuard route="/lex/investigations/[id]/report">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            title={t.loadingTitle}
            description={t.loadingDescription}
          />
          <ErrorState
            message={t.error}
            onRetry={() => void investigationQuery.refetch()}
          />
        </div>
      </LexRouteGuard>
    );
  }

  const canEdit =
    hasPermission("lex:investigation:edit") &&
    !IMMUTABLE_STATUSES.has(investigation.status);
  const canSubmit =
    hasPermission("lex:investigation:approve") &&
    canEdit &&
    (investigation.status === "registered" ||
      investigation.status === "in_progress" ||
      investigation.status === "results_recorded" ||
      investigation.status === "rejected");

  const exportReport = () => {
    if (typeof window === "undefined") return;
    const originalTitle = document.title;
    document.title = `${investigation.investigation_number} — ${t.printTitle}`;
    window.addEventListener(
      "afterprint",
      () => {
        document.title = originalTitle;
      },
      { once: true },
    );
    window.print();
  };

  return (
    <LexRouteGuard route="/lex/investigations/[id]/report">
      <div dir={direction} lang={locale}>
        <InvestigationReportWorkspace
          investigation={investigation}
          draft={draft}
          approvalTasks={approvalQuery.data ?? []}
          canEdit={canEdit}
          canSubmit={canSubmit}
          saving={saveMutation.isPending}
          submitting={submitMutation.isPending}
          onDraftChange={setDraft}
          onSave={() => saveMutation.mutate(draft)}
          onExport={exportReport}
          onSubmit={() => setApprovalOpen(true)}
        />

        <InvestigationApprovalDialog
          open={approvalOpen}
          loading={submitMutation.isPending}
          onOpenChange={setApprovalOpen}
          onSubmit={(approval) =>
            submitMutation.mutate({ currentDraft: draft, approval })
          }
        />
      </div>
    </LexRouteGuard>
  );
}
