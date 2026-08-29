import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { CreateScenarioDialog } from './create-scenario-dialog';

/**
 * Create-game-day-scenario dialog tests.
 *
 * Proves the dialog builds a real {@link DRCreateGameDayScenarioRequest} (group +
 * name + scope + a non-empty `steps[]` each with `action`/`target`/`expect.signal`
 * and optional detect/recover windows) and calls `onCreate` with that exact
 * payload, that a blank required field blocks submission (zod gate fires, no
 * `onCreate`), and includes an Arabic / RTL render asserting the MSA copy.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/rehearse',
  useSearchParams: () => new URLSearchParams(''),
}));

const GROUPS = [
  { id: 'group-1', name: 'Core banking' },
  { id: 'group-2', name: 'Payments' },
];

describe('CreateScenarioDialog', () => {
  it('calls onCreate with the zod-valid DRCreateGameDayScenarioRequest payload', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    renderWithQuery(
      <CreateScenarioDialog
        open
        onOpenChange={vi.fn()}
        groups={GROUPS}
        defaultGroupId="group-2"
        onCreate={onCreate}
        submitting={false}
      />,
    );

    await user.type(
      screen.getByPlaceholderText('Primary-region power loss'),
      'Region power loss',
    );
    await user.type(screen.getByPlaceholderText('kill_process'), 'cut_power');
    await user.type(screen.getByPlaceholderText('primary-db.internal'), 'primary-region');
    await user.type(screen.getByPlaceholderText('failover_initiated'), 'failover_initiated');
    await user.type(screen.getByPlaceholderText('30s'), '45s');

    await user.click(screen.getByRole('button', { name: 'Save scenario' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({
      group_id: 'group-2',
      name: 'Region power loss',
      scope: 'group',
      steps: [
        {
          action: 'cut_power',
          target: 'primary-region',
          expect: {
            signal: 'failover_initiated',
            detect_within: '45s',
          },
        },
      ],
    });
  });

  it('blocks submission and does not call onCreate when a required field is blank', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    renderWithQuery(
      <CreateScenarioDialog
        open
        onOpenChange={vi.fn()}
        groups={GROUPS}
        onCreate={onCreate}
        submitting={false}
      />,
    );

    // Name + step fields blank — zod must reject.
    await user.click(screen.getByRole('button', { name: 'Save scenario' }));

    expect(await screen.findByText('Enter a scenario name.')).toBeInTheDocument();
    expect(screen.getByText('Enter the fault action.')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(
      <CreateScenarioDialog
        open
        onOpenChange={vi.fn()}
        groups={GROUPS}
        onCreate={vi.fn()}
        submitting={false}
      />,
      { locale: 'ar' },
    );

    expect(screen.getByText('إنشاء سيناريو ليوم محاكاة')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حفظ السيناريو' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('خطوات حقن الأعطال')).toBeInTheDocument();
  });
});
