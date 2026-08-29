/**
 * Pure, React-free logic for the Request-Approval Policy Template definition
 * editor + instantiate flow. This module is the unit-test surface: every export
 * is deterministic and side-effect-free.
 *
 * A template `definition` is the policy-shape JSON — the same fields as a
 * request-approval policy create payload (scope dims, value range, routing,
 * authority block, approvers, form_fields, validity window). The dialog's
 * structured editor is the SINGLE source of truth: the definition is DERIVED
 * from {@link TemplateDefinitionDraft} via {@link definitionFromDraft}. There is
 * no editable raw-JSON-as-source path; the only free-form escape hatch is an
 * "advanced metadata" key/value list for ARBITRARY EXTRA keys, which merges LAST
 * and can NEVER overwrite a structured-managed key.
 */

import type {
  CreateRequestApprovalPolicyPayload,
  RequestApprovalStage,
  UpdateRequestApprovalPolicyPayload,
} from '@/lib/lex/request-approval-policies';
import type {
  JsonObject,
  JsonValue,
  LexApprovalFormFieldRequest,
  LexApprovalFormFieldType,
  LexApprovalPolicyApprover,
  LexApprovalPolicyApproverType,
  LexApprovalPolicyMode,
  LexApprovalPolicyQuorum,
} from '@/types/suites';

/* ----------------------------- Constants ----------------------------- */

/** Stage values; the empty string means "any stage" (scope dimension absent). */
export const TEMPLATE_STAGES = ['', 'requester', 'provider'] as const;
export const TEMPLATE_MODES = [
  'parallel',
  'sequential',
] as const satisfies readonly LexApprovalPolicyMode[];
export const TEMPLATE_QUORUMS = [
  'all',
  'any',
  'n_of_m',
] as const satisfies readonly LexApprovalPolicyQuorum[];
export const TEMPLATE_APPROVER_TYPES = [
  'role',
  'user',
] as const satisfies readonly LexApprovalPolicyApproverType[];
export const TEMPLATE_FIELD_TYPES = [
  'textarea',
  'text',
  'select',
  'number',
  'date',
  'boolean',
] as const satisfies readonly LexApprovalFormFieldType[];

export type TemplateStage = (typeof TEMPLATE_STAGES)[number];

/**
 * Structured-managed keys are owned exclusively by the structured editor. They
 * are derived from the draft on every save and can never be overwritten by the
 * advanced free-form metadata list.
 */
export const STRUCTURED_MANAGED_KEYS = [
  'request_type',
  'service_id',
  'stage',
  'department',
  'priority_tier',
  'priority',
  'min_value',
  'max_value',
  'currency',
  'mode',
  'quorum',
  'quorum_n',
  'approvers',
  'form_fields',
  'require_authority_evidence',
  'required_role',
  'required_authority_amount',
  'valid_from',
  'valid_until',
] as const;

const STRUCTURED_MANAGED_KEY_SET: ReadonlySet<string> = new Set(STRUCTURED_MANAGED_KEYS);

/* ----------------------------- Draft shape ----------------------------- */

export interface ApproverDraft {
  type: LexApprovalPolicyApproverType;
  ref: string;
  label: string;
}

export interface FormFieldDraft {
  name: string;
  type: LexApprovalFormFieldType;
  label: string;
  required: boolean;
  /** Comma-separated option list; only meaningful for `select`. */
  options: string;
  placeholder: string;
  description: string;
}

/** One arbitrary extra metadata entry (advanced escape hatch). */
export interface ExtraMetadataDraft {
  key: string;
  /** Raw JSON value source; parsed as JSON, falling back to a bare string. */
  value: string;
}

/**
 * The full structured shape of a template definition. The dialog holds exactly
 * this in React state; the definition is derived from it on save.
 */
export interface TemplateDefinitionDraft {
  request_type: string;
  service_id: string;
  stage: TemplateStage;
  department: string;
  priority_tier: string;
  priority: string;
  min_value: string;
  max_value: string;
  currency: string;
  mode: LexApprovalPolicyMode;
  quorum: LexApprovalPolicyQuorum;
  quorum_n: string;
  approvers: ApproverDraft[];
  form_fields: FormFieldDraft[];
  require_authority_evidence: boolean;
  required_role: string;
  required_authority_amount: string;
  valid_from: string;
  valid_until: string;
  /** Arbitrary extra keys preserved round-trip; never structured-managed. */
  extra_metadata: ExtraMetadataDraft[];
}

