import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';

import type { WorkforceMetricValue, WorkforceReport } from './workforce-contract';
import { WorkforceTeamPanel } from './workforce-team-panel';

const value = (number: number): WorkforceMetricValue => ({ value: number, available: true });
const missing = (reason: string): WorkforceMetricValue => ({ value: null, available: false, reason });

function report(overrides: Partial<WorkforceReport> = {}): WorkforceReport {
  const base: WorkforceReport = {
    scope: {
      mode: 'unscoped', entityIds: [], userIds: ['user-1'], memberCount: 1, reason: 'no_org_role',
    },
    period: {
      from: '2026-07-02', to: '2026-07-31', timezone: 'Asia/Riyadh', calendarSource: 'tenant',
      workingDays: value(22),
    },
    team: [{
      userId: 'user-1', displayName: 'Layla Al-Hashimi', title: { en: 'Senior Counsel', ar: 'مستشارة أولى' },
      identityStatus: 'resolved', userStatus: 'active', linkedCount: 2,
      byDomain: [{ domain: 'contracts', rel: 'owner', attributionPath: 'direct', open: 10, resolved: 3 }],
      metrics: {
        activeWorkload: value(10), loadIndexPct: value(125),
        utilisationPct: missing('capacity_formula_undefined'), completionRatePct: value(75),
        onTimePct: missing('aggregation_not_implemented'), medianCycleDays: value(4.5),
        approvalLatencyHrs: missing('workflow_attribution_undefined'),
        obligationDischargePct: value(80), overdueCount: value(1),
        idleAssignmentPct: missing('workflow_attribution_undefined'),
      },
    }],
    rollup: {
      distributionGini: value(0), keyPersonConcentrationPct: value(100),
      backlogBurnPct: missing('aggregation_contract_undefined'), unroutedRequests: value(0),
      aging: { d0_30: value(10), d31_60: value(0), d61_90: value(0), d90_plus: value(0) },
    },
    coverage: {
      domainsRequested: 7, domainsReturned: 7, itemsTotal: 59, itemsAttributed: 36,
      itemsUnattributed: 23, attributionPct: 61, rowsReturned: 1, rowsTruncated: 0, exclusions: [],
    },
    degraded: false,
    errors: [],
  };
  return { ...base, ...overrides };
}

function renderPanel(node: React.ReactNode, locale: 'en' | 'ar' = 'en') {
  const direction = locale === 'ar' ? 'rtl' : 'ltr';
  return render(
    <LocaleProvider locale={locale} direction={direction} messages={getMessages(locale)}>
      <div dir={direction}>{node}</div>
    </LocaleProvider>,
  );
}

