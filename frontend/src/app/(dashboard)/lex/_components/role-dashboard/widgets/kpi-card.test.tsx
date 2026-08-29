import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';

import {
  KpiCard,
  KpiCardSkeleton,
  KpiCardUnavailable,
  type KpiCardProps,
  type KpiTone,
} from './kpi-card';

const TONE_BORDERS: Record<KpiTone, string> = {
  slate: 'var(--wt-teal-700)',
  cyan: 'var(--wt-teal-300)',
  olive: 'var(--wt-lime-500)',
  green: 'var(--wt-ok)',
  ink: 'var(--wt-teal-900)',
  blue: 'var(--wt-service-investigation-dot)',
};

const requiredProps = {
  label: 'Active Cases',
  value: 33,
  format: 'count',
  tone: 'olive',
} satisfies KpiCardProps;

describe('KpiCard', () => {
  it('keeps href optional and links the complete card only when supplied', () => {
    const { unmount } = renderWithQuery(<KpiCard {...requiredProps} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(requiredProps.label).closest('article')).toBeInTheDocument();

    unmount();
    renderWithQuery(<KpiCard {...requiredProps} href="/lex/cases" />);

    expect(screen.getByRole('link')).toHaveAttribute('href', '/lex/cases');
  });

  it('renders a zero count as a value rather than an empty state', () => {
    renderWithQuery(<KpiCard {...requiredProps} value={0} />);

    expect(screen.getByText('0')).toBeVisible();
  });

  it('formats counts without a percent suffix and percent values with one', () => {
    const { unmount } = renderWithQuery(
      <KpiCard {...requiredProps} value={1_234} format="count" />,
    );

    expect(screen.getByText('1,234')).toBeVisible();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();

    unmount();
    renderWithQuery(<KpiCard {...requiredProps} value={90} format="percent" />);

    expect(screen.getByText('90%')).toBeVisible();
  });

  it('uses the existing Lex locale formatter in Arabic', () => {
    renderWithQuery(
      <KpiCard {...requiredProps} value={90} format="percent" />,
      { locale: 'ar' },
    );

    expect(screen.getByText((content) => content.includes('٩٠') && content.includes('٪'))).toBeVisible();
  });

  it.each(Object.entries(TONE_BORDERS) as [KpiTone, string][])(
    'maps %s to its approved border token only',
    (tone, borderColor) => {
      const { container, unmount } = renderWithQuery(
        <KpiCard {...requiredProps} tone={tone} />,
      );

      const card = container.firstElementChild;
      expect(card).toHaveStyle({ borderColor });
      expect(screen.getByText('33').className).toContain('value');
      unmount();
    },
  );

  it('provides a localized loading companion without changing KpiCardProps', () => {
    renderWithQuery(<KpiCardSkeleton label="Loading KPI data" tone="slate" />);

    expect(screen.getByLabelText('Loading KPI data')).toHaveAttribute('aria-busy', 'true');
  });

  it('provides an unavailable companion that still names its KPI', () => {
    renderWithQuery(<KpiCardUnavailable label="Active Contracts" />);

    expect(screen.getByText('Active Contracts')).toBeVisible();
  });

  it('renders a placeholder rather than a number or a skeleton when unavailable', () => {
    const { container } = renderWithQuery(
      <KpiCardUnavailable label="Active Contracts" />,
    );

    const placeholder = screen.getByText('—');
    expect(placeholder.className).toContain('valueUnavailable');
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.firstElementChild).not.toHaveAttribute('aria-busy');
  });

  it('explains through the accessible name that the value is not readable by this user', () => {
    renderWithQuery(<KpiCardUnavailable label="Active Contracts" />);

    const card = screen.getByLabelText(
      'Active Contracts: value not available with your permissions',
    );
    expect(card.tagName).toBe('ARTICLE');
    expect(card.className).toContain('card');
  });

  it('resolves the unavailable explanation from the Arabic catalogue', () => {
    renderWithQuery(<KpiCardUnavailable label="العقود النشطة" />, {
      locale: 'ar',
    });

    expect(
      screen.getByLabelText('العقود النشطة: القيمة غير متاحة ضمن صلاحياتك'),
    ).toBeVisible();
    expect(screen.getByText('—')).toBeVisible();
  });

  it('holds its strip position with a neutral border because no tone can be read', () => {
    const { container } = renderWithQuery(
      <KpiCardUnavailable label="Active Contracts" />,
    );

    const card = container.firstElementChild;
    expect(card?.className).toContain('cardUnavailable');
    expect(card).not.toHaveAttribute('style');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps the value color fixed and component sources free of color literals and copy', () => {
    const componentSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/kpi-card.tsx',
      ),
      'utf8',
    );
    const styleSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/kpi-card.module.css',
      ),
      'utf8',
    );
    const sources = `${componentSource}\n${styleSource}`;

    expect(styleSource).toMatch(/\.value\s*{[^}]*color:\s*var\(--wt-teal-900\)/);
    expect(sources).not.toMatch(/#[\da-f]{3,8}/i);
    expect(componentSource).not.toMatch(/>\s*[A-Za-z][^<{]*</);
  });
});
