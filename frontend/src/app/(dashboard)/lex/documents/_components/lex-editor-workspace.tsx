'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Bot,
  Camera,
  CalendarClock,
  CheckCircle2,
  Clock,
  Cloud,
  CircleGauge,
  ClipboardCheck,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileSignature,
  FileText,
  FileWarning,
  Gavel,
  GitCompare,
  Handshake,
  History,
  Info,
  KeyRound,
  Link2,
  ListChecks,
  Lock,
  MessageSquare,
  Milestone,
  PanelRight,
  Pencil,
  Percent,
  RefreshCw,
  Route,
  Save,
  Scale,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
  Workflow,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { LexRecordPicker } from '@/components/lex/lex-record-picker';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { SectionCard } from '@/components/suites/section-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { StatusPill, type StatusPillStatus } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { showInfo, showSuccess } from '@/lib/toast';
import { useEditorLabels, type EditorLabels } from './lex-editor-i18n';
import {
  coerceEditorMode,
  LEX_EDITOR_MODES,
  type LexAutosaveStatus,
  type LexEditorAuditEvent,
  type LexEditorAutomationTask,
  type LexEditorApprovalGate,
  type LexEditorClauseAiAction,
  type LexEditorClauseAnchor,
  type LexEditorClauseRecommendation,
  type LexEditorCollaborationInboxItem,
  type LexEditorCompareWorkspace,
  type LexEditorCommentThread,
  type LexEditorCrossReference,
  type LexEditorDefinedTerm,
  type LexEditorDocumentHealthMetric,
  type LexEditorEvidenceBinding,
  type LexEditorGuestReviewer,
  type LexEditorLegalIssue,
  type LexEditorLockStatus,
  type LexEditorMode,
  type LexEditorPlaybookRuleLink,
  type LexEditorPlaybookDeviation,
  type LexEditorPrivilegeControl,
  type LexEditorProviderEvent,
  type LexEditorProviderConfig,
  type LexEditorProviderStatus,
  type LexEditorRedlinePackage,
  type LexEditorRiskLevel,
  type LexEditorSectionAssignment,
  type LexEditorSessionConfig,
  type LexEditorTermRepairAction,
  type LexEditorTrackedChange,
  useLexEditorSession,
} from '../_lib/editor-session';

const MODE_META: Record<LexEditorMode, { icon: ComponentType<{ className?: string }> }> = {
  view: { icon: Eye },
  comment: { icon: MessageSquare },
  edit: { icon: Pencil },
};

function readDocumentId(params: URLSearchParams): string | null {
  const value = params.get('documentId') ?? params.get('document') ?? params.get('id');
  return value?.trim() || null;
}

type LexFmt = ReturnType<typeof useLexFormat>;

