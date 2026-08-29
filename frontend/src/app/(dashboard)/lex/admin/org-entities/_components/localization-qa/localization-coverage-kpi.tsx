'use client';

/**
 * KPI strip for the bilingual completeness QA panel. Renders the OVERALL
 * coverage % large, plus entity-name and role-label coverage as StatTiles. Each
 * tile's tone is derived from a threshold so the strip reads at a glance.
 */
import { Globe, Building2, ShieldCheck } from 'lucide-react';
import { StatTile } from '@/components/shared/stat-tile';
import type { LocalizationCoverage } from '../../_lib/org-localization';
import type { LocalizationQaLabels } from '../../_lib/localization-qa-i18n';

interface LocalizationCoverageKpiProps {
  coverage: LocalizationCoverage;
  labels: LocalizationQaLabels;
}

/** Threshold → semantic theme. 100% green, ≥80% amber, otherwise red. */
function themeForPct(pct: number): string {
  if (pct >= 100) return 'kpi-theme-emerald';
  if (pct >= 80) return 'kpi-theme-amber';
  return 'kpi-theme-red';
}

export function LocalizationCoverageKpi({ coverage, labels }: LocalizationCoverageKpiProps) {
  return (
    <div className="localization-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <StatTile
        label={labels.kpiOverall}
        value={`${coverage.overallPct}%`}
        icon={Globe}
        themeClass={themeForPct(coverage.overallPct)}
        progress={coverage.overallPct}
        progressLabel={labels.kpiOverallDesc}
        detail={labels.kpiOverall}
        detailValue={`${coverage.overallPct}%`}
        size="md"
        appearance="operational"
        className="localization-kpi-card"
        href="#localization-qa-records"
      />
      <StatTile
        label={labels.kpiEntities}
        value={`${coverage.entitiesPct}%`}
        icon={Building2}
        themeClass={themeForPct(coverage.entitiesPct)}
        progress={coverage.entitiesPct}
        progressLabel={labels.kpiEntitiesDesc}
        detail={labels.kpiEntities}
        detailValue={`${coverage.entitiesPct}%`}
        size="md"
        appearance="operational"
        className="localization-kpi-card"
        href="#localization-qa-records"
      />
      <StatTile
        label={labels.kpiRoles}
        value={`${coverage.rolesPct}%`}
        icon={ShieldCheck}
        themeClass={themeForPct(coverage.rolesPct)}
        progress={coverage.rolesPct}
        progressLabel={labels.kpiRolesDesc}
        detail={labels.kpiRoles}
        detailValue={`${coverage.rolesPct}%`}
        size="md"
        appearance="operational"
        className="localization-kpi-card"
        href="#localization-qa-records"
      />
    </div>
  );
}
