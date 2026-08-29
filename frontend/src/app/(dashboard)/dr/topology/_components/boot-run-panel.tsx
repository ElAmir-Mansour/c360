'use client';

import { Rocket } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusChip } from '@/components/shared/status-chip';
import { EmptyState } from '@/components/common/empty-state';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { statusToTone } from '@/components/product';
import type { DRBootRunDetail } from '@/types/clario-dr';
import { useTopologyPageLabels } from './topology-page-labels';

/**
 * Live isolated-boot run panel: renders the run rollup (status, policy, tiers
 * booted, start time) and the per-service boot/health status rows for the active
 * boot run (`DRBootRunDetail`). Status tokens are the real backend boot
 * run-status / service-status tokens, mapped to localized labels and a
 * never-colour-only `StatusChip`. Read-only (the boot run advances server-side;
 * the parent polls via `useDRBootRun`). Token-driven, AA, RTL-safe.
 */
export function BootRunPanel({
  bootRun,
}: {
  bootRun: DRBootRunDetail | null;
}) {
  const labels = useTopologyPageLabels();

  if (!bootRun) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{labels.bootRunTitle}</CardTitle>
          <CardDescription>{labels.bootRunDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Rocket}
            title={labels.bootRunEmptyTitle}
            description={labels.bootRunEmptyDescription}
            size="compact"
          />
        </CardContent>
      </Card>
    );
  }

  const { run, services } = bootRun;
  const runStatusLabel = labels.bootRunStatusOptions[run.status] ?? run.status;
  const policyLabel = labels.bootPolicyOptions[run.policy] ?? run.policy;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.bootRunTitle}</CardTitle>
        <CardDescription>{labels.bootRunDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Boot-run rollup. Tones are strictly semantic: tiers-booted is a count
            (`sky`), the start time is a deadline/time metric (`gold`), and the
            failure policy is a type/category (`slate`). The run status keeps its
            RAG `StatusChip` (mapped via `statusToTone`) as the tile badge so the
            colour stays on the chip, not the value text. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <DetailStatCard
            label={labels.bootRunStatusLabel}
            value={<StatusChip tone={statusToTone(run.status)} size="sm" label={runStatusLabel} />}
          />
          <DetailStatCard label={labels.bootRunPolicyLabel} value={policyLabel} tone="slate" />
          <DetailStatCard
            label={labels.bootRunTiersLabel}
            value={<span dir="ltr">{labels.bootRunTiersValue(run.tiers_booted, run.total_tiers)}</span>}
            tone="sky"
          />
          <DetailStatCard
            label={labels.bootRunStartedLabel}
            value={<span dir="ltr">{run.started_at}</span>}
            tone="gold"
          />
        </div>

        {services.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title={labels.bootRunEmptyTitle}
            description={labels.bootRunEmptyDescription}
            size="compact"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-start text-body-sm">
              <thead>
                <tr className="border-b border-outline-subtle text-content-muted">
                  <th scope="col" className="px-2 py-1.5 text-start font-semibold">
                    {labels.bootRunColumnService}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start font-semibold">
                    {labels.bootRunColumnTier}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start font-semibold">
                    {labels.bootRunColumnStatus}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start font-semibold">
                    {labels.bootRunColumnAttempts}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start font-semibold">
                    {labels.bootRunColumnError}
                  </th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id} className="border-b border-outline-subtle/60">
                    <th scope="row" className="px-2 py-1.5 text-start font-medium text-content-primary">
                      {service.service_name}
                    </th>
                    <td className="px-2 py-1.5 tabular-nums text-content-secondary" dir="ltr">
                      {service.tier + 1}
                    </td>
                    <td className="px-2 py-1.5">
                      <StatusChip
                        tone={statusToTone(service.status)}
                        size="sm"
                        label={labels.bootServiceStatusOptions[service.status] ?? service.status}
                      />
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-content-secondary" dir="ltr">
                      {service.attempts}
                    </td>
                    <td className="px-2 py-1.5 text-content-secondary">
                      {service.last_error ? service.last_error : labels.bootRunNoError}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
