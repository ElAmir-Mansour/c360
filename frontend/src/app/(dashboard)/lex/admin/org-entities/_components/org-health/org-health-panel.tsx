'use client';

/**
 * OrgHealthPanel — the org-entity registry "Health & QA" surface.
 *
 * Fetches the FULL entity registry (paging through `listOrgEntities`), runs the
 * pure {@link runOrgHealthRules} validation engine, and renders:
 *   - a big {@link HealthScoreBadge} (0..100 data-quality score + verdict);
 *   - a KPI strip of critical / warning / info counts;
 *   - a grouped issue list (by severity, then by area), each row a
 *     {@link HealthIssueRow} with a deep link + "how to fix";
 *   - clean loading / empty / error states.
 *
 * Self-contained: owns its own react-query, i18n resolution, and all states.
 * No required props — the list page mounts it directly.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, AlertOctagon, AlertTriangle, Info, RotateCcw } from 'lucide-react';
import { lexAdminApi, type OrgEntity } from '@/lib/lex/admin';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { SectionCard } from '@/components/suites/section-card';
import { StatTile } from '@/components/shared/stat-tile';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import type { AdminIssue } from '../../../_lib/admin-feature-utils';
import { runOrgHealthRules, computeHealthScore, countBySeverity } from '../../_lib/org-health-rules';
import { healthI18n } from '../../_lib/org-health-i18n';
import { HealthScoreBadge, scoreBand } from './health-score-badge';
import { HealthIssueRow } from './health-issue-row';

const PER_PAGE = 200;
const MAX_PAGES = 50; // hard safety cap (≤ 10k entities)
const QUERY_KEY = ['lex-admin-org-entities', 'health'] as const;

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** Fetch every page of the org-entity registry so rules see the whole tree. */
async function fetchAllOrgEntities(): Promise<OrgEntity[]> {
  const first = await lexAdminApi.listOrgEntities({ page: 1, per_page: PER_PAGE });
  const all: OrgEntity[] = [...first.data];
  const totalPages = Math.min(first.meta?.total_pages ?? 1, MAX_PAGES);
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await lexAdminApi.listOrgEntities({ page, per_page: PER_PAGE });
    all.push(...next.data);
    if (next.data.length === 0) break;
  }
  return all;
}

const SEVERITY_ORDER: AdminIssue['severity'][] = ['critical', 'warning', 'info'];

interface SeverityGroup {
  severity: AdminIssue['severity'];
  areas: { area: string; issues: AdminIssue[] }[];
}

/** Group issues by severity (fixed order) then by area (insertion order). */
function groupIssues(issues: AdminIssue[]): SeverityGroup[] {
  return SEVERITY_ORDER.map((severity) => {
    const inSeverity = issues.filter((issue) => issue.severity === severity);
    const areaMap = new Map<string, AdminIssue[]>();
    for (const issue of inSeverity) {
      const list = areaMap.get(issue.area) ?? [];
      list.push(issue);
      areaMap.set(issue.area, list);
    }
    return {
      severity,
      areas: Array.from(areaMap, ([area, areaIssues]) => ({ area, issues: areaIssues })),
    };
  }).filter((group) => group.areas.length > 0);
}

