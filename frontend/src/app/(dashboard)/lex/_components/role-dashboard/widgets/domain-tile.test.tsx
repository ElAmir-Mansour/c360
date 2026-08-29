import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';

import {
  DomainTile,
  DomainTileSkeleton,
  type DomainTile as DomainTileRecord,
  type DomainTileTint,
} from './domain-tile';

const BASE_TILE: DomainTileRecord = {
  key: 'contracts',
  label: 'Contracts',
  count: 32,
  tint: 'teal',
  href: '/lex/contracts',
};

function renderTile(
  tile: DomainTileRecord = BASE_TILE,
  locale: 'en' | 'ar' = 'en',
) {
  const direction = locale === 'ar' ? 'rtl' : 'ltr';
  return render(
    <LocaleProvider
      locale={locale}
      direction={direction}
      messages={getMessages(locale)}
    >
      <div dir={direction}>
        <DomainTile tile={tile} />
      </div>
    </LocaleProvider>,
  );
}

describe('DomainTile', () => {
  it.each([
    ['blue', '--wt-domain-blue'],
    ['green', '--wt-domain-green'],
    ['teal', '--wt-domain-teal'],
    ['amber', '--wt-domain-amber'],
    ['grey', '--wt-domain-grey'],
  ] satisfies [DomainTileTint, string][])('maps the %s tint to %s', (tint, token) => {
    const { container } = renderTile({ ...BASE_TILE, tint });
    const badge = container.querySelector(`[data-domain-tint="${tint}"]`);

    expect(badge).toHaveClass(`bg-[var(${token})]`);
  });

  it('uses the single registry when tint is omitted and the approved default for unknown keys', () => {
    const { container, rerender } = renderTile({ ...BASE_TILE, tint: undefined });
    expect(container.querySelector('[data-domain-tint="teal"]')).toHaveClass(
      'bg-[var(--wt-domain-teal)]',
    );

    rerender(
      <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
        <DomainTile tile={{ ...BASE_TILE, key: 'future_domain', tint: undefined }} />
      </LocaleProvider>,
    );
    expect(container.querySelector('[data-domain-tint="grey"]')).toHaveClass(
      'bg-[var(--wt-domain-grey)]',
    );
  });

  it('renders the exact link, label, positive count, and registry icon', () => {
    const { container } = renderTile();
    const link = screen.getByRole('link', { name: /contracts 32/i });

    expect(link).toHaveAttribute('href', '/lex/contracts');
    expect(container.querySelector('svg.lucide-file-text')).toBeInTheDocument();
    expect(link).toHaveClass('focus-visible:ring-2');
  });

  it('omits the numeral when count is null', () => {
    renderTile({ ...BASE_TILE, count: null });

    expect(screen.getByRole('link')).toHaveTextContent('Contracts');
    expect(screen.getByRole('link')).not.toHaveTextContent('32');
  });

  it('renders zero as ready data rather than empty', () => {
    renderTile({ ...BASE_TILE, count: 0 });

    expect(screen.getByRole('link')).toHaveTextContent('0');
  });

  it('locale-formats Arabic zero and mirrors the directional arrow', () => {
    const { container } = renderTile(
      { ...BASE_TILE, label: 'العقود', count: 0 },
      'ar',
    );

    expect(screen.getByRole('link')).toHaveTextContent('٠');
    expect(container.querySelector('svg.lucide-arrow-right')).toHaveClass(
      'rtl:-scale-x-100',
    );
  });

  it('renders an accessible loading skeleton companion', () => {
    render(<DomainTileSkeleton label="Loading Contracts" />);

    expect(
      screen.getByRole('status', { name: 'Loading Contracts' }),
    ).toHaveAttribute('aria-busy', 'true');
  });

  it('uses only logical layout classes and generated color tokens', () => {
    const source = readFileSync(
      resolve(process.cwd(), __dirname, 'domain-tile.tsx'),
      'utf8',
    );

    expect(source).not.toMatch(/#[\da-f]{3,8}/i);
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr)-/);
    expect(source).not.toContain('shadow-');
    expect(source).toContain('var(--wt-surface)');
    expect(source).toContain('var(--wt-teal-300)');
    expect(source).toContain('var(--wt-card-border-width)');
    expect(source).toContain('var(--wt-font-size-label)');
  });
});
