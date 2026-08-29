import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { formatGregorian, formatHijriRaw, formatRelativeAt } from '@/lib/lex/ksa';

import type { LegalCalendarEvent } from '../../../calendar/_lib/calendar-events';
import {
  DashboardCalendarPanel,
  DashboardCalendarPanelError,
  DashboardCalendarPanelLoading,
} from './dashboard-calendar-panel';

/** Monday 21 September 2026, local — the injected "now" for every case. */
const REFERENCE = new Date(2026, 8, 21, 9, 0, 0);

/** The compact dual-date shape the day header is specified to render. */
const AGENDA_DATE_OPTIONS = { day: 'numeric', month: 'short' } as const;

/**
 * Build an event timestamp from LOCAL calendar fields so day grouping is
 * independent of the host timezone.
 */
function isoAt(year: number, month: number, day: number, hour = 10): string {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

const OBLIGATION: LegalCalendarEvent = {
  id: 'obligation:ob-1',
  type: 'obligation',
  title: 'Quarterly compliance filing',
  date: isoAt(2026, 9, 21, 14),
  severity: 'high',
  href: '/lex/obligations/ob-1',
  meta: 'MSA-2026-11',
};

const HEARING: LegalCalendarEvent = {
  id: 'hearing:case-1',
  type: 'hearing',
  title: 'Al Othaim v. Supplier',
  date: isoAt(2026, 9, 23, 10),
  severity: 'critical',
  href: '/lex/cases/case-1',
  meta: 'CASE-2026-0001 · Riyadh',
};

const SIGNATURE: LegalCalendarEvent = {
  id: 'signature_deadline:env-1',
  type: 'signature_deadline',
  title: 'Framework agreement',
  date: isoAt(2026, 9, 23, 16),
  severity: 'high',
  href: '/lex/signatures/env-1',
  meta: 'CT-0099 · 1/3',
};

const RENEWAL: LegalCalendarEvent = {
  id: 'contract_renewal:ct-1',
  type: 'contract_renewal',
  title: 'Logistics MSA',
  date: isoAt(2026, 9, 25, 9),
  severity: 'medium',
  href: '/lex/contracts/ct-1',
  meta: 'CT-0099 · Aramex',
};

const SLA: LegalCalendarEvent = {
  id: 'service_sla:clock-1',
  type: 'service_sla',
  title: 'LEGAL-REVIEW',
  date: isoAt(2026, 9, 28, 9),
  severity: 'low',
  href: '/lex/service-desk',
};

/** Deliberately unsorted — the band owns ordering, the caller does not. */
const EVENTS: LegalCalendarEvent[] = [RENEWAL, HEARING, SLA, OBLIGATION, SIGNATURE];

function bulkEvents(count: number): LegalCalendarEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `obligation:bulk-${index}`,
    type: 'obligation' as const,
    title: `Obligation ${index}`,
    date: isoAt(2026, 10, index + 1),
    severity: 'medium' as const,
    href: `/lex/obligations/bulk-${index}`,
  }));
}

