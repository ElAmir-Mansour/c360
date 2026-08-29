/**
 * Bilingual (English + Modern Standard Arabic) labels for the org-entity
 * custom-attributes / metadata master-data surface.
 *
 * Consumed by the controlled editor, the read-only panel, and the table-column
 * factory. The contract is intentionally the simple `{ en, ar }` bundle the
 * feature brief mandates — resolve with:
 *
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? metadataLabels.ar : metadataLabels.en;
 *
 * Both sides are FULL, same-shaped copies. `en` is the canonical English copy;
 * `ar` is professional MSA. Field labels live here (single source of truth) so
 * the schema can stay locale-agnostic and the editor/panel/columns all read the
 * same resolved strings. Western digits are preserved on both sides.
 *
 * Glossary: cost center = مركز التكلفة, GL code = رمز دفتر الأستاذ,
 * region = المنطقة, governorate = المحافظة/الإمارة, headcount = عدد الموظفين,
 * commercial registration = السجل التجاري, VAT = ضريبة القيمة المضافة,
 * manager = المدير, attribute = سمة, master data = البيانات الرئيسية.
 */
import type { AppLocale } from '@/lib/i18n';
import type { OrgMetadataFieldKey } from './org-metadata-schema';
import { SAUDI_GOVERNORATE_KEYS, type SaudiGovernorateKey } from './org-metadata-schema';

export interface OrgMetadataLabels {
  /** Section heading + helper copy for the editor's "Attributes" group. */
  editor: {
    sectionTitle: string;
    sectionDescription: string;
    schemaGroupLabel: string;
    customGroupLabel: string;
    customGroupDescription: string;
    addAttribute: string;
    removeAttribute: string;
    keyPlaceholder: string;
    valuePlaceholder: string;
    keyHeader: string;
    valueHeader: string;
    duplicateKeyWarning: string;
    reservedKeyWarning: string;
    emptyCustom: string;
  };
  /** Read-only panel copy. */
  panel: {
    additionalTitle: string;
    empty: string;
  };
  /** Per-field label resolved by schema key. */
  fields: Record<OrgMetadataFieldKey, string>;
  /** Per-field placeholder (optional usage). */
  placeholders: Partial<Record<OrgMetadataFieldKey, string>>;
  /** Inline soft-validation warning text (amber, non-blocking). */
  warnings: {
    crNumber: string;
    vatNumber: string;
    managerEmail: string;
    headcount: string;
  };
  /** Bilingual governorate option labels. */
  governorates: Record<SaudiGovernorateKey, string>;
  /** Column header copy keyed by schema field key (used by the table factory). */
  columns: Partial<Record<OrgMetadataFieldKey, string>>;
}

const en: OrgMetadataLabels = {
  editor: {
    sectionTitle: 'Attributes',
    sectionDescription:
      'Master-data attributes for this legal-org entity. Format hints are advisory and never block saving.',
    schemaGroupLabel: 'Standard attributes',
    customGroupLabel: 'Free-form attributes',
    customGroupDescription: 'Additional ad-hoc key/value pairs outside the standard schema.',
    addAttribute: 'Add attribute',
    removeAttribute: 'Remove attribute',
    keyPlaceholder: 'attribute_key',
    valuePlaceholder: 'Value',
    keyHeader: 'Key',
    valueHeader: 'Value',
    duplicateKeyWarning: 'Duplicate key — only the last value is kept.',
    reservedKeyWarning: 'This key is a standard attribute; edit it above instead.',
    emptyCustom: 'No free-form attributes yet.',
  },
  panel: {
    additionalTitle: 'Additional attributes',
    empty: 'No attributes set.',
  },
  fields: {
    cost_center: 'Cost center',
    gl_code: 'GL code',
    region: 'Region',
    governorate: 'Governorate',
    headcount: 'Headcount',
    cr_number: 'Commercial registration (CR)',
    vat_number: 'VAT number',
    manager_email: 'Manager email',
    external_ids: 'External IDs',
  },
  placeholders: {
    cost_center: 'e.g. CC-1042',
    gl_code: 'e.g. 5100-200',
    region: 'e.g. Central',
    headcount: '0',
    cr_number: '10 digits',
    vat_number: '15 digits',
    manager_email: 'name@example.com',
    external_ids: 'Comma-separated external identifiers',
  },
  warnings: {
    crNumber: 'Commercial registration is usually 10 digits.',
    vatNumber: 'VAT number is usually 15 digits.',
    managerEmail: 'This does not look like a valid email address.',
    headcount: 'Headcount should be a non-negative whole number.',
  },
  governorates: {
    riyadh: 'Riyadh',
    makkah: 'Makkah',
    madinah: 'Madinah',
    eastern_province: 'Eastern Province',
    asir: 'Asir',
    tabuk: 'Tabuk',
    hail: 'Hail',
    northern_borders: 'Northern Borders',
    jazan: 'Jazan',
    najran: 'Najran',
    al_bahah: 'Al-Bahah',
    al_jawf: 'Al-Jawf',
    qassim: 'Qassim',
  },
  columns: {
    cost_center: 'Cost center',
    governorate: 'Governorate',
    cr_number: 'CR number',
  },
};

