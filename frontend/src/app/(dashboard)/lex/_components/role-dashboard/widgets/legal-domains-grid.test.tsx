import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';

import type { DomainTile as DomainTileRecord } from './domain-tile';
import {
  LegalDomainsGrid,
  LegalDomainsGridError,
  LegalDomainsGridLoading,
} from './legal-domains-grid';

const DOMAINS: DomainTileRecord[] = [
  {
    key: 'contracts',
    label: 'Caller Contracts',
    count: 0,
    tint: 'blue',
    href: '/caller/contracts',
  },
  {
    key: 'drafting',
    label: 'Caller Drafting',
    count: null,
    tint: 'amber',
    href: '/caller/drafting',
  },
  {
    key: 'compliance',
    label: 'Caller Compliance',
    count: 12,
    tint: 'green',
    href: '/caller/compliance',
  },
];

function renderWithLocale(
  node: React.ReactNode,
  locale: 'en' | 'ar' = 'en',
) {
  const direction = locale === 'ar' ? 'rtl' : 'ltr';
  return render(
    <LocaleProvider
      locale={locale}
      direction={direction}
      messages={getMessages(locale)}
    >
      <div dir={direction}>{node}</div>
    </LocaleProvider>,
  );
}

describe('LegalDomainsGrid', () => {
  it('uses the fixed key order without fabricating record fields', () => {
    renderWithLocale(<LegalDomainsGrid domains={DOMAINS} />);
    const links = screen.getAllByRole('link');

    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/caller/contracts',
      '/caller/compliance',
      '/caller/drafting',
    ]);
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining('Caller Contracts'),
      expect.stringContaining('Caller Compliance'),
      expect.stringContaining('Caller Drafting'),
    ]);
  });

  it('preserves partial and unknown records after known fixed-order keys', () => {
    const records: DomainTileRecord[] = [
      { ...DOMAINS[0], key: 'custom_b', label: 'Custom B', href: '/custom/b' },
      { ...DOMAINS[0], key: 'reports', label: 'Reports', href: '/caller/reports' },
      { ...DOMAINS[0], key: 'custom_a', label: 'Custom A', href: '/custom/a' },
      {
        ...DOMAINS[0],
        key: 'litigation_cases',
        label: 'Litigation',
        href: '/caller/litigation',
      },
    ];
    renderWithLocale(<LegalDomainsGrid domains={records} />);

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/caller/litigation',
      '/caller/reports',
      '/custom/b',
      '/custom/a',
    ]);
  });

  it('renders zero, null, and positive counts distinctly', () => {
    renderWithLocale(<LegalDomainsGrid domains={DOMAINS} />);
    const zero = screen.getByRole('link', { name: /Caller Contracts/ });
    const nullCount = screen.getByRole('link', { name: /Caller Drafting/ });
    const positive = screen.getByRole('link', { name: /Caller Compliance/ });

    expect(zero).toHaveTextContent('0');
    expect(nullCount).toHaveTextContent('Caller Drafting');
    expect(nullCount).not.toHaveTextContent(/\d/);
    expect(positive).toHaveTextContent('12');
  });

  it('uses the required 6→4→3→2 responsive grid classes', () => {
    const { container } = renderWithLocale(<LegalDomainsGrid domains={DOMAINS} />);
    const grid = container.querySelector('[data-legal-domains-grid]');

    expect(grid).toHaveClass(
      'grid-cols-2',
      'sm:grid-cols-3',
      'lg:grid-cols-4',
      'xl:grid-cols-6',
    );
  });

  it('renders the localized empty state only for an empty array', () => {
    renderWithLocale(<LegalDomainsGrid domains={[]} />);

    expect(screen.getByText('No legal domain data available')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('locale-formats caller-supplied zero in RTL', () => {
    renderWithLocale(
      <LegalDomainsGrid
        domains={[{ ...DOMAINS[0], label: 'العقود', count: 0 }]}
      />,
      'ar',
    );

    expect(screen.getByRole('link')).toHaveTextContent('٠');
    expect(screen.getByRole('heading', { name: 'المجالات القانونية' })).toBeInTheDocument();
  });

  it('renders a responsive loading companion and retryable error', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderWithLocale(<LegalDomainsGridLoading />);

    expect(
      screen.getByRole('status', { name: 'Loading legal domain data' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelectorAll('[aria-hidden="true"] [role="status"]')).toHaveLength(18);

    rerender(
      <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
        <LegalDomainsGridError onRetry={retry} />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('remains presentation-only and token-bound', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/legal-domains-grid.tsx',
      ),
      'utf8',
    );

    expect(source).not.toMatch(/#[\da-f]{3,8}/i);
    expect(source).not.toContain('LEX_DOMAINS');
    expect(source).not.toContain("'/lex/");
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr)-/);
    expect(source).not.toContain('shadow-');

    const css = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/legal-domains-grid.module.css',
      ),
      'utf8',
    );
    expect(css).toContain('@media (max-width: 24rem)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
  });
});
