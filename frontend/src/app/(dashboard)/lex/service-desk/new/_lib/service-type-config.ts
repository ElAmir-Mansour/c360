/**
 * Visual + taxonomic configuration for the Lex "New Legal Request" service
 * catalog, derived purely from a service's `request_type` token.
 *
 * The backend {@link ServiceCatalogEntry} carries no icon/colour/category/SLA
 * field, so the Step-1 picker (improvements #1, #3, #6) derives its visual
 * identity here: an icon + {@link IconBadge} tone per service type, a coarse
 * category bucket for section grouping, and bilingual (EN / MSA AR) labels for
 * both the request-type and the category headers.
 *
 * Pure module: no React, no I/O, no JSX. The only React-adjacent import is the
 * `LucideIcon` *type*, so this stays referentially transparent and trivially
 * unit-testable. Every lookup is total — unmapped tokens fall back to a safe
 * neutral config so a future/extra `request_type` never breaks the render.
 *
 * The eight canonical tokens mirror lex migration `000022_service_catalog_intake`
 * (and {@link LEGAL_SERVICE_CODES} in `@/lib/lex/requests`):
 *   legal_consultation, contract_review, contract_drafting, litigation_support,
 *   legal_opinion, regulatory_compliance, power_of_attorney, general_legal_request.
 */
import {
  Briefcase,
  FilePen,
  FileSearch,
  MessagesSquare,
  Scale,
  ScrollText,
  ShieldCheck,
  Stamp,
  type LucideIcon,
} from 'lucide-react';
import type { ServiceCatalogEntry } from '@/lib/lex/requests';
import type { AppLocale } from '@/lib/i18n';

/* -------------------------------------------------------------------------- *
 * Tones & categories.
 * -------------------------------------------------------------------------- */

/**
 * ServiceTone is the visual tone for a service's icon tile. The union is kept
 * 1:1 with the {@link IconBadge} `tone` cva variant so a tone can be passed
 * straight through to `<IconBadge tone={...} />` with no mapping.
 */
export type ServiceTone =
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'muted';

/**
 * ServiceCategoryId is the coarse bucket a service type rolls up into for the
 * catalog's section grouping. `other` is the catch-all for the general /
 * unmapped request types.
 */
export type ServiceCategoryId =
  | 'contracts'
  | 'advisory'
  | 'disputes'
  | 'compliance'
  | 'other';

/**
 * ServiceTypeConfig is the derived presentation + taxonomy for one
 * `request_type`: the icon to render in the card's tile, its {@link ServiceTone},
 * the {@link ServiceCategoryId} it groups under, and an optional `recommended`
 * flag the picker may use to highlight the most common entry points.
 */
export interface ServiceTypeConfig {
  /** Lucide icon for the card's icon tile (decorative; render `aria-hidden`). */
  icon: LucideIcon;
  /** {@link IconBadge}-compatible tone for the icon tile. */
  tone: ServiceTone;
  /** Coarse category this service type groups under. */
  category: ServiceCategoryId;
  /** When `true`, the picker may surface this type as a recommended choice. */
  recommended?: boolean;
}

/* -------------------------------------------------------------------------- *
 * request_type → config.
 * -------------------------------------------------------------------------- */

/**
 * Safe neutral config returned for any `request_type` not in
 * {@link SERVICE_TYPE_CONFIG} (and the literal mapping for `general_legal_request`).
 */
const FALLBACK_CONFIG: ServiceTypeConfig = {
  icon: Briefcase,
  tone: 'muted',
  category: 'other',
};

/**
 * SERVICE_TYPE_CONFIG maps each canonical `request_type` token to its derived
 * {@link ServiceTypeConfig}. Keyed by the raw backend token (snake_case). Tokens
 * not present here resolve to {@link FALLBACK_CONFIG} via
 * {@link getServiceTypeConfig}.
 */
