'use client';

import { useState } from 'react';
import { Layers, Play, Plus } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { StatusChip } from '@/components/shared/status-chip';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DRBootPlan, DRCreateBootServicesRequest } from '@/types/clario-dr';
import { DRWriteGate } from '../../_components/console/dr-write-gate';
import { useTopologyPageLabels } from './topology-page-labels';
import { DefineBootServicesDialog } from './define-boot-services-dialog';

/** Real backend boot failure policies (`internal/dr/bootgraph`). */
const BOOT_POLICIES = ['halt', 'rollback'] as const;

/**
 * Isolated-boot plan panel: renders the group's tiered boot plan (`DRBootPlan` —
 * `tiers` of `DRBootService`) and lets a `dr:write` operator (re)define the boot
 * services and start an isolated boot run with a chosen failure policy.
 *
 * Each tier is a labelled group of services with their real probe + boot-timeout
 * detail; an empty plan shows the onboarding empty state. Both write controls are
 * wrapped in the shared `DRWriteGate`. Token-driven, AA, RTL-safe.
 */
export function BootPlanPanel({
  bootPlan,
  loading,
  error,
  canWrite,
  onDefineServices,
  defineServicesPending,
  onStartBootRun,
  startBootRunPending,
  onRetry,
}: {
  bootPlan: DRBootPlan | null;
  loading: boolean;
  error: unknown;
  canWrite: boolean;
  onDefineServices: (payload: DRCreateBootServicesRequest) => void;
  defineServicesPending: boolean;
  onStartBootRun: (policy: string) => void;
  startBootRunPending: boolean;
  onRetry: () => void;
}) {
  const labels = useTopologyPageLabels();
  const [defineOpen, setDefineOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [policy, setPolicy] = useState<string>('halt');

  const tiers = bootPlan?.tiers ?? [];
  const hasPlan = tiers.some((tier) => tier.length > 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{labels.bootSectionTitle}</CardTitle>
            <CardDescription>{labels.bootSectionDescription}</CardDescription>
          </div>
          {hasPlan ? (
            <Badge variant="outline" className="normal-case">
              <Layers className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {labels.bootTierCountLabel(tiers.length)}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DRWriteGate canWrite={canWrite} description={labels.bootSectionDescription}>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setDefineOpen(true)}>
              <Plus className="me-1.5 h-4 w-4" aria-hidden />
              {labels.defineServicesTrigger}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setStartOpen(true)}
              disabled={!hasPlan}
            >
              <Play className="me-1.5 h-4 w-4" aria-hidden />
              {labels.startBootRunTrigger}
            </Button>
          </div>
        </DRWriteGate>

        {loading && !bootPlan ? (
          <LoadingSkeleton variant="card" count={1} />
        ) : error && !bootPlan ? (
          <ErrorState message={labels.bootPlanLoadError} onRetry={onRetry} />
        ) : !hasPlan ? (
          <EmptyState
            icon={Layers}
            title={labels.bootPlanEmptyTitle}
            description={labels.bootPlanEmptyDescription}
            size="compact"
          />
        ) : (
          <ol className="space-y-3">
            {tiers.map((tier, tierIndex) =>
              tier.length === 0 ? null : (
                <li key={`tier-${tierIndex}`} className="rounded-card border border-outline-subtle p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone="primary" size="sm" label={labels.bootPlanTierLabel(tierIndex + 1)} />
                    <span className="text-caption text-content-muted">
                      {labels.bootPlanServiceCount(tier.length)}
                    </span>
                  </div>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full border-collapse text-start text-body-sm">
                      <thead>
                        <tr className="border-b border-outline-subtle text-content-muted">
                          <th scope="col" className="px-2 py-1.5 text-start font-semibold">
                            {labels.bootPlanColumnService}
                          </th>
                          <th scope="col" className="px-2 py-1.5 text-start font-semibold">
                            {labels.bootPlanColumnKind}
                          </th>
                          <th scope="col" className="px-2 py-1.5 text-start font-semibold">
                            {labels.bootPlanColumnProbe}
                          </th>
                          <th scope="col" className="px-2 py-1.5 text-start font-semibold">
                            {labels.bootPlanColumnTimeout}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {tier.map((service) => (
                          <tr key={service.id} className="border-b border-outline-subtle/60">
                            <th scope="row" className="px-2 py-1.5 text-start font-medium text-content-primary">
                              {service.name}
                            </th>
                            <td className="px-2 py-1.5 text-content-secondary">{service.kind}</td>
                            <td className="px-2 py-1.5 text-content-secondary">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="font-medium uppercase">
                                  {labels.probeKindOptions[service.probe_kind] ?? service.probe_kind}
                                </span>
                                <span className="font-mono text-caption" dir="ltr">
                                  {service.probe_target}
                                </span>
                              </span>
                            </td>
                            <td className="px-2 py-1.5 tabular-nums text-content-secondary" dir="ltr">
                              {service.boot_timeout_seconds}s
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </li>
              ),
            )}
          </ol>
        )}
      </CardContent>

      <DefineBootServicesDialog
        open={defineOpen}
        onOpenChange={setDefineOpen}
        onDefine={(payload) => {
          onDefineServices(payload);
          setDefineOpen(false);
        }}
        submitting={defineServicesPending}
      />

      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{labels.startBootRunTitle}</DialogTitle>
            <DialogDescription>{labels.startBootRunDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dr-boot-policy">{labels.bootPolicyLabel}</Label>
            <Select value={policy} onValueChange={setPolicy}>
              <SelectTrigger id="dr-boot-policy" aria-describedby="dr-boot-policy-hint">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BOOT_POLICIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {labels.bootPolicyOptions[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id="dr-boot-policy-hint" className="text-xs leading-5 text-muted-foreground">
              {labels.bootPolicyHint}
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStartOpen(false)}
              disabled={startBootRunPending}
            >
              {labels.cancel}
            </Button>
            <Button
              type="button"
              onClick={() => {
                onStartBootRun(policy);
                setStartOpen(false);
              }}
              disabled={startBootRunPending}
            >
              <Play className="me-1.5 h-4 w-4" aria-hidden />
              {labels.startBootRunSubmit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
