'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Layers,
  MapPin,
  Network,
  PlayCircle,
  Server,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useCloudDRRegionBootPlan } from '@/lib/recover/use-cloud-dr-overview';
import { useRecoverT } from '../../_lib/recover-i18n';
import type { RegionBootStatus } from '@/types/recover-cloud-dr';

/**
 * Region / AZ failover view.
 *
 * Lists the tenant's recovery scopes (consistency groups — the region/AZ targets
 * a failover boots), and on selecting one, fetches and visualises the REAL
 * dependency-ordered boot sequence from the bootgraph engine BEFORE execution.
 * The actual failover EXECUTION is the existing dr:failover-gated boot-run /
 * failover FSM under /api/v1/dr — this view is the pre-flight visualization and
 * the "rehearse failover" entry into the shared rehearsal flow.
 */
export function RegionFailoverView({ regions }: { regions: RegionBootStatus[] }) {
  const t = useRecoverT();
  const [selected, setSelected] = useState<string | null>(
    regions.find((r) => r.has_plan)?.group_id ?? regions[0]?.group_id ?? null,
  );

  if (regions.length === 0) {
    return (
      <section className="card p-6">
        <h2 className="mb-1 text-base font-semibold text-foreground">{t('region.heading')}</h2>
        <p className="text-sm text-muted-foreground">{t('region.noScopes')}</p>
      </section>
    );
  }

  return (
    <section className="card p-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('region.heading')}</h2>
          <p className="text-sm text-muted-foreground">{t('region.selectHint')}</p>
        </div>
        <Network className="h-5 w-5 text-primary" aria-hidden />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        {/* Scope selector. */}
        <ul className="space-y-2" role="listbox" aria-label={t('region.scopesAria')}>
          {regions.map((r) => {
            const isSel = r.group_id === selected;
            return (
              <li key={r.group_id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => setSelected(r.group_id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg border p-3 text-start transition-colors',
                    isSel
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border/60 hover:border-primary/40',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{r.group_name}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {r.site_names && r.site_names.length > 0 ? r.site_names.join(', ') : t('region.noSitesBound')}
                    </span>
                  </span>
                  <span className="ms-2 flex shrink-0 items-center gap-2">
                    {r.has_plan ? (
                      <span className="badge-info text-xs">{t('region.tiersBadge', { count: r.tier_count })}</span>
                    ) : (
                      <span className="badge-neutral text-xs">{t('region.noPlan')}</span>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Boot sequence for the selected scope. */}
        <div>{selected ? <BootSequence groupID={selected} /> : null}</div>
      </div>
    </section>
  );
}

/**
 * Visualises the real bootgraph plan for one scope: tier-by-tier, each tier a
 * health-gated barrier, services within a tier booting in parallel. The ordering
 * is the bootgraph engine's verbatim — it is not recomputed here.
 */
function BootSequence({ groupID }: { groupID: string }) {
  const t = useRecoverT();
  const { data, isLoading, isError, error, refetch } = useCloudDRRegionBootPlan(groupID);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <Skeleton className="h-6 w-48 rounded" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="card flex flex-col items-start gap-3 border-destructive/40 p-5">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-semibold">{t('region.bootPlanErrorTitle')}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {error?.message ?? t('region.bootPlanErrorFallback')}
        </p>
        <button type="button" onClick={() => void refetch()} className="btn-secondary text-sm">
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (!data.tiers || data.tiers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
        <Layers className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t('region.noBootServicesPre')} <span className="font-medium">{data.group_name}</span>
          {t('region.noBootServicesPost')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t('region.bootSequence', { group: data.group_name })}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('region.bootSummary', { tiers: data.tier_count, services: data.service_count })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/recover/cloud-dr/rehearse?group=${encodeURIComponent(data.group_id)}`}
            className="btn-secondary inline-flex items-center gap-1 text-sm"
          >
            <PlayCircle className="h-4 w-4" /> {t('region.rehearseFailover')}
          </Link>
        </div>
      </div>

      {/* Tier ladder: tiers are strictly ordered (gate between each); services in
          a tier boot in parallel. */}
      <ol className="space-y-3">
        {data.tiers.map((tier, idx) => (
          <li key={idx} className="relative">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {idx + 1}
              </span>
              <div className="flex-1 rounded-lg border border-border/60 bg-card/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('region.tierLabel', { n: idx + 1 })}
                    {idx === 0 ? t('region.tierBootsFirst') : t('region.tierAfterGate')}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('region.tierServiceCount', { count: tier.length })}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tier.map((svc) => (
                    <span
                      key={svc.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1 text-sm"
                      title={svc.kind ? `${svc.name} (${svc.kind})` : svc.name}
                    >
                      <Server className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium text-foreground">{svc.name}</span>
                      {svc.kind ? (
                        <span className="text-xs text-muted-foreground">· {svc.kind}</span>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {idx < data.tiers.length - 1 ? (
              <div className="ms-3 flex h-3 items-center" aria-hidden>
                <ArrowRight className="h-3.5 w-3.5 rotate-90 text-border" />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
