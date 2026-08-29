import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { User } from '@/types/models';
import { OrgUserPicker, type OrgUserPickerLabels } from './org-user-picker';

const apiGetMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ apiGet: apiGetMock }));

const labels: OrgUserPickerLabels = {
  user: 'User',
  selectUser: 'Select a user',
  searchUsers: 'Search by name or email…',
  loadingUsers: 'Loading users…',
  noUsers: 'No active users found.',
  usersLoadError: 'Could not load the user directory.',
  retry: 'Retry',
};

const amina = makeUser('user-amina', 'Amina', 'Hassan', 'amina@almashura.demo');
const omar = makeUser('user-omar', 'Omar', 'Saleh', 'omar@almashura.demo');

describe('OrgUserPicker', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
  });

  it('lists active tenant users by name and email while returning only the user ID', async () => {
    apiGetMock.mockResolvedValue(directoryResponse([amina, omar]));
    const onChange = vi.fn();
    const user = userEvent.setup();

    renderWithQuery(<ControlledPicker onChange={onChange} />);

    await waitFor(() =>
      expect(apiGetMock).toHaveBeenCalledWith(
        '/api/v1/users',
        expect.objectContaining({ page: 1, per_page: 50, status: 'active' }),
      ),
    );

    const trigger = screen.getByRole('combobox', { name: 'User' });
    expect(trigger).toHaveTextContent('Select a user');
    expect(screen.queryByPlaceholderText(/uuid/i)).not.toBeInTheDocument();

    await user.click(trigger);
    await user.click(
      await screen.findByRole('option', {
        name: /Amina Hassan.*amina@almashura\.demo/i,
      }),
    );

    expect(onChange).toHaveBeenCalledWith('user-amina');
    expect(trigger).toHaveTextContent('Amina Hassan');
    expect(trigger).toHaveTextContent('amina@almashura.demo');
  });

  it('searches the tenant directory by name or email on the server', async () => {
    apiGetMock.mockImplementation((_path: string, params: { search?: string }) =>
      Promise.resolve(directoryResponse(params.search === 'omar' ? [omar] : [amina, omar])),
    );
    const user = userEvent.setup();

    renderWithQuery(<OrgUserPicker id="user_id" enabled value="" onChange={vi.fn()} labels={labels} />);

    const trigger = screen.getByRole('combobox', { name: 'User' });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    await user.click(trigger);
    await screen.findByRole('option', { name: /Amina Hassan/i });

    await user.type(screen.getByPlaceholderText(labels.searchUsers), 'omar');

    await waitFor(() =>
      expect(apiGetMock).toHaveBeenLastCalledWith(
        '/api/v1/users',
        expect.objectContaining({ search: 'omar', status: 'active' }),
      ),
    );
    expect(await screen.findByRole('option', { name: /Omar Saleh/i })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('option', { name: /Amina Hassan/i })).not.toBeInTheDocument());
  });
});

function ControlledPicker({ onChange }: { onChange: (userId: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <OrgUserPicker
      id="user_id"
      enabled
      value={value}
      onChange={(userId) => {
        setValue(userId);
        onChange(userId);
      }}
      labels={labels}
    />
  );
}

function makeUser(id: string, firstName: string, lastName: string, email: string): User {
  return {
    id,
    tenant_id: 'tenant-1',
    email,
    first_name: firstName,
    last_name: lastName,
    status: 'active',
    mfa_enabled: false,
    last_login_at: null,
    roles: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function directoryResponse(users: User[]) {
  return {
    data: users,
    meta: {
      page: 1,
      per_page: 50,
      total: users.length,
      total_pages: 1,
    },
  };
}
