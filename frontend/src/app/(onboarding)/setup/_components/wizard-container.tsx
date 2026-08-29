'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';

import { useT } from '@/components/providers/locale-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth-store';
import { isApiError } from '@/types/api';

import { StepBranding } from './step-branding';
import { StepIndicator } from './step-indicator';
import { StepOrganization } from './step-organization';
import { StepReady } from './step-ready';
import { StepSuites } from './step-suites';
import { StepTeam } from './step-team';
import {
  clearDraft,
  DEFAULT_ONBOARDING_PLAN_CATALOG,
  DEFAULT_PLAN_KEY,
  DEFAULT_PLAN_SEATS,
  DEFAULT_SUITE_SELECTION,
  loadDraft,
  saveDraft,
  type BrandingFormValues,
  type OnboardingPlan,
  type OnboardingPlanCatalog,
  type OrganizationFormValues,
  type RoleRecord,
  type WizardDraft,
  type WizardProgress,
} from './shared';
import '../../_lib/onboarding-i18n';

export function WizardContainer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenant = useAuthStore((state) => state.tenant);
  const t = useT('onboarding');

  const [wizard, setWizard] = useState<WizardProgress | null>(null);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [draft, setDraft] = useState<WizardDraft>({});
  const [planCatalog, setPlanCatalog] = useState<OnboardingPlanCatalog>(DEFAULT_ONBOARDING_PLAN_CATALOG);
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(loadDraft());
  }, []);

  const syncStep = (step: number) => {
    const nextStep = Math.min(Math.max(step, 1), 5);
    setCurrentStep(nextStep);
    router.replace(`${ROUTES.SETUP}?step=${nextStep}`);
  };

  const refreshWizard = async (preferredStep?: number) => {
    const [wizardProgress, roleRecords, onboardingPlanCatalog] = await Promise.all([
      apiGet<WizardProgress>(API_ENDPOINTS.ONBOARDING_WIZARD),
      apiGet<RoleRecord[]>(API_ENDPOINTS.ROLES).catch(() => []),
      apiGet<OnboardingPlanCatalog | OnboardingPlan[]>(API_ENDPOINTS.ONBOARDING_PLANS)
        .then(normalizePlanCatalog)
        .catch(() => DEFAULT_ONBOARDING_PLAN_CATALOG),
    ]);

    setWizard(wizardProgress);
    setRoles(roleRecords);
    setPlanCatalog(onboardingPlanCatalog);

    if (wizardProgress.wizard_completed && wizardProgress.provisioning_status === 'completed') {
      clearDraft();
      router.replace(ROUTES.DASHBOARD);
      return;
    }

    const queryStep = Number(searchParams?.get('step'));
    const resolvedStep =
      preferredStep ??
      (Number.isFinite(queryStep) && queryStep >= 1 && queryStep <= 5
        ? queryStep
        : wizardProgress.wizard_completed
          ? 5
          : Math.max(1, wizardProgress.current_step || 1));

    setCurrentStep(resolvedStep);
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        await refreshWizard();
      } catch (error) {
        if (active) {
          setLoadError(isApiError(error) ? error.message : t('wizard.loadFailed'));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
    // Initial wizard load runs once on mount; refreshWizard is invoked imperatively
    // elsewhere and re-running this loader on its identity change is not intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!wizard) {
      return;
    }
    const queryStep = Number(searchParams?.get('step'));
    if (Number.isFinite(queryStep) && queryStep >= 1 && queryStep <= 5 && queryStep !== currentStep) {
      setCurrentStep(queryStep);
    }
  }, [searchParams, wizard, currentStep]);

  const organizationDefaults = useMemo<OrganizationFormValues>(
    () => ({
      organization_name: draft.organization?.organization_name ?? wizard?.organization_name ?? '',
      industry: draft.organization?.industry ?? wizard?.industry ?? 'financial',
      country: draft.organization?.country ?? wizard?.country ?? 'SA',
      city: draft.organization?.city ?? wizard?.city ?? '',
      organization_size: draft.organization?.organization_size ?? wizard?.organization_size ?? '1-50',
    }),
    [draft.organization, wizard],
  );

  const brandingDefaults = useMemo<BrandingFormValues>(
    () => ({
      primary_color: draft.branding?.primary_color ?? wizard?.primary_color ?? '#005E5E',
      accent_color: draft.branding?.accent_color ?? wizard?.accent_color ?? '#ABB705',
    }),
    [draft.branding, wizard],
  );

  const teamDefaults = draft.team ?? [{ email: '', role_slug: roles[0]?.slug ?? 'viewer', message: '' }];
  const suiteDefaults = draft.suites ?? wizard?.active_suites ?? [...DEFAULT_SUITE_SELECTION];
  const planDefault = draft.plan_key ?? wizard?.plan_key ?? planCatalog.default_plan_key ?? DEFAULT_PLAN_KEY;
  const seatsDefault =
    draft.seats ??
    (wizard?.seats && wizard.seats > 0 ? wizard.seats : planCatalog.default_seats ?? DEFAULT_PLAN_SEATS);

  const persistDraft = (nextDraft: WizardDraft) => {
    setDraft(nextDraft);
    saveDraft(nextDraft);
  };

  if (isLoading) {
    return (
      <div className="flex w-full flex-col items-center justify-center gap-3 rounded-soft-lg border border-white/70 bg-card/90 px-8 py-16 shadow-elevation-2">
        <Spinner />
        <p className="text-sm text-foreground/55">{t('wizard.loading')}</p>
      </div>
    );
  }

  if (loadError || !wizard) {
    return (
      <div className="w-full rounded-soft-lg border border-error-100 bg-card p-8 shadow-sm">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{loadError ?? t('wizard.unableToLoad')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="w-full rounded-softest border border-white/80 bg-card/90 p-8 shadow-elevation-2">
      <StepIndicator currentStep={currentStep} />

      <div className="mb-8">
        <h1 className="text-h2 font-semibold text-foreground">
          {currentStep === 1 && t('wizard.headings.organization')}
          {currentStep === 2 && t('wizard.headings.branding')}
          {currentStep === 3 && t('wizard.headings.team')}
          {currentStep === 4 && t('wizard.headings.suites')}
          {currentStep === 5 && t('wizard.headings.ready')}
        </h1>
        <p className="mt-2 text-sm text-foreground/55">
          {currentStep === 1 && t('wizard.subtitles.organization')}
          {currentStep === 2 && t('wizard.subtitles.branding')}
          {currentStep === 3 && t('wizard.subtitles.team')}
          {currentStep === 4 && t('wizard.subtitles.suites')}
          {currentStep === 5 && t('wizard.subtitles.ready')}
        </p>
      </div>

      {currentStep === 1 ? (
        <StepOrganization
          initialValues={organizationDefaults}
          onSaved={async () => {
            await refreshWizard(2);
            syncStep(2);
          }}
          onPersist={(values) => persistDraft({ ...draft, organization: values })}
        />
      ) : null}

      {currentStep === 2 ? (
        <StepBranding
          initialValues={brandingDefaults}
          savedLogoFileId={wizard.logo_file_id ?? null}
          onBack={() => syncStep(1)}
          onSaved={async () => {
            await refreshWizard(3);
            syncStep(3);
          }}
          onPersist={(values) => persistDraft({ ...draft, branding: values })}
        />
      ) : null}

      {currentStep === 3 ? (
        <StepTeam
          roles={roles.length > 0 ? roles : [{ id: 'viewer', name: 'Viewer', slug: 'viewer' }]}
          initialRows={teamDefaults}
          onBack={() => syncStep(2)}
          onSaved={async () => {
            await refreshWizard(4);
            syncStep(4);
          }}
          onPersist={(rows) => persistDraft({ ...draft, team: rows })}
        />
      ) : null}

      {currentStep === 4 ? (
        <StepSuites
          initialSelected={suiteDefaults}
          initialPlanKey={planDefault}
          initialSeats={seatsDefault}
          plans={planCatalog.plans}
          products={planCatalog.products}
          defaultPlanKey={planCatalog.default_plan_key ?? DEFAULT_PLAN_KEY}
          defaultSeats={planCatalog.default_seats ?? DEFAULT_PLAN_SEATS}
          onBack={() => syncStep(3)}
          onSaved={async () => {
            await refreshWizard(5);
            syncStep(5);
          }}
          onPersist={(values) =>
            persistDraft({
              ...draft,
              suites: values.active_suites,
              plan_key: values.plan_key,
              seats: values.seats,
            })
          }
        />
      ) : null}

      {currentStep === 5 ? (
        <StepReady tenantID={wizard.tenant_id || tenant?.id || ''} initialStatus={wizard.provisioning_status} onBack={() => syncStep(4)} />
      ) : null}
    </div>
  );
}

function normalizePlanCatalog(rawCatalog: OnboardingPlanCatalog | OnboardingPlan[]): OnboardingPlanCatalog {
  const catalog = Array.isArray(rawCatalog) ? { plans: rawCatalog } : rawCatalog;
  const plans = catalog.plans?.length ? catalog.plans : DEFAULT_ONBOARDING_PLAN_CATALOG.plans;
  const defaultPlanKey =
    catalog.default_plan_key && plans.some((plan) => plan.key === catalog.default_plan_key)
      ? catalog.default_plan_key
      : plans.find((plan) => plan.default)?.key ?? plans[0]?.key ?? DEFAULT_PLAN_KEY;
  const defaultPlan = plans.find((plan) => plan.key === defaultPlanKey) ?? plans[0];
  const maxDefaultSeats =
    defaultPlan && Number.isFinite(defaultPlan.seat_limit) && defaultPlan.seat_limit > 0
      ? defaultPlan.seat_limit
      : DEFAULT_PLAN_SEATS;
  const requestedDefaultSeats = catalog.default_seats && catalog.default_seats > 0 ? catalog.default_seats : DEFAULT_PLAN_SEATS;

  return {
    plans,
    products: catalog.products?.length ? catalog.products : DEFAULT_ONBOARDING_PLAN_CATALOG.products,
    default_plan_key: defaultPlanKey,
    default_seats: Math.min(requestedDefaultSeats, maxDefaultSeats),
  };
}