const ar: OrgMetadataLabels = {
  editor: {
    sectionTitle: 'السمات',
    sectionDescription:
      'سمات البيانات الرئيسية لهذه الجهة التنظيمية القانونية. تلميحات الصيغة استرشادية ولا تمنع الحفظ.',
    schemaGroupLabel: 'السمات القياسية',
    customGroupLabel: 'سمات حرة',
    customGroupDescription: 'أزواج مفتاح/قيمة إضافية خارج المخطط القياسي.',
    addAttribute: 'إضافة سمة',
    removeAttribute: 'إزالة السمة',
    keyPlaceholder: 'مفتاح_السمة',
    valuePlaceholder: 'القيمة',
    keyHeader: 'المفتاح',
    valueHeader: 'القيمة',
    duplicateKeyWarning: 'مفتاح مكرر — يُحتفظ بالقيمة الأخيرة فقط.',
    reservedKeyWarning: 'هذا المفتاح سمة قياسية؛ عدّله بالأعلى بدلاً من ذلك.',
    emptyCustom: 'لا توجد سمات حرة بعد.',
  },
  panel: {
    additionalTitle: 'سمات إضافية',
    empty: 'لم تُضبط أي سمات.',
  },
  fields: {
    cost_center: 'مركز التكلفة',
    gl_code: 'رمز دفتر الأستاذ',
    region: 'المنطقة',
    governorate: 'المحافظة',
    headcount: 'عدد الموظفين',
    cr_number: 'السجل التجاري',
    vat_number: 'الرقم الضريبي',
    manager_email: 'البريد الإلكتروني للمدير',
    external_ids: 'المعرّفات الخارجية',
  },
  placeholders: {
    cost_center: 'مثال: CC-1042',
    gl_code: 'مثال: 5100-200',
    region: 'مثال: المنطقة الوسطى',
    headcount: '0',
    cr_number: '10 أرقام',
    vat_number: '15 رقمًا',
    manager_email: 'name@example.com',
    external_ids: 'معرّفات خارجية مفصولة بفواصل',
  },
  warnings: {
    crNumber: 'السجل التجاري عادةً يتكوّن من 10 أرقام.',
    vatNumber: 'الرقم الضريبي عادةً يتكوّن من 15 رقمًا.',
    managerEmail: 'لا يبدو هذا بريدًا إلكترونيًا صالحًا.',
    headcount: 'عدد الموظفين يجب أن يكون رقمًا صحيحًا غير سالب.',
  },
  governorates: {
    riyadh: 'الرياض',
    makkah: 'مكة المكرمة',
    madinah: 'المدينة المنورة',
    eastern_province: 'المنطقة الشرقية',
    asir: 'عسير',
    tabuk: 'تبوك',
    hail: 'حائل',
    northern_borders: 'الحدود الشمالية',
    jazan: 'جازان',
    najran: 'نجران',
    al_bahah: 'الباحة',
    al_jawf: 'الجوف',
    qassim: 'القصيم',
  },
  columns: {
    cost_center: 'مركز التكلفة',
    governorate: 'المحافظة',
    cr_number: 'السجل التجاري',
  },
};

export const metadataLabels: { en: OrgMetadataLabels; ar: OrgMetadataLabels } = { en, ar };

/** Resolve the label bundle for a locale (default English on any non-`ar`). */
export function resolveMetadataLabels(locale: AppLocale): OrgMetadataLabels {
  return locale === 'ar' ? ar : en;
}

/** Convenience: governorate option list for the SELECT, in canonical order. */
export function governorateOptions(
  labels: OrgMetadataLabels,
): { value: SaudiGovernorateKey; label: string }[] {
  return SAUDI_GOVERNORATE_KEYS.map((value) => ({ value, label: labels.governorates[value] }));
}
