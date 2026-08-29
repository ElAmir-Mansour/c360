import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { CatalogGallery } from './catalog-gallery';
import { integrationLabels } from '../_labels';
import type { CatalogEntry } from '@/lib/lex/integrations';

const { getCatalogResultMock } = vi.hoisted(() => ({
  getCatalogResultMock: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    getCatalogResult: getCatalogResultMock,
    lexIntegrationsApi: {
      ...actual.lexIntegrationsApi,
      getCatalogResult: getCatalogResultMock,
    },
  };
});

const t = integrationLabels.en;

const najizCatalog: CatalogEntry = {
  kind: 'najiz',
  maturity: 'gov_gated',
  prerequisite_steps: [
    { ar: 'تسجيل تكامل', en: 'Register Takamul access' },
    { ar: 'تفعيل', en: 'Activate' },
  ],
  callback_templates: {},
  ksa_tags: ['moj', 'najiz'],
  self_serve: false,
};

beforeEach(() => {
  getCatalogResultMock.mockReset();
  getCatalogResultMock.mockResolvedValue({
    entries: [najizCatalog],
    degraded: false,
  });
});

describe('CatalogGallery', () => {
  it('renders catalog cards folded with the static kind set', async () => {
    renderWithQuery(<CatalogGallery onPick={vi.fn()} />);

    // The live gov-gated entry plus the static fallback set all render.
    expect(await screen.findByText('Najiz (MoJ)')).toBeInTheDocument();
    expect(screen.getByText('Single Sign-On')).toBeInTheDocument();
  });

  it('shows an honest gov-gated maturity badge on gov-gated connectors', async () => {
    renderWithQuery(<CatalogGallery onPick={vi.fn()} />);
    await screen.findByText('Najiz (MoJ)');

    // The gov-gated maturity label must appear (honest "not self-serve" signal).
    expect(screen.getAllByText(t.catalogMaturityGovGated).length).toBeGreaterThan(0);
    // Self-serve connectors get the production badge.
    expect(screen.getAllByText(t.catalogMaturityProduction).length).toBeGreaterThan(0);
  });

  it('invokes onPick with the chosen connector kind', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<CatalogGallery onPick={onPick} />);

    const card = await screen.findByText('Najiz (MoJ)');
    await user.click(card);

    expect(onPick).toHaveBeenCalledWith('najiz');
  });

  it('filters the gallery by the search query', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CatalogGallery onPick={vi.fn()} />);
    await screen.findByText('Najiz (MoJ)');

    await user.type(screen.getByLabelText(t.catalogSearchPlaceholder), 'najiz');

    expect(screen.getByText('Najiz (MoJ)')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Single Sign-On')).toBeNull());
  });

  it('shows the empty state when no card matches the query', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CatalogGallery onPick={vi.fn()} />);
    await screen.findByText('Najiz (MoJ)');

    await user.type(screen.getByLabelText(t.catalogSearchPlaceholder), 'zzzz-no-match');

    expect(await screen.findByText(t.catalogEmptyTitle)).toBeInTheDocument();
  });

  it('warns but keeps the static fallback when the live catalog is degraded', async () => {
    getCatalogResultMock.mockResolvedValue({ entries: [], degraded: true });
    renderWithQuery(<CatalogGallery onPick={vi.fn()} />);

    expect(await screen.findByText(t.catalogErrorTitle)).toBeInTheDocument();
    expect(screen.getByText('Single Sign-On')).toBeInTheDocument();
  });

  it('filters to gov-gated only via the maturity tab', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CatalogGallery onPick={vi.fn()} />);
    await screen.findByText('Najiz (MoJ)');

    await user.click(screen.getByRole('tab', { name: t.catalogFilterGovGated }));

    expect(screen.getByText('Najiz (MoJ)')).toBeInTheDocument();
    // A production self-serve connector should be filtered out.
    await waitFor(() => expect(screen.queryByText('Single Sign-On')).toBeNull());
  });

  it('exposes search + filter tabs with accessible roles', async () => {
    renderWithQuery(<CatalogGallery onPick={vi.fn()} />);
    await screen.findByText('Najiz (MoJ)');

    expect(screen.getByLabelText(t.catalogSearchPlaceholder)).toBeInTheDocument();
    expect(screen.getAllByRole('tab').length).toBe(3);
  });

  it('renders the Arabic / RTL surface under the ar locale', async () => {
    const { container } = renderWithQuery(<CatalogGallery onPick={vi.fn()} />, { locale: 'ar' });

    expect(await screen.findByText('ناجز (وزارة العدل)')).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
