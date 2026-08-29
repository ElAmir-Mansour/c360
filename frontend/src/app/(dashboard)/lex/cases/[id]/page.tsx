'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GaugeCircle,
  MoreHorizontal,
  PencilLine,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldQuestion,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/use-auth';
import { AskForSupportButton } from '@/components/lex/support-composer';
import { apiGet } from '@/lib/api';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { useLexFormat } from '@/lib/lex/ksa';
import { casesApi, formatCaseToken, type CaseCompanyStatus } from '@/lib/lex/cases';
import type { User } from '@/types/models';
import { CaseFormDialog } from '../_components/case-form-dialog';
import {
  CaseIntakeDialog,
  CasePriorityDialog,
  CaseRiskRatingDialog,
  CaseStatusDialog,
  CaseStrengthDialog,
} from '../_components/case-management-dialogs';
import { PartiesTab } from '../_components/tabs/parties-tab';
import { HearingsTab } from '../_components/tabs/hearings-tab';
import { TasksTab } from '../_components/tabs/tasks-tab';
import { DocumentsTab } from '../_components/tabs/documents-tab';
import { PleadingsTab } from '../_components/tabs/pleadings-tab';
import { ExpertsTab } from '../_components/tabs/experts-tab';
import { JudgmentsTab } from '../_components/tabs/judgments-tab';
import { DefendantTab } from '../_components/tabs/defendant-tab';
import { AuditTab } from '../_components/tabs/audit-tab';
import { useCaseLabels } from '../_components/labels';
import { AiCaseBriefPanel } from '../_components/detail-workspace/ai-case-brief-panel';
import { CaseTimelineTab } from '../_components/detail-workspace/case-timeline-tab';
import { QualificationTab } from './_components/qualification/qualification-tab';
import { useQualificationLabels } from './_components/qualification/qualification-i18n';
import { CasePositionTab } from './_components/position/case-position-tab';
import { useCasePositionLabels } from './_components/position/case-position-i18n';
import {
  CasePrintReport,
  CaseReportButton,
} from './_components/report/case-print-report';
import { CollaborationPanel } from '../_components/detail-workspace/collaboration-panel';
import { useDetailWorkspaceLabels } from '../_components/detail-workspace/workspace-labels';
import { activeTaskCount, buildDeadlineItems } from '../_components/detail-workspace/workflow-metrics';
// --- Gold-standard revamp surfaces ---
import { resolveCaseTypeLabel } from './_components/case-enums-i18n';
import { CaseHero } from './_components/case-hero';
import { CaseToolbarNav } from './_components/case-toolbar-nav';
import { CaseLifecycleStepper } from './_components/case-lifecycle-stepper';
import { CaseActionBar } from './_components/case-action-bar';
import { CasePeopleCard } from './_components/case-people-card';
import { CaseOfficerAssignmentDialog } from './_components/case-officer-assignment-dialog';
import { CaseRelatedCard } from './_components/case-related-card';
import { CaseActivityMini } from './_components/case-activity-mini';
import { CaseKeyFactsCard } from './_components/case-key-facts-card';
import { CaseDetailsOverview } from './_components/case-details-overview';
import {
  caseTaskToItem,
  listVisibleCaseIntakeTasks,
  type InboxItemAction,
} from '../../inbox/_lib/use-inbox';
import { InboxDecisionDialog } from '../../inbox/_components/inbox-decision-dialog';

