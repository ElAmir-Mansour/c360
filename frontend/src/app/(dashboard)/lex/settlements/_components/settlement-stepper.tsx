/**
 * Feature 9 — Settlement FSM lifecycle stepper (detail page).
 *
 * A horizontal, RTL-aware progress tracker over the happy-path settlement
 * lifecycle (`proposed → negotiating → pending_approval → approved → executed`)
 * that highlights the current stage, marks completed stages, previews upcoming
 * stages, and surfaces the two terminal OFF-path states (`rejected` /
 * `abandoned`) with a distinct visual treatment.
 *
 * It is presentational by default. An optional `onAction` affordance surfaces
 * the next allowed forward transition (read from `SETTLEMENT_STATUS_TRANSITIONS`,
 * the same FSM the detail page actions are gated on) as a single inline button;
 * when no `onAction` is supplied no transition control is rendered.
 *
 * Self-contained per the lex bilingual contract (`../../_lib/lex-i18n.ts`): it
 * owns a small `LexBilingual<StepperLabels>` bundle for ONLY the copy not already
 * in the shared settlement label helpers (stage names come from
 * {@link settlementStatusLabel}). Western digits and `{value}` placeholders are
 * preserved across both locales. Glossary: تسوية / تفاوض / اعتماد / معتمدة /
 * منفّذة / مرفوضة / متروكة.
 *
 * RTL-correct: the track is a flex row that the surrounding `dir` flips, and the
 * connector chevrons render the logical "next" glyph via `ChevronLeft` in RTL /
 * `ChevronRight` in LTR. All spacing uses logical (`ms-/me-/gap`) utilities.
 *
 * Mounting (integrator, detail page): render directly under the detail
 * `PageHeader`, above the stat-card grid, e.g.
 *
 *   <PageHeader title={...} actions={...} />
 *   <SettlementStepper status={settlement.status} />
 *   <div className="grid ...">{/* stat cards *\/}</div>
 */

'use client';

import { useMemo } from 'react';
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  SETTLEMENT_STATUS_TRANSITIONS,
  type SettlementStatus,
} from '@/lib/lex/settlements';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import { settlementStatusLabel, useSettlementLabels, type SettlementLabels } from './labels';

/* ------------------------------------------------------------------------- *
 * FSM topology.
 *
 * The five happy-path stages, in lifecycle order. The two terminal OFF-path
 * states (`rejected`, `abandoned`) are NOT on this track — they are surfaced via
 * the distinct terminal banner.
 * ------------------------------------------------------------------------- */

export const SETTLEMENT_HAPPY_PATH = [
  'proposed',
  'negotiating',
  'pending_approval',
  'approved',
  'executed',
] as const satisfies readonly SettlementStatus[];

/** The OFF-path terminal states that short-circuit the happy path. */
export const SETTLEMENT_TERMINAL_STATES = ['rejected', 'abandoned'] as const satisfies readonly SettlementStatus[];

type TerminalStatus = (typeof SETTLEMENT_TERMINAL_STATES)[number];

function isTerminal(status: SettlementStatus): status is TerminalStatus {
  return (SETTLEMENT_TERMINAL_STATES as readonly string[]).includes(status);
}

/**
 * The stage on the happy path that a terminal state diverged FROM, used to mark
 * how far the lifecycle progressed before it was rejected/abandoned. A rejected
 * settlement reached approval review; an abandoned one may be dropped from any
 * pre-terminal stage, so we conservatively mark only the first stage complete.
 */
const TERMINAL_REACHED_INDEX: Record<TerminalStatus, number> = {
  // pending_approval is index 2; rejection happens during/after approval review.
  rejected: 2,
  // abandonment can happen from any active stage; mark only `proposed` reached.
  abandoned: 0,
};

/* ------------------------------------------------------------------------- *
 * Per-step visual state.
 * ------------------------------------------------------------------------- */

type StepState = 'complete' | 'current' | 'upcoming';

/* ------------------------------------------------------------------------- *
 * Bilingual labels — ONLY what the shared settlement helpers don't already
 * provide (stage names reuse `settlementStatusLabel`).
 * ------------------------------------------------------------------------- */

export interface StepperLabels {
  /** Accessible name for the whole tracker. */
  ariaLabel: string;
  /** aria step description, e.g. "Step 2 of 5". */
  stepOf: (index: number, total: number) => string;
  /** Per-state suffix used in each step's accessible label. */
  state: Record<StepState, string>;
  /** Heading shown above the terminal banner. */
  terminalTitle: Record<TerminalStatus, string>;
  /** Explanatory line in the terminal banner. */
  terminalDescription: Record<TerminalStatus, string>;
  /** Inline next-action affordance, e.g. "Next: Submit for approval". */
  nextActionPrefix: string;
}