function formatDateTime(value: string | undefined, f: LexFmt, labels: EditorLabels): string {
  if (!value) return labels.notRecorded;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return f.formatDate(date, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatPercent(value: number | undefined, f: LexFmt, labels: EditorLabels): string {
  if (value === undefined) return labels.na;
  return f.formatPercent(value, { fromPercent: value > 1, maximumFractionDigits: 0 });
}

function providerStatusToPill(status: LexEditorProviderStatus): StatusPillStatus {
  switch (status) {
    case 'ready':
      return 'passed';
    case 'loading':
      return 'running';
    case 'degraded':
      return 'degraded';
    case 'error':
      return 'failed';
    case 'unavailable':
      return 'blocked';
  }
}

function lockStatusToPill(status: LexEditorLockStatus): StatusPillStatus {
  switch (status) {
    case 'unlocked':
      return 'passed';
    case 'locked_by_me':
    case 'checked_out':
      return 'running';
    case 'locked_by_other':
      return 'blocked';
    case 'read_only':
      return 'pending';
  }
}

function autosaveStatusToPill(status: LexAutosaveStatus): StatusPillStatus {
  switch (status) {
    case 'saved':
      return 'passed';
    case 'saving':
      return 'running';
    case 'pending':
      return 'degraded';
    case 'error':
      return 'failed';
    case 'disabled':
      return 'pending';
  }
}

function lockLabel(status: LexEditorLockStatus, labels: EditorLabels): string {
  switch (status) {
    case 'unlocked':
      return labels.lock.available;
    case 'locked_by_me':
      return labels.lock.checkedOutByYou;
    case 'locked_by_other':
      return labels.lock.lockedByOther;
    case 'checked_out':
      return labels.lock.checkedOut;
    case 'read_only':
      return labels.lock.readOnly;
  }
}

function autosaveLabel(status: LexAutosaveStatus, labels: EditorLabels): string {
  switch (status) {
    case 'saved':
      return labels.autosave.saved;
    case 'saving':
      return labels.autosave.saving;
    case 'pending':
      return labels.autosave.pending;
    case 'disabled':
      return labels.autosave.unavailable;
    case 'error':
      return labels.autosave.error;
  }
}

function actionToast(action: string, labels: EditorLabels): void {
  showSuccess(labels.toastReady(action), labels.toastReadyBody);
}

function normalizedScore(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0;
  const score = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreToPill(score: number): StatusPillStatus {
  if (score >= 85) return 'passed';
  if (score >= 70) return 'degraded';
  if (score >= 50) return 'blocked';
  return 'failed';
}

function riskToPill(level: LexEditorRiskLevel): StatusPillStatus {
  switch (level) {
    case 'critical':
      return 'blocked';
    case 'high':
    case 'medium':
      return 'degraded';
    case 'low':
      return 'passed';
  }
}

function riskBadgeVariant(level: LexEditorRiskLevel): 'destructive' | 'warning' | 'outline' {
  if (level === 'critical' || level === 'high') return 'destructive';
  if (level === 'medium') return 'warning';
  return 'outline';
}

function negotiationStatusToPill(
  status: LexEditorSessionConfig['negotiationRoom']['status'],
): StatusPillStatus {
  switch (status) {
    case 'open':
      return 'running';
    case 'blocked':
      return 'blocked';
    case 'closed':
      return 'passed';
    case 'quiet':
      return 'pending';
  }
}

function assignmentStatusToPill(status: LexEditorSectionAssignment['status']): StatusPillStatus {
  switch (status) {
    case 'approved':
      return 'passed';
    case 'in_review':
      return 'running';
    case 'changes_requested':
      return 'degraded';
    case 'not_started':
      return 'pending';
  }
}

function guestStatusToPill(status: LexEditorGuestReviewer['status']): StatusPillStatus {
  switch (status) {
    case 'active':
      return 'running';
    case 'expired':
    case 'revoked':
      return 'blocked';
    case 'invited':
      return 'pending';
  }
}

function issueStatusToPill(issue: LexEditorLegalIssue): StatusPillStatus {
  if (issue.status === 'resolved') return 'passed';
  if (issue.status === 'waived') return 'pending';
  if (issue.severity === 'critical') return 'blocked';
  return issue.status === 'triage' ? 'degraded' : riskToPill(issue.severity);
}

function signatureStatusToPill(
  status: LexEditorSessionConfig['signatureReadiness']['status'],
): StatusPillStatus {
  switch (status) {
    case 'ready':
      return 'passed';
    case 'blocked':
      return 'blocked';
    case 'needs_review':
      return 'degraded';
    case 'not_started':
      return 'pending';
  }
}

function clauseAiStatusToPill(status: LexEditorClauseAiAction['status']): StatusPillStatus {
  switch (status) {
    case 'available':
      return 'pending';
    case 'running':
      return 'running';
    case 'blocked':
      return 'blocked';
    case 'applied':
      return 'passed';
  }
}

function healthMetricStatusToPill(status: LexEditorDocumentHealthMetric['status']): StatusPillStatus {
  switch (status) {
    case 'good':
      return 'passed';
    case 'attention':
      return 'degraded';
    case 'blocked':
      return 'blocked';
  }
}

function termStatusToPill(status: LexEditorDefinedTerm['status']): StatusPillStatus {
  switch (status) {
    case 'defined':
      return 'passed';
    case 'duplicate':
    case 'unused':
      return 'degraded';
    case 'undefined':
      return 'blocked';
  }
}

function crossReferenceStatusToPill(status: LexEditorCrossReference['status']): StatusPillStatus {
  switch (status) {
    case 'valid':
      return 'passed';
    case 'stale':
      return 'degraded';
    case 'missing':
      return 'blocked';
  }
}

function workspaceStatusToPill(status: string | undefined): StatusPillStatus {
  switch (status) {
    case 'ready':
    case 'clear':
    case 'processed':
    case 'anchored':
    case 'approved':
    case 'active':
    case 'linked':
    case 'applied':
    case 'done':
    case 'read':
      return 'passed';
    case 'running':
    case 'generating':
    case 'buffering':
    case 'queued':
    case 'pending':
    case 'in_progress':
    case 'unread':
    case 'received':
      return 'running';
    case 'needs_review':
    case 'stale':
    case 'suggested':
    case 'draft':
    case 'restore_available':
    case 'snoozed':
      return 'degraded';
    case 'blocked':
    case 'failed':
    case 'missing':
    case 'rejected':
    case 'conflict':
      return 'blocked';
    default:
      return 'pending';
  }
}

function formatDate(value: string | undefined, f: LexFmt, labels: EditorLabels): string {
  if (!value) return labels.notSet;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return f.formatDate(date, { dateStyle: 'medium' });
}

export function LexDocumentEditorRoute() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { locale, direction } = useLocale();
  const labels = useEditorLabels();
  const { hasPermission } = useAuth();
  // §9/§18.4 — switching the editor into edit mode requires the document edit verb.
  const canWrite = hasPermission('lex:document:edit');
  const searchParamString = searchParams?.toString() ?? '';
  const documentId = useMemo(
    () => readDocumentId(new URLSearchParams(searchParamString)),
    [searchParamString],
  );
  const requestedMode = coerceEditorMode(searchParams?.get('mode'));
  const {
    session,
    documentError,
    isLoading,
    isRefetching,
    sessionUnavailable,
    sessionError,
    refetch,
  } = useLexEditorSession(documentId, requestedMode);

  const setMode = useCallback(
    (nextMode: LexEditorMode) => {
      const nextParams = new URLSearchParams(searchParamString);
      nextParams.set('mode', nextMode);
      const query = nextParams.toString();
      const nextPathname = pathname ?? '/lex/documents/editor';
      router.replace(query ? `${nextPathname}?${query}` : nextPathname, { scroll: false });
    },
    [pathname, router, searchParamString],
  );

  useEffect(() => {
    if (!canWrite && requestedMode === 'edit') {
      setMode('view');
    }
  }, [canWrite, requestedMode, setMode]);

  if (!documentId) {
    return (
      <LexRouteGuard requirement="lex:document:view">
        <div className="space-y-6" dir={direction} lang={locale}>
          <EditorEmptyState />
        </div>
      </LexRouteGuard>
    );
  }

  if (isLoading) {
    return (
      <LexRouteGuard requirement="lex:document:view">
        <div className="space-y-6" dir={direction} lang={locale}>
          <EditorRouteSkeleton />
        </div>
      </LexRouteGuard>
    );
  }

  if (!session) {
    return (
      <LexRouteGuard requirement="lex:document:view">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            title={labels.documentEditor}
            description={labels.noSession.description}
            actions={<BackToDocumentsButton />}
          />
          <ErrorState
            error={documentError}
            message={labels.noSession.message}
            onRetry={() => {
              void refetch();
            }}
          />
        </div>
      </LexRouteGuard>
    );
  }

  return (
    <LexRouteGuard requirement="lex:document:view">
      <LexDocumentEditorWorkspace
        session={session}
        canWrite={canWrite}
        isRefetching={isRefetching}
        sessionUnavailable={sessionUnavailable}
        sessionError={sessionError}
        onModeChange={setMode}
        onRefresh={() => {
          void refetch();
        }}
      />
    </LexRouteGuard>
  );
}

export function LexDocumentEditorWorkspace({
  session,
  canWrite,
  isRefetching,
  sessionUnavailable,
  sessionError,
  onModeChange,
  onRefresh,
}: {
  session: LexEditorSessionConfig;
  canWrite: boolean;
  isRefetching: boolean;
  sessionUnavailable: boolean;
  sessionError: unknown;
  onModeChange: (mode: LexEditorMode) => void;
  onRefresh: () => void;
}) {
  const { locale, direction } = useLocale();
  const labels = useEditorLabels();
  const f = useLexFormat();
  const doc = session.document;
  const title = doc?.title ?? labels.documentEditor;
  const versionValue = session.version.currentVersion ?? doc?.currentVersion ?? labels.na;
  const description = doc?.fileName
    ? `${doc.fileName} · ${labels.versionLabel(String(versionValue))}`
    : labels.workspaceFallbackDesc;
  const providerPill = providerStatusToPill(session.provider.status);
  const lockPill = lockStatusToPill(session.lock.status);
  const [legalWorkspaceTab, setLegalWorkspaceTab] = useState<LegalWorkspaceTab>('room');

  return (
    <div className="space-y-5" dir={direction} lang={locale}>
      <PageHeader
        title={title}
        description={description}
        eyebrow={labels.eyebrow}
        tags={[
          {
            label: session.provider.label,
            icon: <Cloud className="h-3.5 w-3.5" aria-hidden />,
            tone: session.provider.status === 'ready' ? 'success' : 'warning',
          },
          {
            label: labels.modes[session.mode],
            icon: <PanelRight className="h-3.5 w-3.5" aria-hidden />,
            tone: 'info',
          },
          {
            label: lockLabel(session.lock.status, labels),
            icon:
              session.lock.status === 'unlocked' ? (
                <Unlock className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Lock className="h-3.5 w-3.5" aria-hidden />
              ),
            tone: session.lock.status === 'locked_by_other' ? 'danger' : 'neutral',
          },
        ]}
        stats={[
          { label: labels.stats.version, value: versionValue },
          { label: labels.stats.comments, value: f.formatNumber(session.comments.unresolved) },
          { label: labels.stats.changes, value: f.formatNumber(session.trackChanges.total) },
        ]}
        actions={
          <>
            <BackToDocumentsButton />
            <Button variant="outline" onClick={onRefresh} disabled={isRefetching}>
              <RefreshCw className={cn('me-1.5 h-4 w-4', isRefetching && 'animate-spin')} aria-hidden />
              {labels.refresh}
            </Button>
          </>
        }
      />

      {sessionUnavailable ? (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>{labels.sessionUnavailableTitle}</AlertTitle>
          <AlertDescription>
            {labels.sessionUnavailableDesc}
            {sessionError instanceof Error ? ` ${sessionError.message}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      <EditorCommandBar
        mode={session.mode}
        availableModes={session.availableModes}
        canWrite={canWrite}
        provider={session.provider}
        lockStatus={session.lock.status}
        providerPill={providerPill}
        lockPill={lockPill}
        snapshotAllowed={session.version.snapshotAllowed}
        onModeChange={onModeChange}
      />

      <AutosaveRecoveryStrip session={session} />

      <LegalMaturitySummary session={session} onSelect={setLegalWorkspaceTab} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0 space-y-4">
          <ProviderEmbedHost session={session} />
        </div>
        <div className="space-y-4">
          <EditorOperationalStatus session={session} />
          <LegalMaturityPanels
            session={session}
            value={legalWorkspaceTab}
            onValueChange={setLegalWorkspaceTab}
          />
          <AdvancedEditorOperationsPanels session={session} />
          <EditorReviewPanels session={session} />
        </div>
      </div>
    </div>
  );
}

function BackToDocumentsButton() {
  const labels = useEditorLabels();
  return (
    <Button asChild variant="outline">
      <Link href="/lex/documents">
        <FileText className="me-1.5 h-4 w-4" aria-hidden />
        {labels.documents}
      </Link>
    </Button>
  );
}

function EditorCommandBar({
  mode,
  availableModes,
  canWrite,
  provider,
  lockStatus,
  providerPill,
  lockPill,
  snapshotAllowed,
  onModeChange,
}: {
  mode: LexEditorMode;
  availableModes: LexEditorMode[];
  canWrite: boolean;
  provider: LexEditorProviderConfig;
  lockStatus: LexEditorLockStatus;
  providerPill: StatusPillStatus;
  lockPill: StatusPillStatus;
  snapshotAllowed: boolean;
  onModeChange: (mode: LexEditorMode) => void;
}) {
  const labels = useEditorLabels();
  return (
    <div className="rounded-2xl border border-border/80 bg-card/80 p-3 shadow-sm">
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border bg-background p-1" aria-label={labels.aria.editorMode}>
            {LEX_EDITOR_MODES.map((value) => {
              const Icon = MODE_META[value].icon;
              const disabled = !availableModes.includes(value) || (value === 'edit' && !canWrite);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  disabled={disabled}
                  className={cn(
                    'inline-flex h-9 min-w-[6.25rem] items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
                    mode === value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground',
                  )}
                  onClick={() => onModeChange(value)}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {labels.modes[value]}
                </button>
              );
            })}
          </div>
          <StatusPill status={providerPill} label={provider.label} size="sm" />
          <StatusPill status={lockPill} label={lockLabel(lockStatus, labels)} size="sm" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!provider.hasConfig}
            onClick={() => actionToast(labels.commandBar.save, labels)}
          >
            <Save className="me-1.5 h-4 w-4" aria-hidden />
            {labels.commandBar.save}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!snapshotAllowed}
            onClick={() => actionToast(labels.commandBar.snapshot, labels)}
          >
            <Camera className="me-1.5 h-4 w-4" aria-hidden />
            {labels.commandBar.snapshot}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => actionToast(labels.commandBar.compare, labels)}>
            <GitCompare className="me-1.5 h-4 w-4" aria-hidden />
            {labels.commandBar.compare}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => actionToast(labels.commandBar.export, labels)}>
            <Download className="me-1.5 h-4 w-4" aria-hidden />
            {labels.commandBar.export}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => actionToast(labels.commandBar.preflight, labels)}>
            <ShieldCheck className="me-1.5 h-4 w-4" aria-hidden />
            {labels.commandBar.preflight}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AutosaveRecoveryStrip({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <div className="grid gap-3 rounded-2xl border bg-muted/20 p-3 md:grid-cols-3">
      <StatusStripItem
        icon={Cloud}
        label={labels.strip.autosave}
        value={autosaveLabel(session.autosave.status, labels)}
        detail={session.autosave.message ?? labels.strip.lastSaved(formatDateTime(session.autosave.lastSavedAt, f, labels))}
        pill={<StatusPill status={autosaveStatusToPill(session.autosave.status)} label={autosaveLabel(session.autosave.status, labels)} size="sm" />}
      />
      <StatusStripItem
        icon={History}
        label={labels.strip.recovery}
        value={formatDateTime(session.autosave.recoveryPointAt, f, labels)}
        detail={session.autosave.conflictCount > 0 ? labels.strip.conflictMarkers(f.formatNumber(session.autosave.conflictCount)) : labels.strip.recoveryClear}
      />
      <StatusStripItem
        icon={Camera}
        label={labels.strip.snapshot}
        value={session.version.latestSnapshotAt ? formatDateTime(session.version.latestSnapshotAt, f, labels) : labels.strip.noSnapshot}
        detail={labels.strip.pendingChanges(f.formatNumber(session.version.pendingChanges))}
      />
    </div>
  );
}

function StatusStripItem({
  icon: Icon,
  label,
  value,
  detail,
  pill,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  pill?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl border bg-card/70 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-caps-wide text-muted-foreground">{label}</p>
          {pill}
        </div>
        <p className="mt-1 truncate text-sm font-medium text-foreground">{value}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

type LegalWorkspaceTab =
  | 'room'
  | 'playbook'
  | 'terms'
  | 'assign'
  | 'guests'
  | 'issues'
  | 'sign'
  | 'ai'
  | 'health'
  | 'privilege';

function LegalMaturitySummary({
  session,
  onSelect,
}: {
  session: LexEditorSessionConfig;
  onSelect: (tab: LegalWorkspaceTab) => void;
}) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  const score = normalizedScore(session.documentHealth.score);
  const playbookScore = normalizedScore(session.playbookEnforcement.score);
  const playbookScoreLabel =
    session.playbookEnforcement.score === undefined ? labels.na : f.formatPercent(playbookScore, { fromPercent: true, maximumFractionDigits: 0 });
  const signature = session.signatureReadiness;
  const activePrivilegeControls = session.privilegedControls.controls.filter(
    (control) => control.enabled,
  ).length;

  return (
    <div className="grid gap-3 rounded-xl border bg-card/80 p-3 shadow-sm lg:grid-cols-5">
      <MaturityTile
        icon={CircleGauge}
        label={labels.maturity.health}
        value={f.formatPercent(score, { fromPercent: true, maximumFractionDigits: 0 })}
        detail={session.documentHealth.grade ?? labels.maturity.documentReadiness}
        pill={<StatusPill status={scoreToPill(score)} label={scoreToPill(score)} size="sm" />}
        onClick={() => onSelect('health')}
      />
      <MaturityTile
        icon={Gavel}
        label={labels.maturity.playbook}
        value={
          session.playbookEnforcement.playbookName ??
          (session.playbookEnforcement.requiredClausesTotal > 0 ? labels.maturity.attached : labels.maturity.noPlaybook)
        }
        detail={labels.maturity.deviations(
          f.formatNumber(session.playbookEnforcement.deviations.length),
          playbookScoreLabel,
        )}
        onClick={() => onSelect('playbook')}
      />
      <MaturityTile
        icon={Handshake}
        label={labels.maturity.negotiation}
        value={session.negotiationRoom.phase ?? session.negotiationRoom.status}
        detail={labels.maturity.openPoints(f.formatNumber(session.negotiationRoom.openPoints))}
        pill={
          <StatusPill
            status={negotiationStatusToPill(session.negotiationRoom.status)}
            label={session.negotiationRoom.status}
            size="sm"
          />
        }
        onClick={() => onSelect('room')}
      />
      <MaturityTile
        icon={FileSignature}
        label={labels.maturity.signature}
        value={labels.maturity.signed(
          f.formatNumber(signature.completedSigners),
          f.formatNumber(signature.requiredSigners),
        )}
        detail={
          signature.nextSignerName
            ? labels.maturity.next(signature.nextSignerName)
            : labels.maturity.blockers(f.formatNumber(signature.blockers.length))
        }
        pill={<StatusPill status={signatureStatusToPill(signature.status)} label={signature.status} size="sm" />}
        onClick={() => onSelect('sign')}
      />
      <MaturityTile
        icon={KeyRound}
        label={labels.maturity.privilege}
        value={session.privilegedControls.privilegeLevel ?? labels.maturity.notClassified}
        detail={labels.maturity.controlsEnabled(
          f.formatNumber(activePrivilegeControls),
          f.formatNumber(session.privilegedControls.controls.length),
        )}
        onClick={() => onSelect('privilege')}
      />
    </div>
  );
}

function MaturityTile({
  icon: Icon,
  label,
  value,
  detail,
  pill,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  pill?: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      title={statisticHint(label)}
      className="h-auto min-w-0 items-start justify-start gap-3 rounded-lg bg-background p-3 text-start font-normal hover:border-primary/30 hover:bg-primary/5"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-caps-wide text-muted-foreground">{label}</p>
          {pill}
        </div>
        <p className="mt-1 truncate text-sm font-semibold">{value}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </Button>
  );
}

function ProviderEmbedHost({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const provider = session.provider;
  const iframeUrl = provider.iframeUrl ?? provider.launchUrl;
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{labels.embed.canvas}</h2>
            <Badge variant={provider.status === 'ready' ? 'success' : 'warning'}>
              {provider.label}
            </Badge>
            <Badge variant="outline" className="normal-case tracking-normal">
              {labels.modes[session.mode]} {labels.modeSuffix}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {labels.embed.hostDesc}
          </p>
        </div>
        {iframeUrl ? (
          <Button asChild variant="outline" size="sm">
            <a href={iframeUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="me-1.5 h-4 w-4" aria-hidden />
              {labels.embed.open}
            </a>
          </Button>
        ) : null}
      </div>

      {iframeUrl ? (
        <iframe
          title={labels.aria.editorFrameTitle(provider.label)}
          src={iframeUrl}
          className="h-[680px] w-full border-0 bg-background"
          sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      ) : provider.scriptUrl || provider.config ? (
        <ScriptContainerPlaceholder provider={provider} />
      ) : (
        <ProviderFallback session={session} />
      )}
    </section>
  );
}

function ScriptContainerPlaceholder({ provider }: { provider: LexEditorProviderConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <div
      id="lex-editor-provider-container"
      data-provider={provider.provider}
      className="flex min-h-[680px] items-center justify-center bg-muted/20 p-8"
    >
      <div className="max-w-xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <FileText className="h-6 w-6" aria-hidden />
        </div>
        <h3 className="mt-4 text-h4 font-semibold">{labels.embed.scriptReady}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {labels.embed.scriptReadyDesc}
        </p>
        <div className="mt-4 grid gap-2 text-start text-sm">
          {provider.scriptUrl ? (
            <div className="rounded-lg border bg-card px-3 py-2">
              <span className="font-medium">{labels.embed.scriptUrl}</span>{' '}
              <span className="break-all text-muted-foreground">{provider.scriptUrl}</span>
            </div>
          ) : null}
          <div className="rounded-lg border bg-card px-3 py-2">
            <span className="font-medium">{labels.embed.config}</span>{' '}
            <span className="text-muted-foreground">
              {provider.config ? labels.embed.configKeys(f.formatNumber(Object.keys(provider.config).length)) : labels.embed.configMissing}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderFallback({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  return (
    <div className="flex min-h-[680px] items-center justify-center bg-muted/20 p-8">
      <div className="max-w-2xl text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-warning-500/10 text-warning-700 dark:text-warning-300">
          <FileWarning className="h-7 w-7" aria-hidden />
        </div>
        <h3 className="mt-4 text-h3 font-semibold">{labels.embed.fallbackTitle}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {labels.embed.fallbackDesc}
        </p>
        <div className="mt-5 grid gap-3 rounded-xl border bg-card p-4 text-start sm:grid-cols-2">
          <FallbackDetail label={labels.embed.document} value={session.document?.title ?? session.documentId} />
          <FallbackDetail label={labels.embed.mode} value={labels.modes[session.mode]} />
          <FallbackDetail label={labels.embed.provider} value={session.provider.label} />
          <FallbackDetail label={labels.embed.version} value={session.version.currentVersion ?? labels.na} />
        </div>
      </div>
    </div>
  );
}

function FallbackDetail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-caps-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  );
}

function EditorOperationalStatus({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  const lockDetail =
    session.lock.holderName || session.lock.holderEmail
      ? `${session.lock.holderName ?? session.lock.holderEmail}${session.lock.expiresAt ? labels.operational.until(formatDateTime(session.lock.expiresAt, f, labels)) : ''}`
      : session.lock.message ?? labels.operational.noLock;

  return (
    <SectionCard
      title={labels.operational.title}
      description={labels.operational.description}
      actions={<StatusPill status={providerStatusToPill(session.provider.status)} label={session.provider.status} size="sm" />}
    >
      <div className="space-y-3">
        <OperationalRow
          icon={Cloud}
          label={labels.operational.provider}
          value={session.provider.label}
          detail={session.provider.message ?? (session.provider.hasConfig ? labels.operational.providerHasConfig : labels.operational.providerNoConfig)}
          status={providerStatusToPill(session.provider.status)}
        />
        <OperationalRow
          icon={session.lock.status === 'unlocked' ? Unlock : Lock}
          label={labels.operational.checkOut}
          value={lockLabel(session.lock.status, labels)}
          detail={lockDetail}
          status={lockStatusToPill(session.lock.status)}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!session.lock.canCheckOut && session.lock.status !== 'locked_by_me'}
              onClick={() => actionToast(session.lock.status === 'locked_by_me' ? labels.operational.release : labels.operational.checkOutAction, labels)}
            >
              {session.lock.status === 'locked_by_me' ? labels.operational.release : labels.operational.checkOutAction}
            </Button>
          }
        />
        <OperationalRow
          icon={Save}
          label={labels.operational.autosave}
          value={autosaveLabel(session.autosave.status, labels)}
          detail={session.autosave.message ?? labels.strip.lastSaved(formatDateTime(session.autosave.lastSavedAt, f, labels))}
          status={autosaveStatusToPill(session.autosave.status)}
        />
      </div>
    </SectionCard>
  );
}

function OperationalRow({
  icon: Icon,
  label,
  value,
  detail,
  status,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  status: StatusPillStatus;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-muted/20 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-caps-wide text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-sm font-medium">{value}</p>
          </div>
          <StatusPill status={status} iconOnly size="sm" />
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

function LegalMaturityPanels({
  session,
  value,
  onValueChange,
}: {
  session: LexEditorSessionConfig;
  value: LegalWorkspaceTab;
  onValueChange: (value: LegalWorkspaceTab) => void;
}) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  const score = normalizedScore(session.documentHealth.score);

  return (
    <SectionCard
      title={labels.legalWorkspace.title}
      description={labels.legalWorkspace.description}
      actions={<StatusPill status={scoreToPill(score)} label={labels.legalWorkspace.healthSuffix(f.formatNumber(score))} size="sm" />}
    >
      <Tabs value={value} onValueChange={(next) => onValueChange(next as LegalWorkspaceTab)}>
        <TabsList className="grid h-auto w-full grid-cols-5 rounded-xl p-1">
          <TabsTrigger value="room" className="h-9 gap-1 px-1 text-xs">
            <Handshake className="h-3.5 w-3.5" aria-hidden />
            {labels.legalWorkspace.tabs.room}
          </TabsTrigger>
          <TabsTrigger value="playbook" className="h-9 gap-1 px-1 text-xs">
            <Gavel className="h-3.5 w-3.5" aria-hidden />
            {labels.legalWorkspace.tabs.book}
          </TabsTrigger>
          <TabsTrigger value="terms" className="h-9 gap-1 px-1 text-xs">
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            {labels.legalWorkspace.tabs.terms}
          </TabsTrigger>
          <TabsTrigger value="assign" className="h-9 gap-1 px-1 text-xs">
            <Workflow className="h-3.5 w-3.5" aria-hidden />
            {labels.legalWorkspace.tabs.assign}
          </TabsTrigger>
          <TabsTrigger value="guests" className="h-9 gap-1 px-1 text-xs">
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {labels.legalWorkspace.tabs.guests}
          </TabsTrigger>
          <TabsTrigger value="issues" className="h-9 gap-1 px-1 text-xs">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
            {labels.legalWorkspace.tabs.issues}
          </TabsTrigger>
          <TabsTrigger value="sign" className="h-9 gap-1 px-1 text-xs">
            <FileSignature className="h-3.5 w-3.5" aria-hidden />
            {labels.legalWorkspace.tabs.sign}
          </TabsTrigger>
          <TabsTrigger value="ai" className="h-9 gap-1 px-1 text-xs">
            <Bot className="h-3.5 w-3.5" aria-hidden />
            {labels.legalWorkspace.tabs.ai}
          </TabsTrigger>
          <TabsTrigger value="health" className="h-9 gap-1 px-1 text-xs">
            <CircleGauge className="h-3.5 w-3.5" aria-hidden />
            {labels.legalWorkspace.tabs.health}
          </TabsTrigger>
          <TabsTrigger value="privilege" className="h-9 gap-1 px-1 text-xs">
            <KeyRound className="h-3.5 w-3.5" aria-hidden />
            {labels.legalWorkspace.tabs.priv}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="room">
          <NegotiationRoomPanel session={session} />
        </TabsContent>
        <TabsContent value="playbook">
          <PlaybookEnforcementPanel session={session} />
        </TabsContent>
        <TabsContent value="terms">
          <TermsCrossReferencePanel session={session} />
        </TabsContent>
        <TabsContent value="assign">
          <SectionAssignmentsPanel assignments={session.sectionAssignments} />
        </TabsContent>
        <TabsContent value="guests">
          <GuestReviewPanel guests={session.guestReviewers} />
        </TabsContent>
        <TabsContent value="issues">
          <LegalIssueTrackerPanel issues={session.legalIssues} />
        </TabsContent>
        <TabsContent value="sign">
          <SignatureReadinessPanel session={session} />
        </TabsContent>
        <TabsContent value="ai">
          <ClauseAiActionsPanel session={session} />
        </TabsContent>
        <TabsContent value="health">
          <DocumentHealthPanel session={session} />
        </TabsContent>
        <TabsContent value="privilege">
          <PrivilegedControlsPanel session={session} />
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}

function NegotiationRoomPanel({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  const room = session.negotiationRoom;

  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={Handshake}
          title={room.phase ?? labels.room.title}
          detail={labels.room.summary(f.formatNumber(room.openPoints), f.formatNumber(room.agreedPoints))}
        />
      }
      actionLabel={labels.room.openRoom}
      onAction={() => actionToast(labels.room.openRoom, labels)}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <PanelFact icon={Clock} label={labels.room.lastOffer} value={formatDateTime(room.lastOfferAt, f, labels)} />
        <PanelFact icon={CalendarClock} label={labels.room.nextSession} value={formatDateTime(room.nextSessionAt, f, labels)} />
      </div>
      {room.positionSummary ? (
        <InlineNotice icon={Scale}>{room.positionSummary}</InlineNotice>
      ) : null}
      <div className="space-y-2">
        {room.participants.length === 0 ? (
          <PanelEmpty
            icon={Users}
            title={labels.room.emptyTitle}
            description={labels.room.emptyDesc}
          />
        ) : (
          room.participants.map((participant) => (
            <div key={participant.id} className="rounded-lg border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{participant.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[participant.role, participant.organization].filter(Boolean).join(' · ') || labels.room.participant}
                  </p>
                </div>
                <Badge variant="outline">{participant.status}</Badge>
              </div>
            </div>
          ))
        )}
      </div>
    </PanelFrame>
  );
}

function PlaybookEnforcementPanel({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  const playbook = session.playbookEnforcement;
  const requiredProgress =
    playbook.requiredClausesTotal > 0
      ? Math.round((playbook.requiredClausesMet / playbook.requiredClausesTotal) * 100)
      : 0;
  const hasComplianceScore =
    playbook.score !== undefined || playbook.requiredClausesTotal > 0;
  const score = playbook.score === undefined ? requiredProgress : normalizedScore(playbook.score);

  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={Gavel}
          title={playbook.playbookName ?? labels.playbook.title}
          detail={labels.playbook.requiredClauses(
            f.formatNumber(playbook.requiredClausesMet),
            f.formatNumber(playbook.requiredClausesTotal),
          )}
        />
      }
      actionLabel={labels.playbook.runCheck}
      onAction={() => actionToast(labels.playbook.title, labels)}
    >
      <div className="rounded-lg border bg-background p-3">
        <div className="flex items-center justify-between gap-3">
          <PanelSummary
            icon={Percent}
            title={hasComplianceScore ? labels.playbook.compliant(f.formatNumber(score)) : labels.playbook.noScore}
            detail={labels.playbook.fallbackScore}
          />
          {hasComplianceScore ? (
            <StatusPill status={scoreToPill(score)} iconOnly size="sm" aria-label={labels.aria.playbookScore} />
          ) : null}
        </div>
        <Progress value={hasComplianceScore ? score : 0} className="mt-3 h-2" />
        <p className="mt-2 text-xs text-muted-foreground">
          {labels.playbook.coverage(f.formatPercent(requiredProgress, { fromPercent: true, maximumFractionDigits: 0 }))}
        </p>
      </div>
      {playbook.deviations.length === 0 ? (
        <PanelEmpty
          icon={ClipboardCheck}
          title={labels.playbook.emptyTitle}
          description={labels.playbook.emptyDesc}
        />
      ) : (
        playbook.deviations.map((deviation) => (
          <PlaybookDeviationItem key={deviation.id} deviation={deviation} />
        ))
      )}
    </PanelFrame>
  );
}

function PlaybookDeviationItem({ deviation }: { deviation: LexEditorPlaybookDeviation }) {
  const labels = useEditorLabels();
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{deviation.title}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {[deviation.section, deviation.ownerName].filter(Boolean).join(' · ') || labels.playbook.unassigned}
          </p>
        </div>
        <Badge variant={riskBadgeVariant(deviation.severity)}>{deviation.severity}</Badge>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <StatusPill status={riskToPill(deviation.severity)} label={deviation.status} size="sm" />
        <Button type="button" variant="outline" size="sm" onClick={() => actionToast(labels.playbook.waive, labels)}>
          {labels.playbook.waive}
        </Button>
      </div>
    </div>
  );
}

function TermsCrossReferencePanel({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  const { terms, crossReferences } = session.termsNavigator;

  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={Link2}
          title={labels.terms.title}
          detail={labels.terms.summary(f.formatNumber(terms.length), f.formatNumber(crossReferences.length))}
        />
      }
      actionLabel={labels.terms.scan}
      onAction={() => actionToast(labels.terms.scan, labels)}
    >
      {terms.length === 0 && crossReferences.length === 0 ? (
        <PanelEmpty
          icon={ScanSearch}
          title={labels.terms.emptyTitle}
          description={labels.terms.emptyDesc}
        />
      ) : null}
      {terms.length > 0 ? (
        <div className="space-y-2">
          <PanelGroupLabel icon={BookOpen} label={labels.terms.definedTerms} />
          {terms.map((term) => (
            <div key={term.id} className="rounded-lg border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{term.term}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {term.definition ?? term.section ?? labels.terms.definitionMissing}
                  </p>
                </div>
                <StatusPill status={termStatusToPill(term.status)} iconOnly size="sm" aria-label={term.status} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {term.section ?? labels.terms.noSection} · {labels.terms.refs(f.formatNumber(term.referenceCount ?? 0))}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {crossReferences.length > 0 ? (
        <div className="space-y-2">
          <PanelGroupLabel icon={Route} label={labels.terms.crossReferences} />
          {crossReferences.map((reference) => (
            <div key={reference.id} className="rounded-lg border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{reference.label}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {labels.terms.target(reference.target ?? labels.terms.unresolved)}
                  </p>
                </div>
                <StatusPill
                  status={crossReferenceStatusToPill(reference.status)}
                  label={reference.status}
                  size="sm"
                />
              </div>
              {reference.excerpt ? (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{reference.excerpt}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </PanelFrame>
  );
}

function SectionAssignmentsPanel({ assignments }: { assignments: LexEditorSectionAssignment[] }) {
  const labels = useEditorLabels();
  const f = useLexFormat();

  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={Workflow}
          title={labels.assignments.title(f.formatNumber(assignments.length))}
          detail={labels.assignments.detail}
        />
      }
      actionLabel={labels.assignments.assign}
      onAction={() => actionToast(labels.assignments.assign, labels)}
    >
      {assignments.length === 0 ? (
        <PanelEmpty
          icon={Milestone}
          title={labels.assignments.emptyTitle}
          description={labels.assignments.emptyDesc}
        />
      ) : (
        assignments.map((assignment) => (
          <div key={assignment.id} className="rounded-lg border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{assignment.section}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {assignment.assigneeName} · {labels.assignments.due(formatDate(assignment.dueAt, f, labels))}
                </p>
              </div>
              <StatusPill status={assignmentStatusToPill(assignment.status)} iconOnly size="sm" aria-label={assignment.status} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Badge variant={riskBadgeVariant(assignment.priority)}>{assignment.priority}</Badge>
              <Button type="button" variant="outline" size="sm" onClick={() => actionToast(labels.assignments.review, labels)}>
                {labels.assignments.review}
              </Button>
            </div>
          </div>
        ))
      )}
    </PanelFrame>
  );
}

function GuestReviewPanel({ guests }: { guests: LexEditorGuestReviewer[] }) {
  const labels = useEditorLabels();
  const f = useLexFormat();

  return (
    <PanelFrame
      header={<PanelSummary icon={UserPlus} title={labels.guests.title(f.formatNumber(guests.length))} detail={labels.guests.detail} />}
      actionLabel={labels.guests.invite}
      onAction={() => actionToast(labels.guests.invite, labels)}
    >
      {guests.length === 0 ? (
        <PanelEmpty
          icon={UserCheck}
          title={labels.guests.emptyTitle}
          description={labels.guests.emptyDesc}
        />
      ) : (
        guests.map((guest) => (
          <div key={guest.id} className="rounded-lg border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{guest.name}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {[guest.role, guest.organization].filter(Boolean).join(' · ') || labels.guests.externalReviewer}
                </p>
              </div>
              <StatusPill status={guestStatusToPill(guest.status)} label={guest.status} size="sm" />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <PanelFact icon={Eye} label={labels.guests.access} value={guest.access} />
              <PanelFact icon={Clock} label={labels.guests.expires} value={formatDate(guest.expiresAt, f, labels)} />
            </div>
          </div>
        ))
      )}
    </PanelFrame>
  );
}

function LegalIssueTrackerPanel({ issues }: { issues: LexEditorLegalIssue[] }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  const openIssues = issues.filter((issue) => issue.status === 'open' || issue.status === 'triage');

  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={ShieldAlert}
          title={labels.issues.title(f.formatNumber(openIssues.length))}
          detail={labels.issues.total(f.formatNumber(issues.length))}
        />
      }
      actionLabel={labels.issues.newIssue}
      onAction={() => actionToast(labels.issues.newIssue, labels)}
    >
      {issues.length === 0 ? (
        <PanelEmpty
          icon={ShieldAlert}
          title={labels.issues.emptyTitle}
          description={labels.issues.emptyDesc}
        />
      ) : (
        issues.map((issue) => (
          <div key={issue.id} className="rounded-lg border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{issue.title}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {[issue.section, issue.ownerName].filter(Boolean).join(' · ') || labels.issues.unassigned} ·{' '}
                  {labels.issues.due(formatDate(issue.dueAt, f, labels))}
                </p>
              </div>
              <Badge variant={riskBadgeVariant(issue.severity)}>{issue.severity}</Badge>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <StatusPill status={issueStatusToPill(issue)} label={issue.status} size="sm" />
              <Button type="button" variant="outline" size="sm" onClick={() => actionToast(labels.issues.escalate, labels)}>
                {labels.issues.escalate}
              </Button>
            </div>
          </div>
        ))
      )}
    </PanelFrame>
  );
}

function SignatureReadinessPanel({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  const readiness = session.signatureReadiness;
  const signerProgress =
    readiness.requiredSigners > 0
      ? Math.round((readiness.completedSigners / readiness.requiredSigners) * 100)
      : 0;

  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={FileSignature}
          title={readiness.ready ? labels.signature.ready : labels.signature.title}
          detail={labels.signature.signersComplete(
            f.formatNumber(readiness.completedSigners),
            f.formatNumber(readiness.requiredSigners),
          )}
        />
      }
      actionLabel={labels.signature.prepare}
      onAction={() => actionToast(labels.signature.prepare, labels)}
    >
      <div className="rounded-lg border bg-background p-3">
        <div className="flex items-center justify-between gap-3">
          <PanelSummary icon={BadgeCheck} title={readiness.status} detail={readiness.provider ?? labels.signature.envelopePending} />
          <StatusPill status={signatureStatusToPill(readiness.status)} iconOnly size="sm" aria-label={readiness.status} />
        </div>
        <Progress value={signerProgress} className="mt-3 h-2" />
        <p className="mt-2 text-xs text-muted-foreground">
          {readiness.nextSignerName ? labels.signature.nextSigner(readiness.nextSignerName) : labels.signature.noNextSigner}
        </p>
      </div>
      {readiness.blockers.length === 0 ? (
        <InlineNotice icon={CheckCircle2}>{labels.signature.noBlockers}</InlineNotice>
      ) : (
        readiness.blockers.map((blocker, index) => (
          <div key={`${blocker}-${index}`} className="flex items-start gap-2 rounded-lg border bg-background p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-700 dark:text-warning-300" aria-hidden />
            <p className="text-sm leading-6 text-muted-foreground">{blocker}</p>
          </div>
        ))
      )}
    </PanelFrame>
  );
}

function ClauseAiActionsPanel({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  const fallbackActions: LexEditorClauseAiAction[] = session.clauseLibrary.recommendations.map(
    (recommendation) => ({
      id: `recommendation-${recommendation.id}`,
      clauseTitle: recommendation.title,
      action: labels.clauseAi.draftAlternative,
      status: session.mode === 'edit' ? 'available' : 'blocked',
      confidence: recommendation.confidence,
      targetSection: recommendation.category,
      rationale: recommendation.reason,
    }),
  );
  const actions = session.clauseAiActions.length > 0 ? session.clauseAiActions : fallbackActions;

  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={Bot}
          title={labels.clauseAi.title(f.formatNumber(actions.length))}
          detail={labels.clauseAi.detail}
        />
      }
      actionLabel={labels.clauseAi.analyze}
      onAction={() => actionToast(labels.clauseAi.analyze, labels)}
    >
      {actions.length === 0 ? (
        <PanelEmpty
          icon={Bot}
          title={labels.clauseAi.emptyTitle}
          description={labels.clauseAi.emptyDesc}
        />
      ) : (
        actions.map((action) => (
          <div key={action.id} className="rounded-lg border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{action.clauseTitle}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {[action.action, action.targetSection].filter(Boolean).join(' · ')}
                </p>
              </div>
              <StatusPill status={clauseAiStatusToPill(action.status)} iconOnly size="sm" aria-label={action.status} />
            </div>
            {action.rationale ? (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{action.rationale}</p>
            ) : null}
            <div className="mt-3 flex items-center justify-between gap-2">
              <Badge variant="outline">{labels.clauseAi.confidence(formatPercent(action.confidence, f, labels))}</Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={action.status === 'blocked'}
                onClick={() => actionToast(action.action, labels)}
              >
                {labels.clauseAi.stage}
              </Button>
            </div>
          </div>
        ))
      )}
    </PanelFrame>
  );
}

function DocumentHealthPanel({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  const score = normalizedScore(session.documentHealth.score);

  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={CircleGauge}
          title={labels.health.title(f.formatNumber(score))}
          detail={session.documentHealth.grade ?? labels.health.readinessScore}
        />
      }
      actionLabel={labels.health.refresh}
      onAction={() => actionToast(labels.health.healthScore, labels)}
    >
      <div className="rounded-lg border bg-background p-3">
        <div className="flex items-center justify-between gap-3">
          <PanelSummary
            icon={FileCheck2}
            title={session.documentHealth.summary ?? labels.health.healthScore}
            detail={labels.health.signalsDesc}
          />
          <StatusPill status={scoreToPill(score)} label={f.formatPercent(score, { fromPercent: true, maximumFractionDigits: 0 })} size="sm" />
        </div>
        <Progress value={score} className="mt-3 h-2" />
      </div>
      <div className="space-y-2">
        <PanelGroupLabel icon={SlidersHorizontal} label={labels.health.signals} />
        {session.documentHealth.metrics.map((metric) => (
          <div key={metric.id} className="rounded-lg border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{metric.label}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{metric.detail ?? metric.value}</p>
              </div>
              <StatusPill status={healthMetricStatusToPill(metric.status)} label={metric.value} size="sm" />
            </div>
          </div>
        ))}
      </div>
      {session.documentHealth.blockers.length > 0 ? (
        <InlineNotice icon={AlertTriangle}>
          {session.documentHealth.blockers.slice(0, 3).join(' · ')}
        </InlineNotice>
      ) : null}
    </PanelFrame>
  );
}

function PrivilegedControlsPanel({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  const controls = session.privilegedControls.controls;

  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={KeyRound}
          title={session.privilegedControls.privilegeLevel ?? labels.privilege.title}
          detail={labels.privilege.accessReview(formatDate(session.privilegedControls.accessReviewDueAt, f, labels))}
        />
      }
      actionLabel={labels.privilege.review}
      onAction={() => actionToast(labels.privilege.review, labels)}
    >
      {controls.length === 0 ? (
        <PanelEmpty
          icon={KeyRound}
          title={labels.privilege.emptyTitle}
          description={labels.privilege.emptyDesc}
        />
      ) : (
        controls.map((control) => <PrivilegeControlItem key={control.id} control={control} />)
      )}
      <InlineNotice icon={Lock}>
        {labels.privilege.notice}
      </InlineNotice>
    </PanelFrame>
  );
}

function AdvancedEditorOperationsPanels({ session }: { session: LexEditorSessionConfig }) {
  const blockedApprovals = session.approvalMatrix.gates.filter(
    (gate) => gate.status === 'blocked' || gate.status === 'rejected',
  ).length;
  const openTasks = session.automationTasks.filter(
    (task) => task.status === 'open' || task.status === 'in_progress',
  ).length;
  const labels = useEditorLabels();
  const f = useLexFormat();

  return (
    <SectionCard
      title={labels.advanced.title}
      description={labels.advanced.description}
      actions={
        <StatusPill
          status={blockedApprovals > 0 ? 'blocked' : openTasks > 0 ? 'running' : 'passed'}
          label={labels.advanced.active(f.formatNumber(openTasks))}
          size="sm"
        />
      }
    >
      <Tabs defaultValue="ops">
        <TabsList className="grid h-auto w-full grid-cols-4 rounded-xl p-1">
          <TabsTrigger value="ops" className="h-9 gap-1 px-1 text-xs">
            <Cloud className="h-3.5 w-3.5" aria-hidden />
            {labels.advanced.tabs.ops}
          </TabsTrigger>
          <TabsTrigger value="work" className="h-9 gap-1 px-1 text-xs">
            <Workflow className="h-3.5 w-3.5" aria-hidden />
            {labels.advanced.tabs.work}
          </TabsTrigger>
          <TabsTrigger value="structure" className="h-9 gap-1 px-1 text-xs">
            <Route className="h-3.5 w-3.5" aria-hidden />
            {labels.advanced.tabs.structure}
          </TabsTrigger>
          <TabsTrigger value="governance" className="h-9 gap-1 px-1 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {labels.advanced.tabs.governance}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ops">
          <ProviderEventsOperationsPanel session={session} />
        </TabsContent>
        <TabsContent value="work">
          <WorkflowOperationsPanel session={session} />
        </TabsContent>
        <TabsContent value="structure">
          <StructureOperationsPanel session={session} />
        </TabsContent>
        <TabsContent value="governance">
          <GovernanceOperationsPanel session={session} />
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}

function ProviderEventsOperationsPanel({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();

  return (
    <CapabilityScroll>
      <CapabilitySection
        icon={History}
        title={labels.ops.providerEvents(f.formatNumber(session.providerEvents.length))}
        detail={labels.ops.providerEventsDesc}
        actionLabel={labels.ops.syncEvents}
        onAction={() => actionToast(labels.ops.syncEvents, labels)}
      >
        {session.providerEvents.length === 0 ? (
          <PanelEmpty
            icon={History}
            title={labels.ops.providerEventsEmptyTitle}
            description={labels.ops.providerEventsEmptyDesc}
          />
        ) : (
          session.providerEvents.map((event) => (
            <ProviderEventItem key={event.id} event={event} f={f} labels={labels} />
          ))
        )}
      </CapabilitySection>
      <CapabilitySection
        icon={UserPlus}
        title={labels.ops.guestLinks(f.formatNumber(session.guestPortal.activeLinks))}
        detail={labels.ops.guestLinksDetail(
          f.formatNumber(session.guestPortal.expiredLinks),
          f.formatNumber(session.guestPortal.revokedLinks),
        )}
        actionLabel={labels.ops.reviewPortal}
        onAction={() => actionToast(labels.ops.reviewPortal, labels)}
      >
        <CapabilityItem
          icon={Eye}
          title={labels.ops.externalPortal}
          detail={labels.ops.lastActivity(formatDateTime(session.guestPortal.lastActivityAt, f, labels))}
          status={session.guestPortal.status}
          badge={session.guestPortal.watermarkEnabled ? labels.ops.watermarked : labels.ops.noWatermark}
        />
      </CapabilitySection>
      <CapabilitySection
        icon={Cloud}
        title={labels.ops.offlineRecovery}
        detail={labels.ops.offlineDetail(
          f.formatNumber(session.offlineRecovery.queuedEdits),
          f.formatNumber(session.offlineRecovery.queuedComments),
        )}
        actionLabel={labels.ops.restore}
        onAction={() => actionToast(labels.ops.restore, labels)}
      >
        <CapabilityItem
          icon={Save}
          title={session.offlineRecovery.status}
          detail={labels.ops.lastBuffer(
            formatDateTime(session.offlineRecovery.lastBufferedAt, f, labels),
            f.formatNumber(session.offlineRecovery.conflictCount),
          )}
          status={session.offlineRecovery.status}
        />
      </CapabilitySection>
    </CapabilityScroll>
  );
}

function WorkflowOperationsPanel({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <CapabilityScroll>
      <CapabilitySection
        icon={Workflow}
        title={labels.work.automationTasks(f.formatNumber(session.automationTasks.length))}
        detail={labels.work.automationTasksDesc}
        actionLabel={labels.work.createTask}
        onAction={() => actionToast(labels.work.createTask, labels)}
      >
        {session.automationTasks.length === 0 ? (
          <PanelEmpty
            icon={Workflow}
            title={labels.work.tasksEmptyTitle}
            description={labels.work.tasksEmptyDesc}
          />
        ) : (
          session.automationTasks.map((task) => <AutomationTaskItem key={task.id} task={task} />)
        )}
      </CapabilitySection>
      <CapabilitySection
        icon={ShieldCheck}
        title={labels.work.approvalMatrix}
        detail={labels.work.gates(f.formatNumber(session.approvalMatrix.gates.length), session.approvalMatrix.status)}
        actionLabel={labels.work.request}
        onAction={() => actionToast(labels.work.request, labels)}
      >
        {session.approvalMatrix.gates.length === 0 ? (
          <PanelEmpty
            icon={ShieldCheck}
            title={labels.work.gatesEmptyTitle}
            description={labels.work.gatesEmptyDesc}
          />
        ) : (
          session.approvalMatrix.gates.map((gate) => <ApprovalGateItem key={gate.id} gate={gate} />)
        )}
      </CapabilitySection>
      <CapabilitySection
        icon={MessageSquare}
        title={labels.work.inbox(f.formatNumber(session.collaborationInbox.unreadCount))}
        detail={labels.work.inboxDesc}
        actionLabel={labels.work.openInbox}
        onAction={() => actionToast(labels.work.openInbox, labels)}
      >
        {session.collaborationInbox.items.length === 0 ? (
          <PanelEmpty
            icon={MessageSquare}
            title={labels.work.inboxEmptyTitle}
            description={labels.work.inboxEmptyDesc}
          />
        ) : (
          session.collaborationInbox.items.map((item) => (
            <CollaborationInboxItem key={item.id} item={item} />
          ))
        )}
      </CapabilitySection>
    </CapabilityScroll>
  );
}

function StructureOperationsPanel({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <CapabilityScroll>
      <CapabilitySection
        icon={Route}
        title={labels.structure.clauseAnchors(f.formatNumber(session.clauseAnchors.length))}
        detail={labels.structure.clauseAnchorsDesc}
        actionLabel={labels.structure.extract}
        onAction={() => actionToast(labels.structure.extract, labels)}
      >
        {session.clauseAnchors.length === 0 ? (
          <PanelEmpty
            icon={Route}
            title={labels.structure.anchorsEmptyTitle}
            description={labels.structure.anchorsEmptyDesc}
          />
        ) : (
          session.clauseAnchors.map((anchor) => <ClauseAnchorItem key={anchor.id} anchor={anchor} />)
        )}
      </CapabilitySection>
      <CapabilitySection
        icon={Download}
        title={labels.structure.redlinePackages(f.formatNumber(session.redlinePackages.length))}
        detail={labels.structure.redlinePackagesDesc}
        actionLabel={labels.structure.generate}
        onAction={() => actionToast(labels.structure.generate, labels)}
      >
        {session.redlinePackages.length === 0 ? (
          <PanelEmpty
            icon={Download}
            title={labels.structure.packagesEmptyTitle}
            description={labels.structure.packagesEmptyDesc}
          />
        ) : (
          session.redlinePackages.map((pkg) => <RedlinePackageItem key={pkg.id} pkg={pkg} />)
        )}
      </CapabilitySection>
      <CapabilitySection
        icon={GitCompare}
        title={labels.structure.compareWorkspaces(f.formatNumber(session.compareWorkspaces.length))}
        detail={labels.structure.compareWorkspacesDesc}
        actionLabel={labels.structure.compare}
        onAction={() => actionToast(labels.structure.compare, labels)}
      >
        {session.compareWorkspaces.length === 0 ? (
          <PanelEmpty
            icon={GitCompare}
            title={labels.structure.compareEmptyTitle}
            description={labels.structure.compareEmptyDesc}
          />
        ) : (
          session.compareWorkspaces.map((comparison) => (
            <CompareWorkspaceItem key={comparison.id} comparison={comparison} />
          ))
        )}
      </CapabilitySection>
      <CapabilitySection
        icon={ScanSearch}
        title={labels.structure.termRepairs(f.formatNumber(session.termRepairActions.length))}
        detail={labels.structure.termRepairsDesc}
        actionLabel={labels.structure.repair}
        onAction={() => actionToast(labels.structure.repair, labels)}
      >
        {session.termRepairActions.length === 0 ? (
          <PanelEmpty
            icon={ScanSearch}
            title={labels.structure.repairsEmptyTitle}
            description={labels.structure.repairsEmptyDesc}
          />
        ) : (
          session.termRepairActions.map((repair) => <TermRepairItem key={repair.id} repair={repair} />)
        )}
      </CapabilitySection>
      <CapabilitySection
        icon={Link2}
        title={labels.structure.evidenceBindings(f.formatNumber(session.evidenceBindings.length))}
        detail={labels.structure.evidenceBindingsDesc}
        actionLabel={labels.structure.bind}
        onAction={() => actionToast(labels.structure.bind, labels)}
      >
        {session.evidenceBindings.length === 0 ? (
          <PanelEmpty
            icon={Link2}
            title={labels.structure.evidenceEmptyTitle}
            description={labels.structure.evidenceEmptyDesc}
          />
        ) : (
          session.evidenceBindings.map((binding) => (
            <EvidenceBindingItem key={binding.id} binding={binding} />
          ))
        )}
      </CapabilitySection>
    </CapabilityScroll>
  );
}

function GovernanceOperationsPanel({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <CapabilityScroll>
      <CapabilitySection
        icon={Gavel}
        title={labels.governance.ruleBuilders(f.formatNumber(session.playbookRuleLinks.length))}
        detail={labels.governance.ruleBuildersDesc}
        actionLabel={labels.governance.openRules}
        onAction={() => actionToast(labels.governance.openRules, labels)}
      >
        {session.playbookRuleLinks.length === 0 ? (
          <PanelEmpty
            icon={Gavel}
            title={labels.governance.rulesEmptyTitle}
            description={labels.governance.rulesEmptyDesc}
          />
        ) : (
          session.playbookRuleLinks.map((rule) => <PlaybookRuleItem key={rule.id} rule={rule} />)
        )}
      </CapabilitySection>
      <CapabilitySection
        icon={Bot}
        title={labels.governance.aiSafety}
        detail={labels.governance.aiSafetyDetail(
          f.formatNumber(session.aiChangeSafety.pendingProposals),
          f.formatNumber(session.aiChangeSafety.requiredApprovals),
        )}
        actionLabel={labels.governance.configure}
        onAction={() => actionToast(labels.governance.aiSafety, labels)}
      >
        <CapabilityItem
          icon={Bot}
          title={session.aiChangeSafety.enabled ? session.aiChangeSafety.mode : labels.governance.disabled}
          detail={
            session.aiChangeSafety.blockers.length > 0
              ? session.aiChangeSafety.blockers.slice(0, 2).join(' · ')
              : labels.governance.aiSafetyFallback
          }
          status={session.aiChangeSafety.enabled ? session.aiChangeSafety.mode : 'blocked'}
        />
      </CapabilitySection>
      <CapabilitySection
        icon={CircleGauge}
        title={labels.governance.analytics}
        detail={labels.governance.analyticsDetail(
          f.formatNumber(session.editorAnalytics.revisionCount),
          f.formatNumber(session.editorAnalytics.unresolvedIssueCount),
        )}
        actionLabel={labels.governance.refresh}
        onAction={() => actionToast(labels.governance.analytics, labels)}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <PanelFact icon={Clock} label={labels.governance.cycleTime} value={formatHours(session.editorAnalytics.cycleTimeHours, f, labels)} />
          <PanelFact icon={ListChecks} label={labels.governance.approvalDelay} value={formatHours(session.editorAnalytics.approvalDelayHours, f, labels)} />
          <PanelFact icon={UserCheck} label={labels.governance.externalReview} value={formatHours(session.editorAnalytics.externalReviewTurnaroundHours, f, labels)} />
          <PanelFact
            icon={Percent}
            label={labels.governance.deviationRate}
            value={formatPercent(session.editorAnalytics.playbookDeviationRate, f, labels)}
          />
        </div>
        <CapabilityItem
          icon={FileSignature}
          title={labels.governance.signatureTrend}
          detail={session.editorAnalytics.signatureReadinessTrend ?? labels.governance.noTrend}
          status={session.editorAnalytics.signatureReadinessTrend === 'declining' ? 'needs_review' : 'ready'}
        />
      </CapabilitySection>
    </CapabilityScroll>
  );
}

function ProviderEventItem({ event, f, labels }: { event: LexEditorProviderEvent; f: LexFmt; labels: EditorLabels }) {
  return (
    <CapabilityItem
      icon={History}
      title={event.eventType}
      detail={[event.provider, event.summary, formatDateTime(event.createdAt, f, labels)].filter(Boolean).join(' · ')}
      status={event.status}
    />
  );
}

function AutomationTaskItem({ task }: { task: LexEditorAutomationTask }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <CapabilityItem
      icon={Workflow}
      title={task.title}
      detail={[task.taskType, task.ownerName ?? labels.work.unassigned, labels.work.due(formatDate(task.dueAt, f, labels))].join(' · ')}
      status={task.status}
      badge={task.priority}
    />
  );
}

function ApprovalGateItem({ gate }: { gate: LexEditorApprovalGate }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <CapabilityItem
      icon={ShieldCheck}
      title={gate.name}
      detail={[gate.approverName ?? labels.work.noApprover, labels.work.due(formatDate(gate.dueAt, f, labels))].join(' · ')}
      status={gate.status}
      badge={gate.required ? labels.work.required : gate.severity}
    />
  );
}

function CollaborationInboxItem({ item }: { item: LexEditorCollaborationInboxItem }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <CapabilityItem
      icon={MessageSquare}
      title={item.title}
      detail={[item.itemType, item.actorName, formatDateTime(item.createdAt, f, labels)].filter(Boolean).join(' · ')}
      status={item.status}
      badge={item.priority}
    />
  );
}

function ClauseAnchorItem({ anchor }: { anchor: LexEditorClauseAnchor }) {
  return (
    <CapabilityItem
      icon={Route}
      title={anchor.label}
      detail={[anchor.path, anchor.section, anchor.excerpt].filter(Boolean).join(' · ')}
      status={anchor.status}
    />
  );
}

function RedlinePackageItem({ pkg }: { pkg: LexEditorRedlinePackage }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <CapabilityItem
      icon={Download}
      title={pkg.packageType ?? labels.structure.redlinePackage}
      detail={[pkg.formats.join(', ') || labels.structure.noFormats, pkg.summary, formatDateTime(pkg.createdAt, f, labels)].filter(Boolean).join(' · ')}
      status={pkg.status}
      badge={pkg.downloadUrl ? 'download' : undefined}
    />
  );
}

function CompareWorkspaceItem({ comparison }: { comparison: LexEditorCompareWorkspace }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <CapabilityItem
      icon={GitCompare}
      title={[comparison.baseLabel ?? labels.structure.base, comparison.targetLabel ?? labels.structure.target].join(' vs ')}
      detail={labels.structure.changes(
        f.formatNumber(comparison.changesCount),
        f.formatNumber(comparison.materialChangesCount),
      )}
      status={comparison.status}
      badge={comparison.redlineUrl ? 'redline' : undefined}
    />
  );
}

function TermRepairItem({ repair }: { repair: LexEditorTermRepairAction }) {
  return (
    <CapabilityItem
      icon={ScanSearch}
      title={repair.term}
      detail={[repair.action, repair.section, repair.preview].filter(Boolean).join(' · ')}
      status={repair.status}
      badge={repair.severity}
    />
  );
}

function EvidenceBindingItem({ binding }: { binding: LexEditorEvidenceBinding }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <CapabilityItem
      icon={Link2}
      title={binding.title}
      detail={[binding.sourceType, binding.section, binding.citation].filter(Boolean).join(' · ')}
      status={binding.status}
      badge={formatPercent(binding.confidence, f, labels)}
    />
  );
}

function PlaybookRuleItem({ rule }: { rule: LexEditorPlaybookRuleLink }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <CapabilityItem
      icon={Gavel}
      title={rule.name}
      detail={`${labels.governance.rules(f.formatNumber(rule.ruleCount))} · ${labels.governance.updated(formatDate(rule.updatedAt, f, labels))}`}
      status={rule.status}
      badge={rule.href ? 'open' : undefined}
    />
  );
}

function CapabilityScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="h-[440px] rounded-xl border bg-muted/10 p-3">
      <div className="space-y-4">{children}</div>
    </ScrollArea>
  );
}

function CapabilitySection({
  icon: Icon,
  title,
  detail,
  actionLabel,
  onAction,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  actionLabel: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <PanelSummary icon={Icon} title={title} detail={detail} />
        <Button type="button" variant="outline" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function CapabilityItem({
  icon: Icon,
  title,
  detail,
  status,
  badge,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  status: string;
  badge?: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{title}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
          </div>
        </div>
        <StatusPill status={workspaceStatusToPill(status)} iconOnly size="sm" aria-label={status} />
      </div>
      {badge ? (
        <Badge variant="outline" className="mt-2 max-w-full truncate">
          {badge}
        </Badge>
      ) : null}
    </div>
  );
}

function formatHours(value: number | undefined, f: LexFmt, labels: EditorLabels): string {
  if (value === undefined) return labels.na;
  if (value < 24) return `${f.formatNumber(Math.round(value))}h`;
  return `${f.formatNumber(Math.round(value / 24))}d`;
}

function PrivilegeControlItem({ control }: { control: LexEditorPrivilegeControl }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{control.label}</p>
        {control.detail ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{control.detail}</p>
        ) : null}
      </div>
      <Switch checked={control.enabled} disabled aria-label={control.label} />
    </div>
  );
}

function EditorReviewPanels({ session }: { session: LexEditorSessionConfig }) {
  const labels = useEditorLabels();
  return (
    <SectionCard title={labels.review.title} description={labels.review.description}>
      <Tabs defaultValue="comments">
        <TabsList className="grid w-full grid-cols-4 rounded-xl p-1">
          <TabsTrigger value="comments" className="gap-1 px-2">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{labels.review.tabs.comments}</span>
          </TabsTrigger>
          <TabsTrigger value="changes" className="gap-1 px-2">
            <ListChecks className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{labels.review.tabs.changes}</span>
          </TabsTrigger>
          <TabsTrigger value="clauses" className="gap-1 px-2">
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{labels.review.tabs.clauses}</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1 px-2">
            <History className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{labels.review.tabs.audit}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="comments">
          <CommentPanel comments={session.comments.threads} total={session.comments.total} unresolved={session.comments.unresolved} />
        </TabsContent>
        <TabsContent value="changes">
          <TrackChangesPanel changes={session.trackChanges.changes} enabled={session.trackChanges.enabled} total={session.trackChanges.total} />
        </TabsContent>
        <TabsContent value="clauses">
          <ClauseLibraryPanel recommendations={session.clauseLibrary.recommendations} canInsert={session.mode === 'edit' && session.provider.hasConfig} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditPanel events={session.audit} />
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}

function CommentPanel({
  comments,
  total,
  unresolved,
}: {
  comments: LexEditorCommentThread[];
  total: number;
  unresolved: number;
}) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={MessageSquare}
          title={labels.comments.unresolved(f.formatNumber(unresolved))}
          detail={labels.comments.total(f.formatNumber(total))}
        />
      }
      actionLabel={labels.comments.newThread}
      onAction={() => actionToast(labels.comments.newThread, labels)}
    >
      {comments.length === 0 ? (
        <PanelEmpty icon={MessageSquare} title={labels.comments.emptyTitle} description={labels.comments.emptyDesc} />
      ) : (
        comments.map((comment) => <CommentItem key={comment.id} comment={comment} />)
      )}
    </PanelFrame>
  );
}

function CommentItem({ comment }: { comment: LexEditorCommentThread }) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{comment.authorName}</p>
        <Badge variant={comment.status === 'resolved' ? 'secondary' : 'warning'}>
          {comment.status}
        </Badge>
      </div>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{comment.excerpt}</p>
    </div>
  );
}

function TrackChangesPanel({
  changes,
  enabled,
  total,
}: {
  changes: LexEditorTrackedChange[];
  enabled: boolean;
  total: number;
}) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={ListChecks}
          title={enabled ? labels.trackChanges.on : labels.trackChanges.off}
          detail={labels.trackChanges.total(f.formatNumber(total))}
        />
      }
      actionLabel={labels.trackChanges.reviewAll}
      onAction={() => actionToast(labels.trackChanges.reviewAll, labels)}
    >
      {changes.length === 0 ? (
        <PanelEmpty icon={ListChecks} title={labels.trackChanges.emptyTitle} description={labels.trackChanges.emptyDesc} />
      ) : (
        changes.map((change) => <TrackedChangeItem key={change.id} change={change} />)
      )}
    </PanelFrame>
  );
}

function TrackedChangeItem({ change }: { change: LexEditorTrackedChange }) {
  const labels = useEditorLabels();
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{change.authorName}</p>
        <Badge variant={change.status === 'pending' ? 'outline' : 'secondary'}>{change.status}</Badge>
      </div>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{change.summary}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => actionToast(labels.trackChanges.accept, labels)}>
          {labels.trackChanges.accept}
        </Button>
        <Button variant="outline" size="sm" onClick={() => actionToast(labels.trackChanges.reject, labels)}>
          {labels.trackChanges.reject}
        </Button>
      </div>
    </div>
  );
}

function ClauseLibraryPanel({
  recommendations,
  canInsert,
}: {
  recommendations: LexEditorClauseRecommendation[];
  canInsert: boolean;
}) {
  const labels = useEditorLabels();
  return (
    <PanelFrame
      header={
        <PanelSummary
          icon={Sparkles}
          title={labels.clauseLibrary.title}
          detail={labels.clauseLibrary.detail}
        />
      }
      actionLabel={labels.clauseLibrary.browse}
      onAction={() => actionToast(labels.clauseLibrary.browse, labels)}
    >
      {recommendations.length === 0 ? (
        <PanelEmpty
          icon={BookOpen}
          title={labels.clauseLibrary.emptyTitle}
          description={labels.clauseLibrary.emptyDesc}
        />
      ) : (
        recommendations.map((recommendation) => (
          <ClauseRecommendationItem key={recommendation.id} recommendation={recommendation} canInsert={canInsert} />
        ))
      )}
      <Separator className="my-3" />
      <div className="rounded-xl border bg-primary/5 p-3">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="text-xs leading-5 text-muted-foreground">
            {labels.clauseLibrary.notice}
          </p>
        </div>
      </div>
    </PanelFrame>
  );
}

function ClauseRecommendationItem({
  recommendation,
  canInsert,
}: {
  recommendation: LexEditorClauseRecommendation;
  canInsert: boolean;
}) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{recommendation.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {recommendation.category ?? labels.clauseLibrary.clause} · {formatPercent(recommendation.confidence, f, labels)}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!canInsert}
          onClick={() => showInfo(labels.clauseLibrary.stagedTitle, labels.clauseLibrary.stagedBody)}
        >
          {labels.clauseLibrary.insert}
        </Button>
      </div>
      {recommendation.reason ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{recommendation.reason}</p>
      ) : null}
    </div>
  );
}

function AuditPanel({ events }: { events: LexEditorAuditEvent[] }) {
  const labels = useEditorLabels();
  const f = useLexFormat();
  return (
    <PanelFrame
      header={<PanelSummary icon={History} title={labels.audit.title} detail={labels.audit.detail} />}
      actionLabel={labels.audit.export}
      onAction={() => actionToast(labels.audit.export, labels)}
    >
      {events.length === 0 ? (
        <PanelEmpty icon={History} title={labels.audit.emptyTitle} description={labels.audit.emptyDesc} />
      ) : (
        events.map((event) => (
          <div key={event.id} className="rounded-xl border bg-background p-3">
            <p className="text-sm font-medium">{event.action}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {event.actorName} · {formatDateTime(event.createdAt, f, labels)}
            </p>
            {event.detail ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{event.detail}</p> : null}
          </div>
        ))
      )}
    </PanelFrame>
  );
}

function PanelFrame({
  header,
  actionLabel,
  onAction,
  children,
}: {
  header: ReactNode;
  actionLabel: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        {header}
        <Button type="button" variant="outline" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
      <ScrollArea className="h-[360px] rounded-xl border bg-muted/10 p-3">
        <div className="space-y-3">{children}</div>
      </ScrollArea>
    </div>
  );
}

function PanelSummary({
  icon: Icon,
  title,
  detail,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function PanelGroupLabel({
  icon: Icon,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-caps-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

function PanelFact({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg border bg-muted/20 p-2.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-caps-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-xs font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function InlineNotice({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-primary/5 p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <p className="text-xs leading-5 text-muted-foreground">{children}</p>
    </div>
  );
}

function PanelEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed bg-background/70 p-5 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function EditorEmptyState() {
  const labels = useEditorLabels();
  const router = useRouter();
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  return (
    <>
      <PageHeader
        title={labels.emptyState.title}
        description={labels.emptyState.description}
        actions={<BackToDocumentsButton />}
      />
      <SectionCard title={labels.emptyState.chooseTitle} description={labels.emptyState.chooseDesc}>
        <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-6 sm:flex-row sm:items-center">
          <LexRecordPicker
            kind="document"
            ariaLabel={labels.emptyState.chooseTitle}
            value={selectedDocumentId}
            onChange={setSelectedDocumentId}
            labels={{
              select: labels.emptyState.selectDocument,
              search: labels.emptyState.searchDocuments,
            }}
            className="flex-1"
          />
          <Button
            type="button"
            disabled={!selectedDocumentId}
            onClick={() => router.push(`/lex/documents/editor?documentId=${encodeURIComponent(selectedDocumentId)}`)}
          >
            {labels.emptyState.openDocument}
          </Button>
        </div>
      </SectionCard>
    </>
  );
}

export function EditorRouteSkeleton() {
  return (
    <div className="space-y-5">
      <div className="rounded-softest border bg-card p-7">
        <div className="h-5 w-36 rounded-full bg-muted" />
        <div className="mt-5 h-9 w-80 max-w-full rounded-md bg-muted" />
        <div className="mt-3 h-4 w-[34rem] max-w-full rounded-md bg-muted" />
      </div>
      <div className="rounded-2xl border bg-card p-3">
        <div className="flex flex-wrap gap-2">
          <div className="h-9 w-72 rounded-xl bg-muted" />
          <div className="h-9 w-28 rounded-xl bg-muted" />
          <div className="h-9 w-28 rounded-xl bg-muted" />
        </div>
      </div>
      <div className="h-28 rounded-xl border bg-muted" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="h-[680px] rounded-2xl border bg-muted" />
        <div className="space-y-4">
          <div className="h-64 rounded-2xl border bg-muted" />
          <div className="h-[34rem] rounded-2xl border bg-muted" />
          <div className="h-96 rounded-2xl border bg-muted" />
        </div>
      </div>
    </div>
  );
}
