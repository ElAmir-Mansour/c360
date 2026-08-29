'use client';

/**
 * STEP 1 — Select Service.
 *
 * SKELETON: composes the existing `ServiceCatalogStep` (live catalog card grid)
 * and the eligibility banner with the current wiring intact. Selecting a card
 * sets `serviceId` (in `page.tsx`) and re-runs the eligibility check.
 *
 * STEP AGENT: restyle to the mockup (see new-request-wizard-mockup-spec.md
 * STEP 1) — a 3-column service card grid with per-card "Select Service" buttons,
 * light-teal icon tiles, and the selected/eligibility states. Keep the
 * `value`/`onChange` (serviceId) contract and the eligibility banner.
 */

import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import type { EligibilityDecision } from '@/lib/lex/requests';
import type { ServiceDeskLabels } from '../../../_components/labels';
import ServiceCatalogStep from '../service-catalog-step';
import type { ServiceStepProps } from '../../_lib/wizard-types';

const HEADING = {
  en: {
    title: 'What do you need help with?',
    description: 'Choose the service that best matches your request. You can change it before submitting.',
  },
  ar: {
    title: 'ما نوع المساعدة التي تحتاج إليها؟',
    description: 'اختر الخدمة الأقرب إلى طلبك. يمكنك تغييرها قبل الإرسال.',
  },
} as const;

export default function ServiceStep({
  labels,
  services,
  servicesLoading,
  servicesError,
  onRetryServices,
  serviceId,
  onServiceChange,
  recentIds,
  eligibility,
  eligibilityLoading,
  onRecheckEligibility,
  errors,
}: ServiceStepProps) {
  const t = labels.wizard;
  const { locale } = useLocaleOrDefault();
  const copy = locale === 'ar' ? HEADING.ar : HEADING.en;

  return (
    <SectionCard
      title={copy.title}
      description={copy.description}
      className="border-border/70 shadow-elevation-1"
      contentClassName="pt-0"
    >
      {servicesLoading ? (
        <Skeleton variant="list" rows={4} />
      ) : servicesError ? (
        <ErrorState message={labels.detail.errorMessage} onRetry={onRetryServices} />
      ) : (
        <div className="space-y-5">
          <ServiceCatalogStep
            services={services}
            value={serviceId}
            onChange={onServiceChange}
            error={errors.service}
            recentlyUsedIds={recentIds}
          />

          {serviceId ? (
            <EligibilityBanner
              loading={eligibilityLoading}
              decision={eligibility}
              labels={labels}
              onRecheck={onRecheckEligibility}
            />
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function EligibilityBanner({
  loading,
  decision,
  labels,
  onRecheck,
}: {
  loading: boolean;
  decision?: EligibilityDecision;
  labels: ServiceDeskLabels;
  onRecheck: () => void;
}) {
  const t = labels.wizard;
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {t.eligibilityChecking}
      </div>
    );
  }
  if (!decision) return null;
  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3 text-sm shadow-sm',
        decision.eligible
          ? 'border-success-300/70 bg-success-50 text-success-700 dark:border-success-700/60 dark:bg-success-700/15 dark:text-success-300'
          : 'border-error-300/70 bg-error-50 text-error-700 dark:border-error-700/60 dark:bg-error-700/15 dark:text-error-300',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">
          {decision.eligible ? (
            <ShieldCheck className="h-4 w-4" aria-hidden />
          ) : (
            <ShieldAlert className="h-4 w-4" aria-hidden />
          )}
          {decision.eligible ? t.eligible : t.notEligible}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={onRecheck}>
          {t.eligibilityRecheck}
        </Button>
      </div>
      {!decision.eligible && decision.reasons && decision.reasons.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-medium">{t.eligibilityReasons}</p>
          <ul className="mt-1 list-disc ps-5 text-xs">
            {decision.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
