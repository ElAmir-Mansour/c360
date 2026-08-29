/**
 * Typed field schema for the org-entity custom-attributes / metadata master-data
 * surface, plus the 13 Saudi administrative regions and soft (non-blocking)
 * format validators.
 *
 * This module is locale-agnostic: it carries only stable machine keys + types +
 * validators. Human-facing labels live in `org-metadata-i18n.ts` and are keyed
 * by these same keys, so the editor, panel, and table-column factory all share
 * one source of truth.
 *
 * The entity `metadata` map is `Record<string, unknown>`. Schema fields read and
 * write `metadata[key]` directly; everything else is treated as free-form.
 */

/* --------------------------------------------------------------------------- *
 * Saudi administrative regions (the 13 "governorate"/region options).
 * Stable machine keys; bilingual display labels live in the i18n bundle.
 * --------------------------------------------------------------------------- */

export const SAUDI_GOVERNORATE_KEYS = [
  'riyadh',
  'makkah',
  'madinah',
  'eastern_province',
  'asir',
  'tabuk',
  'hail',
  'northern_borders',
  'jazan',
  'najran',
  'al_bahah',
  'al_jawf',
  'qassim',
] as const;

export type SaudiGovernorateKey = (typeof SAUDI_GOVERNORATE_KEYS)[number];

const GOVERNORATE_KEY_SET = new Set<string>(SAUDI_GOVERNORATE_KEYS);

export function isSaudiGovernorateKey(value: unknown): value is SaudiGovernorateKey {
  return typeof value === 'string' && GOVERNORATE_KEY_SET.has(value);
}

/* --------------------------------------------------------------------------- *
 * Field schema.
 * --------------------------------------------------------------------------- */

export type OrgMetadataFieldType = 'text' | 'email' | 'number' | 'select';

export const ORG_METADATA_FIELD_KEYS = [
  'cost_center',
  'gl_code',
  'region',
  'governorate',
  'headcount',
  'cr_number',
  'vat_number',
  'manager_email',
  'external_ids',
] as const;

export type OrgMetadataFieldKey = (typeof ORG_METADATA_FIELD_KEYS)[number];

export interface OrgMetadataField {
  /** Stable metadata map key (also the i18n label key). */
  key: OrgMetadataFieldKey;
  /** Input rendering type. */
  type: OrgMetadataFieldType;
  /**
   * Soft validator: returns `true` when the value looks well-formed (or is
   * empty), `false` when the format looks off. NEVER blocks — the editor only
   * surfaces an advisory amber warning. Absent ⇒ no validation.
   */
  validate?: (raw: unknown) => boolean;
  /** Which `warnings.*` key in the i18n bundle to show when `validate` fails. */
  warningKey?: 'crNumber' | 'vatNumber' | 'managerEmail' | 'headcount';
}

/** Set membership test for "is this key part of the standard schema?". */
const FIELD_KEY_SET = new Set<string>(ORG_METADATA_FIELD_KEYS);

export function isSchemaKey(key: string): key is OrgMetadataFieldKey {
  return FIELD_KEY_SET.has(key);
}

/* --------------------------------------------------------------------------- *
 * Soft validators (advisory only — empty is always "valid").
 * --------------------------------------------------------------------------- */

const DIGITS_ONLY = /^\d+$/;
// Pragmatic email shape; deliberately permissive (advisory, not gatekeeping).
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isBlank(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

function asTrimmedString(raw: unknown): string {
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : '';
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Saudi Commercial Registration: soft rule — exactly 10 digits. */
export function isValidCrNumber(raw: unknown): boolean {
  if (isBlank(raw)) return true;
  const s = asTrimmedString(raw);
  return DIGITS_ONLY.test(s) && s.length === 10;
}

/** Saudi VAT number: soft rule — exactly 15 digits. */
export function isValidVatNumber(raw: unknown): boolean {
  if (isBlank(raw)) return true;
  const s = asTrimmedString(raw);
  return DIGITS_ONLY.test(s) && s.length === 15;
}

/** Pragmatic email shape check (advisory). */
export function isValidEmailShape(raw: unknown): boolean {
  if (isBlank(raw)) return true;
  return EMAIL_SHAPE.test(asTrimmedString(raw));
}

/** Headcount: non-negative whole number when present. */
export function isValidHeadcount(raw: unknown): boolean {
  if (isBlank(raw)) return true;
  const s = asTrimmedString(raw);
  if (!DIGITS_ONLY.test(s)) return false;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0;
}

/* --------------------------------------------------------------------------- *
 * The schema itself (ordered for rendering).
 * --------------------------------------------------------------------------- */

export const ORG_METADATA_SCHEMA: readonly OrgMetadataField[] = [
  { key: 'cost_center', type: 'text' },
  { key: 'gl_code', type: 'text' },
  { key: 'region', type: 'text' },
  { key: 'governorate', type: 'select' },
  { key: 'headcount', type: 'number', validate: isValidHeadcount, warningKey: 'headcount' },
  { key: 'cr_number', type: 'text', validate: isValidCrNumber, warningKey: 'crNumber' },
  { key: 'vat_number', type: 'text', validate: isValidVatNumber, warningKey: 'vatNumber' },
  { key: 'manager_email', type: 'email', validate: isValidEmailShape, warningKey: 'managerEmail' },
  { key: 'external_ids', type: 'text' },
] as const;

/* --------------------------------------------------------------------------- *
 * Value coercion helpers shared by editor / panel / columns.
 * --------------------------------------------------------------------------- */

/**
 * Render a metadata value as a display string. Governorate keys are intentionally
 * NOT localized here (the caller localizes via the i18n bundle); everything else
 * is stringified plainly. Returns '' for blank values.
 */
export function metadataValueToString(raw: unknown): string {
  if (isBlank(raw)) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) return raw.map((v) => metadataValueToString(v)).filter(Boolean).join(', ');
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

/** All non-schema keys present in a metadata map, in stable insertion order. */
export function extraMetadataKeys(metadata: Record<string, unknown>): string[] {
  return Object.keys(metadata).filter((key) => !isSchemaKey(key));
}
