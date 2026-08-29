'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarClock,
  Check,
  CloudUpload,
  Download,
  FileCheck2,
  FileText,
  Flag,
  Gauge,
  GitBranch,
  Layers3,
  ListChecks,
  Loader2,
  Network,
  PlayCircle,
  Plug,
  RefreshCw,
  Route,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  TrendingUp,
  Undo2,
  Upload,
  Users,
  Workflow,
  XCircle,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  actOnMigrateWindowTask,
  createMigrateGateCheck,
  createMigrateMoveGroup,
  createMigrateProgram,
  createMigrateWave,
  createMigrateWindow,
  decideMigrateGoNoGo,
  decideMigrateRollbackPlan,
  downloadMigrateEvidence,
  downloadMigrateEvidenceReport,
  executeMigrateRollback,
  fetchMigrateCommandCenter,
  fetchMigrateConnectors,
  fetchMigrateDependencyGraph,
  fetchMigrateEvidenceReport,
  fetchMigrateGateChecks,
  fetchMigrateMoveGroups,
  fetchMigrateProduct,
  fetchMigratePrograms,
  fetchMigrateRollbackPlan,
  fetchMigrateRollbackRun,
  fetchMigrateStatusSummary,
  fetchMigrateWave,
  fetchMigrateWaveRunbook,
  fetchMigrateWaves,
  fetchMigrateWindowRun,
  fetchMigrateWindows,
  fetchMigrateWorkloads,
  generateMigrateRollbackRunbook,
  generateMigrateWaveRunbook,
  importMigrateWorkloads,
  invokeMigrateConnector,
  recordMigrateGateCheck,
  saveMigrateConnector,
  startMigrateWindowRun,
  submitMigrateMoveGroup,
  suggestMigrateMoveGroup,
  transitionMigrateWorkload,
  upsertMigrateRollbackPlan,
  upsertMigrateWorkload,
  validateMigrateMoveGroup,
} from '@/lib/migrate';
import { showApiError, showSuccess } from '@/lib/toast';
import type {
  MigrateConnector,
  MigrateConnectorEvidence,
  MigrateConnectorInvocation,
  MigrateCutoverWindow,
  MigrateDRRunLiveState,
  MigrateDRRunbook,
  MigrateDRTask,
  MigrateDRTaskAction,
  MigrateEvidenceReport,
  MigrateGateCheck,
  MigrateMoveGroup,
  MigrateProgram,
  MigrateProgramStatusSummary,
  MigrateRollbackPlan,
  MigrateRollbackRun,
  MigrateRunbookBinding,
  MigrateWave,
  MigrateWaveRunbook,
  MigrateWaveStatusView,
  MigrateWindowRun,
  MigrateWorkload,
  MigrateWorkloadStatus,
} from '@/types/migrate';
import { MigrateDependencyGraphView } from './dependency-graph';
import { MigrateMoveGroupApproval } from './migrate-move-group-approval';
import { MigrateNotificationRail } from './migrate-notification-rail';
import { useMigrateLabels, type MigrateLabels } from '../_lib/migrate-i18n';

type MigrateView =
  | 'overview'
  | 'portfolio'
  | 'move-groups'
  | 'waves'
  | 'wave-detail'
  | 'cutover'
  | 'command-center'
  | 'integrations';

const strategyOptions = ['rehost', 'replatform', 'repurchase', 'refactor', 'retire', 'retain'] as const;
const EMPTY_PROGRAMS: MigrateProgram[] = [];

// Mirrors backend internal/migrate WorkloadTransitionTable so the UI only offers
// the single-hop transitions the state machine will accept. The backend remains
// the authority and rejects any illegal hop with 409 invalid_transition.
const WORKLOAD_TRANSITIONS: Record<MigrateWorkloadStatus, MigrateWorkloadStatus[]> = {
  discovered: ['assessed'],
  assessed: ['planned'],
  planned: ['in_migration', 'rolled_back'],
  in_migration: ['cutover', 'rolled_back'],
  cutover: ['validated', 'rolled_back'],
  validated: ['live', 'rolled_back'],
  live: ['decommissioned', 'rolled_back'],
  decommissioned: [],
  rolled_back: ['planned'],
};

const workloadStatusLabel = (status: MigrateWorkloadStatus): string =>
  status.replace(/_/g, ' ');

const decisionBadgeVariant = (decision?: string): 'success' | 'destructive' | 'warning' | 'secondary' => {
  if (decision === 'approved' || decision === 'go') return 'success';
  if (decision === 'rejected' || decision === 'no_go') return 'destructive';
  if (!decision || decision === 'pending') return 'warning';
  return 'secondary';
};

const checkBadgeVariant = (status?: string): 'success' | 'destructive' | 'warning' | 'secondary' => {
  if (status === 'passed' || status === 'overridden') return 'success';
  if (status === 'failed') return 'destructive';
  if (!status || status === 'pending' || status === 'running') return 'warning';
  return 'secondary';
};

const navItems: Array<{ view: MigrateView; href: string; key: keyof MigrateLabels['nav'] }> = [
  { view: 'overview', href: '/migrate', key: 'overview' },
  { view: 'portfolio', href: '/migrate/portfolio', key: 'portfolio' },
  { view: 'move-groups', href: '/migrate/move-groups', key: 'moveGroups' },
  { view: 'waves', href: '/migrate/waves', key: 'waves' },
  { view: 'cutover', href: '/migrate/cutovers', key: 'cutovers' },
  { view: 'command-center', href: '/migrate/command-center', key: 'commandCenter' },
  { view: 'integrations', href: '/migrate/integrations', key: 'integrations' },
];

export function MigrateWorkspace({ view }: { view: MigrateView }) {
  const labels = useMigrateLabels();
  const queryClient = useQueryClient();
  const routeParams = useParams<{ id?: string }>();
  const routeWaveID = typeof routeParams?.id === 'string' ? routeParams.id : '';
  const [selectedProgramID, setSelectedProgramID] = useState<string>('');
  const [evidenceReportOpen, setEvidenceReportOpen] = useState(false);

  const productQuery = useQuery({ queryKey: ['migrate-product'], queryFn: fetchMigrateProduct });
  const programsQuery = useQuery({ queryKey: ['migrate-programs'], queryFn: fetchMigratePrograms });

  const programs = programsQuery.data ?? EMPTY_PROGRAMS;
  const selectedProgram = useMemo(
    () => programs.find((program) => program.id === selectedProgramID) ?? programs[0],
    [programs, selectedProgramID],
  );
  const programID = selectedProgram?.id ?? '';

  const workloadsQuery = useQuery({
    queryKey: ['migrate-workloads', programID],
    queryFn: () => fetchMigrateWorkloads(programID),
    enabled: Boolean(programID),
  });
  const groupsQuery = useQuery({
    queryKey: ['migrate-move-groups', programID],
    queryFn: () => fetchMigrateMoveGroups(programID),
    enabled: Boolean(programID),
  });
  const wavesQuery = useQuery({
    queryKey: ['migrate-waves', programID],
    queryFn: () => fetchMigrateWaves(programID),
    enabled: Boolean(programID),
  });
  const windowsQuery = useQuery({
    queryKey: ['migrate-windows', programID],
    queryFn: () => fetchMigrateWindows(programID),
    enabled: Boolean(programID),
  });
  const commandQuery = useQuery({
    queryKey: ['migrate-command-center', programID],
    queryFn: () => fetchMigrateCommandCenter(programID),
    enabled: Boolean(programID),
  });
  const connectorsQuery = useQuery({
    queryKey: ['migrate-connectors'],
    queryFn: fetchMigrateConnectors,
    enabled: view === 'integrations' || view === 'cutover',
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['migrate'] });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['migrate-programs'] }),
      queryClient.invalidateQueries({ queryKey: ['migrate-workloads', programID] }),
      queryClient.invalidateQueries({ queryKey: ['migrate-move-groups', programID] }),
      queryClient.invalidateQueries({ queryKey: ['migrate-waves', programID] }),
      queryClient.invalidateQueries({ queryKey: ['migrate-windows', programID] }),
      queryClient.invalidateQueries({ queryKey: ['migrate-command-center', programID] }),
      queryClient.invalidateQueries({ queryKey: ['migrate-connectors'] }),
    ]);
  };
  const downloadEvidence = async (format: 'csv' | 'pdf') => {
    if (!programID) return;
    try {
      const { blob, filename } = await downloadMigrateEvidence(programID, format);
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = filename ?? `migrate-evidence.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      showSuccess(labels.page.evidenceExportDownloaded, filename ?? format.toUpperCase());
    } catch (error) {
      showApiError(error);
    }
  };

  if (productQuery.isLoading || programsQuery.isLoading) {
    return <LoadingSkeleton variant="detail" label={labels.page.loadingWorkspace} />;
  }
  if (productQuery.error) {
    return <ErrorState error={productQuery.error} title={labels.page.unavailableTitle} onRetry={() => void productQuery.refetch()} />;
  }

  const product = productQuery.data;
  const workloads = workloadsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const waves = wavesQuery.data ?? [];
  const windows = windowsQuery.data ?? [];
  const connectors = connectorsQuery.data ?? [];
  const command = commandQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={labels.page.eyebrow}
        title={labels.page.title}
        description={labels.page.description}
        tags={[
          { label: product?.licensed ? labels.page.licensed : labels.page.notLicensed, tone: product?.licensed ? 'success' : 'warning' },
          { label: product?.entitlement_key ?? 'migrate.cloud_migration', tone: 'neutral' },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setEvidenceReportOpen(true)} disabled={!programID}>
              <FileText className="me-2 h-4 w-4" />
              {labels.page.exportEvidence}
            </Button>
            <Button type="button" variant="outline" onClick={() => void downloadEvidence('csv')} disabled={!programID}>
              <Download className="me-2 h-4 w-4" />
              {labels.page.auditCsv}
            </Button>
            <Button type="button" variant="outline" onClick={() => void refresh()}>
              <RefreshCw className="me-2 h-4 w-4" />
              {labels.page.refresh}
            </Button>
          </div>
        }
      />

      {selectedProgram ? (
        <EvidenceReportDialog
          program={selectedProgram}
          open={evidenceReportOpen}
          onOpenChange={setEvidenceReportOpen}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {navItems.map((item) => (
          <Button key={item.href} asChild variant={item.view === view ? 'default' : 'outline'} size="sm">
            <Link href={item.href}>{labels.nav[item.key]}</Link>
          </Button>
        ))}
      </div>

      <ProgramBar
        programs={programs}
        selectedProgram={selectedProgram}
        selectedProgramID={selectedProgramID}
        setSelectedProgramID={setSelectedProgramID}
        onChanged={refresh}
      />

      {!selectedProgram ? (
        <EmptyState
          icon={CloudUpload}
          title={labels.emptyProgram.title}
          description={labels.emptyProgram.description}
          size="compact"
        />
      ) : (
        <>
          {(view === 'overview' || view === 'command-center') && (
            <CommandCenterPanel
              program={selectedProgram}
              command={command}
              workloads={workloads}
              groups={groups}
              waves={waves}
              windows={windows}
            />
          )}
          {view === 'portfolio' && (
            <PortfolioPanel programID={programID} workloads={workloads} loading={workloadsQuery.isLoading} onChanged={refresh} />
          )}
          {view === 'move-groups' && (
            <MoveGroupsPanel programID={programID} workloads={workloads} groups={groups} onChanged={refresh} />
          )}
          {view === 'waves' && (
            <WavesPanel programID={programID} groups={groups} waves={waves} onChanged={refresh} />
          )}
          {view === 'wave-detail' && (
            <WaveDetailPanel waveID={routeWaveID} waves={waves} onChanged={refresh} />
          )}
          {view === 'cutover' && (
            <CutoverPanel programID={programID} waves={waves} windows={windows} connectors={connectors} routeWindowID={routeWaveID || undefined} onChanged={refresh} />
          )}
          {view === 'integrations' && (
            <IntegrationsPanel connectors={connectors} windows={windows} onChanged={refresh} />
          )}
        </>
      )}
    </div>
  );
}

// EvidenceReportDialog renders the STRUCTURED, regulator-ready evidence report
// (P10b) as an on-screen sectioned document: a summary rollup, then a section per
// wave (move groups → runbook binding → each window's go/no-go decision +
// rationale, its gate checks with recorded evidence, and the cutover run's REAL
// per-task outcomes), then workflow approvals, rollback provenance, and the
// connector invocations the runs drove. The same document downloads as a sectioned
// PDF. This is a structured aggregate — NOT the flat audit-row CSV dump. Fields the
// backend omits (e.g. an un-hydrated run's tasks, an empty rationale) are simply
// not rendered.
function EvidenceReportDialog({
  program,
  open,
  onOpenChange,
}: {
  program: MigrateProgram;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const labels = useMigrateLabels();
  const reportQuery = useQuery({
    queryKey: ['migrate-evidence-report', program.id],
    queryFn: () => fetchMigrateEvidenceReport(program.id),
    enabled: open && Boolean(program.id),
  });
  const [downloading, setDownloading] = useState(false);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const { blob, filename } = await downloadMigrateEvidenceReport(program.id);
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = filename ?? `${program.reference}-migration-evidence-report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      showSuccess(labels.evidence.downloaded, filename ?? 'PDF');
    } catch (error) {
      showApiError(error);
    } finally {
      setDownloading(false);
    }
  };

  const report = reportQuery.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {labels.evidence.reportTitle(program.reference)}
          </DialogTitle>
          <DialogDescription>
            {labels.evidence.reportDescription}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[62vh] pe-3">
          {reportQuery.isLoading ? (
            <LoadingSkeleton variant="detail" label={labels.evidence.assembling} />
          ) : reportQuery.error ? (
            <ErrorState
              error={reportQuery.error}
              title={labels.evidence.assembleErrorTitle}
              onRetry={() => void reportQuery.refetch()}
            />
          ) : report ? (
            <EvidenceReportBody report={report} />
          ) : null}
        </ScrollArea>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.evidence.close}
          </Button>
          <Button type="button" onClick={() => void downloadPdf()} disabled={downloading || reportQuery.isLoading}>
            {downloading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Download className="me-2 h-4 w-4" />}
            {labels.evidence.downloadPdf}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// EvidenceReportBody renders the sectioned document. Every section reads from the
