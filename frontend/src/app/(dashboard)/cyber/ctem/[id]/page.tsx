'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import type { StatTone } from '@/components/shared/stat-card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Target, Trash2, XCircle, FileDown, ShieldX, ShieldAlert, ShieldQuestion, ShieldCheck, ListChecks } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useState } from 'react';
import { timeAgo } from '@/lib/utils';
import { showSuccess, showError } from '@/lib/toast';
import { PhaseStepper } from './_components/phase-stepper';
import { FindingTable } from './_components/finding-table';
import { RemediationGroups } from './_components/remediation-groups';
import { AssessmentComparisonView } from './_components/assessment-comparison';
import { normalizeCTEMPhases } from '@/types/cyber';
import type { CTEMAssessment, CTEMFinding } from '@/types/cyber';
import type { PaginatedResponse } from '@/types/api';
import { useCtemLabels } from '../_lib/ctem-i18n';

/** Map ALL backend assessment statuses to display styles */
const STATUS_COLORS: Record<string, string> = {
  created: 'text-muted-foreground',
  scoping: 'text-status-info',
  discovery: 'text-status-info',
  prioritizing: 'text-status-info',
  validating: 'text-status-info',
  mobilizing: 'text-status-info',
  completed: 'text-primary',
  failed: 'text-status-error',
  cancelled: 'text-foreground/55',
};

/** Statuses that indicate an active/running assessment */
const ACTIVE_STATUSES = ['created', 'scoping', 'discovery', 'prioritizing', 'validating', 'mobilizing'];
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

