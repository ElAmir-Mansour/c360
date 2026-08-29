import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { formatCurrencyCompact } from '@/lib/lex/ksa';
import type { PaginatedResponse } from '@/types/api';
import type { LexContractRecord, LexDashboard } from '@/types/suites';
import {
  ContractMoneyKpis,
  contractMoneyKpisLabels,
  formatOthersLine,
  moneyHeadline,
} from '@/app/(dashboard)/lex/contracts/_components/contract-money-kpis';
import { MONEY_KPI_SAMPLE_SIZE } from '@/app/(dashboard)/lex/contracts/_lib/use-portfolio-kpis';

const { getDashboardMock, listContractsMock } = vi.hoisted(() => ({
  getDashboardMock: vi.fn(),
  listContractsMock: vi.fn(),
}));

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: {
    lex: {
      getDashboard: getDashboardMock,
      listContracts: listContractsMock,
    },
  },
}));

/** A test-locale formatter bundle for the pure helpers. */
const en = {
  formatCurrencyCompact: (
    amount: number | string,
    options?: { currency?: string },
  ) => formatCurrencyCompact(amount, { locale: 'en', ...options }),
};

/**
 * Testing-library's default matcher normalizer collapses ALL whitespace
 * (including the no-break spaces Intl emits inside currency strings) to a
 * plain space — mirror that on expected strings for DOM queries.
 */
const domText = (value: string) => value.replace(/\s+/g, ' ').trim();

function row(total_value: number, currency = 'SAR'): LexContractRecord {
  return { total_value, currency } as LexContractRecord;
}

function page(
  rows: LexContractRecord[],
  total = rows.length,
): PaginatedResponse<LexContractRecord> {
  return {
    data: rows,
    meta: { page: 1, per_page: MONEY_KPI_SAMPLE_SIZE, total, total_pages: 1 },
  };
}

function dashboard(byCurrency: Record<string, number>, active: number): LexDashboard {
  return {
    kpis: { active_contracts: active },
    total_contract_value: { by_type: {}, by_currency: byCurrency },
  } as unknown as LexDashboard;
}

beforeEach(() => {
  getDashboardMock.mockReset();
  listContractsMock.mockReset();

  getDashboardMock.mockResolvedValue(dashboard({ SAR: 5_000_000, USD: 750_000 }, 42));
  listContractsMock.mockImplementation(({ filters }: { filters?: Record<string, string> }) => {
    if (filters?.status === 'pending_signature') {
      return Promise.resolve(page([row(90_000)]));
    }
    if (filters?.expiring_in_days === '30') {
      // Truncated sample: tenant has more matching rows than the window.
      return Promise.resolve(page([row(400_000), row(100_000)], 312));
    }
    if (filters?.expiring_in_days === '60') {
      return Promise.resolve(page([row(650_000)]));
    }
    return Promise.reject(new Error(`unexpected filters ${JSON.stringify(filters)}`));
  });
});

describe('ContractMoneyKpis', () => {
  it('uses a compact two-column grid and omits explanatory card copy', () => {
    const { container } = renderWithQuery(<ContractMoneyKpis />);

    expect(screen.getByRole('region', { name: contractMoneyKpisLabels.en.stripLabel }))
      .toHaveClass('grid-cols-2', 'gap-3');
    expect(container.querySelectorAll('.contract-kpi-card')).toHaveLength(4);
    expect(screen.queryByText(contractMoneyKpisLabels.en.portfolio.description))
      .not.toBeInTheDocument();
  });

  it('renders the exact SAR portfolio headline with other currencies as a sub-line', async () => {
    renderWithQuery(<ContractMoneyKpis />);

    expect(
      await screen.findByText(domText(en.formatCurrencyCompact(5_000_000))),
    ).toBeInTheDocument();
    // Non-SAR value is never summed into the headline — it rides the sub-line.
    expect(
      screen.getByText(domText(en.formatCurrencyCompact(750_000, { currency: 'USD' }))),
    ).toBeInTheDocument();
    // Footer carries the active-contract count from the dashboard KPIs.
    expect(screen.getByText(contractMoneyKpisLabels.en.portfolio.countLabel)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders exact bucket figures and flags truncated samples as ≥ lower bounds', async () => {
    renderWithQuery(<ContractMoneyKpis />);

    // 30d bucket was truncated (312 matching > 2 sampled) → "≥" marker + sampling footer.
    expect(
      await screen.findByText(domText(`≥ ${en.formatCurrencyCompact(500_000)}`)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(contractMoneyKpisLabels.en.topByValue(2)),
    ).toBeInTheDocument();
    expect(screen.getByText('312')).toBeInTheDocument();

    // 60d + pending-signature buckets are exact — no marker.
    expect(
      await screen.findByText(domText(en.formatCurrencyCompact(650_000))),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(domText(en.formatCurrencyCompact(90_000))),
    ).toBeInTheDocument();
  });

  it('renders Arabic titles and Arabic-Indic currency under the ar locale', async () => {
    renderWithQuery(<ContractMoneyKpis />, { locale: 'ar' });

    // Tile labels render once the tile leaves its loading skeleton.
    expect(
      await screen.findByText(contractMoneyKpisLabels.ar.portfolio.title),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        domText(formatCurrencyCompact(5_000_000, { locale: 'ar', currency: 'SAR' })),
      ),
    ).toBeInTheDocument();
  });

  it('exposes the strip as a labelled region', () => {
    renderWithQuery(<ContractMoneyKpis />);
    expect(
      screen.getByRole('region', { name: contractMoneyKpisLabels.en.stripLabel }),
    ).toBeInTheDocument();
  });
});

describe('moneyHeadline', () => {
  it('prefixes truncated samples with the ≥ lower-bound marker', () => {
    const exact = moneyHeadline(1_250_000, false, en);
    const partial = moneyHeadline(1_250_000, true, en);
    expect(exact).toBe(en.formatCurrencyCompact(1_250_000));
    expect(partial).toBe(`≥ ${exact}`);
  });
});

describe('formatOthersLine', () => {
  const more = contractMoneyKpisLabels.en.moreCurrencies;

  it('itemizes the top currencies and folds the rest into an overflow marker', () => {
    const line = formatOthersLine(
      [
        { currency: 'USD', amount: 1_200_000 },
        { currency: 'EUR', amount: 300_000 },
        { currency: 'GBP', amount: 50_000 },
      ],
      en,
      more,
    );
    expect(line).toBe(
      [
        en.formatCurrencyCompact(1_200_000, { currency: 'USD' }),
        en.formatCurrencyCompact(300_000, { currency: 'EUR' }),
        more(1),
      ].join(' · '),
    );
  });

  it('returns an empty line for an all-SAR portfolio', () => {
    expect(formatOthersLine([], en, more)).toBe('');
  });
});
