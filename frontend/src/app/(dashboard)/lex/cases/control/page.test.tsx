import type { ReactNode } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexCaseControlPanelPage from './page';
import { isWithinActivityWindow } from './_lib/activity-window';

const testState = vi.hoisted(() => ({
  panel: {
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    kpis: {
      activeCases: 15,
      underReview: 5,
      dueIn30Days: 3,
      defendant: 8,
      plaintiff: 6,
      ongoingInvestigations: 2,
      activeLawsuits: 15,
      defendantShare: 40,
      plaintiffShare: 30,
      activeShare: 75,
      totalInvestigations: 4,
      totalCases: 20,
    },
    caseTypes: [{ key: 'commercial', count: 10, pct: 50 }],
    investigationTypes: [{ key: 'commercial', count: 3, pct: 75 }],
    recentCases: [
      {
        id: 'case-1',
        case_number: 'CASE-2026-001',
        title: { en: 'Supplier dispute', ar: 'نزاع مورد' },
        case_type: 'commercial',
        company_status: 'defendant',
        status: 'under_procedure',
        priority: 'high',
        responsible_lawyer: 'Amina Hassan',
        department: 'Procurement',
        next_hearing_date: '2026-08-01T09:00:00Z',
        party_count: 3,
        updated_at: '2026-07-23T09:00:00Z',
      },
      {
        id: 'case-2',
        case_number: 'CASE-2026-OLD',
        title: { en: 'Older supplier dispute', ar: 'نزاع مورد أقدم' },
        case_type: 'commercial',
        company_status: 'plaintiff',
        status: 'phase1',
        priority: 'medium',
        party_count: 2,
        updated_at: '2026-07-18T09:00:00Z',
      },
    ],
    recentInvestigations: [
      {
        id: 'inv-1',
        investigation_number: 'INV-2026-001',
        lead_investigator: 'Omar Saleh',
        status: 'in_progress',
        priority: 'medium',
        case_type: 'commercial',
        updated_at: '2026-07-23T09:00:00Z',
      },
    ],
    generatedAt: '2026-07-23T12:00:00Z',
    activeInvestigations: [
      {
        id: 'inv-1',
        investigation_number: 'INV-2026-001',
        subject: 'Procurement process review',
        lead_investigator: 'Omar Saleh',
        status: 'in_progress',
        priority: 'medium',
        department: 'Compliance',
        findings: 'Review is progressing.',
        recommendations: '',
        created_at: '2026-07-20T09:00:00Z',
        updated_at: '2026-07-23T09:00:00Z',
      },
    ],
    digest: { resolvedThisWeek: 3, onHold: 2, total: 20 },
  },
  permissions: new Set<string>(),
}));

vi.mock('./_lib/use-control-panel', () => ({
  useControlPanel: () => testState.panel,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) =>
      testState.permissions.has(permission),
  }),
}));

vi.mock('../../_guards/lex-route-guard', () => ({
  LexRouteGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../_components/case-form-dialog', () => ({
  CaseFormDialog: () => null,
}));

beforeEach(() => {
  testState.panel.isError = false;
  testState.panel.refetch.mockReset();
  testState.permissions = new Set([
    'lex:case:view',
    'lex:investigation:view',
  ]);
});

describe('Cases Control Panel page', () => {
  it('uses inclusive UTC calendar boundaries for recent-activity windows', () => {
    const asOf = '2026-07-23T12:00:00Z';

    expect(isWithinActivityWindow('2026-07-17T00:00:00Z', asOf, 7)).toBe(true);
    expect(isWithinActivityWindow('2026-07-16T23:59:59Z', asOf, 7)).toBe(false);
    expect(isWithinActivityWindow('2026-07-23T12:00:01Z', asOf, 7)).toBe(false);
    expect(isWithinActivityWindow('invalid', asOf, 7)).toBe(false);
  });

  it('renders navigation and accessible portfolio content from the view model', () => {
    testState.permissions.add('lex:case:add');
    renderWithQuery(<LexCaseControlPanelPage />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Welcome, Cases Manager',
      }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add New Case' })).toBeVisible();
    expect(screen.getByText('Active Cases')).toBeVisible();
    expect(screen.getByText('Under Review')).toBeVisible();
    expect(screen.getByText('Investigations')).toBeVisible();
    expect(screen.getByText('Due in 30 Days')).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Cases by Type' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Investigations by Case Type' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'CASE-2026-001' }),
    ).toHaveAttribute('href', '/lex/cases/case-1');
    expect(
      screen.getByRole('link', { name: 'View Full Archive' }),
    ).toHaveAttribute('href', '/lex/cases');
    expect(
      screen.getByRole('link', { name: 'INV-2026-001' }),
    ).toHaveAttribute('href', '/lex/investigations/inv-1');
    expect(screen.getByRole('progressbar', { name: /10 cases/ })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
  });

  it('uses the Figma date controls as real recent-activity filters', () => {
    renderWithQuery(<LexCaseControlPanelPage />);

    const today = screen.getByRole('button', { name: 'Today' });
    const thirtyDays = screen.getByRole('button', { name: '30 Days' });
    expect(thirtyDays).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'CASE-2026-OLD' })).toBeVisible();

    fireEvent.click(today);

    expect(today).toHaveAttribute('aria-pressed', 'true');
    expect(thirtyDays).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('link', { name: 'CASE-2026-OLD' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CASE-2026-001' })).toBeVisible();
  });

  it('renders an actionable alert when the consolidated endpoint fails', () => {
    testState.panel.isError = true;
    renderWithQuery(<LexCaseControlPanelPage />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Unable to load the control panel');
    expect(alert).toHaveTextContent(
      'The case and investigation metrics could not be retrieved.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(testState.panel.refetch).toHaveBeenCalledTimes(1);
  });

  it('uses Arabic labels and RTL direction without leaking English headings', () => {
    renderWithQuery(<LexCaseControlPanelPage />, { locale: 'ar' });

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'مرحبًا، مدير القضايا',
    });
    expect(heading).toBeVisible();
    expect(heading.closest('[dir="rtl"][lang="ar"]')).not.toBeNull();
    expect(
      screen.queryByRole('heading', {
        level: 1,
        name: 'Welcome, Cases Manager',
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /١٠ قضية/ })).toHaveAccessibleName(
      /١٠ قضية/,
    );
  });

  it('hides the create action without the case add permission', () => {
    renderWithQuery(<LexCaseControlPanelPage />);

    expect(
      screen.queryByRole('button', { name: 'Add New Case' }),
    ).not.toBeInTheDocument();
  });

  it('routes Figma assign chips into the existing allocation workflow', () => {
    testState.permissions.add('lex:case:assign');
    renderWithQuery(<LexCaseControlPanelPage />);

    expect(screen.getByRole('link', { name: 'Assign' })).toHaveAttribute(
      'href',
      '/lex/cases/control/assignment',
    );
  });
});
