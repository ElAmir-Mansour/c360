import { describe, expect, it } from 'vitest';
import {
  RISK_LEVEL_ORDER,
  SPEND_OTHER_KEY,
  deriveCurrencyTotals,
  deriveRiskSlices,
  deriveSpendRows,
  parseCliffMonth,
  summarizeExpiryCliff,
  toContractAnalyticsScope,
} from './contracts-analytics';
import type { LexValueBucket } from '@/lib/lex/reports';

describe('toContractAnalyticsScope', () => {
  it('maps single-valued department/status/type filters onto the query', () => {
    expect(
      toContractAnalyticsScope({
        department: 'Procurement',
        status: 'active',
        type: 'vendor',
      }),
    ).toEqual({
      query: { department: 'Procurement', status: 'active', type: 'vendor' },
      unsupportedKeys: [],
    });
  });

  it('reports multi-valued and unknown filters as unsupported (sorted)', () => {
    const scope = toContractAnalyticsScope({
      type: ['vendor', 'lease'],
      risk_level: 'high',
      tag: 'msa',
      department: 'Legal',
    });
    expect(scope.query).toEqual({ department: 'Legal' });
    expect(scope.unsupportedKeys).toEqual(['risk_level', 'tag', 'type']);
  });

  it('ignores empty values entirely', () => {
    expect(toContractAnalyticsScope({ status: '', tag: [''] })).toEqual({
      query: {},
      unsupportedKeys: [],
    });
  });
});

describe('deriveSpendRows', () => {
  const bucket = (key: string, count: number, value: number): LexValueBucket => ({
    key,
    count,
    total_value: value,
    by_currency: null,
  });

  it('sorts by value descending and preserves counts', () => {
    expect(deriveSpendRows([bucket('nda', 4, 100), bucket('vendor', 2, 900)])).toEqual([
      { key: 'vendor', count: 2, value: 900 },
      { key: 'nda', count: 4, value: 100 },
    ]);
  });

  it('folds the long tail into a single Other row', () => {
    const buckets = Array.from({ length: 10 }, (_, i) =>
      bucket(`type_${i}`, 1, 1000 - i * 10),
    );
    const rows = deriveSpendRows(buckets, 8);
    expect(rows).toHaveLength(8);
    const tail = rows[7];
    expect(tail.key).toBe(SPEND_OTHER_KEY);
    // Rows 8..10 (values 930/920/910, one contract each) fold together.
    expect(tail.count).toBe(3);
    expect(tail.value).toBe(930 + 920 + 910);
  });

  it('returns [] for empty/null input', () => {
    expect(deriveSpendRows(null)).toEqual([]);
    expect(deriveSpendRows([])).toEqual([]);
  });
});

describe('summarizeExpiryCliff', () => {
  const points = Array.from({ length: 24 }, (_, i) => ({
    month: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
    count: 1,
    value: 100,
  }));

  it('sums only the leading horizon months', () => {
    expect(summarizeExpiryCliff(points, 12)).toEqual({ months: 12, count: 12, value: 1200 });
  });

  it('clamps to the series length and handles null', () => {
    expect(summarizeExpiryCliff(points.slice(0, 3), 12)).toEqual({
      months: 3,
      count: 3,
      value: 300,
    });
    expect(summarizeExpiryCliff(null)).toEqual({ months: 0, count: 0, value: 0 });
  });
});

describe('deriveRiskSlices', () => {
  it('orders known levels by severity and appends unknown keys', () => {
    expect(
      deriveRiskSlices({ low: 5, critical: 1, unknown_extra: 2, medium: 0 }),
    ).toEqual([
      { key: 'critical', count: 1 },
      { key: 'low', count: 5 },
      { key: 'unknown_extra', count: 2 },
    ]);
  });

  it('drops zero-count levels and handles null', () => {
    expect(deriveRiskSlices({ high: 0 })).toEqual([]);
    expect(deriveRiskSlices(null)).toEqual([]);
  });

  it('keeps the canonical order constant in sync with the severity ramp', () => {
    expect(RISK_LEVEL_ORDER).toEqual(['critical', 'high', 'medium', 'low', 'none']);
  });
});

describe('deriveCurrencyTotals', () => {
  it('orders SAR first, then by value descending, capped at the limit', () => {
    expect(
      deriveCurrencyTotals({ USD: 500, SAR: 100, EUR: 900, GBP: 50 }, 3),
    ).toEqual([
      { currency: 'SAR', value: 100 },
      { currency: 'EUR', value: 900 },
      { currency: 'USD', value: 500 },
    ]);
  });

  it('drops zero values and handles null', () => {
    expect(deriveCurrencyTotals({ SAR: 0 })).toEqual([]);
    expect(deriveCurrencyTotals(null)).toEqual([]);
  });
});

describe('parseCliffMonth', () => {
  it('parses a YYYY-MM token to the 1st at local midnight', () => {
    const date = parseCliffMonth('2026-07');
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(6);
    expect(date!.getDate()).toBe(1);
  });

  it('rejects malformed tokens', () => {
    expect(parseCliffMonth('2026-13')).toBeNull();
    expect(parseCliffMonth('2026-7')).toBeNull();
    expect(parseCliffMonth('july')).toBeNull();
  });
});
