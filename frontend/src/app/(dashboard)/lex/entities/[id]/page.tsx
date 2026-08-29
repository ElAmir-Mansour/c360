'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

/**
 * ENTITY-360 detail (feature #23) — one organization's full legal footprint.
 *
 * A counterparty PROFILE (not a workflow record): there is no dedicated
 * counterparty-master endpoint, so the org is aggregated client-side from
 * contracts, cases and settlements (see `entities/_lib/entity-data.ts`). The
 * detail is laid out on the proven service-desk detail pattern: a flat `card`
 * hero band with a nav/shareability toolbar, a headline KPI strip, then a
 * two-column body — tabbed sections on the left, a persistent sticky right rail
 * (organization/people · linked-records · recent-activity) on the right. The
 * rail stays visible across every tab. Reuses the shared Lex primitives
 * (`<LexKpiStrip>`, `<LexActivityTimeline>`, `<EntityRecordList>`) and, where the
 * org has a settlement on record, the existing `<CounterpartyInsights>` panel.
 *
 * An entity has no lifecycle status, type, registration, jurisdiction or contact
 * person — so the playbook's action bar and status stepper do not apply, and the
 * hero carries DERIVED posture chips (records / open cases / active contracts)
 * rather than a status/type chip.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Banknote, Building2, FileText, Gavel, Handshake, Wallet } from 'lucide-react';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { SectionCard } from '@/components/suites/section-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { LexActivityTimeline } from '@/components/lex/activity-timeline';
import { LexEmptyState } from '@/components/lex/empty-state';
import { PageLoader } from '@/components/common/page-loader';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { useLexFormat, type LexFormatter } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CounterpartyInsights } from '../../settlements/_components/counterparty-insights';
import { settlementsApi } from '@/lib/lex/settlements';
import { useQuery } from '@tanstack/react-query';
import { selectEntityById, useEntities, isActiveEntityContractStatus, type EntityFootprint } from '../_lib/entity-data';
import { useEntityLabels, type EntityLabels } from '../_lib/entity-i18n';
import { EntityRecordList } from '../_components/entity-record-list';
import { RecoveryMeter } from '../_components/entities-table';
// --- Revamp wave (service-desk detail pattern) ---
import { EntityHeroBand } from './_components/entity-hero-band';
import { EntityToolbarNav } from './_components/entity-toolbar-nav';
import { EntityPeopleCard } from './_components/entity-people-card';
import { EntityRelatedCard } from './_components/entity-related-card';
import { EntityActivityMini } from './_components/entity-activity-mini';
import { buildEntityActivityEvents } from './_components/entity-activity';

type DetailTab = 'overview' | 'contracts' | 'cases' | 'settlements' | 'activity';

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function LexEntityDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { locale, direction } = useLocaleOrDefault();
  const dir: 'ltr' | 'rtl' = direction === 'rtl' ? 'rtl' : 'ltr';
  const f = useLexFormat();
  const L = useEntityLabels();
  const labels = L.detail;

  const { entities, isLoading } = useEntities(locale);
  const entity = useMemo(() => selectEntityById(entities, id), [entities, id]);

  if (isLoading) {
    return (
      <LexRouteGuard route="/lex/entities">
        <div dir={dir} lang={locale}>
          <PageLoader kpis={4} rows={5} />
        </div>
      </LexRouteGuard>
    );
  }

  if (!entity) {
    return (
      <LexRouteGuard route="/lex/entities">
        <div dir={dir} lang={locale} className="space-y-6">
          <BackLink label={labels.backToList} />
          <LexEmptyState icon={Building2} title={labels.notFoundTitle} description={labels.notFoundDescription} />
        </div>
      </LexRouteGuard>
    );
  }

  return (
    <LexRouteGuard route="/lex/entities">
      <div dir={dir} lang={locale} className="space-y-6 motion-safe:animate-fade-up">
        <BackLink label={labels.backToList} />
        <EntityDetailBody entity={entity} L={L} f={f} dir={dir} />
      </div>
    </LexRouteGuard>
  );
}

/* ------------------------------------------------------------------------- *
 * Detail body — rendered only once `entity` is resolved, so it can safely
 * derive the shared activity events and own the controlled tab state that both
 * the tabs and the right rail's "view all" affordances drive.
 * ------------------------------------------------------------------------- */

