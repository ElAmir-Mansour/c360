import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { checkPermission } from '@/stores/auth-store';
import { LEX_ROLE_PERMISSIONS } from '@/components/lex/access/lex-role-permissions';
import {
  ADMIN_HUB_CARDS,
  resolveCardState,
} from './_lib/admin-hub-cards';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lex/admin',
}));

// The guard is unit-tested separately; here we exercise the card grid directly,
// so render children unconditionally.
vi.mock('@/components/lex/access/lex-access-guard', () => ({
  LexAccessGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Health dashboard does live queries — stub it out for an offline render.
vi.mock('./_components/admin-health-dashboard', () => ({
  AdminHealthDashboard: () => <div data-testid="admin-health" />,
}));

// Per-test permission predicate (mirrors the real wildcard resolver).
let currentPerms: string[] = [];
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) => checkPermission(currentPerms, perm),
    user: { id: 'u1' },
    isAuthenticated: true,
    isHydrated: true,
  }),
}));

import LexAdminPage from './page';

function renderAs(roleSlug: string) {
  currentPerms = [...(LEX_ROLE_PERMISSIONS[roleSlug] ?? [])];
  return renderWithQuery(<LexAdminPage />);
}

/** Read the §13 state stamped on a rendered card (or HIDDEN when absent). */
function cardState(id: string): string {
  const el = screen.queryByTestId(`admin-card-${id}`);
  return el?.getAttribute('data-card-state') ?? 'HIDDEN';
}

beforeEach(() => {
  currentPerms = [];
});

