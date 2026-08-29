import type { AppLocale } from '@/lib/i18n';

/**
 * Arabic display names for the well-known consultation tags (the seeded /
 * common legal categories shown in the tag filter). CUSTOM or user-authored
 * tags — Arabic or otherwise — fall through to their raw value, so nothing is
 * ever hidden or lost. Keyed by the normalized (trimmed, lowercased) tag slug.
 *
 * Only the DISPLAY is localized; the tag value sent to the filter / backend
 * stays the raw slug.
 */
const TAG_LABEL_AR: Record<string, string> = {
  tax: 'الضرائب',
  regulatory: 'الشؤون التنظيمية',
  procurement: 'المشتريات',
  labor: 'العمل',
  labour: 'العمل',
  hr: 'الموارد البشرية',
  governance: 'الحوكمة',
  corporate: 'الشركات',
  contracts: 'العقود',
  contract: 'العقود',
  compliance: 'الامتثال',
  litigation: 'التقاضي',
  disputes: 'المنازعات',
  employment: 'التوظيف',
  ip: 'الملكية الفكرية',
  finance: 'التمويل',
  banking: 'الأعمال المصرفية',
  policy: 'السياسات',
  'real-estate': 'العقارات',
  real_estate: 'العقارات',
  'data-privacy': 'خصوصية البيانات',
  data_privacy: 'خصوصية البيانات',
  'intellectual-property': 'الملكية الفكرية',
};

/**
 * Localized display label for a consultation tag. Returns the raw tag for the
 * English locale and for any tag without a known Arabic mapping (custom tags).
 */
export function consultationTagLabel(tag: string, locale: AppLocale): string {
  if (locale !== 'ar') return tag;
  return TAG_LABEL_AR[tag.trim().toLowerCase()] ?? tag;
}
