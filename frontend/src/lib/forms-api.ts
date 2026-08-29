/**
 * Typed client for the canonical Dynamic Form Engine endpoints under
 * `/api/v1/workflows/forms`. It lists / gets / creates / updates / deletes
 * {@link FormDefinition}s.
 *
 * TWO-SIDED CONTRACT (backend/internal/forms): the backend decodes the create /
 * update body with `DisallowUnknownFields`, so the request body must contain
 * EXACTLY the persisted-content keys — `{name, version?, locales, default_locale,
 * fields}` — and nothing else. The audit/row columns (`id`, `tenant_id`,
 * `created_at`, `updated_at`) are server-owned and MUST be stripped from the body
 * or the server 400s. Likewise, every author-facing label (field labels,
 * placeholders, descriptions, and option labels) must serialize as the canonical
 * `{ar, en}` OBJECT form (a bare string is accepted on read but FR-XC-008 / the
 * bilingual gate expects both locales present), so we normalize them here.
 *
 * The serialization is performed by {@link serializeFormDefinitionBody}, exported
 * for testing so the exact JSON shape can be asserted.
 */
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { normalizeLocalized, normalizeOptions } from '@/lib/i18n/localized';
import { OPTION_BACKED_TYPES } from '@/types/forms';
import type {
  Condition,
  FieldDir,
  FormDefinition,
  FormField,
  FormOption,
  LocalizedText,
  ValidationRule,
} from '@/types/forms';

/** Base path for the canonical form-definition API. */
export const FORMS_API_BASE = '/api/v1/workflows/forms';

/**
 * The exact wire body the backend accepts for create / update. Only these keys
 * may be present (DisallowUnknownFields); `version` is optional (the server
 * assigns / bumps it). The `fields` are fully normalized canonical fields with
 * object-form bilingual labels.
 */
export interface FormDefinitionInput {
  name: string;
  version?: number;
  locales: string[];
  default_locale: string;
  fields: FormFieldWire[];
}

/**
 * FormFieldWire is the on-the-wire field shape: identical to the canonical Go
 * FormField JSON, with every localized text in object form and options as
 * FormOption[]. Optional members are omitted (not sent as null) when absent so
 * the body matches the Go `omitempty` columns.
 */
export interface FormFieldWire {
  name: string;
  type: FormField['type'];
  label: LocalizedText;
  placeholder?: LocalizedText;
  description?: LocalizedText;
  required: boolean;
  default?: unknown;
  options?: FormOption[];
  validation?: ValidationRuleWire[];
  visibleWhen?: Condition[];
  requiredWhen?: Condition[];
  dir?: FieldDir;
}

/** ValidationRuleWire mirrors ValidationRule with an object-form message. */
export interface ValidationRuleWire {
  kind: ValidationRule['kind'];
  param?: unknown;
  when?: Condition[];
  message?: LocalizedText;
}

/**
 * The shape accepted by create / update. Either a full {@link FormDefinition}
 * (the extra row columns are stripped) or a bare {@link FormDefinitionInput}.
 */
export type FormDefinitionDraft = FormDefinitionInput | FormDefinition;

/**
 * List response shape returned by GET /api/v1/workflows/forms. Matches the
 * backend form_handler.ListForms exactly: `{"forms": [...], "total": n}` (NOT a
 * `{data}` envelope). Single-resource endpoints (get/create/update) return the
 * bare FormDefinition object — no wrapper.
 */
interface FormListResponse {
  forms: FormDefinition[];
  total: number;
}

/** isLocalizedMessageEmpty reports whether a normalized message has no content. */
function isLocalizedEmpty(lt: LocalizedText): boolean {
  return lt.ar === '' && lt.en === '';
}

/** serializeRule normalizes a rule's optional bilingual message to object form. */
function serializeRule(rule: ValidationRule): ValidationRuleWire {
  const wire: ValidationRuleWire = { kind: rule.kind };
  if (rule.param !== undefined) {
    wire.param = rule.param;
  }
  if (rule.when && rule.when.length > 0) {
    wire.when = rule.when;
  }
  if (rule.message !== undefined) {
    const message = normalizeLocalized(rule.message);
    if (!isLocalizedEmpty(message)) {
      wire.message = message;
    }
  }
  return wire;
}

