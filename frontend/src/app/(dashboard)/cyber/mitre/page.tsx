'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, TriangleAlert } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ExportMenu } from '@/components/cyber/export-menu';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { MITRECoverage, MITREFrameworkMeta, MITRETechniqueCoverage } from '@/types/cyber';

import { MitreCoverageStats } from './_components/mitre-coverage-stats';
import { MitreFilterBar, type MitreFilter } from './_components/mitre-filter-bar';
import { MitreLegend } from './_components/mitre-legend';
import { MitreMatrix } from './_components/mitre-matrix';
import { MitreTechniquePanel } from './_components/mitre-technique-panel';
import { useMitreLabels } from './_lib/mitre-i18n';

type ExpandedTechniqueCoverage = MITRETechniqueCoverage & {
  tactic_id: string;
  tactic_name: string;
};

function expandCoverage(raw: MITRECoverage): MITRECoverage {
  const tacticNameMap = new Map(raw.tactics.map((tactic) => [tactic.id, tactic.name]));
  const techniques: ExpandedTechniqueCoverage[] = [];

  raw.techniques.forEach((technique) => {
    technique.tactic_ids.forEach((tacticId) => {
      techniques.push({
        ...technique,
        tactic_id: tacticId,
        tactic_name: tacticNameMap.get(tacticId) ?? tacticId,
      });
    });
  });

  return {
    ...raw,
    techniques: techniques as MITRECoverage['techniques'],
  };
}

export default function MitreCoveragePage() {
  const t = useMitreLabels();
  const [activeFilter, setActiveFilter] = useState<MitreFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedTechnique, setSelectedTechnique] = useState<MITRETechniqueCoverage | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cyber-mitre-coverage'],
    queryFn: () => apiGet<{ data: MITRECoverage }>(API_ENDPOINTS.CYBER_MITRE_COVERAGE),
    staleTime: 120_000,
  });

  const { data: metaData } = useQuery({
    queryKey: ['cyber-mitre-framework-meta'],
    queryFn: () => apiGet<{ data: MITREFrameworkMeta }>(API_ENDPOINTS.CYBER_MITRE_FRAMEWORK_META),
    staleTime: 3_600_000,
  });
  const frameworkMeta = metaData?.data;

  const coverage = useMemo(() => (data?.data ? expandCoverage(data.data) : null), [data?.data]);

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.page.eyebrow}
          title={t.page.title}
          description={t.page.description}
          tags={
            coverage
              ? [
                  {
                    label: t.page.coverageTag(coverage.coverage_percent.toFixed(1)),
                    tone: 'success',
                    icon: <ShieldCheck className="h-3.5 w-3.5" aria-hidden />,
                  },
                  {
                    label: t.page.criticalGapsTag(coverage.critical_gap_count),
                    tone: coverage.critical_gap_count > 0 ? 'danger' : 'neutral',
                    icon: <TriangleAlert className="h-3.5 w-3.5" aria-hidden />,
                  },
                  { label: t.page.matrixTag, tone: 'info' },
                ]
              : undefined
          }
          actions={
            coverage ? (
              <ExportMenu
                entityType="mitre-coverage"
                baseUrl={API_ENDPOINTS.CYBER_MITRE_COVERAGE}
                currentFilters={{}}
                totalCount={coverage.total_techniques}
                enabledFormats={['csv', 'json']}
                csvDataKey="techniques"
              />
            ) : undefined
          }
        />

        {isLoading ? (
          <div className="space-y-6">
            <LoadingSkeleton variant="kpi" count={4} />
            <LoadingSkeleton variant="chart" />
          </div>
        ) : error || !coverage ? (
          <ErrorState
            message={t.page.loadError}
            error={error ?? undefined}
            onRetry={() => void refetch()}
          />
        ) : (
          <>
            {frameworkMeta?.is_stale && (
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-200">
                {t.page.staleBanner(frameworkMeta.version, frameworkMeta.updated_at, frameworkMeta.stale_days)}
              </div>
            )}
            <MitreCoverageStats coverage={coverage} />
            <MitreFilterBar
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              search={search}
              onSearchChange={setSearch}
            />
            <MitreLegend />
            <MitreMatrix
              coverage={coverage}
              activeFilter={activeFilter}
              search={search}
              selectedTechnique={selectedTechnique}
              onSelectTechnique={setSelectedTechnique}
            />
          </>
        )}

        <MitreTechniquePanel
          technique={selectedTechnique}
          onClose={() => setSelectedTechnique(null)}
        />
      </div>
    </PermissionRedirect>
  );
}
