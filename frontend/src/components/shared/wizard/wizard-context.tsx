'use client';

/**
 * Shared multi-step wizard state (UI revamp item 42).
 *
 * The step/progress pattern is extracted from the (onboarding)/setup
 * step-indicator + wizard-container pair into a reusable primitive so suite
 * forms stop hand-rolling step state. See `./wizard.tsx` for the compound
 * `<Wizard>` component and a usage example.
 *
 * Per-step zod validation: when the provider is mounted inside a
 * react-hook-form `FormProvider` (whose resolver is the caller's zod schema),
 * each step's `fields` are validated — with focus on the first invalid
 * control — via `form.trigger` before the wizard advances past that step.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFormContext, type FieldValues, type UseFormReturn } from 'react-hook-form';
import type { LucideIcon } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppDirection, AppLocale } from '@/lib/i18n';

export interface WizardStepConfig {
  /** Stable identifier matched by `<Wizard.Step id={…}>`. */
  id: string;
  /** Short label rendered under the step circle. */
  label: string;
  /** Optional longer description for custom chrome. */
  description?: string;
  /** Icon rendered inside the step circle (falls back to the step number). */
  icon?: LucideIcon;
  /**
   * react-hook-form field names validated (against the form's zod resolver,
   * focusing the first failure) before the wizard advances past this step.
   * Requires an ancestor `FormProvider`; ignored otherwise.
   */
  fields?: string[];
  /** Extra imperative gate run after field validation. Return false to block. */
  validate?: () => boolean | Promise<boolean>;
}

export interface WizardContextValue {
  steps: WizardStepConfig[];
  activeIndex: number;
  activeStep: WizardStepConfig;
  isFirst: boolean;
  isLast: boolean;
  /** True while step validation or `onComplete` is in flight. */
  isBusy: boolean;
  /** 0–100, mirroring the onboarding indicator's progress math. */
  progress: number;
  locale: AppLocale;
  direction: AppDirection;
  goBack: () => void;
  /**
   * Validate the active step and advance. On the last step this runs
   * `onComplete` instead. Resolves true when the move (or completion) happened.
   */
  goNext: () => Promise<boolean>;
  /**
   * Jump to a step. Backward jumps are free; forward jumps validate every
   * intermediate step and stop on (and move to) the first failing one.
   */
  goTo: (index: number) => Promise<boolean>;
}

const WizardContext = createContext<WizardContextValue | null>(null);

const EMPTY_STEP: WizardStepConfig = { id: '', label: '' };

export function useWizard(): WizardContextValue {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error('useWizard must be used within <Wizard> or <WizardProvider>');
  }
  return context;
}

export interface WizardProviderProps {
  steps: WizardStepConfig[];
  /** Zero-based index of the step to start on. Defaults to 0. */
  initialIndex?: number;
  onStepChange?: (index: number, step: WizardStepConfig) => void;
  /** Invoked by `goNext` on the last step once its validation passes (e.g. `form.handleSubmit(save)`). */
  onComplete?: () => void | Promise<void>;
  children: ReactNode;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

export function WizardProvider({
  steps,
  initialIndex = 0,
  onStepChange,
  onComplete,
  children,
}: WizardProviderProps) {
  const { locale, direction } = useLocaleOrDefault();
  // RHF integration is optional: useFormContext returns null at runtime when
  // no FormProvider is mounted (its typing pretends otherwise).
  const form = useFormContext() as UseFormReturn<FieldValues> | null;
  const [activeIndex, setActiveIndex] = useState(() => clampIndex(initialIndex, steps.length));
  const [isBusy, setIsBusy] = useState(false);

  // Latest-callback refs keep goNext/goTo identities stable across renders
  // even when callers pass inline handlers.
  const onStepChangeRef = useRef(onStepChange);
  onStepChangeRef.current = onStepChange;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const moveTo = useCallback(
    (index: number) => {
      setActiveIndex(index);
      onStepChangeRef.current?.(index, steps[index] ?? EMPTY_STEP);
    },
    [steps],
  );

  const validateStep = useCallback(
    async (index: number): Promise<boolean> => {
      const step = steps[index];
      if (!step) return true;
      if (form && step.fields && step.fields.length > 0) {
        const fieldsValid = await form.trigger(step.fields, { shouldFocus: true });
        if (!fieldsValid) return false;
      }
      if (step.validate) {
        return (await step.validate()) !== false;
      }
      return true;
    },
    [form, steps],
  );

  const goBack = useCallback(() => {
    if (activeIndex === 0 || isBusy) return;
    moveTo(activeIndex - 1);
  }, [activeIndex, isBusy, moveTo]);

  const goNext = useCallback(async (): Promise<boolean> => {
    if (isBusy) return false;
    setIsBusy(true);
    try {
      const valid = await validateStep(activeIndex);
      if (!valid) return false;
      if (activeIndex >= steps.length - 1) {
        await onCompleteRef.current?.();
        return true;
      }
      moveTo(activeIndex + 1);
      return true;
    } finally {
      setIsBusy(false);
    }
  }, [activeIndex, isBusy, moveTo, steps.length, validateStep]);

  const goTo = useCallback(
    async (index: number): Promise<boolean> => {
      const target = clampIndex(index, steps.length);
      if (target === activeIndex) return true;
      if (target < activeIndex) {
        if (isBusy) return false;
        moveTo(target);
        return true;
      }
      if (isBusy) return false;
      setIsBusy(true);
      try {
        for (let i = activeIndex; i < target; i += 1) {
          const valid = await validateStep(i);
          if (!valid) {
            if (i !== activeIndex) moveTo(i);
            return false;
          }
        }
        moveTo(target);
        return true;
      } finally {
        setIsBusy(false);
      }
    },
    [activeIndex, isBusy, moveTo, steps.length, validateStep],
  );

  // Same progress math as the onboarding step-indicator: completed segments
  // over total segments (a single-step wizard reads as complete).
  const progress =
    steps.length > 1 ? Math.round((activeIndex / (steps.length - 1)) * 100) : 100;

  const value = useMemo<WizardContextValue>(
    () => ({
      steps,
      activeIndex,
      activeStep: steps[activeIndex] ?? EMPTY_STEP,
      isFirst: activeIndex === 0,
      isLast: activeIndex >= steps.length - 1,
      isBusy,
      progress,
      locale,
      direction,
      goBack,
      goNext,
      goTo,
    }),
    [steps, activeIndex, isBusy, progress, locale, direction, goBack, goNext, goTo],
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}