describe('DashboardCalendarPanel', () => {
  it('sources its title from the lex.calendar catalogue instead of a duplicate LD key', () => {
    renderWithQuery(<DashboardCalendarPanel events={EVENTS} now={REFERENCE} />);

    expect(screen.getByRole('region', { name: 'Legal Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Legal Calendar' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute(
      'href',
      '/lex/calendar',
    );
  });

  it('presents the caller-supplied events upcoming-first, grouped by day', () => {
    const { container } = renderWithQuery(
      <DashboardCalendarPanel events={EVENTS} now={REFERENCE} limit={EVENTS.length} />,
    );

    expect(
      Array.from(container.querySelectorAll('[data-agenda-event]')).map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual([
      '/lex/obligations/ob-1',
      '/lex/cases/case-1',
      '/lex/signatures/env-1',
      '/lex/contracts/ct-1',
      '/lex/service-desk',
    ]);
    expect(
      Array.from(container.querySelectorAll('[data-agenda-day]')).map((day) =>
        day.getAttribute('data-agenda-day'),
      ),
    ).toEqual(['2026-09-21', '2026-09-23', '2026-09-25', '2026-09-28']);

    // The two 23 September items share one day group rather than repeating it.
    const sharedDay = container.querySelector('[data-agenda-day="2026-09-23"]') as HTMLElement;
    expect(within(sharedDay).getAllByRole('link')).toHaveLength(2);
  });

  it('renders a dual Gregorian + Hijri day header with today and KSA holiday markers', () => {
    const { container } = renderWithQuery(
      <DashboardCalendarPanel events={EVENTS} now={REFERENCE} limit={EVENTS.length} />,
    );

    const today = container.querySelector('[data-agenda-day="2026-09-21"]') as HTMLElement;
    const todayDate = new Date(2026, 8, 21, 14, 0, 0);
    expect(today).toHaveTextContent(formatGregorian(todayDate, 'en', AGENDA_DATE_OPTIONS));
    expect(today).toHaveTextContent(formatHijriRaw(todayDate, 'en', AGENDA_DATE_OPTIONS));
    expect(within(today).getByText('Today')).toHaveAttribute('data-day-flag', 'today');

    const nationalDay = container.querySelector(
      '[data-agenda-day="2026-09-23"]',
    ) as HTMLElement;
    expect(within(nationalDay).getByText('Saudi National Day')).toHaveAttribute(
      'data-day-flag',
      'holiday',
    );
    expect(within(nationalDay).queryByText('Today')).not.toBeInTheDocument();

    // 25 September is neither today nor a holiday.
    const plain = container.querySelector('[data-agenda-day="2026-09-25"]') as HTMLElement;
    expect(plain.querySelector('[data-day-flag]')).toBeNull();
  });

  it('labels each row with its source type and severity, not colour alone', () => {
    renderWithQuery(
      <DashboardCalendarPanel events={EVENTS} now={REFERENCE} limit={EVENTS.length} />,
    );

    const hearing = screen.getByRole('link', { name: /Al Othaim v\. Supplier/ });
    expect(hearing).toHaveAttribute('data-severity', 'critical');
    expect(hearing).toHaveAttribute('data-event-type', 'hearing');
    expect(hearing).toHaveTextContent('Hearing');
    expect(hearing).toHaveTextContent('CASE-2026-0001 · Riyadh');

    // Severity reaches assistive tech as text, so the rail hue is redundant.
    expect(screen.getByRole('link', { name: /Critical/ })).toBe(hearing);
    expect(
      screen.getByRole('link', { name: /Contract renewal/ }).getAttribute('data-severity'),
    ).toBe('medium');

    // A row without `meta` renders its title alone rather than an empty line.
    const sla = screen.getByRole('link', { name: /LEGAL-REVIEW/ });
    expect(sla).toHaveTextContent('Service-desk SLA');
  });

  it('derives relative time from the injected now rather than the wall clock', () => {
    renderWithQuery(
      <DashboardCalendarPanel events={EVENTS} now={REFERENCE} limit={EVENTS.length} />,
    );

    expect(screen.getByRole('link', { name: /Al Othaim v\. Supplier/ })).toHaveTextContent(
      'in 2 days',
    );
    expect(screen.getByRole('link', { name: /LEGAL-REVIEW/ })).toHaveTextContent(
      formatRelativeAt(SLA.date, 'en', REFERENCE),
    );
  });

  it('discloses the overflow instead of silently truncating the band', () => {
    const { container, unmount } = renderWithQuery(
      <DashboardCalendarPanel events={EVENTS} now={REFERENCE} limit={2} />,
    );

    expect(container.querySelectorAll('[data-agenda-event]')).toHaveLength(2);
    expect(screen.getByRole('link', { name: '+3 more' })).toHaveAttribute(
      'href',
      '/lex/calendar',
    );

    unmount();
    renderWithQuery(
      <DashboardCalendarPanel events={EVENTS} now={REFERENCE} limit={EVENTS.length} />,
    );
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });

  it('caps an unbounded stream at the default band size', () => {
    renderWithQuery(<DashboardCalendarPanel events={bulkEvents(9)} now={REFERENCE} />);

    expect(document.querySelectorAll('[data-agenda-event]')).toHaveLength(6);
    expect(screen.getByRole('link', { name: '+3 more' })).toHaveAttribute(
      'href',
      '/lex/calendar',
    );
  });

  it('renders the localized empty state for no events and for undated ones', () => {
    const { unmount } = renderWithQuery(
      <DashboardCalendarPanel events={[]} now={REFERENCE} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No schedule data available');
    expect(
      screen.queryByRole('link', { name: /Quarterly compliance filing/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute(
      'href',
      '/lex/calendar',
    );

    unmount();
    renderWithQuery(
      <DashboardCalendarPanel
        events={[{ ...HEARING, date: 'not-a-date' }]}
        now={REFERENCE}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No schedule data available');
    expect(
      screen.queryByRole('link', { name: /Al Othaim v\. Supplier/ }),
    ).not.toBeInTheDocument();
  });

  it('provides localized loading and retryable error companions under the same title', () => {
    const { unmount } = renderWithQuery(<DashboardCalendarPanelLoading />);

    expect(screen.getByRole('heading', { name: 'Legal Calendar' })).toBeVisible();
    expect(screen.getByRole('status', { name: 'Loading schedule' })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    unmount();
    const onRetry = vi.fn();
    renderWithQuery(<DashboardCalendarPanelError onRetry={onRetry} />);
    expect(screen.getByRole('heading', { name: 'Legal Calendar' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load the schedule');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders Arabic copy, Arabic-Indic digits and an RTL band', () => {
    const { container } = renderWithQuery(
      <DashboardCalendarPanel events={EVENTS} now={REFERENCE} limit={2} />,
      { locale: 'ar' },
    );

    expect(screen.getByRole('heading', { name: 'التقويم القانوني' })).toBeVisible();
    expect(container.querySelector('[data-dashboard-calendar-panel]')).toHaveAttribute(
      'dir',
      'rtl',
    );

    const today = container.querySelector('[data-agenda-day="2026-09-21"]') as HTMLElement;
    const todayDate = new Date(2026, 8, 21, 14, 0, 0);
    expect(today).toHaveTextContent(formatGregorian(todayDate, 'ar', AGENDA_DATE_OPTIONS));
    expect(today).toHaveTextContent(formatHijriRaw(todayDate, 'ar', AGENDA_DATE_OPTIONS));
    expect(within(today).getByText('اليوم')).toBeInTheDocument();

    const nationalDay = container.querySelector(
      '[data-agenda-day="2026-09-23"]',
    ) as HTMLElement;
    expect(within(nationalDay).getByText('اليوم الوطني السعودي')).toBeInTheDocument();

    const hearing = screen.getByRole('link', { name: /جلسة/ });
    expect(hearing).toHaveAttribute('data-event-type', 'hearing');
    expect(hearing).toHaveTextContent('حرِجة');
    expect(hearing).toHaveTextContent(formatRelativeAt(HEARING.date, 'ar', REFERENCE));

    // The overflow count is shaped, not left in Latin digits.
    expect(screen.getByText('+٣ المزيد')).toBeInTheDocument();
  });

  it('marks user-supplied strings as bidi-neutral', () => {
    const { container } = renderWithQuery(
      <DashboardCalendarPanel events={[HEARING]} now={REFERENCE} />,
      { locale: 'ar' },
    );

    expect(screen.getByText('Al Othaim v. Supplier')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('CASE-2026-0001 · Riyadh')).toHaveAttribute('dir', 'auto');
    expect(container.querySelector('[data-day-flag="holiday"]')).toHaveAttribute(
      'dir',
      'auto',
    );
  });

  it('stays presentation-only, token-bound and logical-property-only', () => {
    const source = readFileSync(
      resolve(process.cwd(), __dirname, 'dashboard-calendar-panel.tsx'),
      'utf8',
    );

    expect(source).not.toMatch(/#[\da-f]{3,8}/i);
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr)-/);
    expect(source).not.toMatch(/\bfetch\s*\(|\baxios\b|\buseQuery\b|useRoleDashboardData/);
    expect(source).not.toContain("'/lex/");
    // Calendar copy stays owned by lex.calendar; no duplicate LD panels key.
    expect(source).not.toContain('panels.calendar');
    expect(source).toContain('useCalendarLabels');
    expect(source).toContain('labels.states.calendar');
    // Events are a type-only dependency, so no calendar transport is pulled in.
    expect(source).toMatch(
      /import type \{[^}]*LegalCalendarEvent[^}]*\} from '\.\.\/\.\.\/\.\.\/calendar\/_lib\/calendar-events'/,
    );

    const css = readFileSync(
      resolve(process.cwd(), __dirname, 'dashboard-calendar-panel.module.css'),
      'utf8',
    );

    expect(css).not.toMatch(/#[\da-f]{3,8}/i);
    expect(css).not.toMatch(/(?:margin|padding|border|inset)-(?:left|right)\b/);
    expect(css).not.toMatch(/^\s*(?:left|right|top|bottom):/m);
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container (min-width: 34rem)');
    expect(css).toContain('border-inline-start');
    expect(css).toContain("[data-severity='critical']");
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
