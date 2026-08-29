/**
 * Bilingual labels for the RequesterField component (improvement #1: auto-fill
 * requester). EN is the default; AR is professional Modern Standard Arabic.
 *
 * Resolve via:
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? requesterLabels.ar : requesterLabels.en;
 */
export interface RequesterLabels {
  /** Section label rendered above the identity chip / input. */
  fieldLabel: string;
  /** Caption clarifying that the request is submitted as the current user. */
  submittingAsYou: string;
  /** Toggle prompt for delegating the request on behalf of another person. */
  onBehalfToggle: string;
  /** Placeholder for the free-text requester name input (on-behalf mode). */
  onBehalfPlaceholder: string;
  /** Label for the input shown in on-behalf mode. */
  onBehalfInputLabel: string;
  /** Muted attribution line shown in on-behalf mode; receives the auth user. */
  submittedBy: (me: string) => string;
  /** Small badge text on the read-only identity chip. */
  youBadge: string;
  /** Accessible label describing the requester avatar. */
  avatarAlt: (name: string) => string;
  /** Fallback field label when no authenticated user is available. */
  fallbackLabel: string;
  /** Fallback input placeholder when no authenticated user is available. */
  fallbackPlaceholder: string;
}

export const requesterLabels: { en: RequesterLabels; ar: RequesterLabels } = {
  en: {
    fieldLabel: 'Requester',
    submittingAsYou: 'Submitting this request as yourself.',
    onBehalfToggle: 'Acting on behalf of someone else?',
    onBehalfPlaceholder: "Enter the requester's full name",
    onBehalfInputLabel: 'Requester full name',
    submittedBy: (me) => `Submitted by ${me}`,
    youBadge: 'You',
    avatarAlt: (name) => `Avatar for ${name}`,
    fallbackLabel: 'Requester name',
    fallbackPlaceholder: "Enter the requester's full name",
  },
  ar: {
    fieldLabel: 'مُقدِّم الطلب',
    submittingAsYou: 'يتم تقديم هذا الطلب باسمك.',
    onBehalfToggle: 'هل تتصرف نيابةً عن شخص آخر؟',
    onBehalfPlaceholder: 'أدخل الاسم الكامل لمُقدِّم الطلب',
    onBehalfInputLabel: 'الاسم الكامل لمُقدِّم الطلب',
    submittedBy: (me) => `مُقدَّم بواسطة ${me}`,
    youBadge: 'أنت',
    avatarAlt: (name) => `الصورة الرمزية لـ ${name}`,
    fallbackLabel: 'اسم مُقدِّم الطلب',
    fallbackPlaceholder: 'أدخل الاسم الكامل لمُقدِّم الطلب',
  },
};
