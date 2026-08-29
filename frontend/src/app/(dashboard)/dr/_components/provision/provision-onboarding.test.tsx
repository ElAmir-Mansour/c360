import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ProvisionOnboarding } from './provision-onboarding';

/**
 * First-run onboarding panel tests: the guided "Get started" steps render with
 * real CTAs into the dialogs, the site CTA fires its handler with `dr:write`,
 * and every CTA is disabled (honestly gated) without `dr:write`.
 */

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

describe('ProvisionOnboarding', () => {
  it('renders the guided steps and wires the site CTA when canWrite', async () => {
    const user = userEvent.setup();
    const onCreateSite = vi.fn();

    renderWithQuery(
      <ProvisionOnboarding
        canWrite
        hasSites={false}
        hasGroups={false}
        hasStreams={false}
        onCreateSite={onCreateSite}
        onCreateGroup={vi.fn()}
        onCreateStream={vi.fn()}
      />,
    );

    expect(screen.getByText('Get started with ClarioDR')).toBeInTheDocument();
    expect(screen.getByText('Register a protected site')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add protected site' }));
    expect(onCreateSite).toHaveBeenCalledTimes(1);
  });

  it('disables every CTA when the operator lacks dr:write', () => {
    renderWithQuery(
      <ProvisionOnboarding
        canWrite={false}
        hasSites={false}
        hasGroups={false}
        hasStreams={false}
        onCreateSite={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateStream={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add protected site' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create protection group' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create replication stream' })).toBeDisabled();
  });

  it('renders the Arabic onboarding surface for locale "ar" (RTL)', () => {
    renderWithQuery(
      <ProvisionOnboarding
        canWrite
        hasSites={false}
        hasGroups={false}
        hasStreams={false}
        onCreateSite={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateStream={vi.fn()}
      />,
      { locale: 'ar' },
    );

    expect(screen.getByText('ابدأ مع ClarioDR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إضافة موقع محمي' })).toBeInTheDocument();
  });
});
