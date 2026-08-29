'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Network, PercentCircle, Search, ShieldAlert, ShieldX } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { StatTile } from '@/components/shared/stat-tile';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import { lexAdminApi, ORG_ENTITY_TYPES, type OrgEntity, type OrgEntityType } from '@/lib/lex/admin';
import {
  COVERAGE_COLUMN_KEYS,
  ESCALATION_ROLE_KEYS,
  GOVERNANCE_ROLE_KEYS,
  buildCoverageRows,
  escalationLevel,
  summarizeCoverage,
} from '../../_lib/escalation-coverage';
import { coverageLabels } from '../../_lib/escalation-coverage-i18n';
import { CoverageCell } from './coverage-cell';
import { CoverageAssignDialog, type CoverageAssignTarget } from './coverage-assign-dialog';

interface EscalationCoverageMatrixProps {
  /** When true, RED/AMBER cells open the assign dialog. Read-only otherwise. */
  canWrite?: boolean;
}

/** Visible-row cap so a ~200+ entity tenant stays snappy without virtualization. */
const ROW_CAP = 120;

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function EscalationCoverageMatrix({ canWrite = false }: EscalationCoverageMatrixProps) {
  const { locale } = useLocaleOrDefault();
  const t = locale === 'ar' ? coverageLabels.ar : coverageLabels.en;

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<OrgEntityType | 'all'>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [assignTarget, setAssignTarget] = useState<CoverageAssignTarget | null>(null);

  const query = useQuery({
    queryKey: ['lex-admin-org-entities', 'coverage'],
    queryFn: () => lexAdminApi.listOrgEntities({ page: 1, per_page: 500 }),
  });

  const entities: OrgEntity[] = useMemo(() => query.data?.data ?? [], [query.data]);

  // Coverage is computed over the FULL tenant so inheritance walks real ancestry,
  // independent of the row filters applied below.
  const allRows = useMemo(() => buildCoverageRows(entities), [entities]);
  const summary = useMemo(() => summarizeCoverage(allRows), [allRows]);
  const noneShare = percent(summary.none, summary.total);
  const inheritedShare = percent(summary.inherited, summary.total);
  const boundShare = percent(summary.bound, summary.total);
  const kpiCopy =
    locale === 'ar'
      ? {
          matrixScope: 'كل خلايا المصفوفة',
          share: 'النسبة من المصفوفة',
        }
      : {
          matrixScope: 'All matrix cells',
          share: 'Share of matrix',
        };

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRows.filter(({ entity }) => {
      if (activeOnly && !entity.active) return false;
      if (typeFilter !== 'all' && entity.entity_type !== typeFilter) return false;
      if (needle) {
        const haystack = [entity.code, resolveLocalized(entity.name, 'en'), resolveLocalized(entity.name, 'ar')]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [allRows, search, typeFilter, activeOnly]);

  const visibleRows = filteredRows.slice(0, ROW_CAP);
  const capped = filteredRows.length > ROW_CAP;

  const kpis = (
    <div className="escalation-coverage-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label={t.kpiNoCoverage}
        value={summary.none}
        themeClass="kpi-theme-red"
        icon={ShieldX}
        loading={query.isLoading}
        progress={noneShare}
        progressLabel={kpiCopy.share}
        detail={kpiCopy.matrixScope}
        detailValue={`${noneShare}%`}
        size="md"
        appearance="operational"
        className="escalation-coverage-kpi-card"
        href="#escalation-coverage-matrix-records"
      />
      <StatTile
        label={t.kpiInherited}
        value={summary.inherited}
        themeClass="kpi-theme-amber"
        icon={ShieldAlert}
        loading={query.isLoading}
        progress={inheritedShare}
        progressLabel={kpiCopy.share}
        detail={kpiCopy.matrixScope}
        detailValue={`${inheritedShare}%`}
        size="md"
        appearance="operational"
        className="escalation-coverage-kpi-card"
        href="#escalation-coverage-matrix-records"
      />
      <StatTile
        label={t.kpiBound}
        value={summary.bound}
        themeClass="kpi-theme-emerald"
        icon={CheckCircle2}
        loading={query.isLoading}
        progress={boundShare}
        progressLabel={kpiCopy.share}
        detail={kpiCopy.matrixScope}
        detailValue={`${boundShare}%`}
        size="md"
        appearance="operational"
        className="escalation-coverage-kpi-card"
        href="#escalation-coverage-matrix-records"
      />
      <StatTile
        label={t.kpiCoverage}
        value={`${summary.coveragePct}%`}
        themeClass="kpi-theme-primary"
        icon={PercentCircle}
        loading={query.isLoading}
        progress={summary.coveragePct}
        progressLabel={kpiCopy.share}
        detail={kpiCopy.matrixScope}
        detailValue={`${summary.coveragePct}%`}
        size="md"
        appearance="operational"
        className="escalation-coverage-kpi-card"
        href="#escalation-coverage-matrix-records"
      />
    </div>
  );

  return (
    <SectionCard title={t.title} description={t.description}>
      <div className="space-y-5">
        {kpis}

        <Legend labels={t} />

        {/* Controls */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-xs sm:flex-1">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="ps-9"
              aria-label={t.searchPlaceholder}
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as OrgEntityType | 'all')}>
            <SelectTrigger className="sm:w-52" aria-label={t.typeFilterLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.typeFilterAll}</SelectItem>
              {ORG_ENTITY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t.entityTypes[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            {t.activeOnly}
          </label>
        </div>

        {/* Body */}
        {query.isLoading ? (
          <LoadingSkeleton variant="table" count={8} />
        ) : query.isError ? (
          <EmptyState
            icon={AlertTriangle}
            title={t.errorTitle}
            description={t.errorDescription}
            action={{ label: t.retry, onClick: () => query.refetch() }}
          />
        ) : entities.length === 0 ? (
          <EmptyState icon={Network} title={t.emptyTitle} description={t.emptyDescription} />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={Search}
            title={t.emptyFilteredTitle}
            description={t.emptyFilteredDescription}
            size="compact"
          />
        ) : (
          <div id="escalation-coverage-matrix-records" className="scroll-mt-24 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t.showingCount(visibleRows.length, filteredRows.length)}</span>
              {capped ? <span>{t.rowCapNotice(ROW_CAP)}</span> : null}
            </div>
            <CoverageTable
              rows={visibleRows}
              canWrite={canWrite}
              labels={t}
              locale={locale}
              onAssign={setAssignTarget}
            />
          </div>
        )}
      </div>

      <CoverageAssignDialog
        target={assignTarget}
        labels={t}
        onOpenChange={(open) => {
          if (!open) setAssignTarget(null);
        }}
      />
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */

function Legend({ labels }: { labels: typeof coverageLabels.en }) {
  const items = [
    { key: 'bound', dot: 'bg-success-500', text: labels.legendBound },
    { key: 'inherited', dot: 'bg-warning-300', text: labels.legendInherited },
    { key: 'none', dot: 'bg-rose-500', text: labels.legendNone },
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/30 px-4 py-2.5 text-xs">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{labels.legendTitle}</span>
      {items.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-2">
          <span className={cn('size-2.5 rounded-full', item.dot)} aria-hidden />
          {item.text}
        </span>
      ))}
    </div>
  );
}

interface CoverageTableProps {
  rows: ReturnType<typeof buildCoverageRows>;
  canWrite: boolean;
  labels: typeof coverageLabels.en;
  locale: 'en' | 'ar';
  onAssign: (target: CoverageAssignTarget) => void;
}

function CoverageTable({ rows, canWrite, labels, locale, onAssign }: CoverageTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          {/* Group header row: escalation ladder vs governance. */}
          <tr className="border-b bg-muted/50 text-overline uppercase text-muted-foreground">
            <th className="px-3 py-2 text-start font-semibold" rowSpan={2}>
              {labels.entityColumn}
            </th>
            <th className="border-s px-3 py-1.5 text-center font-semibold" colSpan={ESCALATION_ROLE_KEYS.length}>
              {labels.ladderGroup}
            </th>
            <th className="border-s px-3 py-1.5 text-center font-semibold" colSpan={GOVERNANCE_ROLE_KEYS.length}>
              {labels.governanceGroup}
            </th>
          </tr>
          {/* Per-role header row. */}
          <tr className="border-b bg-muted/30 text-caption text-muted-foreground">
            {COVERAGE_COLUMN_KEYS.map((roleKey, idx) => {
              const level = escalationLevel(roleKey);
              const startsGovernance = idx === ESCALATION_ROLE_KEYS.length;
              return (
                <th
                  key={roleKey}
                  className={cn('px-2 py-2 align-bottom font-medium', (idx === 0 || startsGovernance) && 'border-s')}
                  title={labels.roleKeys[roleKey]}
                >
                  <div className="flex flex-col items-center gap-1">
                    {level ? (
                      <Badge variant="outline" className="px-1.5 py-0 tracking-normal">
                        {labels.levelBadge(level)}
                      </Badge>
                    ) : null}
                    <span className="max-w-[5.5rem] text-center leading-tight">{labels.roleKeys[roleKey]}</span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entity, cells }) => (
            <tr key={entity.id} className="border-b last:border-0 hover:bg-muted/20">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{resolveLocalized(entity.name, locale) || entity.code}</span>
                  {!entity.active ? (
                    <Badge variant="secondary" className="px-1.5 py-0 tracking-normal">
                      {labels.entityTypes[entity.entity_type]}
                    </Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {entity.code} · {labels.entityTypes[entity.entity_type]}
                </div>
              </td>
              {COVERAGE_COLUMN_KEYS.map((roleKey, idx) => {
                const startsGovernance = idx === ESCALATION_ROLE_KEYS.length;
                return (
                  <td
                    key={roleKey}
                    className={cn('px-2 py-2 text-center', (idx === 0 || startsGovernance) && 'border-s')}
                  >
                    <div className="flex justify-center">
                      <CoverageCell
                        cell={cells[roleKey]}
                        entityCode={entity.code}
                        labels={labels}
                        interactive={canWrite}
                        onAssign={() =>
                          onAssign({
                            entityId: entity.id,
                            entityCode: entity.code,
                            roleKey,
                          })
                        }
                      />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
