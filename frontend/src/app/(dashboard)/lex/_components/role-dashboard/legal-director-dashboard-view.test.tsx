import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { resolveLegalDirectorDashboardLabels } from '../../_lib/role-dashboards/legal-director-i18n';

import {
  LegalDirectorDashboardView,
  type LegalDirectorDashboardViewProps,
  type LegalDirectorKpiStrip,
} from './legal-director-dashboard-view';
import type { WorkforceReport } from './widgets/workforce-contract';

function kpis(locale: 'en' | 'ar' = 'en'): LegalDirectorKpiStrip {
  const labels = resolveLegalDirectorDashboardLabels(locale);

  return [
    { state: 'ready', props: { label: labels.kpis.sla, value: 0, format: 'percent', tone: 'slate', href: '/lex/service-desk/sla-board' } },
    { state: 'ready', props: { label: labels.kpis.complianceScore, value: 99, format: 'percent', tone: 'cyan', href: '/lex/compliance' } },
    { state: 'ready', props: { label: labels.kpis.activeCases, value: 3, format: 'count', tone: 'olive', href: '/lex/cases' } },
    { state: 'ready', props: { label: labels.kpis.activeInvestigations, value: 2, format: 'count', tone: 'green', href: '/lex/investigations' } },
    { state: 'unavailable', props: { label: labels.kpis.activeContracts } },
    {
      state: 'loading',
      props: { label: labels.kpis.activeConsultations, tone: 'blue' },
    },
  ];
}

/** Smallest report the workforce panel accepts as ready data. */
function workforceReport(locale: 'en' | 'ar' = 'en'): WorkforceReport {
  const available = (value: number) => ({ value, available: true });
  const missing = { value: null, available: false, reason: 'aggregation_not_implemented' };

  return {
    scope: { mode: 'org', entityIds: [], userIds: [], memberCount: 1 },
    period: {
      from: '2026-07-01',
      to: '2026-07-31',
      timezone: 'Asia/Riyadh',
      calendarSource: 'tenant',
      workingDays: available(22),
    },
    team: [
      {
        userId: 'member-1',
        displayName: locale === 'ar' ? 'ليلى الهاشمي' : 'Layla Al-Hashimi',
        title: {
          en: 'Senior legal counsel for complex international regulatory matters',
          ar: 'مستشارة قانونية أولى للقضايا التنظيمية الدولية المعقدة',
        },
        identityStatus: 'resolved',
        userStatus: 'active',
        linkedCount: 0,
        byDomain: [],
        metrics: {
          activeWorkload: available(0),
          loadIndexPct: available(0),
          utilisationPct: missing,
          completionRatePct: available(0),
          onTimePct: missing,
          medianCycleDays: available(0),
          approvalLatencyHrs: missing,
          obligationDischargePct: available(0),
          overdueCount: available(0),
          idleAssignmentPct: missing,
        },
      },
    ],
    rollup: {
      distributionGini: missing,
      keyPersonConcentrationPct: missing,
      backlogBurnPct: missing,
      unroutedRequests: missing,
      aging: {},
    },
    coverage: {
      domainsRequested: 1,
      domainsReturned: 1,
      itemsTotal: 0,
      itemsAttributed: 0,
      itemsUnattributed: 0,
      attributionPct: 0,
      rowsReturned: 1,
      rowsTruncated: 0,
      exclusions: [],
    },
    degraded: false,
    errors: [],
  };
}

