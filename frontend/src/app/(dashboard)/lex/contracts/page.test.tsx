import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexContractsPage from '@/app/(dashboard)/lex/contracts/page';
import {
  contractsListLabels,
  resolveContractsListLabels,
} from '@/app/(dashboard)/lex/contracts/_lib/contracts-labels';
import type { LexContract } from '@/types/suites';

const {
  fetchSuitePaginatedMock,
  renewalWarningsMock,
  dashboardMock,
  listContractsMock,
  pushMock,
  searchParamsRef,
} = vi.hoisted(() => ({
  fetchSuitePaginatedMock: vi.fn(),
  renewalWarningsMock: vi.fn(),
  dashboardMock: vi.fn(),
  listContractsMock: vi.fn(),
  pushMock: vi.fn(),
  // Mutable so a test can render the page as if it ARRIVED on a given slice.
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/lex/contracts',
  useSearchParams: () => searchParamsRef.current,
  useParams: () => ({}),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'u-1' },
  }),
}));

vi.mock('@/lib/suite-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suite-api')>('@/lib/suite-api');
  return {
    ...actual,
    fetchSuitePaginated: fetchSuitePaginatedMock,
  };
});

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>('@/lib/enterprise');
  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      lex: {
        ...actual.enterpriseApi.lex,
        getContractRenewalWarnings: renewalWarningsMock,
        getDashboard: dashboardMock,
        listContracts: listContractsMock,
      },
    },
  };
});

const contract: LexContract = {
  id: 'contract-1',
  tenant_id: 'tenant-1',
  title: 'Master Services Agreement',
  contract_number: 'LEX-2026-001',
  type: 'service_agreement',
  description: 'Primary commercial agreement.',
  party_a_name: 'Clario360 Ltd.',
  party_b_name: 'Acme Holdings',
  total_value: 125000,
  currency: 'SAR',
  auto_renew: false,
  renewal_notice_days: 30,
  status: 'active',
  owner_user_id: 'u-1',
  owner_name: 'Sara Owner',
  risk_level: 'medium',
  analysis_status: 'complete',
  document_text: '',
  current_version: 1,
  tags: [],
  metadata: {},
  created_by: 'u-1',
  created_at: '2026-06-01T09:00:00Z',
  updated_at: '2026-06-02T09:00:00Z',
} as unknown as LexContract;

beforeEach(() => {
  fetchSuitePaginatedMock.mockReset();
  fetchSuitePaginatedMock.mockResolvedValue({
    data: [contract],
    meta: { page: 1, per_page: 25, total: 1, total_pages: 1 },
  });
  renewalWarningsMock.mockReset();
  renewalWarningsMock.mockResolvedValue({ total: 6, urgent: 5, warning: 1 });
  // Money-KPI sources: the tiles only leave their skeleton once these settle.
  dashboardMock.mockReset();
  dashboardMock.mockResolvedValue({
    kpis: { active_contracts: 32 },
    total_contract_value: { by_type: {}, by_currency: { SAR: 21_800_000 } },
  });
  listContractsMock.mockReset();
  listContractsMock.mockResolvedValue({
    data: [contract],
    meta: { page: 1, per_page: 200, total: 1, total_pages: 1 },
  });
  pushMock.mockReset();
  searchParamsRef.current = new URLSearchParams();
});

/**
 * Click a tile and return every register query it navigated to, each minus the
 * constant page reset.
 *
 * All of them, not just the last: the router mock never feeds the new URL back
 * into `useSearchParams`, so mounted controls that sync themselves through the
 * query string (SearchInput re-emits its debounced value) keep re-pushing the
 * CURRENT state around the one navigation under test. Those echoes are the
 * unchanged query by construction, so they can never be mistaken for the
 * select/deselect assertions below.
 */
async function queriesAfterClicking(
  user: ReturnType<typeof userEvent.setup>,
  tile: HTMLElement,
): Promise<Array<Record<string, string>>> {
  pushMock.mockClear();
  await user.click(tile);
  await waitFor(() => expect(pushMock).toHaveBeenCalled());

  return pushMock.mock.calls.map((call) => {
    const [, query = ''] = String(call[0] ?? '').split('?');
    const params = new URLSearchParams(query);
    params.delete('page');
    return Object.fromEntries(params);
  });
}

