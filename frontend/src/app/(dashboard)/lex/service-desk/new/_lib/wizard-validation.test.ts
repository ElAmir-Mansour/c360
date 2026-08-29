import { describe, expect, it } from 'vitest';
import {
  localIsoDate,
  localIsoDateTime,
  normalizeRequestedDueDate,
  validateRequestedDueDate,
  validateRequired,
  validateTitles,
} from './wizard-validation';

describe('request wizard validation', () => {
  it('requires at least one localized title', () => {
    expect(validateTitles(' ', '')).toBe('titleRequired');
    expect(validateTitles('Supply agreement', '')).toBeNull();
    expect(validateTitles('', 'اتفاقية توريد')).toBeNull();
  });

  it('validates required text after trimming', () => {
    expect(validateRequired(' \n ')).toBe(false);
    expect(validateRequired('Legal review')).toBe(true);
  });

  it('formats local calendar dates without a UTC shift', () => {
    expect(localIsoDate(new Date(2026, 6, 26, 23, 30))).toBe('2026-07-26');
  });

  it('requires a due date and rejects elapsed dates', () => {
    const today = new Date(2026, 6, 26, 9, 0);

    expect(validateRequestedDueDate('', today)).toBe('required');
    expect(validateRequestedDueDate('2026-07-25', today)).toBe('past');
    expect(validateRequestedDueDate('2026-07-26', today)).toBeNull();
    expect(validateRequestedDueDate('2026-08-10', today)).toBeNull();
  });

  it('formats a local wall-clock instant without a UTC shift', () => {
    expect(localIsoDateTime(new Date(2026, 6, 26, 23, 30))).toBe('2026-07-26T23:30');
    expect(localIsoDateTime(new Date(2026, 6, 26, 9, 5))).toBe('2026-07-26T09:05');
  });

  it('gives a legacy date-only value the whole day, not midnight', () => {
    expect(normalizeRequestedDueDate('2026-07-26')).toBe('2026-07-26T23:59');
    // Already an instant, or empty — left exactly as-is.
    expect(normalizeRequestedDueDate('2026-07-26T08:30')).toBe('2026-07-26T08:30');
    expect(normalizeRequestedDueDate('  ')).toBe('');
  });

  it('compares the time of day, not just the date', () => {
    const now = new Date(2026, 6, 26, 14, 0);

    expect(validateRequestedDueDate('2026-07-26T09:00', now)).toBe('past');
    expect(validateRequestedDueDate('2026-07-26T14:00', now)).toBeNull();
    expect(validateRequestedDueDate('2026-07-26T23:30', now)).toBeNull();
    // An Emergency request due within 24 hours is expressible now.
    expect(validateRequestedDueDate('2026-07-27T13:00', now)).toBeNull();
  });

  it('does not read a legacy same-day value as already elapsed', () => {
    // The regression this guards: comparing bare '2026-07-26' against
    // '2026-07-26T14:00' lexicographically would mark today's date past.
    expect(validateRequestedDueDate('2026-07-26', new Date(2026, 6, 26, 14, 0))).toBeNull();
  });
});