function EntityDetailBody({
  entity,
  L,
  f,
  dir,
}: {
  entity: EntityFootprint;
  L: EntityLabels;
  f: LexFormatter;
  dir: 'ltr' | 'rtl';
}) {
  const labels = L.detail;
  const [tab, setTab] = useState<DetailTab>('overview');
  const [casePosture, setCasePosture] = useState<EntityFootprint['cases'][number]['companyStatus'] | null>(null);
  const [activeContractsOnly, setActiveContractsOnly] = useState(false);

  const activity = useMemo(() => buildEntityActivityEvents(entity, labels), [entity, labels]);

  return (
    <>
      {/* #1 Hero band — org identity, derived posture chips, fact tiles, and the
          #2 nav/shareability toolbar in the actions slot. */}
      <EntityHeroBand
        entity={entity}
        f={f}
        actions={<EntityToolbarNav entityId={entity.id} entityName={entity.name} />}
      />

      {/* Headline KPI strip (preserved). */}
      <DetailKpis
        entity={entity}
        labels={labels}
        f={f}
        onSelect={(next) => {
          if (next === 'cases') setCasePosture(null);
          if (next === 'contracts') setActiveContractsOnly(false);
          setTab(next);
        }}
      />

      {/* #5 Two-column layout — tabbed sections left, persistent sticky rail
          right (visible across every tab). */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Tabs
            value={tab}
            onValueChange={(value) => {
              const next = value as DetailTab;
              if (next === 'cases') setCasePosture(null);
              if (next === 'contracts') setActiveContractsOnly(false);
              setTab(next);
            }}
            dir={dir}
          >
            <TabsList>
              <TabsTrigger value="overview">{labels.tabs.overview}</TabsTrigger>
              <TabsTrigger value="contracts">
                {labels.tabs.contracts} ({f.formatNumber(entity.contractCount)})
              </TabsTrigger>
              <TabsTrigger value="cases">
                {labels.tabs.cases} ({f.formatNumber(entity.caseCount)})
              </TabsTrigger>
              <TabsTrigger value="settlements">
                {labels.tabs.settlements} ({f.formatNumber(entity.settlementCount)})
              </TabsTrigger>
              <TabsTrigger value="activity">{labels.tabs.activity}</TabsTrigger>
            </TabsList>

            {/* Overview: posture split + exposure breakdown + counterparty insights */}
            <TabsContent value="overview" className="space-y-4">
              <PostureRow
                entity={entity}
                labels={labels}
                f={f}
                onSelectCases={(posture) => {
                  setCasePosture(posture);
                  setTab('cases');
                }}
                onSelectActiveContracts={() => {
                  setActiveContractsOnly(true);
                  setTab('contracts');
                }}
                onSelectSettlements={() => setTab('settlements')}
              />
              <SectionCard title={labels.sections.exposureBreakdown}>
                <ExposureBreakdown
                  entity={entity}
                  labels={labels}
                  f={f}
                  onSelectContracts={() => {
                    setActiveContractsOnly(false);
                    setTab('contracts');
                  }}
                  onSelectSettlements={() => setTab('settlements')}
                />
              </SectionCard>
              <CounterpartyInsightsPanel entity={entity} />
            </TabsContent>

            <TabsContent value="contracts">
              <SectionCard title={labels.sections.contracts}>
                <EntityRecordList
                  records={
                    activeContractsOnly
                      ? entity.contracts.filter((record) => isActiveEntityContractStatus(record.status))
                      : entity.contracts
                  }
                  labels={labels}
                  emptyLabel={labels.empty.contracts}
                />
              </SectionCard>
            </TabsContent>

            <TabsContent value="cases">
              <SectionCard title={labels.sections.cases}>
                <EntityRecordList
                  records={
                    casePosture ? entity.cases.filter((record) => record.companyStatus === casePosture) : entity.cases
                  }
                  labels={labels}
                  emptyLabel={labels.empty.cases}
                />
              </SectionCard>
            </TabsContent>

            <TabsContent value="settlements">
              <SectionCard title={labels.sections.settlements}>
                <EntityRecordList records={entity.settlements} labels={labels} emptyLabel={labels.empty.settlements} />
              </SectionCard>
            </TabsContent>

            <TabsContent value="activity">
              <SectionCard title={labels.sections.activity}>
                <LexActivityTimeline events={activity} emptyLabel={labels.empty.activity} dir={dir} />
              </SectionCard>
            </TabsContent>
          </Tabs>
        </div>

        {/* #5 Persistent right rail */}
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <EntityPeopleCard entity={entity} f={f} />
          <EntityRelatedCard entity={entity} f={f} onGoToTab={(next) => setTab(next)} />
          <EntityActivityMini events={activity} onViewAll={() => setTab('activity')} />
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * Back link
 * ------------------------------------------------------------------------- */

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/lex/entities"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
      {label}
    </Link>
  );
}

/* ------------------------------------------------------------------------- *
 * KPI strip (detail-scoped)
 * ------------------------------------------------------------------------- */

function DetailKpis({
  entity,
  labels,
  f,
  onSelect,
}: {
  entity: EntityFootprint;
  labels: EntityLabels['detail'];
  f: LexFormatter;
  onSelect: (tab: DetailTab) => void;
}) {
  const settlementShare = percent(entity.settlementValue, entity.totalExposure);
  const recoveryPct = Math.round(entity.recoveryRate * 100);
  const kpis: LexKpiItem[] = [
    {
      id: 'contract-value',
      label: labels.kpis.contractValue,
      value: f.formatCurrencyCompact(entity.contractValue, { currency: 'SAR' }),
      theme: 'primary',
      icon: FileText,
      description: labels.kpis.contractValue,
      detail: labels.kpis.contractValue,
      detailValue: f.formatCurrencyCompact(entity.totalExposure, {
        currency: 'SAR',
      }),
      onAction: () => onSelect('contracts'),
    },
    {
      id: 'settlement-exposure',
      label: labels.kpis.settlementExposure,
      value: f.formatCurrencyCompact(entity.settlementValue, {
        currency: 'SAR',
      }),
      theme: 'amber',
      icon: Banknote,
      description: labels.kpis.settlementExposure,
      progress: settlementShare,
      progressLabel: labels.kpis.settlementExposure,
      detail: labels.kpis.settlementExposure,
      detailValue: `${settlementShare}%`,
      onAction: () => onSelect('settlements'),
    },
    {
      id: 'settled-value',
      label: labels.kpis.settledValue,
      value: f.formatCurrencyCompact(entity.settledValue, { currency: 'SAR' }),
      theme: 'emerald',
      icon: Wallet,
      description: labels.kpis.settledValue,
      progress: recoveryPct,
      progressLabel: labels.kpis.settledValue,
      detail: labels.kpis.settlementExposure,
      detailValue: `${recoveryPct}%`,
      onAction: () => onSelect('settlements'),
    },
    {
      id: 'open-cases',
      label: labels.kpis.openCases,
      // Real count: `expand=parties` hydrates each case's parties on the list, so
      // the open-case rollup attributed to this counterparty is trustworthy.
      value: entity.openCaseCount,
      theme: 'orange',
      icon: Gavel,
      description: labels.kpis.openCases,
      detail: labels.kpis.openCases,
      detailValue: entity.openCaseCount,
      onAction: () => onSelect('cases'),
    },
  ];
  return <LexKpiStrip items={kpis} columns={4} />;
}

/* ------------------------------------------------------------------------- *
 * Posture row — plaintiff/defendant split, active contracts, recovery progress
 * ------------------------------------------------------------------------- */

function PostureRow({
  entity,
  labels,
  f,
  onSelectCases,
  onSelectActiveContracts,
  onSelectSettlements,
}: {
  entity: EntityFootprint;
  labels: EntityLabels['detail'];
  f: LexFormatter;
  onSelectCases: (posture: EntityFootprint['cases'][number]['companyStatus']) => void;
  onSelectActiveContracts: () => void;
  onSelectSettlements: () => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Plaintiff/defendant posture is derived from the case parties hydrated
          via `expand=parties`, so these are real attributed counts. */}
      <PostureTile
        label={labels.posture.plaintiff}
        value={f.formatNumber(entity.asPlaintiffCount)}
        accent="info"
        icon={Gavel}
        onClick={() => onSelectCases('plaintiff')}
      />
      <PostureTile
        label={labels.posture.defendant}
        value={f.formatNumber(entity.asDefendantCount)}
        accent="warning"
        icon={Gavel}
        onClick={() => onSelectCases('defendant')}
      />
      <PostureTile
        label={labels.posture.activeContracts}
        value={f.formatNumber(entity.activeContractCount)}
        accent="primary"
        icon={FileText}
        onClick={onSelectActiveContracts}
      />
      <Button
        type="button"
        variant="ghost"
        onClick={onSelectSettlements}
        className="card h-auto flex-col items-stretch justify-between gap-2 p-4 text-start font-normal hover:border-primary/30 hover:bg-card"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {labels.posture.recoveryProgress}
          </span>
          <Handshake className="h-4 w-4 text-muted-foreground/70" aria-hidden />
        </div>
        {entity.settlementValue > 0 ? (
          <RecoveryMeter pct={Math.round(entity.recoveryRate * 100)} label={f.formatPercent(entity.recoveryRate)} />
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </Button>
    </div>
  );
}

const POSTURE_ACCENT: Record<'info' | 'warning' | 'primary', string> = {
  info: 'border-s-4 border-s-info-500',
  warning: 'border-s-4 border-s-warning-500',
  primary: 'border-s-4 border-s-[hsl(var(--ds-brand-primary))]',
};

function PostureTile({
  label,
  value,
  accent,
  icon: Icon,
  onClick,
  muted = false,
}: {
  label: string;
  value: string;
  accent: 'info' | 'warning' | 'primary';
  icon: typeof Gavel;
  onClick: () => void;
  /** When true, `value` is a non-numeric placeholder (e.g. "in case detail"). */
  muted?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      title={statisticHint(label)}
      className={cn(
        'card h-auto flex-col items-stretch p-4 text-start font-normal hover:border-primary/30 hover:bg-card',
        POSTURE_ACCENT[accent],
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground/70" aria-hidden />
      </div>
      {muted ? (
        <p className="mt-2 text-sm font-medium text-muted-foreground" dir="auto">
          {value}
        </p>
      ) : (
        <p className="mt-2 text-2xl font-bold tabular-nums text-foreground" dir="ltr">
          {value}
        </p>
      )}
    </Button>
  );
}

/* ------------------------------------------------------------------------- *
 * Exposure breakdown — contract vs settlement share of the SAR footprint.
 * ------------------------------------------------------------------------- */

function ExposureBreakdown({
  entity,
  labels,
  f,
  onSelectContracts,
  onSelectSettlements,
}: {
  entity: EntityFootprint;
  labels: EntityLabels['detail'];
  f: LexFormatter;
  onSelectContracts: () => void;
  onSelectSettlements: () => void;
}) {
  const total = entity.totalExposure;
  const contractPct = total > 0 ? (entity.contractValue / total) * 100 : 0;
  const settlementPct = total > 0 ? (entity.settlementValue / total) * 100 : 0;

  if (total <= 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{labels.record.noValue}</p>;
  }

  return (
    <div className="space-y-4">
      {/* Stacked exposure bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="presentation" dir="ltr">
        <span className="h-full bg-[hsl(var(--ds-info-500))]" style={{ width: `${contractPct}%` }} aria-hidden />
        <span className="h-full bg-[hsl(var(--ds-warning-500))]" style={{ width: `${settlementPct}%` }} aria-hidden />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <EntityExposureMetric
          swatch="bg-[hsl(var(--ds-info-500))]"
          label={labels.hero.facts.contracts}
          value={f.formatCurrency(entity.contractValue, { currency: 'SAR' })}
          pct={f.formatPercent(contractPct, { fromPercent: true })}
          onAction={onSelectContracts}
        />
        <EntityExposureMetric
          swatch="bg-[hsl(var(--ds-warning-500))]"
          label={labels.hero.facts.settlements}
          value={f.formatCurrency(entity.settlementValue, { currency: 'SAR' })}
          pct={f.formatPercent(settlementPct, { fromPercent: true })}
          onAction={onSelectSettlements}
        />
      </div>

      <div className="flex items-center justify-between border-t border-border/60 pt-3">
        <span className="text-sm font-medium text-muted-foreground">{labels.hero.facts.exposure}</span>
        <span className="text-base font-bold tabular-nums text-foreground" dir="ltr">
          {f.formatCurrency(total, { currency: 'SAR' })}
        </span>
      </div>
    </div>
  );
}

function EntityExposureMetric({
  swatch,
  label,
  value,
  pct,
  onAction,
}: {
  swatch: string;
  label: string;
  value: string;
  pct: string;
  onAction: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAction}
      className="rounded-xl border border-border/60 bg-card/40 p-3 text-start transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2">
        <span className={cn('h-2.5 w-2.5 rounded-full', swatch)} aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="ms-auto text-xs tabular-nums text-muted-foreground" dir="ltr">
          {pct}
        </span>
      </div>
      <p className="mt-1.5 text-sm font-semibold tabular-nums text-foreground" dir="ltr">
        {value}
      </p>
    </button>
  );
}

/* ------------------------------------------------------------------------- *
 * Counterparty insights reuse — when this org has a settlement, mount the
 * existing conflict-check + cross-settlement panel seeded from its most recent
 * settlement (the panel is already counterparty-scoped). We fetch the full
 * Settlement aggregate the panel needs by id.
 * ------------------------------------------------------------------------- */

function CounterpartyInsightsPanel({ entity }: { entity: EntityFootprint }) {
  const { hasPermission } = useAuth();
  // §9/§18.4 — counterparty-insight edits operate on a settlement record.
  const canWrite = hasPermission('lex:settlement:edit');
  const latestSettlementId = entity.settlements[0]?.id;

  const settlementQuery = useQuery({
    queryKey: ['lex-entity-settlement', latestSettlementId],
    queryFn: () => settlementsApi.get(latestSettlementId as string),
    enabled: Boolean(latestSettlementId),
  });

  if (!latestSettlementId || !settlementQuery.data) {
    return null;
  }

  return (
    <div className="card p-5">
      <CounterpartyInsights settlement={settlementQuery.data} canWrite={canWrite} />
    </div>
  );
}
