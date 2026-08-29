/**
 * §2 of LEX-SUPPORT-CONTEXT-AND-APPROVAL — the "Ask for support" action must be
 * reachable from the case record itself, not only from the top bar / inbox.
 *
 * The assertion goes through the real seam: clicking the real
 * `AskForSupportButton` dispatches the composer's open event, whose detail is
 * the bound record context. That proves the page passes the context EXPLICITLY
 * (subjectType + this case's id) rather than relying on URL parsing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexCaseDetailPage from '@/app/(dashboard)/lex/cases/[id]/page';
import type { LegalCase } from '@/lib/lex/cases';
import { supportLabels } from '@/app/(dashboard)/lex/inbox/_lib/support-i18n';

const CASE_ID = '3f1b0d5a-6c2e-4a91-9a1f-0f4c2b7d8e11';
const OPEN_SUPPORT_EVENT = 'clario360:lex-support:open';

const { authState, getCaseMock, listCaseAuditMock, apiGetMock } = vi.hoisted(() => ({
  authState: { permissions: new Set<string>() },
  getCaseMock: vi.fn(),
  listCaseAuditMock: vi.fn(),
  apiGetMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/lex/cases/${CASE_ID}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: CASE_ID }),
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

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, apiGet: apiGetMock };
});

vi.mock('@/lib/lex/cases', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/cases')>('@/lib/lex/cases');
  return {
    ...actual,
    casesApi: {
      ...actual.casesApi,
      getCase: getCaseMock,
      listCaseAudit: listCaseAuditMock,
      listPleadings: vi.fn().mockResolvedValue([]),
      listExperts: vi.fn().mockResolvedValue([]),
      listJudgments: vi.fn().mockResolvedValue([]),
      listDefendant: vi.fn().mockResolvedValue(null),
    },
  };
});

const legalCase: LegalCase = {
  id: CASE_ID,
  tenant_id: 'tenant-1',
  case_number: 'CASE-2026-014',
  case_type: 'commercial_litigation',
  company_status: 'plaintiff',
  competent_court: 'Commercial Court in Riyadh',
  title: { ar: 'مطالبة تعويض', en: 'Compensation claim' },
  description: '',
  status: 'under_procedure',
  priority: 'high',
  strength: 'strong',
  risk_rating: 'medium',
  handling_officer_id: null,
  responsible_lawyer: 'Omar Al-Rashid',
  created_by: 'u-1',
  created_at: '2026-02-22T00:00:00.000Z',
  updated_at: '2026-05-02T00:00:00.000Z',
} as unknown as LegalCase;

/** Records every context the composer seam is opened with. */
function captureSupportContexts() {
  const seen: unknown[] = [];
  const handler = (event: Event) => seen.push((event as CustomEvent).detail);
  window.addEventListener(OPEN_SUPPORT_EVENT, handler);
  return { seen, dispose: () => window.removeEventListener(OPEN_SUPPORT_EVENT, handler) };
}

let capture: ReturnType<typeof captureSupportContexts>;

beforeEach(() => {
  authState.permissions = new Set(['lex:case:view', 'lex:support:create']);
  getCaseMock.mockReset().mockResolvedValue(legalCase);
  listCaseAuditMock.mockReset().mockResolvedValue([]);
  apiGetMock.mockReset().mockResolvedValue(null);
  capture = captureSupportContexts();
});

afterEach(() => capture.dispose());

describe('Lex case detail — ask for support', () => {
  it('binds the composer to this case when the action is used', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexCaseDetailPage />);

    const button = await screen.findByRole('button', { name: supportLabels.en.ask });
    await user.click(button);

    expect(capture.seen).toEqual([{ subjectType: 'case', subjectId: CASE_ID }]);
  });

  it('renders the Arabic action label under the ar locale', async () => {
    renderWithQuery(<LexCaseDetailPage />, { locale: 'ar' });

    expect(
      await screen.findByRole('button', { name: supportLabels.ar.ask }),
    ).toBeInTheDocument();
  });

  it('hides the action from a viewer without lex:support:create', async () => {
    authState.permissions = new Set(['lex:case:view']);
    renderWithQuery(<LexCaseDetailPage />);

    // The record loaded, so absence is a gating decision and not a render gap.
    // (The screen surface and the print report both title the record.)
    expect(
      (await screen.findAllByRole('heading', { name: 'Compensation claim' })).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: supportLabels.en.ask }),
    ).not.toBeInTheDocument();
  });
});
