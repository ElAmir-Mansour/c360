/**
 * Per-kind display metadata for the admin/integrations console.
 *
 * Module-local on purpose: this is suite-specific console presentation and must
 * not touch the shared `@/lib/i18n/messages` catalog (the integrator owns that).
 * It pairs the wire-level {@link IntegrationKind} enum (from
 * `@/lib/lex/integrations`) with what the grouped-by-kind card list and the
 * detail header need to render: a bilingual display name, a one-line bilingual
 * blurb, a lucide icon, an accent color, and the gov-gated flag.
 *
 * Icons are referenced as {@link LucideIcon} components (not strings) so the
 * consuming component can render `<Icon />` directly — mirroring how the rest of
 * the admin uses `lucide-react`.
 *
 * Gov-gated kinds (najiz, nafath_verify, esign) require Saudi government / TSP
 * onboarding (MoJ Takamul, Nafath, emdha) before they can go live; the console
 * surfaces a "gov-gated" badge + onboarding banner for these.
 */
import {
  Landmark,
  Fingerprint,
  KeyRound,
  Users,
  Archive,
  Mail,
  FileSignature,
  Webhook,
  Blocks,
  Building2,
  type LucideIcon,
} from 'lucide-react';
import type { CatalogEntry, CatalogMaturity, IntegrationKind } from '@/lib/lex/integrations';
import { INTEGRATION_KINDS } from '@/lib/lex/integrations';
import type { LocalizedText } from '@/types/forms';

/** Display descriptor for one integration kind. */
export interface IntegrationKindMeta {
  kind: IntegrationKind;
  /** Bilingual display name ({ar, en}); resolve with `resolveLocalized`. */
  name: LocalizedText;
  /** Bilingual one-line description for the card subtitle. */
  blurb: LocalizedText;
  /** lucide-react icon component to render for this kind. */
  icon: LucideIcon;
  /**
   * Tailwind/HSL accent class hint for the card icon chip. Kept as a token-ish
   * class string so the card can tint without bespoke CSS.
   */
  accent: string;
  /**
   * True when the kind needs Saudi government / TSP onboarding before it can be
   * activated (MoJ Takamul / Nafath / emdha). Drives the "gov-gated" badge +
   * onboarding banner and a softer "planned until onboarded" affordance.
   */
  govGated: boolean;
}

