/**
 * §2 of LEX-SUPPORT-CONTEXT-AND-APPROVAL — the "Ask for support" action must be
 * reachable from the consultation record itself, not only from the top bar /
 * inbox.
 *
 * The assertion goes through the real seam: clicking the real
 * `AskForSupportButton` dispatches the composer's open event, whose detail is
 * the bound record context. That proves the page passes the context EXPLICITLY
 * (subjectType + this consultation's id) rather than relying on URL parsing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexConsultationDetailPage from '@/app/(dashboard)/lex/consultations/[id]/page';
import type { Consultation } from '@/lib/lex/consultations';
import { supportLabels } from '@/app/(dashboard)/lex/inbox/_lib/support-i18n';

const CONSULTATION_ID = '5c2d1e4b-7a3f-4b82-8c11-2d9e6f0a4b73';
const OPEN_SUPPORT_EVENT = 'clario360:lex-support:open';

const { authState, getConsultationMock, listAuditMock } = vi.hoisted(() => ({
  authState: { permissions: new Set<string>() },
  getConsultationMock: vi.fn(),
  listAuditMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/lex/consultations/${CONSULTATION_ID}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: CONSULTATION_ID }),
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

vi.mock('@/lib/lex/consultations', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/lex/consultations')>('@/lib/lex/consultations');
  return {
    ...actual,
    consultationsApi: {
      ...actual.consultationsApi,
      get: getConsultationMock,
      listAudit: listAuditMock,
      listApprovalTasks: vi.fn().mockResolvedValue([]),
    },
  };
});

const consultation: Consultation = {
  id: CONSULTATION_ID,
  tenant_id: 'tenant-1',
  consultation_number: 'CONS-2026-007',
  type: 'contractual',
  title: { ar: 'استشارة تعاقدية', en: 'Supplier indemnity opinion' },
  status: 'routed',
  priority: 'high',
  requester_user_id: 'u-2',
  requester_name: 'Latifa Al-Sudairy',
  question: 'Can we accept an uncapped indemnity?',
  tags: [],
  created_by: 'u-2',
  created_at: '2026-06-01T09:00:00.000Z',
  updated_at: '2026-06-04T09:00:00.000Z',
} as unknown as Consultation;

/** Records every context the composer seam is opened with. */
function captureSupportContexts() {
  const seen: unknown[] = [];
  const handler = (event: Event) => seen.push((event as CustomEvent).detail);
  window.addEventListener(OPEN_SUPPORT_EVENT, handler);
  return { seen, dispose: () => window.removeEventListener(OPEN_SUPPORT_EVENT, handler) };
}

let capture: ReturnType<typeof captureSupportContexts>;

beforeEach(() => {
  authState.permissions = new Set(['lex:consultation:view', 'lex:support:create']);
  getConsultationMock.mockReset().mockResolvedValue(consultation);
  listAuditMock.mockReset().mockResolvedValue([]);
  capture = captureSupportContexts();
});

afterEach(() => capture.dispose());

describe('Lex consultation detail — ask for support', () => {
  it('binds the composer to this consultation when the action is used', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexConsultationDetailPage />);

    const button = await screen.findByRole('button', { name: supportLabels.en.ask });
    await user.click(button);

    expect(capture.seen).toEqual([
      { subjectType: 'consultation', subjectId: CONSULTATION_ID },
    ]);
  });

  it('renders the Arabic action label under the ar locale', async () => {
    renderWithQuery(<LexConsultationDetailPage />, { locale: 'ar' });

    expect(
      await screen.findByRole('button', { name: supportLabels.ar.ask }),
    ).toBeInTheDocument();
  });

  it('hides the action from a viewer without lex:support:create', async () => {
    authState.permissions = new Set(['lex:consultation:view']);
    renderWithQuery(<LexConsultationDetailPage />);

    // The record loaded, so absence is a gating decision and not a render gap.
    expect(
      (await screen.findAllByText('Supplier indemnity opinion')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: supportLabels.en.ask }),
    ).not.toBeInTheDocument();
  });
});
