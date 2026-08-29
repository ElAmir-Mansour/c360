import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LearningCentrePage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lex/learning-centre',
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'user-1' },
  }),
}));

describe('Learning Centre', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists honest completion progress instead of displaying a fixed value', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LearningCentrePage />);

    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: '0% complete' }),
      ).toBeInTheDocument(),
    );

    await user.click(
      screen.getAllByRole('button', { name: 'Mark complete' })[0],
    );

    expect(
      screen.getByRole('img', { name: '33% complete' }),
    ).toBeInTheDocument();
    expect(
      JSON.parse(
        window.localStorage.getItem(
          'watheeq-learning-centre-progress-v1',
        ) ?? '[]',
      ),
    ).toContain('drafting-basics');
  });

  it('renders the Arabic learning surface in RTL', async () => {
    const { container } = renderWithQuery(<LearningCentrePage />, {
      locale: 'ar',
    });

    expect(
      screen.getByRole('heading', { level: 1, name: 'مركز التعلّم' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: 'اكتمل 0٪' }),
      ).toBeInTheDocument(),
    );
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });
});
