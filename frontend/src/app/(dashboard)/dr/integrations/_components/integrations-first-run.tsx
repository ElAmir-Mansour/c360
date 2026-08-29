'use client';

import { ArrowRight, DatabaseZap, Plug, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { IntegrationHealthCopy } from './integration-health';

/**
 * Prominent first-run on-ramp shown on `/dr/integrations` when no connectors are
 * configured yet. It makes "connect a source" the explicit first step before any
 * replication can run, rather than leaving the operator on a bare empty table.
 *
 * Complements (does not replace) the compact `SectionEmpty` card that still
 * renders below it: this hero frames the three-step path (connect a source →
 * replicate into a protection group → recover/rehearse/prove) and surfaces the
 * primary "Connect a source" action for operators with `dr:write`.
 *
 * Copy is fully bilingual via the resolved {@link IntegrationHealthCopy}; layout
 * uses logical properties (`text-start`, `me-*`, `rtl:rotate-180`) so it mirrors
 * correctly in RTL.
 */
export function IntegrationsFirstRun({
  copy,
  canWrite,
  onConnect,
}: {
  copy: IntegrationHealthCopy;
  canWrite: boolean;
  onConnect: () => void;
}) {
  const steps = [
    { icon: Plug, label: copy.firstRunStepSources },
    { icon: DatabaseZap, label: copy.firstRunStepReplicate },
    { icon: ShieldCheck, label: copy.firstRunStepRecover },
  ];

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary rtl:tracking-normal">
              {copy.firstRunEyebrow}
            </p>
            <h2 className="text-h4 font-semibold text-foreground">
              {copy.firstRunTitle}
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {copy.firstRunDescription}
            </p>
          </div>
          {canWrite ? (
            <Button onClick={onConnect} className="shrink-0 gap-1.5 self-start">
              <Plug className="h-4 w-4" aria-hidden />
              {copy.firstRunTitle}
            </Button>
          ) : null}
        </div>

        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.label}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                    {index + 1}.
                  </span>
                  <span className="text-sm font-medium leading-tight text-foreground">
                    {step.label}
                  </span>
                </div>
                {index < steps.length - 1 ? (
                  <ArrowRight
                    className="ms-auto hidden h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180 sm:block"
                    aria-hidden
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