const stepperLabelsBundle: LexBilingual<StepperLabels> = {
  en: {
    ariaLabel: 'Settlement lifecycle progress',
    stepOf: (index, total) => `Step ${index} of ${total}`,
    state: {
      complete: 'completed',
      current: 'current stage',
      upcoming: 'upcoming',
    },
    terminalTitle: {
      rejected: 'Settlement rejected',
      abandoned: 'Settlement abandoned',
    },
    terminalDescription: {
      rejected: 'The approval authority declined this settlement; it left the lifecycle at review.',
      abandoned: 'This settlement was abandoned and will not proceed to execution.',
    },
    nextActionPrefix: 'Next',
  },
  ar: {
    ariaLabel: 'تقدّم دورة حياة التسوية',
    stepOf: (index, total) => `الخطوة ${index} من ${total}`,
    state: {
      complete: 'مكتملة',
      current: 'المرحلة الحالية',
      upcoming: 'قادمة',
    },
    terminalTitle: {
      rejected: 'تم رفض التسوية',
      abandoned: 'تم ترك التسوية',
    },
    terminalDescription: {
      rejected: 'رفضت جهة الاعتماد هذه التسوية؛ فخرجت من دورة الحياة عند مرحلة المراجعة.',
      abandoned: 'تُركت هذه التسوية ولن تنتقل إلى التنفيذ.',
    },
    nextActionPrefix: 'التالي',
  },
};

/** Pure resolver for non-React callers and tests; English default. */
export function resolveSettlementStepperLabels(locale: AppLocale = 'en'): StepperLabels {
  return resolveLexBilingual(stepperLabelsBundle, locale);
}

/** Thin memoized React hook returning the resolved {@link StepperLabels}. */
export function useSettlementStepperLabels(): StepperLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveSettlementStepperLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Pure derivation.
 * ------------------------------------------------------------------------- */

/**
 * Derives the visual state of each happy-path stage for a given status.
 * For on-path statuses: stages before the current index are `complete`, the
 * current index is `current`, and later stages are `upcoming`. The terminal
 * `executed` stage is itself `complete` (the lifecycle is done).
 *
 * For terminal OFF-path statuses (`rejected`/`abandoned`): stages up to the
 * divergence index are `complete` and the remainder are `upcoming` — the
 * terminal banner (not the track) carries the failure signal.
 */
export function deriveStepStates(status: SettlementStatus): StepState[] {
  if (isTerminal(status)) {
    const reached = TERMINAL_REACHED_INDEX[status];
    return SETTLEMENT_HAPPY_PATH.map((_, i) => (i <= reached ? 'complete' : 'upcoming'));
  }

  const currentIndex = SETTLEMENT_HAPPY_PATH.indexOf(status);
  // `executed` is the final happy-path stage — the whole track reads complete.
  const isDone = status === 'executed';
  return SETTLEMENT_HAPPY_PATH.map((_, i) => {
    if (isDone) {
      return 'complete';
    }
    if (i < currentIndex) {
      return 'complete';
    }
    if (i === currentIndex) {
      return 'current';
    }
    return 'upcoming';
  });
}

/**
 * The single next forward transition to surface as an action affordance, or
 * `null` when the status is terminal / has no forward move. We pick the FIRST
 * happy-path-forward transition (the primary "advance" move), ignoring the
 * always-available `abandoned` escape hatch so the affordance reads as progress.
 */
export function nextHappyTransition(status: SettlementStatus): SettlementStatus | null {
  if (isTerminal(status)) {
    return null;
  }
  const allowed = SETTLEMENT_STATUS_TRANSITIONS[status] ?? [];
  const forward = allowed.find((next) => next !== 'abandoned' && next !== 'rejected');
  return forward ?? null;
}

/* ------------------------------------------------------------------------- *
 * Presentation tokens.
 * ------------------------------------------------------------------------- */

interface StepStyle {
  /** Circle (node) classes. */
  node: string;
  /** Label text classes. */
  label: string;
  /** Connector segment classes (the bar trailing this node). */
  connector: string;
  icon: LucideIcon;
}

const STEP_STYLES: Record<StepState, StepStyle> = {
  complete: {
    node: 'bg-success-500 border-success-500 text-white shadow-sm',
    label: 'text-foreground',
    connector: 'bg-success-500/70',
    icon: Check,
  },
  current: {
    node: 'bg-primary border-primary text-primary-foreground ring-4 ring-primary/15 shadow-sm',
    label: 'text-foreground font-semibold',
    connector: 'bg-border',
    icon: CircleDot,
  },
  upcoming: {
    node: 'bg-muted border-border text-muted-foreground',
    label: 'text-muted-foreground',
    connector: 'bg-border',
    icon: CircleDot,
  },
};