describe('WorkforceTeamPanel', () => {
  it('renders populated data, all contracted metric columns, coverage, and linked work', () => {
    const { container } = renderPanel(<WorkforceTeamPanel state="ready" report={report()} />);

    expect(screen.getByRole('heading', { name: 'Load distribution' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'View reports' })).toHaveAttribute(
      'href',
      '/lex/reports',
    );
    expect(screen.getByRole('table')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Named team workload and delivery measures' })).toHaveAttribute('tabindex', '0');
    expect(screen.getAllByRole('columnheader')).toHaveLength(11);
    expect(screen.getByText('Layla Al-Hashimi')).toBeVisible();
    expect(screen.getByText('Senior Counsel')).toBeVisible();
    expect(screen.getByText('+2 via linked records')).toBeVisible();
    expect(screen.getByText('Resolved in period / resolved + open at period end')).toBeVisible();
    expect(screen.getByText('Due in period / discharged on time')).toBeVisible();
    expect(screen.getByText('36 of 59 items attributed (61%)')).toBeVisible();
    expect(screen.getAllByLabelText(/Unavailable:/)).toHaveLength(4);
    const loadIndex = container.querySelector('[data-workforce-metric="load-index"]');
    expect(loadIndex).toHaveClass('text-[color:var(--wt-teal-900)]');
    expect(loadIndex?.className).not.toMatch(/critical|high|warn/);
    expect(
      screen.getByRole('button', {
        name: 'Unavailable: The capacity-to-utilisation formula is not defined.',
      }),
    ).toBeVisible();
  });

  it('expands a member breakdown with keyboard-accessible links to each domain register', async () => {
    const user = userEvent.setup();
    renderPanel(<WorkforceTeamPanel state="ready" report={report()} />);

    const trigger = screen.getByRole('button', {
      name: 'Show Layla Al-Hashimi workload breakdown',
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls');
    expect(trigger.closest('th')).toHaveAttribute('scope', 'row');
    expect(screen.queryByRole('link', { name: /Contracts/ })).not.toBeInTheDocument();

    trigger.focus();
    await user.keyboard('{Enter}');

    const expandedTrigger = screen.getByRole('button', {
      name: 'Hide Layla Al-Hashimi workload breakdown',
    });
    expect(expandedTrigger).toHaveAttribute('aria-expanded', 'true');
    const details = screen.getByRole('region', {
      name: 'Hide Layla Al-Hashimi workload breakdown',
    });
    expect(details).toHaveAttribute('id', expandedTrigger.getAttribute('aria-controls'));
    const contractLink = screen.getByRole('link', {
      name: 'Contracts Open: 10 Resolved: 3',
    });
    expect(contractLink).toHaveAttribute('href', '/lex/contracts');
    expect(contractLink.closest('td')).toHaveAttribute('colspan', '11');

    await user.click(expandedTrigger);
    expect(screen.queryByRole('link', { name: /Contracts/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Show Layla Al-Hashimi workload breakdown',
    })).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps members without attributable activity drillable without inventing destinations', async () => {
    const user = userEvent.setup();
    const withoutDomains = report();
    withoutDomains.team[0] = { ...withoutDomains.team[0], byDomain: [] };
    renderPanel(<WorkforceTeamPanel state="unavailable" report={withoutDomains} />);

    await user.click(screen.getByRole('button', {
      name: 'Show Layla Al-Hashimi workload breakdown',
    }));

    expect(screen.getByText('No attributable domain activity for this period.')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Contracts/ })).not.toBeInTheDocument();
  });

  it('renders loading, empty, and retryable error as distinct states', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    const loading = renderPanel(<WorkforceTeamPanel state="loading" />);
    expect(screen.getByRole('status', { name: 'Loading team performance' })).toBeVisible();

    loading.unmount();
    const empty = renderPanel(<WorkforceTeamPanel state="empty" />);
    expect(screen.getByText('No team members are available for this scope')).toBeVisible();

    empty.unmount();
    renderPanel(<WorkforceTeamPanel state="error" onRetry={retry} />);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps real zero distinct from empty and unavailable', () => {
    const zeroReport = report();
    zeroReport.team[0].metrics.activeWorkload = value(0);
    zeroReport.team[0].metrics.completionRatePct = value(0);
    zeroReport.coverage = { ...zeroReport.coverage, itemsTotal: 0, itemsAttributed: 0, attributionPct: 0 };
    renderPanel(<WorkforceTeamPanel state="zero" report={zeroReport} />);

    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.queryByText('No team members are available for this scope')).not.toBeInTheDocument();
  });

  it('shows unscoped, stale, forbidden, query-error, truncated, inactive, and unverified signals', () => {
    const degraded = report();
    degraded.scope = {
      ...degraded.scope, mode: 'unscoped', reason: 'roster_not_configured', warning: 'roster_stale', staleDays: 12,
    };
    degraded.period = {
      ...degraded.period, timezone: 'UTC', calendarSource: 'fallback_utc',
      workingDays: missing('calendar_unavailable'),
    };
    degraded.team[0] = { ...degraded.team[0], identityStatus: 'unverified', userStatus: 'inactive' };
    degraded.coverage = { ...degraded.coverage, rowsTruncated: 4 };
    degraded.degraded = true;
    degraded.errors = [
      { domain: 'contracts', kind: 'forbidden' },
      { domain: 'cases', kind: 'query_error', detail: 'timeout' },
    ];
    const retry = vi.fn();
    renderPanel(<WorkforceTeamPanel state="degraded" report={degraded} onRetry={retry} />);

    expect(screen.getByText(/Org roster not configured/)).toBeVisible();
    expect(screen.getByText(/roster may be stale/)).toBeVisible();
    expect(screen.getByText(/Contracts: you do not have permission/)).toBeVisible();
    expect(screen.getByText(/Cases: the domain could not be queried/)).toBeVisible();
    expect(screen.getByText('Inactive')).toBeVisible();
    expect(screen.getByText('Unverified identity')).toBeVisible();
    expect(screen.getByText('4 additional rows are not shown')).toBeVisible();
    expect(screen.queryByText(/working days/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  it('localizes Arabic numerals, labels, reasons, and RTL output', () => {
    renderPanel(<WorkforceTeamPanel state="unavailable" report={report()} />, 'ar');

    expect(screen.getByRole('heading', { name: 'توزيع الأحمال' })).toBeVisible();
    expect(screen.getByText(/أُسنِد ٣٦ من أصل ٥٩/)).toBeVisible();
    expect(screen.getByText('المحلول خلال الفترة / المحلول + المفتوح في نهاية الفترة')).toBeVisible();
    expect(screen.getByText('المستحق خلال الفترة / المنفّذ في موعده')).toBeVisible();
    expect(screen.getAllByLabelText(/غير متاح:/)).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'عرض تفاصيل عبء عمل Layla Al-Hashimi' })).toBeVisible();
  });

  it('localizes every lifecycle reason without falling back to generic unavailable copy', () => {
    const lifecycle = report();
    lifecycle.team[0].metrics = {
      ...lifecycle.team[0].metrics,
      completionRatePct: missing('no_period_activity'),
      obligationDischargePct: missing('no_obligations_due_in_period'),
      medianCycleDays: missing('no_cycle_sample'),
      onTimePct: missing('terminal_timestamp_unavailable'),
      approvalLatencyHrs: missing('historical_state_unavailable'),
    };

    const english = renderPanel(<WorkforceTeamPanel state="ready" report={lifecycle} />);
    for (const reason of [
      'No resolved or period-end open activity is available for this period.',
      'No obligations were due during this period.',
      'No completed-work sample is available for cycle-time measurement.',
      'A reliable terminal-status timestamp is unavailable.',
      'A reliable historical state at the period boundary is unavailable.',
    ]) {
      expect(screen.getByRole('button', { name: `Unavailable: ${reason}` })).toBeVisible();
    }
    expect(screen.queryByRole('button', { name: 'Unavailable: This measure is unavailable.' })).not.toBeInTheDocument();

    english.unmount();
    renderPanel(<WorkforceTeamPanel state="ready" report={lifecycle} />, 'ar');
    for (const reason of [
      'لا يتوفر نشاط محلول أو مفتوح في نهاية هذه الفترة.',
      'لم تستحق أي التزامات خلال هذه الفترة.',
      'لا تتوفر عينة أعمال مكتملة لقياس مدة الدورة.',
      'لا يتوفر طابع زمني موثوق للحالة النهائية.',
      'لا تتوفر حالة تاريخية موثوقة عند حدود الفترة.',
    ]) {
      expect(screen.getByRole('button', { name: `غير متاح: ${reason}` })).toBeVisible();
    }
    expect(screen.queryByRole('button', { name: 'غير متاح: هذا المقياس غير متاح.' })).not.toBeInTheDocument();
  });

  it('uses approved tokens and no physical left/right layout utilities', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/(dashboard)/lex/_components/role-dashboard/widgets/workforce-team-panel.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/#[\da-f]{3,8}/i);
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-/);
    expect(source).not.toMatch(/\bshadow-(?!none\b)/);
    expect(source).toContain('var(--wt-teal-300)');
    expect(source).toContain('inlineSize');
  });
});
