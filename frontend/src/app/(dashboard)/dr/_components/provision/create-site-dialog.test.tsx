import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { CreateSiteDialog } from './create-site-dialog';

/**
 * Create-protected-site dialog tests.
 *
 * Proves the dialog builds a real {@link DRCreateSiteRequest} from a zod-valid
 * form and calls `onCreate` with that exact payload (default kind `vm` rides
 * along), that blank required fields block submission (zod gate fires, no
 * `onCreate` call), and includes an Arabic / RTL render asserting the MSA copy.
 */

// dr-i18n's neighbours touch next/navigation transitively — mock to be safe.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/protect',
  useSearchParams: () => new URLSearchParams(''),
}));

describe('CreateSiteDialog', () => {
  it('calls onCreate with the zod-valid DRCreateSiteRequest payload', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();

    renderWithQuery(
      <CreateSiteDialog
        open
        onOpenChange={onOpenChange}
        onCreate={onCreate}
        submitting={false}
      />,
    );

    await user.type(screen.getByPlaceholderText('e.g. Production database'), 'Prod DB');
    await user.type(
      screen.getByPlaceholderText('e.g. pg://primary.internal:5432'),
      'pg://primary.internal:5432',
    );

    // RTO / RPO numeric inputs (clear the seeded defaults, type explicit values).
    const numericInputs = screen.getAllByRole('spinbutton');
    await user.clear(numericInputs[0]);
    await user.type(numericInputs[0], '600');
    await user.clear(numericInputs[1]);
    await user.type(numericInputs[1], '120');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Prod DB',
      kind: 'vm',
      primary_endpoint: 'pg://primary.internal:5432',
      rto_objective_seconds: 600,
      rpo_objective_seconds: 120,
    });
  });

  it('blocks submission and does not call onCreate when required fields are blank', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    renderWithQuery(
      <CreateSiteDialog open onOpenChange={vi.fn()} onCreate={onCreate} submitting={false} />,
    );

    // Name + endpoint left blank — zod must reject.
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Enter a site name.')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(
      <CreateSiteDialog open onOpenChange={vi.fn()} onCreate={vi.fn()} submitting={false} />,
      { locale: 'ar' },
    );

    expect(screen.getByText('إضافة موقع محمي')).toBeInTheDocument();
    // Arabic action copy, not the English fallback.
    expect(screen.getByRole('button', { name: 'إنشاء' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeInTheDocument();
  });
});
