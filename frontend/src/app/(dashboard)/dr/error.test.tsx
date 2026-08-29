import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import DRConsoleError from './error';

// next/link reads the App Router context; mock next/navigation so it renders a
// plain anchor in jsdom (mirrors the sibling DR page tests).
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr',
  useSearchParams: () => new URLSearchParams(''),
}));

describe('DRConsoleError (route-segment error boundary)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('renders the recovery UI as an alert region with retry + back-to-console link', () => {
    // Silence the intentional console.error diagnostic emitted on mount.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderWithQuery(
      <DRConsoleError error={new Error('boom')} reset={vi.fn()} />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'The recovery console hit an unexpected error',
    );

    // Retry button (wired to reset) and the back-to-console link to /dr.
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
    const back = screen.getByRole('link', { name: 'Back to recovery console' });
    expect(back).toHaveAttribute('href', '/dr');
  });

  it('invokes Next.js reset() when the retry button is clicked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reset = vi.fn();
    const user = userEvent.setup();

    renderWithQuery(<DRConsoleError error={new Error('boom')} reset={reset} />);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('shows the digest reference line when the error carries a digest', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });

    renderWithQuery(<DRConsoleError error={error} reset={vi.fn()} />);

    expect(screen.getByText('Reference: abc123')).toBeInTheDocument();
  });

  it('omits the digest reference line when no digest is present', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderWithQuery(
      <DRConsoleError error={new Error('boom')} reset={vi.fn()} />,
    );

    expect(screen.queryByText(/^Reference:/)).not.toBeInTheDocument();
  });

  it('renders professional MSA and a logical-RTL back link under the ar locale', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderWithQuery(
      <DRConsoleError error={new Error('boom')} reset={vi.fn()} />,
      { locale: 'ar' },
    );

    expect(
      screen.getByText('واجه وحدة تحكّم التعافي خطأً غير متوقّع'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'إعادة المحاولة' }),
    ).toBeInTheDocument();
    // Back link is translated and still targets /dr.
    const back = screen.getByRole('link', { name: 'العودة إلى وحدة تحكّم التعافي' });
    expect(back).toHaveAttribute('href', '/dr');

    // English copy is gone under the Arabic locale.
    expect(
      screen.queryByText('The recovery console hit an unexpected error'),
    ).not.toBeInTheDocument();
  });
});
