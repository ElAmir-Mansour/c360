import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEX_CONTRACT_INSIGHTS_ENDPOINT,
  type LexContractInsight,
  getContractInsights,
  insightFilterMapping,
  partitionDismissed,
  resolveInsightCopy,
} from './use-contract-insights';

const { fetchSuiteDataMock } = vi.hoisted(() => ({
  fetchSuiteDataMock: vi.fn(),
}));

vi.mock('@/lib/suite-api', () => ({
  fetchSuiteData: fetchSuiteDataMock,
}));

function insight(overrides: Partial<LexContractInsight> = {}): LexContractInsight {
  return {
    id: 'stale_draft',
    kind: 'stale_draft',
    severity: 'medium',
    title_en: 'Stale drafts',
    title_ar: 'مسودات راكدة',
    detail_en: '3 drafts untouched for 30+ days.',
    detail_ar: 'ثلاث مسودات دون تحديث منذ أكثر من 30 يومًا.',
    contract_ids: ['c-1', 'c-2', 'c-3'],
    metric: {},
    ...overrides,
  };
}

beforeEach(() => {
  fetchSuiteDataMock.mockReset();
});

describe('getContractInsights', () => {
  it('hits the insights endpoint with an empty query by default', async () => {
    fetchSuiteDataMock.mockResolvedValue({ insights: [] });

    await getContractInsights();

    expect(fetchSuiteDataMock).toHaveBeenCalledWith(LEX_CONTRACT_INSIGHTS_ENDPOINT, {});
  });

  it('forwards only the knobs the caller set', async () => {
    fetchSuiteDataMock.mockResolvedValue({ insights: [] });

    await getContractInsights({ window_days: 60 });

    expect(fetchSuiteDataMock).toHaveBeenCalledWith(LEX_CONTRACT_INSIGHTS_ENDPOINT, {
      window_days: 60,
    });
  });
});

describe('resolveInsightCopy', () => {
  it('picks the locale side of the bilingual payload', () => {
    const card = insight();
    expect(resolveInsightCopy(card, 'en')).toEqual({
      title: card.title_en,
      detail: card.detail_en,
    });
    expect(resolveInsightCopy(card, 'ar')).toEqual({
      title: card.title_ar,
      detail: card.detail_ar,
    });
  });

  it('falls back to English when the Arabic side is empty', () => {
    const card = insight({ title_ar: '', detail_ar: '' });
    expect(resolveInsightCopy(card, 'ar')).toEqual({
      title: card.title_en,
      detail: card.detail_en,
    });
  });
});

describe('insightFilterMapping', () => {
  it('maps renewal_opt_out_closing onto expiring_in_days over the report window', () => {
    expect(
      insightFilterMapping(
        insight({ kind: 'renewal_opt_out_closing', metric: { window_days: 45 } }),
      ),
    ).toEqual({ filters: { expiring_in_days: '45' } });
    // Missing metric falls back to the 30-day server default.
    expect(
      insightFilterMapping(insight({ kind: 'renewal_opt_out_closing', metric: {} })),
    ).toEqual({ filters: { expiring_in_days: '30' } });
  });

  it('maps stale_draft onto status=draft', () => {
    expect(insightFilterMapping(insight({ kind: 'stale_draft' }))).toEqual({
      filters: { status: 'draft' },
    });
  });

  it('maps value_outlier onto the cohort contract type when present', () => {
    expect(
      insightFilterMapping(
        insight({ kind: 'value_outlier', metric: { contract_type: 'service_agreement' } }),
      ),
    ).toEqual({ filters: { type: 'service_agreement' } });
    expect(insightFilterMapping(insight({ kind: 'value_outlier', metric: {} }))).toBeNull();
  });

  it('maps counterparty_concentration onto a party-B search', () => {
    expect(
      insightFilterMapping(
        insight({ kind: 'counterparty_concentration', metric: { party_b: 'Acme LLC' } }),
      ),
    ).toEqual({ filters: {}, search: 'Acme LLC' });
    expect(
      insightFilterMapping(insight({ kind: 'counterparty_concentration', metric: {} })),
    ).toBeNull();
  });

  it('returns null for kinds without a faithful list filter', () => {
    expect(insightFilterMapping(insight({ kind: 'missing_mandatory_clause' }))).toBeNull();
    expect(insightFilterMapping(insight({ kind: 'some_future_kind' }))).toBeNull();
  });
});

describe('partitionDismissed', () => {
  const ranked = [
    insight({ id: 'a' }),
    insight({ id: 'b' }),
    insight({ id: 'c' }),
  ];

  it('hides dismissed ids while preserving server rank order', () => {
    const { visible, dismissedCount } = partitionDismissed(ranked, ['b']);
    expect(visible.map((card) => card.id)).toEqual(['a', 'c']);
    expect(dismissedCount).toBe(1);
  });

  it('ignores dismissed ids the server no longer returns', () => {
    const { visible, dismissedCount } = partitionDismissed(ranked, ['gone']);
    expect(visible).toHaveLength(3);
    expect(dismissedCount).toBe(0);
  });

  it('handles the everything-dismissed and nothing-dismissed edges', () => {
    expect(partitionDismissed(ranked, ['a', 'b', 'c'])).toEqual({
      visible: [],
      dismissedCount: 3,
    });
    expect(partitionDismissed([], [])).toEqual({ visible: [], dismissedCount: 0 });
  });
});
