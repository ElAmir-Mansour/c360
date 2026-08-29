import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import {
  ContractsEntityRollupPanel,
  ContractsPortfolioTcvFooter,
  contractsEntityRollupLabels,
} from '@/app/(dashboard)/lex/contracts/_components/contracts-entity-rollup';
import {
  buildEntityRollupQuery,
  sumRollupValueByCurrency,
  type ContractEntityRollup,
} from '@/app/(dashboard)/lex/contracts/_lib/use-entity-rollup';

const { fetchSuiteDataMock } = vi.hoisted(() => ({
  fetchSuiteDataMock: vi.fn(),
}));

vi.mock('@/lib/suite-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suite-api')>('@/lib/suite-api');
  return {
    ...actual,
    fetchSuiteData: fetchSuiteDataMock,
  };
});

const rollupFixture: ContractEntityRollup = {
  tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  generated_at: '2026-07-09T00:00:00Z',
  filters: {},
  total: 8,
  items: [
    {
      entity_id: 'e-1',
      entity_code: 'AAIC-HQ',
      entity_name: { en: 'Al Othaim HQ', ar: 'المقر الرئيسي' },
      count: 5,
      total_value_by_currency: { SAR: 1_500_000 },
    },
    {
      entity_id: 'e-2',
      entity_code: 'AAIC-RE',
      entity_name: { en: 'Real Estate Arm', ar: 'ذراع العقارات' },
      count: 2,
      total_value_by_currency: { SAR: 250_000, USD: 10_000 },
    },
    // Unassigned bucket — no entity link, non-interactive.
    { count: 1, total_value_by_currency: {} },
  ],
};

beforeEach(() => {
  fetchSuiteDataMock.mockReset();
  fetchSuiteDataMock.mockResolvedValue(rollupFixture);
});

describe('buildEntityRollupQuery', () => {
  it('flattens the active table filters and drops empty values', () => {
    expect(
      buildEntityRollupQuery({
        filters: {
          status: 'active',
          tag: '',
          type: ['vendor', 'lease'],
          org_entity_id: 'e-1',
        },
        search: '  msa ',
      }),
    ).toEqual({
      status: 'active',
      type: 'vendor,lease',
      org_entity_id: 'e-1',
      search: 'msa',
    });
  });
});

describe('sumRollupValueByCurrency', () => {
  it('sums buckets per currency with SAR ordered first', () => {
    expect(sumRollupValueByCurrency(rollupFixture.items)).toEqual([
      { currency: 'SAR', amount: 1_750_000 },
      { currency: 'USD', amount: 10_000 },
    ]);
  });
});

describe('ContractsEntityRollupPanel', () => {
  it('renders per-entity buckets in English and filters on click', async () => {
    const onSelectEntity = vi.fn();
    renderWithQuery(
      <ContractsEntityRollupPanel
        filters={{ status: 'active' }}
        onSelectEntity={onSelectEntity}
      />,
    );

    expect(
      screen.getByText(contractsEntityRollupLabels.en.panelTitle),
    ).toBeInTheDocument();
    expect(await screen.findByText('Al Othaim HQ')).toBeInTheDocument();
    expect(screen.getByText('AAIC-RE')).toBeInTheDocument();
    expect(
      screen.getByText(contractsEntityRollupLabels.en.unassigned),
    ).toBeInTheDocument();

    // The rollup was requested over the SAME scope the table shows.
    expect(fetchSuiteDataMock).toHaveBeenCalledWith(
      '/api/v1/lex/contracts/entity-rollup',
      { status: 'active' },
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: contractsEntityRollupLabels.en.filterByEntity('Al Othaim HQ'),
      }),
    );
    expect(onSelectEntity).toHaveBeenCalledWith('e-1');
  });

  it('toggles the active bucket off (clears the facet)', async () => {
    const onSelectEntity = vi.fn();
    renderWithQuery(
      <ContractsEntityRollupPanel
        filters={{}}
        activeEntityId="e-1"
        onSelectEntity={onSelectEntity}
      />,
    );

    const activeRow = await screen.findByRole('button', {
      name: contractsEntityRollupLabels.en.clearEntityFilter('Al Othaim HQ'),
    });
    expect(activeRow).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(activeRow);
    expect(onSelectEntity).toHaveBeenCalledWith(undefined);
  });

  it('renders Arabic labels and Arabic entity names under the ar locale', async () => {
    renderWithQuery(
      <ContractsEntityRollupPanel filters={{}} onSelectEntity={vi.fn()} />,
      { locale: 'ar' },
    );

    expect(
      screen.getByText(contractsEntityRollupLabels.ar.panelTitle),
    ).toBeInTheDocument();
    expect(await screen.findByText('المقر الرئيسي')).toBeInTheDocument();
    expect(
      screen.getByText(contractsEntityRollupLabels.ar.unassigned),
    ).toBeInTheDocument();
  });
});

describe('ContractsPortfolioTcvFooter', () => {
  it('renders the portfolio TCV line with the in-scope contract count', async () => {
    renderWithQuery(<ContractsPortfolioTcvFooter filters={{}} />);

    expect(
      await screen.findByText(contractsEntityRollupLabels.en.footerLead),
    ).toBeInTheDocument();
    expect(
      screen.getByText(contractsEntityRollupLabels.en.footerContracts('8')),
    ).toBeInTheDocument();
  });

  it('renders nothing when the scope is empty', async () => {
    fetchSuiteDataMock.mockResolvedValue({ ...rollupFixture, total: 0, items: [] });
    const { container } = renderWithQuery(<ContractsPortfolioTcvFooter filters={{}} />);

    // Wait for the query to settle, then assert the footer stayed unmounted.
    await vi.waitFor(() => expect(fetchSuiteDataMock).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(
        container.querySelector('[role="status"]'),
      ).toBeNull(),
    );
  });
});