const TERMINAL_STYLES: Record<TerminalStatus, { wrap: string; icon: LucideIcon; iconWrap: string }> = {
  rejected: {
    wrap: 'border-rose-200 bg-rose-50 dark:border-rose-800/60 dark:bg-rose-900/20',
    icon: XCircle,
    iconWrap: 'bg-rose-500 text-white',
  },
  abandoned: {
    wrap: 'border-muted-foreground/30 bg-muted/50 dark:border-muted-foreground/20',
    icon: Ban,
    iconWrap: 'bg-muted-foreground/70 text-background',
  },
};

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

export interface SettlementStepperProps {
  /** The current settlement lifecycle status. */
  status: SettlementStatus;
  /**
   * Optional next-transition affordance. When provided, the stepper renders a
   * single inline button for the next forward transition (if any) and invokes
   * this with that target status. Omit it to keep the stepper purely
   * presentational (the default).
   */
  onAction?: (next: SettlementStatus) => void;
  /** Disables the next-action button (e.g. while a mutation is pending). */
  actionDisabled?: boolean;
  className?: string;
}

/**
 * SettlementStepper renders the horizontal, RTL-aware FSM lifecycle tracker for
 * a settlement. Mount it directly under the detail PageHeader.
 */
export function SettlementStepper({
  status,
  onAction,
  actionDisabled = false,
  className,
}: SettlementStepperProps) {
  const L = useSettlementLabels();
  const labels = useSettlementStepperLabels();
  const { direction } = useLocaleOrDefault();
  const isRtl = direction === 'rtl';

  const states = useMemo(() => deriveStepStates(status), [status]);
  const terminal = isTerminal(status) ? status : null;
  const next = onAction ? nextHappyTransition(status) : null;

  // In RTL the visual flow points start→end which is right→left, so the
  // "advance" chevron is a left chevron; LTR uses a right chevron.
  const Chevron = isRtl ? ChevronLeft : ChevronRight;
  const total = SETTLEMENT_HAPPY_PATH.length;

  return (
    <section
      className={cn('rounded-xl border bg-card p-4 sm:p-5', className)}
      aria-label={labels.ariaLabel}
    >
      <ol className="flex items-start gap-1 overflow-x-auto pb-1" role="list">
        {SETTLEMENT_HAPPY_PATH.map((stage, index) => {
          const state = states[index];
          const style = STEP_STYLES[state];
          const Icon = style.icon;
          const isLast = index === total - 1;
          const stageName = settlementStatusLabel(L, stage);

          return (
            <li
              key={stage}
              className="flex min-w-0 flex-1 items-start"
              aria-current={state === 'current' ? 'step' : undefined}
              aria-label={`${labels.stepOf(index + 1, total)} — ${stageName} (${labels.state[state]})`}
            >
              <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors',
                    style.node,
                  )}
                  aria-hidden
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className={cn('px-1 text-xs leading-tight', style.label)}>{stageName}</span>
              </div>

              {!isLast ? (
                <div className="flex min-w-0 flex-1 items-center pt-3.5" aria-hidden>
                  <span className={cn('h-0.5 w-full rounded-full', style.connector)} />
                  <Chevron
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      state === 'complete' ? 'text-success-500/70' : 'text-muted-foreground/40',
                    )}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {terminal ? <TerminalBanner status={terminal} labels={labels} /> : null}

      {next && onAction ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => onAction(next)}
            disabled={actionDisabled}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5',
              'text-xs font-medium text-primary transition-colors hover:bg-primary/10',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <span>
              {labels.nextActionPrefix}: {settlementStatusLabel(L, next)}
            </span>
            <Chevron className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------------- *
 * Terminal banner — the distinct OFF-path treatment.
 * ------------------------------------------------------------------------- */

function TerminalBanner({
  status,
  labels,
}: {
  status: TerminalStatus;
  labels: StepperLabels;
}) {
  const style = TERMINAL_STYLES[status];
  const Icon = style.icon;
  return (
    <div
      className={cn('mt-4 flex items-start gap-3 rounded-lg border p-3', style.wrap)}
      role="status"
    >
      <span
        className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', style.iconWrap)}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold">{labels.terminalTitle[status]}</p>
        <p className="text-xs text-muted-foreground">{labels.terminalDescription[status]}</p>
      </div>
    </div>
  );
}
