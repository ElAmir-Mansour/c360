"use client";

import { statisticHint } from "@/lib/lex/statistic-hint";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowRight,
  Clock,
  FileText,
  GitBranch,
  Loader2,
  Pencil,
  PenSquare,
  Plus,
  Route,
  ShieldCheck,
  Trash2,
  Workflow,
} from "lucide-react";
import { ErrorState } from "@/components/common/error-state";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { LexRouteGuard } from "../_guards/lex-route-guard";
import { DefinitionList } from "@/app/(dashboard)/admin/workflows/definitions/components/definition-list";
import { InstancesList } from "@/app/(dashboard)/admin/workflows/instances/components/instances-list";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { TenantRolePicker } from "@/components/shared/forms/tenant-role-picker";
import { TenantUserPicker } from "@/components/shared/forms/tenant-user-picker";
import { SectionCard } from "@/components/suites/section-card";
import { LexListShell } from "@/components/lex/list-shell";
import { LexListSkeleton } from "@/components/lex/list-skeleton";
import { LexEmptyState } from "@/components/lex/empty-state";
import { LexKpiStrip, type LexKpiItem } from "@/components/lex/kpi-strip";
import { LexStatusChip } from "@/components/lex/status-chip";
import { rowAccentClass } from "@/components/lex/row-accents";
import { useLexFormat, type LexFormatter } from "@/lib/lex/ksa";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { enterpriseApi } from "@/lib/enterprise";
import { showApiError, showSuccess } from "@/lib/toast";
import {
  type WorkflowPolicyLabels,
  useWorkflowPolicyLabels,
} from "./_components/labels";
import type {
  JsonObject,
  LexApprovalFormFieldRequest,
  LexApprovalFormFieldType,
  LexApprovalPolicy,
  LexApprovalPolicyAnalytics,
  LexApprovalPolicyApprover,
  LexApprovalPolicyApproverType,
  LexApprovalPolicyMode,
  LexApprovalPolicyQuorum,
  LexApprovalPolicyRecommendationResult,
  LexContractRecord,
  LexContractType,
  LexCreateApprovalPolicyRequest,
  LexUpdateApprovalPolicyRequest,
} from "@/types/suites";

const CONTRACT_TYPES = [
  "service_agreement",
  "nda",
  "employment",
  "vendor",
  "license",
  "lease",
  "partnership",
  "consulting",
  "procurement",
  "sla",
  "mou",
  "amendment",
  "renewal",
  "other",
] as const satisfies readonly LexContractType[];

const POLICY_STATUSES = ["active", "draft", "archived"] as const;
const APPROVER_TYPES = [
  "role",
  "user",
] as const satisfies readonly LexApprovalPolicyApproverType[];
const POLICY_MODES = [
  "parallel",
  "sequential",
] as const satisfies readonly LexApprovalPolicyMode[];
const POLICY_QUORUMS = [
  "all",
  "any",
  "n_of_m",
] as const satisfies readonly LexApprovalPolicyQuorum[];
const FIELD_TYPES = [
  "textarea",
  "text",
  "select",
  "number",
  "date",
  "boolean",
] as const satisfies readonly LexApprovalFormFieldType[];
const EMPTY_POLICIES: LexApprovalPolicy[] = [];
const EMPTY_CONTRACTS: LexContractRecord[] = [];

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

type ApprovalPolicyStatus = (typeof POLICY_STATUSES)[number];

interface ApproverDraft {
  type: LexApprovalPolicyApproverType;
  ref: string;
  label: string;
}

interface FormFieldDraft {
  name: string;
  type: LexApprovalFormFieldType;
  label: string;
  required: boolean;
  options: string;
  placeholder: string;
  description: string;
}

interface ApprovalPolicyFormValues {
  name: string;
  description: string;
  status: ApprovalPolicyStatus;
  priority: string;
  contract_type: LexContractType | "any";
  department: string;
  min_value: string;
  max_value: string;
  currency: string;
  mode: LexApprovalPolicyMode;
  quorum: LexApprovalPolicyQuorum;
  quorum_n: string;
  require_authority_evidence: boolean;
  required_role: string;
  required_authority_amount: string;
  approvers: ApproverDraft[];
  form_fields: FormFieldDraft[];
}

