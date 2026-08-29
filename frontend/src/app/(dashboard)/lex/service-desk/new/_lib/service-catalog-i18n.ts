/**
 * Bilingual strings (EN / MSA AR) for the Step-1 service-catalog selector of the
 * "New Legal Request" wizard. Self-contained — the component resolves a string by
 * a simple `locale === 'ar' ? ar : en` ternary so it never depends on the global
 * message catalog. English is the effective default (anything that is not `'ar'`
 * renders the English copy).
 */
import type { AppLocale } from '@/lib/i18n';

/** One bilingual copy entry. */
export interface CatalogCopy {
  en: string;
  ar: string;
}

/** The full string table consumed by `ServiceCatalogStep`. */
export interface ServiceCatalogStrings {
  searchLabel: CatalogCopy;
  searchPlaceholder: CatalogCopy;
  recentlyUsed: CatalogCopy;
  cloneAffordance: CatalogCopy;
  approvalRequired: CatalogCopy;
  channelPlatform: CatalogCopy;
  channelEmail: CatalogCopy;
  channelBoth: CatalogCopy;
  codeLabel: CatalogCopy;
  selectedLabel: CatalogCopy;
  /** Empty-search state. `{query}` is substituted with the search term. */
  noMatches: CatalogCopy;
  /** Title for the no-matches block (Feature 9). */
  noMatchesTitle: CatalogCopy;
  /** Rendered when the parent passes an empty `services` array. */
  emptyCatalog: CatalogCopy;
  /** Title for the empty-catalog block (Feature 9). */
  emptyCatalogTitle: CatalogCopy;
  selectInstruction: CatalogCopy;
  /** Corner pill for recommended service types (Feature 6). */
  recommended: CatalogCopy;
  /** Audience meta badge when `available_to` is empty (Feature 4). */
  audienceAny: CatalogCopy;
  /** Audience meta badge for N entities (Feature 4). `{count}` substituted. */
  audienceCount: CatalogCopy;
  /** SLA meta badge (Feature 4). `{days}` substituted. */
  slaTarget: CatalogCopy;
  /** Derived pre-screen badge when eligibility rules exist (Feature 8). */
  eligibilityApplies: CatalogCopy;
}

const STRINGS: ServiceCatalogStrings = {
  searchLabel: { en: 'Search services', ar: 'البحث عن الخدمات' },
  searchPlaceholder: {
    en: 'Search by name, description, or code',
    ar: 'ابحث بالاسم أو الوصف أو الرمز',
  },
  recentlyUsed: { en: 'Recently used', ar: 'المستخدمة مؤخرًا' },
  cloneAffordance: {
    en: 'Clone from a previous request',
    ar: 'استنساخ من طلب سابق',
  },
  approvalRequired: { en: 'Approval required', ar: 'تتطلب موافقة' },
  channelPlatform: { en: 'Platform', ar: 'المنصة' },
  channelEmail: { en: 'Email', ar: 'البريد الإلكتروني' },
  channelBoth: { en: 'Platform & email', ar: 'المنصة والبريد' },
  codeLabel: { en: 'Code', ar: 'الرمز' },
  selectedLabel: { en: 'Selected', ar: 'محدد' },
  noMatches: {
    en: 'No services match “{query}”.',
    ar: 'لا توجد خدمات تطابق «{query}».',
  },
  noMatchesTitle: { en: 'No matching services', ar: 'لا توجد خدمات مطابقة' },
  emptyCatalog: {
    en: 'No services are available.',
    ar: 'لا توجد خدمات متاحة.',
  },
  emptyCatalogTitle: { en: 'No services available', ar: 'لا توجد خدمات متاحة' },
  selectInstruction: {
    en: 'Select the legal service you need.',
    ar: 'اختر الخدمة القانونية التي تحتاجها.',
  },
  recommended: { en: 'Recommended', ar: 'موصى به' },
  audienceAny: { en: 'Any requester', ar: 'متاحة للجميع' },
  audienceCount: { en: '{count} entities', ar: '{count} جهات' },
  slaTarget: { en: 'Target: {days} working days', ar: 'المستهدف: {days} يوم عمل' },
  eligibilityApplies: { en: 'Eligibility applies', ar: 'تنطبق شروط الأهلية' },
};

/**
 * resolveCatalogCopy returns the localized string for `key` in `locale`. English
 * is the default — any locale other than `'ar'` renders the English copy.
 */
export function resolveCatalogCopy(
  key: keyof ServiceCatalogStrings,
  locale: AppLocale,
): string {
  const entry = STRINGS[key];
  return locale === 'ar' ? entry.ar : entry.en;
}

/** Convenience accessor that returns the whole table (e.g. for tests). */
export function getCatalogStrings(): ServiceCatalogStrings {
  return STRINGS;
}
