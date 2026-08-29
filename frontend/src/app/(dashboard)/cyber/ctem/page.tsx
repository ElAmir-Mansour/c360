'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { StatCard } from '@/components/shared/stat-card';
import { Button } from '@/components/ui/button';
import { AlertOctagon, Gauge, LayoutGrid, Plus, Target } from 'lucide-react';
import type { PaginatedResponse } from '@/types/api';
import type { CTEMAssessment, ExposureScore } from '@/types/cyber';

import { ExposureScoreGauge } from './_components/exposure-score-gauge';
import { AssessmentCard } from './_components/assessment-card';
import { CreateAssessmentDialog } from './_components/create-assessment-dialog';
import { useCtemLabels } from './_lib/ctem-i18n';

export default function CyberCtemPage() {
  const t = useCtemLabels();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cyber-ctem-assessments'],
    queryFn: () =>
      apiGet<PaginatedResponse<CTEMAssessment>>(API_ENDPOINTS.CYBER_CTEM_ASSESSMENTS, {
        per_page: 20,
        sort: 'created_at',
        order: 'desc',
      }),
    refetchInterval: 30000,
  });

  const scoreQuery = useQuery({
    queryKey: ['cyber-ctem-exposure-score'],
    queryFn: () => apiGet<{ data: ExposureScore }>(API_ENDPOINTS.CYBER_CTEM_EXPOSURE_SCORE),
    refetchInterval: 60000,
  });

  const assessments = data?.data ?? [];
  const exposure = scoreQuery.data?.data;
  const criticalExposures = assessments.reduce(
    (sum, a) => sum + (a.findings_summary?.critical ?? 0),
    0,
  );

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.list.title}
          description={t.list.description}
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="me-1.5 h-3.5 w-3.5" />
              {t.list.newAssessment}
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label={t.list.statExposureScore}
            value={exposure ? `${exposure.score}${exposure.grade ? ` · ${exposure.grade}` : ''}` : '—'}
            tone="rose"
            icon={Gauge}
          />
          <StatCard
            label={t.list.statAssessments}
            value={assessments.length}
            tone="sky"
            icon={LayoutGrid}
          />
          <StatCard
            label={t.list.statCriticalExposures}
            value={criticalExposures}
            tone="rose"
            icon={AlertOctagon}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          {/* Exposure score sidebar */}
          <div className="lg:col-span-1">
            <ExposureScoreGauge />
          </div>

          {/* Assessment list */}
          <div className="lg:col-span-3">
            {isLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <LoadingSkeleton key={i} variant="card" />
                ))}
              </div>
            ) : isError ? (
              <ErrorState message={t.list.loadError} onRetry={() => void refetch()} />
            ) : assessments.length === 0 ? (
              <EmptyState
                icon={Target}
                title={t.list.emptyTitle}
                description={t.list.emptyDescription}
                action={{ label: t.list.newAssessment, onClick: () => setCreateOpen(true) }}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {assessments.map((a) => (
                  <AssessmentCard key={a.id} assessment={a} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <CreateAssessmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => refetch()}
      />
    </PermissionRedirect>
  );
}
