'use client';

/**
 * ENTITY-360 (feature #23) — counterparty/organization register.
 *
 * A premium list of every external organization the legal team deals with,
 * stitched together client-side from contracts, cases and settlements (see
 * `_lib/entity-data.ts`). Each row links to a 360° detail page. Built on the
 * shared Lex primitives (`<LexListShell>` + `<LexKpiStrip>`) so it inherits the
 * suite's elevated, bilingual, RTL-safe chrome and KSA formatting.
 */

import { useMemo, useState } from 'react';
import {
  Banknote,
  Building2,
  FileText,
  Gavel,
  Percent,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { RouteError } from '@/components/common/route-error';
import { SearchInput } from '@/components/shared/forms/search-input';
import { LexListShell } from '@/components/lex/list-shell';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { useEntities, normalizeOrgName } from './_lib/entity-data';
import { useEntityLabels } from './_lib/entity-i18n';
import { EntitiesTable } from './_components/entities-table';

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function LexEntitiesPage() {
  const { locale, direction } = useLocaleOrDefault();
  const dir: 'ltr' | 'rtl' = direction === 'rtl' ? 'rtl' : 'ltr';
  const f = useLexFormat();
  const L = useEntityLabels();
  const [search, setSearch] = useState('');
  const [entityScope, setEntityScope] = useState<
    'all' | 'exposure' | 'settlements' | 'recovery' | 'cases' | 'contracts'
  >('all');

  const { entities, summary, isLoading, isError, refetch } = useEntities(locale);

  // Client-side search over the aggregated org names (normalized match so
  // "acme co" finds "Acme Company").
  const filtered = useMemo(() => {
    const q = normalizeOrgName(search);
    const searched = q
      ? entities.filter(
          (e) => e.key.includes(q) || e.name.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : entities;
    const scoped = searched.filter((entity) => {
      if (entityScope === 'all') return true;
      if (entityScope === 'exposure') return entity.totalExposure > 0;
      if (entityScope === 'settlements' || entityScope === 'recovery') return entity.settlementValue > 0;
      if (entityScope === 'cases') return entity.openCaseCount > 0;
      return entity.activeContractCount > 0;
    });
    if (entityScope === 'recovery') return [...scoped].sort((a, b) => b.recoveryRate - a.recoveryRate);
    if (entityScope === 'exposure') return [...scoped].sort((a, b) => b.totalExposure - a.totalExposure);
    return scoped;
  }, [entities, entityScope, search]);
  const settlementExposureShare = percent(summary.settlementExposure, summary.totalExposure);
  const recoveryPct = Math.round(summary.recoveryRate * 100);
  const kpiCopy = useMemo(
    () =>
      locale === 'ar'
        ? {
            registryScope: 'سجل الجهات',
            portfolioShare: 'النسبة من المحفظة',
            recoveryProgress: 'تقدم الاسترداد',
          }
        : {
            registryScope: 'Entity registry',
            portfolioShare: 'Share of portfolio',
            recoveryProgress: 'Recovery progress',
          },
    [locale],
  );

  const kpis: LexKpiItem[] = useMemo(
    () => [
      {
        id: 'organizations',
        label: L.kpis.organizations,
        value: summary.organizationCount,
        theme: 'primary',
        icon: Building2,
        description: L.list.description,
        detail: kpiCopy.registryScope,
        detailValue: summary.organizationCount,
        onAction: () => setEntityScope('all'),
        pressed: entityScope === 'all',
      },
      {
        id: 'exposure',
        label: L.kpis.totalExposure,
        value: f.formatCurrencyCompact(summary.totalExposure, { currency: 'SAR' }),
        theme: 'primary',
        icon: Wallet,
        description: L.kpis.totalExposure,
        detail: kpiCopy.registryScope,
        detailValue: summary.organizationCount,
        onAction: () => setEntityScope('exposure'),
        pressed: entityScope === 'exposure',
      },
      {
        id: 'settlement-exposure',
        label: L.kpis.settlementExposure,
        value: f.formatCurrencyCompact(summary.settlementExposure, { currency: 'SAR' }),
        theme: 'amber',
        icon: Banknote,
        description: L.kpis.settlementExposure,
        progress: settlementExposureShare,
        progressLabel: kpiCopy.portfolioShare,
        detail: kpiCopy.portfolioShare,
        detailValue: `${settlementExposureShare}%`,
        onAction: () => setEntityScope('settlements'),
        pressed: entityScope === 'settlements',
      },
      {
        id: 'recovery',
        label: L.kpis.recoveryRate,
        value: f.formatPercent(summary.recoveryRate),
        theme: 'emerald',
        icon: Percent,
        description: L.kpis.recoveryRate,
        progress: recoveryPct,
        progressLabel: kpiCopy.recoveryProgress,
        detail: kpiCopy.recoveryProgress,
        detailValue: `${recoveryPct}%`,
        onAction: () => setEntityScope('recovery'),
        pressed: entityScope === 'recovery',
      },
      {
        id: 'open-cases',
        // Real count: cases are attributed to counterparties via their hydrated
        // `parties[]` (`expand=parties`), so the open-case rollup is trustworthy.
        label: L.kpis.openCases,
        value: summary.openCaseCount,
        theme: 'orange',
        icon: Gavel,
        description: L.kpis.openCases,
        detail: kpiCopy.registryScope,
        detailValue: summary.organizationCount,
        onAction: () => setEntityScope('cases'),
        pressed: entityScope === 'cases',
      },
      {
        id: 'active-contracts',
        label: L.kpis.activeContracts,
        value: summary.activeContractCount,
        theme: 'primary',
        icon: FileText,
        description: L.kpis.activeContracts,
        detail: kpiCopy.registryScope,
        detailValue: summary.organizationCount,
        onAction: () => setEntityScope('contracts'),
        pressed: entityScope === 'contracts',
      },
    ],
    [L, summary, f, kpiCopy, recoveryPct, settlementExposureShare, entityScope],
  );

  if (isError) {
    return (
      <LexRouteGuard route="/lex/entities">
        <div dir={dir} lang={locale}>
          <RouteError
            segment="Entity 360"
            error={new Error(L.list.errorDescription)}
            reset={refetch}
          />
        </div>
      </LexRouteGuard>
    );
  }

  return (
    <LexRouteGuard route="/lex/entities">
      <div lang={locale}>
        <LexListShell
          dir={dir}
          eyebrow={L.list.eyebrow}
          title={
            <span className="inline-flex items-center gap-2.5">
              <TrendingUp className="h-6 w-6 text-primary rtl:-scale-x-100" aria-hidden />
              {L.list.title}
            </span>
          }
          description={L.list.description}
          loading={isLoading}
          skeletonRows={8}
          skeletonCols={6}
          kpi={<LexKpiStrip items={kpis} columns={6} dir={dir} />}
          filters={
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={L.list.searchPlaceholder}
            />
          }
          empty={
            filtered.length === 0
              ? {
                  icon: Building2,
                  title: L.list.emptyTitle,
                  description: L.list.emptyDescription,
                }
              : null
          }
        >
          <EntitiesTable entities={filtered} labels={L.list} dir={dir} />
        </LexListShell>
      </div>
    </LexRouteGuard>
  );
}
