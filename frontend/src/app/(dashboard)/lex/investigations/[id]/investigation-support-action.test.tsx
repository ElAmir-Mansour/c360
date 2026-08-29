/**
 * §2 of LEX-SUPPORT-CONTEXT-AND-APPROVAL — the "Ask for support" action must be
 * reachable from the investigation record itself, not only from the top bar /
 * inbox.
 *
 * The assertion goes through the real seam: clicking the real
 * `AskForSupportButton` dispatches the composer's open event, whose detail is
 * the bound record context. That proves the page passes the context EXPLICITLY
 * (subjectType + this investigation's id) rather than relying on URL parsing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexInvestigationDetailPage from '@/app/(dashboard)/lex/investigations/[id]/page';
import type { Investigation } from '@/lib/lex/investigations';
import { supportLabels } from '@/app/(dashboard)/lex/inbox/_lib/support-i18n';

const INVESTIGATION_ID = '9a4c7e21-3b58-4d6f-8e02-1c5b9d7f3a64';
const OPEN_SUPPORT_EVENT = 'clario360:lex-support:open';

const { authState, getInvestigationMock, listAuditMock } = vi.hoisted(() => ({
  authState: { permissions: new Set<string>() },
  getInvestigationMock: vi.fn(),
  listAuditMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/lex/investigations/${INVESTIGATION_ID}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: INVESTIGATION_ID }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => authState.permissions.has(permission),
    hasAnyPermission: (permissions: string[]) =>
      permissions.some((permission) => authState.permissions.has(permission)),
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'u-1' },
  }),
}));

vi.mock('@/lib/lex/investigations', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/lex/investigations')>('@/lib/lex/investigations');
  return {
    ...actual,
    investigationsApi: {
      ...actual.investigationsApi,
      get: getInvestigationMock,
      listAudit: listAuditMock,
      listApprovalTasks: vi.fn().mockResolvedValue([]),
    },
  };
});

const investigation: Investigation = {
  id: INVESTIGATION_ID,
  tenant_id: 'tenant-1',
  investigation_number: 'INV-2026-011',
  subject: 'Unauthorized procurement transactions',
  lead_investigator: 'Ahmad Mahmoud',
  status: 'in_progress',
  priority: 'high',
  findings: '',
  recommendations: '',
  ai_drafted: false,
  department: 'Procurement',
  metadata: {},
  created_by: 'u-1',
  created_at: '2026-07-01T09:00:00.000Z',
  updated_at: '2026-07-12T10:30:00.000Z',
  parties: [],
  statements: [],
  evidence: [],
} as unknown as Investigation;

/** Records every context the composer seam is opened with. */
function captureSupportContexts() {
  const seen: unknown[] = [];
  const handler = (event: Event) => seen.push((event as CustomEvent).detail);
  window.addEventListener(OPEN_SUPPORT_EVENT, handler);
  return { seen, dispose: () => window.removeEventListener(OPEN_SUPPORT_EVENT, handler) };
}

let capture: ReturnType<typeof captureSupportContexts>;

beforeEach(() => {
  authState.permissions = new Set(['lex:investigation:view', 'lex:support:create']);
  getInvestigationMock.mockReset().mockResolvedValue(investigation);
  listAuditMock.mockReset().mockResolvedValue([]);
  capture = captureSupportContexts();
});

afterEach(() => capture.dispose());

describe('Lex investigation detail — ask for support', () => {
  it('binds the composer to this investigation when the action is used', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexInvestigationDetailPage />);

    const button = await screen.findByRole('button', { name: supportLabels.en.ask });
    await user.click(button);

    expect(capture.seen).toEqual([
      { subjectType: 'investigation', subjectId: INVESTIGATION_ID },
    ]);
  });

  it('renders the Arabic action label under the ar locale', async () => {
    renderWithQuery(<LexInvestigationDetailPage />, { locale: 'ar' });

    expect(
      await screen.findByRole('button', { name: supportLabels.ar.ask }),
    ).toBeInTheDocument();
  });

  it('hides the action from a viewer without lex:support:create', async () => {
    authState.permissions = new Set(['lex:investigation:view']);
    renderWithQuery(<LexInvestigationDetailPage />);

    // The record loaded, so absence is a gating decision and not a render gap.
    expect(
      (await screen.findAllByText('Unauthorized procurement transactions')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: supportLabels.en.ask }),
    ).not.toBeInTheDocument();
  });
});