export default function CTEMAssessmentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useCtemLabels();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: envelope, isLoading, error, refetch } = useQuery({
    queryKey: [`ctem-assessment-${id}`],
    queryFn: () => apiGet<{ data: CTEMAssessment }>(API_ENDPOINTS.CYBER_CTEM_ASSESSMENT_DETAIL(id)),
    refetchInterval: (q) => {
      const s = q.state.data?.data.status;
      return s && !TERMINAL_STATUSES.includes(s) ? 30000 : false;
    },
  });

  const assessment = envelope?.data;

  // Fetch findings from dedicated endpoint (backend does NOT embed findings in assessment)
  const findingsQuery = useQuery({
    queryKey: [`ctem-assessment-findings-${id}`],
    queryFn: () =>
      apiGet<PaginatedResponse<CTEMFinding>>(API_ENDPOINTS.CYBER_CTEM_ASSESSMENT_FINDINGS(id), {
        per_page: 200,
        sort: 'priority_score',
        order: 'desc',
      }),
    enabled: !!assessment,
    refetchInterval: () => {
      return assessment && !TERMINAL_STATUSES.includes(assessment.status) ? 30000 : false;
    },
  });

  const findings = findingsQuery.data?.data ?? [];
  const summary = assessment?.findings_summary;

  const isActive = assessment && ACTIVE_STATUSES.includes(assessment.status);
  const canCancel = assessment && !TERMINAL_STATUSES.includes(assessment.status) && assessment.status !== 'created';
  const canDelete = assessment && (assessment.status === 'created' || TERMINAL_STATUSES.includes(assessment.status));

  const [exporting, setExporting] = useState(false);

  const handleExport = async (format: 'pdf' | 'docx') => {
    setExporting(true);
    try {
      await apiPost(API_ENDPOINTS.CYBER_CTEM_ASSESSMENT_REPORT_EXPORT(id), { format });
      showSuccess(t.detail.reportExportStarted(format.toUpperCase()));
    } catch {
      showError(t.detail.exportFailed);
    } finally {
      setExporting(false);
    }
  };

  const handleCancel = async () => {
    try {
      await apiPost(API_ENDPOINTS.CYBER_CTEM_ASSESSMENT_CANCEL(id));
      showSuccess(t.detail.cancelledToast);
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['cyber-ctem-assessments'] });
    } catch {
      showError(t.detail.cancelFailed);
    }
    setCancelOpen(false);
  };

  const handleDelete = async () => {
    try {
      await apiDelete(`${API_ENDPOINTS.CYBER_CTEM_ASSESSMENTS}/${id}`);
      showSuccess(t.detail.deletedToast);
      void queryClient.invalidateQueries({ queryKey: ['cyber-ctem-assessments'] });
      router.push('/cyber/ctem');
    } catch {
      showError(t.detail.deleteFailed);
    }
    setDeleteOpen(false);
  };

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        {isLoading ? (
          <LoadingSkeleton variant="card" />
        ) : error || !assessment ? (
          <ErrorState message={t.detail.loadError} onRetry={() => refetch()} />
        ) : (
          <>
            <PageHeader
              title={
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => router.back()}
                    className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <Target className="h-5 w-5 text-primary" />
                  <span>{assessment.name}</span>
                </div>
              }
              description={
                <div className="flex items-center gap-4 ps-11">
                  <span className={`text-sm font-medium capitalize ${STATUS_COLORS[assessment.status] ?? ''}`}>
                    {t.status[assessment.status] ?? assessment.status.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t.detail.started(timeAgo(assessment.created_at))}
                  </span>
                </div>
              }
              actions={
                <div className="flex items-center gap-2">
                  {assessment.status === 'completed' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" disabled={exporting}>
                          <FileDown className="me-1.5 h-3.5 w-3.5" />
                          {exporting ? t.detail.exporting : t.detail.export}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleExport('pdf')}>{t.detail.exportPdf}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExport('docx')}>{t.detail.exportDocx}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {canCancel && (
                    <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
                      <XCircle className="me-1.5 h-3.5 w-3.5" />
                      {t.detail.cancel}
                    </Button>
                  )}
                  {canDelete && (
                    <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                      <Trash2 className="me-1.5 h-3.5 w-3.5" />
                      {t.detail.delete}
                    </Button>
                  )}
                </div>
              }
            />

            {/* Summary KPIs */}
            {summary && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {([
                  { label: t.detail.statCritical, value: summary.critical, icon: ShieldX, tone: 'rose' },
                  { label: t.detail.statHigh, value: summary.high, icon: ShieldAlert, tone: 'rose' },
                  { label: t.detail.statMedium, value: summary.medium, icon: ShieldQuestion, tone: 'gold' },
                  { label: t.detail.statLow, value: summary.low, icon: ShieldCheck, tone: 'sky' },
                  { label: t.detail.statTotal, value: summary.total, icon: ListChecks, tone: 'slate' },
                ] as { label: string; value: number; icon: typeof ShieldX; tone: StatTone }[]).map(({ label, value, icon, tone }) => (
                  <DetailStatCard
                    key={label}
                    label={label}
                    value={value.toLocaleString()}
                    icon={icon}
                    tone={tone}
                    className=""
                  />
                ))}
              </div>
            )}

            {/* Phase stepper */}
            <div className="rounded-xl border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold">{t.detail.progressTitle}</h3>
              <PhaseStepper phases={normalizeCTEMPhases(assessment.phases)} currentPhase={assessment.current_phase} />
            </div>

            {/* Findings */}
            <div>
              <h3 className="mb-3 text-sm font-semibold">
                {t.detail.findingsTitle}
                {findings.length > 0 && (
                  <span className="ms-2 text-xs font-normal text-muted-foreground">({findings.length})</span>
                )}
              </h3>
              {findingsQuery.isLoading ? (
                <LoadingSkeleton variant="table-row" />
              ) : (
                <FindingTable
                  findings={findings}
                  onStatusUpdated={() => {
                    void findingsQuery.refetch();
                    void refetch();
                  }}
                />
              )}
            </div>

            {/* Remediation Groups */}
            <RemediationGroups assessmentId={id} />

            {/* Assessment Comparison — only for completed assessments */}
            {assessment.status === 'completed' && (
              <AssessmentComparisonView assessmentId={id} />
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t.detail.cancelDialogTitle}
        description={t.detail.cancelDialogDescription}
        confirmLabel={t.detail.cancelDialogConfirm}
        variant="destructive"
        onConfirm={handleCancel}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t.detail.deleteDialogTitle}
        description={t.detail.deleteDialogDescription}
        confirmLabel={t.detail.deleteDialogConfirm}
        variant="destructive"
        onConfirm={handleDelete}
      />
    </PermissionRedirect>
  );
}