/* ----------------------------- Defaults ----------------------------- */

export function emptyApprover(): ApproverDraft {
  return { type: 'role', ref: '', label: '' };
}

export function emptyFormField(): FormFieldDraft {
  return {
    name: '',
    type: 'text',
    label: '',
    required: false,
    options: '',
    placeholder: '',
    description: '',
  };
}

export function emptyExtraMetadata(): ExtraMetadataDraft {
  return { key: '', value: '' };
}

export function emptyTemplateDraft(): TemplateDefinitionDraft {
  return {
    request_type: '',
    service_id: '',
    stage: '',
    department: '',
    priority_tier: '',
    priority: '10',
    min_value: '',
    max_value: '',
    currency: 'SAR',
    mode: 'parallel',
    quorum: 'all',
    quorum_n: '',
    approvers: [emptyApprover()],
    form_fields: [],
    require_authority_evidence: false,
    required_role: '',
    required_authority_amount: '',
    valid_from: '',
    valid_until: '',
    extra_metadata: [],
  };
}

/* ----------------------------- draftFromDefinition ----------------------------- */

/**
 * Hydrate a structured draft from a stored definition object. Unknown keys (any
 * key not structured-managed) are surfaced as advanced metadata entries so they
 * survive an edit-save round-trip untouched.
 */
export function draftFromDefinition(definition: JsonObject | null | undefined): TemplateDefinitionDraft {
  const def: JsonObject = isPlainObject(definition) ? definition : {};

  const approversRaw = Array.isArray(def.approvers) ? def.approvers : [];
  const approvers: ApproverDraft[] = approversRaw
    .filter((item): item is JsonObject => isPlainObject(item))
    .map((item) => ({
      type: item.type === 'user' ? 'user' : 'role',
      ref: asString(item.ref),
      label: asString(item.label),
    }));

  const fieldsRaw = Array.isArray(def.form_fields) ? def.form_fields : [];
  const formFields: FormFieldDraft[] = fieldsRaw
    .filter((item): item is JsonObject => isPlainObject(item))
    .map((item) => ({
      name: asString(item.name),
      type: asFieldType(item.type),
      label: asString(item.label),
      required: item.required === true,
      options: Array.isArray(item.options)
        ? item.options.filter((o): o is string => typeof o === 'string').join(', ')
        : '',
      placeholder: asString(item.placeholder),
      description: asString(item.description),
    }));

  const stage: TemplateStage =
    def.stage === 'requester' || def.stage === 'provider' ? def.stage : '';

  const extra: ExtraMetadataDraft[] = Object.keys(def)
    .filter((key) => !STRUCTURED_MANAGED_KEY_SET.has(key))
    .map((key) => ({ key, value: serializeExtraValue(def[key]) }));

  return {
    request_type: asString(def.request_type),
    service_id: asString(def.service_id),
    stage,
    department: asString(def.department),
    priority_tier: asString(def.priority_tier),
    priority: asNumberString(def.priority, '10'),
    min_value: asNumberString(def.min_value, ''),
    max_value: asNumberString(def.max_value, ''),
    currency: asString(def.currency) || 'SAR',
    mode: def.mode === 'sequential' ? 'sequential' : 'parallel',
    quorum: def.quorum === 'any' || def.quorum === 'n_of_m' ? def.quorum : 'all',
    quorum_n: asNumberString(def.quorum_n, ''),
    approvers: approvers.length > 0 ? approvers : [emptyApprover()],
    form_fields: formFields,
    require_authority_evidence: def.require_authority_evidence === true,
    required_role: asString(def.required_role),
    required_authority_amount: asNumberString(def.required_authority_amount, ''),
    valid_from: asDateInput(def.valid_from),
    valid_until: asDateInput(def.valid_until),
    extra_metadata: extra,
  };
}

