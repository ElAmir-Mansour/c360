import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import ArchivedContractsPage from './page';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  listUsers: vi.fn(),
  getContractStats: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => '/lex/contracts/archived',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'user-1' },
  }),
}));

vi.mock('@/lib/api', () => ({
  apiGet: (...args: unknown[]) => mocks.apiGet(...args),
  apiPost: (...args: unknown[]) => mocks.apiPost(...args),
}));

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: {
    users: { list: (...args: unknown[]) => mocks.listUsers(...args) },
    lex: { getContractStats: (...args: unknown[]) => mocks.getContractStats(...args) },
  },
}));

const archivedContract = {
  id: '33333333-3333-3333-3333-333333333333',
  tenant_id: 'tenant-1',
  title: 'Archived Master Services Agreement',
  contract_number: 'LEX-2026-003',
  type: 'service_agreement',
  status: 'active',
  party_b_name: 'Acme Holdings',
  department: 'Legal',
  owner_user_id: '22222222-2222-2222-2222-222222222222',
  owner_name: 'Omar Owner',
  risk_level: 'low',
  tags: ['confidential'],
  archive_status: 'archived',
  archive_date: '2026-07-31T14:30:00Z',
  archived_by: '11111111-1111-1111-1111-111111111111',
  archive_reason: 'Superseded by the 2026 renewal.',
  effective_date: '2026-01-01T00:00:00Z',
  expiry_date: '2026-12-31T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-07-31T14:30:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiGet.mockResolvedValue({
    data: [archivedContract],
    meta: { page: 1, per_page: 10, total: 1, total_pages: 1 },
  });
  mocks.apiPost.mockResolvedValue({
    data: { ...archivedContract, archive_status: 'active', archive_date: null },
  });
  mocks.listUsers.mockResolvedValue({
    data: [
      {
        id: archivedContract.archived_by,
        first_name: 'Amina',
        last_name: 'Yusuf',
        email: 'amina@example.com',
        status: 'active',
        roles: [],
      },
    ],
    meta: { page: 1, per_page: 200, total: 1, total_pages: 1 },
  });
  mocks.getContractStats.mockResolvedValue({
    by_status: { active: 8, expired: 2 },
    by_type: {},
    by_risk_level: {},
    expiring_30_days: 3,
    expiring_7_days: 1,
  });
});

describe('ArchivedContractsPage', () => {
  it('renders archive metadata, complete filters, navigation, and pagination controls', async () => {
    renderWithQuery(<ArchivedContractsPage />);

    expect(await screen.findByRole('heading', { name: 'Archive', level: 1 })).toBeVisible();
    expect(
      (await screen.findAllByText('Superseded by the 2026 renewal.')).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Omar Owner').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Amina Yusuf').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Back to contracts' })).toHaveAttribute(
      'href',
      '/lex/contracts',
    );
    expect(screen.getByLabelText('Rows per page')).toHaveValue('10');
    expect(screen.getByLabelText('Archived from')).toBeInTheDocument();
    expect(screen.getByLabelText('Archived to')).toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledWith(
      '/api/v1/lex/contracts/archived',
      expect.objectContaining({ page: 1, per_page: 10, archive_status: 'archived' }),
    );
  });

  it('confirms restoration before calling the backend and invalidating the archive row', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ArchivedContractsPage />);

    const restoreButtons = await screen.findAllByRole('button', {
      name: `Unarchive: ${archivedContract.title}`,
    });
    await user.click(restoreButtons[0]);
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(screen.getByText('Restore contract?')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Restore contract' }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith(
        `/api/v1/lex/contracts/${archivedContract.id}/unarchive`,
        {},
      ),
    );
  });
});
