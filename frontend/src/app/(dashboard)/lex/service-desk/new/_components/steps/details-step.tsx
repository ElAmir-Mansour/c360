'use client';

/**
 * STEP 2 — Request Details.
 *
 * Restyled to the mockup ("Legal Service Request Specifications"): a white card
 * with a compact read-only requester line, a 2-column row (bilingual Request
 * Title | Requesting Department), the Description & Objective textarea with a
 * live 2000-char counter, a 2-column row (Priority & Response SLA pill-cards with
 * real SLA sub-labels | Requested Due Date), and an Additional Notes textarea.
 *
 * Every field stays controlled by `page.tsx`; the only local data fetch here is
 * the fail-soft SLA turnaround map used to label the priority cards. Bilingual /
 * RTL-correct via logical props.
 */

import { SectionCard } from '@/components/suites/section-card';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { DetailsStepProps } from '../../_lib/wizard-types';
import { useServiceSlaTargets } from '../../_lib/service-sla';
import RequesterField from '../requester-field';
import BilingualTitleFields from '../bilingual-title-fields';
import BeneficiaryPicker from '../beneficiary-picker';
import DescriptionField from '../description-field';
import PrioritySelector from '../priority-selector';
import { RequestedDueDateField, AdditionalNotesField } from '../extra-details-fields';

/**
 * Step-local copy (card heading + SLA sub-label formatting). English is the
 * default/fallback branch; Arabic is professional MSA (flag for the localization
 * gate). Kept local per the wizard contract — the shared labels module is not
 * touched to avoid collisions with the other step agents.
 */
const LOCAL = {
  en: {
    cardTitle: 'Request Details',
    selectedService: 'Legal Service',
    noService: 'No service selected',
    withinBusinessDays: (n: number) => `Within ${n} business days`,
    within24Hours: 'Within 24 hours',
  },
  ar: {
    cardTitle: 'تفاصيل الطلب',
    selectedService: 'الخدمة القانونية',
    noService: 'لم يتم اختيار خدمة',
    withinBusinessDays: (n: number) => `خلال ${n} أيام عمل`,
    within24Hours: 'خلال 24 ساعة',
  },
} as const;

export default function DetailsStep({
  selectedService,
  requesterName,
  onRequesterChange,
  beneficiary,
  onBeneficiaryChange,
  titleEn,
  titleAr,
  onTitleEnChange,
  onTitleArChange,
  description,
  onDescriptionChange,
  priority,
  onPriorityChange,
  urgency,
  onUrgencyChange,
  requestedDueDate,
  onDueDateChange,
  notes,
  onNotesChange,
  errors,
  disabled,
}: DetailsStepProps) {
  const { locale } = useLocaleOrDefault();
  const s = locale === 'ar' ? LOCAL.ar : LOCAL.en;
  const serviceName = selectedService
    ? resolveLocalized(selectedService.name, locale)
    : s.noService;

  // Fail-soft SLA turnaround days keyed by service code (403 for a plain
  // requester resolves to an empty map). When a real target exists we label the
  // priority card with it; otherwise we fall back to the mockup defaults.
  const { slaByCode } = useServiceSlaTargets();
  const sla = selectedService ? slaByCode.get(selectedService.code) : undefined;
  const slaHint = {
    normal: s.withinBusinessDays(sla?.normal ?? 5),
    urgent: s.withinBusinessDays(sla?.urgent ?? 3),
    emergency: s.within24Hours,
  };

  return (
    <SectionCard
      title={s.cardTitle}
      className="border-border"
      contentClassName="pt-0"
    >
      <div className="space-y-6 border-t border-border pt-6">
        {/* Preserve authenticated requester seeding in a compact governed row. */}
        <RequesterField
          value={requesterName}
          onChange={onRequesterChange}
          error={errors.requester}
        />

        {/* Figma first row: selected service type + relevant department. */}
        <div className="grid gap-5 md:grid-cols-2 md:items-start">
          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">{s.selectedService}</span>
            <div className="flex h-11 items-center rounded-lg border border-border bg-card px-3 text-sm text-foreground">
              <span className="truncate">{serviceName}</span>
            </div>
          </div>
          <BeneficiaryPicker
            value={beneficiary?.entityId}
            onChange={onBeneficiaryChange}
            error={errors.beneficiary}
            disabled={disabled}
          />
        </div>

        {/* Consultation subject / request title. */}
        <BilingualTitleFields
          titleEn={titleEn}
          titleAr={titleAr}
          onChangeEn={onTitleEnChange}
          onChangeAr={onTitleArChange}
          error={errors.title}
          disabled={disabled}
        />

        {/* Description & objective (live 2000-char counter). */}
        <DescriptionField
          value={description}
          onChange={onDescriptionChange}
          error={errors.description}
          serviceCode={selectedService?.request_type}
          disabled={disabled}
        />

        {/* Figma row: required due date beside the SLA priority choices. */}
        <div className="grid gap-5 lg:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)] lg:items-start">
          <RequestedDueDateField
            value={requestedDueDate}
            onChange={onDueDateChange}
            error={errors.requestedDueDate}
            disabled={disabled}
          />

          <PrioritySelector
            value={priority}
            onChange={onPriorityChange}
            urgency={urgency}
            onUrgencyChange={onUrgencyChange}
            urgencyError={errors.urgency}
            slaHint={slaHint}
          />
        </div>

        {/* Optional instructions sit after the required scheduling row. */}
        <AdditionalNotesField value={notes} onChange={onNotesChange} disabled={disabled} />
      </div>
    </SectionCard>
  );
}
