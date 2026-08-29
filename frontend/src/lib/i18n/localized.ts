/**
 * Helpers for the bilingual {@link LocalizedText} form model. They mirror the Go
 * `LocalizedText.Localize` / `UnmarshalJSON` semantics so the FE resolves and
 * normalizes author-facing text the same way the backend does:
 *   - a bare string is legacy and is returned/assigned as-is to BOTH locales
 *   - an object resolves to the requested locale, falling back to en, then ar
 */
import type { AppLocale } from '../i18n';
import type { FormOption, LocalizedText } from '@/types/forms';

/**
 * isLocalizedText is a runtime guard distinguishing the object form from a bare
 * legacy string.
 */
export function isLocalizedText(value: unknown): value is LocalizedText {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('ar' in value || 'en' in value)
  );
}

/**
 * resolveLocalized returns the display string for `value` in `locale`.
 *  - `undefined`/`null` -> "" (nothing to show)
 *  - a bare string -> returned as-is (legacy single-locale label)
 *  - a LocalizedText -> value[locale], falling back to en, then ar, then ""
 *
 * Mirrors backend `LocalizedText.Localize` with an added cross-locale fallback
 * so a partially-translated label still renders something.
 */
export function resolveLocalized(
  value: string | LocalizedText | null | undefined,
  locale: AppLocale,
): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  const ar = value.ar ?? '';
  const en = value.en ?? '';
  if (locale === 'ar') {
    return ar || en || '';
  }
  return en || ar || '';
}

/**
 * normalizeLocalized coerces any accepted label shape into a full
 * {@link LocalizedText}. A bare string is assigned to BOTH locales (matching the
 * Go `UnmarshalJSON` bare-string branch); an object is filled out with empty
 * strings for any missing side.
 */
export function normalizeLocalized(
  value: string | LocalizedText | null | undefined,
): LocalizedText {
  if (value === null || value === undefined) {
    return { ar: '', en: '' };
  }
  if (typeof value === 'string') {
    return { ar: value, en: value };
  }
  return { ar: value.ar ?? '', en: value.en ?? '' };
}

/**
 * normalizeOptions coerces an option list of either shape into FormOption[].
 * A bare string `s` becomes `{ value: s, label: { ar: s, en: s } }` (legacy
 * select options); a FormOption is passed through with its label normalized.
 */
export function normalizeOptions(
  options: FormOption[] | string[] | null | undefined,
): FormOption[] {
  if (!options || options.length === 0) {
    return [];
  }
  return options.map((opt) => {
    if (typeof opt === 'string') {
      return { value: opt, label: { ar: opt, en: opt } };
    }
    return { value: opt.value, label: normalizeLocalized(opt.label) };
  });
}
