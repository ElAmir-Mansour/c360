'use client';

import { CheckCircle2, DatabaseZap, Layers, Rocket, Waves } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useProvisionLabels } from './provision-labels';

interface OnboardingStep {
  key: 'site' | 'group' | 'stream';
  icon: LucideIcon;
  title: string;
  description: string;
  cta: string;
  /** A prior step that must complete before this one can be acted on. */
  blocked: boolean;
  done: boolean;
  onStart: () => void;
}

/**
 * First-run guided onboarding panel.
 *
 * Shown when a tenant has no protected sites AND no protection groups: it walks
 * the operator through the canonical build-out order (site -> group -> stream)
 * with real CTAs wired straight to the provisioning dialogs. A step that is
 * already satisfied (the tenant already has that resource) renders as a
 * completed step; a step whose prerequisite is unmet is disabled until the
 * prerequisite exists. When the operator lacks `dr:write` every CTA is disabled
 * via `canWrite`. Token-driven, RTL-safe (logical spacing + numbered steps), and
 * fully bilingual via {@link useProvisionLabels}.
 */
export function ProvisionOnboarding({
  canWrite,
  hasSites,
  hasGroups,
  hasStreams,
  onCreateSite,
  onCreateGroup,
  onCreateStream,
}: {
  canWrite: boolean;
  hasSites: boolean;
  hasGroups: boolean;
  hasStreams: boolean;
  onCreateSite: () => void;
  onCreateGroup: () => void;
  onCreateStream: () => void;
}) {
  const labels = useProvisionLabels();
  const L = labels.onboarding;

  const steps: OnboardingStep[] = [
    {
      key: 'site',
      icon: DatabaseZap,
      title: L.siteStepTitle,
      description: L.siteStepDescription,
      cta: L.siteStepCta,
      blocked: false,
      done: hasSites,
      onStart: onCreateSite,
    },
    {
      key: 'group',
      icon: Layers,
      title: L.groupStepTitle,
      description: L.groupStepDescription,
      cta: L.groupStepCta,
      blocked: !hasSites,
      done: hasGroups,
      onStart: onCreateGroup,
    },
    {
      key: 'stream',
      icon: Waves,
      title: L.streamStepTitle,
      description: L.streamStepDescription,
      cta: L.streamStepCta,
      blocked: !hasSites,
      done: hasStreams,
      onStart: onCreateStream,
    },
  ];

  const total = steps.length;

  return (
    <Card className="border-primary/30 bg-primary/5" data-testid="dr-provision-onboarding">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            <Rocket className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <CardTitle className="text-base">{L.title}</CardTitle>
            <CardDescription>{L.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 md:grid-cols-3">
          {steps.map((step, index) => {
            const stepNumber = index + 1;
            const StepIcon = step.icon;
            const disabled = !canWrite || step.blocked || step.done;
            return (
              <li
                key={step.key}
                className={cn(
                  'flex flex-col rounded-lg border bg-card p-4',
                  step.done && 'border-primary/40',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                        step.done
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                      aria-hidden
                    >
                      {step.done ? <CheckCircle2 className="h-4 w-4" /> : stepNumber}
                    </span>
                    <span className="sr-only">
                      {L.stepAria
                        .replace('{step}', String(stepNumber))
                        .replace('{total}', String(total))}
                    </span>
                    <StepIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </span>
                  {step.done ? (
                    <span className="text-xs font-medium text-primary">{L.done}</span>
                  ) : null}
                </div>
                <h3 className="mt-3 text-sm font-semibold">{step.title}</h3>
                <p className="mt-1 flex-1 text-xs leading-5 text-muted-foreground">
                  {step.description}
                </p>
                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant={step.done ? 'outline' : 'default'}
                    disabled={disabled}
                    onClick={step.onStart}
                  >
                    {step.cta}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