/** Source-of-truth map: every wire kind has a display descriptor. */
export const INTEGRATION_KIND_META: Record<IntegrationKind, IntegrationKindMeta> = {
  najiz: {
    kind: 'najiz',
    name: { ar: 'ناجز (وزارة العدل)', en: 'Najiz (MoJ)' },
    blurb: {
      ar: 'بوابة التقاضي الإلكتروني عبر تكامل وزارة العدل؛ مزامنة الجلسات والقضايا.',
      en: 'MoJ Takamul e-litigation portal; hearing and case sync.',
    },
    icon: Landmark,
    accent: 'text-brand-primary-600 dark:text-brand-primary-400',
    govGated: true,
  },
  nafath_verify: {
    kind: 'nafath_verify',
    name: { ar: 'نفاذ (تأكيد الهوية)', en: 'Nafath (identity)' },
    blurb: {
      ar: 'تأكيد الهوية عبر نفاذ كأساس للتوقيع؛ نفاذ ليس جهة إصدار شهادات.',
      en: 'Nafath identity confirmation as an e-sign basis (not a CA).',
    },
    icon: Fingerprint,
    accent: 'text-brand-teal-700 dark:text-brand-teal-300',
    govGated: true,
  },
  sso: {
    kind: 'sso',
    name: { ar: 'الدخول الموحّد', en: 'Single Sign-On' },
    blurb: {
      ar: 'اتحاد OIDC/SAML وتزويد SCIM (Entra / Okta / Keycloak).',
      en: 'OIDC/SAML federation + SCIM provisioning (Entra / Okta / Keycloak).',
    },
    icon: KeyRound,
    accent: 'text-brand-accent-700 dark:text-brand-accent-300',
    govGated: false,
  },
  hr: {
    kind: 'hr',
    name: { ar: 'الموارد البشرية', en: 'HR / Identity' },
    blurb: {
      ar: 'تغذية نظام الموارد البشرية / الهوية لمزامنة المستخدمين والوحدات.',
      en: 'HR / identity feed for user and org-unit sync.',
    },
    icon: Users,
    accent: 'text-brand-primary-600 dark:text-brand-primary-400',
    govGated: false,
  },
  archiving: {
    kind: 'archiving',
    name: { ar: 'الأرشفة الإلكترونية', en: 'E-Archiving' },
    blurb: {
      ar: 'نظام السجلات / الأرشفة الإلكترونية؛ كتابة WORM داخل المملكة.',
      en: 'Records / e-archiving system; in-kingdom WORM writes.',
    },
    icon: Archive,
    accent: 'text-brand-teal-700 dark:text-brand-teal-300',
    govGated: false,
  },
  email: {
    kind: 'email',
    name: { ar: 'البريد الإلكتروني', en: 'Email' },
    blurb: {
      ar: 'استقبال البريد الوارد وإرسال البريد الصادر تحت سجل التكامل.',
      en: 'Inbound intake + outbound dispatch under the registry.',
    },
    icon: Mail,
    accent: 'text-brand-accent-700 dark:text-brand-accent-300',
    govGated: false,
  },
  esign: {
    kind: 'esign',
    name: { ar: 'التوقيع الإلكتروني', en: 'E-Signature' },
    blurb: {
      ar: 'التوقيع الإلكتروني (DocuSign / Adobe / محلي / إمضاء)؛ إمضاء وناجز مقيّدان حكوميًا.',
      en: 'E-signature (DocuSign / Adobe / native / emdha); emdha + Najiz gov-gated.',
    },
    icon: FileSignature,
    accent: 'text-brand-primary-600 dark:text-brand-primary-400',
    govGated: true,
  },
  internal: {
    kind: 'internal',
    name: { ar: 'نظام داخلي (REST)', en: 'Internal (REST)' },
    blurb: {
      ar: 'نقطة عامة لنظام داخلي / Webhook موقّع بـ HMAC.',
      en: 'Generic internal REST / HMAC-signed webhook catch-all.',
    },
    icon: Webhook,
    accent: 'text-neutral-600 dark:text-neutral-300',
    govGated: false,
  },
  custom: {
    kind: 'custom',
    name: { ar: 'موصّل مخصّص (REST)', en: 'Custom connector (REST)' },
    blurb: {
      ar: 'موصّل REST بدون برمجة: عنوان أساسي ومصادقة وطلب وربط استجابة وترقيم.',
      en: 'No-code REST connector: base URL, auth, request, response mapping, pagination.',
    },
    icon: Blocks,
    accent: 'text-brand-teal-700 dark:text-brand-teal-300',
    govGated: false,
  },
  yardi: {
    kind: 'yardi',
    name: { ar: 'ياردي (إدارة العقارات)', en: 'Yardi (Property Mgmt)' },
    blurb: {
      ar: 'موصّل ياردي Voyager لإدارة العقارات؛ مزامنة عقود الإيجار والعقارات وكتابة الملاحظات.',
      en: 'Yardi Voyager property-management ERP; lease + property sync and note write-back.',
    },
    icon: Building2,
    accent: 'text-brand-accent-700 dark:text-brand-accent-300',
    govGated: false,
  },
};

/** Ordered list of kind descriptors (matches INTEGRATION_KINDS order). */
export const INTEGRATION_KIND_LIST: readonly IntegrationKindMeta[] = INTEGRATION_KINDS.map(
  (k) => INTEGRATION_KIND_META[k],
);

/**
 * Look up a kind's descriptor, falling back to the `internal` descriptor for any
 * unknown value so the UI never renders a blank/crashing card.
 */
export function kindMeta(kind: string): IntegrationKindMeta {
  return INTEGRATION_KIND_META[kind as IntegrationKind] ?? INTEGRATION_KIND_META.internal;
}

/** Convenience: is this kind government / TSP gated? */
export function isGovGated(kind: string): boolean {
  return kindMeta(kind).govGated;
}

/* --------------------------------------------------------------------------- *
 * Catalog presentation. The catalog (GET /integrations/catalog) is the runtime
 * source of truth for maturity / prerequisites / callbacks / self-serve; these
 * helpers fold it together with the static per-kind display metadata so the
 * gallery + wizard can render even when the catalog is unavailable (it then
 * falls back to the static {@link INTEGRATION_KIND_LIST}).
 * --------------------------------------------------------------------------- */

/** A catalog entry joined with its display descriptor for the gallery. */
export interface CatalogCardModel extends IntegrationKindMeta {
  /** Catalog maturity (production | gov_gated); derived from govGated if absent. */
  maturity: CatalogMaturity;
  /** Whether a tenant admin can configure this without a manual onboarding gate. */
  selfServe: boolean;
  /** Saudi-context tags surfaced as chips (e.g. moj, nafath, pdpl). */
  ksaTags: string[];
  /** Ordered bilingual prerequisite checklist (may be empty). */
  prerequisites: LocalizedText[];
  /** Callback/redirect URL templates, label → URL template. */
  callbacks: Record<string, string>;
  /** True when this model came from the live catalog (vs. the static fallback). */
  fromCatalog: boolean;
}

/** Derive a maturity for a kind when the catalog does not supply one. */
export function maturityForKind(kind: string): CatalogMaturity {
  return kindMeta(kind).govGated ? 'gov_gated' : 'production';
}

