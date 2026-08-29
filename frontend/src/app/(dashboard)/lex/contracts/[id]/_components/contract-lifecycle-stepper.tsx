'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A single lifecycle stage as consumed by {@link ContractLifecycleStepper}.
 *
 * The component is intentionally presentational: the integrator resolves the
 * human-readable `label` (e.g. via `titleCase(stage)` or `contractStatusConfig`)
 * and an optional `description` (the per-state caption) up-front. `key` is the
 * stable React key (typically the raw lifecycle status string).
 */
export interface ContractLifecycleStage {
  key: string;
  label: string;
  description?: string;
}

export interface ContractLifecycleStepperProps {
  /** Ordered lifecycle stages, earliest → latest. */
  stages: ContractLifecycleStage[];
  /**
   * Zero-based index of the contract's current stage within `stages`.
   * Stages before it render as completed (✓); the stage at this index is the
   * highlighted current node; later stages are muted/upcoming. A value < 0
   * (status not found in the pipeline) renders every node as upcoming.
   */
  currentIndex: number;
  /** Accessible label for the ordered list. Defaults to "Contract lifecycle". */
  ariaLabel?: string;
  className?: string;
}

type StageState = 'complete' | 'current' | 'upcoming';

/**
 * Connected horizontal lifecycle stepper for the Watheeq / Lex contract detail
 * page. Renders a single authoritative progress track:
 *
 *  - completed stages: filled node with a ✓
 *  - current stage: highlighted node (ring + glow + spring-pop entrance)
 *  - upcoming stages: muted nodes
 *  - a connector segment between each node, "filled" up to the current stage
 *
 * Deliberately carries NO ordinal counts (the old grid showed misleading 1-6
 * numbers). Wraps/scrolls on narrow viewports and is keyboard/SR friendly via
 * an `<ol>`/`<li>` structure with `aria-current="step"` on the active node.
 * Motion is delivered exclusively through `animate-spring-pop`, which the design
 * system already disables under `prefers-reduced-motion`.
 */
export function ContractLifecycleStepper({
  stages,
  currentIndex,
  ariaLabel = 'Contract lifecycle',
  className,
}: ContractLifecycleStepperProps) {
  if (stages.length === 0) return null;

  const stateFor = (index: number): StageState => {
    if (currentIndex < 0) return 'upcoming';
    if (index < currentIndex) return 'complete';
    if (index === currentIndex) return 'current';
    return 'upcoming';
  };

  return (
    <ol
      aria-label={ariaLabel}
      className={cn(
        // Horizontal track; scroll on small screens so nodes never crush.
        'flex min-w-0 items-start gap-0 overflow-x-auto pb-1',
        className,
      )}
    >
      {stages.map((stage, index) => {
        const state = stateFor(index);
        const isComplete = state === 'complete';
        const isCurrent = state === 'current';
        const isLast = index === stages.length - 1;
        // The connector leading OUT of this node is "filled" once this node is
        // reached (i.e. completed), tracing progress up to the current stage.
        const connectorFilled = index < currentIndex;

        return (
          <li
            key={stage.key}
            aria-current={isCurrent ? 'step' : undefined}
            className="flex min-w-[5.5rem] flex-1 flex-col items-center"
          >
            <div className="flex w-full items-center">
              {/* leading connector spacer keeps the first node centered */}
              <span
                aria-hidden
                className={cn(
                  'h-0.5 flex-1 rounded-full',
                  index === 0 ? 'opacity-0' : connectorFilled || isCurrent ? 'bg-primary' : 'bg-border',
                )}
              />

              <span
                className={cn(
                  'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
                  isComplete && 'border-primary bg-primary text-primary-foreground',
                  isCurrent &&
                    'animate-spring-pop border-primary bg-primary/10 text-primary ring-4 ring-primary/25 shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]',
                  state === 'upcoming' &&
                    'border-[color:var(--panel-border)] bg-card text-muted-foreground',
                )}
              >
                {isComplete ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : isCurrent ? (
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40" aria-hidden />
                )}
              </span>

              {/* trailing connector */}
              <span
                aria-hidden
                className={cn(
                  'h-0.5 flex-1 rounded-full',
                  isLast ? 'opacity-0' : connectorFilled ? 'bg-primary' : 'bg-border',
                )}
              />
            </div>

            <span
              className={cn(
                'mt-2 max-w-[8rem] text-center text-xs leading-tight',
                isCurrent ? 'font-semibold text-foreground' : isComplete ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {stage.label}
            </span>
            {stage.description ? (
              <span className="mt-0.5 max-w-[8rem] text-center text-[11px] leading-tight text-muted-foreground">
                {stage.description}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
