import { describe, expect, it, vi } from 'vitest';
import type { PaginatedResponse } from '@/types/api';
import type { LexContractRecord } from '@/types/suites';
import {
  MONEY_KPI_SAMPLE_SIZE,
  PRIMARY_CURRENCY,
  deriveMoneyBucket,
  splitPrimary,
  sumByCurrency,
} from './use-portfolio-kpis';

// The pure helpers never touch the network, but the module imports the API
// surface for the hook — stub it so this test stays hermetic.
vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: { lex: { getDashboard: vi.fn(), listContracts: vi.fn() } },
}));

/** Minimal row shape the money helpers read. */
function row(total_value: number | null, currency: string): LexContractRecord {
  return { total_value, currency } as LexContractRecord;
}

function page(
  rows: LexContractRecord[],
  total: number,
): PaginatedResponse<LexContractRecord> {
  return {
    data: rows,
    meta: { page: 1, per_page: MONEY_KPI_SAMPLE_SIZE, total, total_pages: 1 },
  };
}

describe('sumByCurrency', () => {
  it('sums per currency without ever mixing currencies', () => {
    const totals = sumByCurrency([
      row(1_000_000, 'SAR'),
      row(250_000, 'SAR'),
      row(80_000, 'USD'),
      row(20_000, 'usd'),
    ]);
    expect(totals).toEqual({ SAR: 1_250_000, USD: 100_000 });
  });

  it('attributes blank currency codes to SAR and skips unset/invalid values', () => {
    const totals = sumByCurrency([
      row(500, ''),
      row(300, '  sar '),
      row(null, 'SAR'),
      row(Number.NaN, 'USD'),
      row(0, 'EUR'),
    ]);
    expect(totals).toEqual({ [PRIMARY_CURRENCY]: 800 });
  });
});

describe('splitPrimary', () => {
  it('extracts the SAR figure and sorts the rest largest-first', () => {
    const split = splitPrimary({ USD: 100, SAR: 900, EUR: 400 });
    expect(split.primary).toBe(900);
    expect(split.others).toEqual([
      { currency: 'EUR', amount: 400 },
      { currency: 'USD', amount: 100 },
    ]);
  });

  it('returns a zero primary and no sub-line entries for empty totals', () => {
    expect(splitPrimary({})).toEqual({ primary: 0, others: [] });
  });

  it('drops zero-amount entries so an all-SAR book renders no sub-line', () => {
    const split = splitPrimary({ SAR: 1_000, USD: 0 });
    expect(split.others).toEqual([]);
  });
});

describe('deriveMoneyBucket', () => {
  it('marks the bucket partial when the tenant has more rows than the sample', () => {
    const bucket = deriveMoneyBucket(page([row(10, 'SAR'), row(5, 'SAR')], 312));
    expect(bucket.primary).toBe(15);
    expect(bucket.sampled).toBe(2);
    expect(bucket.totalContracts).toBe(312);
    expect(bucket.partial).toBe(true);
  });

  it('is exact (not partial) when every matching row was sampled', () => {
    const bucket = deriveMoneyBucket(page([row(10, 'SAR')], 1));
    expect(bucket.partial).toBe(false);
    expect(bucket.totalContracts).toBe(1);
  });

  it('degrades to an empty exact bucket before data arrives', () => {
    const bucket = deriveMoneyBucket(undefined);
    expect(bucket).toMatchObject({
      primary: 0,
      others: [],
      sampled: 0,
      totalContracts: 0,
      partial: false,
    });
  });
});
