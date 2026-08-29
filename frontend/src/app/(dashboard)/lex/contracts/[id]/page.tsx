'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarClock,
  CircleDollarSign,
  FileSearch,
  FileCheck2,
  FileText,
  FileUp,
  GitBranch,
  History,
  ListChecks,
  Loader2,
  MoreHorizontal,
  PencilLine,
  PlayCircle,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Trash2,
  UserRound,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import type { StatTone } from '@/components/shared/stat-card';
import { RedlineView } from '@/components/shared/redline-view';
import { DocumentPreviewSheet } from '@/components/shared/document-viewer';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { RelativeTime } from '@/components/shared/relative-time';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useOptimisticMutation } from '@/hooks/use-optimistic-mutation';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import {
  downloadBlob,
  formatBytes,
  formatDateTime,
  formatNumber,
  titleCase,
} from '@/lib/format';
import type { AppLocale } from '@/lib/i18n';
import {
  buildContractRedline,
  extractMatterSummary,
  extractObligationSummaries,
  getRenewalWarning,
  summarizeClauseLibrary,
  WATHEEQ_LIFECYCLE_STAGES,
  type RedlineChunk,
} from '@/lib/lex-watheeq';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { prefillExtractedTextFromFile, resolveUploadExtractedText } from '@/lib/documents/word';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveTimelineEvent } from '../_lib/contract-timeline-i18n';
import { useLexFormat, type LexFormatter } from '@/lib/lex/ksa';
import { LexActivityTimeline, type LexActivityEvent, type LexActivityTone } from '@/components/lex/activity-timeline';
import { LexStatusChip } from '@/components/lex/status-chip';
import { ApplyHoldButton } from '@/components/lex/apply-hold-button';
import { AskForSupportButton } from '@/components/lex/support-composer';
import {
  type ContractDetailLabels,
  useClauseReviewStatusLabels,
  useContractDetailLabels,
  useContractRiskLabels,
  useContractStatusTokenLabels,
  useContractTypeLabels,
} from '../_lib/contracts-labels';
import {
  composeContractExecutiveSummary,
  localizeClauseTypeToken,
  localizeContractBriefRisk,
  localizeContractGeneratedText,
  localizeContractSignal,
  localizeLexRiskFinding,
  localizeRiskLevelToken,
  type ContractValueFormatters,
} from '../_lib/contract-value-localization';
import { deriveRenewalDate } from '../_lib/renewal-date';
import type {
  LexApprovalPolicy,
  LexApprovalPolicyRecommendationResult,
  LexClause,
  LexContractBrief,
  LexContractClassificationResult,
  LexContractRecord,
  LexContractStatus,
  LexContractVersion,
  LexReviewContractRequest,
  LexRiskFinding,
  LexSignatureEnvelope,
  UserDirectoryEntry,
} from '@/types/suites';
import { ContractFormDialog } from '../_components/contract-form-dialog';
import {
  ContractLifecycleStepper,
  type ContractLifecycleStage,
} from './_components/contract-lifecycle-stepper';
import { RenewalAlertBanner } from './_components/renewal-alert-banner';
import { KeyDatesStrip } from './_components/key-dates-strip';
import { ContractRiskPanel } from './_components/contract-risk-panel';
import { RiskFindingsList, type RiskFinding } from './_components/risk-findings-list';
import { ClausesTab } from './_components/clauses/clauses-tab';
import { ComplianceTab } from './_components/compliance/compliance-tab';
import { FinalVersionModal } from './_components/review-desk/final-version-modal';
import { ReviewDeskTab } from './_components/review-desk/review-desk-tab';
import { reviewDeskApi } from './_components/review-desk/review-desk-api';
import { ContractCategorizeForm } from './_components/categorize/contract-categorize-form';
import { useArchiveContract } from '../archived/_lib/use-archived-contracts';

const STATUS_TRANSITIONS: Record<LexContractStatus, LexContractStatus[]> = {
  draft: ['internal_review', 'cancelled'],
  internal_review: ['legal_review', 'draft'],
  legal_review: ['negotiation', 'internal_review', 'draft'],
  negotiation: ['pending_signature', 'cancelled', 'draft'],
  pending_signature: ['cancelled'],
  active: ['suspended', 'terminated', 'expired', 'renewed'],
  suspended: ['active', 'terminated'],
  expired: ['renewed'],
  terminated: [],
  renewed: [],
  cancelled: [],
};

const CONTRACT_TYPES = [
  'service_agreement',
  'nda',
  'employment',
  'vendor',
  'license',
  'lease',
  'partnership',
  'consulting',
  'procurement',
  'sla',
  'mou',
  'amendment',
  'renewal',
  'other',
] as const;

type ContractTab =
  | 'overview'
  | 'details'
  | 'review-desk'
  | 'analysis'
  | 'clauses'
  | 'compliance'
  | 'versions'
  | 'workflow';

const CONTRACT_TABS = new Set<ContractTab>([
  'overview',
  'details',
  'review-desk',
  'analysis',
  'clauses',
  'compliance',
  'versions',
  'workflow',
]);

function contractTab(value: string | null): ContractTab {
  return value && CONTRACT_TABS.has(value as ContractTab) ? (value as ContractTab) : 'overview';
}

type ClauseReviewDraft = {
  notes: string;
  status: LexClause['review_status'];
};

type RenewDraft = {
  changeSummary: string;
  newEffectiveDate: string;
  newExpiryDate: string;
  newValue: string;
};

type ReviewApprovalPolicyMode = 'none' | 'persisted' | 'manual';

type ReviewDraft = {
  approvalPolicyMode: ReviewApprovalPolicyMode;
  approverRole: string;
  approverUserId: string;
  description: string;
  outOfOfficeActive: boolean;
  outOfOfficeDelegateId: string;
  outOfOfficeEndsAt: string;
  outOfOfficeEvidenceId: string;
  outOfOfficeReason: string;
  outOfOfficeStartsAt: string;
  policyCurrency: string;
  policyId: string;
  policyName: string;
  requireAuthorityEvidence: boolean;
  requireBusinessJustification: boolean;
  requireRiskAcceptance: boolean;
  requiredAuthorityAmount: string;
  requiredRole: string;
  selectedApprovalPolicyId: string;
  slaHours: string;
};

const DEFAULT_REVIEW_DRAFT: ReviewDraft = {
  approvalPolicyMode: 'none',
  approverRole: 'legal',
  approverUserId: '',
  description: '',
  outOfOfficeActive: false,
  outOfOfficeDelegateId: '',
  outOfOfficeEndsAt: '',
  outOfOfficeEvidenceId: '',
  outOfOfficeReason: '',
  outOfOfficeStartsAt: '',
  policyCurrency: 'SAR',
  policyId: '',
  policyName: '',
  requireAuthorityEvidence: true,
  requireBusinessJustification: false,
  requireRiskAcceptance: false,
  requiredAuthorityAmount: '',
  requiredRole: '',
  selectedApprovalPolicyId: '',
  slaHours: '48',
};

// Bilingual labels for the compliance-assessment tokens the matter/obligation
// tiles surface (compliant / partially_compliant / non_compliant / not_assessed).
// These are distinct from the contract/obligation lifecycle vocabularies, so the
// chips resolve through the `generic` domain with this resolved map; semantic
// colour stays carried by the tile's own border accent + severity rail.
const COMPLIANCE_STATUS_LABELS: Record<'en' | 'ar', Record<string, string>> = {
  en: {
    compliant: 'Compliant',
    partially_compliant: 'Partially Compliant',
    non_compliant: 'Non-Compliant',
    not_assessed: 'Not Assessed',
  },
  ar: {
    compliant: 'ممتثل',
    partially_compliant: 'ممتثل جزئيًا',
    non_compliant: 'غير ممتثل',
    not_assessed: 'لم يُقيَّم',
  },
};