export const SERVICE_TYPE_CONFIG: Record<string, ServiceTypeConfig> = {
  legal_consultation: {
    icon: MessagesSquare,
    tone: 'info',
    category: 'advisory',
    recommended: true,
  },
  legal_opinion: {
    icon: Stamp,
    tone: 'info',
    category: 'advisory',
  },
  contract_review: {
    icon: FileSearch,
    tone: 'primary',
    category: 'contracts',
    recommended: true,
  },
  contract_drafting: {
    icon: FilePen,
    tone: 'primary',
    category: 'contracts',
  },
  litigation_support: {
    icon: Scale,
    tone: 'danger',
    category: 'disputes',
  },
  regulatory_compliance: {
    icon: ShieldCheck,
    tone: 'warning',
    category: 'compliance',
  },
  power_of_attorney: {
    icon: ScrollText,
    tone: 'success',
    category: 'compliance',
  },
  general_legal_request: {
    icon: Briefcase,
    tone: 'muted',
    category: 'other',
  },

  // ── Aliases for the tokens the live backend actually emits ────────────────
  // `/api/v1/lex/legal-requests` returns `consultation`, `litigation`,
  // `investigation` and `enforcement`. Without these the lookup fell through to
  // FALLBACK_CONFIG (generic briefcase, muted, "other"), so these services were
  // mis-grouped and lost their icon. Safe to alias: the catalog renders from the
  // backend service list and uses this map purely as a lookup, so extra keys
  // never produce duplicate cards.
  consultation: {
    icon: MessagesSquare,
    tone: 'info',
    category: 'advisory',
    recommended: true,
  },
  litigation: {
    icon: Scale,
    tone: 'danger',
    category: 'disputes',
  },
  investigation: {
    icon: FileSearch,
    tone: 'warning',
    category: 'disputes',
  },
  enforcement: {
    icon: Scale,
    tone: 'danger',
    category: 'disputes',
  },
};

/**
 * getServiceTypeConfig returns the {@link ServiceTypeConfig} for `requestType`,
 * or the safe neutral fallback (Briefcase / muted / other) for any token not in
 * {@link SERVICE_TYPE_CONFIG}. Total — never throws, always returns a config.
 */
export function getServiceTypeConfig(requestType: string): ServiceTypeConfig {
  return SERVICE_TYPE_CONFIG[requestType] ?? FALLBACK_CONFIG;
}

/* -------------------------------------------------------------------------- *
 * Bilingual labels.
 * -------------------------------------------------------------------------- */

/** A bilingual EN / MSA-AR label pair. */
export interface BilingualLabel {
  en: string;
  ar: string;
}

/**
 * REQUEST_TYPE_LABELS holds the bilingual (EN / MSA AR) display label for each
 * canonical `request_type`, so group/section headers are localized from a
 * curated table rather than a mechanical `humanizeRequestType` of the token.
 * Arabic copy is grounded in the migration-seeded service names.
 */
export const REQUEST_TYPE_LABELS: Record<string, BilingualLabel> = {
  legal_consultation: { en: 'Legal consultation', ar: 'استشارة قانونية' },
  legal_opinion: { en: 'Legal opinion', ar: 'رأي قانوني' },
  contract_review: { en: 'Contract review', ar: 'مراجعة عقد' },
  contract_drafting: { en: 'Contract drafting', ar: 'صياغة عقد' },
  litigation_support: { en: 'Litigation support', ar: 'دعم التقاضي' },
  regulatory_compliance: { en: 'Regulatory compliance', ar: 'الامتثال التنظيمي' },
  power_of_attorney: { en: 'Power of attorney', ar: 'توكيل' },
  general_legal_request: { en: 'General legal request', ar: 'طلب قانوني عام' },

  // Aliases for the tokens the live backend emits. Arabic is reused VERBATIM
  // from the service-desk enum bundle (`lex-enums-i18n.ts` serviceType) so the
  // two surfaces can never drift. Without these, `resolveRequestTypeLabel` fell
  // through to `humanizeToken`, which renders ENGLISH even in the Arabic UI.
  consultation: { en: 'Legal consultation', ar: 'استشارة قانونية' },
  litigation: { en: 'Litigation', ar: 'التقاضي' },
  investigation: { en: 'Investigation', ar: 'تحقيق' },
  enforcement: { en: 'Enforcement', ar: 'تنفيذ' },
};

