/**
 * Canonical, bilingual, validated, conditional form-definition model for the
 * Clario360 dynamic form engine.
 *
 * This is the FRONT-END MIRROR of the Go canonical model that authoritatively
 * lives at backend/internal/forms/model.go (+ validate.go). The two sides MUST
 * agree: the FE compiles these Validation / VisibleWhen / RequiredWhen rules to
 * Zod, the backend re-validates the identical rules on submit. Keep the unions
 * and shapes below in lock-step with model.go.
 *
 * Backward compatibility: the legacy runtime/human-task path projects a flat,
 * single-locale form shape (label: string, options: string[], the 6 original
 * field types) through HumanTask.form_schema. Those legacy shapes must STILL
 * satisfy the canonical types here, so:
 *   - `label` / `placeholder` / `description` accept a bare string OR LocalizedText
 *   - `options` accepts string[] OR FormOption[]
 *   - the 6 legacy FieldTypes are a subset of the 17 canonical FieldTypes
 */

/**
 * LocalizedText carries an author-facing string in the two platform locales.
 * Arabic (ar) and English (en) are both first-class. On the wire a bare JSON
 * string is also accepted (legacy) and assigned to both locales; mirror that
 * with `normalizeLocalized` in @/lib/i18n/localized.
 */
export interface LocalizedText {
  ar: string;
  en: string;
}

/**
 * FieldType enumerates the 17 field kinds the renderer supports. Mirrors the
 * Go `FieldType` constants exactly. `section` is layout-only (no value).
 */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'combobox'
  | 'daterange'
  | 'file'
  | 'email'
  | 'url'
  | 'phone'
  | 'currency'
  | 'radio'
  | 'datetime'
  | 'section';

/** All 17 canonical field types, in declaration order (for iteration/validation). */
export const FIELD_TYPES: readonly FieldType[] = [
  'text',
  'textarea',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
  'combobox',
  'daterange',
  'file',
  'email',
  'url',
  'phone',
  'currency',
  'radio',
  'datetime',
  'section',
] as const;

/** Option-backed field types draw their valid values from `options`. */
export const OPTION_BACKED_TYPES: readonly FieldType[] = [
  'select',
  'multiselect',
  'combobox',
  'radio',
] as const;

/** FormOption is one choice of an option-backed field. */
export interface FormOption {
  value: string;
  label: LocalizedText;
}

/**
 * RuleKind enumerates the 12 declarative validation rule kinds. Mirrors the Go
 * `Rule*` constants exactly.
 */
export type RuleKind =
  | 'required'
  | 'min'
  | 'max'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'email'
  | 'url'
  | 'uuid'
  | 'cron'
  | 'enum'
  | 'requiredIf';

/** All 12 canonical rule kinds. */
export const RULE_KINDS: readonly RuleKind[] = [
  'required',
  'min',
  'max',
  'minLength',
  'maxLength',
  'pattern',
  'email',
  'url',
  'uuid',
  'cron',
  'enum',
  'requiredIf',
] as const;

/**
 * ConditionOperator enumerates the 13 condition operators. Mirrors the Go
 * `supportedOperators` set exactly. eq/neq/gt/gte/lt/lte/in/notIn/contains are
 * value comparisons; truthy/falsy/isSet/isEmpty are presence/truthiness checks
 * that ignore Condition.value.
 */
export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'truthy'
  | 'falsy'
  | 'isSet'
  | 'isEmpty';

/** All 13 canonical condition operators. */
export const CONDITION_OPERATORS: readonly ConditionOperator[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'contains',
  'truthy',
  'falsy',
  'isSet',
  'isEmpty',
] as const;

/**
 * Condition is one clause of a visibleWhen / requiredWhen / rule.when predicate.
 * It tests another field's submitted value. Multiple conditions in a list are
 * AND-combined (all must hold), matching `conditionsHold` in the Go validator.
 */
export interface Condition {
  /** Name of another field in the same form whose value the condition tests. */
  field: string;
  operator: ConditionOperator;
  /**
   * Literal compared against the field value. For in/notIn it is an array; for
   * contains it is the element looked for in a list (or substring in a string).
   * Ignored by truthy/falsy/isSet/isEmpty.
   */
  value?: unknown;
}

/**
 * ValidationRule is one declarative constraint on a field. `kind` names the
 * rule, `param` parameterizes it (min number, regex pattern, enum list, or a
 * Condition[] for requiredIf), `when` optionally gates the rule on other field
 * values, `message` is the bilingual override shown when the rule is violated.
 */
export interface ValidationRule {
  kind: RuleKind;
  param?: unknown;
  when?: Condition[];
  message?: LocalizedText;
}

/** Text direction for a field. "" / "auto" let the renderer choose; ltr/rtl force it. */
export type FieldDir = '' | 'auto' | 'ltr' | 'rtl';

/**
 * FormField is a single field of a FormDefinition — the CANONICAL shape. It is
 * deliberately widened so legacy flat fields (string label, string[] options,
 * the 6 original types) remain assignable:
 *   - label/placeholder/description: LocalizedText | string
 *   - options: FormOption[] | string[]
 */
export interface FormField {
  name: string;
  type: FieldType;
  label: LocalizedText | string;
  placeholder?: LocalizedText | string;
  description?: LocalizedText | string;
  required: boolean;
  default?: unknown;
  options?: FormOption[] | string[];
  validation?: ValidationRule[];
  visibleWhen?: Condition[];
  requiredWhen?: Condition[];
  dir?: FieldDir;
}

/**
 * FormDefinition is the persisted, versioned form blueprint. Mirrors the Go
 * `FormDefinition` (the audit/version columns live on the row, the bilingual
 * content is the JSONB body).
 */
export interface FormDefinition {
  id: string;
  tenant_id: string;
  name: string;
  version: number;
  locales: string[];
  default_locale: string;
  fields: FormField[];
  created_at?: string;
  updated_at?: string;
}

/** FormData is a submitted form's field-name -> value map. */
export type FormData = Record<string, unknown>;

/**
 * Violation is a single validation failure, mirroring the Go `Violation`.
 * `field` names the offending field ("" for a form-level problem), `rule` names
 * the kind of check that failed, `message` is the bilingual explanation.
 */
export interface Violation {
  field: string;
  rule: string;
  message: LocalizedText;
}