describe('Lex contracts list', () => {
  it('renders the English surface and a contract row under the default locale', async () => {
    renderWithQuery(<LexContractsPage />);

    expect(await screen.findByText(contractsListLabels.en.pageTitle)).toBeInTheDocument();
    expect(
      await screen.findByPlaceholderText(contractsListLabels.en.searchPlaceholder),
    ).toBeInTheDocument();
    // The fetched contract row renders (title is a link to the detail page).
    // DataTable renders desktop + responsive views, so there may be several.
    expect(
      (await screen.findAllByRole('link', { name: contract.title })).length,
    ).toBeGreaterThan(0);
    // The create action mounts when the user has lex:write.
    expect(screen.getByText(contractsListLabels.en.createContract)).toBeInTheDocument();
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    const ar = resolveContractsListLabels('ar');
    renderWithQuery(<LexContractsPage />, { locale: 'ar' });

    expect(await screen.findByText(ar.pageTitle)).toBeInTheDocument();
    expect(screen.getByText(ar.createContract)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(ar.searchPlaceholder),
    ).toBeInTheDocument();

    const rtlRoot = document.querySelector('[dir="rtl"][lang="ar"]');
    expect(rtlRoot).not.toBeNull();
  });

  /**
   * REGRESSION: "Review renewals" reads as a dead click. It only applies the
   * `expiring_in_days=30` preset, so arriving on a URL that already carries that
   * filter left the click with nothing to change — and the results it filters
   * sit far below the banner either way. The CTA must always move the operator
   * to the rows it is talking about.
   */
  it('moves to the results when the renewal banner CTA is clicked', async () => {
    const user = userEvent.setup();
    // jsdom implements no scrolling; the shared setup defines a non-writable
    // scrollIntoView on HTMLElement.prototype, so the spy has to be installed
    // there via defineProperty (an Element.prototype assignment is shadowed by
    // it, and a plain assignment throws).
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      renderWithQuery(<LexContractsPage />);

      const triage = await screen.findByRole('button', { name: 'Review renewals' });
      await user.click(triage);

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      expect(scrollIntoView.mock.instances[0]).toBe(
        document.getElementById('contract-results'),
      );
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: original,
      });
    }
  });

  /**
   * REGRESSION: clicking the money tile "Value pending signature" navigated to
   * `?status=pending_signature`, which lit up a DIFFERENT card — the count tile
   * "Out for signature" — while the tile actually clicked stayed unselected.
   * The two cover the same rows and are told apart by their ordering, so the
   * clicked tile must own the by-value sort and read as pressed by itself.
   */
  it('selects the money tile itself, not the count tile over the same rows', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexContractsPage />);

    const tile = await screen.findByRole('button', { name: /Value pending signature/ });

    expect(await queriesAfterClicking(user, tile)).toContainEqual({
      status: 'pending_signature',
      sort: 'total_value',
      order: 'desc',
    });
  });

  it('presses only the tile whose slice is showing', async () => {
    searchParamsRef.current = new URLSearchParams(
      'status=pending_signature&sort=total_value&order=desc',
    );
    renderWithQuery(<LexContractsPage />);

    expect(
      await screen.findByRole('button', { name: /Value pending signature/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    // Same filter, register default ordering — a different view, so not pressed.
    expect(
      await screen.findByRole('button', { name: /Out for signature/ }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('clears the slice when the selected tile is clicked again', async () => {
    const user = userEvent.setup();
    searchParamsRef.current = new URLSearchParams(
      'status=pending_signature&sort=total_value&order=desc',
    );
    renderWithQuery(<LexContractsPage />);

    const tile = await screen.findByRole('button', { name: /Value pending signature/ });

    // Deselecting drops the filter AND the ordering the tile brought with it.
    expect(await queriesAfterClicking(user, tile)).toContainEqual({});
  });

  it('toggles a count tile off through its preset', async () => {
    const user = userEvent.setup();
    searchParamsRef.current = new URLSearchParams('status=pending_signature');
    renderWithQuery(<LexContractsPage />);

    const tile = await screen.findByRole('button', { name: /Out for signature/ });
    expect(tile).toHaveAttribute('aria-pressed', 'true');

    expect(await queriesAfterClicking(user, tile)).toContainEqual({});
  });
});