export default function LexContractDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const queryClient = useQueryClient();
  const { hasPermission, hasAnyPermission, user } = useAuth();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const labels = useContractDetailLabels();
  const statusTokenLabels = useContractStatusTokenLabels();
  const clauseReviewLabels = useClauseReviewStatusLabels();
  const riskTokenLabels = useContractRiskLabels();
  const typeTokenLabels = useContractTypeLabels();
  const complianceStatusLabels = COMPLIANCE_STATUS_LABELS[locale === 'ar' ? 'ar' : 'en'];
  const valueFormatters: ContractValueFormatters = {
    formatDate: f.formatDate,
    formatNumber: (value) => f.formatNumber(value),
  };
  const contractId = params?.id ?? '';
  // §9/§18.4 — operational contract edits gate on the contract edit verb; review
  // submission also admits an add-only creator for their own draft (narrowed
  // against created_by below and again on the server). Destructive delete maps
  // to the close/archive verb. `lex:*` wildcard satisfies these checks.
  const canWrite = hasAnyPermission(['lex:contract:edit', 'lex:write']);
  const canSubmitReviewCapability = hasAnyPermission([
    'lex:contract:add',
    'lex:contract:edit',
  ]);
  const canClose = hasPermission('lex:contract:close');
  // Support requests are raised from the record, not just the inbox/top bar.
  // Same verb the inbox uses for its own "Ask for support" entry point.
  const canAskSupport = hasPermission('lex:support:create');

  const [activeTab, setActiveTab] = useState<ContractTab>(() => contractTab(requestedTab));
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [complianceResult, setComplianceResult] = useState<{
    alerts_created: number;
    calculated_at: string;
    score: number;
  } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [finalVersionOpen, setFinalVersionOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [clauseReviewTarget, setClauseReviewTarget] = useState<LexClause | null>(null);
  const [classificationResult, setClassificationResult] = useState<LexContractClassificationResult | null>(null);

  useEffect(() => {
    setActiveTab(contractTab(requestedTab));
  }, [requestedTab]);

  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!targetId) return;
    requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    });
  }, [activeTab]);

  const contractQuery = useQuery({
    queryKey: ['lex-contract', contractId],
    queryFn: () => enterpriseApi.lex.getContract(contractId),
    enabled: Boolean(contractId),
  });

  const contractBriefQuery = useQuery({
    queryKey: ['lex-contract-brief', contractId],
    queryFn: () => enterpriseApi.lex.getContractBrief(contractId),
    enabled: Boolean(contractId),
  });

  const versionsQuery = useQuery({
    queryKey: ['lex-contract-versions', contractId],
    queryFn: () => enterpriseApi.lex.listContractVersions(contractId),
    enabled: Boolean(contractId),
  });

  const redlineVersionPair = [...(versionsQuery.data ?? [])]
    .sort((left, right) => right.version - left.version)
    .slice(0, 2);

  const redlineQuery = useQuery({
    queryKey: [
      'lex-contract-redline',
      contractId,
      redlineVersionPair[1]?.version ?? null,
      redlineVersionPair[0]?.version ?? null,
    ],
    queryFn: () =>
      enterpriseApi.lex.getContractRedline(contractId, {
        base_version: redlineVersionPair[1]?.version,
        target_version: redlineVersionPair[0]?.version,
      }),
    enabled: Boolean(contractId) && redlineVersionPair.length === 2,
  });

  const signaturesQuery = useQuery({
    queryKey: ['lex-contract-signatures', contractId],
    queryFn: () =>
      enterpriseApi.lex.listSignatures({
        page: 1,
        per_page: 5,
        order: 'desc',
        filters: { contract_id: contractId },
      }),
    enabled: Boolean(contractId),
  });

  const timelineQuery = useQuery({
    queryKey: ['lex-contract-timeline', contractId],
    queryFn: () => enterpriseApi.lex.getContractTimeline(contractId),
    enabled: Boolean(contractId),
  });

  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-contract-review', contractId],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: canSubmitReviewCapability && reviewOpen,
  });

  const approvalPoliciesQuery = useQuery({
    queryKey: ['lex-approval-policies'],
    queryFn: () => enterpriseApi.lex.listApprovalPolicies(),
    enabled: canSubmitReviewCapability && reviewOpen,
  });

  const refreshContract = async () => {
    await Promise.all([
      contractQuery.refetch(),
      contractBriefQuery.refetch(),
      versionsQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['lex-contract-redline', contractId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-contract-signatures', contractId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-contract-timeline', contractId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-signatures'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-contracts'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
    ]);
  };

  const analyzeMutation = useMutation({
    mutationFn: () => enterpriseApi.lex.analyzeContract(contractId),
    onSuccess: async (analysis) => {
      setAnalysisMessage(
        labels.analyzeMessage(analysis.key_findings.length, analysis.compliance_flags.length),
      );
      showSuccess(labels.toast.analyzedTitle, labels.toast.analyzedDescription);
      await refreshContract();
      setActiveTab('analysis');
    },
    onError: showApiError,
  });

  const complianceMutation = useMutation({
    mutationFn: () => enterpriseApi.lex.runCompliance({ contract_ids: [contractId] }),
    onSuccess: async (result) => {
      setComplianceResult({
        alerts_created: result.alerts_created,
        calculated_at: result.calculated_at,
        score: result.score,
      });
      showSuccess(labels.toast.complianceTitle, labels.complianceRun.alertsToast(result.alerts_created));
      await refreshContract();
      setActiveTab('overview');
    },
    onError: showApiError,
  });

  const classifyMutation = useMutation({
    mutationFn: (apply: boolean) => enterpriseApi.lex.classifyContract(contractId, { apply }),
    onSuccess: async (result) => {
      setClassificationResult(result);
      showSuccess(
        result.applied ? labels.toast.classifyAppliedTitle : labels.toast.classifyRecommendedTitle,
        result.applied
          ? labels.toast.classifyAppliedDescription(titleCase(result.applied_type))
          : labels.toast.classifyRecommendedDescription(titleCase(result.recommended_type)),
      );
      if (result.applied) {
        await refreshContract();
      } else {
        await timelineQuery.refetch();
      }
    },
    onError: showApiError,
  });

  const statusMutation = useOptimisticMutation<LexContractStatus>({
    mutationFn: (nextStatus: LexContractStatus) =>
      enterpriseApi.lex.updateContractStatus(contractId, { status: nextStatus }),
    queryKeys: [['lex-contract', contractId]],
    applyOptimistic: (prev, nextStatus) => {
      if (!prev || typeof prev !== 'object' || !('contract' in prev)) {
        return prev;
      }
      const detailPrev = prev as { contract: LexContractRecord };
      return {
        ...detailPrev,
        contract: { ...detailPrev.contract, status: nextStatus },
      };
    },
    onSuccess: async () => {
      showSuccess(labels.toast.statusUpdatedTitle, labels.toast.statusUpdatedDescription);
      await refreshContract();
      setStatusOpen(false);
    },
    onError: showApiError,
  });

  const renewMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      enterpriseApi.lex.renewContract(contractId, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.renewedTitle, labels.toast.renewedDescription);
      await refreshContract();
      setRenewOpen(false);
    },
    onError: showApiError,
  });

  const reviewMutation = useMutation({
    mutationFn: (payload: LexReviewContractRequest) =>
      enterpriseApi.lex.startContractReview(contractId, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.reviewStartedTitle, labels.toast.reviewStartedDescription);
      await refreshContract();
      setReviewOpen(false);
      setActiveTab('workflow');
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: () => enterpriseApi.lex.deleteContract(contractId),
    onSuccess: async () => {
      showSuccess(labels.toast.deletedTitle, labels.toast.deletedDescription);
      await queryClient.invalidateQueries({ queryKey: ['lex-contracts'] });
      router.push('/lex/contracts');
    },
    onError: showApiError,
  });

  // CAP-122 — archive lifecycle. Reuses the archived-contracts data layer's
  // useArchiveContract mutation (POST /contracts/{id}/archive) that was
  // previously unwired. Archiving removes the contract from the active register,
  // so on success we invalidate the active list and route to the archive view.
  const archiveContract = useArchiveContract();
  const archiveMutation = useMutation({
    mutationFn: (reason: string) =>
      archiveContract.mutateAsync({ contractId, reason: reason.trim() || undefined }),
    onSuccess: async () => {
      showSuccess(
        locale === 'ar' ? 'تمت أرشفة العقد.' : 'Contract archived.',
        locale === 'ar'
          ? 'تم نقل العقد إلى الأرشيف.'
          : 'The contract has been moved to the archive.',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-contracts'] }),
        queryClient.invalidateQueries({ queryKey: ['lex', 'contracts', 'archived'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
      ]);
      setArchiveOpen(false);
      setArchiveReason('');
      router.push('/lex/contracts/archived');
    },
    onError: showApiError,
  });

  const clauseReviewMutation = useMutation({
    mutationFn: ({ clauseId, notes, status }: { clauseId: string; notes: string; status: LexClause['review_status'] }) =>
      enterpriseApi.lex.updateClauseReview(contractId, clauseId, { status, notes }),
    onSuccess: async () => {
      showSuccess(labels.toast.clauseSavedTitle, labels.toast.clauseSavedDescription);
      await refreshContract();
      setClauseReviewTarget(null);
    },
    onError: showApiError,
  });

  const sendSignatureMutation = useMutation({
    mutationFn: (signatureId: string) => enterpriseApi.lex.sendSignature(signatureId),
    onSuccess: async () => {
      showSuccess(labels.toast.signatureSentTitle, labels.toast.signatureSentDescription);
      await refreshContract();
    },
    onError: showApiError,
  });

  const cancelSignatureMutation = useMutation({
    mutationFn: (signatureId: string) =>
      enterpriseApi.lex.cancelSignature(signatureId, { reason: 'Cancelled from contract detail' }),
    onSuccess: async () => {
      showSuccess(labels.toast.signatureCancelledTitle, labels.toast.signatureCancelledDescription);
      await refreshContract();
    },
    onError: showApiError,
  });

  if (contractQuery.isLoading) {
    return (
      <LexRouteGuard route="/lex/contracts/[id]">
        <div dir={direction} lang={locale} className="space-y-6">
          <PageHeader title={labels.loadingTitle} description={labels.loadingDescription} />
          {/* #8: structural loading shell so independent sections stream into a familiar layout. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <LoadingSkeleton variant="card" count={4} />
          </div>
          <SectionCard title={labels.keyDates.title} description={labels.keyDates.description}>
            <LoadingSkeleton variant="list-item" count={1} />
          </SectionCard>
          <SectionCard title={labels.stepper.title} description={labels.stepper.description}>
            <LoadingSkeleton variant="list-item" count={1} />
          </SectionCard>
          <SectionCard title={labels.brief.title} description={labels.brief.description}>
            <LoadingSkeleton variant="list-item" count={3} />
          </SectionCard>
        </div>
      </LexRouteGuard>
    );
  }

  if (contractQuery.isError || !contractQuery.data) {
    return (
      <LexRouteGuard route="/lex/contracts/[id]">
        <div dir={direction} lang={locale} className="space-y-6">
          <PageHeader title={labels.errorTitle} description={labels.fallbackDescription} />
          <ErrorState message={labels.errorDescription} onRetry={() => void contractQuery.refetch()} />
        </div>
      </LexRouteGuard>
    );
  }

  const detail = contractQuery.data;
  const contract = detail.contract;
  const contractDuration = computeContractDuration(contract.effective_date, contract.expiry_date);
  const derivedRenewalDate = deriveRenewalDate(
    contract.expiry_date,
    contract.renewal_notice_days,
  );
  const canSubmitReview =
    canWrite ||
    (canSubmitReviewCapability &&
      contract.status === 'draft' &&
      Boolean(user?.id) &&
      contract.created_by === user?.id);
  const contractBrief = contractBriefQuery.data ?? null;
  const clauses = detail.clauses;
  const latestAnalysis = detail.latest_analysis ?? null;
  const versions = [...(versionsQuery.data ?? [])].sort((left, right) => right.version - left.version);
  const allowedStatuses = STATUS_TRANSITIONS[contract.status] ?? [];
  const latestVersion = versions[0] ?? null;
  const previousVersion = versions[1] ?? null;
  const users = usersQuery.data?.data ?? [];
  const activeApprovalPolicies = (approvalPoliciesQuery.data ?? []).filter((policy) => policy.status === 'active');
  const matter = extractMatterSummary(contract);
  const obligations = extractObligationSummaries(contract);
  const signatures = signaturesQuery.data?.data ?? [];
  const latestSignature = signatures[0] ?? null;
  const timeline = timelineQuery.data ?? null;
  // #29: project the raw contract timeline into the shared activity-story feed
  // (actor attribution + tone-coloured rail, grouped by day, Hijri/Arabic-Indic
  // in ar mode). Tone is derived from the event type so lifecycle, analysis and
  // risk events read at a glance.
  const systemActor = locale === 'ar' ? 'النظام' : 'System';
  // Timeline titles/descriptions are pre-rendered Arabic-only by the backend;
  // resolve them from event_type + metadata so they follow the active locale.
  const activityEvents: LexActivityEvent[] = (timeline?.events ?? []).map((event) => {
    const resolved = resolveTimelineEvent(event, locale);
    return {
      id: event.id,
      actor: { name: resolved.actor ?? systemActor },
      action: resolved.title,
      target: resolved.description || undefined,
      at: event.occurred_at,
      tone: timelineEventTone(event.event_type),
      detail: event.source ? formatToken(event.source) : undefined,
    };
  });
  const renewalWarning = getRenewalWarning(contract, undefined, locale);
  const clauseLibrary = summarizeClauseLibrary(clauses);
  const classification = classificationResult ?? readStoredClassification(contract);
  const redlineChunks: RedlineChunk[] =
    redlineQuery.data?.segments.map<RedlineChunk>((segment) => ({
      type: segment.operation === 'equal' ? 'unchanged' : segment.operation,
      text: segment.text,
    })) ?? buildContractRedline(previousVersion, latestVersion);
  const activeStageIndex = WATHEEQ_LIFECYCLE_STAGES.indexOf(contract.status);
  const lifecycleStages: ContractLifecycleStage[] = WATHEEQ_LIFECYCLE_STAGES.map((stage) => ({
    key: stage,
    label: statusTokenLabels[stage] ?? titleCase(stage),
  }));
  const latestVersionText = latestVersion?.extracted_text ?? '';
  const prevVersionText = previousVersion?.extracted_text ?? '';
  const hasRedlineText = Boolean(latestVersionText) && Boolean(prevVersionText);

  // Renewal banner mapping (#2) — renewal currently surfaces overdue/notice-window state.
  const renewalOverdueDays =
    renewalWarning.level === 'overdue' ? Math.abs(renewalWarning.daysUntil ?? 0) : undefined;
  const renewalUpcomingDays =
    renewalWarning.level === 'warning' || renewalWarning.level === 'urgent'
      ? renewalWarning.daysUntil ?? undefined
      : undefined;

  // Single authoritative risk posture (#6) — prefer the latest analysis, fall back to contract.
  const riskScore = latestAnalysis?.risk_score ?? contract.risk_score ?? null;
  const riskSeverity = latestAnalysis?.overall_risk ?? contract.risk_level;
  const rawRiskSummary =
    latestAnalysis?.recommendations?.[0] ??
    contractBrief?.risk_summary ??
    (latestAnalysis ? undefined : labels.riskPanel.summaryFallback);
  const riskSummary = localizeContractGeneratedText(
    rawRiskSummary,
    locale,
    riskTokenLabels,
    valueFormatters,
  );

  // Actionable findings (#3) — fold key findings + missing clauses into one CTA list.
  const riskFindings: RiskFinding[] = [
    ...(latestAnalysis?.key_findings ?? []).map<RiskFinding>((finding: LexRiskFinding) => {
      const localized = localizeLexRiskFinding(
        finding,
        locale,
        riskTokenLabels,
        valueFormatters,
      );
      return {
        title: localized.title,
        severity: localized.severity,
        severityLabel: localizeRiskLevelToken(localized.severity, locale, riskTokenLabels),
        recommendation: localized.recommendation,
        description: localized.description,
        clauseType: localized.clause_type ?? undefined,
        id: localized.clause_reference ?? `${localized.title}-${localized.severity}`,
      };
    }),
    ...(latestAnalysis?.missing_clauses ?? []).map<RiskFinding>((clauseType) => ({
      title: labels.analysis.missingClauses + ': ' + localizeClauseTypeToken(clauseType, locale),
      severity: 'medium',
      severityLabel: localizeRiskLevelToken('medium', locale, riskTokenLabels),
      recommendation: labels.findings.description,
      clauseType,
      id: `missing-${clauseType}`,
    })),
  ];

  // #24/25: KSA-aware date + SAR helpers bound to the active locale. Arabic mode
  // renders the Umm al-Qura Hijri calendar and Arabic-Indic digits; English mode
  // is a Gregorian no-op. Used for the in-body metadata / value displays.
  const fmtDateTime = (value: string | null | undefined, fallback: string): string =>
    value
      ? f.formatDate(value, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : fallback;
  const fmtValue = (
    amount: number | null | undefined,
    currency: string | null | undefined,
    fallback: string,
  ): string =>
    amount != null ? f.formatCurrency(amount, { currency: currency ?? 'SAR' }) : fallback;

  const openContractTabAt = (tab: ContractTab, targetId: string) => {
    setActiveTab(tab);
    requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const exportContractSummary = () => {
    const ef = labels.exportFields;
    const rows = [
      [ef.field, ef.value],
      [ef.title, contract.title],
      [ef.status, contract.status],
      [ef.type, contract.type],
      [ef.owner, contract.owner_name],
      [ef.legalReviewer, contract.legal_reviewer_name ?? ''],
      [ef.counterparty, contract.party_b_name],
      [ef.riskLevel, contract.risk_level],
      [ef.riskScore, contract.risk_score == null ? '' : String(contract.risk_score)],
      [ef.renewalWarning, renewalWarning.label],
      [ef.matter, matter?.title ?? ''],
      [ef.obligations, String(obligations.length)],
      [ef.clauses, String(clauses.length)],
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `watheeq-contract-${contract.id}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };
  const lifecycleWorkspaceLabels =
    locale === 'ar'
      ? {
          draft: 'تحرير المسودة',
          negotiation: 'مقارنة النسخ',
          signature: 'متابعة التوقيع',
          approval: 'مساحة الاعتماد',
        }
      : {
          draft: 'Edit draft',
          negotiation: 'Compare versions',
          signature: 'Track signatures',
          approval: 'Approval workspace',
        };

  return (
    <LexRouteGuard route="/lex/contracts/[id]">
      <div id="contract-record-detail" dir={direction} lang={locale} className="scroll-mt-24 space-y-6">
        <PageHeader
          title={contract.title}
          description={contract.description || labels.fallbackDescription}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {/* #10: a few primary actions in the header; secondary ones move to the More menu. */}
              {canWrite ? (
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <PencilLine className="me-1.5 h-3.5 w-3.5" />
                  {labels.actions.edit}
                </Button>
              ) : null}
              <Button variant="outline" asChild>
                <Link href={`/lex/contracts/${contract.id}/approval`}>
                  <ShieldCheck className="me-1.5 h-3.5 w-3.5" />
                  {lifecycleWorkspaceLabels.approval}
                </Link>
              </Button>
              {/* FR-WATHEEQ-005: in-context legal hold. Self-gates on lex:write. */}
              <ApplyHoldButton subjectType="contract" subjectId={contract.id} subjectLabel={contract.title} />
              {/*
                Context is passed EXPLICITLY rather than derived from the URL so
                the nested lifecycle routes (draft / negotiation / signature /
                approval) bind to this contract too.
              */}
              {canAskSupport ? (
                <AskForSupportButton context={{ subjectType: 'contract', subjectId: contract.id }} />
              ) : null}
              <div className="flex flex-col items-end gap-1">
                <Button
                  onClick={() => void complianceMutation.mutate()}
                  disabled={complianceMutation.isPending}
                >
                  {complianceMutation.isPending ? (
                    <RefreshCw className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="me-1.5 h-3.5 w-3.5" />
                  )}
                  {labels.actions.runCompliance}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {complianceResult
                    ? labels.lastCompliance.lastRun(
                        f.formatNumber(complianceResult.score),
                        f.formatDual(complianceResult.calculated_at),
                      )
                    : labels.lastCompliance.pending}
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={labels.moreMenu.label}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>{labels.moreMenu.label}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {canWrite ? (
                    <DropdownMenuItem asChild>
                      <Link href={`/lex/contracts/${contract.id}/draft`}>
                        <PencilLine className="me-2 h-4 w-4" />
                        {lifecycleWorkspaceLabels.draft}
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem asChild>
                    <Link href={`/lex/contracts/${contract.id}/negotiation`}>
                      <GitBranch className="me-2 h-4 w-4" />
                      {lifecycleWorkspaceLabels.negotiation}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/lex/contracts/${contract.id}/signature`}>
                      <FileCheck2 className="me-2 h-4 w-4" />
                      {lifecycleWorkspaceLabels.signature}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/lex/contracts/${contract.id}/approval`}>
                      <ShieldCheck className="me-2 h-4 w-4" />
                      {lifecycleWorkspaceLabels.approval}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={analyzeMutation.isPending}
                    onSelect={(event) => {
                      event.preventDefault();
                      void analyzeMutation.mutate();
                    }}
                  >
                    {analyzeMutation.isPending ? (
                      <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileSearch className="me-2 h-4 w-4" />
                    )}
                    {labels.actions.analyze}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => exportContractSummary()}>
                    <FileText className="me-2 h-4 w-4" />
                    {labels.actions.exportSummary}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />

        {/* #7: hero band — a flat solid token card that surfaces the contract's
            identity + key facts so the most-scanned values (status, value, risk,
            expiry) read instantly. KSA-formatted (Hijri + SAR + Arabic-Indic
            in ar mode). */}
        <ContractHeroBand
          contract={contract}
          statusLabels={statusTokenLabels}
          riskSeverity={riskSeverity}
          riskLabel={riskTokenLabels[riskSeverity] ?? titleCase(String(riskSeverity))}
          riskScore={riskScore}
          f={f}
          labels={labels}
          typeLabel={typeTokenLabels[contract.type] ?? titleCase(contract.type)}
        />

        {/* #2: prominent renewal alert (only renders when overdue / within notice window). */}
        <RenewalAlertBanner
          renewalDate={renewalWarning.anchorDate}
          daysOverdue={renewalOverdueDays}
          daysUntil={renewalUpcomingDays}
          onRenewHref="#lifecycle-actions"
        />

        {/* #6: risk is no longer duplicated here — see the authoritative ContractRiskPanel below. */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <MetricCard
            label={labels.metrics.status}
            href={`/lex/contracts/${contract.id}?tab=overview#contract-lifecycle`}
            value={
              <LexStatusChip
                domain="contract"
                value={contract.status}
                labels={statusTokenLabels}
              />
            }
          />
          <MetricCard
            label={labels.metrics.version}
            href={`/lex/contracts/${contract.id}?tab=versions#contract-versions`}
            value={`v${contract.current_version}`}
            helper={labels.metrics.recordedVersions(detail.version_count)}
          />
          <MetricCard
            label={labels.metrics.workflow}
            href={`/lex/contracts/${contract.id}?tab=workflow#contract-workflow`}
            value={contract.workflow_instance_id ? labels.metrics.activeReview : labels.metrics.noWorkflow}
            helper={
              contract.workflow_instance_id
                ? labels.metrics.instancePrefix(contract.workflow_instance_id.slice(0, 8))
                : labels.metrics.reviewNotStarted
            }
          />
        </div>

        {/* #7: key dates countdown strip near the top. */}
        <SectionCard title={labels.keyDates.title} description={labels.keyDates.description}>
          <KeyDatesStrip
            effective={contract.effective_date}
            renewal={contract.renewal_date}
            expiry={contract.expiry_date}
            autoRenew={contract.auto_renew}
            noticeDays={contract.renewal_notice_days}
            overdue={renewalWarning.level === 'overdue'}
          />
        </SectionCard>

        {/* #1: connected lifecycle stepper (replaces the misleading 1-6 ordinal grid). */}
        <div id="contract-lifecycle" className="scroll-mt-24">
          <SectionCard title={labels.stepper.title} description={labels.stepper.description}>
            <ContractLifecycleStepper
              stages={lifecycleStages}
              currentIndex={activeStageIndex}
              ariaLabel={labels.stepper.ariaLabel}
            />
          </SectionCard>
        </div>

        <ContractBriefPanel
          brief={contractBrief}
          loading={contractBriefQuery.isLoading}
          error={contractBriefQuery.isError}
          onRetry={() => void contractBriefQuery.refetch()}
          labels={labels}
          f={f}
          locale={locale}
          riskLabels={riskTokenLabels}
        />

        {analysisMessage ? (
          <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
            {analysisMessage}
          </div>
        ) : null}

        {classificationResult ? (
          <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
            {labels.classificationBanner(
              classificationResult.applied ? labels.appliedLabel : labels.recommendedLabel,
              titleCase(classificationResult.recommended_type),
              Math.round(classificationResult.confidence * 100),
            )}
          </div>
        ) : null}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ContractTab)}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="overview">{labels.tabs.overview}</TabsTrigger>
            <TabsTrigger value="details">{labels.tabs.details}</TabsTrigger>
            <TabsTrigger value="review-desk">
              {locale === 'ar' ? 'مكتب المراجعة' : 'Review Desk'}
            </TabsTrigger>
            <TabsTrigger value="analysis">{labels.tabs.analysis}</TabsTrigger>
            <TabsTrigger value="clauses">{locale === 'ar' ? 'البنود' : 'Clauses'}</TabsTrigger>
            <TabsTrigger value="compliance">{locale === 'ar' ? 'الامتثال' : 'Compliance'}</TabsTrigger>
            <TabsTrigger value="versions">{labels.tabs.versions}</TabsTrigger>
            <TabsTrigger value="workflow">{labels.tabs.workflow}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {/* #6 + #3: one authoritative risk panel beside the actionable findings list. */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                <ContractRiskPanel
                  score={riskScore}
                  severity={riskSeverity}
                  severityLabel={riskTokenLabels[riskSeverity] ?? titleCase(String(riskSeverity))}
                  labels={labels.riskPanel}
                  summary={riskSummary}
                  clausesReviewed={latestAnalysis?.clause_count}
                  missingClauses={latestAnalysis?.missing_clauses.length}
                  complianceFlags={latestAnalysis?.compliance_flags.length}
                  onOpenScore={() => openContractTabAt('analysis', 'contract-analysis-risk-summary')}
                  onOpenClauses={() => openContractTabAt('analysis', 'contract-analysis-risk-summary')}
                  onOpenMissingClauses={() => openContractTabAt('analysis', 'contract-analysis-flags')}
                  onOpenComplianceFlags={() => openContractTabAt('analysis', 'contract-analysis-flags')}
                />
                <LifecycleActionsCard
                  contract={contract}
                  canWrite={canWrite}
                  canSubmitReview={canSubmitReview}
                  canClose={canClose}
                  allowedStatuses={allowedStatuses}
                  hasLatestVersion={Boolean(latestVersion)}
                  deletePending={deleteMutation.isPending}
                  archivePending={archiveMutation.isPending}
                  renewActive={renewalWarning.level === 'overdue' || renewalWarning.level === 'urgent' || renewalWarning.level === 'warning'}
                  onChangeStatus={() => setStatusOpen(true)}
                  onStartReview={() => setReviewOpen(true)}
                  onRenew={() => setRenewOpen(true)}
                  onUpload={() => setUploadOpen(true)}
                  onPreview={() => setPreviewOpen(true)}
                  onDelete={() => setDeleteOpen(true)}
                  onArchive={() => setArchiveOpen(true)}
                  labels={labels}
                />
              </div>

              <SectionCard title={labels.findings.title} description={labels.findings.description}>
                {contractQuery.isFetching && !latestAnalysis ? (
                  <LoadingSkeleton variant="list-item" count={3} />
                ) : (
                  <RiskFindingsList
                    findings={riskFindings}
                    contractId={contract.id}
                    onView={() => setActiveTab('analysis')}
                    emptyLabel={labels.findings.empty}
                    labels={{
                      recommendationPrefix: labels.findings.recommendationPrefix,
                      addClause: labels.findings.addClause,
                      draftWithAi: labels.findings.draftWithAi,
                      view: labels.findings.view,
                    }}
                  />
                )}
              </SectionCard>
            </div>

            <SectionCard
              title={labels.signature.title}
              description={labels.signature.description}
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/lex/signatures?contract_id=${contract.id}`}>{labels.signature.viewQueue}</Link>
                </Button>
              }
            >
              {signaturesQuery.isLoading ? (
                <LoadingSkeleton variant="list-item" count={2} />
              ) : signaturesQuery.isError ? (
                <ErrorState
                  message={labels.signature.loadError}
                  onRetry={() => void signaturesQuery.refetch()}
                />
              ) : latestSignature ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <MetricCard
                      label={labels.signature.latestEnvelope}
                      href={`/lex/signatures?contract_id=${contract.id}`}
                      value={<LexStatusChip domain="signature" value={latestSignature.status} size="sm" />}
                      helper={latestSignature.title}
                    />
                    <MetricCard
                      label={labels.signature.recipients}
                      href={`/lex/signatures?contract_id=${contract.id}`}
                      value={signatureProgress(latestSignature, labels)}
                      helper={latestSignature.provider ? titleCase(latestSignature.provider) : labels.signature.providerNotSet}
                    />
                    <MetricCard
                      label={labels.signature.deadline}
                      href={`/lex/signatures?contract_id=${contract.id}`}
                      value={formatOptionalDate(latestSignature.due_at ?? latestSignature.expires_at, labels.metadata.notSet)}
                      helper={
                        latestSignature.sent_at
                          ? labels.signature.sentPrefix(formatDateTime(latestSignature.sent_at))
                          : labels.signature.notSent
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    {signatures.map((signature) => (
                      <div key={signature.id} className="rounded-lg border px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium">{signature.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {signatureProgress(signature, labels)} •{' '}
                              {signature.updated_at ? formatDateTime(signature.updated_at) : labels.signature.noUpdateTimestamp}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <LexStatusChip domain="signature" value={signature.status} size="sm" />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void sendSignatureMutation.mutate(signature.id)}
                              disabled={!canWrite || !canSendSignature(signature.status) || sendSignatureMutation.isPending}
                            >
                              <Send className="me-1.5 h-3.5 w-3.5" />
                              {labels.signature.send}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void cancelSignatureMutation.mutate(signature.id)}
                              disabled={!canWrite || !canCancelSignature(signature.status) || cancelSignatureMutation.isPending}
                            >
                              <XCircle className="me-1.5 h-3.5 w-3.5" />
                              {labels.signature.cancel}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={FileCheck2}
                  title={labels.signature.emptyTitle}
                  description={labels.signature.emptyDescription}
                />
              )}
            </SectionCard>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
              <SectionCard title={labels.matterLink.title} description={labels.matterLink.description}>
                {matter ? (
                  <div className="space-y-3">
                    <MetadataRow label={labels.matterLink.matter} value={matter.title} />
                    <MetadataRow label={labels.matterLink.matterId} value={matter.id ?? labels.matterLink.notSet} />
                    <MetadataRow
                      label={labels.matterLink.status}
                      value={
                        <LexStatusChip
                          domain="generic"
                          value={matter.status}
                          labels={complianceStatusLabels}
                          size="sm"
                        />
                      }
                    />
                    <MetadataRow label={labels.matterLink.owner} value={matter.owner ?? contract.owner_name} />
                    <MetadataRow
                      label={labels.matterLink.priority}
                      value={matter.priority ? titleCase(matter.priority) : labels.matterLink.notSet}
                    />
                  </div>
                ) : (
                  // #5: compact empty state with a direct CTA instead of a tall empty card.
                  <CompactEmpty
                    icon={BriefcaseBusiness}
                    title={labels.matterLink.emptyTitle}
                    description={labels.matterLink.emptyDescription}
                    cta={canWrite ? { label: labels.actions.edit, onClick: () => setEditOpen(true) } : undefined}
                  />
                )}
              </SectionCard>

              <SectionCard title={labels.obligations.title} description={labels.obligations.description}>
                <div className="space-y-3">
                  {obligations.length === 0 ? (
                    // #5: compact empty state with a direct CTA instead of a tall empty card.
                    <CompactEmpty
                      icon={ListChecks}
                      title={labels.obligations.emptyTitle}
                      description={labels.obligations.emptyDescription}
                      cta={canWrite ? { label: labels.actions.edit, onClick: () => setEditOpen(true) } : undefined}
                    />
                  ) : (
                    obligations.map((obligation) => (
                      <div
                        key={obligation.id ?? obligation.title}
                        className={`rounded-lg border px-4 py-3 ${obligationToneAccent(obligation.status)}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{obligation.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {obligation.owner ?? labels.obligations.unassigned} •{' '}
                              {obligation.dueDate
                                ? formatOptionalDate(obligation.dueDate, labels.metadata.notSet)
                                : labels.obligations.noDueDate}
                            </p>
                          </div>
                          <LexStatusChip
                            domain="generic"
                            value={obligation.status}
                            labels={complianceStatusLabels}
                            size="sm"
                          />
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <CalendarClock className="h-3.5 w-3.5" />
                          <span>
                            {obligation.reminderDays != null
                              ? labels.obligations.reminderConfigured(obligation.reminderDays)
                              : labels.obligations.reminderNotConfigured}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </SectionCard>
            </div>

            {complianceResult ? (
              <SectionCard title={labels.complianceRun.title} description={labels.complianceRun.description}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <MetricCard
                    tone={complianceResult.score >= 70 ? 'emerald' : 'rose'}
                    icon={ShieldCheck}
                    label={labels.complianceRun.score}
                    href={`/lex/contracts/${contract.id}?tab=compliance#contract-compliance`}
                    value={`${f.formatNumber(complianceResult.score)}%`}
                  />
                  <MetricCard tone="teal" label={labels.complianceRun.alertsCreated} href={`/lex/contracts/${contract.id}?tab=compliance#contract-compliance`} value={f.formatNumber(complianceResult.alerts_created)} />
                  <MetricCard tone="gold" icon={CalendarClock} label={labels.complianceRun.calculatedAt} href={`/lex/contracts/${contract.id}?tab=compliance#contract-compliance`} value={f.formatDual(complianceResult.calculated_at)} />
                </div>
              </SectionCard>
            ) : null}
          </TabsContent>

          {/* #9: reference detail moved off the Overview tab into a dedicated Details tab. */}
          <TabsContent value="details" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div id="contract-metadata" className="scroll-mt-24">
                <SectionCard title={labels.metadata.title} description={labels.metadata.description}>
                <div className="space-y-3">
                  <MetadataRow
                    label={labels.metadata.contractNumber}
                    value={contract.contract_number ?? labels.metadata.autoGenerated}
                  />
                  <MetadataRow label={labels.metadata.type} value={typeTokenLabels[contract.type] ?? titleCase(contract.type)} />
                  <MetadataRow label={labels.metadata.owner} value={contract.owner_name} />
                  <MetadataRow
                    label={labels.metadata.legalReviewer}
                    value={contract.legal_reviewer_name ?? labels.metadata.unassigned}
                  />
                  <MetadataRow
                    label={labels.metadata.department}
                    value={contract.department ?? labels.metadata.notSet}
                  />
                  <MetadataRow
                    label={labels.metadata.effectiveDate}
                    value={fmtDateTime(contract.effective_date, labels.metadata.notSet)}
                  />
                  <MetadataRow
                    label={labels.metadata.expiryDate}
                    value={fmtDateTime(contract.expiry_date, labels.metadata.notSet)}
                  />
                  <MetadataRow
                    label={labels.metadata.duration}
                    value={
                      contractDuration
                        ? labels.metadata.durationValue(contractDuration.months, contractDuration.days)
                        : labels.metadata.durationNotSet
                    }
                  />
                  <MetadataRow
                    label={labels.metadata.renewalDate}
                    value={
                      // Contracts predating the derived form field carry no
                      // `renewal_date`; fall back to `expiry - notice` rather
                      // than reading "Not set" on a contract that renews.
                      contract.renewal_date
                        ? fmtDateTime(contract.renewal_date, labels.metadata.notSet)
                        : contract.auto_renew && derivedRenewalDate
                          ? labels.metadata.renewalCalculated(
                              fmtDateTime(derivedRenewalDate.toISOString(), labels.metadata.notSet),
                            )
                          : labels.metadata.notSet
                    }
                  />
                  <MetadataRow
                    label={labels.metadata.autoRenew}
                    value={
                      contract.auto_renew
                        ? labels.metadata.autoRenewOn(contract.renewal_notice_days ?? 0)
                        : labels.metadata.autoRenewOff
                    }
                  />
                  <MetadataRow
                    label={labels.metadata.renewalWarning}
                    value={
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={renewalWarning.level === 'urgent' || renewalWarning.level === 'overdue' ? 'destructive' : renewalWarning.level === 'warning' ? 'warning' : 'outline'}>
                          {renewalWarning.label}
                        </Badge>
                        {renewalWarning.anchorDate ? (
                          <span className="text-muted-foreground">
                            {fmtDateTime(renewalWarning.anchorDate, labels.metadata.notSet)}
                          </span>
                        ) : null}
                      </div>
                    }
                  />
                  <MetadataRow
                    label={labels.metadata.paymentTerms}
                    value={contract.payment_terms ?? labels.metadata.notSet}
                  />
                  <MetadataRow
                    label={labels.metadata.tags}
                    value={
                      contract.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {contract.tags.map((tag) => (
                            <Badge key={tag} variant="outline">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        labels.metadata.noTags
                      )
                    }
                  />
                </div>
                </SectionCard>
              </div>

              <SectionCard title={labels.parties.title} description={labels.parties.description}>
                <div className="space-y-3">
                  <MetadataRow label={labels.parties.partyA} value={contract.party_a_name} />
                  <MetadataRow label={labels.parties.partyAEntity} value={contract.party_a_entity ?? labels.parties.notSet} />
                  <MetadataRow label={labels.parties.counterparty} value={contract.party_b_name} />
                  <MetadataRow
                    label={labels.parties.counterpartyEntity}
                    value={contract.party_b_entity ?? labels.parties.notSet}
                  />
                  <MetadataRow
                    label={labels.parties.counterpartyContact}
                    value={contract.party_b_contact ?? labels.parties.notSet}
                  />
                  <MetadataRow
                    label={labels.parties.totalValue}
                    value={
                      <span className="tabular-nums">
                        {fmtValue(contract.total_value, contract.currency, labels.parties.undisclosed)}
                      </span>
                    }
                  />
                </div>
              </SectionCard>
            </div>

            <div id="contract-classification" className="scroll-mt-24">
              <SectionCard
                title={labels.classification.title}
                description={labels.classification.description}
                actions={
                canWrite ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void classifyMutation.mutate(false)}
                      disabled={classifyMutation.isPending}
                    >
                      {classifyMutation.isPending ? (
                        <RefreshCw className="me-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Tags className="me-1.5 h-3.5 w-3.5" />
                      )}
                      {labels.classification.recommend}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void classifyMutation.mutate(true)}
                      disabled={classifyMutation.isPending}
                    >
                      {labels.classification.apply}
                    </Button>
                  </div>
                ) : undefined
              }
              >
              {classification ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <MetricCard
                    label={labels.classification.recommended}
                    href={`/lex/contracts/${contract.id}?tab=details#contract-classification`}
                    value={titleCase(classification.recommended_type)}
                    helper={labels.classification.confidence(Math.round(classification.confidence * 100))}
                  />
                  <MetricCard
                    label={labels.classification.applied}
                    href={`/lex/contracts/${contract.id}?tab=details#contract-classification`}
                    value={
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{titleCase(classification.applied_type)}</span>
                        <Badge variant={classification.applied ? 'success' : 'outline'}>
                          {classification.applied
                            ? labels.classification.appliedBadge
                            : labels.classification.previewBadge}
                        </Badge>
                      </div>
                    }
                    helper={labels.classification.previousPrefix(titleCase(classification.previous_type))}
                  />
                  <MetricCard
                    label={labels.classification.classifiedAt}
                    href={`/lex/contracts/${contract.id}?tab=details#contract-classification`}
                    value={formatDateTime(classification.classified_at)}
                    helper={
                      classification.matched_terms.length > 0
                        ? classification.matched_terms.slice(0, 3).join('، ')
                        : labels.classification.noMatchedTerms
                    }
                  />
                  <div className="md:col-span-3">
                    <p className="text-sm text-muted-foreground">{classification.rationale}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">{labels.classification.emptyDescription}</p>
                  <Badge variant="outline">{labels.classification.currentTypePrefix(typeTokenLabels[contract.type] ?? titleCase(contract.type))}</Badge>
                </div>
              )}
              </SectionCard>
            </div>

            <SectionCard title={labels.documentContext.title} description={labels.documentContext.description}>
              <div className="space-y-3">
                <MetadataRow
                  label={labels.documentContext.latestVersion}
                  value={
                    latestVersion
                      ? `v${latestVersion.version} • ${latestVersion.file_name}`
                      : labels.documentContext.noUploadedVersions
                  }
                />
                <MetadataRow
                  label={labels.documentContext.latestUpload}
                  value={
                    latestVersion ? (
                      <div className="flex items-center gap-2">
                        <span>{f.formatDual(latestVersion.uploaded_at)}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void downloadVersion(latestVersion)}
                        >
                          {labels.documentContext.download}
                        </Button>
                      </div>
                    ) : (
                      labels.documentContext.noFileAvailable
                    )
                  }
                />
                <MetadataRow
                  label={labels.documentContext.workflowInstance}
                  value={
                    contract.workflow_instance_id ? (
                      <Link
                        href={`/workflows/${contract.workflow_instance_id}`}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {contract.workflow_instance_id}
                        <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
                      </Link>
                    ) : (
                      labels.documentContext.notLinked
                    )
                  }
                />
                <MetadataRow
                  label={labels.documentContext.lastAnalyzed}
                  value={
                    contract.last_analyzed_at ? (
                      <RelativeTime date={contract.last_analyzed_at} />
                    ) : (
                      labels.documentContext.notAnalyzed
                    )
                  }
                />
                <MetadataRow
                  label={labels.documentContext.analysisStatus}
                  value={titleCase(contract.analysis_status)}
                />
              </div>
            </SectionCard>
            <ContractCategorizeForm
              contractId={contractId}
              contractTags={contract.tags}
              canWrite={canWrite}
              onCategorized={refreshContract}
            />
          </TabsContent>

          <TabsContent value="review-desk" className="space-y-4">
            <ReviewDeskTab contractId={contractId} canPrepare={canSubmitReview} />
          </TabsContent>

          <TabsContent value="analysis" className="space-y-4">
            {latestAnalysis ? (
              <>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
                  <div id="contract-analysis-risk-summary" className="scroll-mt-24">
                    <SectionCard title={labels.analysis.riskSummaryTitle} description={labels.analysis.riskSummaryDescription}>
                    <div className="space-y-3">
                      <MetadataRow
                        label={labels.analysis.overallRisk}
                        value={localizeRiskLevelToken(latestAnalysis.overall_risk, locale, riskTokenLabels)}
                      />
                      <MetadataRow label={labels.analysis.riskScore} value={f.formatNumber(latestAnalysis.risk_score)} />
                      <MetadataRow label={labels.analysis.clauseCount} value={f.formatNumber(latestAnalysis.clause_count)} />
                      <MetadataRow label={labels.analysis.highRiskClauses} value={f.formatNumber(latestAnalysis.high_risk_clause_count)} />
                      <MetadataRow label={labels.analysis.analyzedAt} value={formatDateTime(latestAnalysis.analyzed_at)} />
                      <MetadataRow
                        label={labels.analysis.analysisDurationLabel}
                        value={labels.analysis.analysisDuration(latestAnalysis.analysis_duration_ms)}
                      />
                    </div>
                    </SectionCard>
                  </div>

                  <SectionCard title={labels.analysis.extractedTitle} description={labels.analysis.extractedDescription}>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-sm font-medium">{labels.analysis.parties}</p>
                        {latestAnalysis.extracted_parties.length > 0 ? (
                          latestAnalysis.extracted_parties.map((party) => (
                            <div key={`${party.name}-${party.role}`} className="rounded-lg border px-3 py-2 text-sm">
                              <div className="font-medium">{party.name}</div>
                              <div className="text-muted-foreground">
                                {party.role} • {party.source}
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">{labels.analysis.noPartiesExtracted}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm font-medium">{labels.analysis.dates}</p>
                        {latestAnalysis.extracted_dates.length > 0 ? (
                          latestAnalysis.extracted_dates.map((dateItem) => (
                            <div key={`${dateItem.label}-${dateItem.source}`} className="rounded-lg border px-3 py-2 text-sm">
                              <div className="font-medium">{dateItem.label}</div>
                              <div className="text-muted-foreground">
                                {dateItem.value ? formatDateTime(dateItem.value) : labels.analysis.noValue} • {dateItem.source}
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">{labels.analysis.noDatesExtracted}</p>
                        )}
                      </div>
                    </div>
                  </SectionCard>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
                  <SectionCard title={labels.analysis.keyFindingsTitle} description={labels.analysis.keyFindingsDescription}>
                    <div className="space-y-3">
                      {latestAnalysis.key_findings.length > 0 ? (
                        latestAnalysis.key_findings.map((finding) => (
                          <div key={`${finding.title}-${finding.clause_reference ?? 'none'}`} className="rounded-lg border px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">
                                  {localizeLexRiskFinding(finding, locale, riskTokenLabels, valueFormatters).title}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {localizeLexRiskFinding(finding, locale, riskTokenLabels, valueFormatters).description}
                                </p>
                                <p className="mt-2 text-sm">
                                  {labels.analysis.recommendationPrefix}{' '}
                                  <span className="text-muted-foreground">
                                    {localizeLexRiskFinding(finding, locale, riskTokenLabels, valueFormatters).recommendation}
                                  </span>
                                </p>
                              </div>
                              <span className="inline-flex items-center gap-1.5">
                                <SeverityIndicator severity={normalizeRiskSeverity(finding.severity)} showLabel={false} size="sm" />
                                <span className="text-overline font-medium text-muted-foreground">
                                  {localizeRiskLevelToken(finding.severity, locale, riskTokenLabels)}
                                </span>
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">{labels.analysis.noKeyFindings}</p>
                      )}
                    </div>
                  </SectionCard>

                  <div id="contract-analysis-flags" className="scroll-mt-24">
                    <SectionCard title={labels.analysis.missingFlagsTitle} description={labels.analysis.missingFlagsDescription}>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-sm font-medium">{labels.analysis.missingClauses}</p>
                        {latestAnalysis.missing_clauses.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {latestAnalysis.missing_clauses.map((clauseType) => (
                              <Badge key={clauseType} variant="warning">
                                {localizeClauseTypeToken(clauseType, locale)}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">{labels.analysis.noMissingClauses}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm font-medium">{labels.analysis.complianceFlags}</p>
                        {latestAnalysis.compliance_flags.length > 0 ? (
                          latestAnalysis.compliance_flags.map((flag) => (
                            <div key={`${flag.code}-${flag.title}`} className="rounded-lg border px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium">
                                    {localizeContractGeneratedText(flag.title, locale, riskTokenLabels, valueFormatters)}
                                  </p>
                                  <p className="text-sm text-muted-foreground">
                                    {localizeContractGeneratedText(flag.description, locale, riskTokenLabels, valueFormatters)}
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">{flag.code}</p>
                                </div>
                                <span className="inline-flex items-center gap-1.5">
                                  <SeverityIndicator severity={normalizeRiskSeverity(flag.severity)} showLabel={false} size="sm" />
                                  <span className="text-overline font-medium text-muted-foreground">
                                    {localizeRiskLevelToken(flag.severity, locale, riskTokenLabels)}
                                  </span>
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">{labels.analysis.noComplianceFlags}</p>
                        )}
                      </div>
                    </div>
                    </SectionCard>
                  </div>
                </div>

                <SectionCard title={labels.analysis.libraryTitle} description={labels.analysis.libraryDescription}>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <MetricCard tone="teal" label={labels.analysis.libraryClauses} href="/lex/clause-library" value={String(clauseLibrary.total)} />
                    <MetricCard tone="teal" label={labels.analysis.libraryBilingual} href="/lex/clause-library?language=bilingual" value={String(clauseLibrary.bilingualReady)} />
                    <MetricCard tone="gold" label={labels.analysis.libraryPending} href="/lex/clause-library?governance_status=pending_review&governance_status=in_review" value={String(clauseLibrary.pendingReview)} />
                    <MetricCard tone="rose" label={labels.analysis.libraryDeprecated} href="/lex/clause-library?status=deprecated" value={String(clauseLibrary.deprecated)} />
                  </div>
                </SectionCard>
              </>
            ) : (
              <SectionCard title={labels.analysis.cardTitle} description={labels.analysis.cardEmptyDescription}>
                <EmptyState
                  icon={FileSearch}
                  title={labels.analysis.emptyTitle}
                  description={labels.analysis.emptyDescription}
                  action={{
                    label: analyzeMutation.isPending ? labels.analysis.emptyAnalyzing : labels.analysis.emptyAnalyze,
                    onClick: () => void analyzeMutation.mutate(),
                  }}
                />
              </SectionCard>
            )}

            <SectionCard title={labels.clauses.title} description={labels.clauses.description}>
              <div className="space-y-3">
                {clauses.length > 0 ? (
                  clauses.map((clause) => (
                    <div
                      key={clause.id}
                      className={`rounded-lg border px-4 py-3 ${clauseReviewToneAccent(clause.review_status)}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{clause.title}</p>
                            <Badge variant="outline">{titleCase(clause.clause_type)}</Badge>
                            <LexStatusChip
                              domain="generic"
                              value={clause.review_status}
                              labels={clauseReviewLabels}
                              size="sm"
                            />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {clause.analysis_summary || clause.content.slice(0, 220) || labels.clauses.noSummary}
                          </p>
                          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                            <span>{labels.clauses.riskScorePrefix(formatNumber(clause.risk_score))}</span>
                            <span>{labels.clauses.confidencePrefix(Math.round(clause.extraction_confidence * 100))}</span>
                            <span>{clause.section_reference || labels.clauses.noSectionReference}</span>
                          </div>
                          {clause.recommendations.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {clause.recommendations.map((recommendation) => (
                                <Badge key={recommendation} variant="secondary">
                                  {recommendation}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <SeverityIndicator severity={normalizeRiskSeverity(clause.risk_level)} size="sm" />
                          {canWrite ? (
                            <Button variant="outline" size="sm" onClick={() => setClauseReviewTarget(clause)}>
                              {labels.clauses.reviewClause}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">{labels.clauses.empty}</p>
                )}
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="clauses" className="space-y-4">
            <ClausesTab contractId={contractId} />
          </TabsContent>

          <TabsContent id="contract-compliance" value="compliance" className="scroll-mt-24 space-y-4">
            <ComplianceTab contractId={contractId} canWrite={canWrite} />
          </TabsContent>

          <TabsContent id="contract-versions" value="versions" className="scroll-mt-24 space-y-4">
            <SectionCard title={labels.versions.redlineTitle} description={labels.versions.redlineDescription}>
              {hasRedlineText ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {redlineQuery.data ? (
                      <>
                        <span>{labels.versions.basePrefix(redlineQuery.data.base_version, redlineQuery.data.base_file_name)}</span>
                        <span>{labels.versions.targetPrefix(redlineQuery.data.target_version, redlineQuery.data.target_file_name)}</span>
                        <span>{labels.versions.addedLines(redlineQuery.data.added_lines)}</span>
                        <span>{labels.versions.removedLines(redlineQuery.data.removed_lines)}</span>
                      </>
                    ) : (
                      <>
                        {previousVersion ? (
                          <span>{labels.versions.basePrefix(previousVersion.version, previousVersion.file_name)}</span>
                        ) : null}
                        {latestVersion ? (
                          <span>{labels.versions.targetPrefix(latestVersion.version, latestVersion.file_name)}</span>
                        ) : null}
                      </>
                    )}
                  </div>
                  <RedlineView
                    original={prevVersionText}
                    revised={latestVersionText}
                    mode="split"
                    originalLabel={
                      previousVersion
                        ? labels.versions.basePrefix(previousVersion.version, previousVersion.file_name)
                        : undefined
                    }
                    revisedLabel={
                      latestVersion
                        ? labels.versions.targetPrefix(latestVersion.version, latestVersion.file_name)
                        : undefined
                    }
                    dir={direction}
                  />
                </div>
              ) : redlineChunks.length > 0 ? (
                <div className="space-y-3">
                  {redlineQuery.data ? (
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{labels.versions.basePrefix(redlineQuery.data.base_version, redlineQuery.data.base_file_name)}</span>
                      <span>{labels.versions.targetPrefix(redlineQuery.data.target_version, redlineQuery.data.target_file_name)}</span>
                      <span>{labels.versions.addedLines(redlineQuery.data.added_lines)}</span>
                      <span>{labels.versions.removedLines(redlineQuery.data.removed_lines)}</span>
                    </div>
                  ) : null}
                  <RedlinePreview chunks={redlineChunks} />
                </div>
              ) : (
                <EmptyState
                  icon={FileSearch}
                  title={labels.versions.redlineEmptyTitle}
                  description={labels.versions.redlineEmptyDescription}
                />
              )}
            </SectionCard>

            <SectionCard
              title={labels.versions.historyTitle}
              description={labels.versions.historyDescription}
              actions={
                canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setUploadOpen(true)}>
                      <FileUp className="me-1.5 h-3.5 w-3.5" />
                      {labels.versions.uploadVersion}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setFinalVersionOpen(true)}
                    >
                      <FileUp className="me-1.5 h-3.5 w-3.5" />
                      {locale === 'ar' ? 'رفع النسخة النهائية' : 'Upload final version'}
                    </Button>
                  </div>
                ) : undefined
              }
            >
              {versionsQuery.isLoading ? (
                <LoadingSkeleton variant="list-item" count={3} />
              ) : versionsQuery.isError ? (
                <ErrorState
                  message={labels.versions.loadError}
                  onRetry={() => void versionsQuery.refetch()}
                />
              ) : versions.length > 0 ? (
                <div className="space-y-3">
                  {versions.map((version) => (
                    <div key={version.id} className="rounded-lg border px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{labels.versions.versionPrefix(version.version)}</p>
                            <Badge variant="outline">{version.file_name}</Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {version.change_summary || labels.versions.noChangeSummary}
                          </div>
                          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                            <span>{formatBytes(version.file_size_bytes)}</span>
                            <span>{formatDateTime(version.uploaded_at)}</span>
                            <span>{labels.versions.hashPrefix(version.content_hash.slice(0, 12))}</span>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => void downloadVersion(version)}>
                          {labels.versions.download}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{labels.versions.empty}</p>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent id="contract-workflow" value="workflow" className="scroll-mt-24 space-y-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-4">
                {contract.workflow_instance_id ? (
                  <SectionCard title={labels.workflow.linkageTitle} description={labels.workflow.linkageDescription}>
                    <div className="space-y-3">
                      <MetadataRow
                        label={labels.workflow.workflowInstance}
                        value={
                          <Link
                            href={`/workflows/${contract.workflow_instance_id}`}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            {contract.workflow_instance_id}
                            <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
                          </Link>
                        }
                      />
                      <MetadataRow label={labels.workflow.contractStatus} value={titleCase(contract.status)} />
                      <MetadataRow label={labels.workflow.currentVersion} value={`v${contract.current_version}`} />
                      <MetadataRow
                        label={labels.workflow.started}
                        value={contract.status_changed_at ? f.formatDate(contract.status_changed_at) : labels.workflow.notAvailable}
                      />
                    </div>
                  </SectionCard>
                ) : (
                  <SectionCard title={labels.workflow.linkageTitle} description={labels.workflow.linkageEmptyDescription}>
                    <EmptyState
                      icon={GitBranch}
                      title={labels.workflow.emptyTitle}
                      description={labels.workflow.emptyDescription}
                      action={
                        canSubmitReview
                          ? {
                              label: labels.workflow.startReview,
                              onClick: () => setReviewOpen(true),
                            }
                          : undefined
                      }
                    />
                  </SectionCard>
                )}
              </div>

              {/* #29: right-rail activity story — the raw lifecycle timeline projected
                  into the shared <LexActivityTimeline> (actor avatars, day grouping,
                  tone-coloured rail, Hijri/Arabic-Indic timestamps in ar mode). */}
              <SectionCard title={labels.workflow.timelineTitle} description={labels.workflow.timelineDescription}>
                {timelineQuery.isLoading ? (
                  <LoadingSkeleton variant="list-item" count={4} />
                ) : timelineQuery.isError ? (
                  <ErrorState
                    message={labels.workflow.timelineLoadError}
                    onRetry={() => void timelineQuery.refetch()}
                  />
                ) : timeline && timeline.events.length > 0 ? (
                  <div className="space-y-3">
                    <LexActivityTimeline
                      events={activityEvents}
                      dir={direction}
                      emptyLabel={labels.workflow.timelineEmptyTitle}
                    />
                    <p className="text-xs text-muted-foreground">
                      {labels.workflow.generatedPrefix(f.formatDate(timeline.generated_at))}
                    </p>
                  </div>
                ) : (
                  <EmptyState
                    icon={History}
                    title={labels.workflow.timelineEmptyTitle}
                    description={labels.workflow.timelineEmptyDescription}
                  />
                )}
              </SectionCard>
            </div>
          </TabsContent>
        </Tabs>

        <ContractFormDialog
          contract={contract}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => {
            void refreshContract();
          }}
        />

        <StatusDialog
          currentStatus={contract.status}
          loading={statusMutation.isPending}
          onOpenChange={setStatusOpen}
          onSubmit={(nextStatus) => statusMutation.mutate(nextStatus)}
          open={statusOpen}
          options={allowedStatuses}
          labels={labels}
        />

        <DocumentPreviewSheet
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={
            latestVersion
              ? labels.versions.versionPrefix(latestVersion.version)
              : labels.lifecycleActions.previewDocument
          }
          fileName={latestVersion?.file_name}
          extractedText={(latestVersion?.extracted_text ?? contract.document_text) || undefined}
          dir={direction}
        />

        <ContractVersionUploadDialog
          contract={contract}
          loading={versionsQuery.isFetching}
          onOpenChange={setUploadOpen}
          onSaved={() => {
            void refreshContract();
          }}
          open={uploadOpen}
          labels={labels}
        />

        <FinalVersionModal
          contractId={contractId}
          open={finalVersionOpen}
          onOpenChange={setFinalVersionOpen}
        />

        <ReviewDialog
          activeApprovalPolicies={activeApprovalPolicies}
          approvalPoliciesError={approvalPoliciesQuery.isError}
          approvalPoliciesLoading={approvalPoliciesQuery.isLoading}
          contract={contract}
          loading={reviewMutation.isPending}
          onOpenChange={setReviewOpen}
          onApprovalPoliciesRetry={() => void approvalPoliciesQuery.refetch()}
          onSubmit={(payload) => reviewMutation.mutate(payload)}
          open={reviewOpen}
          users={users}
          usersLoading={usersQuery.isLoading}
          labels={labels}
        />

        <RenewDialog
          contract={contract}
          loading={renewMutation.isPending}
          onOpenChange={setRenewOpen}
          onSubmit={(payload) => renewMutation.mutate(payload)}
          open={renewOpen}
          labels={labels}
        />

        <ClauseReviewDialog
          clause={clauseReviewTarget}
          loading={clauseReviewMutation.isPending}
          onOpenChange={(open) => {
            if (!open) {
              setClauseReviewTarget(null);
            }
          }}
          onSubmit={(draft) => {
            if (!clauseReviewTarget) {
              return;
            }
            clauseReviewMutation.mutate({
              clauseId: clauseReviewTarget.id,
              notes: draft.notes,
              status: draft.status,
            });
          }}
          open={Boolean(clauseReviewTarget)}
          labels={labels}
        />

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={labels.deleteConfirm.title}
          description={labels.deleteConfirm.description(contract.title)}
          confirmLabel={labels.deleteConfirm.confirm}
          variant="destructive"
          loading={deleteMutation.isPending}
          onConfirm={async () => {
            await deleteMutation.mutateAsync();
          }}
        />

        {/* CAP-122 — archive with an optional reason. */}
        <Dialog
          open={archiveOpen}
          onOpenChange={(open) => {
            setArchiveOpen(open);
            if (!open) setArchiveReason('');
          }}
        >
          <DialogContent dir={direction} lang={locale} className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {locale === 'ar' ? 'أرشفة العقد' : 'Archive contract'}
              </DialogTitle>
              <DialogDescription>
                {locale === 'ar'
                  ? 'يُنقل العقد إلى الأرشيف ويُزال من السجل النشط. يمكنك استعادته لاحقًا.'
                  : 'Moves the contract to the archive and removes it from the active register. It can be restored later.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="archive-reason">
                {locale === 'ar' ? 'سبب الأرشفة' : 'Archive reason'}
              </Label>
              <Textarea
                id="archive-reason"
                value={archiveReason}
                onChange={(event) => setArchiveReason(event.target.value)}
                placeholder={
                  locale === 'ar' ? 'اختياري' : 'Optional'
                }
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setArchiveOpen(false)}>
                {locale === 'ar' ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button
                type="button"
                disabled={archiveMutation.isPending}
                onClick={() => archiveMutation.mutate(archiveReason)}
              >
                {archiveMutation.isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Archive className="me-1.5 h-4 w-4" />
                )}
                {locale === 'ar' ? 'أرشفة' : 'Archive'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </LexRouteGuard>
  );
}

function RedlinePreview({ chunks }: { chunks: RedlineChunk[] }) {
  return (
    <div className="max-h-96 overflow-auto rounded-lg border bg-muted/20 p-4 text-sm leading-7">
      {chunks.map((chunk, index) => {
        if (chunk.type === 'added') {
          return (
            <ins key={`${chunk.type}-${index}`} className="rounded bg-success-100 px-0.5 text-success-700 no-underline">
              {chunk.text}
            </ins>
          );
        }
        if (chunk.type === 'removed') {
          return (
            <del key={`${chunk.type}-${index}`} className="rounded bg-error-100 px-0.5 text-error-700">
              {chunk.text}
            </del>
          );
        }
        return <span key={`${chunk.type}-${index}`}>{chunk.text}</span>;
      })}
    </div>
  );
}

/**
 * ContractHeroBand (#7) — a flat solid token card that anchors the contract
 * detail console. It restates the contract's identity (number / type / parties)
 * and surfaces the four most-scanned facts (status, value, risk, expiry) as
 * fact tiles. Every date / number / SAR value is KSA-formatted via the
 * injected `useLexFormat` instance so Arabic mode renders Hijri + Arabic-Indic.
 *
 * Purely presentational — no mutations, no state — so it cannot regress any
 * lifecycle behaviour; it sits above the existing metric grid and tabs.
 */
function ContractHeroBand({
  contract,
  statusLabels,
  riskSeverity,
  riskLabel,
  riskScore,
  f,
  labels,
  typeLabel,
}: {
  contract: LexContractRecord;
  statusLabels: Record<string, string>;
  riskSeverity: string;
  riskLabel: string;
  riskScore: number | null;
  f: LexFormatter;
  labels: ContractDetailLabels;
  typeLabel: string;
}) {
  const counterparty = contract.party_b_name || labels.brief.notSet;
  const partyA = contract.party_a_name || labels.brief.notSet;
  const value =
    contract.total_value != null
      ? f.formatCurrency(contract.total_value, { currency: contract.currency ?? 'SAR' })
      : labels.brief.undisclosed;
  const expiry = contract.expiry_date ? f.formatDate(contract.expiry_date) : labels.metadata.notSet;
  const expiryRelative = contract.expiry_date ? f.formatRelative(contract.expiry_date) : undefined;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6',
        'shadow-elevation-2 motion-safe:animate-fade-up',
      )}
    >
      <div className="relative space-y-5 text-foreground">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <LexStatusChip value={contract.status} labels={statusLabels} size="sm" />
            <span className="rounded-full border border-border bg-muted text-muted-foreground px-2.5 py-0.5 text-xs font-medium">
              {typeLabel}
            </span>
            {contract.contract_number ? (
              <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                {contract.contract_number}
              </span>
            ) : null}
          </div>
          <p className="min-w-0 text-sm text-muted-foreground" dir="auto">
            <span className="font-medium">{partyA}</span>
            <span className="mx-1.5 opacity-70">↔</span>
            <span className="font-medium">{counterparty}</span>
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroFact label={labels.brief.counterparty} value={counterparty} />
          <HeroFact label={labels.brief.value} value={value} mono />
          <HeroFact
            label={labels.brief.risk}
            value={
              <span className="inline-flex items-center gap-1.5">
                <SeverityIndicator
                  severity={normalizeRiskSeverity(riskSeverity)}
                  size="sm"
                  showLabel={false}
                />
                <span>{riskLabel}</span>
                {riskScore != null ? (
                  <span className="text-muted-foreground">· {f.formatNumber(riskScore)}</span>
                ) : null}
              </span>
            }
          />
          <HeroFact label={labels.metadata.expiryDate} value={expiry} helper={expiryRelative} />
        </dl>
      </div>
    </section>
  );
}

function HeroFact({
  label,
  value,
  helper,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  helper?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5">
      <dt className="text-overline font-medium uppercase text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-sm font-semibold text-foreground',
          mono && 'tabular-nums',
        )}
        dir="auto"
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </dd>
      {helper ? (
        <dd className="text-xs text-muted-foreground">{helper}</dd>
      ) : null}
    </div>
  );
}

/**
 * MetricCard — compact operational alias over the shared
 * {@link DetailStatCard}. Existing call sites keep the same
 * `{ label, value, helper }` shape while inheriting the flat detail-card system.
 */
function MetricCard({
  helper,
  label,
  value,
  href,
  tone,
  icon,
  badge,
}: {
  helper?: string;
  label: string;
  value: React.ReactNode;
  href: string;
  tone?: StatTone;
  icon?: LucideIcon;
  badge?: React.ReactNode;
}) {
  return (
    <DetailStatCard
      appearance="operational"
      label={label}
      value={value}
      helper={helper}
      tone={tone}
      icon={icon}
      badge={badge}
      className="contract-detail-metric-card min-h-32"
      href={href}
    />
  );
}

function MetadataRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[160px_1fr]">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-sm">{value}</div>
    </div>
  );
}

/**
 * CompactEmpty (#5) — a short inline empty block with an optional CTA, used in
 * place of the tall frozen `EmptyState` card inside dense Overview sections. The
 * frozen common/empty-state primitive is intentionally untouched.
 */
function CompactEmpty({
  icon: Icon,
  title,
  description,
  cta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {cta ? (
        <Button size="sm" variant="outline" onClick={cta.onClick}>
          <Plus className="me-1.5 h-3.5 w-3.5" />
          {cta.label}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * LifecycleActionsCard (#4) — groups lifecycle mutations into Status & Workflow /
 * Documents / Danger zone subsections, promotes the contextual primary action,
 * and isolates Delete. All handlers/permission gating are passed straight through
 * from the page so no mutation behavior changes.
 */
function LifecycleActionsCard({
  contract,
  canWrite,
  canSubmitReview,
  canClose,
  allowedStatuses,
  hasLatestVersion,
  deletePending,
  archivePending,
  renewActive,
  onChangeStatus,
  onStartReview,
  onRenew,
  onUpload,
  onPreview,
  onDelete,
  onArchive,
  labels,
}: {
  contract: LexContractRecord;
  canWrite: boolean;
  canSubmitReview: boolean;
  canClose: boolean;
  allowedStatuses: LexContractStatus[];
  hasLatestVersion: boolean;
  deletePending: boolean;
  archivePending: boolean;
  renewActive: boolean;
  onChangeStatus: () => void;
  onStartReview: () => void;
  onRenew: () => void;
  onUpload: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onArchive: () => void;
  labels: ContractDetailLabels;
}) {
  const t = labels.lifecycleActions;
  const groups = labels.lifecycleGroups;
  const renewable = ['active', 'expired'].includes(contract.status);
  // Contextual primary action: renew if it's the contextual next step, else start review.
  const renewIsPrimary = renewActive && renewable;
  const reviewIsPrimary = !renewIsPrimary && !contract.workflow_instance_id;

  return (
    <section id="lifecycle-actions" className="card scroll-mt-24 p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{t.title}</h3>
        <p className="text-xs text-muted-foreground">{t.description}</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-overline font-semibold uppercase text-muted-foreground">
            {groups.statusWorkflow}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={onChangeStatus}
              disabled={!canWrite || allowedStatuses.length === 0}
            >
              {t.changeStatus}
            </Button>
            <Button
              variant={reviewIsPrimary ? 'default' : 'outline'}
              onClick={onStartReview}
              disabled={!canSubmitReview || Boolean(contract.workflow_instance_id)}
            >
              <PlayCircle className="me-1.5 h-3.5 w-3.5" />
              {t.startReview}
            </Button>
            <Button
              variant={renewIsPrimary ? 'default' : 'outline'}
              onClick={onRenew}
              disabled={!canWrite || !renewable}
              className="sm:col-span-2"
            >
              <RefreshCw className="me-1.5 h-3.5 w-3.5" />
              {t.renew}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-overline font-semibold uppercase text-muted-foreground">
            {groups.documents}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="outline" onClick={onUpload} disabled={!canWrite}>
              <FileUp className="me-1.5 h-3.5 w-3.5" />
              {t.uploadVersion}
            </Button>
            <Button variant="outline" onClick={onPreview} disabled={!hasLatestVersion}>
              <FileText className="me-1.5 h-3.5 w-3.5" />
              {t.previewDocument}
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/lex/signatures?create=1&contract_id=${contract.id}`}>
                <FileCheck2 className="me-1.5 h-3.5 w-3.5" />
                {t.signatureQueue}
              </Link>
            </Button>
          </div>
        </div>

        {canClose ? (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div>
              <p className="text-overline font-semibold uppercase text-destructive">
                {groups.dangerZone}
              </p>
              <p className="text-xs text-muted-foreground">{groups.dangerZoneHelp}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={onArchive}
                disabled={archivePending}
              >
                <Archive className="me-1.5 h-3.5 w-3.5" />
                {t.archiveContract}
              </Button>
              <Button
                variant="destructive"
                onClick={onDelete}
                disabled={deletePending}
              >
                <Trash2 className="me-1.5 h-3.5 w-3.5" />
                {t.deleteContract}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ContractBriefPanel({
  brief,
  error,
  loading,
  onRetry,
  labels,
  f,
  locale,
  riskLabels,
}: {
  brief: LexContractBrief | null;
  error: boolean;
  loading: boolean;
  onRetry: () => void;
  labels: ContractDetailLabels;
  f: LexFormatter;
  locale: AppLocale;
  riskLabels: Record<string, string>;
}) {
  const t = labels.brief;
  const formatters: ContractValueFormatters = {
    formatDate: f.formatDate,
    formatNumber: (value) => f.formatNumber(value),
    formatCurrency: (value, currency) => f.formatCurrency(value, { currency }),
  };
  return (
    <SectionCard title={t.title} description={t.description}>
      {loading ? (
        <LoadingSkeleton variant="list-item" count={3} />
      ) : error ? (
        <ErrorState message={t.loadError} onRetry={onRetry} />
      ) : brief ? (
        <div className="space-y-4">
          <div className="contract-brief-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard tone="slate" icon={BriefcaseBusiness} label={t.counterparty} href={`/lex/contracts/${brief.contract_id}?tab=details#contract-metadata`} value={brief.counterparty || t.notSet} />
            <MetricCard tone="teal" icon={UserRound} label={t.owner} href={`/lex/contracts/${brief.contract_id}?tab=details#contract-metadata`} value={brief.owner || t.unassigned} />
            <MetricCard
              tone="emerald"
              icon={CircleDollarSign}
              label={t.value}
              href={`/lex/contracts/${brief.contract_id}?tab=details#contract-metadata`}
              value={
                brief.value != null
                  ? f.formatCurrency(brief.value, { currency: brief.currency ?? 'SAR' })
                  : t.undisclosed
              }
            />
            <MetricCard
              tone="rose"
              icon={ShieldAlert}
              label={t.risk}
              href={`/lex/contracts/${brief.contract_id}?tab=analysis#contract-analysis-risk-summary`}
              value={
                <div className="flex items-center gap-2">
                  <SeverityIndicator severity={normalizeRiskSeverity(brief.risk_level)} showLabel={false} size="sm" />
                  <span>{localizeRiskLevelToken(brief.risk_level, locale, riskLabels)}</span>
                </div>
              }
              helper={brief.risk_score != null ? t.scorePrefix(f.formatNumber(brief.risk_score)) : t.noScore}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">{t.executiveSummary}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {composeContractExecutiveSummary(brief, locale, formatters)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">{t.riskSummary}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {localizeContractGeneratedText(brief.risk_summary, locale, riskLabels, formatters)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {brief.renewal_signals.map((signal) => {
                  const localized = localizeContractSignal(signal, locale, formatters);
                  return (
                    <Badge key={`${signal.label}-${signal.value}`} variant="outline">
                      {localized.label}: {localized.value}
                    </Badge>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <BriefList
                title={t.topRisks}
                emptyLabel={t.noSignals}
                items={brief.top_risks.map((risk) => {
                  const localized = localizeContractBriefRisk(
                    risk,
                    locale,
                    riskLabels,
                    formatters,
                  );
                  return {
                    id: `${risk.title}-${risk.severity}`,
                    title: localized.title,
                    detail: localized.recommendation || localized.description,
                    badge: localizeRiskLevelToken(risk.severity, locale, riskLabels),
                  };
                })}
              />
              <BriefList
                title={t.keyObligations}
                emptyLabel={t.noSignals}
                items={brief.obligations.map((obligation) => {
                  const localized = localizeContractSignal(obligation, locale, formatters);
                  return {
                    id: `${obligation.label}-${obligation.value}`,
                    title: localized.label,
                    detail: localized.value,
                    badge: localized.source,
                  };
                })}
              />
            </div>
          </div>
        </div>
      ) : (
        <EmptyState icon={FileSearch} title={t.emptyTitle} description={t.emptyDescription} />
      )}
    </SectionCard>
  );
}

function BriefList({
  items,
  title,
  emptyLabel,
}: {
  items: Array<{ badge?: string; detail?: string | null; id: string; title: string }>;
  title: string;
  emptyLabel: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-2 space-y-2">
        {items.length > 0 ? (
          items.slice(0, 4).map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{item.title}</p>
                {item.detail ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.detail}</p>
                ) : null}
              </div>
              {item.badge ? <Badge variant="outline">{item.badge}</Badge> : null}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        )}
      </div>
    </div>
  );
}

function StatusDialog({
  currentStatus,
  loading,
  onOpenChange,
  onSubmit,
  open,
  options,
  labels,
}: {
  currentStatus: LexContractStatus;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (status: LexContractStatus) => void;
  open: boolean;
  options: LexContractStatus[];
  labels: ContractDetailLabels;
}) {
  const { locale, direction } = useLocale();
  const statusLabels = useContractStatusTokenLabels();
  const [status, setStatus] = useState<LexContractStatus | ''>('');

  useEffect(() => {
    if (!open) {
      setStatus('');
      return;
    }
    setStatus(options[0] ?? '');
  }, [open, options]);

  const t = labels.statusDialog;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={direction} lang={locale} className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>
            {t.description(statusLabels[currentStatus] ?? titleCase(currentStatus))}
          </DialogDescription>
        </DialogHeader>

        {options.length > 0 ? (
          <div className="space-y-3">
            <Label htmlFor="next-status">{t.nextStatus}</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as LexContractStatus)}>
              <SelectTrigger id="next-status">
                <SelectValue placeholder={t.selectStatus} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {statusLabels[option] ?? titleCase(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t.noTransitions}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={!status || loading || options.length === 0}
            onClick={() => status && onSubmit(status)}
          >
            {t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({
  activeApprovalPolicies,
  approvalPoliciesError,
  approvalPoliciesLoading,
  contract,
  loading,
  onApprovalPoliciesRetry,
  onOpenChange,
  onSubmit,
  open,
  users,
  usersLoading,
  labels,
}: {
  activeApprovalPolicies: LexApprovalPolicy[];
  approvalPoliciesError: boolean;
  approvalPoliciesLoading: boolean;
  contract: LexContractRecord;
  loading: boolean;
  onApprovalPoliciesRetry: () => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: LexReviewContractRequest) => void;
  open: boolean;
  users: UserDirectoryEntry[];
  usersLoading: boolean;
  labels: ContractDetailLabels;
}) {
  const { locale, direction } = useLocale();
  const t = labels.reviewDialog;
  const [draft, setDraft] = useState<ReviewDraft>(DEFAULT_REVIEW_DRAFT);
  const [recommendationResult, setRecommendationResult] = useState<LexApprovalPolicyRecommendationResult | null>(null);

  const recommendationMutation = useMutation({
    mutationFn: () => enterpriseApi.lex.recommendApprovalPolicy(contract.id),
    onSuccess: setRecommendationResult,
    onError: showApiError,
  });

  useEffect(() => {
    if (!open) {
      setDraft(DEFAULT_REVIEW_DRAFT);
      setRecommendationResult(null);
    }
  }, [open]);

  const selectedApprovalPolicy = activeApprovalPolicies.find(
    (policy) => policy.id === draft.selectedApprovalPolicyId,
  );
  const recommendedActivePolicy = recommendationResult?.policy
    ? activeApprovalPolicies.find((policy) => policy.id === recommendationResult.policy?.id) ?? null
    : null;
  const usesPersistedPolicy = draft.approvalPolicyMode === 'persisted';
  const usesManualPolicy = draft.approvalPolicyMode === 'manual';
  const isValid =
    draft.description.trim().length >= 5 &&
    (draft.approverRole.trim() || draft.approverUserId) &&
    (!usesPersistedPolicy || Boolean(selectedApprovalPolicy)) &&
    (!usesManualPolicy || draft.requiredRole.trim() || draft.requiredAuthorityAmount.trim()) &&
    (!draft.outOfOfficeActive || (draft.outOfOfficeDelegateId && draft.outOfOfficeReason.trim()));

  const updatePolicyMode = (mode: ReviewApprovalPolicyMode) => {
    setDraft((current) => ({
      ...current,
      approvalPolicyMode: mode,
      selectedApprovalPolicyId: mode === 'persisted' ? current.selectedApprovalPolicyId : '',
    }));
  };

  const applyRecommendation = () => {
    if (!recommendedActivePolicy) {
      return;
    }
    setDraft((current) => ({
      ...current,
      approvalPolicyMode: 'persisted',
      selectedApprovalPolicyId: recommendedActivePolicy.id,
    }));
  };

  const submitReview = () => {
    const payload: LexReviewContractRequest = {
      approver_role: draft.approverRole.trim() || undefined,
      approver_user_id: draft.approverUserId || undefined,
      description: draft.description.trim(),
      sla_hours: Number(draft.slaHours || DEFAULT_REVIEW_DRAFT.slaHours),
    };
    if (usesPersistedPolicy && selectedApprovalPolicy) {
      payload.approval_policy_id = selectedApprovalPolicy.id;
    }
    if (usesManualPolicy) {
      payload.approval_policy = {
        policy_id: draft.policyId.trim() || undefined,
        name: draft.policyName.trim() || undefined,
        required_role: draft.requiredRole.trim() || undefined,
        required_authority_amount: optionalNumber(draft.requiredAuthorityAmount),
        currency: draft.policyCurrency.trim() || undefined,
        require_authority_evidence: draft.requireAuthorityEvidence,
      };
    }
    const formFields: LexReviewContractRequest['form_fields'] = [];
    if (draft.requireBusinessJustification) {
      formFields.push({
        name: 'business_justification',
        type: 'textarea',
        label: t.formBusinessJustification,
        required: true,
      });
    }
    if (draft.requireRiskAcceptance) {
      formFields.push({
        name: 'risk_acceptance',
        type: 'boolean',
        label: t.formRiskAcceptance,
        required: true,
      });
    }
    if (formFields.length > 0) {
      payload.form_fields = formFields;
    }
    if (draft.outOfOfficeActive) {
      payload.out_of_office = {
        active: true,
        original_approver_user_id: draft.approverUserId || undefined,
        delegated_to: draft.outOfOfficeDelegateId,
        reason: draft.outOfOfficeReason.trim(),
        evidence_id: draft.outOfOfficeEvidenceId.trim() || undefined,
        starts_at: optionalISODateTime(draft.outOfOfficeStartsAt),
        ends_at: optionalISODateTime(draft.outOfOfficeEndsAt),
      };
    }
    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={direction} lang={locale} className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="review-user">{t.specificApprover}</Label>
            <Select
              value={draft.approverUserId || 'none'}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  approverUserId: value === 'none' ? '' : value,
                }))
              }
            >
              <SelectTrigger id="review-user">
                <SelectValue placeholder={usersLoading ? t.loadingUsers : t.selectApprover} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t.assignByRole}</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {userDisplayName(user)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="review-role">{t.approverRole}</Label>
            <Input
              id="review-role"
              value={draft.approverRole}
              onChange={(event) =>
                setDraft((current) => ({ ...current, approverRole: event.target.value }))
              }
              placeholder={t.approverRolePlaceholder}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="review-sla">{t.slaHours}</Label>
            <Input
              id="review-sla"
              type="number"
              min={1}
              value={draft.slaHours}
              onChange={(event) =>
                setDraft((current) => ({ ...current, slaHours: event.target.value }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="review-description">{t.taskDescription}</Label>
            <Textarea
              id="review-description"
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              placeholder={t.taskDescriptionPlaceholder}
              rows={4}
            />
          </div>

          <div className="space-y-3 border-t pt-4">
            <div>
              <Label>{t.doaPolicy}</Label>
              <p className="text-xs text-muted-foreground">{t.doaPolicyHelp}</p>
            </div>

            <RadioGroup
              value={draft.approvalPolicyMode}
              onValueChange={(value) => updatePolicyMode(value as ReviewApprovalPolicyMode)}
              className="grid gap-2 sm:grid-cols-3"
            >
              <div className="flex items-start gap-2 rounded-md border p-3">
                <RadioGroupItem value="none" id="review-policy-none" className="mt-0.5" />
                <Label htmlFor="review-policy-none" className="cursor-pointer space-y-1">
                  <span className="block text-sm font-medium">{t.policyNone}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{t.policyNoneHelp}</span>
                </Label>
              </div>
              <div className="flex items-start gap-2 rounded-md border p-3">
                <RadioGroupItem value="persisted" id="review-policy-persisted" className="mt-0.5" />
                <Label htmlFor="review-policy-persisted" className="cursor-pointer space-y-1">
                  <span className="block text-sm font-medium">{t.policyCatalog}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{t.policyCatalogHelp}</span>
                </Label>
              </div>
              <div className="flex items-start gap-2 rounded-md border p-3">
                <RadioGroupItem value="manual" id="review-policy-manual" className="mt-0.5" />
                <Label htmlFor="review-policy-manual" className="cursor-pointer space-y-1">
                  <span className="block text-sm font-medium">{t.policyManual}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{t.policyManualHelp}</span>
                </Label>
              </div>
            </RadioGroup>

            {usesPersistedPolicy ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{t.activePolicies}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatToken(contract.type)} | {contract.department || labels.brief.unassigned} |{' '}
                      {formatContractValue(contract, labels)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => recommendationMutation.mutate()}
                    disabled={recommendationMutation.isPending}
                  >
                    {recommendationMutation.isPending ? (
                      <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {t.recommendPolicy}
                  </Button>
                </div>

                {recommendationResult ? (
                  <div className="rounded-md border bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          {recommendationResult.matched ? t.recommendedPolicy : t.noPolicyMatch}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{recommendationResult.reason}</p>
                      </div>
                      <Badge variant={recommendationResult.matched ? 'success' : 'warning'}>
                        {recommendationResult.matched ? t.matched : t.review}
                      </Badge>
                    </div>
                    {recommendationResult.policy ? (
                      <div className="mt-3 space-y-3">
                        <ApprovalPolicySummary policy={recommendationResult.policy} compact labels={labels} />
                        <div className="flex flex-wrap items-center gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={applyRecommendation}
                            disabled={!recommendedActivePolicy || !recommendationResult.matched}
                          >
                            {t.applyRecommendation}
                          </Button>
                          {!recommendedActivePolicy ? (
                            <p className="text-xs text-muted-foreground">{t.recommendationUnavailable}</p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {approvalPoliciesLoading ? (
                  <LoadingSkeleton variant="list-item" count={3} />
                ) : approvalPoliciesError ? (
                  <ErrorState message={t.policiesLoadError} onRetry={onApprovalPoliciesRetry} />
                ) : activeApprovalPolicies.length === 0 ? (
                  <div className="rounded-md border border-dashed px-4 py-6 text-center">
                    <p className="text-sm font-medium">{t.noActivePolicies}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t.noActivePoliciesHelp}</p>
                  </div>
                ) : (
                  <RadioGroup
                    value={draft.selectedApprovalPolicyId}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, selectedApprovalPolicyId: value }))
                    }
                    className="max-h-72 gap-2 overflow-y-auto pe-1"
                  >
                    {activeApprovalPolicies.map((policy) => (
                      <div
                        key={policy.id}
                        className={`flex items-start gap-3 rounded-md border p-3 ${
                          draft.selectedApprovalPolicyId === policy.id ? 'border-primary bg-primary/5' : ''
                        }`}
                      >
                        <RadioGroupItem value={policy.id} id={`review-policy-${policy.id}`} className="mt-1" />
                        <Label htmlFor={`review-policy-${policy.id}`} className="min-w-0 flex-1 cursor-pointer">
                          <ApprovalPolicySummary policy={policy} labels={labels} />
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              </div>
            ) : null}

            {usesManualPolicy ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="review-policy-id">{t.policyId}</Label>
                  <Input
                    id="review-policy-id"
                    value={draft.policyId}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, policyId: event.target.value }))
                    }
                    placeholder={t.policyIdPlaceholder}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="review-policy-name">{t.policyName}</Label>
                  <Input
                    id="review-policy-name"
                    value={draft.policyName}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, policyName: event.target.value }))
                    }
                    placeholder={t.policyNamePlaceholder}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="review-required-role">{t.requiredRole}</Label>
                  <Input
                    id="review-required-role"
                    value={draft.requiredRole}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, requiredRole: event.target.value }))
                    }
                    placeholder={t.requiredRolePlaceholder}
                  />
                </div>
                <div className="grid grid-cols-[1fr_96px] gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="review-authority-amount">{t.authorityAmount}</Label>
                    <Input
                      id="review-authority-amount"
                      type="number"
                      min={0}
                      value={draft.requiredAuthorityAmount}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, requiredAuthorityAmount: event.target.value }))
                      }
                      placeholder={t.authorityAmountPlaceholder}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="review-policy-currency">{t.currency}</Label>
                    <Input
                      id="review-policy-currency"
                      value={draft.policyCurrency}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, policyCurrency: event.target.value.toUpperCase() }))
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3 sm:col-span-2">
                  <Label htmlFor="review-require-evidence">{t.requireEvidence}</Label>
                  <Switch
                    id="review-require-evidence"
                    checked={draft.requireAuthorityEvidence}
                    onCheckedChange={(checked) =>
                      setDraft((current) => ({ ...current, requireAuthorityEvidence: checked }))
                    }
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3 border-t pt-4">
            <Label>{t.requiredDecisionFields}</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div>
                  <Label htmlFor="review-business-justification">{t.businessJustification}</Label>
                  <p className="text-xs text-muted-foreground">{t.businessJustificationHelp}</p>
                </div>
                <Switch
                  id="review-business-justification"
                  checked={draft.requireBusinessJustification}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, requireBusinessJustification: checked }))
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div>
                  <Label htmlFor="review-risk-acceptance">{t.riskAcceptance}</Label>
                  <p className="text-xs text-muted-foreground">{t.riskAcceptanceHelp}</p>
                </div>
                <Switch
                  id="review-risk-acceptance"
                  checked={draft.requireRiskAcceptance}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, requireRiskAcceptance: checked }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="review-out-of-office">{t.outOfOffice}</Label>
                <p className="text-xs text-muted-foreground">{t.outOfOfficeHelp}</p>
              </div>
              <Switch
                id="review-out-of-office"
                checked={draft.outOfOfficeActive}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({ ...current, outOfOfficeActive: checked }))
                }
              />
            </div>

            {draft.outOfOfficeActive ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="review-delegate-user">{t.delegate}</Label>
                  <Select
                    value={draft.outOfOfficeDelegateId || 'none'}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        outOfOfficeDelegateId: value === 'none' ? '' : value,
                      }))
                    }
                  >
                    <SelectTrigger id="review-delegate-user">
                      <SelectValue placeholder={usersLoading ? t.loadingUsers : t.selectDelegate} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t.selectDelegate}</SelectItem>
                      {users
                        .filter((user) => user.id !== draft.approverUserId)
                        .map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {userDisplayName(user)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="review-ooo-evidence">{t.evidenceId}</Label>
                  <Input
                    id="review-ooo-evidence"
                    value={draft.outOfOfficeEvidenceId}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, outOfOfficeEvidenceId: event.target.value }))
                    }
                    placeholder={t.evidenceIdPlaceholder}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="review-ooo-start">{t.starts}</Label>
                  <Input
                    id="review-ooo-start"
                    type="datetime-local"
                    value={draft.outOfOfficeStartsAt}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, outOfOfficeStartsAt: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="review-ooo-end">{t.ends}</Label>
                  <Input
                    id="review-ooo-end"
                    type="datetime-local"
                    value={draft.outOfOfficeEndsAt}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, outOfOfficeEndsAt: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="review-ooo-reason">{t.delegationReason}</Label>
                  <Textarea
                    id="review-ooo-reason"
                    value={draft.outOfOfficeReason}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, outOfOfficeReason: event.target.value }))
                    }
                    placeholder={t.delegationReasonPlaceholder}
                    rows={3}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={!isValid || loading}
            onClick={submitReview}
          >
            {t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalPolicySummary({
  compact = false,
  policy,
  labels,
}: {
  compact?: boolean;
  policy: LexApprovalPolicy;
  labels: ContractDetailLabels;
}) {
  const approvers = policy.approvers.slice(0, compact ? 3 : 4);
  const t = labels.approvalPolicy;

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{policy.name}</span>
        {policy.status === 'active' ? (
          <Badge variant="success">{t.active}</Badge>
        ) : (
          <Badge variant={policy.status === 'archived' ? 'secondary' : 'warning'}>
            {formatToken(policy.status)}
          </Badge>
        )}
        <Badge variant="outline">{t.priorityPrefix(policy.priority)}</Badge>
      </div>
      {!compact && policy.description ? (
        <p className="line-clamp-2 text-xs font-normal text-muted-foreground">{policy.description}</p>
      ) : null}
      <div className="grid gap-2 text-xs font-normal text-muted-foreground sm:grid-cols-2">
        <span>
          <span className="font-medium text-foreground">{t.scopePrefix}</span> {formatApprovalPolicyScope(policy, labels)}
        </span>
        <span>
          <span className="font-medium text-foreground">{t.routePrefix}</span> {formatToken(policy.mode)} /{' '}
          {formatApprovalPolicyQuorum(policy, labels)}
        </span>
        <span className="sm:col-span-2">
          <span className="font-medium text-foreground">{t.authorityPrefix}</span> {formatApprovalPolicyAuthority(policy, labels)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {approvers.length > 0 ? (
          approvers.map((approver) => (
            <Badge key={`${policy.id}-${approver.type}-${approver.ref}`} variant="secondary">
              {approver.label || formatToken(approver.ref)}
            </Badge>
          ))
        ) : (
          <Badge variant="outline">{t.noApprovers}</Badge>
        )}
        {policy.approvers.length > approvers.length ? (
          <Badge variant="outline">+{policy.approvers.length - approvers.length}</Badge>
        ) : null}
      </div>
    </div>
  );
}

function formatApprovalPolicyScope(policy: LexApprovalPolicy, labels: ContractDetailLabels): string {
  const t = labels.approvalPolicy;
  return [
    policy.contract_type ? formatToken(policy.contract_type) : t.anyType,
    policy.department || t.anyDepartment,
    formatApprovalPolicyValueRange(policy, labels),
  ].join(' | ');
}

function formatApprovalPolicyValueRange(policy: LexApprovalPolicy, labels: ContractDetailLabels): string {
  const t = labels.approvalPolicy;
  const currency = formatCurrencyCode(policy.currency);
  if (policy.min_value != null && policy.max_value != null) {
    return t.rangePrefix(currency, formatNumber(policy.min_value), formatNumber(policy.max_value));
  }
  if (policy.min_value != null) {
    return t.fromPrefix(currency, formatNumber(policy.min_value));
  }
  if (policy.max_value != null) {
    return t.upToPrefix(currency, formatNumber(policy.max_value));
  }
  return t.anyValue;
}

function formatApprovalPolicyQuorum(policy: LexApprovalPolicy, labels: ContractDetailLabels): string {
  if (policy.quorum === 'n_of_m') {
    return labels.approvalPolicy.quorumNofM(policy.quorum_n ?? 1, policy.approvers.length);
  }
  return formatToken(policy.quorum);
}

function formatApprovalPolicyAuthority(policy: LexApprovalPolicy, labels: ContractDetailLabels): string {
  const t = labels.approvalPolicy;
  const pieces = [
    policy.required_role ? formatToken(policy.required_role) : t.anyApprovalAuthority,
    policy.required_authority_amount != null
      ? `${formatCurrencyCode(policy.currency)} ${formatNumber(policy.required_authority_amount)}`
      : null,
    policy.require_authority_evidence ? t.evidenceRequired : t.evidenceOptional,
  ];
  return pieces.filter(Boolean).join(' | ');
}

function formatContractValue(contract: LexContractRecord, labels: ContractDetailLabels): string {
  if (contract.total_value == null) {
    return `${formatCurrencyCode(contract.currency)} ${labels.approvalPolicy.undisclosedLower}`;
  }
  return `${formatCurrencyCode(contract.currency)} ${formatNumber(contract.total_value)}`;
}

function formatCurrencyCode(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : 'SAR';
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalISODateTime(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function RenewDialog({
  contract,
  loading,
  onOpenChange,
  onSubmit,
  open,
  labels,
}: {
  contract: LexContractRecord;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: Record<string, unknown>) => void;
  open: boolean;
  labels: ContractDetailLabels;
}) {
  const { locale, direction } = useLocale();
  const t = labels.renewDialog;
  const [draft, setDraft] = useState<RenewDraft>({
    changeSummary: '',
    newEffectiveDate: '',
    newExpiryDate: toDateInputValue(contract.expiry_date),
    newValue: contract.total_value != null ? String(contract.total_value) : '',
  });

  useEffect(() => {
    if (open) {
      setDraft({
        changeSummary: '',
        newEffectiveDate: '',
        newExpiryDate: toDateInputValue(contract.expiry_date),
        newValue: contract.total_value != null ? String(contract.total_value) : '',
      });
    }
  }, [contract.expiry_date, contract.total_value, open]);

  const isValid = draft.changeSummary.trim().length >= 3 && draft.newExpiryDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={direction} lang={locale}>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="renew-effective">{t.newEffectiveDate}</Label>
            <Input
              id="renew-effective"
              type="date"
              value={draft.newEffectiveDate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, newEffectiveDate: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="renew-expiry">{t.newExpiryDate}</Label>
            <Input
              id="renew-expiry"
              type="date"
              value={draft.newExpiryDate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, newExpiryDate: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="renew-value">{t.newValue}</Label>
            <Input
              id="renew-value"
              type="number"
              min={0}
              step="0.01"
              value={draft.newValue}
              onChange={(event) =>
                setDraft((current) => ({ ...current, newValue: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="renew-summary">{t.changeSummary}</Label>
            <Textarea
              id="renew-summary"
              value={draft.changeSummary}
              onChange={(event) =>
                setDraft((current) => ({ ...current, changeSummary: event.target.value }))
              }
              placeholder={t.changeSummaryPlaceholder}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={!isValid || loading}
            onClick={() =>
              onSubmit({
                new_effective_date: toOptionalDateTime(draft.newEffectiveDate),
                new_expiry_date: requiredDateTime(draft.newExpiryDate),
                new_value: draft.newValue === '' ? null : Number(draft.newValue),
                change_summary: draft.changeSummary.trim(),
              })
            }
          >
            {t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContractVersionUploadDialog({
  contract,
  loading,
  onOpenChange,
  onSaved,
  open,
  labels,
}: {
  contract: LexContractRecord;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  labels: ContractDetailLabels;
}) {
  const { locale, direction } = useLocale();
  const t = labels.uploadDialog;
  const [file, setFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) {
        throw new Error(t.selectFileError);
      }
      const resolvedExtractedText = await resolveUploadExtractedText(file, extractedText);
      if (resolvedExtractedText !== extractedText.trim()) {
        setExtractedText(resolvedExtractedText);
      }
      const uploaded = await enterpriseApi.files.upload(
        file,
        {
          suite: 'lex',
          entity_type: 'contract',
          entity_id: contract.id,
          tags: Array.from(new Set(['contract', contract.type, ...contract.tags])).join(','),
          lifecycle_policy: 'standard',
        },
        setUploadProgress,
      );
      const versions = await enterpriseApi.lex.uploadContractDocument(contract.id, {
        file_id: uploaded.id,
        file_name: uploaded.original_name,
        file_size_bytes: uploaded.size_bytes,
        content_hash: uploaded.checksum_sha256,
        extracted_text: resolvedExtractedText,
        change_summary: changeSummary.trim(),
      });
      // The review desk owns a named-slot registry separate from contract
      // versions. Register the same uploaded file as the live draft so the
      // review workflow can see the document already linked to this contract.
      await reviewDeskApi.uploadAttachment(contract.id, {
        slot: 'draft',
        file_id: uploaded.id,
        file_name: uploaded.original_name,
        file_size_bytes: uploaded.size_bytes,
        content_hash: uploaded.checksum_sha256,
        notes: changeSummary.trim() || undefined,
      });
      return versions;
    },
    onSuccess: () => {
      showSuccess(labels.toast.versionUploadedTitle, labels.toast.versionUploadedDescription);
      setFile(null);
      setExtractedText('');
      setChangeSummary('');
      setUploadProgress(0);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  useEffect(() => {
    if (!open) {
      setFile(null);
      setExtractedText('');
      setChangeSummary('');
      setUploadProgress(0);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={direction} lang={locale}>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="contract-version-file">{t.fileLabel}</Label>
            <Input
              id="contract-version-file"
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                void prefillExtractedTextFromFile(selected, setExtractedText);
              }}
            />
            {file ? <p className="text-xs text-muted-foreground">{t.selectedPrefix(file.name)}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="contract-version-summary">{t.changeSummary}</Label>
            <Input
              id="contract-version-summary"
              value={changeSummary}
              onChange={(event) => setChangeSummary(event.target.value)}
              placeholder={t.changeSummaryPlaceholder}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contract-version-text">{t.extractedText}</Label>
            <Textarea
              id="contract-version-text"
              value={extractedText}
              onChange={(event) => setExtractedText(event.target.value)}
              placeholder={t.extractedTextPlaceholder}
              rows={5}
            />
          </div>

          {uploadMutation.isPending ? (
            <p className="text-xs text-muted-foreground">{t.uploadProgress(Math.round(uploadProgress))}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={!file || uploadMutation.isPending || loading}
            onClick={() => uploadMutation.mutate()}
          >
            {t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClauseReviewDialog({
  clause,
  loading,
  onOpenChange,
  onSubmit,
  open,
  labels,
}: {
  clause: LexClause | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: ClauseReviewDraft) => void;
  open: boolean;
  labels: ContractDetailLabels;
}) {
  const { locale, direction } = useLocale();
  const t = labels.clauseDialog;
  const clauseStatusLabels = useClauseReviewStatusLabels();
  const [draft, setDraft] = useState<ClauseReviewDraft>({
    notes: '',
    status: 'reviewed',
  });

  useEffect(() => {
    if (clause && open) {
      setDraft({
        notes: clause.review_notes ?? '',
        status: clause.review_status,
      });
    }
  }, [clause, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={direction} lang={locale}>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description(clause?.title ?? t.fallbackClause)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clause-status">{t.reviewStatus}</Label>
            <Select
              value={draft.status}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  status: value as LexClause['review_status'],
                }))
              }
            >
              <SelectTrigger id="clause-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['pending', 'reviewed', 'flagged', 'accepted', 'rejected'].map((status) => (
                  <SelectItem key={status} value={status}>
                    {clauseStatusLabels[status] ?? titleCase(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="clause-notes">{t.reviewNotes}</Label>
            <Textarea
              id="clause-notes"
              value={draft.notes}
              onChange={(event) =>
                setDraft((current) => ({ ...current, notes: event.target.value }))
              }
              placeholder={t.reviewNotesPlaceholder}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={draft.notes.trim().length < 3 || loading}
            onClick={() => onSubmit({ ...draft, notes: draft.notes.trim() })}
          >
            {t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function normalizeRiskSeverity(
  value: string | null | undefined,
): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  switch (value) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
      return value;
    default:
      return 'info';
  }
}

/**
 * Restrained semantic left-border accent for an obligation tile, keyed by its
 * compliance status. Health → emerald, partial → gold (time/attention), breach
 * → rose; everything else stays neutral. Accent only — the status chip keeps the
 * authoritative color and the tile body is unchanged.
 */
function obligationToneAccent(status: string): string {
  switch (status) {
    case 'compliant':
      return 'border-s-2 border-s-success-500/70';
    case 'partially_compliant':
      return 'border-s-2 border-s-warning-500/70';
    case 'non_compliant':
      return 'border-s-2 border-s-rose-500/70';
    default:
      return '';
  }
}

/**
 * Restrained semantic left-border accent for a clause-review tile, keyed by its
 * review status. Flagged/rejected → rose (risk), pending → gold (awaiting time),
 * accepted/reviewed → emerald/sky; accent only — the SeverityIndicator and
 * status chip keep the authoritative color.
 */
function clauseReviewToneAccent(status: LexClause['review_status']): string {
  switch (status) {
    case 'flagged':
    case 'rejected':
      return 'border-s-2 border-s-rose-500/70';
    case 'pending':
      return 'border-s-2 border-s-warning-500/70';
    case 'accepted':
      return 'border-s-2 border-s-success-500/70';
    case 'reviewed':
      return 'border-s-2 border-s-sky-500/70';
    default:
      return '';
  }
}

function readStoredClassification(contract: LexContractRecord): LexContractClassificationResult | null {
  const value = contract.metadata.classification;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const classification = value as Record<string, unknown>;
  const recommendedType = asContractType(classification.recommended_type);
  const previousType = asContractType(classification.previous_type);
  const classifiedAt = typeof classification.classified_at === 'string' ? classification.classified_at : null;
  if (!recommendedType || !previousType || !classifiedAt) {
    return null;
  }
  return {
    contract_id: contract.id,
    previous_type: previousType,
    recommended_type: recommendedType,
    applied_type: contract.type,
    applied: true,
    confidence: typeof classification.confidence === 'number' ? classification.confidence : 0,
    matched_terms: Array.isArray(classification.matched_terms)
      ? classification.matched_terms.filter((term): term is string => typeof term === 'string')
      : [],
    rationale: typeof classification.rationale === 'string' ? classification.rationale : 'Stored classification metadata.',
    classified_at: classifiedAt,
    metadata: contract.metadata,
  };
}

function asContractType(value: unknown): LexContractRecord['type'] | null {
  return typeof value === 'string' && CONTRACT_TYPES.includes(value as LexContractRecord['type'])
    ? (value as LexContractRecord['type'])
    : null;
}

function formatOptionalDate(value: string | null | undefined, fallback: string): string {
  return value ? formatDateTime(value) : fallback;
}

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}

/**
 * Map a contract timeline `event_type` onto the activity-timeline tone ramp so
 * the rail colour conveys lifecycle health at a glance (created/active → success,
 * analysis/version → info, renewal/expiry warnings → warning, terminated/
 * cancelled/deleted → danger). Unknown types stay neutral.
 */
function timelineEventTone(eventType: string): LexActivityTone {
  const type = eventType.toLowerCase();
  if (/(terminat|cancel|delet|reject|expire|breach)/.test(type)) return 'danger';
  if (/(renew|warning|overdue|pending|review|flag)/.test(type)) return 'warning';
  if (/(activ|approv|sign|execut|complet|created)/.test(type)) return 'success';
  if (/(analy|version|upload|classif|status|workflow)/.test(type)) return 'info';
  return 'neutral';
}

function signatureProgress(signature: LexSignatureEnvelope, labels: ContractDetailLabels): string {
  const recipients = signature.recipients ?? [];
  const signed = signature.signed_count ?? recipients.filter((recipient) => recipient.status === 'signed').length;
  const total = signature.recipient_count ?? recipients.length;
  return labels.signature.progress(signed, total);
}

function canSendSignature(status: string): boolean {
  return status === 'draft';
}

function canCancelSignature(status: string): boolean {
  return ['draft', 'sent', 'viewed'].includes(status);
}

function toDateInputValue(value?: string | null): string {
  if (!value) {
    return '';
  }
  return new Date(value).toISOString().slice(0, 10);
}

function toOptionalDateTime(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  return new Date(`${value}T00:00:00Z`).toISOString();
}

function requiredDateTime(value: string): string {
  return new Date(`${value}T00:00:00Z`).toISOString();
}

async function downloadVersion(version: LexContractVersion): Promise<void> {
  const blob = await enterpriseApi.files.download(version.file_id);
  downloadBlob(blob, version.file_name);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Derive the contract duration (whole months + remaining days) between the
 * effective and expiry dates. Returns null when either date is missing or the
 * range is non-positive. Inputs are ISO datetime strings from the contract record.
 */
function computeContractDuration(
  effective?: string | null,
  expiry?: string | null,
): { months: number; days: number } | null {
  if (!effective || !expiry) {
    return null;
  }
  const start = new Date(effective);
  const end = new Date(expiry);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return null;
  }
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  let anchor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()),
  );
  if (anchor > end) {
    months -= 1;
    anchor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()),
    );
  }
  const days = Math.round((end.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24));
  return { months: Math.max(0, months), days: Math.max(0, days) };
}
