import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
}));

vi.mock('@/components/providers/locale-provider', () => ({
  useLocale: () => ({ locale: 'ar', direction: 'rtl' }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));

vi.mock('@/lib/lex/ksa', () => ({
  useLexFormat: () => ({
    direction: 'rtl',
    formatNumber: (value: number) => `١${value}`,
  }),
}));

vi.mock('../_lib/lex-i18n', () => ({
  useLexLabels: () => ({
    overview: {
      commandKpis: {
        activeContracts: 'Active contracts',
        openMatters: 'Open matters',
        overdueObligations: 'Overdue obligations',
        pendingApprovals: 'Pending approvals',
        slaBreaches: 'SLA breaches',
        openAlerts: 'Open alerts',
      },
    },
  }),
}));

vi.mock('../_lib/use-lex-command-center', () => ({
  useLexCommandKpis: () => ({
    activeContracts: { value: 12, isLoading: false },
    openMatters: { value: 4, isLoading: false },
    overdueObligations: { value: 0, isLoading: false },
    pendingApprovals: { value: 3, isLoading: false },
    slaBreaches: { value: 1, isLoading: false },
    openAlerts: { value: 2, isLoading: false },
  }),
}));

import { CrossDomainKpis } from './cross-domain-kpis';

describe('CrossDomainKpis', () => {
  beforeEach(() => {
    state.permissions = new Set([
      'lex:contract:view',
      'lex:contract:approve',
      'lex:request:view',
    ]);
  });

  it('keeps permitted KPI links, RTL context and a balanced five-card grid', () => {
    const { container } = render(<CrossDomainKpis />);

    expect(container.firstElementChild).toHaveAttribute('dir', 'rtl');
    expect(container.firstElementChild).toHaveAttribute('lang', 'ar');
    expect(container.querySelector('.cross-domain-kpi-grid')).toHaveClass(
      'gap-3',
      '2xl:grid-cols-5',
    );
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('link', { name: /Active contracts/i })).toHaveAttribute(
      'href',
      '/lex/contracts',
    );
    expect(screen.queryByRole('link', { name: /Open alerts/i })).not.toBeInTheDocument();
  });
});