/** Build one gallery card model from a live catalog entry. */
export function catalogCardFromEntry(entry: CatalogEntry): CatalogCardModel {
  const meta = kindMeta(entry.kind);
  return {
    ...meta,
    maturity: entry.maturity ?? maturityForKind(entry.kind),
    selfServe: entry.self_serve,
    ksaTags: Array.isArray(entry.ksa_tags) ? entry.ksa_tags : [],
    prerequisites: Array.isArray(entry.prerequisite_steps) ? entry.prerequisite_steps : [],
    callbacks: entry.callback_templates ?? {},
    fromCatalog: true,
  };
}

/** Static fallback gallery card model when the catalog is unavailable. */
export function catalogCardFallback(meta: IntegrationKindMeta): CatalogCardModel {
  return {
    ...meta,
    maturity: maturityForKind(meta.kind),
    selfServe: !meta.govGated,
    ksaTags: [],
    prerequisites: [],
    callbacks: {},
    fromCatalog: false,
  };
}

/**
 * Merge the live catalog with the static kind list into a stable, ordered set of
 * gallery cards. Catalog entries win; any kind absent from the catalog is added
 * from the static descriptors so the gallery is never thinner than the known
 * connector set. Order follows {@link INTEGRATION_KINDS}.
 */
export function buildCatalogCards(catalog: CatalogEntry[]): CatalogCardModel[] {
  const byKind = new Map<IntegrationKind, CatalogEntry>();
  for (const e of catalog) {
    if ((INTEGRATION_KINDS as readonly string[]).includes(e.kind)) byKind.set(e.kind, e);
  }
  return INTEGRATION_KIND_LIST.map((meta) => {
    const entry = byKind.get(meta.kind);
    return entry ? catalogCardFromEntry(entry) : catalogCardFallback(meta);
  });
}

/* --------------------------------------------------------------------------- *
 * Field mapper (Feature 4). The HR connector accepts a `field_mapping` config
 * object that maps a SOURCE field name → a lex identity attribute. These are the
 * canonical lex targets the point-and-click mapper offers.
 * --------------------------------------------------------------------------- */

/** Config key on the HR connector schema that holds the field_mapping object. */
export const HR_FIELD_MAPPING_KEY = 'field_mapping';

/** A lex identity attribute a source field can be mapped onto. */
export type LexMapTarget =
  | 'externalId'
  | 'displayName'
  | 'email'
  | 'manager'
  | 'department'
  | 'orgUnit';

/** Ordered lex mapping targets; `externalId` is required for matching. */
export const LEX_MAP_TARGETS: readonly { target: LexMapTarget; required: boolean }[] = [
  { target: 'externalId', required: true },
  { target: 'displayName', required: false },
  { target: 'email', required: false },
  { target: 'manager', required: false },
  { target: 'department', required: false },
  { target: 'orgUnit', required: false },
] as const;

/** Does this kind use the guided field mapper for its `field_mapping` field? */
export function usesFieldMapper(kind: string, fieldKey: string): boolean {
  return kind === 'hr' && fieldKey === HR_FIELD_MAPPING_KEY;
}

/**
 * Config key (#19) that holds the transform/filter pipeline (`sync_rules`). When
 * a connector schema exposes this field the dynamic form swaps the raw textarea
 * for the guided {@link import('../_components/rules-editor').RulesEditor}.
 */
export const SYNC_RULES_FIELD_KEY = 'sync_rules';

/** Does this field hold the sync-rules pipeline (rendered by the rules editor)? */
export function usesRulesEditor(fieldKey: string): boolean {
  return fieldKey === SYNC_RULES_FIELD_KEY;
}

/**
 * Config key (#20) for the non-secret mass-change deactivation ceiling (percent).
 * Surfaced as a plain number field; no special control is required.
 */
export const MASS_CHANGE_THRESHOLD_FIELD_KEY = 'mass_change_threshold_pct';

/** Sandbox/webhook capability hint per kind (presentational only). */
export function isSandboxCapable(kind: string): boolean {
  return kind === 'najiz' || kind === 'nafath_verify' || kind === 'yardi';
}

/**
 * Which kinds expose a Syncer (the wizard's "first sync" step + the connection
 * panel's "Sync now"). Mirrors the backend's sync-capable connector set; kept
 * here (alongside the other per-kind hints) so the wizard does not depend on the
 * detail unit's status-config module. Identity/verify/email/native esign kinds
 * are request/response, not batch-sync.
 */
export function isSyncCapableKind(kind: string): boolean {
  return (
    kind === 'najiz' ||
    kind === 'hr' ||
    kind === 'archiving' ||
    kind === 'internal' ||
    kind === 'yardi'
  );
}