/* ----------------------------- definitionFromDraft ----------------------------- */

/**
 * Derive the canonical definition object from the structured draft. The
 * structured-managed keys are written first; the advanced metadata entries are
 * merged LAST but a key that collides with a structured-managed key is dropped,
 * so structured state always wins. There is no path where editing one field
 * wipes another.
 */
export function definitionFromDraft(draft: TemplateDefinitionDraft): JsonObject {
  const approvers = buildApprovers(draft.approvers);
  const formFields = buildFormFields(draft.form_fields);

  const definition: JsonObject = {
    request_type: optionalString(draft.request_type),
    service_id: optionalString(draft.service_id),
    stage: draft.stage || null,
    department: optionalString(draft.department),
    priority_tier: optionalString(draft.priority_tier),
    priority: parseInteger(draft.priority, 10),
    min_value: optionalNumber(draft.min_value),
    max_value: optionalNumber(draft.max_value),
    currency: formatCurrency(draft.currency),
    mode: draft.mode,
    quorum: draft.quorum,
    quorum_n: draft.quorum === 'n_of_m' ? parseIntegerOrNull(draft.quorum_n) : null,
    approvers: approvers as unknown as JsonValue,
    form_fields: formFields as unknown as JsonValue,
    require_authority_evidence: draft.require_authority_evidence,
    required_role: optionalString(draft.required_role),
    required_authority_amount: optionalNumber(draft.required_authority_amount),
    valid_from: optionalString(draft.valid_from),
    valid_until: optionalString(draft.valid_until),
  };

  // Merge arbitrary extra keys LAST; never overwrite a structured-managed key.
  for (const entry of draft.extra_metadata) {
    const key = entry.key.trim();
    if (key === '' || STRUCTURED_MANAGED_KEY_SET.has(key)) {
      continue;
    }
    definition[key] = parseExtraValue(entry.value);
  }

  return definition;
}

/* ----------------------------- validateDefinition ----------------------------- */

/**
 * Validate the structured draft. Returns a list of message keys (strings) — the
 * dialog resolves them to bilingual copy. An empty list means the draft is
 * saveable. Validation keys are stable identifiers, not English text.
 */
export function validateDefinition(draft: TemplateDefinitionDraft): string[] {
  const errors: string[] = [];

  if (!(TEMPLATE_MODES as readonly string[]).includes(draft.mode)) {
    errors.push('mode_invalid');
  }
  if (!(TEMPLATE_QUORUMS as readonly string[]).includes(draft.quorum)) {
    errors.push('quorum_invalid');
  }
  if (draft.stage !== '' && draft.stage !== 'requester' && draft.stage !== 'provider') {
    errors.push('stage_invalid');
  }

  const validApprovers = draft.approvers.filter((approver) => approver.ref.trim() !== '');
  if (validApprovers.length === 0) {
    errors.push('approver_required');
  }
  // Every populated approver must carry a non-empty ref. (A wholly blank row is
  // ignored above; a row that has a label/type but no ref is a real mistake.)
  if (draft.approvers.some((approver) => approver.ref.trim() === '' && hasApproverContent(approver))) {
    errors.push('approver_ref_required');
  }

  if (draft.quorum === 'n_of_m') {
    const quorumN = Number.parseInt(draft.quorum_n, 10);
    if (!Number.isFinite(quorumN) || quorumN < 1) {
      errors.push('quorum_at_least_one');
    } else if (quorumN > validApprovers.length) {
      errors.push('quorum_exceeds_approvers');
    }
  }

  const minValue = optionalNumber(draft.min_value);
  const maxValue = optionalNumber(draft.max_value);
  if (minValue != null && maxValue != null && minValue > maxValue) {
    errors.push('min_exceeds_max');
  }

  const authorityAmount = optionalNumber(draft.required_authority_amount);
  if (authorityAmount != null && authorityAmount < 0) {
    errors.push('authority_amount_negative');
  }

  draft.form_fields.forEach((field, index) => {
    const hasContent =
      field.name.trim() !== '' ||
      field.label.trim() !== '' ||
      field.options.trim() !== '' ||
      field.placeholder.trim() !== '' ||
      field.description.trim() !== '';
    if (!hasContent) {
      return; // wholly blank row is ignored on build
    }
    if (field.name.trim() === '' || field.label.trim() === '') {
      errors.push(`form_field_incomplete:${index + 1}`);
    }
    if (field.type === 'select' && parseCsv(field.options).length === 0) {
      errors.push(`form_field_select_needs_option:${index + 1}`);
    }
  });

  if (draft.valid_from !== '' && draft.valid_until !== '' && draft.valid_from > draft.valid_until) {
    errors.push('valid_from_after_until');
  }

  return errors;
}

