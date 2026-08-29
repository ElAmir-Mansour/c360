import { describe, expect, it } from 'vitest';
import { statisticHint } from './statistic-hint';

describe('statisticHint', () => {
  it('explains English actionable and summary statistics', () => {
    expect(statisticHint('Open matters')).toBe(
      'Open matters — open the records contributing to this statistic',
    );
    expect(statisticHint('Average cycle time', false)).toBe(
      'Average cycle time — calculated from the current scope',
    );
  });

  it('uses Arabic guidance when the metric label is Arabic', () => {
    expect(statisticHint('القضايا المفتوحة')).toBe(
      'القضايا المفتوحة — افتح السجلات المساهمة في هذه الإحصائية',
    );
  });
});