export default function LexCaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const caseId = params?.id ?? '';
  // §9/§18.4 — operational case work (edit, intake, status, strength, tabs)
  // is gated on the case edit verb; the destructive delete maps to the close
  // verb. A super-admin `lex:*` wildcard satisfies both via the resolver.
  const canWrite = hasPermission('lex:case:edit');
  const canClose = hasPermission('lex:case:close');
  const canAssign = hasPermission('lex:case:assign');
  // §22.5 — the audit tab/log is gated on lex:audit:read, independent of write.
  const canViewAudit = hasPermission('lex:audit:read');
  // Support requests are raised from the record, not just the inbox/top bar.
  // Same verb the inbox uses for its own "Ask for support" entry point.
  const canAskSupport = hasPermission('lex:support:create');
  const labels = useCaseLabels();
  const workspaceLabels = useDetailWorkspaceLabels();
  const qualificationLabels = useQualificationLabels();
  const positionLabels = useCasePositionLabels();
  const t = labels.detail;
  const searchSignature = searchParams?.toString() ?? '';
  const currentPath = pathname ?? `/lex/cases/${caseId}`;
  const requestedTab = searchParams?.get('tab') ?? null;

  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [strengthOpen, setStrengthOpen] = useState(false);
  const [riskRatingOpen, setRiskRatingOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activeCaseDecision, setActiveCaseDecision] = useState<InboxItemAction | null>(null);

  const caseQuery = useQuery({
    queryKey: ['lex-case', caseId],
    queryFn: () => casesApi.getCase(caseId),
    enabled: Boolean(caseId),
  });

  const legalCase = caseQuery.data;
  const canApproveCase = hasPermission('lex:case:approve');
  const phase1TasksQuery = useQuery({
    queryKey: ['lex-case-intake-visible', 'case-detail', caseId],
    queryFn: listVisibleCaseIntakeTasks,
    enabled: Boolean(caseId && legalCase?.status === 'phase1' && canApproveCase),
    staleTime: 30_000,
    retry: false,
  });
  const phase1DecisionAction = useMemo(
    () => {
      for (const task of phase1TasksQuery.data?.data ?? []) {
        const item = caseTaskToItem(task);
        if (item?.action?.type === 'case' && item.action.caseId === caseId) {
          return item.action;
        }
      }
      return null;
    },
    [caseId, phase1TasksQuery.data?.data],
  );
  const phase1DecisionAvailable = phase1DecisionAction !== null;
  const canAssignOfficer =
    canAssign && Boolean(legalCase && ['open', 'under_procedure', 'on_hold'].includes(legalCase.status));
  const handlingOfficerQuery = useQuery({
    queryKey: ['tenant-user', legalCase?.handling_officer_id],
    queryFn: () => apiGet<User>(`/api/v1/users/${legalCase!.handling_officer_id!}`),
    enabled: Boolean(legalCase?.handling_officer_id),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const handlingOfficerName = handlingOfficerQuery.data
    ? userDisplayName(handlingOfficerQuery.data)
    : legalCase?.responsible_lawyer?.trim();
  const activeTab = normalizeDetailTab(requestedTab, legalCase?.company_status);
  const isPlaintiffCase = legalCase?.company_status === 'plaintiff';
  const isDefendantCase = legalCase?.company_status === 'defendant';
  const parties = useMemo(() => legalCase?.parties ?? [], [legalCase?.parties]);
  const hearings = useMemo(() => legalCase?.hearings ?? [], [legalCase?.hearings]);
  const tasks = useMemo(() => legalCase?.tasks ?? [], [legalCase?.tasks]);

  const auditQuery = useQuery({
    queryKey: ['lex-case-audit', caseId],
    queryFn: () => casesApi.listCaseAudit(caseId),
    enabled: Boolean(caseId),
  });

  const pleadingsQuery = useQuery({
    queryKey: ['lex-case-pleadings', caseId],
    queryFn: () => casesApi.listPleadings(caseId),
    enabled: Boolean(caseId) && isPlaintiffCase,
  });

  const expertsQuery = useQuery({
    queryKey: ['lex-case-experts', caseId],
    queryFn: () => casesApi.listExperts(caseId),
    enabled: Boolean(caseId) && isPlaintiffCase,
  });

  const judgmentsQuery = useQuery({
    queryKey: ['lex-case-judgments', caseId],
    queryFn: () => casesApi.listJudgments(caseId),
    enabled: Boolean(caseId) && isPlaintiffCase,
  });

  const defendantQuery = useQuery({
    queryKey: ['lex-case-defendant', caseId],
    queryFn: () => casesApi.listDefendant(caseId),
    enabled: Boolean(caseId) && isDefendantCase,
    retry: false,
  });

  const auditEntries = useMemo(() => auditQuery.data ?? [], [auditQuery.data]);
  const pleadings = useMemo(() => pleadingsQuery.data ?? [], [pleadingsQuery.data]);
  const experts = useMemo(() => expertsQuery.data ?? [], [expertsQuery.data]);
  const judgments = useMemo(() => judgmentsQuery.data ?? [], [judgmentsQuery.data]);
  const defendantCases = useMemo(() => defendantQuery.data ?? [], [defendantQuery.data]);
  const deadlineItems = useMemo(
    () => buildDeadlineItems({ tasks, hearings, experts, judgments }),
    [tasks, hearings, experts, judgments],
  );
  const openTaskCount = activeTaskCount(tasks);
  const overdueTaskCount = deadlineItems.filter((item) => item.type === 'task' && item.daysUntil < 0).length;
  const upcomingHearingCount = deadlineItems.filter((item) => item.type === 'hearing').length;
  const timelineCount =
    2 +
    hearings.length +
    tasks.length +
    auditEntries.length +
    pleadings.length +
    experts.length +
    judgments.length +
    defendantCases.length;
  const timelineLoading =
    auditQuery.isLoading ||
    (isPlaintiffCase && (pleadingsQuery.isLoading || expertsQuery.isLoading || judgmentsQuery.isLoading)) ||
    (isDefendantCase && defendantQuery.isLoading);
  const timelineError =
    auditQuery.isError ||
    (isPlaintiffCase && (pleadingsQuery.isError || expertsQuery.isError || judgmentsQuery.isError)) ||
    (isDefendantCase && defendantQuery.isError);

  const openDetailTab = useCallback(
    (tab: string) => {
      const nextTab = normalizeDetailTab(tab, legalCase?.company_status);
      const next = new URLSearchParams(searchSignature);
      next.set('tab', nextTab);
      router.replace(`${currentPath}?${next.toString()}`, { scroll: false });
    },
    [currentPath, legalCase?.company_status, router, searchSignature],
  );

  useEffect(() => {
    if (!legalCase || requestedTab === activeTab) return;

    const next = new URLSearchParams(searchSignature);
    next.set('tab', activeTab);
    router.replace(`${currentPath}?${next.toString()}`, { scroll: false });
  }, [activeTab, currentPath, legalCase, requestedTab, router, searchSignature]);

  const refresh = async () => {
    await Promise.all([
      caseQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['lex-cases'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-case-audit', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-case-pleadings', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-case-experts', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-case-judgments', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-case-defendant', caseId] }),
    ]);
  };

  const retryTimeline = async () => {
    await Promise.all([
      auditQuery.refetch(),
      isPlaintiffCase ? pleadingsQuery.refetch() : Promise.resolve(),
      isPlaintiffCase ? expertsQuery.refetch() : Promise.resolve(),
      isPlaintiffCase ? judgmentsQuery.refetch() : Promise.resolve(),
      isDefendantCase ? defendantQuery.refetch() : Promise.resolve(),
    ]);
  };

  const deleteMutation = useMutation({
    mutationFn: () => casesApi.deleteCase(caseId),
    onSuccess: async () => {
      showSuccess(labels.toast.deleted);
      await queryClient.invalidateQueries({ queryKey: ['lex-cases'] });
      router.push('/lex/cases');
    },
    onError: showApiError,
  });

  if (caseQuery.isLoading) {
    return (
      <LexRouteGuard route="/lex/cases/[id]">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader title={t.loadingTitle} description={t.loadingDescription} />
          <LoadingSkeleton variant="card" count={4} />
        </div>
      </LexRouteGuard>
    );
  }

  if (caseQuery.isError || !legalCase) {
    return (
      <LexRouteGuard route="/lex/cases/[id]">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader title={t.loadingTitle} description={t.fallbackDescription} />
          <ErrorState message={t.errorMessage} onRetry={() => void caseQuery.refetch()} />
        </div>
      </LexRouteGuard>
    );
  }

  const title = resolveLocalized(legalCase.title, locale) || labels.list.untitled;
  const companyStatusName =
    labels.filters.companyStatusOptions[legalCase.company_status] ??
    formatCaseToken(legalCase.company_status);

  // Nav/shareability toolbar is available to everyone; the mutating actions are
  // gated on write access (delete additionally on the close verb).
  const headerActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <CaseToolbarNav caseId={caseId} caseNumber={legalCase.case_number || legalCase.id} />
      <CaseReportButton />
      {/*
        Context is passed EXPLICITLY rather than derived from the URL so nested
        case routes bind to this record too.
      */}
      {canAskSupport ? (
        <AskForSupportButton context={{ subjectType: 'case', subjectId: caseId }} />
      ) : null}
      {canWrite ? (
        <>
          <Button
            variant="outline"
            onClick={() => setEditOpen(true)}
            className="motion-safe:duration-fast"
          >
            <PencilLine className="me-1.5 h-3.5 w-3.5" />
            {t.edit}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t.changeStatus}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {legalCase.status === 'intake' || (legalCase.status === 'phase2' && canAssign) ? (
                <DropdownMenuItem onSelect={() => setIntakeOpen(true)}>
                  <SlidersHorizontal className="me-2 h-3.5 w-3.5" />
                  {t.intake}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setStatusOpen(true)}>
                <RefreshCw className="me-2 h-3.5 w-3.5" />
                {t.changeStatus}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setStrengthOpen(true)}>
                <GaugeCircle className="me-2 h-3.5 w-3.5" />
                {t.setStrength}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRiskRatingOpen(true)}>
                <ShieldQuestion className="me-2 h-3.5 w-3.5" />
                {t.setRiskRating}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPriorityOpen(true)}>
                <ShieldAlert className="me-2 h-3.5 w-3.5" />
                {t.setPriority}
              </DropdownMenuItem>
              {canClose ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setDeleteOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="me-2 h-3.5 w-3.5" />
                    {t.delete}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </div>
  );

  return (
    <LexRouteGuard route="/lex/cases/[id]">
      <>
        <div
          className="space-y-6 motion-safe:animate-fade-up print:hidden"
          dir={direction}
          lang={locale}
        >
        {/* Hero band — chips + title + key-fact tiles + header actions */}
        <CaseHero legalCase={legalCase} title={title} actions={headerActions} />

        {/* Compact, audit-grade lifecycle stepper */}
        <CaseLifecycleStepper status={legalCase.status} caseId={caseId} />

        {/* Status-complete "what needs you now" action bar */}
        <CaseActionBar
          legalCase={legalCase}
          canWrite={canWrite}
          canAssign={canAssign}
          phase1DecisionAvailable={phase1DecisionAvailable}
          deadlineItems={deadlineItems}
          onAssign={() => setAssignmentOpen(true)}
          onIntake={() => setIntakeOpen(true)}
          onOpenApprovals={() => {
            if (phase1DecisionAction) setActiveCaseDecision(phase1DecisionAction);
          }}
          onChangeStatus={() => setStatusOpen(true)}
          onSetStrength={() => setStrengthOpen(true)}
          onSetRiskRating={() => setRiskRatingOpen(true)}
          onOpenTab={openDetailTab}
        />

        {/* Two-column layout — tabs on the left, a persistent sticky rail that
            stays visible across every tab. */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <Tabs value={activeTab} onValueChange={openDetailTab} dir={direction}>
              <TabsList className="flex w-full flex-wrap justify-start">
                <TabsTrigger value="overview">{labels.tabs.overview}</TabsTrigger>
                <TabsTrigger value="qualification">{qualificationLabels.tab}</TabsTrigger>
                <TabsTrigger value="position">{positionLabels.tab}</TabsTrigger>
                <TabsTrigger value="timeline">
                  <TabTriggerLabel
                    label={workspaceLabels.deadline.viewTimeline}
                    count={timelineCount}
                    tone={
                      timelineError
                        ? 'warning'
                        : deadlineItems.some((item) => item.severity === 'critical')
                          ? 'destructive'
                          : 'default'
                    }
                  />
                </TabsTrigger>
                <TabsTrigger value="parties">
                  <TabTriggerLabel label={labels.tabs.parties} count={parties.length} />
                </TabsTrigger>
                <TabsTrigger value="hearings">
                  <TabTriggerLabel
                    label={labels.tabs.hearings}
                    count={upcomingHearingCount > 0 ? `${upcomingHearingCount}/${hearings.length}` : hearings.length}
                    tone={upcomingHearingCount > 0 ? 'warning' : 'default'}
                  />
                </TabsTrigger>
                <TabsTrigger value="tasks">
                  <TabTriggerLabel
                    label={labels.tabs.tasks}
                    count={overdueTaskCount > 0 ? `${overdueTaskCount}/${openTaskCount}` : openTaskCount}
                    tone={overdueTaskCount > 0 ? 'destructive' : openTaskCount > 0 ? 'warning' : 'default'}
                  />
                </TabsTrigger>
                <TabsTrigger value="documents">
                  <TabTriggerLabel label={labels.tabs.documents} count="live" />
                </TabsTrigger>
                {legalCase.company_status === 'plaintiff' ? (
                  <>
                    <TabsTrigger value="pleadings">
                      <TabTriggerLabel label={labels.tabs.pleadings} count={pleadings.length} />
                    </TabsTrigger>
                    <TabsTrigger value="experts">
                      <TabTriggerLabel label={labels.tabs.experts} count={experts.length} />
                    </TabsTrigger>
                    <TabsTrigger value="judgments">
                      <TabTriggerLabel label={labels.tabs.judgments} count={judgments.length} />
                    </TabsTrigger>
                  </>
                ) : (
                  <TabsTrigger value="defendant">
                    <TabTriggerLabel
                      label={labels.tabs.defendant}
                      count={defendantCases.length}
                      tone={defendantQuery.isError ? 'warning' : defendantCases.length > 0 ? 'warning' : 'default'}
                    />
                  </TabsTrigger>
                )}
                {canViewAudit ? (
                  <TabsTrigger value="audit">
                    <TabTriggerLabel label={labels.tabs.audit} count={auditEntries.length} />
                  </TabsTrigger>
                ) : null}
              </TabsList>

              {/* Overview — dense, localized meta grid with inline "+ edit" for
                  empty writable fields, then description + AI brief + collaboration. */}
              <TabsContent value="overview" className="mt-4 space-y-4">
                <CaseDetailsOverview
                  legalCase={legalCase}
                  hearings={hearings}
                  title={title}
                  statusLabel={labels.filters.statusOptions[legalCase.status] ?? formatCaseToken(legalCase.status)}
                  canWrite={canWrite}
                  onEdit={() => setEditOpen(true)}
                />

                <SectionCard title={t.descriptionTitle}>
                  <p className="whitespace-pre-line text-sm text-muted-foreground" dir="auto">
                    {legalCase.description || t.descriptionEmpty}
                  </p>
                </SectionCard>

                <CollaborationPanel caseId={caseId} />

                {/* Assistive output follows the case's own facts and human
                    collaboration. Keep it last so generated analysis never
                    outranks the authoritative record. */}
                <AiCaseBriefPanel
                  legalCase={legalCase}
                  title={title}
                  parties={parties}
                  hearings={hearings}
                  tasks={tasks}
                  auditEntries={auditEntries}
                  pleadings={pleadings}
                  experts={experts}
                  judgments={judgments}
                  deadlines={deadlineItems}
                />
              </TabsContent>

              <TabsContent value="qualification" className="mt-4">
                <QualificationTab
                  legalCase={legalCase}
                  caseId={caseId}
                  canWrite={canWrite}
                  onChanged={refresh}
                  onOpenTab={openDetailTab}
                />
              </TabsContent>

              <TabsContent value="position" className="mt-4">
                <CasePositionTab
                  legalCase={legalCase}
                  caseId={caseId}
                  canWrite={canWrite}
                  onChanged={refresh}
                />
              </TabsContent>

              <TabsContent value="timeline" className="mt-4">
                <CaseTimelineTab
                  legalCase={legalCase}
                  title={title}
                  hearings={hearings}
                  tasks={tasks}
                  auditEntries={auditEntries}
                  pleadings={pleadings}
                  experts={experts}
                  judgments={judgments}
                  defendantCases={defendantCases}
                  loading={Boolean(timelineLoading)}
                  error={Boolean(timelineError)}
                  plaintiffTrackEnabled={Boolean(isPlaintiffCase)}
                  defendantTrackEnabled={Boolean(isDefendantCase)}
                  canWrite={canWrite}
                  onRetry={() => void retryTimeline()}
                />
              </TabsContent>

              <TabsContent value="parties" className="mt-4">
                <PartiesTab caseId={caseId} parties={parties} canWrite={canWrite} onChanged={refresh} />
              </TabsContent>

              <TabsContent value="hearings" className="mt-4">
                <HearingsTab caseId={caseId} hearings={hearings} canWrite={canWrite} onChanged={refresh} />
              </TabsContent>

              <TabsContent value="tasks" className="mt-4">
                <TasksTab caseId={caseId} tasks={tasks} canWrite={canWrite} onChanged={refresh} />
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <DocumentsTab caseId={caseId} canWrite={canWrite} />
              </TabsContent>

              {legalCase.company_status === 'plaintiff' ? (
                <>
                  <TabsContent value="pleadings" className="mt-4">
                    <PleadingsTab caseId={caseId} canWrite={canWrite} />
                  </TabsContent>
                  <TabsContent value="experts" className="mt-4">
                    <ExpertsTab caseId={caseId} canWrite={canWrite} />
                  </TabsContent>
                  <TabsContent value="judgments" className="mt-4">
                    <JudgmentsTab caseId={caseId} canWrite={canWrite} />
                  </TabsContent>
                </>
              ) : (
                <TabsContent value="defendant" className="mt-4">
                  <DefendantTab caseId={caseId} canWrite={canWrite} />
                </TabsContent>
              )}

              {canViewAudit ? (
                <TabsContent value="audit" className="mt-4">
                  <AuditTab caseId={caseId} />
                </TabsContent>
              ) : null}
            </Tabs>
          </div>

          {/* Persistent sticky right rail — key facts / people / related / activity. */}
          <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            {legalCase.late_justification ? (
              <SectionCard
                title={locale === 'ar' ? 'مبرر تجاوز اتفاقية مستوى الخدمة' : 'SLA delay justification'}
                description={
                  locale === 'ar'
                    ? 'معلومة خاصة للمدير القانوني ومدير القضايا القانونية.'
                    : 'Private to the Legal Director and Legal Cases Manager.'
                }
              >
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {legalCase.late_justification}
                </p>
              </SectionCard>
            ) : null}
            <CaseKeyFactsCard
              legalCase={legalCase}
              deadlineItems={deadlineItems}
              onViewTimeline={() => openDetailTab('timeline')}
            />
            <CasePeopleCard
              legalCase={legalCase}
              parties={parties}
              canAssign={canAssignOfficer}
              onAssign={() => setAssignmentOpen(true)}
              onViewParties={() => openDetailTab('parties')}
            />
            <CaseRelatedCard
              legalCase={legalCase}
              isPlaintiff={Boolean(isPlaintiffCase)}
              isDefendant={Boolean(isDefendantCase)}
              counts={{
                hearings: hearings.length,
                judgments: judgments.length,
                pleadings: pleadings.length,
                defendant: defendantCases.length,
              }}
              onOpenTab={openDetailTab}
            />
            <CaseActivityMini
              caseId={caseId}
              onViewAll={() => openDetailTab(canViewAudit ? 'audit' : 'timeline')}
            />
          </aside>
        </div>

        {canWrite ? (
          <>
            <CaseFormDialog
              open={editOpen}
              legalCase={legalCase}
              onOpenChange={setEditOpen}
              onSaved={() => void refresh()}
            />
            <CaseStatusDialog
              legalCase={legalCase}
              open={statusOpen}
              onOpenChange={setStatusOpen}
              onSaved={() => void refresh()}
            />
            <CaseStrengthDialog
              legalCase={legalCase}
              open={strengthOpen}
              onOpenChange={setStrengthOpen}
              onSaved={() => void refresh()}
            />
            <CaseRiskRatingDialog
              legalCase={legalCase}
              open={riskRatingOpen}
              onOpenChange={setRiskRatingOpen}
              onSaved={() => void refresh()}
            />
            <CasePriorityDialog
              legalCase={legalCase}
              open={priorityOpen}
              onOpenChange={setPriorityOpen}
              onSaved={() => void refresh()}
            />
            <ConfirmDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              title={labels.confirm.deleteCaseTitle}
              description={labels.confirm.deleteCaseDescription(title)}
              confirmLabel={t.delete}
              variant="destructive"
              loading={deleteMutation.isPending}
              onConfirm={async () => {
                await deleteMutation.mutateAsync();
              }}
            />
          </>
        ) : null}
        {canWrite || (canAssign && legalCase.status === 'phase2') ? (
          <CaseIntakeDialog
            legalCase={legalCase}
            canAssign={canAssign}
            open={intakeOpen}
            onOpenChange={setIntakeOpen}
            onSaved={() => void refresh()}
          />
        ) : null}
        {canAssignOfficer ? (
          <CaseOfficerAssignmentDialog
            legalCase={legalCase}
            open={assignmentOpen}
            onOpenChange={setAssignmentOpen}
            onSaved={() => void refresh()}
          />
        ) : null}
        <InboxDecisionDialog
          action={activeCaseDecision}
          onOpenChange={(open) => {
            if (!open) setActiveCaseDecision(null);
          }}
          onDecided={() => {
            void phase1TasksQuery.refetch();
            void refresh();
          }}
        />
        </div>
        <CasePrintReport
          legalCase={legalCase}
          title={title}
          parties={parties}
          hearings={hearings}
          tasks={tasks}
          pleadings={pleadings}
          experts={experts}
          judgments={judgments}
        />
      </>
    </LexRouteGuard>
  );
}

function userDisplayName(user: Pick<User, 'first_name' | 'last_name' | 'email' | 'full_name'>): string {
  return user.full_name?.trim() || `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email;
}

const DETAIL_TAB_VALUES = [
  'overview',
  'qualification',
  'position',
  'timeline',
  'parties',
  'hearings',
  'tasks',
  'documents',
  'pleadings',
  'experts',
  'judgments',
  'defendant',
  'audit',
] as const;

type DetailTab = (typeof DETAIL_TAB_VALUES)[number];

const PLAINTIFF_ONLY_TABS = new Set<DetailTab>(['pleadings', 'experts', 'judgments']);

function normalizeDetailTab(value: string | null | undefined, companyStatus?: CaseCompanyStatus): DetailTab {
  if (!value || !isDetailTab(value)) return 'overview';
  if (companyStatus === 'plaintiff' && value === 'defendant') return 'overview';
  if (companyStatus === 'defendant' && PLAINTIFF_ONLY_TABS.has(value)) return 'overview';
  return value;
}

function isDetailTab(value: string): value is DetailTab {
  return (DETAIL_TAB_VALUES as readonly string[]).includes(value);
}

/**
 * A compact key/value field. Empty values become an inline "add" affordance
 * (opens the edit dialog) when the viewer can write, otherwise a muted "not set".
 */
function MetaField({
  label,
  value,
  onAdd,
  addLabel,
  notSet,
  tabularNums = false,
}: {
  label: string;
  value: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  notSet?: string;
  tabularNums?: boolean;
}) {
  const isEmpty =
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`text-sm font-medium text-foreground${tabularNums ? ' tabular-nums' : ''}`}
        dir="auto"
      >
        {isEmpty ? (
          onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {addLabel}
            </button>
          ) : (
            <span className="font-normal text-muted-foreground">{notSet ?? '—'}</span>
          )
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function TabTriggerLabel({
  label,
  count,
  tone = 'default',
}: {
  label: string;
  count: number | string;
  tone?: 'default' | 'warning' | 'destructive';
}) {
  const toneClass =
    tone === 'destructive'
      ? 'border-error-100 bg-error-50 text-error-600'
      : tone === 'warning'
        ? 'border-warning-100 bg-warning-50 text-warning-700 dark:text-warning-300'
        : 'border-border bg-muted text-muted-foreground';

  return (
    <span className="inline-flex items-center gap-2">
      <span>{label}</span>
      <span className={`rounded-full border px-1.5 py-0.5 text-overline font-semibold leading-none ${toneClass}`}>
        {count}
      </span>
    </span>
  );
}