function readyProps(locale: 'en' | 'ar' = 'en'): LegalDirectorDashboardViewProps {
  const labels = resolveLegalDirectorDashboardLabels(locale);

  return {
    user: {
      firstName: locale === 'ar' ? 'محمد' : 'Mohammed',
      lastName: locale === 'ar' ? 'المقيم' : 'Almoqhem',
      role: 'LEGAL_DIRECTOR',
      roleLabel: labels.hero.rolePill,
    },
    kpis: kpis(locale),
    escalation: {
      state: 'ready',
      props: {
        levels: [
          { level: 'critical', count: 0, href: '/lex/inbox?severity=critical' },
          { level: 'high', count: 2, href: '/lex/inbox?severity=high' },
        ],
        totalLabel: labels.values.warnings(locale === 'ar' ? '٢' : '2', false),
      },
    },
    serviceRequests: {
      state: 'ready',
      props: {
        total: 0,
        segments: [
          {
            key: 'contracts',
            label: labels.serviceRequestCategories.contracts,
            value: 0,
            href: '/lex/contracts',
          },
        ],
      },
    },
    teamWorkload: { state: 'zero', report: workforceReport(locale) },
    resolutionRate: {
      state: 'ready',
      props: {
        bars: [{ label: labels.serviceRequestCategories.contracts, ratePct: 0, href: '/lex/contracts' }],
      },
    },
    legalDomains: {
      state: 'ready',
      props: {
        domains: [
          {
            key: 'litigation_cases',
            label: labels.domains.litigation_cases,
            count: 0,
            tint: 'teal',
            href: '/lex/cases',
          },
          {
            key: 'reports',
            label: labels.domains.reports,
            count: null,
            tint: 'blue',
            href: '/lex/reports',
          },
        ],
      },
    },
    calendar: {
      state: 'ready',
      props: {
        events: [
          {
            id: 'hearing:case-1',
            type: 'hearing',
            title: locale === 'ar' ? 'جلسة استئناف' : 'Appeal hearing',
            date: '2026-08-03T09:00:00.000Z',
            severity: 'high',
            href: '/lex/cases/case-1',
          },
        ],
        now: new Date('2026-08-01T09:00:00.000Z'),
      },
    },
  };
}