/* ----------------------------- Instantiate overrides ----------------------------- */

export interface InstantiateOverridesInput {
  name: string;
  status: '' | 'draft' | 'active' | 'archived';
  requestType: string;
  department: string;
}

/**
 * Build the instantiate override patch from the dialog inputs. Blank fields are
 * omitted so they inherit the template definition. Returns `undefined` when no
 * override is set (callers then send no overrides at all).
 */
export function buildInstantiateOverrides(
  input: InstantiateOverridesInput,
): UpdateRequestApprovalPolicyPayload | undefined {
  const overrides: UpdateRequestApprovalPolicyPayload = {};
  const name = input.name.trim();
  if (name !== '') {
    overrides.name = name;
  }
  if (input.status !== '') {
    overrides.status = input.status;
  }
  const requestType = input.requestType.trim();
  if (requestType !== '') {
    overrides.request_type = requestType;
  }
  const department = input.department.trim();
  if (department !== '') {
    overrides.department = department;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

/* ----------------------------- Conflict-check payload ----------------------------- */

/**
 * Resolve a template `definition` plus instantiate overrides into the concrete
 * policy payload the server's conflict-check expects. Overrides win per-field;
 * fields absent from both inherit safe defaults. This mirrors how the live
 * policy editor builds its conflict-check body so the preview is faithful.
 */
export function resolvePolicyPayloadForConflictCheck(
  definition: JsonObject | null | undefined,
  overrides: UpdateRequestApprovalPolicyPayload | undefined,
): CreateRequestApprovalPolicyPayload {
  const def: JsonObject = isPlainObject(definition) ? definition : {};
  const over = overrides ?? {};

  const approvers = readApprovers(def.approvers);
  const formFields = readFormFields(def.form_fields);

  const base: CreateRequestApprovalPolicyPayload = {
    name: over.name ?? asString(def.name) ?? '',
    description: over.description ?? asStringOrUndefined(def.description),
    status: over.status ?? asStatus(def.status) ?? 'active',
    priority: over.priority ?? asNumber(def.priority) ?? 10,
    request_type: pick(over, 'request_type') ?? asNullableString(def.request_type),
    service_id: pick(over, 'service_id') ?? asNullableString(def.service_id),
    stage: pick(over, 'stage') ?? asStage(def.stage),
    department: pick(over, 'department') ?? asNullableString(def.department),
    priority_tier: pick(over, 'priority_tier') ?? asNullableString(def.priority_tier),
    min_value: pick(over, 'min_value') ?? asNullableNumber(def.min_value),
    max_value: pick(over, 'max_value') ?? asNullableNumber(def.max_value),
    currency: over.currency ?? formatCurrency(asString(def.currency)),
    mode: over.mode ?? (typeof def.mode === 'string' ? def.mode : 'parallel'),
    quorum: over.quorum ?? (typeof def.quorum === 'string' ? def.quorum : 'all'),
    quorum_n: pick(over, 'quorum_n') ?? asNullableNumber(def.quorum_n),
    approvers: over.approvers ?? approvers,
    form_fields: over.form_fields ?? formFields,
    require_authority_evidence:
      over.require_authority_evidence ?? def.require_authority_evidence === true,
    required_role: pick(over, 'required_role') ?? asNullableString(def.required_role),
    required_authority_amount:
      pick(over, 'required_authority_amount') ?? asNullableNumber(def.required_authority_amount),
    valid_from: pick(over, 'valid_from') ?? asNullableString(def.valid_from),
    valid_until: pick(over, 'valid_until') ?? asNullableString(def.valid_until),
    metadata: { source: 'watheeq_request_approval_template_instantiate' },
  };

  return base;
}

/* ----------------------------- build helpers ----------------------------- */

function buildApprovers(approvers: ApproverDraft[]): LexApprovalPolicyApprover[] {
  return approvers
    .map((approver) => {
      const out: LexApprovalPolicyApprover = { type: approver.type, ref: approver.ref.trim() };
      const label = approver.label.trim();
      if (label !== '') {
        out.label = label;
      }
      return out;
    })
    .filter((approver) => approver.ref.length > 0);
}

function buildFormFields(fields: FormFieldDraft[]): LexApprovalFormFieldRequest[] {
  return fields
    .map((field) => {
      const out: LexApprovalFormFieldRequest = {
        name: field.name.trim(),
        type: field.type,
        label: field.label.trim(),
        required: field.required,
      };
      if (field.type === 'select') {
        out.options = parseCsv(field.options);
      }
      const placeholder = field.placeholder.trim();
      if (placeholder !== '') {
        out.placeholder = placeholder;
      }
      const description = field.description.trim();
      if (description !== '') {
        out.description = description;
      }
      return out;
    })
    .filter((field) => field.name.length > 0 && field.label.length > 0);
}

function readApprovers(value: JsonValue | undefined): LexApprovalPolicyApprover[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is JsonObject => isPlainObject(item))
    .map((item) => {
      const out: LexApprovalPolicyApprover = {
        type: item.type === 'user' ? 'user' : 'role',
        ref: asString(item.ref),
      };
      const label = asString(item.label);
      if (label !== '') {
        out.label = label;
      }
      return out;
    })
    .filter((item) => item.ref.length > 0);
}

function readFormFields(value: JsonValue | undefined): LexApprovalFormFieldRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is JsonObject => isPlainObject(item))
    .map((item) => {
      const out: LexApprovalFormFieldRequest = {
        name: asString(item.name),
        type: asFieldType(item.type),
        label: asString(item.label),
        required: item.required === true,
      };
      if (out.type === 'select' && Array.isArray(item.options)) {
        out.options = item.options.filter((o): o is string => typeof o === 'string');
      }
      const placeholder = asString(item.placeholder);
      if (placeholder !== '') {
        out.placeholder = placeholder;
      }
      const description = asString(item.description);
      if (description !== '') {
        out.description = description;
      }
      return out;
    })
    .filter((item) => item.name.length > 0 && item.label.length > 0);
}

