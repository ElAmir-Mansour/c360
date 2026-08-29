import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { OrgRoleDialog } from './org-role-dialog';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  assignOrgRole: vi.fn(),
  showApiError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ apiGet: mocks.apiGet }));
vi.mock('@/lib/toast', () => ({
  showApiError: mocks.showApiError,
  showSuccess: mocks.showSuccess,
}));
vi.mock('@/lib/lex/admin', () => ({
  ORG_ROLE_KEYS: [
    'section_supervisor',
    'department_manager',
    'shared_services_manager',
    'legal_director',
    'contracts_manager',
    'compliance_officer',
    'general_counsel',
  ],
  lexAdminApi: { assignOrgRole: mocks.assignOrgRole },
}));

describe('OrgRoleDialog', () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.assignOrgRole.mockReset();
    mocks.showApiError.mockReset();
    mocks.showSuccess.mockReset();
    mocks.apiGet.mockResolvedValue({
      data: [
        {
          id: 'user-amina',
          tenant_id: 'tenant-1',
          email: 'amina@almashura.demo',
          first_name: 'Amina',
          last_name: 'Hassan',
          status: 'active',
          mfa_enabled: false,
          last_login_at: null,
          roles: [],
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      meta: { page: 1, per_page: 50, total: 1, total_pages: 1 },
    });
    mocks.assignOrgRole.mockResolvedValue({});
  });

  it('submits the selected user UUID internally without asking the administrator to type it', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderWithQuery(<OrgRoleDialog entityId="entity-1" open onOpenChange={onOpenChange} />);

    expect(screen.queryByPlaceholderText(/uuid/i)).not.toBeInTheDocument();
    const userPicker = screen.getByRole('combobox', { name: 'User' });
    await user.click(userPicker);
    await user.click(
      await screen.findByRole('option', {
        name: /Amina Hassan.*amina@almashura\.demo/i,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() =>
      expect(mocks.assignOrgRole).toHaveBeenCalledWith('entity-1', {
        role_key: 'department_manager',
        user_id: 'user-amina',
        label: { ar: '', en: '' },
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('requires a user selection', async () => {
    const user = userEvent.setup();

    renderWithQuery(<OrgRoleDialog entityId="entity-1" open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Select a user.');
    expect(mocks.assignOrgRole).not.toHaveBeenCalled();
  });
});
