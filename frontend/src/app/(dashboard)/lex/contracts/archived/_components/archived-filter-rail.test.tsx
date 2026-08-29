import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ArchivedFilterRail } from './archived-filter-rail';
import type { ArchivedFiltersState } from '../_lib/use-archived-contracts';

const filters: ArchivedFiltersState = {
  search: '',
  archiveFrom: undefined,
  archiveTo: undefined,
  archivedBy: '',
  status: '',
  type: '',
  department: '',
  ownerUserId: '',
  tag: '',
};

const users = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    first_name: 'Amina',
    last_name: 'Yusuf',
    email: 'amina@example.com',
    status: 'active',
    roles: [],
  },
];

describe('ArchivedFilterRail', () => {
  it('exposes every backend archive filter and reset action', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    const onReset = vi.fn();

    renderWithQuery(
      <ArchivedFilterRail
        filters={filters}
        users={users}
        activeFilterCount={2}
        onPatch={onPatch}
        onReset={onReset}
      />,
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search archived contracts' }), 'msa');
    await user.selectOptions(screen.getByLabelText('Original type'), 'vendor');
    await user.selectOptions(screen.getByLabelText('Original status'), 'active');
    await user.type(screen.getByLabelText('Archived from'), '2026-07-01');
    await user.type(screen.getByLabelText('Archived to'), '2026-07-31');
    await user.selectOptions(screen.getByLabelText('Archived by'), users[0].id);
    await user.selectOptions(screen.getByLabelText('Owner'), users[0].id);
    await user.type(screen.getByLabelText('Department'), 'Legal');
    await user.type(screen.getByLabelText('Tag'), 'confidential');
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));

    expect(onPatch).toHaveBeenCalledWith({ search: expect.any(String) });
    expect(onPatch).toHaveBeenCalledWith({ type: 'vendor' });
    expect(onPatch).toHaveBeenCalledWith({ status: 'active' });
    expect(onPatch).toHaveBeenCalledWith({ archiveFrom: '2026-07-01' });
    expect(onPatch).toHaveBeenCalledWith({ archiveTo: '2026-07-31' });
    expect(onPatch).toHaveBeenCalledWith({ archivedBy: users[0].id });
    expect(onPatch).toHaveBeenCalledWith({ ownerUserId: users[0].id });
    expect(onPatch).toHaveBeenCalledWith({ department: expect.any(String) });
    expect(onPatch).toHaveBeenCalledWith({ tag: expect.any(String) });
    expect(onReset).toHaveBeenCalledOnce();
    expect(screen.getByText('2 active filters')).toBeInTheDocument();
  });

  it('labels the two user selects visibly so they do not read as one filter twice', () => {
    renderWithQuery(
      <ArchivedFilterRail
        filters={filters}
        users={users}
        activeFilterCount={0}
        onPatch={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    // Both list the same user directory, so a hidden label leaves them
    // indistinguishable on screen.
    for (const name of ['Archived by', 'Owner']) {
      const label = screen.getByText(name);
      expect(label.tagName).toBe('LABEL');
      expect(label).not.toHaveClass('sr-only');
    }
  });

  it('constrains the archive date range in both directions', () => {
    renderWithQuery(
      <ArchivedFilterRail
        filters={{ ...filters, archiveFrom: '2026-07-10', archiveTo: '2026-07-20' }}
        users={users}
        activeFilterCount={2}
        onPatch={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Archived from')).toHaveAttribute('max', '2026-07-20');
    expect(screen.getByLabelText('Archived to')).toHaveAttribute('min', '2026-07-10');
  });
});

