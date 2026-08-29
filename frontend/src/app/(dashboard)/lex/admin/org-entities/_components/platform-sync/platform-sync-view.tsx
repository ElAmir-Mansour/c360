'use client';

/**
 * Platform Org-Unit Sync & Drift Detection.
 *
 * A reconcile surface between Lex legal entities and the platform_core
 * organisation directory:
 *   - fetches legal entities (lexAdminApi.listOrgEntities) + platform units
 *     (fetchPlatformOrgUnitsResult — returns linked refs plus a degraded flag);
 *   - classifies each entity as Linked / Unlinked / Orphaned;
 *   - for Linked entities, computes DRIFT (name_en / name_ar / active mismatch)
 *     and renders a side-by-side diff with a "Fix drift" action;
 *   - for Unlinked entities, offers a "Link to platform unit" picker;
 *   - lists platform units not yet linked to any legal entity.
 *
 * Self-contained: owns its own loading / empty / error states and keeps working
 * when platform-unit references are temporarily unavailable.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, Link2Off, Network, RefreshCw, ServerOff, Unlink } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SectionCard } from '@/components/suites/section-card';
import { StatTile } from '@/components/shared/stat-tile';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexAdminApi, type OrgEntity } from '@/lib/lex/admin';
import { fetchPlatformOrgUnitsResult, platformUnitName, type PlatformOrgUnit } from '../../_lib/platform-sync-api';
import { labels } from '../../_lib/platform-sync-i18n';
import { PlatformUnitDiffRow, type DriftField } from './platform-unit-diff-row';

const ORG_QUERY_KEY = ['lex-admin-org-entities'] as const;
const PLATFORM_QUERY_KEY = ['lex-admin-platform-units'] as const;

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

type LinkStatus = 'linked' | 'unlinked' | 'orphaned';

interface ReconcileRow {
  entity: OrgEntity;
  status: LinkStatus;
  unit?: PlatformOrgUnit;
  drift: DriftField[];
}

export interface PlatformSyncViewProps {
  canWrite?: boolean;
}

/** Compute the differing fields between a linked entity and its platform unit. */
function computeDrift(entity: OrgEntity, unit: PlatformOrgUnit, t: (typeof labels)['en']): DriftField[] {
  const unitName =
    typeof unit.name === 'string'
      ? { en: unit.name, ar: unit.name }
      : { en: unit.name.en ?? '', ar: unit.name.ar ?? '' };
  const entityName = { en: entity.name?.en ?? '', ar: entity.name?.ar ?? '' };
  const out: DriftField[] = [];

  if (entityName.en !== unitName.en) {
    out.push({ key: 'name_en', label: t.fieldNameEn, legal: entityName.en, platform: unitName.en });
  }
  if (entityName.ar !== unitName.ar) {
    out.push({ key: 'name_ar', label: t.fieldNameAr, legal: entityName.ar, platform: unitName.ar });
  }
  if (entity.active !== unit.active) {
    out.push({
      key: 'active',
      label: t.fieldActive,
      legal: entity.active ? t.activeYes : t.activeNo,
      platform: unit.active ? t.activeYes : t.activeNo,
    });
  }
  return out;
}

