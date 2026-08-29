/**
 * Bilingual labels for the BeneficiaryPicker component (improvement #2: replace
 * the free-text "Department" input with an org-entity picker that drives
 * eligibility & routing).
 *
 * EN is the authoring default; AR is professional Modern Standard Arabic.
 *
 * Resolve via:
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? beneficiaryLabels.ar : beneficiaryLabels.en;
 */
export interface BeneficiaryLabels {
  /** Field label rendered above the picker. */
  fieldLabel: string;
  /** Accessible text for the required marker. */
  requiredA11y: string;
  /** Helper caption explaining the selection drives eligibility & routing. */
  helper: string;
  /** Combobox trigger placeholder when nothing is selected. */
  placeholder: string;
  /** Search-box placeholder inside the combobox popover. */
  searchPlaceholder: string;
  /** Accessible label for the picker control. */
  ariaLabel: string;
  /** Caption shown beneath the chosen entity, prefixing its code. */
  codeLabel: string;
  /** Hint shown when the org registry returned zero entities. */
  emptyHint: string;
  /** Error state when the entity registry failed to load. */
  loadError: string;
  /** Bilingual display names for each org entity type, used by the type Badge. */
  entityType: {
    company: string;
    business_unit: string;
    department: string;
    section: string;
    shared_services_unit: string;
  };
}

export const beneficiaryLabels: { en: BeneficiaryLabels; ar: BeneficiaryLabels } = {
  en: {
    fieldLabel: 'Beneficiary department / entity',
    requiredA11y: 'required',
    helper: 'This drives eligibility and routing for the request.',
    placeholder: 'Select a beneficiary department or entity',
    searchPlaceholder: 'Search by name or code…',
    ariaLabel: 'Beneficiary department or entity',
    codeLabel: 'Code',
    emptyHint:
      'The organization registry has no entities yet. Ask an administrator to add departments or entities before requesting.',
    loadError: 'Could not load the organization registry. Please try again.',
    entityType: {
      company: 'Company',
      business_unit: 'Business unit',
      department: 'Department',
      section: 'Section',
      shared_services_unit: 'Shared services unit',
    },
  },
  ar: {
    fieldLabel: 'الجهة / الإدارة المستفيدة',
    requiredA11y: 'مطلوب',
    helper: 'يحدِّد هذا الاختيار الأهلية وتوجيه الطلب.',
    placeholder: 'اختر الإدارة أو الجهة المستفيدة',
    searchPlaceholder: 'ابحث بالاسم أو الرمز…',
    ariaLabel: 'الجهة أو الإدارة المستفيدة',
    codeLabel: 'الرمز',
    emptyHint:
      'لا توجد جهات في سجل المؤسسة بعد. يرجى من المسؤول إضافة الإدارات أو الجهات قبل تقديم الطلب.',
    loadError: 'تعذَّر تحميل سجل المؤسسة. يرجى المحاولة مرة أخرى.',
    entityType: {
      company: 'شركة',
      business_unit: 'وحدة أعمال',
      department: 'إدارة',
      section: 'قسم',
      shared_services_unit: 'وحدة خدمات مشتركة',
    },
  },
};
