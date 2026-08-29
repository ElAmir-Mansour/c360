'use client';

import { CheckCircle2, Target, XCircle } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusChip } from '@/components/shared/status-chip';
import { EmptyState } from '@/components/common/empty-state';
import { statusToTone } from '@/components/product';
import type { DRTopologyFailoverSelection } from '@/types/clario-dr';
import { useTopologyLabels } from '../../_components/topology/topology-labels';
import { useTopologyPageLabels } from './topology-page-labels';

/**
 * Failover-target ranking panel: shows the server-computed selected failover
 * target (if any) and the full ranked candidate list for the group's topology
 * (`DRTopologyFailoverSelection`). Each candidate surfaces its role, mode,
 * priority, health (real backend health token → localized label), apply lag, and
 * the eligibility reason. Selecting/eligibility is read-only — authoring edges
 * (which changes the ranking) is the write path. Token-driven, AA, RTL-safe.
 */
export function FailoverTargetPanel({
  selection,
}: {
  selection: DRTopologyFailoverSelection | null;
}) {
  const labels = useTopologyLabels();
  const pageLabels = useTopologyPageLabels();

  const ranking = selection?.ranking ?? [];
  const selected = selection?.selected ?? null;

  const healthLabel = (token: string) =>
    pageLabels.healthOptions[token.toLowerCase()] ?? token;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.failoverTargetHeading}</CardTitle>
        <CardDescription>{labels.rankingHeading}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {selected ? (
          <div className="rounded-card border border-outline-subtle bg-bg-subtle p-3">
            <p className="text-caption font-semibold uppercase tracking-wide text-content-muted">
              {labels.selectedTargetLabel}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-medium text-content-primary">{selected.site_name}</span>
              <StatusChip
                tone={statusToTone(selected.health)}
                size="sm"
                label={healthLabel(selected.health)}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-content-secondary">
            <XCircle className="h-4 w-4 text-state-warning" aria-hidden />
            {labels.noFailoverTarget}
          </div>
        )}

        {ranking.length === 0 ? (
          <EmptyState
            icon={Target}
            title={labels.noFailoverTarget}
            description={labels.emptyDescription}
            size="compact"
          />
        ) : (
          <ol className="space-y-2" aria-label={labels.rankingHeading}>
            {ranking.map((candidate) => (
              <li
                key={candidate.node_id}
                className="rounded-card border border-outline-subtle p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-medium text-content-primary">
                    {candidate.eligible ? (
                      <CheckCircle2 className="h-4 w-4 text-state-success" aria-hidden />
                    ) : (
                      <XCircle className="h-4 w-4 text-content-muted" aria-hidden />
                    )}
                    {candidate.site_name}
                  </span>
                  <StatusChip
                    tone={candidate.eligible ? 'success' : 'neutral'}
                    size="sm"
                    label={candidate.eligible ? labels.candidateEligible : labels.candidateIneligible}
                  />
                </div>

                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-caption sm:grid-cols-4">
                  <div>
                    <dt className="font-semibold uppercase text-content-muted">
                      {labels.roles[candidate.role] ?? pageLabels.roleOptions[candidate.role] ?? candidate.role}
                    </dt>
                    <dd className="text-content-secondary">
                      {labels.modes[candidate.mode] ?? pageLabels.modeOptions[candidate.mode] ?? candidate.mode}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase text-content-muted">
                      {labels.priorityColumn}
                    </dt>
                    <dd className="tabular-nums text-content-secondary" dir="ltr">
                      {candidate.priority}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase text-content-muted">
                      {labels.health[candidate.health] ?? healthLabel(candidate.health)}
                    </dt>
                    <dd className="text-content-secondary">{healthLabel(candidate.health)}</dd>
                  </div>
                  {candidate.lag_seconds != null ? (
                    <div>
                      <dt className="font-semibold uppercase text-content-muted">
                        {labels.lagLabel}
                      </dt>
                      <dd className="tabular-nums text-content-secondary" dir="ltr">
                        {candidate.lag_seconds}s
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {candidate.reason ? (
                  <p className="mt-2 text-caption text-content-secondary">
                    <span className="font-semibold text-content-muted">
                      {labels.candidateReasonLabel}:{' '}
                    </span>
                    {candidate.reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
