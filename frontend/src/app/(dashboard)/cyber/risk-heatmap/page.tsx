'use client';

import { LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { HelpTip } from '@/components/shared/help-tip';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { API_ENDPOINTS } from '@/lib/constants';
import { ExportMenu } from '@/components/cyber/export-menu';
import type { RiskHeatmapData } from '@/types/cyber';

import { useRiskHeatmapLabels } from './_lib/risk-heatmap-i18n';
import { HeatmapGrid } from './_components/heatmap-grid';
import { HeatmapLegend } from './_components/heatmap-legend';
import { HeatmapSummaryTable } from './_components/heatmap-summary-table';

export default function RiskHeatmapPage() {
  const t = useRiskHeatmapLabels();
  const {
    data: envelope,
    isLoading,
    error,
    mutate: refetch,
  } = useRealtimeData<{ data: RiskHeatmapData }>(API_ENDPOINTS.CYBER_RISK_HEATMAP, {
    pollInterval: 300000,
  });

  const heatmap = envelope?.data;
  const isEmpty =
    heatmap && heatmap.cells.every((c) => c.count === 0) && heatmap.total_vulnerabilities === 0;

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-5">
        <PageHeader
          title={t.pageTitle}
          description={t.pageDescription}
          actions={
            <div className="flex items-center gap-2">
              <HelpTip
                title={{ en: 'Reading the heatmap', ar: 'قراءة الخريطة الحرارية' }}
                content={{
                  en: 'Each cell plots open vulnerabilities by severity and asset type — the darker the cell, the more findings it holds. Start from the highest-severity columns and open a cell to drill into the underlying vulnerabilities.',
                  ar: 'تعرض كل خلية الثغرات المفتوحة حسب الخطورة ونوع الأصل — كلما كانت الخلية أغمق زاد عدد النتائج فيها. ابدأ من أعمدة الخطورة الأعلى وافتح الخلية للاطلاع على الثغرات التفصيلية.',
                }}
              />
              {heatmap ? (
                <ExportMenu
                  entityType="risk-heatmap"
                  baseUrl={API_ENDPOINTS.CYBER_RISK_HEATMAP}
                  currentFilters={{}}
                  totalCount={heatmap.total_vulnerabilities}
                  enabledFormats={['csv', 'json']}
                  csvDataKey="cells"
                />
              ) : null}
            </div>
          }
        />

        {isLoading ? (
          <div className="space-y-4">
            <LoadingSkeleton variant="card" />
            <LoadingSkeleton variant="chart" />
          </div>
        ) : error || !heatmap ? (
          <ErrorState message={t.loadError} onRetry={() => void refetch()} />
        ) : isEmpty ? (
          <EmptyState
            icon={LayoutGrid}
            title={t.emptyTitle}
            description={t.emptyDescription}
          />
        ) : (
          <>
            <HeatmapGrid data={heatmap} />
            <HeatmapLegend />
            <HeatmapSummaryTable data={heatmap} />
          </>
        )}
      </div>
    </PermissionRedirect>
  );
}
