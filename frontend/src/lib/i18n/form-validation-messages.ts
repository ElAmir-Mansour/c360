/**
 * Resolver for the dynamic form engine's generic, parameterized validation
 * messages (the `dynamicForm.*` namespace in messages.ts). Mirrors the
 * lib/validation-messages.ts pattern: a name + locale resolves to the active
 * locale string, here with `{field}`/`{n}`/`{value}`/`{pattern}` interpolation.
 *
 * If a field carries an author-supplied bilingual `message` on its rule, that
 * always wins and these defaults are not used (matching backend `applyRule`,
 * where an authored Message overrides the default `enf(...)`).
 */
import { DEFAULT_LOCALE, type AppLocale } from '../i18n';
import { getMessages, readMessage, type MessageKey } from './messages';

/** The message keys this resolver covers — one per rule kind plus `type`. */
export type FormValidationMessageName =
  | 'required'
  | 'requiredIf'
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
  | 'type';

/** Interpolation parameters available to a message template. */
export interface FormMessageParams {
  /** Resolved (localized) field label. */
  field?: string;
  /** Numeric rule parameter (min/max/minLength/maxLength). */
  n?: number | string;
  /** Offending or compared value. */
  value?: unknown;
  /** Regex pattern (for `pattern`). */
  pattern?: string;
}

function key(name: FormValidationMessageName): MessageKey {
  return `dynamicForm.${name}` as MessageKey;
}

/** interpolate replaces `{token}` placeholders with their param values. */
function interpolate(template: string, params: FormMessageParams): string {
  return template.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = (params as Record<string, unknown>)[token];
    if (value === undefined || value === null) {
      return match;
    }
    return String(value);
  });
}

/**
 * getFormValidationMessage resolves a single dynamic-form message in `locale`
 * and interpolates `params`.
 */
export function getFormValidationMessage(
  name: FormValidationMessageName,
  params: FormMessageParams = {},
  locale: string | null | undefined = DEFAULT_LOCALE,
): string {
  const template = readMessage(getMessages(locale), key(name));
  return interpolate(template, params);
}

/** Bound resolver for a fixed locale (mirrors createValidationMessageResolver). */
export type FormValidationMessageResolver = (
  name: FormValidationMessageName,
  params?: FormMessageParams,
) => string;

export function createFormValidationMessageResolver(
  locale: string | null | undefined = DEFAULT_LOCALE,
): FormValidationMessageResolver {
  const resolvedLocale: AppLocale = (locale as AppLocale) ?? DEFAULT_LOCALE;
  return (name, params) => getFormValidationMessage(name, params, resolvedLocale);
}
