'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, Loader2, Sparkles, Users } from 'lucide-react';

import { useT } from '@/components/providers/locale-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { isApiError } from '@/types/api';

import {
  DEFAULT_ONBOARDING_PLAN_CATALOG,
  DEFAULT_PLAN_KEY,
  DEFAULT_PLAN_SEATS,
  DEFAULT_SUITE_SELECTION,
  SUITES,
  type OnboardingProduct,
  type OnboardingPlan,
  type SuiteDefinition,
} from './shared';
import { SuiteSelectorCard } from './suite-selector-card';
import '../../_lib/onboarding-i18n';

type ProductsPlanDraft = {
  active_suites: string[];
  plan_key: string;
  seats: number;
};

export function StepSuites({
  initialSelected,
  initialPlanKey,
  initialSeats,
  plans = DEFAULT_ONBOARDING_PLAN_CATALOG.plans,
  products = DEFAULT_ONBOARDING_PLAN_CATALOG.products,
  defaultPlanKey = DEFAULT_PLAN_KEY,
  defaultSeats = DEFAULT_PLAN_SEATS,
  onBack,
  onSaved,
  onPersist,
}: {
  initialSelected: string[];
  initialPlanKey?: string | null;
  initialSeats?: number | null;
  plans?: OnboardingPlan[];
  products?: OnboardingProduct[];
  defaultPlanKey?: string;
  defaultSeats?: number;
  onBack: () => void;
  onSaved: () => Promise<void>;
  onPersist: (draft: ProductsPlanDraft) => void;
}) {
  const t = useT('onboarding');
  const availablePlans = plans.length > 0 ? plans : DEFAULT_ONBOARDING_PLAN_CATALOG.plans;
  const suiteOptions = useMemo(() => buildSuiteOptions(products), [products]);
  const initialPlan = resolvePlanKey(initialPlanKey, defaultPlanKey, availablePlans);
  const [planKey, setPlanKey] = useState(initialPlan);
  const selectedPlan = useMemo(
    () => availablePlans.find((plan) => plan.key === planKey) ?? availablePlans[0] ?? DEFAULT_ONBOARDING_PLAN_CATALOG.plans[0],
    [availablePlans, planKey],
  );
  const allowedSuiteIds = useMemo(() => getAllowedSuiteIds(selectedPlan, suiteOptions), [selectedPlan, suiteOptions]);
  const [selected, setSelected] = useState<string[]>(() =>
    normalizeSelection(initialSelected, allowedSuiteIds, suiteOptions),
  );
  const [seatsInput, setSeatsInput] = useState(() =>
    String(clampSeats(initialSeats ?? defaultSeats, selectedPlan)),
  );
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const persistRef = useRef(onPersist);
  const seatLimit = getSeatLimit(selectedPlan);
  const seats = parseSeatInput(seatsInput);
  const seatsValid = seats !== null && seats >= 1 && seats <= seatLimit;

  useEffect(() => {
    persistRef.current = onPersist;
  }, [onPersist]);

  useEffect(() => {
    persistRef.current({
      active_suites: selected,
      plan_key: planKey,
      seats: seats ?? clampSeats(defaultSeats, selectedPlan),
    });
  }, [defaultSeats, planKey, seats, selected, selectedPlan]);

  useEffect(() => {
    if (availablePlans.some((plan) => plan.key === planKey && isSelectablePlan(plan))) {
      return;
    }
    setPlanKey(resolvePlanKey(null, defaultPlanKey, availablePlans));
  }, [availablePlans, defaultPlanKey, planKey]);

  useEffect(() => {
    setSelected((current) => normalizeSelection(current, allowedSuiteIds, suiteOptions));
    setSeatsInput((current) => String(clampSeats(parseSeatInput(current) ?? defaultSeats, selectedPlan)));
  }, [allowedSuiteIds, defaultSeats, selectedPlan, suiteOptions]);

  const toggleSuite = (suiteId: string) => {
    if (!allowedSuiteIds.has(suiteId)) {
      return;
    }
    setSelected((current) =>
      current.includes(suiteId) ? current.filter((item) => item !== suiteId) : [...current, suiteId],
    );
  };

  const handleSeatsChange = (value: string) => {
    const parsed = parseSeatInput(value);
    setSeatsInput(parsed === null ? value : String(clampSeats(parsed, selectedPlan)));
  };

  const submit = async () => {
    if (selected.length === 0) {
      setApiError(t('suites.selectAtLeastOne'));
      return;
    }

    if (!seatsValid) {
      setApiError(t('suites.seatsRange', { limit: seatLimit }));
      return;
    }

    setApiError(null);
    setIsSubmitting(true);
    try {
      await apiPost(API_ENDPOINTS.ONBOARDING_SUITES, {
        active_suites: selected,
        plan_key: planKey,
        seats,
      });
      await onSaved();
    } catch (error) {
      setApiError(isApiError(error) ? error.message : t('suites.saveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {apiError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      ) : null}

      {selectedPlan.key === DEFAULT_PLAN_KEY ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold text-foreground">{t('suites.trialIncluded')}</p>
              <p className="mt-1 text-foreground/60">
                {t('suites.trialSummary', { days: selectedPlan.trial_days ?? 14, seats: seatLimit })}
              </p>
            </div>
          </div>
          <Badge variant="success" className="w-fit">
            {t('suites.noPayment')}
          </Badge>
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-caps-xwide text-foreground/45">{t('suites.planHeading')}</h2>
            <p className="mt-1 text-sm text-foreground/55">{t('suites.planSubtitle')}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label={t('suites.planGroupAria')}>
          {availablePlans.map((plan) => {
            const active = plan.key === planKey;
            const disabled = plan.self_serve === false;
            return (
              <button
                key={plan.key}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={t('suites.planAria', { plan: plan.name })}
                disabled={disabled}
                onClick={() => setPlanKey(plan.key)}
                className={cn(
                  'rounded-2xl border bg-card p-4 text-left transition-all',
                  active ? 'border-primary shadow-md' : 'border-primary/15 hover:border-primary/30',
                  disabled ? 'cursor-not-allowed opacity-45 hover:border-primary/15' : null,
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-foreground">{plan.name}</p>
                    {plan.description ? <p className="mt-1 text-sm text-foreground/55">{plan.description}</p> : null}
                  </div>
                  {plan.default || plan.key === defaultPlanKey ? <Badge variant="default">{t('suites.defaultBadge')}</Badge> : null}
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm font-medium text-foreground/70">
                  <Users className="h-4 w-4 text-primary" />
                  {t('suites.upToSeats', { limit: getSeatLimit(plan) })}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="max-w-xs space-y-2">
          <Label htmlFor="onboarding-seats">{t('suites.seatsLabel')}</Label>
          <Input
            id="onboarding-seats"
            type="number"
            min={1}
            max={seatLimit}
            value={seatsInput}
            onChange={(event) => handleSeatsChange(event.target.value)}
            inputMode="numeric"
          />
          <p className="text-xs text-foreground/50">
            {t('suites.seatsHelp', { limit: seatLimit, plan: selectedPlan.name })}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-caps-xwide text-foreground/45">{t('suites.productsHeading')}</h2>
          <p className="mt-1 text-sm text-foreground/55">{t('suites.productsSubtitle')}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {suiteOptions.map((suite) => (
            <SuiteSelectorCard
              key={suite.id}
              suite={suite}
              active={selected.includes(suite.id)}
              disabled={!allowedSuiteIds.has(suite.id)}
              disabledReason={!allowedSuiteIds.has(suite.id) ? t('suites.notInPlan') : undefined}
              onToggle={() => toggleSuite(suite.id)}
            />
          ))}
        </div>
      </section>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          {t('actions.back')}
        </Button>
        <Button type="button" disabled={isSubmitting || selected.length === 0 || !seatsValid} onClick={() => void submit()}>
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t('actions.continue')}
        </Button>
      </div>
    </div>
  );
}

function resolvePlanKey(
  requestedPlanKey: string | null | undefined,
  defaultPlanKey: string,
  plans: OnboardingPlan[],
): string {
  if (requestedPlanKey && plans.some((plan) => plan.key === requestedPlanKey && isSelectablePlan(plan))) {
    return requestedPlanKey;
  }
  if (plans.some((plan) => plan.key === defaultPlanKey && isSelectablePlan(plan))) {
    return defaultPlanKey;
  }
  return (
    plans.find((plan) => plan.default && isSelectablePlan(plan))?.key ??
    plans.find(isSelectablePlan)?.key ??
    plans[0]?.key ??
    DEFAULT_PLAN_KEY
  );
}

function isSelectablePlan(plan: OnboardingPlan): boolean {
  return plan.self_serve !== false;
}

function getSeatLimit(plan: OnboardingPlan): number {
  return Number.isFinite(plan.seat_limit) && plan.seat_limit > 0 ? plan.seat_limit : DEFAULT_PLAN_SEATS;
}

function parseSeatInput(value: string): number | null {
  if (value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
}

function clampSeats(value: number, plan: OnboardingPlan): number {
  return Math.min(Math.max(Math.trunc(value), 1), getSeatLimit(plan));
}

function getAllowedSuiteIds(plan: OnboardingPlan, suiteOptions: SuiteDefinition[]): Set<string> {
  const includedSuites = plan.included_suites?.filter(Boolean) ?? [];
  if (includedSuites.length > 0) {
    return new Set<string>(includedSuites);
  }

  const entitlementKeys = new Set(plan.entitlement_keys?.filter((key) => key && key !== 'seats.users') ?? []);
  if (entitlementKeys.size > 0) {
    return new Set(
      suiteOptions
        .filter((suite) => suite.entitlement_key && entitlementKeys.has(suite.entitlement_key))
        .map((suite) => suite.id),
    );
  }

  return new Set<string>(suiteOptions.map((suite) => suite.id));
}

function normalizeSelection(
  selected: string[],
  allowedSuiteIds: Set<string>,
  suiteOptions: SuiteDefinition[],
): string[] {
  const validSuiteIds = new Set<string>(suiteOptions.map((suite) => suite.id));
  const normalized = selected.filter((suiteId) => validSuiteIds.has(suiteId) && allowedSuiteIds.has(suiteId));
  if (normalized.length > 0) {
    return normalized;
  }

  const defaults = DEFAULT_SUITE_SELECTION.filter((suiteId) => allowedSuiteIds.has(suiteId));
  if (defaults.length > 0) {
    return [...defaults];
  }

  const firstAllowedSuite = suiteOptions.find((suite) => allowedSuiteIds.has(suite.id));
  return firstAllowedSuite ? [firstAllowedSuite.id] : [];
}

function buildSuiteOptions(products: OnboardingProduct[] | undefined): SuiteDefinition[] {
  const localSuitesByID = new Map<string, SuiteDefinition>(SUITES.map((suite) => [suite.id, suite]));
  const sourceProducts = products?.length ? products : DEFAULT_ONBOARDING_PLAN_CATALOG.products;
  const mapped: SuiteDefinition[] = [];
  for (const product of sourceProducts ?? []) {
    const fallback = localSuitesByID.get(product.id);
    if (!fallback) {
      continue;
    }
    mapped.push({
      id: product.id,
      title: product.name || fallback.title,
      description: product.description || fallback.description,
      accent: fallback.accent,
      entitlement_key: product.entitlement_key,
    });
  }

  return mapped.length > 0 ? mapped : SUITES.map((suite) => ({ ...suite }));
}