export default function LexWorkflowPoliciesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  // KSA formatting: Arabic mode renders Arabic-Indic digits + Hijri dates.
  const f = useLexFormat();
  const labels = useWorkflowPolicyLabels();
  // §13 — these are approval/workflow policies; mutation controls stay on
  // lex:approval:admin. Viewing is handled by the route guard, which mirrors the
  // backend read tier for this catalog.
  const canWrite = hasPermission("lex:approval:admin");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<LexApprovalPolicy | null>(
    null,
  );
  const [archivePolicy, setArchivePolicy] = useState<LexApprovalPolicy | null>(
    null,
  );
  const [selectedContractId, setSelectedContractId] = useState("");
  const [policyScope, setPolicyScope] = useState<ApprovalPolicyStatus | "all">("all");

  const policiesQuery = useQuery({
    queryKey: ["lex-approval-policies"],
    queryFn: () => enterpriseApi.lex.listApprovalPolicies(),
  });

  const analyticsQuery = useQuery({
    queryKey: ["lex-approval-policy-analytics"],
    queryFn: () => enterpriseApi.lex.getApprovalPolicyAnalytics(),
  });

  const contractsQuery = useQuery({
    queryKey: ["lex-approval-policy-contracts"],
    queryFn: () =>
      enterpriseApi.lex.listContracts({
        page: 1,
        per_page: 50,
        sort: "updated_at",
        order: "desc",
      }),
  });

  const recommendMutation = useMutation({
    mutationFn: (contractId: string) =>
      enterpriseApi.lex.recommendApprovalPolicy(contractId),
    onError: showApiError,
  });

  const archiveMutation = useMutation({
    mutationFn: (policyId: string) => enterpriseApi.lex.archiveApprovalPolicy(policyId),
    onSuccess: async () => {
      showSuccess(labels.toast.archived);
      setArchivePolicy(null);
      await refreshPolicies();
    },
    onError: showApiError,
  });

  const policies = policiesQuery.data ?? EMPTY_POLICIES;
  const analytics = analyticsQuery.data;
  const contracts = contractsQuery.data?.data ?? EMPTY_CONTRACTS;
  const selectedContract = useMemo(
    () =>
      contracts.find((contract) => contract.id === selectedContractId) ??
      contracts[0],
    [contracts, selectedContractId],
  );
  // KPIs computed client-side from the already-fetched policy list, with the
  // analytics summary preferred when present (it is tenant-authoritative).
  const activeCount = policies.filter(
    (policy) => policy.status === "active",
  ).length;
  const draftCount = policies.filter(
    (policy) => policy.status === "draft",
  ).length;
  const archivedCount = policies.filter(
    (policy) => policy.status === "archived",
  ).length;
  const totalPolicies = analytics?.total_policies ?? policies.length;
  const totalActivePolicies = analytics?.active_policies ?? activeCount;
  const totalDraftPolicies = analytics?.draft_policies ?? draftCount;
  const totalArchivedPolicies = analytics?.archived_policies ?? archivedCount;
  const routedTaskCount = analytics?.total_routed_tasks ?? 0;
  const awaitingQuorumCount = analytics?.awaiting_quorum_tasks ?? 0;
  const avgDecisionLabel = formatHoursValue(analytics?.average_decision_hours, f);
  const activePolicyShare = percent(totalActivePolicies, totalPolicies);
  const draftPolicyShare = percent(totalDraftPolicies, totalPolicies);
  const archivedPolicyShare = percent(totalArchivedPolicies, totalPolicies);
  const awaitingQuorumShare = percent(awaitingQuorumCount, routedTaskCount);

  const kpiItems: LexKpiItem[] = [
    {
      id: "policies",
      label: labels.metrics.policies,
      value: totalPolicies,
      theme: "sky",
      icon: Workflow,
      description: labels.metricDetails.policyScope,
      progress: totalPolicies > 0 ? 100 : 0,
      progressLabel: labels.metricDetails.policyShare,
      detail: labels.metricDetails.currentCatalog,
      detailValue: f.formatNumber(totalPolicies),
      onAction: () => setPolicyScope("all"),
      pressed: policyScope === "all",
    },
    {
      id: "active",
      label: labels.metrics.active,
      value: totalActivePolicies,
      theme: "emerald",
      icon: ShieldCheck,
      description: labels.metricDetails.activePolicies,
      progress: activePolicyShare,
      progressLabel: labels.metricDetails.policyShare,
      detail: labels.metrics.active,
      detailValue: `${f.formatNumber(activePolicyShare)}%`,
      onAction: () => setPolicyScope("active"),
      pressed: policyScope === "active",
    },
    {
      id: "drafts",
      label: labels.metrics.drafts,
      value: totalDraftPolicies,
      theme: "amber",
      icon: FileText,
      description: labels.metricDetails.draftPolicies,
      progress: draftPolicyShare,
      progressLabel: labels.metricDetails.policyShare,
      detail: labels.metrics.drafts,
      detailValue: `${f.formatNumber(draftPolicyShare)}%`,
      onAction: () => setPolicyScope("draft"),
      pressed: policyScope === "draft",
    },
    {
      id: "archived",
      label: labels.metrics.archived,
      value: totalArchivedPolicies,
      theme: "violet",
      icon: Archive,
      description: labels.metricDetails.archivedPolicies,
      progress: archivedPolicyShare,
      progressLabel: labels.metricDetails.policyShare,
      detail: labels.metrics.archived,
      detailValue: `${f.formatNumber(archivedPolicyShare)}%`,
      onAction: () => setPolicyScope("archived"),
      pressed: policyScope === "archived",
    },
    {
      id: "routed",
      label: labels.metrics.routedTasks,
      value: routedTaskCount,
      theme: "blue",
      icon: Route,
      description: labels.metricDetails.routedWork,
      progress: routedTaskCount > 0 ? 100 : 0,
      progressLabel: labels.metricDetails.taskShare,
      detail: labels.metrics.routedTasks,
      detailValue: f.formatNumber(routedTaskCount),
      href: "/lex/inbox?view=decisions",
    },
    {
      id: "awaiting",
      label: labels.metrics.awaitingQuorum,
      value: awaitingQuorumCount,
      theme: "orange",
      icon: GitBranch,
      description: labels.metricDetails.quorumWork,
      progress: awaitingQuorumShare,
      progressLabel: labels.metricDetails.taskShare,
      detail: labels.metrics.awaitingQuorum,
      detailValue: `${f.formatNumber(awaitingQuorumShare)}%`,
      trendGoodWhenDown: true,
      href: "/lex/inbox?view=decisions",
    },
    {
      id: "avg-decision",
      label: labels.metrics.avgDecision,
      // Pre-formatted (e.g. "5.5h"); passed as a string so the strip renders it verbatim.
      value: avgDecisionLabel === "-" ? "—" : avgDecisionLabel,
      theme: "teal",
      icon: Clock,
      description: labels.metricDetails.decisionSpeed,
      progress: 100,
      progressLabel: labels.metrics.avgDecision,
      detail: labels.analyticsCard.summary.avgHours,
      detailValue: avgDecisionLabel === "-" ? "—" : avgDecisionLabel,
      href: "/lex/reports/analytics",
    },
  ];

  const recommendForSelectedContract = () => {
    if (!selectedContract) {
      return;
    }
    recommendMutation.mutate(selectedContract.id);
  };

  const refreshPolicies = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lex-approval-policies"] }),
      queryClient.invalidateQueries({
        queryKey: ["lex-approval-policy-analytics"],
      }),
      queryClient.invalidateQueries({ queryKey: ["lex-overview"] }),
    ]);
  };

  const visiblePolicies =
    policyScope === "all" ? policies : policies.filter((policy) => policy.status === policyScope);
  const showEmpty =
    !policiesQuery.isLoading && !policiesQuery.isError && visiblePolicies.length === 0;

  return (
    <LexRouteGuard route="/lex/workflow-policies">
      <div dir={direction} lang={locale} className="space-y-6">
        <LexListShell
          title={labels.pageTitle}
          description={labels.pageDescription}
          eyebrow={labels.eyebrow}
          dir={direction === "rtl" ? "rtl" : "ltr"}
          actions={
            canWrite ? (
              <div className="flex items-center gap-2">
                <Button
                  asChild
                  variant="outline"
                  className=""
                >
                  <Link href="/admin/workflows/definitions">
                    <PenSquare className="me-1.5 h-4 w-4" />
                    {labels.designer}
                  </Link>
                </Button>
                <Button
                  className=""
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="me-1.5 h-4 w-4" />
                  {labels.createPolicy}
                </Button>
              </div>
            ) : undefined
          }
          kpi={<LexKpiStrip items={kpiItems} columns={4} />}
        >
          <Tabs defaultValue="policies" className="p-4">
            <TabsList>
              <TabsTrigger value="policies">{labels.tabs.policies}</TabsTrigger>
              <TabsTrigger value="definitions">
                {labels.tabs.definitions}
              </TabsTrigger>
              <TabsTrigger value="instances">
                {labels.tabs.instances}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="policies">
          {/* Catalog title is rendered unconditionally so it stays visible across
              loading / empty / table states. */}
          <div className="border-b border-border/60 px-5 py-4">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              {labels.catalog.title}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {labels.catalog.description}
            </p>
          </div>
          {policiesQuery.isLoading ? (
            <LexListSkeleton
              rows={6}
              cols={canWrite ? 6 : 5}
              className="rounded-none border-0 bg-transparent"
            />
          ) : policiesQuery.isError ? (
            <div className="p-4">
              <ErrorState
                message={labels.catalog.loadError}
                onRetry={() => void policiesQuery.refetch()}
              />
            </div>
          ) : showEmpty ? (
            <LexEmptyState
              icon={Workflow}
              title={labels.catalog.emptyTitle}
              description={labels.catalog.emptyDescription}
              action={
                canWrite
                  ? {
                      label: labels.catalog.emptyCta,
                      onClick: () => setCreateOpen(true),
                      icon: Plus,
                    }
                  : undefined
              }
            />
          ) : (
            <Table className="table-premium">
              <TableHeader>
                <TableRow>
                  <TableHead>{labels.catalog.columns.policy}</TableHead>
                  <TableHead>{labels.catalog.columns.scope}</TableHead>
                  <TableHead>{labels.catalog.columns.route}</TableHead>
                  <TableHead>{labels.catalog.columns.authority}</TableHead>
                  <TableHead>{labels.catalog.columns.updated}</TableHead>
                  {canWrite ? (
                    <TableHead className="text-end">
                      {labels.catalog.columns.actions}
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePolicies.map((policy) => (
                  <TableRow
                    key={policy.id}
                    className={cn(rowAccentClass("status", policy.status))}
                  >
                    <TableCell className="min-w-[220px]">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{policy.name}</span>
                          <LexStatusChip
                            value={policy.status}
                            domain="generic"
                            labels={labels.statusLabels}
                            size="sm"
                          />
                        </div>
                        {policy.description ? (
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {policy.description}
                          </p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          {labels.catalog.priority(f.formatNumber(policy.priority))}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{formatPolicyScope(policy, labels, f)}</TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline">
                            {labels.modeLabels[policy.mode] ?? formatToken(policy.mode)}
                          </Badge>
                          <Badge variant="outline">
                            {formatQuorum(policy, labels, f)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {policy.approvers.slice(0, 3).map((approver) => (
                            <Badge
                              key={`${policy.id}-${approver.type}-${approver.ref}`}
                              variant="secondary"
                            >
                              {approver.label || approver.ref}
                            </Badge>
                          ))}
                          {policy.approvers.length > 3 ? (
                            <Badge variant="outline">
                              +{f.formatNumber(policy.approvers.length - 3)}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1 text-sm">
                        <p>
                          {policy.required_role
                            ? formatToken(policy.required_role)
                            : labels.catalog.anyApprovalAuthority}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {policy.require_authority_evidence
                            ? labels.catalog.evidenceRequired
                            : labels.catalog.evidenceOptional}
                        </p>
                        {policy.required_authority_amount != null ? (
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {f.formatCurrency(policy.required_authority_amount, {
                              currency: formatCurrency(policy.currency),
                            })}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className="text-sm tabular-nums"
                        title={labels.catalog.updatedTitle(
                          f.formatDual(policy.updated_at),
                        )}
                      >
                        {f.formatRelative(policy.updated_at)}
                      </span>
                    </TableCell>
                    {canWrite ? (
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingPolicy(policy)}
                            aria-label={labels.catalog.editAria(policy.name)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setArchivePolicy(policy)}
                            disabled={policy.status === "archived"}
                            aria-label={labels.catalog.archiveAria(policy.name)}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
            </TabsContent>
            <TabsContent value="definitions">
              <DefinitionList hideHeader />
            </TabsContent>
            <TabsContent value="instances">
              <InstancesList hideHeader />
            </TabsContent>
          </Tabs>
        </LexListShell>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard
            title={labels.analyticsCard.title}
            description={labels.analyticsCard.description}
          >
            {analyticsQuery.isLoading ? (
              <LoadingSkeleton variant="table-row" count={4} />
            ) : analyticsQuery.isError ? (
              <ErrorState
                message={labels.analyticsCard.loadError}
                onRetry={() => void analyticsQuery.refetch()}
              />
            ) : analytics ? (
              <ApprovalPolicyAnalyticsTable analytics={analytics} labels={labels} f={f} />
            ) : null}
          </SectionCard>

          <SectionCard
            title={labels.recommendation.title}
            description={labels.recommendation.description}
          >
            <div className="space-y-4">
              {contractsQuery.isError ? (
                <ErrorState
                  message={labels.recommendation.loadError}
                  onRetry={() => void contractsQuery.refetch()}
                />
              ) : contracts.length === 0 && !contractsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">
                  {labels.recommendation.noContracts}
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="recommend-contract">{labels.recommendation.contract}</Label>
                    <Select
                      value={selectedContract?.id ?? ""}
                      onValueChange={(value) => {
                        setSelectedContractId(value);
                        recommendMutation.reset();
                      }}
                      disabled={
                        contractsQuery.isLoading || contracts.length === 0
                      }
                    >
                      <SelectTrigger id="recommend-contract">
                        <SelectValue placeholder={labels.recommendation.selectContract} />
                      </SelectTrigger>
                      <SelectContent>
                        {contracts.map((contract) => (
                          <SelectItem key={contract.id} value={contract.id}>
                            {contract.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedContract ? (
                    <ContractRecommendationContext
                      contract={selectedContract}
                      labels={labels}
                      f={f}
                    />
                  ) : null}

                  <Button
                    className="w-full"
                    onClick={recommendForSelectedContract}
                    disabled={!selectedContract || recommendMutation.isPending}
                  >
                    {recommendMutation.isPending ? (
                      <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                    ) : null}
                    {labels.recommendation.recommend}
                  </Button>
                </>
              )}

              {recommendMutation.data ? (
                <RecommendationResult
                  result={recommendMutation.data}
                  contract={selectedContract}
                  labels={labels}
                  f={f}
                />
              ) : null}
            </div>
          </SectionCard>
        </div>

        <ApprovalPolicyDialog
          labels={labels}
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
          }}
          onSaved={refreshPolicies}
        />
        <ApprovalPolicyDialog
          labels={labels}
          policy={editingPolicy}
          open={editingPolicy != null}
          onOpenChange={(open) => {
            if (!open) {
              setEditingPolicy(null);
            }
          }}
          onSaved={refreshPolicies}
        />
        <ConfirmDialog
          open={archivePolicy != null}
          onOpenChange={(open) => {
            if (!open) {
              setArchivePolicy(null);
            }
          }}
          title={labels.archiveConfirm.title}
          description={
            archivePolicy
              ? labels.archiveConfirm.description(archivePolicy.name)
              : labels.archiveConfirm.fallbackDescription
          }
          confirmLabel={labels.archiveConfirm.confirm}
          variant="destructive"
          loading={archiveMutation.isPending}
          onConfirm={() => {
            if (archivePolicy) {
              archiveMutation.mutate(archivePolicy.id);
            }
          }}
        />
      </div>
    </LexRouteGuard>
  );
}

function ApprovalPolicyAnalyticsTable({
  analytics,
  labels,
  f,
}: {
  analytics: LexApprovalPolicyAnalytics;
  labels: WorkflowPolicyLabels;
  f: LexFormatter;
}) {
  const [metricScope, setMetricScope] = useState<ApprovalAnalyticsScope | null>(null);
  const visiblePolicies = useMemo(() => {
    if (metricScope === "completed") return analytics.policies.filter((policy) => policy.completed_tasks > 0);
    if (metricScope === "rejected") return analytics.policies.filter((policy) => policy.rejected_tasks > 0);
    if (metricScope === "cancelled") return analytics.policies.filter((policy) => policy.cancelled_tasks > 0);
    if (metricScope === "active") return analytics.policies.filter((policy) => policy.active_tasks > 0);
    if (metricScope === "average") return analytics.policies.filter((policy) => policy.average_decision_hours != null);
    return analytics.policies;
  }, [analytics.policies, metricScope]);
  const toggleMetricScope = (scope: ApprovalAnalyticsScope) => {
    setMetricScope((current) => (current === scope ? null : scope));
  };

  if (analytics.policies.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-8 text-center">
        <p className="text-sm font-medium">{labels.analyticsCard.emptyTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {labels.analyticsCard.emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <AnalyticsSummary label={labels.analyticsCard.summary.completed} value={f.formatNumber(analytics.completed_tasks)} onAction={() => toggleMetricScope("completed")} pressed={metricScope === "completed"} />
        <AnalyticsSummary label={labels.analyticsCard.summary.rejected} value={f.formatNumber(analytics.rejected_tasks)} onAction={() => toggleMetricScope("rejected")} pressed={metricScope === "rejected"} />
        <AnalyticsSummary label={labels.analyticsCard.summary.cancelled} value={f.formatNumber(analytics.cancelled_tasks)} onAction={() => toggleMetricScope("cancelled")} pressed={metricScope === "cancelled"} />
        <AnalyticsSummary label={labels.analyticsCard.summary.openTasks} value={f.formatNumber(analytics.active_tasks)} onAction={() => toggleMetricScope("active")} pressed={metricScope === "active"} />
        <AnalyticsSummary
          label={labels.analyticsCard.summary.avgHours}
          value={formatHoursValue(analytics.average_decision_hours, f)}
          onAction={() => toggleMetricScope("average")}
          pressed={metricScope === "average"}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60">
        <Table className="table-premium">
          <TableHeader>
            <TableRow>
              <TableHead>{labels.analyticsCard.columns.policy}</TableHead>
              <TableHead>{labels.analyticsCard.columns.route}</TableHead>
              <TableHead className="text-end">{labels.analyticsCard.columns.tasks}</TableHead>
              <TableHead className="text-end">{labels.analyticsCard.columns.open}</TableHead>
              <TableHead className="text-end">{labels.analyticsCard.columns.done}</TableHead>
              <TableHead className="text-end">{labels.analyticsCard.columns.rejected}</TableHead>
              <TableHead className="text-end">{labels.analyticsCard.columns.avgHours}</TableHead>
              <TableHead>{labels.analyticsCard.columns.lastRouted}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiblePolicies.map((policy) => (
              <TableRow
                key={policy.policy_id}
                className={cn(rowAccentClass("status", policy.status))}
              >
                <TableCell className="min-w-[220px]">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{policy.name}</span>
                      <LexStatusChip
                        value={policy.status}
                        domain="generic"
                        labels={labels.statusLabels}
                        size="sm"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {policy.require_authority_evidence
                        ? labels.analyticsCard.authorityEvidenceRequired
                        : labels.analyticsCard.authorityEvidenceOptional}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">
                      {labels.modeLabels[policy.mode] ?? formatToken(policy.mode)}
                    </Badge>
                    <Badge variant="outline">
                      {formatAnalyticsQuorum(policy, labels, f)}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {f.formatNumber(policy.total_tasks)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  <div className="space-y-1">
                    <span>{f.formatNumber(policy.active_tasks)}</span>
                    {policy.awaiting_quorum_tasks > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {f.formatNumber(policy.awaiting_quorum_tasks)} {labels.analyticsCard.quorumSuffix}
                      </p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {f.formatNumber(policy.completed_tasks)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {f.formatNumber(policy.rejected_tasks)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatHoursValue(policy.average_decision_hours, f)}
                </TableCell>
                <TableCell>
                  {policy.last_task_at ? (
                    <span
                      className="text-sm tabular-nums"
                      title={f.formatDual(policy.last_task_at)}
                    >
                      {f.formatRelative(policy.last_task_at)}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {labels.analyticsCard.noTasks}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type ApprovalAnalyticsScope = "completed" | "rejected" | "cancelled" | "active" | "average";

function AnalyticsSummary({
  label,
  value,
  onAction,
  pressed,
}: {
  label: string;
  value: number | string;
  onAction: () => void;
  pressed: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onAction}
      title={statisticHint(label)}
      aria-pressed={pressed}
      data-pressed={pressed}
      className="rounded-xl border border-border/60 bg-card/40 px-3 py-3 text-start transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[pressed=true]:border-primary data-[pressed=true]:bg-primary/10"
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </button>
  );
}

function ApprovalPolicyDialog({
  labels,
  onOpenChange,
  onSaved,
  open,
  policy,
}: {
  labels: WorkflowPolicyLabels;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  open: boolean;
  policy?: LexApprovalPolicy | null;
}) {
  const [values, setValues] = useState<ApprovalPolicyFormValues>(() =>
    approvalPolicyDefaults(policy),
  );
  const isEditing = policy != null;

  useEffect(() => {
    if (open) {
      setValues(approvalPolicyDefaults(policy));
    }
  }, [open, policy]);

  const createMutation = useMutation({
    mutationFn: (payload: LexCreateApprovalPolicyRequest) =>
      enterpriseApi.lex.createApprovalPolicy(payload),
    onSuccess: async () => {
      showSuccess(labels.toast.created);
      await onSaved();
      setValues(approvalPolicyDefaults());
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: LexUpdateApprovalPolicyRequest) => {
      if (!policy) {
        throw new Error(labels.missingPolicy);
      }
      return enterpriseApi.lex.updateApprovalPolicy(policy.id, payload);
    },
    onSuccess: async () => {
      showSuccess(labels.toast.updated);
      await onSaved();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const updateValue = <K extends keyof ApprovalPolicyFormValues>(
    key: K,
    value: ApprovalPolicyFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const updateApprover = <K extends keyof ApproverDraft>(
    index: number,
    key: K,
    value: ApproverDraft[K],
  ) => {
    setValues((current) => ({
      ...current,
      approvers: current.approvers.map((approver, itemIndex) =>
        itemIndex === index ? { ...approver, [key]: value } : approver,
      ),
    }));
  };

  const updateFormField = <K extends keyof FormFieldDraft>(
    index: number,
    key: K,
    value: FormFieldDraft[K],
  ) => {
    setValues((current) => ({
      ...current,
      form_fields: current.form_fields.map((field, itemIndex) =>
        itemIndex === index ? { ...field, [key]: value } : field,
      ),
    }));
  };

  const validApprovers = values.approvers.filter(
    (approver) => approver.ref.trim() !== "",
  );
  const validationErrors = validateApprovalPolicyForm(values, labels);
  const canSubmit =
    values.name.trim() !== "" &&
    validApprovers.length > 0 &&
    validationErrors.length === 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const payload = buildCreateApprovalPolicyPayload(values);
    if (isEditing) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? labels.dialog.editTitle : labels.dialog.createTitle}
          </DialogTitle>
          <DialogDescription>
            {labels.dialog.description}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-6" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="policy-name">{labels.dialog.name}</Label>
              <Input
                id="policy-name"
                value={values.name}
                onChange={(event) => updateValue("name", event.target.value)}
                placeholder={labels.dialog.namePlaceholder}
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="policy-description">{labels.dialog.descriptionField}</Label>
              <Textarea
                id="policy-description"
                value={values.description}
                onChange={(event) =>
                  updateValue("description", event.target.value)
                }
                rows={3}
                placeholder={labels.dialog.descriptionPlaceholder}
              />
            </div>
            <SelectField
              label={labels.dialog.status}
              value={values.status}
              onValueChange={(value) =>
                updateValue("status", value as ApprovalPolicyStatus)
              }
              options={POLICY_STATUSES}
              formatOption={(option) => labels.statusLabels[option] ?? formatToken(option)}
            />
            <div className="space-y-2">
              <Label htmlFor="policy-priority">{labels.dialog.priority}</Label>
              <Input
                id="policy-priority"
                type="number"
                value={values.priority}
                onChange={(event) =>
                  updateValue("priority", event.target.value)
                }
                min={0}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <SelectField
              label={labels.dialog.contractType}
              value={values.contract_type}
              onValueChange={(value) =>
                updateValue("contract_type", value as LexContractType | "any")
              }
              options={["any", ...CONTRACT_TYPES]}
              formatOption={(option) =>
                option === "any"
                  ? labels.contractTypeAny
                  : labels.contractTypeLabels[option] ?? formatToken(option)
              }
            />
            <div className="space-y-2">
              <Label htmlFor="policy-department">{labels.dialog.department}</Label>
              <Input
                id="policy-department"
                value={values.department}
                onChange={(event) =>
                  updateValue("department", event.target.value)
                }
                placeholder={labels.dialog.departmentPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-currency">{labels.dialog.currency}</Label>
              <Input
                id="policy-currency"
                value={values.currency}
                onChange={(event) =>
                  updateValue("currency", event.target.value.toUpperCase())
                }
                maxLength={3}
                placeholder={labels.dialog.currencyPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-min-value">{labels.dialog.minValue}</Label>
              <Input
                id="policy-min-value"
                type="number"
                value={values.min_value}
                onChange={(event) =>
                  updateValue("min_value", event.target.value)
                }
                min={0}
                max={values.max_value || undefined}
                placeholder={labels.dialog.minValuePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-max-value">{labels.dialog.maxValue}</Label>
              <Input
                id="policy-max-value"
                type="number"
                value={values.max_value}
                onChange={(event) =>
                  updateValue("max_value", event.target.value)
                }
                min={values.min_value || 0}
                placeholder={labels.dialog.maxValuePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-required-amount">{labels.dialog.authorityAmount}</Label>
              <Input
                id="policy-required-amount"
                type="number"
                value={values.required_authority_amount}
                onChange={(event) =>
                  updateValue("required_authority_amount", event.target.value)
                }
                min={0}
                placeholder={labels.dialog.authorityAmountPlaceholder}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <SelectField
              label={labels.dialog.mode}
              value={values.mode}
              onValueChange={(value) =>
                updateValue("mode", value as LexApprovalPolicyMode)
              }
              options={POLICY_MODES}
              formatOption={(option) => labels.modeLabels[option] ?? formatToken(option)}
            />
            <SelectField
              label={labels.dialog.quorum}
              value={values.quorum}
              onValueChange={(value) =>
                updateValue("quorum", value as LexApprovalPolicyQuorum)
              }
              options={POLICY_QUORUMS}
              formatOption={(option) => labels.quorumLabels[option] ?? formatToken(option)}
            />
            <div className="space-y-2">
              <Label htmlFor="policy-quorum-n">{labels.dialog.quorumCount}</Label>
              <Input
                id="policy-quorum-n"
                type="number"
                value={values.quorum_n}
                onChange={(event) =>
                  updateValue("quorum_n", event.target.value)
                }
                min={1}
                max={validApprovers.length || undefined}
                disabled={values.quorum !== "n_of_m"}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr]">
            <div className="rounded-lg border px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{labels.dialog.authorityEvidence}</p>
                  <p className="text-xs text-muted-foreground">
                    {labels.dialog.authorityEvidenceDescription}
                  </p>
                </div>
                <Switch
                  checked={values.require_authority_evidence}
                  onCheckedChange={(checked) =>
                    updateValue("require_authority_evidence", checked)
                  }
                  aria-label={labels.dialog.toggleAuthorityEvidence}
                />
              </div>
              <div className="mt-4 space-y-2">
                <Label htmlFor="policy-required-role">{labels.dialog.requiredRole}</Label>
                <TenantRolePicker
                  id="policy-required-role"
                  ariaLabel={labels.dialog.requiredRole}
                  valueKind="slug"
                  value={values.required_role}
                  onChange={(value) => updateValue("required_role", value)}
                  enabled={open}
                  allowClear
                  labels={{
                    select: labels.dialog.requiredRolePlaceholder,
                    search: labels.dialog.requiredRolePlaceholder,
                  }}
                />
              </div>
            </div>

            <div className="rounded-lg border px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{labels.dialog.approvers}</p>
                  <p className="text-xs text-muted-foreground">
                    {labels.dialog.approversDescription}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateValue("approvers", [
                      ...values.approvers,
                      emptyApprover(),
                    ])
                  }
                >
                  <Plus className="me-1 h-3.5 w-3.5" />
                  {labels.dialog.add}
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {values.approvers.map((approver, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/20 p-3 md:grid-cols-[120px_1fr_1fr_auto]"
                  >
                    <Select
                      value={approver.type}
                      onValueChange={(value) => {
                        updateApprover(
                          index,
                          "type",
                          value as LexApprovalPolicyApproverType,
                        );
                        updateApprover(index, "ref", "");
                        updateApprover(index, "label", "");
                      }}
                    >
                      <SelectTrigger aria-label={labels.dialog.approverType}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {APPROVER_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {labels.approverTypeLabels[type] ?? formatToken(type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {approver.type === "role" ? (
                      <TenantRolePicker
                        ariaLabel={labels.dialog.approverRefRolePlaceholder}
                        valueKind="slug"
                        value={approver.ref}
                        onChange={(value, option) => {
                          updateApprover(index, "ref", value);
                          if (option?.label) updateApprover(index, "label", option.label);
                        }}
                        enabled={open}
                        required={index === 0}
                        selectedLabel={approver.label || undefined}
                        labels={{
                          select: labels.dialog.approverRefRolePlaceholder,
                          search: labels.dialog.approverRefRolePlaceholder,
                        }}
                      />
                    ) : (
                      <TenantUserPicker
                        ariaLabel={labels.dialog.approverRefUserPlaceholder}
                        value={approver.ref}
                        onChange={(value, option) => {
                          updateApprover(index, "ref", value);
                          if (option?.label) updateApprover(index, "label", option.label);
                        }}
                        enabled={open}
                        required={index === 0}
                        selectedLabel={approver.label || undefined}
                        labels={{
                          select: labels.dialog.approverRefUserPlaceholder,
                          search: labels.dialog.approverRefUserPlaceholder,
                        }}
                      />
                    )}
                    <Input
                      value={approver.label}
                      onChange={(event) =>
                        updateApprover(index, "label", event.target.value)
                      }
                      placeholder={labels.dialog.approverLabelPlaceholder}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        updateValue(
                          "approvers",
                          values.approvers.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        )
                      }
                      disabled={values.approvers.length === 1}
                      aria-label={labels.dialog.removeApprover}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{labels.dialog.formFields}</p>
                <p className="text-xs text-muted-foreground">
                  {labels.dialog.formFieldsDescription}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateValue("form_fields", [
                    ...values.form_fields,
                    emptyFormField(),
                  ])
                }
              >
                <Plus className="me-1 h-3.5 w-3.5" />
                {labels.dialog.add}
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {values.form_fields.map((field, index) => (
                <div
                  key={index}
                  className="space-y-3 rounded-lg border bg-muted/20 p-3"
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_150px_auto]">
                    <Input
                      value={field.name}
                      onChange={(event) =>
                        updateFormField(index, "name", event.target.value)
                      }
                      placeholder={labels.dialog.fieldNamePlaceholder}
                    />
                    <Input
                      value={field.label}
                      onChange={(event) =>
                        updateFormField(index, "label", event.target.value)
                      }
                      placeholder={labels.dialog.fieldLabelPlaceholder}
                    />
                    <Select
                      value={field.type}
                      onValueChange={(value) =>
                        updateFormField(
                          index,
                          "type",
                          value as LexApprovalFormFieldType,
                        )
                      }
                    >
                      <SelectTrigger aria-label={labels.dialog.fieldType}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {labels.fieldTypeLabels[type] ?? formatToken(type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        updateValue(
                          "form_fields",
                          values.form_fields.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        )
                      }
                      aria-label={labels.dialog.removeFormField}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <Input
                      value={field.placeholder}
                      onChange={(event) =>
                        updateFormField(
                          index,
                          "placeholder",
                          event.target.value,
                        )
                      }
                      placeholder={labels.dialog.fieldPlaceholderPlaceholder}
                    />
                    <Input
                      value={field.options}
                      onChange={(event) =>
                        updateFormField(index, "options", event.target.value)
                      }
                      aria-label={labels.dialog.fieldOptions}
                      placeholder={labels.dialog.fieldOptionsPlaceholder}
                      disabled={field.type !== "select"}
                      required={field.type === "select"}
                    />
                    <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                      <Switch
                        checked={field.required}
                        onCheckedChange={(checked) =>
                          updateFormField(index, "required", checked)
                        }
                        aria-label={labels.dialog.toggleRequired}
                      />
                      {labels.dialog.required}
                    </label>
                  </div>
                  <Input
                    value={field.description}
                    onChange={(event) =>
                      updateFormField(index, "description", event.target.value)
                    }
                    aria-label={labels.dialog.fieldDescription}
                    placeholder={labels.dialog.fieldDescriptionPlaceholder}
                  />
                </div>
              ))}
            </div>
          </div>

          {validationErrors.length > 0 ? (
            <div
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              <p className="font-medium">{labels.dialog.validationHeader}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {validationErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {labels.dialog.cancel}
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || isSaving}
            >
              {isSaving ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
              ) : null}
              {isEditing ? labels.dialog.save : labels.dialog.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContractRecommendationContext({
  contract,
  labels,
  f,
}: {
  contract: LexContractRecord;
  labels: WorkflowPolicyLabels;
  f: LexFormatter;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{contract.title}</p>
          <p className="text-xs text-muted-foreground">
            {labels.contractTypeLabels[contract.type] ?? formatToken(contract.type)}
          </p>
        </div>
        <Badge variant="outline">{formatCurrency(contract.currency)}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {labels.recommendation.context.valuePrefix}{" "}
          {contract.total_value != null
            ? f.formatCurrency(contract.total_value, {
                currency: formatCurrency(contract.currency),
              })
            : labels.recommendation.context.undisclosed}
        </span>
        <span>
          {labels.recommendation.context.departmentPrefix}{" "}
          {contract.department || labels.recommendation.context.unassigned}
        </span>
      </div>
    </div>
  );
}

function RecommendationResult({
  contract,
  result,
  labels,
  f,
}: {
  contract?: LexContractRecord;
  result: LexApprovalPolicyRecommendationResult;
  labels: WorkflowPolicyLabels;
  f: LexFormatter;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-4 motion-safe:animate-scale-in",
        result.matched
          ? "border-success-500/40 bg-success-500/4"
          : "border-warning-500/40 bg-warning-500/5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {result.matched ? labels.recommendation.matchedTitle : labels.recommendation.noMatchTitle}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{result.reason}</p>
        </div>
        <Badge variant={result.matched ? "success" : "warning"}>
          {result.matched ? labels.recommendation.matchedBadge : labels.recommendation.reviewBadge}
        </Badge>
      </div>
      {result.policy ? (
        <div className="mt-4 space-y-3">
          <div>
            <p className="font-medium">{result.policy.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatPolicyScope(result.policy, labels, f)}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {result.policy.approvers.map((approver) => (
              <Badge
                key={`${approver.type}-${approver.ref}`}
                variant="secondary"
              >
                {approver.label || approver.ref}
              </Badge>
            ))}
          </div>
          {contract ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/lex/contracts/${contract.id}`}>
                {labels.recommendation.openContract}
                <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SelectField({
  label,
  onValueChange,
  options,
  value,
  formatOption,
}: {
  label: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  value: string;
  formatOption?: (option: string) => string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {formatOption ? formatOption(option) : formatToken(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function approvalPolicyDefaults(
  policy?: LexApprovalPolicy | null,
): ApprovalPolicyFormValues {
  if (policy) {
    return approvalPolicyValuesFromPolicy(policy);
  }

  return {
    name: "",
    description: "",
    status: "active",
    priority: "10",
    contract_type: "any",
    department: "",
    min_value: "",
    max_value: "",
    currency: "SAR",
    mode: "parallel",
    quorum: "all",
    quorum_n: "",
    require_authority_evidence: true,
    required_role: "finance_director",
    required_authority_amount: "",
    approvers: [
      { type: "role", ref: "finance_director", label: "Finance Director" },
    ],
    form_fields: [
      {
        name: "business_justification",
        type: "textarea",
        label: "Business justification",
        required: true,
        options: "",
        placeholder: "Summarize the commercial need.",
        description: "",
      },
    ],
  };
}

function approvalPolicyValuesFromPolicy(
  policy: LexApprovalPolicy,
): ApprovalPolicyFormValues {
  return {
    name: policy.name,
    description: policy.description ?? "",
    status: (POLICY_STATUSES.includes(policy.status as ApprovalPolicyStatus)
      ? policy.status
      : "draft") as ApprovalPolicyStatus,
    priority: String(policy.priority),
    contract_type: policy.contract_type ?? "any",
    department: policy.department ?? "",
    min_value: formatOptionalNumber(policy.min_value),
    max_value: formatOptionalNumber(policy.max_value),
    currency: policy.currency || "SAR",
    mode: policy.mode,
    quorum: policy.quorum,
    quorum_n: formatOptionalNumber(policy.quorum_n),
    require_authority_evidence: policy.require_authority_evidence,
    required_role: policy.required_role ?? "",
    required_authority_amount: formatOptionalNumber(
      policy.required_authority_amount,
    ),
    approvers:
      policy.approvers.length > 0
        ? policy.approvers.map((approver) => ({
            type: approver.type,
            ref: approver.ref,
            label: approver.label ?? "",
          }))
        : [emptyApprover()],
    form_fields: policy.form_fields.map((field) => ({
      name: field.name,
      type: field.type,
      label: field.label,
      required: Boolean(field.required),
      options: field.options?.join(", ") ?? "",
      placeholder: field.placeholder ?? "",
      description: field.description ?? "",
    })),
  };
}

function emptyApprover(): ApproverDraft {
  return { type: "role", ref: "", label: "" };
}

function emptyFormField(): FormFieldDraft {
  return {
    name: "",
    type: "text",
    label: "",
    required: false,
    options: "",
    placeholder: "",
    description: "",
  };
}

function validateApprovalPolicyForm(
  values: ApprovalPolicyFormValues,
  labels: WorkflowPolicyLabels,
): string[] {
  const errors: string[] = [];
  const approverCount = values.approvers.filter(
    (approver) => approver.ref.trim() !== "",
  ).length;

  if (values.quorum === "n_of_m") {
    const quorumCount = Number.parseInt(values.quorum_n, 10);
    if (!Number.isFinite(quorumCount) || quorumCount < 1) {
      errors.push(labels.validation.quorumAtLeastOne);
    } else if (quorumCount > approverCount) {
      errors.push(labels.validation.quorumExceedsApprovers);
    }
  }

  const minValue = optionalNumber(values.min_value);
  const maxValue = optionalNumber(values.max_value);
  if (minValue != null && maxValue != null && minValue > maxValue) {
    errors.push(labels.validation.minExceedsMax);
  }

  values.form_fields.forEach((field, index) => {
    if (field.type !== "select") {
      return;
    }

    if (parseCsv(field.options).length === 0) {
      errors.push(labels.validation.selectFieldNeedsOption(index + 1));
    }
  });

  return errors;
}

function buildCreateApprovalPolicyPayload(
  values: ApprovalPolicyFormValues,
): LexCreateApprovalPolicyRequest {
  const metadata: JsonObject = {
    source: "watheeq_workflow_policy_admin",
  };

  return {
    name: values.name.trim(),
    description: values.description.trim(),
    status: values.status,
    priority: parseInteger(values.priority, 0),
    contract_type: values.contract_type === "any" ? null : values.contract_type,
    department: optionalString(values.department),
    min_value: optionalNumber(values.min_value),
    max_value: optionalNumber(values.max_value),
    currency: formatCurrency(values.currency),
    mode: values.mode,
    quorum: values.quorum,
    quorum_n:
      values.quorum === "n_of_m" ? parseInteger(values.quorum_n, 1) : null,
    approvers: buildApprovers(values.approvers),
    form_fields: buildFormFields(values.form_fields),
    require_authority_evidence: values.require_authority_evidence,
    required_role: optionalString(values.required_role),
    required_authority_amount: optionalNumber(values.required_authority_amount),
    metadata,
  };
}

function buildApprovers(
  approvers: ApproverDraft[],
): LexApprovalPolicyApprover[] {
  return approvers
    .map((approver) => ({
      type: approver.type,
      ref: approver.ref.trim(),
      label: optionalString(approver.label),
    }))
    .filter((approver) => approver.ref.length > 0);
}

function buildFormFields(
  fields: FormFieldDraft[],
): LexApprovalFormFieldRequest[] {
  return fields
    .map((field) => ({
      name: field.name.trim(),
      type: field.type,
      label: field.label.trim(),
      required: field.required,
      options: field.type === "select" ? parseCsv(field.options) : undefined,
      placeholder: optionalString(field.placeholder) ?? undefined,
      description: optionalString(field.description) ?? undefined,
    }))
    .filter((field) => field.name.length > 0 && field.label.length > 0);
}

function formatPolicyScope(
  policy: LexApprovalPolicy,
  labels: WorkflowPolicyLabels,
  f: LexFormatter,
): string {
  const pieces = [
    policy.contract_type
      ? labels.contractTypeLabels[policy.contract_type] ?? formatToken(policy.contract_type)
      : labels.scope.anyType,
    policy.department || labels.scope.anyDepartment,
    formatValueRange(policy, labels, f),
  ];
  return pieces.join(labels.scope.separator);
}

function formatValueRange(
  policy: LexApprovalPolicy,
  labels: WorkflowPolicyLabels,
  f: LexFormatter,
): string {
  const currency = formatCurrency(policy.currency);
  if (policy.min_value != null && policy.max_value != null) {
    return labels.scope.rangeValue(
      currency,
      f.formatNumber(policy.min_value),
      f.formatNumber(policy.max_value),
    );
  }
  if (policy.min_value != null) {
    return labels.scope.fromValue(currency, f.formatNumber(policy.min_value));
  }
  if (policy.max_value != null) {
    return labels.scope.upToValue(currency, f.formatNumber(policy.max_value));
  }
  return labels.scope.anyValue;
}

function formatQuorum(
  policy: LexApprovalPolicy,
  labels: WorkflowPolicyLabels,
  f: LexFormatter,
): string {
  if (policy.quorum === "n_of_m") {
    return labels.quorumFormat.nOfM(
      f.formatNumber(policy.quorum_n ?? 1),
      f.formatNumber(policy.approvers.length),
    );
  }
  return labels.quorumLabels[policy.quorum] ?? formatToken(policy.quorum);
}

function formatAnalyticsQuorum(
  policy: LexApprovalPolicyAnalytics["policies"][number],
  labels: WorkflowPolicyLabels,
  f: LexFormatter,
): string {
  if (policy.quorum === "n_of_m") {
    return labels.quorumFormat.nOfRouted(f.formatNumber(policy.quorum_n ?? 1));
  }
  return labels.quorumLabels[policy.quorum] ?? formatToken(policy.quorum);
}

function formatHoursValue(value: number | null | undefined, f?: LexFormatter): string {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  if (value < 1) {
    const minutes = Math.round(value * 60);
    return `${f ? f.formatNumber(minutes) : minutes}m`;
  }
  const hours = value.toFixed(1);
  return `${f ? f.formatNumber(hours) : hours}h`;
}

function formatOptionalNumber(value?: number | null): string {
  return value == null ? "" : String(value);
}

function optionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatCurrency(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : "SAR";
}

function formatToken(value: string): string {
  return value.replace(/_/g, " ");
}
