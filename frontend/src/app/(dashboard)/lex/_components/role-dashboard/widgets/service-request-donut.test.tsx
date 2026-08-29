import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';

import {
  ServiceRequestDonut,
  ServiceRequestDonutState,
  type ServiceRequestDonutProps,
} from './service-request-donut';

const inconsistentSegments = [
  { key: 'contracts', label: 'Contracts', value: 32, href: '/lex/contracts' },
  { key: 'consultations', label: 'Consultations', value: 56, href: '/lex/consultations' },
  { key: 'litigations', label: 'Litigations', value: 33, href: '/lex/cases' },
  { key: 'investigation', label: 'Investigation', value: 33, href: '/lex/investigations' },
  { key: 'other', label: 'Other task', value: 33, href: '/lex/reports/analytics' },
] satisfies ServiceRequestDonutProps['segments'];

function segmentCircle(container: HTMLElement, key: string): SVGCircleElement {
  const circle = container.querySelector<SVGCircleElement>(`circle[data-segment="${key}"]`);
  if (!circle) throw new Error(`Missing ${key} arc`);
  return circle;
}

describe('ServiceRequestDonut', () => {
  it('shows the supplied total verbatim while deriving arc shares only from segments', () => {
    const { container } = renderWithQuery(
      <ServiceRequestDonut total={154} segments={inconsistentSegments} />,
    );

    expect(screen.getAllByText('154')).toHaveLength(2);
    expect(segmentCircle(container, 'contracts')).toHaveAttribute(
      'data-segment-fraction',
      String(32 / 187),
    );
    expect(segmentCircle(container, 'consultations')).toHaveAttribute(
      'data-segment-fraction',
      String(56 / 187),
    );
    expect(screen.getAllByRole('link', { name: /Open Contracts: 32/ })[0]).toHaveAttribute(
      'href',
      '/lex/contracts',
    );
  });

  it('maps categorical colors by key when input order changes', () => {
    const reordered = [inconsistentSegments[4], inconsistentSegments[0]];
    const { container } = renderWithQuery(
      <ServiceRequestDonut total={65} segments={reordered} />,
    );

    expect(segmentCircle(container, 'other')).toHaveAttribute(
      'stroke',
      'var(--wt-service-other-dot)',
    );
    expect(segmentCircle(container, 'contracts')).toHaveAttribute(
      'stroke',
      'var(--wt-service-contracts-dot)',
    );
    expect(
      [...container.querySelectorAll<SVGCircleElement>('circle[data-segment]')].map(
        (circle) => circle.dataset.segment,
      ),
    ).toEqual(['contracts', 'other']);
  });

  it('renders partial segment arrays without fabricating missing categories', () => {
    renderWithQuery(
      <ServiceRequestDonut total={32} segments={[inconsistentSegments[0]]} />,
    );

    expect(screen.getAllByText('Contracts').length).toBeGreaterThan(0);
    expect(screen.queryByText('Consultations')).not.toBeInTheDocument();
  });

  it('renders an empty array as the localized empty state', () => {
    renderWithQuery(<ServiceRequestDonut total={10} segments={[]} />);

    expect(screen.getByText('No service request data available')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps zero numeric data in the ready state', () => {
    renderWithQuery(
      <ServiceRequestDonut
        total={0}
        segments={[
          { key: 'contracts', label: 'Contracts', value: 0, href: '/lex/contracts' },
          { key: 'other', label: 'Other task', value: 0, href: '/lex/reports/analytics' },
        ]}
      />,
    );

    expect(screen.queryByText('No service request data available')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Service Request Distribution chart' })).toBeVisible();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('exposes every supplied segment and the distinct total in its accessible table', () => {
    renderWithQuery(
      <ServiceRequestDonut total={154} segments={inconsistentSegments.slice(0, 2)} />,
    );

    const table = screen.getByRole('table', {
      name: 'Service Request Distribution data table',
    });
    expect(within(table).getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Count' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByRole('cell', { name: 'Total' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '154' })).toBeInTheDocument();
  });

  it('mirrors the chart and formats supplied values in Arabic', () => {
    const { container } = renderWithQuery(
      <ServiceRequestDonut
        total={154}
        segments={[{ key: 'contracts', label: 'العقود', value: 32, href: '/lex/contracts' }]}
      />,
      { locale: 'ar' },
    );

    expect(container.querySelector('[data-direction="rtl"]')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'مخطط توزيع طلبات الخدمة' })).toBeVisible();
    expect(screen.getAllByText('١٥٤').length).toBeGreaterThan(0);
    expect(screen.getAllByText('٣٢').length).toBeGreaterThan(0);
  });

  it('exports loading, empty, and retryable error companions', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { unmount } = renderWithQuery(<ServiceRequestDonutState state="loading" />);

    expect(
      screen.getByRole('status', { name: 'Loading service request data' }),
    ).toHaveAttribute('aria-busy', 'true');

    unmount();
    const empty = renderWithQuery(<ServiceRequestDonutState state="empty" />);
    expect(screen.getByText('No service request data available')).toBeVisible();

    empty.unmount();
    renderWithQuery(<ServiceRequestDonutState state="error" onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('contains no color literals, shadows, physical-direction CSS, or embedded copy', () => {
    const componentSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/service-request-donut.tsx',
      ),
      'utf8',
    );
    const styleSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/service-request-donut.module.css',
      ),
      'utf8',
    );
    const sources = `${componentSource}\n${styleSource}`;

    expect(sources).not.toMatch(/#[\da-f]{3,8}/i);
    expect(styleSource).not.toMatch(/box-shadow/i);
    expect(styleSource).not.toMatch(/(?:margin|padding|inset|border)-(?:left|right)/i);
    expect(styleSource).not.toMatch(/text-align:\s*(?:left|right)/i);
    expect(componentSource).not.toMatch(/>[ \t]*[A-Za-z][^<{\r\n]*</);
    expect(componentSource).toContain('className={styles.panel}');
    expect(styleSource).toContain('container-type: inline-size');
    expect(styleSource).toContain('@container (min-width: 40rem)');
  });
});