/**
 * resolveRequestTypeLabel returns the localized label for `requestType`. Unknown
 * tokens fall back to a humanized form of the raw token (separators collapsed,
 * sentence-cased) so the header is never empty or a snake_case string.
 */
export function resolveRequestTypeLabel(
  requestType: string,
  locale: AppLocale,
): string {
  const label = REQUEST_TYPE_LABELS[requestType];
  if (label) {
    return locale === 'ar' ? label.ar : label.en;
  }
  return humanizeToken(requestType);
}

/* -------------------------------------------------------------------------- *
 * Categories + grouping.
 * -------------------------------------------------------------------------- */

/**
 * One catalog category: a stable {@link ServiceCategoryId} and its bilingual
 * (EN / MSA AR) header label.
 */
export interface ServiceCategory {
  id: ServiceCategoryId;
  labels: BilingualLabel;
}

/**
 * SERVICE_CATEGORIES is the ordered list of catalog categories. The order here
 * is the render order for {@link groupServicesByCategory} — contracts and
 * advisory lead (the highest-volume entry points), with `other` last.
 */
export const SERVICE_CATEGORIES: readonly ServiceCategory[] = [
  { id: 'contracts', labels: { en: 'Contracts', ar: 'العقود' } },
  { id: 'advisory', labels: { en: 'Advisory', ar: 'الاستشارات' } },
  { id: 'disputes', labels: { en: 'Disputes & litigation', ar: 'المنازعات والتقاضي' } },
  { id: 'compliance', labels: { en: 'Compliance & authority', ar: 'الامتثال والتوكيلات' } },
  { id: 'other', labels: { en: 'Other', ar: 'أخرى' } },
];

/**
 * One materialized category bucket: the category's id + bilingual labels and the
 * services that fall under it (input order preserved within the bucket).
 */
export interface ServiceCategoryGroup {
  id: ServiceCategoryId;
  labels: BilingualLabel;
  items: ServiceCatalogEntry[];
}

/**
 * groupServicesByCategory buckets `services` by the {@link ServiceCategoryId} of
 * each service's `request_type` (via {@link getServiceTypeConfig}), emitting the
 * buckets in {@link SERVICE_CATEGORIES} order and dropping empty categories.
 * Item order within a bucket follows the input order. Stable and deterministic.
 */
export function groupServicesByCategory(
  services: ServiceCatalogEntry[],
): ServiceCategoryGroup[] {
  const buckets = new Map<ServiceCategoryId, ServiceCatalogEntry[]>();

  for (const service of services) {
    const { category } = getServiceTypeConfig(service.request_type);
    const bucket = buckets.get(category);
    if (bucket) {
      bucket.push(service);
    } else {
      buckets.set(category, [service]);
    }
  }

  const groups: ServiceCategoryGroup[] = [];
  for (const category of SERVICE_CATEGORIES) {
    const items = buckets.get(category.id);
    if (items && items.length > 0) {
      groups.push({ id: category.id, labels: category.labels, items });
    }
  }
  return groups;
}

/* -------------------------------------------------------------------------- *
 * Internal.
 * -------------------------------------------------------------------------- */

/**
 * humanizeToken turns a raw token like `contract_review` into a sentence-cased
 * `Contract review`. Mirrors the catalog utils' humanizer so the fallback header
 * reads identically. Separators (`_`, `-`, whitespace) collapse to single spaces
 * and only the first character is capitalized.
 */
function humanizeToken(token: string): string {
  const cleaned = token.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) {
    return '';
  }
  const lower = cleaned.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