export default function OrgHealthPanel() {
  const { locale } = useLocaleOrDefault();
  const labels = locale === 'ar' ? healthI18n.ar : healthI18n.en;
  const t = labels.ui;
  const ruleLabels = labels.rules;

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAllOrgEntities,
    staleTime: 60_000,
  });

  const entities = query.data;

  const { issues, score, counts, groups } = useMemo(() => {
    const list = entities ? runOrgHealthRules(entities, ruleLabels) : [];
    return {
      issues: list,
      score: computeHealthScore(list),
      counts: countBySeverity(list),
      groups: groupIssues(list),
    };
  }, [entities, ruleLabels]);
  const issueTotal = issues.length;
  const criticalShare = percent(counts.critical, issueTotal);
  const warningShare = percent(counts.warning, issueTotal);
  const infoShare = percent(counts.info, issueTotal);
  const kpiCopy =
    locale === 'ar'
      ? {
          share: 'النسبة من الملاحظات',
          queue: 'ملاحظات الصحة',
        }
      : {
          share: 'Share of findings',
          queue: 'Health findings',
        };

  const groupHeaders: Record<AdminIssue['severity'], string> = {
    critical: t.groupCritical,
    warning: t.groupWarning,
    info: t.groupInfo,
  };

  const verdict = useMemo(() => {
    if (issues.length === 0) return t.verdictHealthy;
    switch (scoreBand(score)) {
      case 'green':
        return t.verdictGood;
      case 'amber':
        return t.verdictAtRisk;
      default:
        return t.verdictCritical;
    }
  }, [issues.length, score, t]);

  return (
    <SectionCard title={t.title} description={t.description}>
      {query.isLoading ? (
        <div className="space-y-4" role="status" aria-label={t.loadingLabel}>
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="kpi" count={3} />
          <LoadingSkeleton variant="list" count={4} />
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={AlertOctagon}
          title={t.errorTitle}
          description={t.errorDescription}
          action={{ label: t.retry, onClick: () => void query.refetch() }}
        />
      ) : issues.length === 0 ? (
        <div className="space-y-4">
          <HealthScoreBadge score={score} verdict={verdict} scoreLabel={t.scoreLabel} outOfLabel={t.scoreOutOf} />
          <EmptyState icon={ShieldCheck} title={t.emptyTitle} description={t.emptyDescription} />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
            <div className="lg:w-80">
              <HealthScoreBadge score={score} verdict={verdict} scoreLabel={t.scoreLabel} outOfLabel={t.scoreOutOf} />
            </div>
            <div className="org-health-kpi-grid grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile
                label={t.kpiCritical}
                value={counts.critical}
                icon={AlertOctagon}
                themeClass="kpi-theme-red"
                progress={criticalShare}
                progressLabel={kpiCopy.share}
                detail={kpiCopy.queue}
                detailValue={`${criticalShare}%`}
                size="md"
                appearance="operational"
                className="org-health-kpi-card"
                href="#org-health-issues"
              />
              <StatTile
                label={t.kpiWarning}
                value={counts.warning}
                icon={AlertTriangle}
                themeClass="kpi-theme-amber"
                progress={warningShare}
                progressLabel={kpiCopy.share}
                detail={kpiCopy.queue}
                detailValue={`${warningShare}%`}
                size="md"
                appearance="operational"
                className="org-health-kpi-card"
                href="#org-health-issues"
              />
              <StatTile
                label={t.kpiInfo}
                value={counts.info}
                icon={Info}
                themeClass="kpi-theme-sky"
                progress={infoShare}
                progressLabel={kpiCopy.share}
                detail={kpiCopy.queue}
                detailValue={`${infoShare}%`}
                size="md"
                appearance="operational"
                className="org-health-kpi-card"
                href="#org-health-issues"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">{t.issuesTitle}</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{t.issueCount(issues.length)}</span>
              <Button size="sm" variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching}>
                <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {t.retry}
              </Button>
            </div>
          </div>

          <div id="org-health-issues" className="scroll-mt-24 space-y-5">
            {groups.map((group) => (
              <section key={group.severity} className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {groupHeaders[group.severity]}
                </h4>
                {group.areas.map((areaGroup) => (
                  <div key={`${group.severity}:${areaGroup.area}`} className="space-y-2">
                    {group.areas.length > 1 ? (
                      <p className="text-xs font-medium text-muted-foreground/80">{areaGroup.area}</p>
                    ) : null}
                    <div className="space-y-2">
                      {areaGroup.issues.map((issue) => (
                        <HealthIssueRow key={issue.id} issue={issue} openEntityLabel={t.openEntity} />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