describe('LexAdminPage — §13 permission-filtered hub', () => {
  it('System Administrator sees manageable cards (manage keys), Approval Policies hidden', () => {
    renderAs('legal-system-admin');

    expect(screen.getByTestId('admin-hub-grid')).toBeInTheDocument();
    // Admin holds the :manage keys → MANAGEABLE for config domains.
    expect(cardState('workingCalendars')).toBe('MANAGEABLE');
    expect(cardState('serviceCatalog')).toBe('MANAGEABLE');
    expect(cardState('slaTargets')).toBe('MANAGEABLE');
    expect(cardState('escalations')).toBe('MANAGEABLE');
    expect(cardState('integrations')).toBe('MANAGEABLE');
    expect(cardState('orgEntities')).toBe('MANAGEABLE');
    expect(cardState('classifications')).toBe('MANAGEABLE');
    expect(cardState('notificationRules')).toBe('MANAGEABLE');
    // role:manage → Role Matrix manageable.
    expect(cardState('roleMatrix')).toBe('MANAGEABLE');
    // Admin holds NO approval:read/admin → Approval Policies hidden.
    expect(cardState('approvalPolicies')).toBe('HIDDEN');
    expect(screen.queryByTestId('admin-card-approvalPolicies')).not.toBeInTheDocument();
    // At least one Manage badge present.
    expect(screen.getAllByTestId('card-state-MANAGEABLE').length).toBeGreaterThan(0);
  });

  it('Auditor sees read-only cards (view keys, no manage) incl. Role Matrix read-only', () => {
    renderAs('legal-auditor');

    expect(screen.getByTestId('admin-hub-grid')).toBeInTheDocument();
    // Auditor holds role:view (NOT role:manage) → Role Matrix is READ_ONLY.
    expect(cardState('roleMatrix')).toBe('READ_ONLY');
    // catalog:view → calendars/services/classifications/attachments read-only.
    expect(cardState('workingCalendars')).toBe('READ_ONLY');
    expect(cardState('serviceCatalog')).toBe('READ_ONLY');
    expect(cardState('classifications')).toBe('READ_ONLY');
    expect(cardState('attachmentPolicies')).toBe('READ_ONLY');
    // security:view / integration:read → read-only.
    expect(cardState('orgEntities')).toBe('READ_ONLY');
    expect(cardState('integrations')).toBe('READ_ONLY');
    // No SLA/escalation/approval/notification view → hidden.
    expect(cardState('slaTargets')).toBe('HIDDEN');
    expect(cardState('escalations')).toBe('HIDDEN');
    expect(cardState('approvalPolicies')).toBe('HIDDEN');
    expect(cardState('notificationRules')).toBe('HIDDEN');
    // No manage anywhere → no Manage badge, read-only notice shown.
    expect(screen.queryByTestId('card-state-MANAGEABLE')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('card-state-READ_ONLY').length).toBeGreaterThan(0);
  });

  it('Legal Officer sees only the Legal Holds card (coarse lex:read/write tier), no granular admin surfaces', () => {
    renderAs('legal-officer');

    // FR-WATHEEQ-005: the Legal Holds register gates on the SAME coarse backend
    // tiers as its routes (view lex:read / apply+release lex:write — routes.go),
    // which every operational legal role holds. So the officer reaches the holds
    // register even though they hold none of the granular §13 config permissions.
    expect(screen.getByTestId('admin-hub-grid')).toBeInTheDocument();
    expect(cardState('legalHolds')).toBe('MANAGEABLE');
    // ...but NO granular §13 configuration surface is exposed to a non-admin role.
    expect(cardState('workingCalendars')).toBe('HIDDEN');
    expect(cardState('serviceCatalog')).toBe('HIDDEN');
    expect(cardState('slaTargets')).toBe('HIDDEN');
    expect(cardState('escalations')).toBe('HIDDEN');
    expect(cardState('orgEntities')).toBe('HIDDEN');
    expect(cardState('classifications')).toBe('HIDDEN');
    expect(cardState('approvalPolicies')).toBe('HIDDEN');
    expect(cardState('integrations')).toBe('HIDDEN');
    expect(cardState('roleMatrix')).toBe('HIDDEN');
    expect(cardState('notificationRules')).toBe('HIDDEN');
    // Legal Holds is the ONLY card an officer can see.
    expect(screen.getAllByTestId(/^admin-card-/)).toHaveLength(1);
    // With a card visible, the empty state is gone and the health linter shows.
    expect(screen.queryByTestId('admin-hub-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('admin-health')).toBeInTheDocument();
  });
});

describe('ADMIN_HUB_CARDS — every card href resolves to a shipped page', () => {
  // Regression lock: the hub used to render cards for §13 surfaces whose pages
  // were never built (/lex/admin/role-assignments, /lex/admin/security) and for
  // a mis-mapped href (/lex/admin/notifications instead of /lex/notifications),
  // 404ing permitted admins. A card must never link to a route without a page.
  it.each(ADMIN_HUB_CARDS.map((c) => [c.id, c.href] as const))(
    '%s → %s has a page.tsx',
    async (_id, href) => {
      const { existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const pagePath = join(process.cwd(), 'src', 'app', '(dashboard)', ...href.split('/').filter(Boolean), 'page.tsx');
      expect(existsSync(pagePath), `expected page file at ${pagePath}`).toBe(true);
    },
  );

  it('has bilingual copy for every card', async () => {
    const { getAdminHubLabels } = await import('./_lib/admin-hub-cards');
    for (const locale of ['en', 'ar']) {
      const labels = getAdminHubLabels(locale);
      for (const card of ADMIN_HUB_CARDS) {
        expect(labels.cards[card.id]?.title, `${locale} title for ${card.id}`).toBeTruthy();
        expect(labels.cards[card.id]?.description, `${locale} description for ${card.id}`).toBeTruthy();
      }
    }
  });
});

describe('resolveCardState — §13 three-state rule', () => {
  const card = ADMIN_HUB_CARDS.find((c) => c.id === 'roleMatrix')!;

  it('MANAGEABLE when manage key held', () => {
    expect(
      resolveCardState((p) => checkPermission(['lex:role:manage'], p), card),
    ).toBe('MANAGEABLE');
  });

  it('READ_ONLY when only view key held', () => {
    expect(
      resolveCardState((p) => checkPermission(['lex:role:view'], p), card),
    ).toBe('READ_ONLY');
  });

  it('HIDDEN when neither held', () => {
    expect(
      resolveCardState((p) => checkPermission(['lex:case:view'], p), card),
    ).toBe('HIDDEN');
  });

  it('MANAGEABLE for a manage-only persona that lacks the view key (System Admin)', () => {
    // System admin has role:manage but NOT role:view — must still be MANAGEABLE.
    const adminPerms = LEX_ROLE_PERMISSIONS['legal-system-admin'];
    expect(adminPerms).not.toContain('lex:role:view');
    expect(
      resolveCardState((p) => checkPermission([...adminPerms], p), card),
    ).toBe('MANAGEABLE');
  });
});