/**
 * serializeField normalizes ONE field to the wire shape:
 *   - label -> {ar, en} object (always present)
 *   - placeholder / description -> {ar, en} object, omitted when empty on both
 *   - options -> FormOption[] with object-form labels (only for option-backed
 *     types or when options were authored)
 *   - validation rule messages -> object form
 *   - empty optional arrays / blank dir are omitted (match Go `omitempty`)
 */
export function serializeField(field: FormField): FormFieldWire {
  const wire: FormFieldWire = {
    name: field.name,
    type: field.type,
    label: normalizeLocalized(field.label),
    required: Boolean(field.required),
  };

  if (field.placeholder !== undefined) {
    const placeholder = normalizeLocalized(field.placeholder);
    if (!isLocalizedEmpty(placeholder)) {
      wire.placeholder = placeholder;
    }
  }
  if (field.description !== undefined) {
    const description = normalizeLocalized(field.description);
    if (!isLocalizedEmpty(description)) {
      wire.description = description;
    }
  }
  if (field.default !== undefined) {
    wire.default = field.default;
  }

  const optionBacked = OPTION_BACKED_TYPES.includes(field.type);
  if (field.options && field.options.length > 0) {
    wire.options = normalizeOptions(field.options);
  } else if (optionBacked) {
    // An option-backed field always carries an options array (possibly empty)
    // so the structure round-trips; the bilingual gate handles emptiness.
    wire.options = normalizeOptions(field.options);
  }

  if (field.validation && field.validation.length > 0) {
    wire.validation = field.validation.map(serializeRule);
  }
  if (field.visibleWhen && field.visibleWhen.length > 0) {
    wire.visibleWhen = field.visibleWhen;
  }
  if (field.requiredWhen && field.requiredWhen.length > 0) {
    wire.requiredWhen = field.requiredWhen;
  }
  if (field.dir) {
    wire.dir = field.dir;
  }

  return wire;
}

/**
 * serializeFormDefinitionBody produces the EXACT create / update request body:
 * `{name, version?, locales, default_locale, fields}` — stripping `id`,
 * `tenant_id`, `created_at`, `updated_at` and normalizing every localized text
 * to object form. Exported for tests (assert the JSON shape).
 */
export function serializeFormDefinitionBody(
  draft: FormDefinitionDraft,
  options: { includeVersion?: boolean } = {},
): FormDefinitionInput {
  const body: FormDefinitionInput = {
    name: draft.name,
    locales: [...(draft.locales ?? [])],
    default_locale: draft.default_locale,
    fields: (draft.fields ?? []).map(serializeField),
  };
  // Only include version on update (the server assigns it on create). A caller
  // may force it via includeVersion when re-saving a known version.
  if (options.includeVersion && typeof draft.version === 'number') {
    body.version = draft.version;
  }
  return body;
}

/** listFormDefinitions fetches all form definitions for the tenant. */
export async function listFormDefinitions(): Promise<FormDefinition[]> {
  const res = await apiGet<FormListResponse>(FORMS_API_BASE);
  return res?.forms ?? [];
}

/** getFormDefinition fetches one form definition by id (bare object response). */
export async function getFormDefinition(id: string): Promise<FormDefinition> {
  return apiGet<FormDefinition>(`${FORMS_API_BASE}/${id}`);
}

/**
 * createFormDefinition POSTs a new definition. The body is serialized to exactly
 * `{name, locales, default_locale, fields}` (version omitted — server-assigned).
 */
export async function createFormDefinition(
  draft: FormDefinitionDraft,
): Promise<FormDefinition> {
  const body = serializeFormDefinitionBody(draft);
  return apiPost<FormDefinition>(FORMS_API_BASE, body);
}

/**
 * updateFormDefinition PUTs an updated definition. The current `version` is
 * included so the server can version / optimistic-lock the change.
 */
export async function updateFormDefinition(
  id: string,
  draft: FormDefinitionDraft,
): Promise<FormDefinition> {
  const body = serializeFormDefinitionBody(draft, { includeVersion: true });
  return apiPut<FormDefinition>(`${FORMS_API_BASE}/${id}`, body);
}

/** deleteFormDefinition removes a form definition by id. */
export async function deleteFormDefinition(id: string): Promise<void> {
  await apiDelete<void>(`${FORMS_API_BASE}/${id}`);
}
