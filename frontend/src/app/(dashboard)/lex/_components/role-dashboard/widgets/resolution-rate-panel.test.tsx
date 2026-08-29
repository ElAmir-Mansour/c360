import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';

import {
  ResolutionRateChart,
  ResolutionRatePanel,
  ResolutionRatePanelError,
  ResolutionRatePanelLoading,
} from './resolution-rate-panel';

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

describe('ResolutionRateChart', () => {
  it('renders independent raw rates without normalization or stacking', () => {
    const bars = [
      { label: 'Contracts', ratePct: 52, href: '/lex/contracts' },
      { label: 'Consultations', ratePct: 6, href: '/lex/consultations' },
      { label: 'Litigations', ratePct: 21, href: '/lex/cases' },
      { label: 'Investigation', ratePct: 19, href: '/lex/investigations' },
    ];
    const { container } = renderWithLocale(<ResolutionRateChart bars={bars} />);
    const fills = container.querySelectorAll('[data-resolution-rate-fill]');

    expect(fills).toHaveLength(4);
    expect(fills[0]).toHaveStyle('--resolution-rate-visual: 52%');
    expect(fills[1]).toHaveStyle('--resolution-rate-visual: 6%');
    expect(fills[2]).toHaveStyle('--resolution-rate-visual: 21%');
    expect(fills[3]).toHaveStyle('--resolution-rate-visual: 19%');

    const firstBar = container.querySelector('[data-rate-pct="52"]');
    expect(firstBar?.children[0]).toHaveAttribute('aria-hidden', 'true');
    expect(firstBar?.children[1]).toHaveTextContent('52%');
    expect(firstBar?.children[2]).toHaveTextContent('Contracts');
  });

  it('visually clamps only the fill while retaining raw displayed rates', () => {
    const { container } = renderWithLocale(
      <ResolutionRateChart
        bars={[
          {
            label: 'Overflow',
            ratePct: 145,
            href: '/lex/reports/analytics?category=overflow',
          },
          {
            label: 'Negative',
            ratePct: -4,
            href: '/lex/reports/analytics?category=negative',
          },
        ]}
      />,
    );
    const fills = container.querySelectorAll('[data-resolution-rate-fill]');

    expect(fills[0]).toHaveStyle('--resolution-rate-visual: 100%');
    expect(fills[1]).toHaveStyle('--resolution-rate-visual: 0%');
    expect(screen.getAllByText('145%')).toHaveLength(2);
    expect(screen.getAllByText('-4%')).toHaveLength(2);
  });

  it('provides an accessible chart label and equivalent data table', () => {
    renderWithLocale(
      <ResolutionRateChart
        bars={[{ label: 'Contracts', ratePct: 52, href: '/lex/contracts' }]}
      />,
    );

    expect(
      screen.getByRole('group', { name: 'Legal Teams Resolution Rate chart' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Contracts: 52%' })).toHaveAttribute(
      'href',
      '/lex/contracts',
    );
    const table = screen.getByRole('table', {
      name: 'Legal Teams Resolution Rate data table',
    });
    expect(within(table).getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Rate' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Contracts' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '52%' })).toBeInTheDocument();
  });

  it('renders a partial array and preserves a long label in full', () => {
    const label = 'International Regulatory Investigations and Proceedings';
    renderWithLocale(
      <ResolutionRateChart
        bars={[
          {
            label,
            ratePct: 33,
            href: '/lex/reports/analytics?category=international',
          },
        ]}
      />,
    );

    expect(screen.getAllByText(label)).toHaveLength(2);
  });

  it('locale-formats rates and labels in RTL', () => {
    renderWithLocale(
      <ResolutionRateChart
        bars={[{ label: 'العقود', ratePct: 52, href: '/lex/contracts' }]}
      />,
      'ar',
    );

    expect(screen.getAllByText(/٥٢/)).toHaveLength(2);
    expect(screen.getByRole('table', { name: /جدول بيانات/ })).toBeInTheDocument();
  });
});
describe('ResolutionRatePanel states', () => {
  it('distinguishes empty data from a ready zero rate', () => {
    const { rerender } = renderWithLocale(<ResolutionRatePanel bars={[]} />);
    expect(screen.getByText('No resolution rate data available')).toBeInTheDocument();

    rerender(
      <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
        <ResolutionRatePanel
          bars={[{ label: 'Contracts', ratePct: 0, href: '/lex/contracts' }]}
        />
      </LocaleProvider>,
    );
    expect(screen.queryByText('No resolution rate data available')).not.toBeInTheDocument();
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.getAllByText('0%')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute(
      'href',
      '/lex/reports/analytics',
    );
  });

  it('renders localized loading and retryable error companions', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderWithLocale(<ResolutionRatePanelLoading />);

    expect(
      screen.getByRole('status', { name: 'Loading resolution rate data' }),
    ).toBeInTheDocument();

    rerender(
      <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
        <ResolutionRatePanelError onRetry={retry} />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('uses token colors, approved type variables, and logical CSS', () => {
    const component = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/resolution-rate-panel.tsx',
      ),
      'utf8',
    );
    const css = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/resolution-rate-panel.module.css',
      ),
      'utf8',
    );
    const source = `${component}\n${css}`;

    expect(source).not.toMatch(/#[\da-f]{3,8}/i);
    expect(css).not.toMatch(/\b(?:left|right|margin-left|margin-right|padding-left|padding-right)\b/);
    expect(css).toContain('inset-inline: 0');
    expect(css).toContain('inset-block-end: 0');
    expect(css).toContain('var(--wt-font-size-caption)');
    expect(css).toContain('var(--wt-track-alt)');
    expect(css).toContain('var(--wt-ok-400)');
    expect(source).not.toContain('shadow-');
  });
});