// backend EvidenceReport aggregate; empty sections are hidden rather than shown as
// empty tables so the document stays honest about what evidence exists.
function EvidenceReportBody({ report }: { report: MigrateEvidenceReport }) {
  const labels = useMigrateLabels();
  const s = report.summary;
  const summaryStats: Array<{ label: string; value: string | number }> = [
    { label: labels.evidence.statWaves, value: labels.evidence.statWavesValue(s.completed_waves, s.wave_count) },
    { label: labels.evidence.statRolledBack, value: s.rolled_back_waves },
    { label: labels.evidence.statMoveGroups, value: s.move_group_count },
    { label: labels.evidence.statWorkloads, value: s.workload_count },
    { label: labels.evidence.statWindows, value: s.window_count },
    { label: labels.evidence.statCutoverRuns, value: s.cutover_run_count },
    { label: labels.evidence.statRollbackRuns, value: s.rollback_run_count },
    { label: labels.evidence.statGoNoGo, value: labels.evidence.statGoNoGoValue(s.go_decisions, s.no_go_decisions) },
    { label: labels.evidence.statGateChecks, value: s.gate_checks_recorded },
    { label: labels.evidence.statApprovals, value: s.approval_count },
    { label: labels.evidence.statConnectorInvocations, value: s.connector_invocation_count },
  ];

  return (
    <div className="space-y-5 pb-2">
      <div className="rounded-lg border bg-card p-3">
        <p className="text-sm font-semibold text-foreground">{report.program.name}</p>
        <p className="text-xs text-muted-foreground">
          {report.program.owner ? `${report.program.owner} · ` : ''}
          {report.program.status.replace(/_/g, ' ')} · {labels.evidence.generatedAt(formatDateTime(report.generated_at))}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {summaryStats.map((stat) => (
            <div key={stat.label} className="rounded-md border bg-background p-2">
              <p className="text-overline uppercase text-muted-foreground">{stat.label}</p>
              <p className="text-sm font-semibold text-foreground">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>

      <EvidenceSection icon={Route} title={labels.evidence.wavesTitle(report.waves.length)} empty={labels.evidence.noWaves}>
        {report.waves.map((we) => (
          <div key={we.wave.id} className="space-y-2 rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={waveStatusVariant(we.wave.status)}>{we.wave.status.replace(/_/g, ' ')}</Badge>
              <span className="text-sm font-semibold text-foreground">{we.wave.reference} · {we.wave.name}</span>
              <span className="ms-auto text-xs text-muted-foreground">{labels.evidence.sequence(we.wave.sequence)}</span>
            </div>
            {we.runbook_binding ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{labels.evidence.runbookLabel}</span>{' '}
                {we.runbook_binding.role} · {we.runbook_binding.status} ·{' '}
                <code className="font-mono">{we.runbook_binding.dr_runbook_id}</code>
              </p>
            ) : null}
            {we.move_groups.length ? (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{labels.evidence.moveGroupsLabel}</span>
                <ul className="mt-1 space-y-0.5">
                  {we.move_groups.map((group) => (
                    <li key={group.id}>
                      {group.reference} · {group.name} · {group.status.replace(/_/g, ' ')} · {labels.evidence.workloadsCount(group.workloads?.length ?? 0)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {we.windows.map((wnde) => (
              <div key={wnde.window.id} className="space-y-2 rounded-md border bg-background p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={decisionBadgeVariant(wnde.window.decision)}>{wnde.window.decision}</Badge>
                  <span className="text-xs font-semibold text-foreground">{wnde.window.reference} · {wnde.window.name}</span>
                </div>
                {wnde.window.rationale ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{labels.evidence.decisionRationaleLabel}</span> {wnde.window.rationale}
                  </p>
                ) : null}
                {wnde.gate_checks.length ? (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{labels.evidence.gateChecksLabel}</span>
                    <ul className="mt-1 space-y-0.5">
                      {wnde.gate_checks.map((check) => (
                        <li key={check.id}>
                          [{check.kind}] {check.name}:{' '}
                          <Badge variant={checkBadgeVariant(check.status)} className="align-middle">{check.status}</Badge>
                          {check.evidence ? <span> {labels.evidence.evidenceInline} {check.evidence}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {wnde.cutover_run ? (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{labels.evidence.cutoverRunLabel}</span>{' '}
                    <Badge variant={runStatusVariant(wnde.cutover_run.status)} className="align-middle">
                      {wnde.cutover_run.status || labels.evidence.notStarted}
                    </Badge>
                    {wnde.cutover_run.dr_run_id ? (
                      <> · <code className="font-mono">{wnde.cutover_run.dr_run_id}</code></>
                    ) : null}
                    {wnde.cutover_run.tasks?.length ? (
                      <ul className="mt-1 space-y-0.5">
                        {wnde.cutover_run.tasks.map((task) => (
                          <li key={task.task_key}>
                            {task.name}{' '}
                            <Badge variant={taskRunStatusVariant(task.status)} className="align-middle">
                              {taskRunStatusLabel(task.status, labels)}
                            </Badge>
                            {task.required ? <Badge variant="outline" className="ms-1 align-middle">{labels.evidence.requiredBadge}</Badge> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </EvidenceSection>

      <EvidenceSection icon={ShieldCheck} title={labels.evidence.approvalsTitle(report.approvals.length)} empty={labels.evidence.noApprovals}>
        {report.approvals.map((approval) => (
          <div key={`${approval.subject_type}-${approval.subject_id}-${approval.workflow_instance_id}`} className="rounded-lg border bg-card p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{approval.subject_type.replace(/_/g, ' ')}</Badge>
              <Badge variant={approval.decision === 'approved' ? 'success' : approval.decision === 'rejected' ? 'destructive' : 'warning'}>
                {approval.decision ?? approval.status}
              </Badge>
              <code className="ms-auto font-mono text-caption text-muted-foreground">{labels.evidence.instanceInline} {approval.workflow_instance_id}</code>
            </div>
            {approval.rationale ? <p className="mt-1 text-muted-foreground">{labels.evidence.rationaleLabel} {approval.rationale}</p> : null}
            {approval.decided_at ? <p className="mt-1 text-muted-foreground">{labels.evidence.decided(formatDateTime(approval.decided_at))}</p> : null}
          </div>
        ))}
      </EvidenceSection>

      <EvidenceSection icon={Undo2} title={labels.evidence.rollbacksTitle(report.rollbacks.length)} empty={labels.evidence.noRollbacks}>
        {report.rollbacks.map((rollback) => (
          <div key={rollback.dr_run_id} className="rounded-lg border bg-card p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={rollbackRunStatusVariant(rollback.status)}>{rollback.status}</Badge>
              <code className="ms-auto font-mono text-caption text-muted-foreground">{labels.evidence.runInline} {rollback.dr_run_id}</code>
            </div>
            <p className="mt-1 text-muted-foreground"><span className="font-medium text-foreground">{labels.evidence.reasonLabel}</span> {rollback.reason}</p>
            <p className="mt-1 text-muted-foreground">{labels.evidence.triggered(formatDateTime(rollback.created_at))}</p>
          </div>
        ))}
      </EvidenceSection>

      <EvidenceSection
        icon={Plug}
        title={labels.evidence.connectorsTitle(report.connector_invocations.length)}
        empty={labels.evidence.noConnectors}
      >
        {report.connector_invocations.map((inv, index) => (
          <ConnectorEvidenceRow key={`${inv.connector_id}-${inv.task_key ?? inv.action}-${index}`} invocation={inv} />
        ))}
      </EvidenceSection>
    </div>
  );
}

function ConnectorEvidenceRow({ invocation }: { invocation: MigrateConnectorEvidence }) {
  const labels = useMigrateLabels();
  return (
    <div className="rounded-lg border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{connectorSourceLabel(invocation.source, labels)}</Badge>
        <span className="font-semibold text-foreground">{invocation.action}</span>
        <Badge variant={connectorInvocationVariant(invocation)}>
          {invocation.status}
          {invocation.http_status ? ` · HTTP ${invocation.http_status}` : ''}
        </Badge>
        <code className="ms-auto font-mono text-caption text-muted-foreground">{invocation.connector_id}</code>
      </div>
      <p className="mt-1 text-muted-foreground">
        {invocation.task_key ? <>{labels.evidence.viaTask} <code className="font-mono">{invocation.task_key}</code> · </> : null}
        {invocation.dr_run_id ? <>{labels.evidence.runInline} <code className="font-mono">{invocation.dr_run_id}</code> · </> : null}
        {formatDateTime(invocation.created_at)}
      </p>
      {invocation.error_message ? <p className="mt-1 text-destructive">{invocation.error_message}</p> : null}
    </div>
  );
}

// EvidenceSection is a titled section that hides itself when empty (an honest
// "no evidence of X" rather than a blank table).
function EvidenceSection({
  icon: Icon,
  title,
  empty,
  children,
}: {
  icon: React.ElementType;
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) && children.length > 0 : Boolean(children);
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4" />
        {title}
      </h3>
      {hasChildren ? <div className="space-y-2">{children}</div> : <p className="text-xs text-muted-foreground">{empty}</p>}
    </section>
  );
}

// connectorSourceLabel renders a connector-invocation source honestly: a manual
// per-window invocation, or one driven automatically by a cutover/rollback run.
function connectorSourceLabel(source: MigrateConnectorEvidence['source'], labels: MigrateLabels): string {
  if (source === 'cutover_run') return labels.evidence.sourceCutoverRun;
  if (source === 'rollback_run') return labels.evidence.sourceRollbackRun;
  return labels.evidence.sourceManual;
}

function connectorInvocationVariant(
  invocation: Pick<MigrateConnectorEvidence, 'status' | 'http_status'>,
): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (invocation.status === 'succeeded' || invocation.status === 'success') return 'success';
  if (invocation.status === 'failed' || invocation.status === 'error') return 'destructive';
  if (invocation.http_status && invocation.http_status >= 400) return 'destructive';
  return 'secondary';
}

// connectorInvocationsForWindow indexes a program's evidence-report connector
// invocations for one window + source (cutover_run / rollback_run) by their
// task_key, so a live-run task can surface the ACTUAL invocation it drove. Only
// run-driven invocations carry a task_key; manual invocations (no task_key) are
// skipped here — they belong to the Integrations tab / evidence report, not a task.
// When two invocations share a task_key (an idempotent re-drive) the most recent
// wins.
function connectorInvocationsForWindow(
  report: MigrateEvidenceReport | undefined,
  windowID: string,
  source: MigrateConnectorEvidence['source'],
): Map<string, MigrateConnectorEvidence> {
  const out = new Map<string, MigrateConnectorEvidence>();
  if (!report || !windowID) return out;
  for (const inv of report.connector_invocations) {
    if (inv.window_id !== windowID || inv.source !== source || !inv.task_key) continue;
    const existing = out.get(inv.task_key);
    if (!existing || inv.created_at > existing.created_at) {
      out.set(inv.task_key, inv);
    }
  }
  return out;
}

function ProgramBar({
  programs,
  selectedProgram,
  selectedProgramID,
  setSelectedProgramID,
  onChanged,
}: {
  programs: MigrateProgram[];
  selectedProgram?: MigrateProgram;
  selectedProgramID: string;
  setSelectedProgramID: (value: string) => void;
  onChanged: () => Promise<void>;
}) {
  const labels = useMigrateLabels();
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const createMutation = useMutation({
    mutationFn: createMigrateProgram,
    onSuccess: async (program) => {
      showSuccess(labels.program.created, program.reference);
      setName('');
      setOwner('');
      setSelectedProgramID(program.id);
      await onChanged();
    },
    onError: showApiError,
  });

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-end">
        <div className="min-w-[260px] flex-1">
          <Label>{labels.program.label}</Label>
          <Select value={selectedProgramID || selectedProgram?.id || ''} onValueChange={setSelectedProgramID}>
            <SelectTrigger>
              <SelectValue placeholder={labels.program.selectProgram} />
            </SelectTrigger>
            <SelectContent>
              {programs.map((program) => (
                <SelectItem key={program.id} value={program.id}>
                  {program.reference} · {program.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid flex-[2] gap-3 md:grid-cols-2">
          <div>
            <Label>{labels.program.newProgram}</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={labels.program.programPlaceholder} />
          </div>
          <div>
            <Label>{labels.program.owner}</Label>
            <Input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder={labels.program.ownerPlaceholder} />
          </div>
        </div>
        <Button
          type="button"
          disabled={!name.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate({ name, owner, description: labels.program.defaultDescription })}
        >
          <CloudUpload className="me-2 h-4 w-4" />
          {labels.program.create}
        </Button>
      </CardContent>
    </Card>
  );
}

function CommandCenterPanel({
  program,
  command,
  workloads,
  groups,
  waves,
  windows,
}: {
  program: MigrateProgram;
  command?: Awaited<ReturnType<typeof fetchMigrateCommandCenter>>;
  workloads: MigrateWorkload[];
  groups: MigrateMoveGroup[];
  waves: MigrateWave[];
  windows: MigrateCutoverWindow[];
}) {
  const labels = useMigrateLabels();
  const summary = command?.summary;
  const readiness = summary?.readiness_average ?? average(workloads.map((item) => item.readiness_score));
  const variance = command?.variance_seconds ?? 0;
  const blockers = command?.readiness_blockers ?? [];
  const waveStatuses = command?.wave_statuses ?? [];
  const [showExec, setShowExec] = useState(false);
  // Variance is actual-minus-planned across completed waves: negative = ahead of
  // schedule, positive = behind. The sign drives the copy + tone.
  const varianceLabel = formatVariance(variance, labels);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant={showExec ? 'default' : 'outline'}
          onClick={() => setShowExec((value) => !value)}
        >
          <Users className="me-2 h-4 w-4" />
          {showExec ? labels.command.hideExecutiveSummary : labels.command.executiveSummary}
        </Button>
      </div>
      {showExec ? <StakeholderSummaryPanel programID={program.id} /> : null}
      <div className="grid gap-4 md:grid-cols-5">
        <DetailStatCard label={labels.command.workloads} value={summary?.total_workloads ?? workloads.length} tone="sky" icon={Layers3} />
        <DetailStatCard label={labels.command.moveGroups} value={command?.move_groups.length ?? groups.length} tone="emerald" icon={Network} />
        <DetailStatCard label={labels.command.waves} value={command?.waves.length ?? waves.length} tone="slate" icon={Route} />
        <DetailStatCard label={labels.command.readiness} value={`${readiness}%`} tone={readiness >= 80 ? 'emerald' : 'gold'} icon={ShieldCheck} />
        <DetailStatCard
          label={labels.command.scheduleVariance}
          value={varianceLabel}
          tone={variance > 0 ? 'gold' : 'emerald'}
          icon={variance > 0 ? TrendingUp : Gauge}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{labels.command.commandCenterTitle(program.reference)}</CardTitle>
          <CardDescription>{labels.command.commandCenterDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">{labels.command.portfolioReadiness}</span>
                <span className="text-muted-foreground">{readiness}%</span>
              </div>
              <Progress value={readiness} />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {(command?.critical_path.milestones ?? []).map((milestone) => (
                <div key={milestone.label} className="rounded-lg border bg-card p-3">
                  <p className="text-xs uppercase tracking-caps-xwide text-muted-foreground">{milestone.label}</p>
                  <p className="mt-1 text-lg font-semibold">{formatDuration(milestone.offset_seconds)}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">{labels.command.waveProgress}</p>
              <EntityList
                title=""
                empty={labels.command.noWavesCreated}
                items={waveStatuses}
                render={(view) => (
                  <div key={view.wave_id} className="rounded-lg border bg-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{view.reference} · {view.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {view.status.replace(/_/g, ' ')}
                          {view.run_status ? ` · ${labels.command.runPrefix(view.run_status)}` : ''}
                          {view.variance_seconds !== 0
                            ? ` · ${view.variance_seconds < 0 ? formatDuration(Math.abs(view.variance_seconds)) + ' ' + labels.command.aheadSuffix : formatDuration(view.variance_seconds) + ' ' + labels.command.behindSuffix}`
                            : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-muted-foreground">{view.completion_percent}%</span>
                    </div>
                    <Progress className="mt-2" value={view.completion_percent} />
                  </div>
                )}
              />
            </div>
            <EntityList
              title={labels.command.upcomingCutovers}
              empty={labels.command.noWindowsScheduled}
              items={(command?.upcoming_windows ?? windows).slice(0, 5)}
              render={(window) => (
                <Row key={window.id} icon={CalendarClock} title={`${window.reference} · ${window.name}`} meta={`${formatDateTime(window.starts_at)} · ${window.decision}`} />
              )}
            />
          </div>
          <div className="space-y-4">
            <EntityList
              title={blockers.length ? labels.command.readinessBlockersCount(blockers.length) : labels.command.readinessBlockers}
              empty={labels.command.noOpenBlockers}
              items={blockers}
              render={(check) => (
                <Row
                  key={check.id}
                  icon={AlertTriangle}
                  title={check.name}
                  meta={`${check.kind} · ${check.status}${check.result ? ` · ${check.result}` : ''}`}
                />
              )}
            />
            <EntityList
              title={labels.command.recentAudit}
              empty={labels.command.noAuditEvents}
              items={command?.recent_audit ?? []}
              render={(event) => (
                <Row key={event.id} icon={FileCheck2} title={event.action} meta={`${formatDateTime(event.occurred_at)} · ${event.summary}`} />
              )}
            />
          </div>
        </CardContent>
      </Card>
      <MigrateNotificationRail />
    </div>
  );
}

// waveStatusVariant maps a wave lifecycle status to a badge tone for the exec view.
function waveStatusVariant(status: MigrateWaveStatusView['status']): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (status === 'completed') return 'success';
  if (status === 'rolled_back') return 'destructive';
  if (status === 'in_progress' || status === 'cutover') return 'warning';
  return 'secondary';
}

// StakeholderSummaryPanel renders the concise, read-only executive/stakeholder view
// of a program: overall %complete, the wave/blocker counts, schedule variance, the
// in-flight run (if any), a per-wave rollup, and the open blockers — projected over
// the dedicated GET /programs/{id}/status-summary endpoint (migrate:read). It is a
// glanceable digest for non-operators, distinct from the operational command center.
function StakeholderSummaryPanel({ programID }: { programID: string }) {
  const labels = useMigrateLabels();
  const query = useQuery({
    queryKey: ['migrate-status-summary', programID],
    queryFn: () => fetchMigrateStatusSummary(programID),
    enabled: Boolean(programID),
  });

  if (query.isLoading) {
    return <LoadingSkeleton variant="detail" label={labels.exec.loading} />;
  }
  if (query.error) {
    return <ErrorState error={query.error} title={labels.exec.loadFailed} onRetry={() => void query.refetch()} />;
  }
  const summary: MigrateProgramStatusSummary | undefined = query.data;
  if (!summary) return null;

  const current = summary.current_run ?? null;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          {labels.exec.title(summary.program.reference)}
        </CardTitle>
        <CardDescription>
          {summary.program.name}
          {summary.program.owner ? ` · ${summary.program.owner}` : ''} · {labels.exec.descriptionSuffix}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DetailStatCard
            label={labels.exec.overallComplete}
            value={`${summary.overall_percent}%`}
            tone={summary.overall_percent >= 100 ? 'emerald' : 'sky'}
            icon={BarChart3}
          />
          <DetailStatCard
            label={labels.exec.wavesSection}
            value={labels.exec.wavesComplete(summary.completed_waves, summary.wave_count)}
            tone="slate"
            icon={Route}
          />
          <DetailStatCard
            label={labels.exec.scheduleVariance}
            value={formatVariance(summary.variance_seconds, labels)}
            tone={summary.variance_seconds > 0 ? 'gold' : 'emerald'}
            icon={summary.variance_seconds > 0 ? TrendingUp : Gauge}
          />
          <DetailStatCard
            label={labels.exec.openBlockers}
            value={summary.blocker_count}
            tone={summary.blocker_count > 0 ? 'gold' : 'emerald'}
            icon={Flag}
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">{labels.exec.programCompletion}</span>
            <span className="text-muted-foreground">{summary.overall_percent}%</span>
          </div>
          <Progress value={summary.overall_percent} />
          <p className="mt-1 text-xs text-muted-foreground">
            {labels.exec.workloadsReadiness(summary.total_workloads, summary.readiness_average)}
          </p>
        </div>

        {current ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
            <PlayCircle className="h-4 w-4 text-primary" />
            <span className="font-medium">{labels.exec.inFlightCutover}</span>
            <span>{current.reference} · {current.name}</span>
            {current.run_status ? <Badge variant="warning">{labels.command.runPrefix(current.run_status)}</Badge> : null}
            <span className="text-xs text-muted-foreground">{labels.exec.complete(current.completion_percent)}</span>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="mb-2 text-sm font-medium">{labels.exec.wavesSection}</p>
            <EntityList
              title=""
              empty={labels.exec.noWavesPlanned}
              items={summary.waves}
              render={(wave) => (
                <div key={wave.wave_id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{wave.reference} · {wave.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {wave.status.replace(/_/g, ' ')}
                        {wave.run_status ? ` · ${labels.command.runPrefix(wave.run_status)}` : ''}
                        {wave.variance_seconds !== 0 ? ` · ${formatVariance(wave.variance_seconds, labels)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={waveStatusVariant(wave.status)}>{wave.status.replace(/_/g, ' ')}</Badge>
                      <span className="text-xs font-semibold text-muted-foreground">{wave.completion_percent}%</span>
                    </div>
                  </div>
                  <Progress className="mt-2" value={wave.completion_percent} />
                </div>
              )}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">
              {summary.blockers.length ? labels.exec.openBlockersSectionCount(summary.blockers.length) : labels.exec.openBlockersSection}
            </p>
            <EntityList
              title=""
              empty={labels.exec.noOpenBlockers}
              items={summary.blockers}
              render={(check) => (
                <Row
                  key={check.id}
                  icon={AlertTriangle}
                  title={check.name}
                  meta={`${check.kind} · ${check.status}${check.result ? ` · ${check.result}` : ''}`}
                />
              )}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PortfolioPanel({ programID, workloads, loading, onChanged }: {
  programID: string;
  workloads: MigrateWorkload[];
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const labels = useMigrateLabels();
  const [form, setForm] = useState({ app_key: '', name: '', strategy: 'rehost', target_cloud: 'aws', readiness_score: 50 });
  const [csvText, setCsvText] = useState('app_key,name,source_environment,target_cloud,target_account,strategy,owner_name,owner_contact,tier,dependencies,readiness_score\n');
  const upsertMutation = useMutation({
    mutationFn: () => upsertMigrateWorkload(programID, form),
    onSuccess: async () => {
      showSuccess(labels.portfolio.workloadSaved, form.app_key);
      setForm({ app_key: '', name: '', strategy: 'rehost', target_cloud: 'aws', readiness_score: 50 });
      await onChanged();
    },
    onError: showApiError,
  });
  const importMutation = useMutation({
    mutationFn: () => importMigrateWorkloads(programID, csvText),
    onSuccess: async (result) => {
      showSuccess(
        labels.portfolio.inventoryImported,
        labels.portfolio.inventoryImportedDetail(result.imported, result.updated, result.skipped),
      );
      await onChanged();
    },
    onError: showApiError,
  });
  const transitionMutation = useMutation({
    mutationFn: ({ workload, to }: { workload: MigrateWorkload; to: MigrateWorkloadStatus }) =>
      transitionMigrateWorkload(workload.id, {
        status: to,
        expected_version: workload.row_version,
        reason: labels.portfolio.reason(workloadStatusLabel(to)),
      }),
    onSuccess: async (workload) => {
      showSuccess(labels.portfolio.workloadAdvanced, `${workload.app_key} · ${workloadStatusLabel(workload.status)}`);
      await onChanged();
    },
    onError: showApiError,
  });
  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
      <Card>
        <CardHeader>
          <CardTitle>{labels.portfolio.addWorkload}</CardTitle>
          <CardDescription>{labels.portfolio.addWorkloadDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder={labels.portfolio.appKeyPlaceholder} value={form.app_key} onChange={(e) => setForm({ ...form, app_key: e.target.value })} />
          <Input placeholder={labels.portfolio.appNamePlaceholder} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid gap-3 md:grid-cols-2">
            <Select value={form.strategy} onValueChange={(value) => setForm({ ...form, strategy: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{strategyOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder={labels.portfolio.targetCloudPlaceholder} value={form.target_cloud} onChange={(e) => setForm({ ...form, target_cloud: e.target.value })} />
          </div>
          <Input type="number" min={0} max={100} value={form.readiness_score} onChange={(e) => setForm({ ...form, readiness_score: Number(e.target.value) })} />
          <Button disabled={!form.app_key || !form.name || upsertMutation.isPending} onClick={() => upsertMutation.mutate()}>
            <Upload className="me-2 h-4 w-4" />
            {labels.portfolio.saveWorkload}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{labels.portfolio.bulkImport}</CardTitle>
          <CardDescription>{labels.portfolio.bulkImportDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea className="min-h-[160px] font-mono text-xs" value={csvText} onChange={(e) => setCsvText(e.target.value)} />
          <Button variant="outline" disabled={importMutation.isPending} onClick={() => importMutation.mutate()}>
            <Upload className="me-2 h-4 w-4" />
            {labels.portfolio.importCsv}
          </Button>
        </CardContent>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>{labels.portfolio.title}</CardTitle>
          <CardDescription>{loading ? labels.portfolio.loadingWorkloads : labels.portfolio.workloadsCount(workloads.length)}</CardDescription>
        </CardHeader>
        <CardContent>
          <EntityList
            title=""
            empty={labels.portfolio.empty}
            items={workloads}
            render={(workload) => {
              const nextStatuses = WORKLOAD_TRANSITIONS[workload.status] ?? [];
              return (
                <Row key={workload.id} icon={Layers3} title={`${workload.app_key} · ${workload.name}`} meta={`${workload.strategy} · ${workloadStatusLabel(workload.status)} · ${labels.command.readiness} ${workload.readiness_score}%`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{workload.tier || labels.portfolio.unclassified}</Badge>
                    {nextStatuses.length === 0 ? (
                      <span className="text-xs text-muted-foreground">{labels.portfolio.terminalState}</span>
                    ) : (
                      nextStatuses.map((to) => (
                        <Button
                          key={to}
                          size="sm"
                          variant="outline"
                          disabled={transitionMutation.isPending}
                          onClick={() => transitionMutation.mutate({ workload, to })}
                        >
                          {labels.portfolio.advanceTo(workloadStatusLabel(to))}
                        </Button>
                      ))
                    )}
                  </div>
                </Row>
              );
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function MoveGroupsPanel({ programID, workloads, groups, onChanged }: {
  programID: string;
  workloads: MigrateWorkload[];
  groups: MigrateMoveGroup[];
  onChanged: () => Promise<void>;
}) {
  const labels = useMigrateLabels();
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  const [appKeys, setAppKeys] = useState('');
  const mutate = useMutation({
    mutationFn: () => createMigrateMoveGroup(programID, { name, app_keys: splitList(appKeys) }),
    onSuccess: async () => {
      showSuccess(labels.moveGroups.moveGroupCreated, name);
      setName('');
      setAppKeys('');
      await onChanged();
    },
    onError: showApiError,
  });
  const suggest = useMutation({
    mutationFn: () => suggestMigrateMoveGroup(programID, splitList(seed)),
    onSuccess: (data) => setAppKeys(data.app_keys.join(', ')),
    onError: showApiError,
  });
  // validate/submit are the local lifecycle actions. The APPROVAL DECISION itself is
  // NOT a local flip — it is routed through the shared workflow engine by the
  // per-group MigrateMoveGroupApproval surface (Wave 5, H2).
  const groupAction = useMutation({
    mutationFn: async ({ group, action }: { group: MigrateMoveGroup; action: 'validate' | 'submit' }) => {
      if (action === 'validate') return validateMigrateMoveGroup(group);
      return submitMigrateMoveGroup(group);
    },
    onSuccess: async () => {
      showSuccess(labels.moveGroups.moveGroupUpdated);
      await onChanged();
    },
    onError: showApiError,
  });
  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>{labels.moveGroups.dependencyGrouping}</CardTitle>
          <CardDescription>{labels.moveGroups.dependencyGroupingDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder={labels.moveGroups.seedPlaceholder} value={seed} onChange={(e) => setSeed(e.target.value)} />
          <Button variant="outline" disabled={!seed || suggest.isPending} onClick={() => suggest.mutate()}>
            <GitBranch className="me-2 h-4 w-4" />
            {labels.moveGroups.suggestGroup}
          </Button>
          <Input placeholder={labels.moveGroups.groupNamePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea placeholder={labels.moveGroups.appKeysPlaceholder} value={appKeys} onChange={(e) => setAppKeys(e.target.value)} />
          <Button disabled={!name || !appKeys || mutate.isPending} onClick={() => mutate.mutate()}>
            <Network className="me-2 h-4 w-4" />
            {labels.moveGroups.createGroup}
          </Button>
          <p className="text-xs text-muted-foreground">{labels.moveGroups.availableForGrouping(workloads.length)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{labels.moveGroups.title}</CardTitle>
          <CardDescription>{labels.moveGroups.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <EntityList
            title=""
            empty={labels.moveGroups.empty}
            items={groups}
            render={(group) => (
              <div key={group.id} className="rounded-lg border bg-card p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Network className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{group.reference} · {group.name}</p>
                      <p className="text-xs text-muted-foreground">{group.status.replace(/_/g, ' ')} · {group.completeness_status}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={groupAction.isPending} onClick={() => groupAction.mutate({ group, action: 'validate' })}>{labels.moveGroups.validate}</Button>
                    <Button size="sm" variant="outline" disabled={groupAction.isPending} onClick={() => groupAction.mutate({ group, action: 'submit' })}>{labels.moveGroups.submitForApproval}</Button>
                  </div>
                </div>
                <MigrateMoveGroupApproval group={group} onChanged={onChanged} />
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function WavesPanel({ programID, groups, waves, onChanged }: {
  programID: string;
  groups: MigrateMoveGroup[];
  waves: MigrateWave[];
  onChanged: () => Promise<void>;
}) {
  const labels = useMigrateLabels();
  const approved = groups.filter((group) => group.status === 'approved');
  const [name, setName] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const mutate = useMutation({
    mutationFn: () => createMigrateWave(programID, {
      name,
      sequence: waves.length + 1,
      planned_duration_seconds: Math.max(selectedGroups.length, 1) * 3600,
      move_group_ids: selectedGroups,
    }),
    onSuccess: async () => {
      showSuccess(labels.waves.waveCreated, name);
      setName('');
      setSelectedGroups([]);
      await onChanged();
    },
    onError: showApiError,
  });
  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>{labels.waves.assembleWave}</CardTitle>
          <CardDescription>{labels.waves.assembleWaveDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder={labels.waves.waveNamePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="space-y-2">
            {approved.map((group) => (
              <label key={group.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedGroups.includes(group.id)}
                  onChange={(event) => setSelectedGroups((current) => event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id))}
                />
                <span>{group.reference} · {group.name}</span>
              </label>
            ))}
          </div>
          <Button disabled={!name || !selectedGroups.length || mutate.isPending} onClick={() => mutate.mutate()}>
            <Route className="me-2 h-4 w-4" />
            {labels.waves.createWave}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{labels.waves.title}</CardTitle>
          <CardDescription>{labels.waves.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <EntityList
            title=""
            empty={labels.waves.empty}
            items={waves}
            render={(wave) => (
              <Row key={wave.id} icon={Route} title={`${wave.reference} · ${wave.name}`} meta={labels.waveDetail.detailMeta(wave.sequence, wave.status, formatDuration(wave.planned_duration_seconds))}>
                <Button asChild size="sm" variant="outline"><Link href={`/migrate/waves/${wave.id}`}>{labels.waves.open}</Link></Button>
              </Row>
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// WaveDetailPanel renders a single wave: its summary + move groups, the
// "Generate runbook" action that calls the DR Runbook Studio bridge, and the
// generated parent + per-move-group child runbooks (with their real linked DR
// runbook id and live run state) once a runbook has been generated.
function WaveDetailPanel({ waveID, waves, onChanged }: {
  waveID: string;
  waves: MigrateWave[];
  onChanged: () => Promise<void>;
}) {
  const labels = useMigrateLabels();
  const queryClient = useQueryClient();
  // The waves list returns flat rows without move groups; fetch the single wave to
  // hydrate its move groups. Fall back to the list row for an instant header.
  const listWave = useMemo(() => waves.find((item) => item.id === waveID), [waves, waveID]);
  const waveQuery = useQuery({
    queryKey: ['migrate-wave', waveID],
    queryFn: () => fetchMigrateWave(waveID),
    enabled: Boolean(waveID),
  });
  const wave = waveQuery.data ?? listWave;

  const runbookQuery = useQuery({
    queryKey: ['migrate-wave-runbook', waveID],
    queryFn: () => fetchMigrateWaveRunbook(waveID),
    enabled: Boolean(waveID),
  });

  const graphQuery = useQuery({
    queryKey: ['migrate-wave-dependency-graph', waveID],
    queryFn: () => fetchMigrateDependencyGraph(waveID),
    enabled: Boolean(waveID),
  });

  const generate = useMutation({
    mutationFn: () => generateMigrateWaveRunbook(waveID),
    onSuccess: async (result) => {
      // Seed the runbook query with the freshly-generated binding so the view
      // updates immediately, then refresh the wave (its dr_runbook_id/
      // runbook_generated_at now changed) and re-fetch the runbook.
      queryClient.setQueryData(['migrate-wave-runbook', waveID], result);
      showSuccess(labels.waveDetail.toastRunbookGenerated, labels.waveDetail.toastRunbookGeneratedDetail(result.children.length));
      await onChanged();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['migrate-wave', waveID] }),
        queryClient.invalidateQueries({ queryKey: ['migrate-wave-runbook', waveID] }),
      ]);
    },
    onError: showApiError,
  });

  if (!waveID) {
    return <EmptyState icon={Route} title={labels.waveDetail.noWaveSelectedTitle} description={labels.waveDetail.noWaveSelectedDesc} size="compact" />;
  }

  const runbook = runbookQuery.data ?? null;
  const moveGroups = wave?.move_groups ?? [];
  // Only treat the wave as having no move groups once the hydrated wave has
  // actually loaded — the flat list row never carries move groups.
  const moveGroupsLoaded = waveQuery.isSuccess;
  const hasNoMoveGroups = moveGroupsLoaded && moveGroups.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href="/migrate/waves"><ArrowLeft className="me-2 h-4 w-4" />{labels.waveDetail.backToWaves}</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{wave ? `${wave.reference} · ${wave.name}` : labels.waveDetail.wave}</CardTitle>
          <CardDescription>
            {wave
              ? labels.waveDetail.detailMeta(wave.sequence, wave.status, formatDuration(wave.planned_duration_seconds))
              : labels.waveDetail.loadingWave}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {wave ? (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <DetailStatCard label={labels.waveDetail.moveGroups} value={moveGroups.length} tone="emerald" icon={Network} />
                <DetailStatCard
                  label={labels.waveDetail.runbook}
                  value={wave.dr_runbook_id ? labels.waveDetail.runbookGenerated : labels.waveDetail.runbookNotGenerated}
                  tone={wave.dr_runbook_id ? 'sky' : 'gold'}
                  icon={Workflow}
                />
                <DetailStatCard
                  label={labels.waveDetail.generatedLabel}
                  value={wave.runbook_generated_at ? formatDateTime(wave.runbook_generated_at) : '—'}
                  tone="slate"
                  icon={CalendarClock}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{labels.waveDetail.generateCutoverRunbook}</p>
                  <p className="text-xs text-muted-foreground">
                    {labels.waveDetail.generateCutoverRunbookDesc}
                  </p>
                </div>
                <Button
                  className="ms-auto"
                  disabled={hasNoMoveGroups || generate.isPending}
                  onClick={() => generate.mutate()}
                >
                  <Workflow className="me-2 h-4 w-4" />
                  {runbook ? labels.waveDetail.regenerateRunbook : labels.waveDetail.generateRunbook}
                </Button>
              </div>
              {hasNoMoveGroups ? (
                <p className="text-xs text-muted-foreground">
                  {labels.waveDetail.noMoveGroupsHint}
                </p>
              ) : null}

              <div>
                <p className="mb-2 text-sm font-medium">{labels.waveDetail.moveGroupsInWave}</p>
                {!moveGroupsLoaded ? (
                  <LoadingSkeleton variant="list" count={2} />
                ) : (
                  <EntityList
                    title=""
                    empty={labels.waveDetail.emptyMoveGroups}
                    items={moveGroups}
                    render={(group) => (
                      <Row
                        key={group.id}
                        icon={Network}
                        title={`${group.reference} · ${group.name}`}
                        meta={labels.waveDetail.groupMeta(group.status, group.workloads?.length ?? 0)}
                      />
                    )}
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState icon={Route} title={labels.waveDetail.waveNotFoundTitle} description={labels.waveDetail.waveNotFoundDesc} size="compact" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            {labels.waveDetail.dependencyGraph}
          </CardTitle>
          <CardDescription>
            {labels.waveDetail.dependencyGraphDesc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {graphQuery.isLoading ? (
            <LoadingSkeleton variant="detail" label={labels.waveDetail.loadingGraph} />
          ) : graphQuery.error ? (
            <ErrorState error={graphQuery.error} title={labels.waveDetail.graphErrorTitle} onRetry={() => void graphQuery.refetch()} />
          ) : graphQuery.data ? (
            <MigrateDependencyGraphView graph={graphQuery.data} />
          ) : null}
        </CardContent>
      </Card>

      {runbookQuery.isLoading ? (
        <LoadingSkeleton variant="detail" label={labels.waveDetail.loadingRunbook} />
      ) : runbookQuery.error ? (
        <ErrorState error={runbookQuery.error} title={labels.waveDetail.runbookErrorTitle} onRetry={() => void runbookQuery.refetch()} />
      ) : runbook ? (
        <WaveRunbookView runbook={runbook} />
      ) : (
        <EmptyState
          icon={Workflow}
          title={labels.waveDetail.noRunbookTitle}
          description={labels.waveDetail.noRunbookDesc}
          size="compact"
        />
      )}
    </div>
  );
}

// WaveRunbookView renders the generated parent runbook + its per-move-group child
// runbooks in order, surfacing the previously-inert DR runbook id as a real linked
// reference and showing the hydrated live DR task structure + run state.
function WaveRunbookView({ runbook }: { runbook: MigrateWaveRunbook }) {
  const labels = useMigrateLabels();
  const orderedChildren = useMemo(
    () => [...runbook.children].sort((a, b) => a.ordinal - b.ordinal),
    [runbook.children],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            {labels.runbook.generatedCutoverRunbook}
          </CardTitle>
          <CardDescription>
            {labels.runbook.parentOrchestrating(runbook.children.length)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <BindingHeader binding={runbook.parent} runbook={runbook.runbook ?? null} role={labels.runbook.roleParent} />
          {runbook.live_state ? <RunLiveState state={runbook.live_state} /> : null}
          {runbook.runbook ? (
            <RunbookTasks
              title={labels.runbook.parentRunbookTasks}
              description={labels.runbook.parentRunbookTasksDesc}
              tasks={runbook.runbook.tasks}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {labels.runbook.liveStructureUnavailable}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            {labels.runbook.moveGroupRunbooks}
          </CardTitle>
          <CardDescription>{labels.runbook.moveGroupRunbooksDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <EntityList
            title=""
            empty={labels.runbook.emptyChildRunbooks}
            items={orderedChildren}
            render={(child) => (
              <ChildBindingRow key={child.id} binding={child} />
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// BindingHeader shows a binding's status + its REAL linked DR runbook id (and run
// id when a run was started) — making the previously-inert id a visible link.
function BindingHeader({ binding, runbook, role }: {
  binding: MigrateRunbookBinding;
  runbook: MigrateDRRunbook | null;
  role: string;
}) {
  const labels = useMigrateLabels();
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{role}</Badge>
        <Badge variant={bindingStatusVariant(binding.status)}>{binding.status}</Badge>
        <Badge variant="outline">{binding.source}</Badge>
        {runbook?.name ? <span className="text-sm font-medium">{runbook.name}</span> : null}
      </div>
      <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-foreground">{labels.runbook.drRunbookLabel}</dt>{' '}
          <code className="font-mono">{binding.dr_runbook_id}</code>
          {runbook ? <span> · {runbook.status} · {labels.runbook.taskCount(runbook.tasks.length)}</span> : null}
        </div>
        {binding.dr_run_id ? (
          <div>
            <dt className="inline font-medium text-foreground">{labels.runbook.drRunLabel}</dt>{' '}
            <code className="font-mono">{binding.dr_run_id}</code>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function ChildBindingRow({ binding }: { binding: MigrateRunbookBinding }) {
  const labels = useMigrateLabels();
  const ref = typeof binding.detail?.['move_group_ref'] === 'string' ? (binding.detail['move_group_ref'] as string) : null;
  const taskCount = typeof binding.detail?.['task_count'] === 'number' ? (binding.detail['task_count'] as number) : null;
  return (
    <div className="space-y-1 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
          {binding.ordinal}
        </span>
        <span className="text-sm font-semibold">{ref ?? labels.runbook.moveGroup}</span>
        <Badge variant={bindingStatusVariant(binding.status)}>{binding.status}</Badge>
        {taskCount !== null ? <Badge variant="outline">{labels.runbook.workloadTasks(taskCount)}</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{labels.runbook.drRunbookLabel}</span>{' '}
        <code className="font-mono">{binding.dr_runbook_id}</code>
        {binding.dr_run_id ? (
          <>
            {' · '}
            <span className="font-medium text-foreground">{labels.runbook.runShort}</span>{' '}
            <code className="font-mono">{binding.dr_run_id}</code>
          </>
        ) : null}
      </p>
    </div>
  );
}

// RunbookTasks renders the live DR task structure incl. the predecessor DAG so the
// generated, dependency-ordered structure is visible.
function RunbookTasks({ title, description, tasks }: {
  title: string;
  description: string;
  tasks: MigrateDRRunbook['tasks'];
}) {
  const labels = useMigrateLabels();
  if (!tasks.length) {
    return <p className="text-xs text-muted-foreground">{labels.runbook.tasksInline(title)}</p>;
  }
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ol className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex flex-col gap-1 rounded-lg border bg-card p-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{task.name}</p>
              <p className="text-xs text-muted-foreground">
                {task.task_type}
                {task.owner ? ` · ${task.owner}` : ''}
                {' · '}{labels.runbook.plannedInline}{' '}
                {formatDuration(task.planned_duration_seconds)}
              </p>
              {task.predecessors.length ? (
                <p className="text-xs text-muted-foreground">
                  {labels.runbook.dependsOn(task.predecessors.join(', '))}
                </p>
              ) : null}
            </div>
            <Badge variant="outline" className="self-start font-mono text-caption md:self-auto">{task.task_key}</Badge>
          </li>
        ))}
      </ol>
    </div>
  );
}

// RunLiveState renders the DR run projection when a run has been started, so the
// linked run is shown as a real, progressing execution.
function RunLiveState({ state }: { state: MigrateDRRunLiveState }) {
  const labels = useMigrateLabels();
  const { projection } = state;
  const pct = projection.total_tasks > 0
    ? Math.round((projection.completed_tasks / projection.total_tasks) * 100)
    : 0;
  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <PlayCircle className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{labels.runbook.liveRun}</span>
        <Badge variant={runStatusVariant(state.status)}>{state.status}</Badge>
        {state.mode ? <Badge variant="outline">{state.mode}</Badge> : null}
        <Badge variant={projection.on_track ? 'success' : 'destructive'}>
          {projection.on_track ? labels.runbook.onTrack : labels.runbook.behind(formatDuration(Math.abs(projection.variance_seconds)))}
        </Badge>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span>{labels.runbook.tasksProgress(projection.completed_tasks, projection.total_tasks)}</span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={pct} />
      </div>
      <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div><dt className="font-medium text-foreground">{labels.runbook.elapsed}</dt><dd>{formatDuration(projection.elapsed_seconds)}</dd></div>
        <div><dt className="font-medium text-foreground">{labels.runbook.remainingCriticalPath}</dt><dd>{formatDuration(projection.remaining_critical_path_seconds)}</dd></div>
        <div><dt className="font-medium text-foreground">{labels.runbook.projectedFinish}</dt><dd>{formatDuration(projection.projected_finish_seconds)}</dd></div>
      </dl>
      {state.frontier.length ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{labels.runbook.readyNow}</span> {state.frontier.join(', ')}
        </p>
      ) : null}
    </div>
  );
}

// RunProjectionBar renders the projection/ETA of a live run: status, on-track,
// task progress, elapsed/remaining/projected-finish, and the current frontier
// (the tasks the DR engine reports as ready to execute now). It is shared by the
// interactive cutover run view and the rollback run view.
function RunProjectionBar({ state, label }: { state: MigrateDRRunLiveState; label: string }) {
  const labels = useMigrateLabels();
  const { projection } = state;
  const pct = projection.total_tasks > 0
    ? Math.round((projection.completed_tasks / projection.total_tasks) * 100)
    : 0;
  // The frontier is a list of task IDs; render the human task names.
  const nameByID = new Map(state.tasks.map((t) => [t.id, t.name]));
  const frontierNames = state.frontier.map((tid) => nameByID.get(tid) ?? tid);
  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <PlayCircle className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{label}</span>
        <Badge variant={runStatusVariant(state.status)}>{state.status}</Badge>
        {state.mode ? <Badge variant="outline">{state.mode}</Badge> : null}
        {runIsRunning(state) ? (
          <Badge variant={projection.on_track ? 'success' : 'destructive'}>
            {projection.on_track ? labels.runbook.onTrack : labels.runbook.behind(formatDuration(Math.abs(projection.variance_seconds)))}
          </Badge>
        ) : null}
        <code className="ms-auto font-mono text-caption text-muted-foreground">{labels.evidence.runInline} {state.run_id}</code>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span>{labels.runbook.tasksProgress(projection.completed_tasks, projection.total_tasks)}</span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={pct} />
      </div>
      <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div><dt className="font-medium text-foreground">{labels.runbook.elapsed}</dt><dd>{formatDuration(projection.elapsed_seconds)}</dd></div>
        <div><dt className="font-medium text-foreground">{labels.runbook.remainingCriticalPath}</dt><dd>{formatDuration(projection.remaining_critical_path_seconds)}</dd></div>
        <div><dt className="font-medium text-foreground">{labels.runbook.projectedFinish}</dt><dd>{formatDuration(projection.projected_finish_seconds)}</dd></div>
      </dl>
      {frontierNames.length ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{labels.runbook.readyNow}</span> {frontierNames.join(', ')}
        </p>
      ) : null}
    </div>
  );
}

// LiveRunTaskList renders each task of a live run with its per-task run status,
// and (for the cutover run only) complete/skip/fail controls. A task is
// actionable only when the run is still running and the task is on the current
// frontier (the DR engine's own "ready now" set) — this mirrors the engine, so
// the UI never offers an action the engine would reject. Failing a task prompts
// for whether to fail the whole run. A required task carries a "required" badge.
function LiveRunTaskList({
  state,
  onAct,
  pendingTaskID,
  interactive,
  invocationsByTaskKey,
}: {
  state: MigrateDRRunLiveState;
  onAct?: (task: MigrateDRTask, action: MigrateDRTaskAction) => void;
  pendingTaskID?: string | null;
  interactive: boolean;
  // invocationsByTaskKey maps a connector-task's task_key to the ACTUAL connector
  // invocation the DR engine recorded when it ran that task during this run. When a
  // connector task has not fired yet (or the report is not accessible) the entry is
  // absent and only the "connector" marker shows — never a fabricated outcome.
  invocationsByTaskKey?: Map<string, MigrateConnectorEvidence>;
}) {
  const labels = useMigrateLabels();
  const runStatuses = taskRunStatusByTaskID(state);
  // The DR engine's frontier + per-task run rows are keyed by task ID (its
  // RunState.Frontier returns task IDs and TaskRun.task_id is the same ID), so we
  // match the frontier against task.id — not task_key.
  const frontier = new Set(state.frontier);
  const runActive = runIsRunning(state);
  if (!state.tasks.length) {
    return <p className="text-xs text-muted-foreground">{labels.liveRun.noTasks}</p>;
  }
  return (
    <ol className="space-y-2">
      {state.tasks.map((task) => {
        const taskRunStatus = runStatuses[task.id];
        const isReady = frontier.has(task.id);
        const isPending = pendingTaskID === task.id;
        // A task can be acted on only while the run is live and the task sits on
        // the frontier and has not already reached a terminal per-task state.
        const terminalTask = taskRunStatus === DR_TASK_RUN_COMPLETE
          || taskRunStatus === DR_TASK_RUN_SKIPPED
          || taskRunStatus === DR_TASK_RUN_FAILED;
        const actionable = interactive && runActive && isReady && !terminalTask;
        const connectorTask = isConnectorTask(task);
        const invocation = connectorTask ? invocationsByTaskKey?.get(task.task_key) : undefined;
        return (
          <li key={task.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{task.name}</p>
                <p className="text-xs text-muted-foreground">
                  {task.task_type}
                  {task.owner ? ` · ${task.owner}` : ''}
                  {' · '}{labels.runbook.plannedInline}{' '}
                  {formatDuration(task.planned_duration_seconds)}
                </p>
                {task.predecessors.length ? (
                  <p className="text-xs text-muted-foreground">{labels.runbook.dependsOn(task.predecessors.join(', '))}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {connectorTask ? (
                  <Badge variant="secondary" className="gap-1">
                    <Plug className="h-3 w-3" />
                    {labels.liveRun.connector}
                  </Badge>
                ) : null}
                {task.required ? <Badge variant="outline">{labels.liveRun.required}</Badge> : null}
                {isReady && runActive && !terminalTask ? <Badge variant="secondary">{labels.liveRun.readyNow}</Badge> : null}
                <Badge variant={taskRunStatusVariant(taskRunStatus)}>{taskRunStatusLabel(taskRunStatus, labels)}</Badge>
                <Badge variant="outline" className="font-mono text-caption">{task.task_key}</Badge>
              </div>
            </div>
            {connectorTask ? (
              <div className="rounded-md border border-dashed bg-background p-2 text-xs">
                {invocation ? (
                  <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                    <span className="font-medium text-foreground">{labels.liveRun.connectorInvokedLabel}</span>
                    <span className="font-mono">{invocation.action}</span>
                    <Badge variant={connectorInvocationVariant(invocation)} className="align-middle">
                      {invocation.status}
                      {invocation.http_status ? ` · HTTP ${invocation.http_status}` : ''}
                    </Badge>
                    <span>· {formatDateTime(invocation.created_at)}</span>
                    {invocation.error_message ? <span className="text-destructive">· {invocation.error_message}</span> : null}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {labels.liveRun.connectorAutoPre} <code className="font-mono">{task.owner || task.task_key}</code> {labels.liveRun.connectorAutoPost}
                  </p>
                )}
              </div>
            ) : null}
            {actionable && onAct ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => onAct(task, 'complete')}>
                  {isPending ? <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" /> : <Check className="me-2 h-3.5 w-3.5" />}
                  {labels.liveRun.complete}
                </Button>
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => onAct(task, 'skip')}>
                  <SkipForward className="me-2 h-3.5 w-3.5" />
                  {labels.liveRun.skip}
                </Button>
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => onAct(task, 'fail')}>
                  <XCircle className="me-2 h-3.5 w-3.5" />
                  {labels.liveRun.fail}
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function bindingStatusVariant(status: MigrateRunbookBinding['status']): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'running') return 'warning';
  return 'secondary';
}

function runStatusVariant(status: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (status === 'completed' || status === 'succeeded') return 'success';
  if (status === 'failed' || status === 'aborted') return 'destructive';
  if (status === 'running' || status === 'in_progress') return 'warning';
  return 'secondary';
}

// ── DR run state helpers (Wave 3) ─────────────────────────────────────────────
// These mirror the backend DRRunLiveState predicates so the UI reads the REAL run
// state the DR engine reports — never a canned/checkbox answer.

const DR_RUN_COMPLETED = 'completed';
const DR_RUN_FAILED = 'failed';
const DR_RUN_ABORTED = 'aborted';
const DR_RUN_RUNNING = 'running';

const DR_TASK_RUN_COMPLETE = 'complete';
const DR_TASK_RUN_SKIPPED = 'skipped';
const DR_TASK_RUN_FAILED = 'failed';

// CONNECTOR_TASK_KEY_PREFIX mirrors the backend runbook generator: a connector-
// invoking AUTOMATED task's key is "conn-<phase>-<connector>" (see
// internal/migrate/connector_run.go automationTask). Detecting it lets the run
// view honestly mark which runbook tasks invoke a migration connector during the
// cutover/rollback run — closing the old "connectors are invoked" claim with the
// actual task the DR engine executes.
const CONNECTOR_TASK_KEY_PREFIX = 'conn-';

// isConnectorTask reports whether a live-run task is a connector-invocation task
// the DR engine drives through migrate's webhook. It requires BOTH the automated
// task type AND the generator's key prefix so a hand-authored task named "conn-…"
// is not mislabelled.
function isConnectorTask(task: Pick<MigrateDRTask, 'task_type' | 'task_key'>): boolean {
  return task.task_type === 'automated' && task.task_key.startsWith(CONNECTOR_TASK_KEY_PREFIX);
}

function runIsTerminal(state?: MigrateDRRunLiveState | null): boolean {
  const s = state?.status;
  return s === DR_RUN_COMPLETED || s === DR_RUN_FAILED || s === DR_RUN_ABORTED;
}

function runSucceeded(state?: MigrateDRRunLiveState | null): boolean {
  return state?.status === DR_RUN_COMPLETED;
}

function runIsRunning(state?: MigrateDRRunLiveState | null): boolean {
  return state?.status === DR_RUN_RUNNING;
}

// taskRunStatusByTaskID builds a task_id → per-task run status map from the live
// state's task_runs rows. Absent rows mean the task has not been acted on yet.
function taskRunStatusByTaskID(state?: MigrateDRRunLiveState | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tr of state?.task_runs ?? []) {
    out[tr.task_id] = tr.status;
  }
  return out;
}

function taskRunStatusVariant(status?: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (status === DR_TASK_RUN_COMPLETE) return 'success';
  if (status === DR_TASK_RUN_FAILED) return 'destructive';
  if (status === DR_TASK_RUN_SKIPPED) return 'warning';
  return 'secondary';
}

function taskRunStatusLabel(status: string | undefined, labels: MigrateLabels): string {
  if (status === DR_TASK_RUN_COMPLETE) return labels.taskStatus.complete;
  if (status === DR_TASK_RUN_FAILED) return labels.taskStatus.failed;
  if (status === DR_TASK_RUN_SKIPPED) return labels.taskStatus.skipped;
  return labels.taskStatus.pending;
}

function rollbackRunStatusVariant(status: MigrateRollbackRun['status']): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'aborted') return 'destructive';
  if (status === 'running') return 'warning';
  return 'secondary';
}

function CutoverPanel({ programID, waves, windows, connectors, routeWindowID, onChanged }: {
  programID: string;
  waves: MigrateWave[];
  windows: MigrateCutoverWindow[];
  connectors: MigrateConnector[];
  routeWindowID?: string;
  onChanged: () => Promise<void>;
}) {
  const labels = useMigrateLabels();
  const queryClient = useQueryClient();
  const [waveID, setWaveID] = useState(waves[0]?.id ?? '');
  const [name, setName] = useState('');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [selectedWindowID, setSelectedWindowID] = useState(routeWindowID ?? '');
  const [rollbackDraft, setRollbackDraft] = useState({
    strategy: '',
    procedures: '',
    success_criteria: '',
  });
  const [gateDraft, setGateDraft] = useState<{ kind: 'readiness' | 'validation'; name: string; check_type: string }>({
    kind: 'readiness',
    name: '',
    check_type: '',
  });
  const [gateEvidence, setGateEvidence] = useState<Record<string, string>>({});
  const [decisionRationale, setDecisionRationale] = useState('');
  const [planApprovalRationale, setPlanApprovalRationale] = useState('');
  // When a run is live we poll GetRun; a manual override lets the operator pause
  // the interval while inspecting.
  const [livePolling, setLivePolling] = useState(true);

  const selectedWindow = useMemo(
    () => windows.find((window) => window.id === selectedWindowID) ?? windows[0],
    [selectedWindowID, windows],
  );
  const activeWindowID = selectedWindow?.id ?? '';

  const rollbackQuery = useQuery({
    queryKey: ['migrate-rollback-plan', activeWindowID],
    queryFn: () => fetchMigrateRollbackPlan(activeWindowID),
    enabled: Boolean(activeWindowID),
  });
  const gateChecksQuery = useQuery({
    queryKey: ['migrate-gate-checks', activeWindowID],
    queryFn: () => fetchMigrateGateChecks(activeWindowID),
    enabled: Boolean(activeWindowID),
  });
  // The live cutover run: polled on an interval while the run is still running so
  // the frontier/projection/ETA and per-task state stay live (no WebSocket).
  const windowRunQuery = useQuery({
    queryKey: ['migrate-window-run', activeWindowID],
    queryFn: () => fetchMigrateWindowRun(activeWindowID),
    enabled: Boolean(activeWindowID),
    refetchInterval: (query) => {
      if (!livePolling) return false;
      const state = query.state.data?.live_state ?? null;
      return runIsRunning(state) ? 4000 : false;
    },
  });
  // The rollback run provenance + its live DR run state, polled while running.
  const rollbackRunQuery = useQuery({
    queryKey: ['migrate-rollback-run', activeWindowID],
    queryFn: () => fetchMigrateRollbackRun(activeWindowID),
    enabled: Boolean(activeWindowID),
    refetchInterval: (query) => {
      if (!livePolling) return false;
      return runIsRunning(query.state.data?.live_state ?? null) ? 4000 : false;
    },
  });

  const rollbackPlan = rollbackQuery.data ?? null;
  const gateChecks = gateChecksQuery.data ?? [];
  const windowRun = windowRunQuery.data ?? null;
  const liveState = windowRun?.live_state ?? null;
  const rollbackRunView = rollbackRunQuery.data ?? null;

  // Connector-in-run visibility (P10a): the ACTUAL connector invocations the DR
  // engine recorded during this program's runs come from the structured evidence
  // report (the only surface that returns run-driven invocations with their
  // task_key + source). We fetch it only once a run exists to correlate, poll it
  // while a run is live, and degrade gracefully when the caller lacks
  // migrate:evidence:export (the report 403s → the connector-task marker still
  // shows, just without the per-task outcome). We split the window's invocations by
  // source so the cutover-run and rollback-run views each see only their own.
  const runExists = Boolean(
    windowRun?.binding?.dr_run_id
      ?? liveState
      ?? rollbackRunView?.rollback_run
      ?? windowRun?.rollback_run,
  );
  const invocationsQuery = useQuery({
    queryKey: ['migrate-evidence-report', programID],
    queryFn: () => fetchMigrateEvidenceReport(programID),
    enabled: Boolean(programID) && runExists,
    // Reuse the cached report (also opened by the Export-evidence dialog); refresh
    // while a run is live so newly-fired connector tasks surface without a reload.
    refetchInterval: () =>
      livePolling && (runIsRunning(liveState) || runIsRunning(rollbackRunView?.live_state ?? null)) ? 6000 : false,
    // A 403 (no evidence-export permission) is expected for some roles; do not
    // retry it into a noisy failure — degrade to no correlated outcomes.
    retry: false,
  });
  const cutoverInvocationsByTaskKey = useMemo(
    () => connectorInvocationsForWindow(invocationsQuery.data, activeWindowID, 'cutover_run'),
    [invocationsQuery.data, activeWindowID],
  );
  const rollbackInvocationsByTaskKey = useMemo(
    () => connectorInvocationsForWindow(invocationsQuery.data, activeWindowID, 'rollback_run'),
    [invocationsQuery.data, activeWindowID],
  );

  useEffect(() => {
    if (!rollbackPlan) return;
    setRollbackDraft({
      strategy: rollbackPlan.strategy,
      procedures: rollbackPlan.procedures,
      success_criteria: rollbackPlan.success_criteria,
    });
  }, [rollbackPlan]);
  // Deep-link: when the route carries a window id, select it once it's known.
  useEffect(() => {
    if (routeWindowID && windows.some((w) => w.id === routeWindowID)) {
      setSelectedWindowID(routeWindowID);
    }
  }, [routeWindowID, windows]);

  const refreshWindowState = async (windowID = activeWindowID) => {
    await Promise.all([
      onChanged(),
      windowID ? queryClient.invalidateQueries({ queryKey: ['migrate-rollback-plan', windowID] }) : Promise.resolve(),
      windowID ? queryClient.invalidateQueries({ queryKey: ['migrate-gate-checks', windowID] }) : Promise.resolve(),
      windowID ? queryClient.invalidateQueries({ queryKey: ['migrate-window-run', windowID] }) : Promise.resolve(),
      windowID ? queryClient.invalidateQueries({ queryKey: ['migrate-rollback-run', windowID] }) : Promise.resolve(),
    ]);
  };
  // Seed the live-run query cache with a fresh response so the view reflects the
  // action immediately, ahead of the next poll.
  const setWindowRunCache = (windowID: string, run: MigrateWindowRun) => {
    queryClient.setQueryData(['migrate-window-run', windowID], run);
  };

  const create = useMutation({
    mutationFn: () => createMigrateWindow(programID, {
      wave_id: waveID,
      name,
      window_type: 'maintenance',
      starts_at: new Date(starts).toISOString(),
      ends_at: new Date(ends).toISOString(),
    }),
    onSuccess: async (window) => {
      setSelectedWindowID(window.id);
      showSuccess(labels.cutover.toastWindowScheduled, name);
      await refreshWindowState(window.id);
    },
    onError: showApiError,
  });

  // Governance actions: go/no-go, save/approve rollback plan, add gate check.
  const action = useMutation({
    mutationFn: async ({ window, op, rationale, plan }: {
      window: MigrateCutoverWindow;
      op: 'go' | 'no_go' | 'save-plan' | 'approve-rollback' | 'add-gate';
      rationale?: string;
      plan?: MigrateRollbackPlan | null;
    }) => {
      if (op === 'go' || op === 'no_go') {
        const reason = (rationale ?? '').trim();
        if (!reason) throw new Error(labels.cutover.errGoNoGoRequired);
        return decideMigrateGoNoGo(window, op, reason);
      }
      if (op === 'approve-rollback') {
        if (!plan) throw new Error(labels.cutover.errCreatePlanFirst);
        const reason = (rationale ?? '').trim();
        if (!reason) throw new Error(labels.cutover.errPlanApprovalRequired);
        return decideMigrateRollbackPlan(plan, 'approved', reason);
      }
      if (op === 'save-plan') {
        return upsertMigrateRollbackPlan(window.id, rollbackDraft);
      }
      // add-gate: operator supplies the check name + type; nothing is pre-asserted as passed.
      return createMigrateGateCheck(window.id, {
        kind: gateDraft.kind,
        name: gateDraft.name.trim(),
        check_type: gateDraft.check_type.trim() || undefined,
        required: true,
      });
    },
    onSuccess: async (_result, variables) => {
      if (variables.op === 'add-gate') setGateDraft((current) => ({ ...current, name: '', check_type: '' }));
      if (variables.op === 'go' || variables.op === 'no_go') setDecisionRationale('');
      if (variables.op === 'approve-rollback') setPlanApprovalRationale('');
      showSuccess(labels.cutover.toastCutoverUpdated);
      await refreshWindowState();
    },
    onError: showApiError,
  });

  // Start the live cutover run (P7): a real DR run of the wave's generated
  // runbook, gated by the backend on go + approved rollback plan + readiness.
  const startRun = useMutation({
    mutationFn: (windowID: string) => startMigrateWindowRun(windowID),
    onSuccess: async (run) => {
      setLivePolling(true);
      setWindowRunCache(run.window_id, run);
      showSuccess(labels.cutoverRun.toastRunStarted, labels.cutoverRun.toastRunStartedDetail(run.live_state?.run_id ?? ''));
      await refreshWindowState(run.window_id);
    },
    onError: showApiError,
  });

  // Act on a single live-run task (P7): complete / skip / fail through the DR
  // engine. Failing a required task can fail the whole run when failRun is set.
  const actOnTask = useMutation({
    mutationFn: ({ windowID, taskID, action: taskAction, failRun }: {
      windowID: string;
      taskID: string;
      action: MigrateDRTaskAction;
      failRun?: boolean;
    }) => actOnMigrateWindowTask(windowID, taskID, taskAction, failRun ? { fail_run: true } : undefined),
    onSuccess: async (run, variables) => {
      setWindowRunCache(run.window_id, run);
      showSuccess(labels.cutoverRun.toastTaskRecorded(variables.action));
      await refreshWindowState(run.window_id);
    },
    onError: showApiError,
  });

  // Trigger rollback (P8): records the reason (provenance) and starts an isolated
  // rollback DR run; the backend auto-generates the rollback runbook on demand.
  const triggerRollback = useMutation({
    mutationFn: ({ windowID, reason }: { windowID: string; reason: string }) =>
      executeMigrateRollback(windowID, { reason: reason.trim() }),
    onSuccess: async (run) => {
      setLivePolling(true);
      showSuccess(labels.rollbackRun.toastRollbackStarted, labels.rollbackRun.toastRollbackStartedDetail(run.dr_run_id));
      await refreshWindowState(run.window_id);
    },
    onError: showApiError,
  });

  // Pre-generate the isolated rollback runbook (optional; ExecuteRollback also
  // generates on demand). Surfaces the reverse-order runbook before triggering.
  const generateRollback = useMutation({
    mutationFn: (windowID: string) => generateMigrateRollbackRunbook(windowID),
    onSuccess: async (binding) => {
      showSuccess(labels.rollbackRun.toastRunbookGenerated, labels.rollbackRun.toastRunbookGeneratedDetail(binding.dr_runbook_id));
      await refreshWindowState();
    },
    onError: showApiError,
  });

  const gateResult = useMutation({
    mutationFn: ({ check, status, evidence }: { check: MigrateGateCheck; status: 'passed' | 'failed' | 'overridden'; evidence: string }) => {
      const trimmed = evidence.trim();
      if (!trimmed) {
        return Promise.reject(new Error(labels.cutover.errEvidenceRequired));
      }
      return recordMigrateGateCheck(check.id, { status, evidence: trimmed });
    },
    onSuccess: async (_result, variables) => {
      setGateEvidence((current) => {
        const next = { ...current };
        delete next[variables.check.id];
        return next;
      });
      showSuccess(labels.cutover.toastGateCheckRecorded);
      await refreshWindowState();
    },
    onError: showApiError,
  });

  const runStarted = Boolean(windowRun?.binding?.dr_run_id ?? liveState);
  const planApproved = rollbackPlan?.decision === 'approved';

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>{labels.cutover.scheduleWindow}</CardTitle>
          <CardDescription>{labels.cutover.scheduleWindowDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={waveID} onValueChange={setWaveID}>
            <SelectTrigger><SelectValue placeholder={labels.cutover.wavePlaceholder} /></SelectTrigger>
            <SelectContent>{waves.map((wave) => <SelectItem key={wave.id} value={wave.id}>{wave.reference} · {wave.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder={labels.cutover.windowNamePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
          <Input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
          <Button disabled={!waveID || !name || !starts || !ends || create.isPending} onClick={() => create.mutate()}>
            <CalendarClock className="me-2 h-4 w-4" />
            {labels.cutover.schedule}
          </Button>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{labels.cutover.cutovers}</CardTitle>
            <CardDescription>{labels.cutover.cutoversDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="migrate-decision-rationale">{labels.cutover.goNoGoRationale}</Label>
              <Textarea
                id="migrate-decision-rationale"
                value={decisionRationale}
                onChange={(event) => setDecisionRationale(event.target.value)}
                placeholder={labels.cutover.goNoGoRationalePlaceholder}
                className="min-h-[64px]"
              />
            </div>
            <EntityList
              title=""
              empty={labels.cutover.emptyWindows}
              items={windows}
              render={(window) => {
                const isSelected = selectedWindow?.id === window.id;
                return (
                  <Row key={window.id} icon={CalendarClock} title={`${window.reference} · ${window.name}`} meta={formatDateTime(window.starts_at)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={decisionBadgeVariant(window.decision)}>{window.decision}</Badge>
                      <Button size="sm" variant={isSelected ? 'secondary' : 'outline'} onClick={() => setSelectedWindowID(window.id)}>{labels.cutover.inspect}</Button>
                      <Button size="sm" variant="outline" disabled={!decisionRationale.trim() || action.isPending} onClick={() => action.mutate({ window, op: 'go', rationale: decisionRationale })}>{labels.cutover.go}</Button>
                      <Button size="sm" variant="outline" disabled={!decisionRationale.trim() || action.isPending} onClick={() => action.mutate({ window, op: 'no_go', rationale: decisionRationale })}>{labels.cutover.noGo}</Button>
                    </div>
                  </Row>
                );
              }}
            />
            <p className="text-xs text-muted-foreground">{labels.cutover.connectorsConfigured(connectors.length)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{labels.cutover.governanceGates}</CardTitle>
            <CardDescription>
              {selectedWindow ? `${selectedWindow.reference} · ${selectedWindow.name}` : labels.cutover.selectWindowHint}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedWindow ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{labels.cutover.rollbackPlan}</Label>
                    <Input
                      value={rollbackDraft.strategy}
                      onChange={(event) => setRollbackDraft({ ...rollbackDraft, strategy: event.target.value })}
                      placeholder={labels.cutover.rollbackStrategyPlaceholder}
                    />
                    <Textarea
                      value={rollbackDraft.procedures}
                      onChange={(event) => setRollbackDraft({ ...rollbackDraft, procedures: event.target.value })}
                      placeholder={labels.cutover.rollbackProceduresPlaceholder}
                    />
                    <Textarea
                      value={rollbackDraft.success_criteria}
                      onChange={(event) => setRollbackDraft({ ...rollbackDraft, success_criteria: event.target.value })}
                      placeholder={labels.cutover.successCriteriaPlaceholder}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={decisionBadgeVariant(rollbackPlan?.decision)}>{rollbackPlan?.decision ?? labels.cutover.missing}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!rollbackDraft.strategy.trim() || !rollbackDraft.procedures.trim() || !rollbackDraft.success_criteria.trim() || action.isPending}
                        onClick={() => action.mutate({ window: selectedWindow, op: 'save-plan' })}
                      >
                        {labels.cutover.savePlan}
                      </Button>
                    </div>
                    <Textarea
                      value={planApprovalRationale}
                      onChange={(event) => setPlanApprovalRationale(event.target.value)}
                      placeholder={labels.cutover.planApprovalRationalePlaceholder}
                      className="min-h-[56px]"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!rollbackPlan || planApproved || !planApprovalRationale.trim() || action.isPending}
                      onClick={() => action.mutate({ window: selectedWindow, op: 'approve-rollback', plan: rollbackPlan, rationale: planApprovalRationale })}
                    >
                      {labels.cutover.approvePlan}
                    </Button>
                    {rollbackPlan ? <p className="text-xs text-muted-foreground">{rollbackPlan.strategy} · {rollbackPlan.success_criteria}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label>{labels.cutover.addGateCheck}</Label>
                    <Select value={gateDraft.kind} onValueChange={(value: 'readiness' | 'validation') => setGateDraft({ ...gateDraft, kind: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="readiness">{labels.cutover.readiness}</SelectItem>
                        <SelectItem value="validation">{labels.cutover.validation}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={gateDraft.name}
                      onChange={(event) => setGateDraft({ ...gateDraft, name: event.target.value })}
                      placeholder={labels.cutover.checkNamePlaceholder}
                    />
                    <Input
                      value={gateDraft.check_type}
                      onChange={(event) => setGateDraft({ ...gateDraft, check_type: event.target.value })}
                      placeholder={labels.cutover.checkTypePlaceholder}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!gateDraft.name.trim() || action.isPending}
                      onClick={() => action.mutate({ window: selectedWindow, op: 'add-gate' })}
                    >
                      {labels.cutover.addCheck}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {labels.cutover.gateHint}
                    </p>
                  </div>
                </div>
                {gateChecksQuery.isLoading ? <LoadingSkeleton variant="list" count={2} /> : (
                  <EntityList
                    title=""
                    empty={labels.cutover.emptyGateChecks}
                    items={gateChecks}
                    render={(check) => {
                      const evidence = gateEvidence[check.id] ?? '';
                      const hasEvidence = evidence.trim().length > 0;
                      return (
                        <Row key={check.id} icon={FileCheck2} title={check.name} meta={labels.cutover.gateMeta(check.kind, check.check_type || labels.cutover.manual, check.required)}>
                          <div className="flex w-full max-w-md flex-col gap-2">
                            <Badge variant={checkBadgeVariant(check.status)} className="self-start">{check.status}</Badge>
                            {check.evidence ? (
                              <p className="text-xs text-muted-foreground">{labels.cutover.evidenceLabel} {check.evidence}</p>
                            ) : null}
                            <Input
                              value={evidence}
                              onChange={(event) => setGateEvidence((current) => ({ ...current, [check.id]: event.target.value }))}
                              placeholder={labels.cutover.evidencePlaceholder}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <Button size="sm" variant="outline" disabled={!hasEvidence || gateResult.isPending} onClick={() => gateResult.mutate({ check, status: 'passed', evidence })}>{labels.cutover.pass}</Button>
                              <Button size="sm" variant="outline" disabled={!hasEvidence || gateResult.isPending} onClick={() => gateResult.mutate({ check, status: 'failed', evidence })}>{labels.cutover.fail}</Button>
                              <Button size="sm" variant="outline" disabled={!hasEvidence || gateResult.isPending} onClick={() => gateResult.mutate({ check, status: 'overridden', evidence })}>{labels.cutover.override}</Button>
                            </div>
                          </div>
                        </Row>
                      );
                    }}
                  />
                )}
              </>
            ) : (
              <EmptyState title={labels.cutover.noWindowSelectedTitle} description={labels.cutover.noWindowSelectedDesc} size="compact" />
            )}
          </CardContent>
        </Card>

        {selectedWindow ? (
          <CutoverRunView
            window={selectedWindow}
            windowRun={windowRun}
            liveState={liveState}
            loading={windowRunQuery.isLoading}
            runStarted={runStarted}
            planApproved={planApproved}
            livePolling={livePolling}
            onTogglePolling={() => setLivePolling((v) => !v)}
            onStartRun={() => startRun.mutate(selectedWindow.id)}
            startPending={startRun.isPending}
            onActOnTask={(task, taskAction, failRun) =>
              actOnTask.mutate({ windowID: selectedWindow.id, taskID: task.id, action: taskAction, failRun })}
            actPendingTaskID={actOnTask.isPending ? actOnTask.variables?.taskID ?? null : null}
            connectorInvocationsByTaskKey={cutoverInvocationsByTaskKey}
          />
        ) : null}

        {selectedWindow ? (
          <RollbackRunView
            window={selectedWindow}
            rollbackRun={rollbackRunView?.rollback_run ?? windowRun?.rollback_run ?? null}
            liveState={rollbackRunView?.live_state ?? null}
            loading={rollbackRunQuery.isLoading}
            planApproved={planApproved}
            onGenerate={() => generateRollback.mutate(selectedWindow.id)}
            generatePending={generateRollback.isPending}
            onTrigger={(reason) => triggerRollback.mutateAsync({ windowID: selectedWindow.id, reason })}
            triggerPending={triggerRollback.isPending}
            connectorInvocationsByTaskKey={rollbackInvocationsByTaskKey}
          />
        ) : null}
      </div>
    </div>
  );
}

// CutoverRunView renders the LIVE cutover run (P7): the "Start cutover run"
// action when no run exists, and once started the parent-runbook binding, the
// projection/ETA/frontier, and the per-task list with complete/skip/fail
// controls. The validation gate is driven by the REAL run status the DR engine
// reports — when the run reaches "completed" the backend advances the workloads
// to live; a running run shows live progress; a failed run is flagged.
function CutoverRunView({
  window,
  windowRun,
  liveState,
  loading,
  runStarted,
  planApproved,
  livePolling,
  onTogglePolling,
  onStartRun,
  startPending,
  onActOnTask,
  actPendingTaskID,
  connectorInvocationsByTaskKey,
}: {
  window: MigrateCutoverWindow;
  windowRun: MigrateWindowRun | null;
  liveState: MigrateDRRunLiveState | null;
  loading: boolean;
  runStarted: boolean;
  planApproved: boolean;
  livePolling: boolean;
  onTogglePolling: () => void;
  onStartRun: () => void;
  startPending: boolean;
  onActOnTask: (task: MigrateDRTask, action: MigrateDRTaskAction, failRun: boolean) => void;
  actPendingTaskID: string | null;
  connectorInvocationsByTaskKey?: Map<string, MigrateConnectorEvidence>;
}) {
  const labels = useMigrateLabels();
  const [failTask, setFailTask] = useState<MigrateDRTask | null>(null);
  const canStart = window.decision === 'go' && planApproved;
  const succeeded = runSucceeded(liveState);
  const failed = liveState ? runIsTerminal(liveState) && !succeeded : false;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2"><PlayCircle className="h-4 w-4" />{labels.cutoverRun.title}</CardTitle>
            <CardDescription>
              {labels.cutoverRun.description}
            </CardDescription>
          </div>
          {runStarted && runIsRunning(liveState) ? (
            <Button size="sm" variant="outline" onClick={onTogglePolling}>
              <RefreshCw className={`me-2 h-3.5 w-3.5 ${livePolling ? 'animate-spin' : ''}`} />
              {livePolling ? labels.cutoverRun.polling : labels.cutoverRun.paused}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !windowRun ? (
          <LoadingSkeleton variant="detail" label={labels.cutoverRun.loadingRun} />
        ) : !runStarted ? (
          <div className="space-y-2 rounded-lg border bg-card p-3">
            <p className="text-sm font-semibold">{labels.cutoverRun.startTitle}</p>
            <p className="text-xs text-muted-foreground">
              {labels.cutoverRun.startDesc}
            </p>
            <Button disabled={startPending || !canStart} onClick={onStartRun}>
              {startPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <PlayCircle className="me-2 h-4 w-4" />}
              {labels.cutoverRun.startRun}
            </Button>
            {!canStart ? (
              <p className="text-xs text-muted-foreground">
                {labels.cutoverRun.beforeStarting(window.decision !== 'go' ? labels.cutoverRun.recordGoFirst : labels.cutoverRun.approvePlanFirst)}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            {windowRun?.binding ? (
              <BindingHeader binding={windowRun.binding} runbook={null} role={labels.runbook.roleParent} />
            ) : null}
            {succeeded ? (
              <div className="flex items-center gap-2 rounded-lg border border-success-500/40 bg-success-500/5 p-3 text-sm">
                <Check className="h-4 w-4 text-success-500" />
                <span>{labels.cutoverRun.runCompleted}</span>
              </div>
            ) : null}
            {failed ? (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <XCircle className="h-4 w-4 text-destructive" />
                <span>{labels.cutoverRun.runFailed(liveState?.status ?? '')}</span>
              </div>
            ) : null}
            {liveState ? (
              <>
                <RunProjectionBar state={liveState} label={labels.cutoverRun.label} />
                <LiveRunTaskList
                  state={liveState}
                  interactive
                  pendingTaskID={actPendingTaskID}
                  invocationsByTaskKey={connectorInvocationsByTaskKey}
                  onAct={(task, taskAction) => {
                    if (taskAction === 'fail') {
                      setFailTask(task);
                      return;
                    }
                    onActOnTask(task, taskAction, false);
                  }}
                />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {labels.cutoverRun.liveStateUnavailable}
              </p>
            )}
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={Boolean(failTask)}
        onOpenChange={(open) => { if (!open) setFailTask(null); }}
        title={labels.cutoverRun.failTaskTitle}
        description={failTask
          ? labels.cutoverRun.failTaskDesc(failTask.name)
          : ''}
        variant="destructive"
        confirmLabel={labels.cutoverRun.failTaskAndRun}
        cancelLabel={labels.cutoverRun.failTaskOnly}
        onConfirm={() => {
          if (failTask) onActOnTask(failTask, 'fail', true);
          setFailTask(null);
        }}
      />
    </Card>
  );
}

// RollbackRunView renders the rollback EXECUTION (P8): an optional
// "Generate rollback runbook" action (reverse-order isolated DR runbook), a
// "Trigger rollback" action that records a mandatory reason and starts the
// rollback DR run, and the live rollback run state (projection + per-task, read
// only — the DR engine drives the reverse execution). On the run's real
// completion the backend moves the wave and workloads to rolled_back.
function RollbackRunView({
  window,
  rollbackRun,
  liveState,
  loading,
  planApproved,
  onGenerate,
  generatePending,
  onTrigger,
  triggerPending,
  connectorInvocationsByTaskKey,
}: {
  window: MigrateCutoverWindow;
  rollbackRun: MigrateRollbackRun | null;
  liveState: MigrateDRRunLiveState | null;
  loading: boolean;
  planApproved: boolean;
  onGenerate: () => void;
  generatePending: boolean;
  onTrigger: (reason: string) => Promise<unknown>;
  triggerPending: boolean;
  connectorInvocationsByTaskKey?: Map<string, MigrateConnectorEvidence>;
}) {
  const labels = useMigrateLabels();
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isRunning = runIsRunning(liveState) || rollbackRun?.status === 'running';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Undo2 className="h-4 w-4" />{labels.rollbackRun.title}</CardTitle>
        <CardDescription>
          {labels.rollbackRun.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={!planApproved || generatePending} onClick={onGenerate}>
            {generatePending ? <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" /> : <Workflow className="me-2 h-3.5 w-3.5" />}
            {labels.rollbackRun.generateRunbook}
          </Button>
          <span className="text-xs text-muted-foreground">{labels.rollbackRun.optionalHint}</span>
        </div>

        <div className="space-y-2 rounded-lg border border-destructive/40 p-3">
          <Label htmlFor={`rollback-reason-${window.id}`}>{labels.rollbackRun.triggerTitle}</Label>
          <p className="text-xs text-muted-foreground">
            {labels.rollbackRun.triggerDesc}
          </p>
          <Textarea
            id={`rollback-reason-${window.id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={labels.rollbackRun.reasonPlaceholder}
            className="min-h-[56px]"
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={!reason.trim() || !planApproved || triggerPending || isRunning}
            onClick={() => setConfirmOpen(true)}
          >
            {triggerPending ? <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="me-2 h-3.5 w-3.5" />}
            {labels.rollbackRun.triggerButton}
          </Button>
          {!planApproved ? <p className="text-xs text-muted-foreground">{labels.rollbackRun.approveBeforeTrigger}</p> : null}
        </div>

        {loading && !rollbackRun ? (
          <LoadingSkeleton variant="list" count={2} />
        ) : rollbackRun ? (
          <div className="space-y-3">
            <div className="space-y-1 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={rollbackRunStatusVariant(rollbackRun.status)}>{rollbackRun.status}</Badge>
                <code className="font-mono text-caption text-muted-foreground">{labels.evidence.runInline} {rollbackRun.dr_run_id}</code>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{labels.rollbackRun.reasonLabel}</span> {rollbackRun.reason}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{labels.rollbackRun.triggeredLabel}</span> {formatDateTime(rollbackRun.created_at)}
              </p>
            </div>
            {liveState ? (
              <>
                <RunProjectionBar state={liveState} label={labels.rollbackRun.label} />
                <LiveRunTaskList
                  state={liveState}
                  interactive={false}
                  invocationsByTaskKey={connectorInvocationsByTaskKey}
                />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {labels.rollbackRun.runLinkedUnavailable}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{labels.rollbackRun.noRollbackTriggered}</p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={labels.rollbackRun.confirmTitle}
        description={labels.rollbackRun.confirmDesc(window.reference)}
        variant="destructive"
        confirmLabel={labels.rollbackRun.confirmLabel}
        typeToConfirm="ROLLBACK"
        onConfirm={async () => {
          await onTrigger(reason);
          setReason('');
        }}
      />
    </Card>
  );
}

function IntegrationsPanel({ connectors, windows, onChanged }: {
  connectors: MigrateConnector[];
  windows: MigrateCutoverWindow[];
  onChanged: () => Promise<void>;
}) {
  const labels = useMigrateLabels();
  const [form, setForm] = useState<{
    name: string;
    endpoint_url: string;
    auth_type: 'none' | 'bearer' | 'basic';
    secret_ref: string;
    enabled: boolean;
  }>({ name: '', endpoint_url: '', auth_type: 'none', secret_ref: '', enabled: true });
  const [invokeDraft, setInvokeDraft] = useState<Record<string, { window_id: string; action: string }>>({});
  const [lastInvocation, setLastInvocation] = useState<Record<string, MigrateConnectorInvocation>>({});
  const save = useMutation({
    mutationFn: () => saveMigrateConnector(form),
    onSuccess: async () => {
      showSuccess(labels.integrations.toastConnectorSaved, form.name);
      setForm({ name: '', endpoint_url: '', auth_type: 'none', secret_ref: '', enabled: true });
      await onChanged();
    },
    onError: showApiError,
  });
  const invoke = useMutation({
    mutationFn: ({ connector, windowID, action }: { connector: MigrateConnector; windowID: string; action: string }) =>
      invokeMigrateConnector(connector.id, {
        window_id: windowID,
        action: action.trim(),
        idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: (invocation, variables) => {
      setLastInvocation((current) => ({ ...current, [variables.connector.id]: invocation }));
      setInvokeDraft((current) => ({ ...current, [variables.connector.id]: { ...current[variables.connector.id], action: '' } }));
      showSuccess(labels.integrations.toastConnectorInvoked, labels.integrations.toastConnectorInvokedDetail(variables.connector.name, invocation.status));
    },
    onError: showApiError,
  });
  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>{labels.integrations.httpConnector}</CardTitle>
          <CardDescription>{labels.integrations.httpConnectorDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder={labels.integrations.connectorNamePlaceholder} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder={labels.integrations.endpointPlaceholder} value={form.endpoint_url} onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })} />
          <Select value={form.auth_type} onValueChange={(value: 'none' | 'bearer' | 'basic') => setForm({ ...form, auth_type: value })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{labels.integrations.noAuth}</SelectItem>
              <SelectItem value="bearer">{labels.integrations.bearer}</SelectItem>
              <SelectItem value="basic">{labels.integrations.basic}</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder={labels.integrations.secretRefPlaceholder} value={form.secret_ref} onChange={(e) => setForm({ ...form, secret_ref: e.target.value })} />
          <Button disabled={!form.name || !form.endpoint_url || save.isPending} onClick={() => save.mutate()}>
            <Plug className="me-2 h-4 w-4" />
            {labels.integrations.saveConnector}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{labels.integrations.connectors}</CardTitle>
          <CardDescription>
            {labels.integrations.connectorsDesc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EntityList
            title=""
            empty={labels.integrations.empty}
            items={connectors}
            render={(connector) => {
              const draft = invokeDraft[connector.id] ?? { window_id: '', action: '' };
              const invocation = lastInvocation[connector.id];
              const setDraft = (patch: Partial<{ window_id: string; action: string }>) =>
                setInvokeDraft((current) => ({ ...current, [connector.id]: { ...draft, ...patch } }));
              const canInvoke = connector.enabled && Boolean(draft.window_id) && draft.action.trim().length > 0;
              return (
                <div key={connector.id} className="space-y-2 rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Plug className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{connector.name}</p>
                        <p className="text-xs text-muted-foreground">{labels.integrations.connectorMeta(connector.provider, connector.auth_type)}</p>
                      </div>
                    </div>
                    <Badge variant={connector.enabled ? 'default' : 'outline'}>{connector.enabled ? labels.integrations.enabled : labels.integrations.disabled}</Badge>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <Select value={draft.window_id} onValueChange={(value) => setDraft({ window_id: value })}>
                      <SelectTrigger><SelectValue placeholder={labels.integrations.windowPlaceholder} /></SelectTrigger>
                      <SelectContent>
                        {windows.map((window) => (
                          <SelectItem key={window.id} value={window.id}>{window.reference} · {window.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder={labels.integrations.actionPlaceholder}
                      value={draft.action}
                      onChange={(event) => setDraft({ action: event.target.value })}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canInvoke || invoke.isPending}
                    onClick={() => invoke.mutate({ connector, windowID: draft.window_id, action: draft.action })}
                  >
                    {labels.integrations.invokeConnector}
                  </Button>
                  {windows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{labels.integrations.scheduleWindowFirst}</p>
                  ) : null}
                  {invocation ? (
                    <p className="text-xs text-muted-foreground">
                      {labels.integrations.lastInvocation(invocation.action, invocation.status)}
                      {invocation.http_status ? ` · HTTP ${invocation.http_status}` : ''}
                      {invocation.error_message ? ` · ${invocation.error_message}` : ''}
                    </p>
                  ) : null}
                </div>
              );
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function EntityList<T>({ title, empty, items, render }: { title: string; empty: string; items: T[]; render: (item: T) => React.ReactNode }) {
  if (!items.length) {
    return <EmptyState icon={Activity} title={empty} description={title || empty} size="compact" />;
  }
  return <div className="space-y-3">{items.map(render)}</div>;
}

function Row({ icon: Icon, title, meta, children }: { icon: React.ElementType; title: string; meta: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{meta}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function formatDuration(seconds?: number | null) {
  if (!seconds) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// formatVariance renders a schedule-variance value (actual-minus-planned seconds):
// negative = ahead of plan, positive = behind plan, zero = on plan. Shared by the
// command center and the stakeholder/exec summary so both read identically.
function formatVariance(seconds: number, labels: MigrateLabels): string {
  if (seconds === 0) return labels.format.onPlan;
  return seconds < 0
    ? labels.format.ahead(formatDuration(Math.abs(seconds)))
    : labels.format.behind(formatDuration(seconds));
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Unscheduled';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