export function PlatformSyncView({ canWrite = false }: PlatformSyncViewProps) {
  const { locale, direction } = useLocaleOrDefault();
  const t = locale === 'ar' ? labels.ar : labels.en;
  const qc = useQueryClient();

  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [pendingUnitId, setPendingUnitId] = useState<string>('');

  const entitiesQuery = useQuery({
    queryKey: [...ORG_QUERY_KEY, 'platform-sync'],
    queryFn: () => lexAdminApi.listOrgEntities({ page: 1, per_page: 200 }),
  });

  const platformQuery = useQuery({
    queryKey: PLATFORM_QUERY_KEY,
    // Never throws; degraded=true means the references could not be read.
    queryFn: fetchPlatformOrgUnitsResult,
  });

  const entities = useMemo(() => entitiesQuery.data?.data ?? [], [entitiesQuery.data]);
  const units = useMemo(() => platformQuery.data?.units ?? [], [platformQuery.data]);
  const directoryDegraded = platformQuery.data?.degraded ?? false;
  const directoryReady = Boolean(platformQuery.data) && !directoryDegraded;

  const unitsById = useMemo(() => {
    const m = new Map<string, PlatformOrgUnit>();
    for (const u of units) m.set(u.id, u);
    return m;
  }, [units]);

  /** Per-entity reconcile classification + drift. */
  const rows = useMemo<ReconcileRow[]>(() => {
    return entities.map((entity) => {
      const mappedId = entity.platform_org_unit_id;
      if (!mappedId) {
        return { entity, status: 'unlinked', drift: [] };
      }
      const unit = unitsById.get(mappedId);
      // Without platform refs we can confirm a mapping exists but not whether
      // the target still resolves — treat as linked (no drift) until refs load.
      if (!directoryReady) {
        return { entity, status: 'linked', drift: [] };
      }
      if (!unit) {
        return { entity, status: 'orphaned', drift: [] };
      }
      return { entity, status: 'linked', unit, drift: computeDrift(entity, unit, t) };
    });
  }, [entities, unitsById, directoryReady, t]);

  const kpis = useMemo(() => {
    let linked = 0;
    let unlinked = 0;
    let orphaned = 0;
    let drift = 0;
    for (const r of rows) {
      if (r.status === 'linked') linked += 1;
      else if (r.status === 'unlinked') unlinked += 1;
      else orphaned += 1;
      if (r.drift.length > 0) drift += 1;
    }
    return { linked, unlinked, orphaned, drift };
  }, [rows]);
  const syncTotal = rows.length;
  const linkedShare = percent(kpis.linked, syncTotal);
  const unlinkedShare = percent(kpis.unlinked, syncTotal);
  const orphanedShare = percent(kpis.orphaned, syncTotal);
  const driftShare = percent(kpis.drift, syncTotal);
  const kpiCopy =
    locale === 'ar'
      ? {
          registryShare: 'النسبة من السجل',
          syncScope: 'نطاق المزامنة',
        }
      : {
          registryShare: 'Share of registry',
          syncScope: 'Sync scope',
        };

  /** Platform units not referenced by any legal entity (available to import/link). */
  const availableUnits = useMemo(() => {
    const linkedUnitIds = new Set(
      entities.map((e) => e.platform_org_unit_id).filter((id): id is string => Boolean(id)),
    );
    return units.filter((u) => !linkedUnitIds.has(u.id));
  }, [entities, units]);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ORG_QUERY_KEY });
    await qc.invalidateQueries({ queryKey: PLATFORM_QUERY_KEY });
  };

  const fixDrift = useMutation({
    mutationFn: ({ entity, unit }: { entity: OrgEntity; unit: PlatformOrgUnit }) => {
      const name =
        typeof unit.name === 'string'
          ? { en: unit.name, ar: unit.name }
          : { en: unit.name.en ?? '', ar: unit.name.ar ?? '' };
      return lexAdminApi.updateOrgEntity(entity.id, { name, active: unit.active });
    },
    onSuccess: async () => {
      showSuccess(t.toastFixed);
      await invalidate();
    },
    onError: showApiError,
  });

  const linkUnit = useMutation({
    mutationFn: ({ entity, unitId }: { entity: OrgEntity; unitId: string }) =>
      lexAdminApi.updateOrgEntity(entity.id, { platform_org_unit_id: unitId }),
    onSuccess: async () => {
      showSuccess(t.toastLinked);
      setLinkingId(null);
      setPendingUnitId('');
      await invalidate();
    },
    onError: showApiError,
  });

  /* --- Loading -------------------------------------------------------------- */
  if (entitiesQuery.isLoading) {
    return (
      <div dir={direction} lang={locale} className="space-y-4">
        <LoadingSkeleton variant="kpi" count={4} />
        <LoadingSkeleton variant="table" count={6} />
      </div>
    );
  }

  /* --- Hard error loading entities ----------------------------------------- */
  if (entitiesQuery.isError) {
    return (
      <div dir={direction} lang={locale}>
        <SectionCard title={t.title} description={t.subtitle}>
          <EmptyState
            icon={AlertTriangle}
            title={t.loadErrorTitle}
            description={t.loadErrorBody}
            action={{ label: t.refresh, onClick: () => entitiesQuery.refetch() }}
          />
        </SectionCard>
      </div>
    );
  }

  /* --- No legal entities at all -------------------------------------------- */
  if (entities.length === 0) {
    return (
      <div dir={direction} lang={locale}>
        <SectionCard title={t.title} description={t.subtitle}>
          <EmptyState icon={Network} title={t.noEntitiesTitle} description={t.noEntitiesBody} />
        </SectionCard>
      </div>
    );
  }

  const statusBadge = (status: LinkStatus, hasDrift: boolean) => {
    if (status === 'unlinked') return <Badge variant="outline">{t.statusUnlinked}</Badge>;
    if (status === 'orphaned') return <Badge variant="destructive">{t.statusOrphaned}</Badge>;
    return hasDrift ? (
      <Badge variant="warning">{t.statusDrift}</Badge>
    ) : (
      <Badge variant="success">{t.statusInSync}</Badge>
    );
  };

  return (
    <div dir={direction} lang={locale} className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-h4 font-semibold">{t.title}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            entitiesQuery.refetch();
            platformQuery.refetch();
          }}
          disabled={entitiesQuery.isFetching || platformQuery.isFetching}
        >
          <RefreshCw
            className={`me-1.5 h-4 w-4 ${entitiesQuery.isFetching || platformQuery.isFetching ? 'animate-spin' : ''}`}
            aria-hidden
          />
          {t.refresh}
        </Button>
      </div>

      {!canWrite ? <p className="text-xs text-muted-foreground">{t.readOnlyNote}</p> : null}

      {/* KPI strip */}
      <div className="platform-sync-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t.kpiLinked}
          value={kpis.linked}
          themeClass="kpi-theme-emerald"
          icon={Link2}
          progress={linkedShare}
          progressLabel={kpiCopy.registryShare}
          detail={kpiCopy.syncScope}
          detailValue={`${linkedShare}%`}
          size="md"
          appearance="operational"
          className="platform-sync-kpi-card"
          href="#platform-sync-records"
        />
        <StatTile
          label={t.kpiUnlinked}
          value={kpis.unlinked}
          themeClass="kpi-theme-primary"
          icon={Link2Off}
          progress={unlinkedShare}
          progressLabel={kpiCopy.registryShare}
          detail={kpiCopy.syncScope}
          detailValue={`${unlinkedShare}%`}
          size="md"
          appearance="operational"
          className="platform-sync-kpi-card"
          href="#platform-sync-records"
        />
        <StatTile
          label={t.kpiOrphaned}
          value={kpis.orphaned}
          themeClass="kpi-theme-red"
          icon={Unlink}
          progress={orphanedShare}
          progressLabel={kpiCopy.registryShare}
          detail={kpiCopy.syncScope}
          detailValue={`${orphanedShare}%`}
          size="md"
          appearance="operational"
          className="platform-sync-kpi-card"
          href="#platform-sync-records"
        />
        <StatTile
          label={t.kpiDrift}
          value={kpis.drift}
          themeClass="kpi-theme-amber"
          icon={AlertTriangle}
          progress={driftShare}
          progressLabel={kpiCopy.registryShare}
          detail={kpiCopy.syncScope}
          detailValue={`${driftShare}%`}
          size="md"
          appearance="operational"
          className="platform-sync-kpi-card"
          href="#platform-sync-records"
        />
      </div>

      {/* Platform-ref warning — still show link-status KPIs above so the view is useful. */}
      {directoryDegraded ? (
        <Alert variant="warning">
          <ServerOff className="h-4 w-4" />
          <AlertTitle>{t.endpointMissingTitle}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{t.endpointMissingBody}</p>
            <code className="block w-fit rounded bg-muted px-2 py-1 font-mono text-xs">{t.endpointMissingPath}</code>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Reconcile table */}
      <div id="platform-sync-records" className="scroll-mt-24">
        <SectionCard title={t.reconcileTitle} description={t.reconcileSubtitle}>
          {kpis.unlinked === 0 && kpis.orphaned === 0 && kpis.drift === 0 ? (
            <EmptyState icon={CheckCircle2} size="compact" title={t.allLinkedTitle} description={t.allLinkedBody} />
          ) : (
            <div className="space-y-2">
              {/* Header */}
              <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_minmax(0,1.5fr)] gap-3 px-3 pb-1 text-overline uppercase text-muted-foreground sm:grid">
                <span>{t.colEntity}</span>
                <span>{t.colCode}</span>
                <span>{t.colStatus}</span>
                <span>{t.colPlatformUnit}</span>
              </div>

              {rows.map((row) => {
                const entityLabel = resolveLocalized(row.entity.name, locale) || row.entity.code;
                const isLinking = linkingId === row.entity.id;
                return (
                  <div key={row.entity.id} className="rounded-lg border px-3 py-2.5" data-testid="reconcile-row">
                    <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_minmax(0,1.5fr)]">
                      <span className="truncate font-medium">{entityLabel}</span>
                      <span className="font-mono text-xs text-muted-foreground">{row.entity.code}</span>
                      <span>{statusBadge(row.status, row.drift.length > 0)}</span>
                      <span className="truncate text-sm text-muted-foreground">
                        {row.unit
                          ? platformUnitName(row.unit, locale) || row.unit.code || row.unit.id
                          : (row.entity.platform_org_unit_id ?? t.noUnitName)}
                      </span>
                    </div>

                    {/* Drift detail for linked + drifting entities */}
                    {row.status === 'linked' && row.unit && row.drift.length > 0 ? (
                      <div className="mt-2.5">
                        <PlatformUnitDiffRow
                          entity={row.entity}
                          unit={row.unit}
                          fields={row.drift}
                          canWrite={canWrite}
                          fixing={fixDrift.isPending && fixDrift.variables?.entity.id === row.entity.id}
                          onFix={() => row.unit && fixDrift.mutate({ entity: row.entity, unit: row.unit })}
                        />
                      </div>
                    ) : null}

                    {/* Link affordance for unlinked entities */}
                    {row.status === 'unlinked' && canWrite ? (
                      <div className="mt-2.5">
                        {isLinking ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Select value={pendingUnitId} onValueChange={setPendingUnitId} dir={direction}>
                              <SelectTrigger className="h-9 w-full sm:w-72">
                                <SelectValue placeholder={t.linkPlaceholder} />
                              </SelectTrigger>
                              <SelectContent>
                                {availableUnits.length === 0 ? (
                                  <div className="px-2 py-1.5 text-xs text-muted-foreground">{t.noAvailableUnits}</div>
                                ) : (
                                  availableUnits.map((u) => (
                                    <SelectItem key={u.id} value={u.id}>
                                      {platformUnitName(u, locale) || u.code || u.id}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              disabled={!pendingUnitId || linkUnit.isPending}
                              onClick={() => linkUnit.mutate({ entity: row.entity, unitId: pendingUnitId })}
                            >
                              {linkUnit.isPending ? t.linking : t.linkAction}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setLinkingId(null);
                                setPendingUnitId('');
                              }}
                            >
                              {t.cancel}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!directoryReady}
                            onClick={() => {
                              setLinkingId(row.entity.id);
                              setPendingUnitId('');
                            }}
                          >
                            <Link2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
                            {t.linkAction}
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Available platform units (only meaningful once platform refs load) */}
      {directoryReady ? (
        <SectionCard title={t.availableTitle} description={t.availableSubtitle}>
          {availableUnits.length === 0 ? (
            <EmptyState icon={CheckCircle2} size="compact" title={t.availableEmpty} description="" />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {availableUnits.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{platformUnitName(u, locale) || u.code || u.id}</p>
                    {u.code ? <p className="font-mono text-caption text-muted-foreground">{u.code}</p> : null}
                  </div>
                  <Badge variant={u.active ? 'secondary' : 'outline'}>{u.active ? t.activeYes : t.activeNo}</Badge>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      ) : null}
    </div>
  );
}

export default PlatformSyncView;