describe('LegalDirectorDashboardView', () => {
  it('composes the approved hero, six KPI positions, panel columns, and domains', () => {
    const { container } = renderWithQuery(<LegalDirectorDashboardView {...readyProps()} />);
    const view = container.querySelector<HTMLElement>('[data-legal-director-dashboard-view]');

    expect(view).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('heading', { name: 'Welcome, Mohammed Almoqhem', level: 1 })).toBeVisible();
    expect(within(view!).getByText('Legal Director (Head of Legal)')).toBeVisible();
    const kpiCards = Array.from(
      container.querySelector('[data-legal-director-kpi-strip]')?.children ?? [],
    );
    expect(kpiCards).toHaveLength(6);
    expect(
      kpiCards.map(
        (card) => card.querySelector('p')?.textContent ?? card.getAttribute('aria-label'),
      ),
    ).toEqual([
      'SLA',
      'Compliance Score',
      'Active Cases',
      'Active Investigations',
      'Active Contracts',
      'Active Consultations',
    ]);
    expect(container.querySelector('[data-panel-column="primary"]')?.children).toHaveLength(2);
    expect(container.querySelector('[data-panel-column="secondary"]')?.children).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Legal Domains' })).toBeVisible();
  });

  it('omits the AI Agent band entirely when the caller has no assistant', () => {
    // `readyProps` carries no `aiAgent`, which is exactly the shape the
    // container hands over for a caller without `lex:ai:use` or a deployment
    // with LEX_AI_ENABLED off. Nothing renders — not an error, not an empty box,
    // not even the band's own wrapper.
    const { container } = renderWithQuery(<LegalDirectorDashboardView {...readyProps()} />);

    expect(screen.queryByRole('heading', { name: 'My AI Agent' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-legal-director-ai-agent]')).toBeNull();
    expect(screen.queryByLabelText('Ask anything')).not.toBeInTheDocument();
  });

  it('renders the AI Agent band as a full-width slot when the caller has one', () => {
    const { container } = renderWithQuery(
      <LegalDirectorDashboardView
        {...readyProps()}
        aiAgent={{
          state: 'ready',
          sessions: [
            {
              id: 'session-1',
              title: 'Contract renewal exposure',
              updatedAt: '2026-08-01T09:00:00.000Z',
            },
          ],
          activeSessionId: null,
          turns: [],
          isLoadingTurns: false,
          isSending: false,
          sendFailure: null,
          now: new Date('2026-08-01T09:00:00.000Z'),
          onAsk: vi.fn(),
          onSelectSession: vi.fn(),
          onNewChat: vi.fn(),
        }}
      />,
    );
    const band = container.querySelector<HTMLElement>('[data-legal-director-ai-agent]');

    expect(screen.getByRole('heading', { name: 'My AI Agent' })).toBeVisible();
    expect(within(band!).getByText('What can I help with?')).toBeVisible();
    // Its own two-column split needs the full width, so it is never one of the
    // 57/43 analytics cells.
    expect(container.querySelector('[data-legal-director-panel-grid]')?.contains(band!)).toBe(
      false,
    );
    expect(container.querySelector('[data-panel-column="primary"]')?.children).toHaveLength(2);
  });

  it('passes through the approved role label and gives every instance a unique heading relationship', () => {
    const first = readyProps();
    const second = readyProps();
    first.user.roleLabel = 'Approved role label';
    second.user.roleLabel = 'Second approved role label';

    const { container } = renderWithQuery(
      <>
        <LegalDirectorDashboardView {...first} />
        <LegalDirectorDashboardView {...second} />
      </>,
    );
    const views = Array.from(
      container.querySelectorAll<HTMLElement>('[data-legal-director-dashboard-view]'),
    );
    const headingIds = views.map((view) => view.getAttribute('aria-labelledby'));

    expect(screen.getByText('Approved role label')).toBeVisible();
    expect(screen.getByText('Second approved role label')).toBeVisible();
    expect(new Set(headingIds).size).toBe(2);
    headingIds.forEach((headingId) => {
      expect(headingId).not.toBeNull();
      expect(container.querySelector(`[id="${headingId}"]`)).toBeInTheDocument();
    });
  });

  it('preserves zero, null, partial, and overflowing ready data', () => {
    renderWithQuery(<LegalDirectorDashboardView {...readyProps()} />);

    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText('Senior legal counsel for complex international regulatory matters')).toBeVisible();
    expect(screen.getByRole('link', { name: /Reports/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /Reports/ })).not.toHaveTextContent('null');
    expect(screen.getAllByRole('table').length).toBeGreaterThanOrEqual(3);
  });

  it('renders the six independent loading and empty panel unions', () => {
    const props = readyProps();
    const loading: LegalDirectorDashboardViewProps = {
      ...props,
      escalation: { state: 'loading' },
      serviceRequests: { state: 'loading' },
      teamWorkload: { state: 'loading' },
      resolutionRate: { state: 'loading' },
      legalDomains: { state: 'loading' },
      calendar: { state: 'loading' },
    };
    const { unmount } = renderWithQuery(<LegalDirectorDashboardView {...loading} />);

    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(6);

    unmount();
    renderWithQuery(
      <LegalDirectorDashboardView
        {...props}
        escalation={{ state: 'empty' }}
        serviceRequests={{ state: 'empty' }}
        teamWorkload={{ state: 'empty' }}
        resolutionRate={{ state: 'empty' }}
        legalDomains={{ state: 'empty' }}
        calendar={{ state: 'empty' }}
      />,
    );

    const labels = resolveLegalDirectorDashboardLabels('en');
    expect(screen.getByText(labels.states.escalations.empty)).toBeVisible();
    expect(screen.getByText(labels.states.serviceRequests.empty)).toBeVisible();
    expect(screen.getByText(labels.states.resolutionRate.empty)).toBeVisible();
    expect(screen.getByText(labels.states.legalDomains.empty)).toBeVisible();
    expect(screen.getByText(labels.states.calendar.empty)).toBeVisible();
    // Team Workload speaks the workforce contract's own vocabulary now, not the
    // dashboard-shell one: its empty state names the SCOPE that returned nobody.
    expect(
      screen.getByText('No team members are available for this scope'),
    ).toBeVisible();
  });

  it('keeps each error retry independently keyboard-usable', () => {
    const retry = vi.fn();
    const props = readyProps();
    renderWithQuery(
      <LegalDirectorDashboardView
        {...props}
        escalation={{ state: 'error', onRetry: retry }}
        serviceRequests={{ state: 'error', onRetry: retry }}
        teamWorkload={{ state: 'error', onRetry: retry }}
        resolutionRate={{ state: 'error', onRetry: retry }}
        legalDomains={{ state: 'error', onRetry: retry }}
        calendar={{ state: 'error', onRetry: retry }}
      />,
    );

    const retryButtons = screen.getAllByRole('button', { name: 'Retry' });
    expect(retryButtons).toHaveLength(6);
    retryButtons.forEach((button) => fireEvent.click(button));
    expect(retry).toHaveBeenCalledTimes(6);
  });

  it('holds a permission-masked KPI position instead of leaving a skeleton behind', () => {
    const labels = resolveLegalDirectorDashboardLabels('en');
    const { container } = renderWithQuery(<LegalDirectorDashboardView {...readyProps()} />);
    const strip = container.querySelector('[data-legal-director-kpi-strip]');
    const masked = strip?.children[4] as HTMLElement;

    expect(masked).toHaveAttribute(
      'aria-label',
      labels.accessibility.kpiUnavailable(labels.kpis.activeContracts),
    );
    expect(masked).not.toHaveAttribute('aria-busy');
    // The strip keeps all six positions so the grid never reflows per persona.
    expect(strip?.children).toHaveLength(6);
  });

  it('renders the workload window control inside the panel it scopes', () => {
    const props = readyProps();
    // A stand-in, not the real selector: the view is transport-free and takes
    // the control as an opaque node, so what it renders is the caller's choice.
    const { container } = renderWithQuery(
      <LegalDirectorDashboardView
        {...props}
        teamWorkloadControl={<span data-window-control="">Dashboard time window</span>}
      />,
    );
    const slot = container.querySelector<HTMLElement>('[data-legal-director-team-workload]');

    expect(within(slot!).getByText('Dashboard time window')).toBeVisible();
    expect(slot!.querySelector('[data-window-control]')).not.toBeNull();
    // Scoped to the one panel whose source accepts a date range — never the hero.
    expect(
      container.querySelector('[data-legal-director-panel-grid]')?.contains(slot!),
    ).toBe(true);
  });

  it('mirrors the complete composition and uses Arabic labels and numerals', () => {
    const { container } = renderWithQuery(
      <LegalDirectorDashboardView {...readyProps('ar')} />,
      { locale: 'ar' },
    );
    const labels = resolveLegalDirectorDashboardLabels('ar');

    expect(container.querySelector('[data-legal-director-dashboard-view]')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: labels.hero.welcome('محمد المقيم') })).toBeVisible();
    expect(screen.getByRole('heading', { name: labels.panels.escalations })).toBeVisible();
    expect(screen.getAllByText('٠').length).toBeGreaterThan(0);
  });

  it('uses only approved tokens and logical layout properties', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/(dashboard)/lex/_components/role-dashboard/legal-director-dashboard-view.tsx'),
      'utf8',
    );
    const css = readFileSync(
      join(process.cwd(), 'src/app/(dashboard)/lex/_components/role-dashboard/legal-director-dashboard-view.module.css'),
      'utf8',
    );

    expect(`${source}\n${css}`).not.toMatch(/#[\da-f]{3,8}/i);
    expect(css).not.toMatch(/\b(?:margin|padding|inset|border)-(?:left|right)\b|\b(?:left|right)\s*:/);
    expect(css).not.toMatch(/box-shadow\s*:/);
    expect(css).toContain('minmax(0, 57fr) minmax(0, 43fr)');
    expect(css).toContain('repeat(6, minmax(0, 1fr))');
    expect(css).toContain('.panelColumn > *');
    expect(source).not.toMatch(
      /\b(?:fetch|axios|useQuery|useMutation|useRoleDashboardData|hasPermission|roleSlug|useRouter)\b|\/api\//,
    );
    expect(source).not.toMatch(/<(?:Link|a)\b|\bhref\s*=|\baction\s*=/);
    expect(source).toContain("props: KpiCardProps");
    // The AI Agent band is separately permissioned (`lex:ai:use`) AND feature
    // flagged, so the view composes it only when the caller hands one over. Its
    // absence is expressed by an OPTIONAL prop rather than by a state that
    // renders nothing, and the slot returns null instead of an empty wrapper.
    expect(source).toContain('aiAgent?: LegalDirectorAiAgentState');
    expect(source).toMatch(/function AiAgentSlot[\s\S]*?if \(!value\) return null;/);
  });
});
