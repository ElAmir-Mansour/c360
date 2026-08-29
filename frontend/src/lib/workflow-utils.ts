import {
  UserCheck,
  Zap,
  GitBranch,
  GitMerge,
  Clock,
  CheckCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { z } from 'zod';
import type {
  Condition,
  ConditionOperator,
  FormField,
  HumanTask,
  RuleKind,
  User,
  ValidationRule,
} from '@/types/models';
import { DEFAULT_LOCALE, type AppLocale } from '@/lib/i18n';
import { resolveLocalized, normalizeOptions } from '@/lib/i18n/localized';
import {
  getFormValidationMessage,
  type FormValidationMessageName,
} from '@/lib/i18n/form-validation-messages';
import { differenceInHours, parseISO } from 'date-fns';

export function formatStepType(type: string): string {
  const map: Record<string, string> = {
    human_task: 'Human Task',
    service_task: 'Automated',
    condition: 'Condition',
    parallel_gateway: 'Parallel',
    timer: 'Timer',
    end: 'End',
  };
  return map[type] ?? type;
}

export function getStepIcon(type: string): LucideIcon {
  const map: Record<string, LucideIcon> = {
    human_task: UserCheck,
    service_task: Zap,
    condition: GitBranch,
    parallel_gateway: GitMerge,
    timer: Clock,
    end: CheckCircle,
  };
  return map[type] ?? CheckCircle;
}

export function getStepStatusColor(status: string): string {
  const map: Record<string, string> = {
    completed: 'text-legacy-green-600',
    running: 'text-blue-600',
    failed: 'text-red-600',
    pending: 'text-neutral-ink/45',
    skipped: 'text-neutral-ink/30',
    cancelled: 'text-neutral-ink/45',
  };
  return map[status] ?? 'text-neutral-ink/45';
}

// ---------------------------------------------------------------------------
// Dynamic form engine — the FRONT-END MIRROR of backend/internal/forms/validate.go
// ---------------------------------------------------------------------------
//
// buildDynamicZodSchema compiles a canonical FormField[] to a Zod object schema
// that enforces the SAME rules the backend re-checks on submit. It is two-sided:
//   - field type -> base zod (string/number/boolean/array/tuple/object/section)
//   - each ValidationRule (min/max/minLength/maxLength/pattern/email/url/uuid/
//     cron/enum) applied with the resolved bilingual message
//   - required + requiredWhen + requiredIf enforced (a required field with a
//     satisfied requiredWhen/requiredIf, or a static required, must be present)
//   - a field whose visibleWhen evaluates FALSE against the current values is
//     EXCLUDED from all validation (hidden => skipped), matching
//     forms.ValidateSubmission.
//
// Conditional rules (visibleWhen/requiredWhen/requiredIf/rule.when) need the
// other fields' current values, so they are evaluated against opts.values. When
// values change the renderer rebuilds the schema (or passes fresh values), the
// same way the backend evaluates against the submitted FormData.

export interface BuildDynamicZodSchemaOptions {
  /** Active locale for resolving bilingual messages (default ar). */
  locale?: AppLocale;
  /** Current form values, used to evaluate conditions (visible/required/when). */
  values?: Record<string, unknown>;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * isValueEmpty mirrors the Go `isEmptyValue`: nil/null, blank/whitespace string,
 * empty array, or empty object count as "not provided".
 */
export function isValueEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length === 0;
  return false;
}

/** truthy mirrors the Go `truthy` helper for presence operators. */
function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v !== '';
  if (typeof v === 'number') return v !== 0;
  return !isValueEmpty(v);
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

/**
 * compareEqual mirrors the Go evaluator: numeric coercion when both sides are
 * numeric, then boolean==boolean, then string==string, then a `%v`-style
 * stringified compare.
 */
function compareEqual(a: unknown, b: unknown): boolean {
  if (a === null && b === null) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null && typeof a !== 'boolean' && typeof b !== 'boolean') {
    return an === bn;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  return String(a) === String(b);
}

/**
 * strictNumber mirrors the Go evaluator's `toFloat64`: only an actual number
 * counts. A numeric STRING ('10') is NOT coerced — Go's toFloat64 rejects
 * strings, so ordered comparisons against a string field must be non-comparable
 * (false) on both sides. (Distinct from `toNumber`, used by equality, which DOES
 * coerce to match Go's `%v` fallback for eq/in.)
 */
function strictNumber(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

/**
 * compareOrdered mirrors the Go `compareOrdered`/`toFloat64` exactly: both
 * operands must be real numbers; any non-number operand (incl. a numeric string)
 * makes the comparison non-numeric => false. JSON numbers map to JS numbers, so
 * a number-typed condition value vs a number field agrees with the backend.
 */
function compareOrdered(a: unknown, b: unknown, op: 'gt' | 'gte' | 'lt' | 'lte'): boolean {
  const af = strictNumber(a);
  const bf = strictNumber(b);
  if (af === null || bf === null) return false;
  switch (op) {
    case 'gt':
      return af > bf;
    case 'gte':
      return af >= bf;
    case 'lt':
      return af < bf;
    case 'lte':
      return af <= bf;
  }
}

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return [v];
}

/**
 * evalCondition evaluates ONE condition against the current field values. It
 * mirrors backend `evalCondition` + `compileCondition` operator semantics for
 * all 13 operators. A comparison against an absent field is false (matching the
 * Go short-circuit before the evaluator), except the presence operators which
 * resolve directly.
 */
export function evalCondition(
  cond: Condition,
  values: Record<string, unknown>,
): boolean {
  const op: ConditionOperator = cond.operator;
  const fieldValue = values[cond.field];
  const present = Object.prototype.hasOwnProperty.call(values, cond.field);

  switch (op) {
    case 'isSet':
      return !isValueEmpty(fieldValue);
    case 'isEmpty':
      return isValueEmpty(fieldValue);
    case 'truthy':
      return truthy(fieldValue);
    case 'falsy':
      return !truthy(fieldValue);
  }

  // A comparison against an absent field can never hold.
  if (!present) return false;

  switch (op) {
    case 'eq':
      return compareEqual(fieldValue, cond.value);
    case 'neq':
      return !compareEqual(fieldValue, cond.value);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return compareOrdered(fieldValue, cond.value, op);
    case 'in':
      return toArray(cond.value).some((item) => compareEqual(fieldValue, item));
    case 'notIn':
      return !toArray(cond.value).some((item) => compareEqual(fieldValue, item));
    case 'contains': {
      // Backend `contains` compiles to `<value> in fields.<list>`, and the Go
      // evaluator's evalIn REQUIRES the field value be a list ([]interface{});
      // a string (or any non-list) field yields an error -> false. Mirror that
      // exactly: element membership in a list only — no string-substring path.
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((item) => compareEqual(item, cond.value));
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * conditionsHold evaluates an AND of conditions. An empty list returns
 * `emptyResult` (true for "visible by default" / "rule active by default";
 * requiredWhen passes false so an empty list means "not required"), mirroring
 * the Go `conditionsHold`.
 */
export function conditionsHold(
  conds: Condition[] | undefined,
  values: Record<string, unknown>,
  emptyResult: boolean,
): boolean {
  if (!conds || conds.length === 0) return emptyResult;
  return conds.every((c) => evalCondition(c, values));
}

/**
 * isFieldVisible reports whether a field's visibleWhen holds (empty => visible).
 * A hidden field is excluded from all validation.
 */
export function isFieldVisible(
  field: FormField,
  values: Record<string, unknown>,
): boolean {
  return conditionsHold(field.visibleWhen, values, true);
}

/** ruleParamConditions extracts a Condition[] from a requiredIf rule param. */
function ruleParamConditions(param: unknown): Condition[] {
  if (!Array.isArray(param)) return [];
  return param.filter(
    (c): c is Condition =>
      typeof c === 'object' && c !== null && 'field' in c && 'operator' in c,
  );
}

/**
 * isFieldRequired reports whether a field is required given current values:
 * static required, OR a satisfied requiredWhen, OR a satisfied requiredIf rule.
 * Mirrors the requiredness block of `ValidateSubmission`.
 */
export function isFieldRequired(
  field: FormField,
  values: Record<string, unknown>,
): boolean {
  if (field.required) return true;
  if (conditionsHold(field.requiredWhen, values, false)) return true;
  for (const rule of field.validation ?? []) {
    if (rule.kind === 'requiredIf') {
      if (conditionsHold(ruleParamConditions(rule.param), values, false)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * messageFor resolves the error string for a rule: an author-supplied bilingual
 * `message` always wins (matching backend `applyRule`); otherwise the generic
 * parameterized default for the rule kind is used.
 */
function messageFor(
  defaultName: FormValidationMessageName,
  fieldLabel: string,
  locale: AppLocale,
  rule: ValidationRule | undefined,
  extra: { n?: number | string; value?: unknown; pattern?: string } = {},
): string {
  if (rule?.message && !(rule.message.ar === '' && rule.message.en === '')) {
    return resolveLocalized(rule.message, locale);
  }
  return getFormValidationMessage(defaultName, { field: fieldLabel, ...extra }, locale);
}

/** rulesByKind groups a field's active (when-guard satisfied) rules by kind. */
function activeRules(
  field: FormField,
  values: Record<string, unknown>,
): ValidationRule[] {
  return (field.validation ?? []).filter((r) =>
    conditionsHold(r.when, values, true),
  );
}

/** baseSchemaForType returns the base, non-refined zod for a field type. */
function baseSchemaForType(field: FormField, requiredMsg: string): z.ZodTypeAny {
  switch (field.type) {
    case 'number':
    case 'currency':
      // Accept number, or numeric string coerced to number; reject NaN.
      return z.preprocess(
        (v) => {
          if (v === '' || v === null || v === undefined) return undefined;
          if (typeof v === 'string') {
            const n = Number(v);
            return Number.isNaN(n) ? v : n;
          }
          return v;
        },
        z.number({ invalid_type_error: requiredMsg }),
      );
    case 'boolean':
      return z.boolean({ invalid_type_error: requiredMsg });
    case 'multiselect':
      return z.array(z.string());
    case 'daterange':
      return z.tuple([z.string(), z.string()]);
    case 'file':
      return z.union([z.string(), z.record(z.unknown())]);
    case 'section':
      return z.any();
    // text, textarea, date, datetime, select, combobox, radio, email, url, phone
    default:
      return z.string({ invalid_type_error: requiredMsg });
  }
}

/**
 * applyRulesToString attaches string-valued ValidationRule refinements to a zod
 * string schema. Mirrors the Go `applyRule` string branches.
 */
function applyStringRules(
  schema: z.ZodString,
  field: FormField,
  rules: ValidationRule[],
  label: string,
  locale: AppLocale,
): z.ZodTypeAny {
  let out: z.ZodTypeAny = schema;
  const optionValues = normalizeOptions(field.options).map((o) => o.value);

  for (const rule of rules) {
    switch (rule.kind) {
      case 'minLength': {
        const n = toNumber(rule.param) ?? 0;
        out = (out as z.ZodString).min(n, messageFor('minLength', label, locale, rule, { n }));
        break;
      }
      case 'maxLength': {
        const n = toNumber(rule.param) ?? 0;
        out = (out as z.ZodString).max(n, messageFor('maxLength', label, locale, rule, { n }));
        break;
      }
      case 'pattern': {
        const pat = typeof rule.param === 'string' ? rule.param : '';
        try {
          const re = new RegExp(pat);
          out = (out as z.ZodString).regex(
            re,
            messageFor('pattern', label, locale, rule, { pattern: pat }),
          );
        } catch {
          // Invalid pattern: fail every value (matches Go surfacing a violation).
          out = (out as z.ZodString).refine(() => false, messageFor('pattern', label, locale, rule, { pattern: pat }));
        }
        break;
      }
      case 'email':
        out = (out as z.ZodTypeAny).refine(
          (v: unknown) => typeof v !== 'string' || EMAIL_RE.test(v),
          messageFor('email', label, locale, rule),
        );
        break;
      case 'url':
        out = (out as z.ZodTypeAny).refine((v: unknown) => {
          if (typeof v !== 'string') return true;
          try {
            const u = new URL(v);
            return u.protocol !== '' && u.host !== '';
          } catch {
            return false;
          }
        }, messageFor('url', label, locale, rule));
        break;
      case 'uuid':
        out = (out as z.ZodTypeAny).refine(
          (v: unknown) => typeof v !== 'string' || UUID_RE.test(v),
          messageFor('uuid', label, locale, rule),
        );
        break;
      case 'cron':
        out = (out as z.ZodTypeAny).refine(
          (v: unknown) => typeof v !== 'string' || isValidCron(v),
          messageFor('cron', label, locale, rule),
        );
        break;
      case 'enum': {
        const allowed =
          Array.isArray(rule.param) && rule.param.length > 0
            ? rule.param.map((x) => String(x))
            : optionValues;
        out = (out as z.ZodTypeAny).refine(
          (v: unknown) => allowed.length === 0 || allowed.includes(String(v)),
          messageFor('enum', label, locale, rule, { value: undefined }),
        );
        break;
      }
      case 'min':
      case 'max':
      case 'required':
      case 'requiredIf':
        // min/max are numeric (handled on number schema); required/requiredIf are
        // handled by the requiredness wrapper. No-op here.
        break;
    }
  }
  return out;
}

/** applyNumberRules attaches min/max to a (preprocessed) number schema. */
function applyNumberRules(
  schema: z.ZodTypeAny,
  rules: ValidationRule[],
  label: string,
  locale: AppLocale,
): z.ZodTypeAny {
  let out = schema;
  for (const rule of rules) {
    if (rule.kind === 'min') {
      const n = toNumber(rule.param);
      if (n !== null) {
        out = out.refine(
          (v: unknown) => typeof v !== 'number' || v >= n,
          messageFor('min', label, locale, rule, { n }),
        );
      }
    } else if (rule.kind === 'max') {
      const n = toNumber(rule.param);
      if (n !== null) {
        out = out.refine(
          (v: unknown) => typeof v !== 'number' || v <= n,
          messageFor('max', label, locale, rule, { n }),
        );
      }
    }
  }
  return out;
}

/** applyArrayRules attaches minLength/maxLength to a multiselect array schema. */
function applyArrayRules(
  schema: z.ZodTypeAny,
  field: FormField,
  rules: ValidationRule[],
  label: string,
  locale: AppLocale,
): z.ZodTypeAny {
  let out = schema;
  const optionValues = normalizeOptions(field.options).map((o) => o.value);
  for (const rule of rules) {
    if (rule.kind === 'minLength') {
      const n = toNumber(rule.param) ?? 0;
      out = out.refine(
        (v: unknown) => !Array.isArray(v) || v.length >= n,
        messageFor('minLength', label, locale, rule, { n }),
      );
    } else if (rule.kind === 'maxLength') {
      const n = toNumber(rule.param) ?? 0;
      out = out.refine(
        (v: unknown) => !Array.isArray(v) || v.length <= n,
        messageFor('maxLength', label, locale, rule, { n }),
      );
    } else if (rule.kind === 'enum' && optionValues.length > 0) {
      out = out.refine(
        (v: unknown) => !Array.isArray(v) || v.every((x) => optionValues.includes(String(x))),
        messageFor('enum', label, locale, rule),
      );
    }
  }
  // Option membership type-check for select-family multi values (matches Go typeCheck).
  if (optionValues.length > 0) {
    out = out.refine(
      (v: unknown) => !Array.isArray(v) || v.every((x) => optionValues.includes(String(x))),
      getFormValidationMessage('enum', { field: label }, locale),
    );
  }
  return out;
}

/**
 * isValidCron is a pragmatic 5/6-field cron validator (matches the shape the Go
 * cron.ParseCron accepts for the common case). Fields: minute hour dom month dow
 * with an optional leading seconds field.
 */
export function isValidCron(expr: string): boolean {
  const trimmed = expr.trim();
  if (trimmed === '') return false;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return false;
  const fieldRe = /^(\*|\?|[0-9*/,\-LW#]+)$/;
  return parts.every((p) => fieldRe.test(p));
}

export function buildDynamicZodSchema(
  fields: FormField[],
  opts: BuildDynamicZodSchemaOptions = {},
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const values = opts.values ?? {};
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    // section: layout-only, no value, no validation.
    if (field.type === 'section') {
      continue;
    }

    const label = resolveLocalized(field.label, locale) || field.name;

    // A hidden field is excluded from all validation: accept anything, optional.
    if (!isFieldVisible(field, values)) {
      shape[field.name] = z.any().optional();
      continue;
    }

    const required = isFieldRequired(field, values);
    const requiredMsg = getFormValidationMessage('required', { field: label }, locale);
    const requiredIfRule = (field.validation ?? []).find((r) => r.kind === 'requiredIf');
    const requiredRule = (field.validation ?? []).find((r) => r.kind === 'required');
    const finalRequiredMsg =
      messageFor('required', label, locale, requiredRule ?? requiredIfRule) || requiredMsg;

    const rules = activeRules(field, values);
    let schema: z.ZodTypeAny;

    switch (field.type) {
      case 'number':
      case 'currency': {
        schema = baseSchemaForType(field, finalRequiredMsg);
        schema = applyNumberRules(schema, rules, label, locale);
        break;
      }
      case 'boolean': {
        schema = baseSchemaForType(field, finalRequiredMsg);
        break;
      }
      case 'multiselect': {
        schema = baseSchemaForType(field, finalRequiredMsg);
        schema = applyArrayRules(schema, field, rules, label, locale);
        break;
      }
      case 'daterange': {
        schema = baseSchemaForType(field, finalRequiredMsg);
        break;
      }
      case 'file': {
        schema = baseSchemaForType(field, finalRequiredMsg);
        break;
      }
      case 'select':
      case 'combobox':
      case 'radio': {
        const base = z.string({ invalid_type_error: finalRequiredMsg });
        let withRules = applyStringRules(base, field, rules, label, locale);
        // Option membership (matches Go typeCheck enum for single-select family).
        const optionValues = normalizeOptions(field.options).map((o) => o.value);
        if (optionValues.length > 0) {
          withRules = withRules.refine(
            (v: unknown) =>
              typeof v !== 'string' || v === '' || optionValues.includes(v),
            getFormValidationMessage('enum', { field: label }, locale),
          );
        }
        schema = withRules;
        break;
      }
      default: {
        // text, textarea, date, datetime, email, url, phone
        const base = z.string({ invalid_type_error: finalRequiredMsg });
        schema = applyStringRules(base, field, rules, label, locale);
        break;
      }
    }

    // Requiredness wrapper. For value-carrying fields a required field must be
    // present and non-empty; an optional one accepts undefined/empty.
    schema = wrapRequiredness(schema, field, required, finalRequiredMsg);

    shape[field.name] = schema;
  }

  return z.object(shape);
}

/**
 * wrapRequiredness enforces presence for required fields and tolerates absence
 * for optional ones, per field type, mirroring the Go required/empty handling.
 */
function wrapRequiredness(
  schema: z.ZodTypeAny,
  field: FormField,
  required: boolean,
  requiredMsg: string,
): z.ZodTypeAny {
  if (!required) {
    // Optional & absent/empty: skip type/rule checks (Go skips them too).
    if (field.type === 'multiselect' || field.type === 'daterange') {
      return schema.optional();
    }
    return z.preprocess(
      (v) => (isValueEmpty(v) ? undefined : v),
      schema.optional(),
    );
  }

  // Required.
  switch (field.type) {
    case 'boolean':
      // A required boolean must be a real boolean (true OR false both satisfy).
      return schema;
    case 'number':
    case 'currency':
      return schema; // preprocess maps '' -> undefined -> z.number errors (required)
    case 'multiselect':
      return (schema as z.ZodTypeAny).refine(
        (v: unknown) => Array.isArray(v) && v.length > 0,
        requiredMsg,
      );
    case 'daterange':
      return schema; // a tuple is required by construction
    case 'file':
      return (schema as z.ZodTypeAny).refine((v: unknown) => !isValueEmpty(v), requiredMsg);
    default:
      // string family: must be present and non-blank.
      return (schema as z.ZodTypeAny).refine(
        (v: unknown) => typeof v === 'string' && v.trim() !== '',
        requiredMsg,
      );
  }
}

export function canClaimTask(task: HumanTask, user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }

  if (task.status !== 'pending' || task.claimed_by !== null) {
    return false;
  }

  if (task.assignee_id && task.assignee_id === user.id) {
    return true;
  }

  if (!task.assignee_role) {
    return true;
  }

  return (user.roles ?? []).some(
    (role) => role.slug === task.assignee_role || role.name === task.assignee_role,
  );
}

export function canDelegateTask(task: HumanTask, user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }

  if (task.claimed_by === user.id) {
    return true;
  }

  return (user.roles ?? []).some((role) => {
    const normalized = role.slug.toLowerCase();
    return normalized.includes('admin') || normalized.includes('manager');
  });
}

export function formatSLAStatus(task: HumanTask): {
  text: string;
  color: string;
  urgent: boolean;
} {
  if (!task.sla_deadline) {
    return { text: 'No deadline', color: 'text-muted-foreground', urgent: false };
  }

  if (task.sla_breached) {
    const deadline = parseISO(task.sla_deadline);
    const hoursOverdue = Math.abs(differenceInHours(new Date(), deadline));
    const text =
      hoursOverdue < 1
        ? 'Overdue by <1h'
        : `Overdue by ${hoursOverdue}h`;
    return { text, color: 'text-red-600', urgent: true };
  }

  const deadline = parseISO(task.sla_deadline);
  const hoursLeft = differenceInHours(deadline, new Date());

  if (hoursLeft <= 4) {
    return {
      text: hoursLeft < 1 ? '<1h left' : `${hoursLeft}h left`,
      color: 'text-orange-600',
      urgent: true,
    };
  }

  const daysLeft = Math.floor(hoursLeft / 24);
  if (daysLeft === 0) {
    return { text: `${hoursLeft}h left`, color: 'text-foreground', urgent: false };
  }
  return { text: `${daysLeft}d left`, color: 'text-foreground', urgent: false };
}

export const PRIORITY_LABELS: Record<number, string> = {
  2: 'Critical',
  1: 'High',
  0: 'Normal',
};

export const PRIORITY_COLORS: Record<number, string> = {
  2: 'bg-red-500',
  1: 'bg-orange-400',
  0: 'bg-blue-400',
};
