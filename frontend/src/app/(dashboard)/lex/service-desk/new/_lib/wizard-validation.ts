/**
 * Pure validators and constants for the "New Legal Request" wizard Details step
 * (improvement #7: polished bilingual title + description fields).
 *
 * These functions are framework-free and side-effect-free so they can be reused
 * by the wizard's step validators and unit-tested in isolation. They return
 * stable error *keys* (not display strings); the calling component resolves the
 * key to localized copy via `_lib/details-i18n.ts`.
 */

/** Maximum length, in characters, for either title field. */
export const TITLE_MAX = 160;

/** Maximum length, in characters, for the description field. */
export const DESCRIPTION_MAX = 2000;

/** Error key returned by {@link validateTitles} when neither title is provided. */
export type TitleErrorKey = 'titleRequired';

/**
 * Validate the bilingual title pair. At least one of the two titles must contain
 * non-whitespace content.
 *
 * @returns `null` when valid; otherwise the error key `'titleRequired'`.
 */
export function validateTitles(titleEn: string, titleAr: string): TitleErrorKey | null {
  if (titleEn.trim().length === 0 && titleAr.trim().length === 0) {
    return 'titleRequired';
  }
  return null;
}

/**
 * True when `value` contains at least one non-whitespace character.
 *
 * A generic "required" predicate used for the description field (and reusable by
 * the parent wizard for other free-text inputs).
 */
export function validateRequired(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Returns today's local calendar date in the same sortable shape emitted by a
 * native `<input type="date">`. Using local components avoids UTC midnight
 * shifting the validation boundary for Saudi users.
 */
export function localIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Local wall-clock instant in the shape emitted by `<input type="datetime-local">`
 * (`YYYY-MM-DDTHH:mm`). Local components again, for the same reason as
 * {@link localIsoDate}: a UTC parse would shift the boundary for Saudi users.
 */
export function localIsoDateTime(value: Date): string {
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${localIsoDate(value)}T${hours}:${minutes}`;
}

/**
 * End of the working day, used when a date-only value has to be given a time.
 * "Due on the 9th" has always meant the whole of the 9th was available, so
 * widening it to an instant must not silently retract that to midnight.
 */
const END_OF_DAY = 'T23:59';

/**
 * Coerce a stored value to the datetime shape the input and the comparison both
 * expect. Requests created before the field carried a time hold a bare
 * `YYYY-MM-DD` in `metadata.requested_due_date`; a `datetime-local` input
 * rejects those outright and would render blank, silently dropping the user's
 * date. Empty stays empty so "not set" is still expressible.
 */
export function normalizeRequestedDueDate(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}${END_OF_DAY}` : normalized;
}

/**
 * The intake contract makes the requested due date mandatory and does not allow
 * an instant that has already elapsed. Both operands are normalized to
 * `YYYY-MM-DDTHH:mm` first, which is lexicographically sortable, so no
 * timezone-bearing Date parse is needed — and a legacy date-only value is
 * compared as end-of-day rather than midnight, so today's date does not read as
 * past for a request captured before the time component existed.
 */
export function validateRequestedDueDate(
  value: string,
  now: Date = new Date(),
): 'required' | 'past' | null {
  const normalized = normalizeRequestedDueDate(value);
  if (!normalized) return 'required';
  return normalized < localIsoDateTime(now) ? 'past' : null;
}
