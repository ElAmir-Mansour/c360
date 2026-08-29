import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AsyncRecordPicker } from './async-record-picker';

describe('AsyncRecordPicker', () => {
  it('mounts and opens its record list without a composed-ref update loop', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <AsyncRecordPicker
          ariaLabel="Assignee"
          queryKey={['assignee-picker-test']}
          loadOptions={async () => [
            { value: 'user-1', label: 'Jane Counsel', description: 'jane@example.com' },
          ]}
          value=""
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Assignee' }));

    expect(await screen.findByRole('option', { name: /Jane Counsel/ })).toBeVisible();
  });

  it('names its popover and exposes an empty result as status instead of an empty listbox', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <AsyncRecordPicker
          ariaLabel="Competent court"
          queryKey={['empty-court-picker-test']}
          loadOptions={async () => []}
          value=""
          onChange={vi.fn()}
          labels={{ empty: 'No courts configured.' }}
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Competent court' }));

    expect(await screen.findByRole('dialog', { name: 'Competent court' })).toBeVisible();
    expect(await screen.findByRole('status')).toHaveTextContent('No courts configured.');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