/* ----------------------------- value coercion ----------------------------- */

function hasApproverContent(approver: ApproverDraft): boolean {
  return approver.label.trim() !== '';
}

function serializeExtraValue(value: JsonValue): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function parseExtraValue(raw: string): JsonValue {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return '';
  }
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return raw;
  }
}

function pick<K extends keyof UpdateRequestApprovalPolicyPayload>(
  over: UpdateRequestApprovalPolicyPayload,
  key: K,
): UpdateRequestApprovalPolicyPayload[K] | undefined {
  return Object.prototype.hasOwnProperty.call(over, key) ? over[key] : undefined;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function asStringOrUndefined(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asNullableString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asNullableNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNumberString(value: JsonValue | undefined, fallback: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
}

function asStage(value: JsonValue | undefined): RequestApprovalStage | null {
  return value === 'requester' || value === 'provider' ? value : null;
}

function asStatus(value: JsonValue | undefined): 'draft' | 'active' | 'archived' | undefined {
  return value === 'draft' || value === 'active' || value === 'archived' ? value : undefined;
}

function asFieldType(value: JsonValue | undefined): LexApprovalFormFieldType {
  return (TEMPLATE_FIELD_TYPES as readonly string[]).includes(value as string)
    ? (value as LexApprovalFormFieldType)
    : 'text';
}

function asDateInput(value: JsonValue | undefined): string {
  return typeof value === 'string' && value !== '' ? value.slice(0, 10) : '';
}

function optionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerOrNull(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatCurrency(value: string): string {
  const trimmed = value.trim();
  return trimmed !== '' ? trimmed.toUpperCase() : 'SAR';
}
