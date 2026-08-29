import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import EscalationsPage from './page';
import type { OrgEntity, SLATarget } from '@/lib/lex/admin';

const {
  listSLATargetsMock,
  listOrgEntitiesMock,
  hasPermissionMock,
} = vi.hoisted(() => ({
  listSLATargetsMock: vi.fn(),
  listOrgEntitiesMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lex/admin/escalations',
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: hasPermissionMock,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'admin-1', email: 'admin@example.com', roles: [] },
  }),
}));

vi.mock('@/components/lex/access/lex-access-guard', () => ({
  LexAccessGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/lex/admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/admin')>('@/lib/lex/admin');
  return {
    ...actual,
    lexAdminApi: {
      ...actual.lexAdminApi,
      listSLATargets: listSLATargetsMock,
      listOrgEntities: listOrgEntitiesMock,
    },
  };
});

const targets: SLATarget[] = [
  {
    id: 'sla-1',
    tenant_id: 'tenant-1',
    service_code: 'CONSULTATION',
    priority: 'normal',
    turnaround_working_days: 5,
    ack_window_value: 1,
    ack_window_unit: 'working_days',
    escalation_l1_days: 2,
    escalation_l2_days: 4,
    escalation_l3_days: 6,
    active: true,
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'sla-2',
    tenant_id: 'tenant-1',
    service_code: 'LITIGATION_STUDY',
    priority: 'urgent',
    turnaround_working_days: 2,
    ack_window_value: 4,
    ack_window_unit: 'working_hours',
    escalation_l1_days: 1,
    escalation_l2_days: 3,
    escalation_l3_days: 5,
    active: true,
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const orgs: OrgEntity[] = [
  {
    id: 'company-1',
    tenant_id: 'tenant-1',
    parent_id: null,
    entity_type: 'company',
    code: 'HQ',
    name: { en: 'Head Office', ar: 'المركز الرئيسي' },
    path: ['company-1'],
    active: true,
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    roles: [
      {
        id: 'role-l2',
        entity_id: 'company-1',
        role_key: 'department_manager',
        user_id: 'user-l2',
        label: { en: 'Department Manager', ar: 'مدير الإدارة' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'role-l3',
        entity_id: 'company-1',
        role_key: 'shared_services_manager',
        user_id: 'user-l3',
        label: { en: 'Shared Services Manager', ar: 'مدير الخدمات المشتركة' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
  },
  {
    id: 'section-1',
    tenant_id: 'tenant-1',
    parent_id: 'company-1',
    entity_type: 'section',
    code: 'LEG-LIT',
    name: { en: 'Litigation Section', ar: 'قسم التقاضي' },
    path: ['company-1', 'section-1'],
    active: true,
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    roles: [
      {
        id: 'role-l1',
        entity_id: 'section-1',
        role_key: 'section_supervisor',
        user_id: 'user-l1',
        label: { en: 'Section Supervisor', ar: 'مشرف القسم' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
  },
];

beforeEach(() => {
  listSLATargetsMock.mockReset();
  listOrgEntitiesMock.mockReset();
  hasPermissionMock.mockReset();
  hasPermissionMock.mockReturnValue(true);
  listSLATargetsMock.mockResolvedValue({ data: targets, meta: { total: targets.length } });
  listOrgEntitiesMock.mockResolvedValue({ data: orgs, meta: { total: orgs.length } });
});

describe('Lex escalations admin page', () => {
  it('renders SLA timing and L1-L3 recipient coverage', async () => {
    renderWithQuery(<EscalationsPage />);

    expect(await screen.findByText('Escalation Policies')).toBeInTheDocument();
    expect(screen.getByText('SLA Timing Matrix')).toBeInTheDocument();
    expect(screen.getByText('Recipient Coverage')).toBeInTheDocument();

    expect(await screen.findByText('CONSULTATION')).toBeInTheDocument();
    expect(screen.getByText('LITIGATION_STUDY')).toBeInTheDocument();
    expect(screen.getByText('Section Supervisor')).toBeInTheDocument();
    expect(screen.getByText('Department Manager')).toBeInTheDocument();

    const preview = screen.getByText('LEG-LIT · Litigation Section').closest('.rounded-lg');
    expect(preview).not.toBeNull();
    expect(within(preview as HTMLElement).getAllByText('Source: HQ').length).toBeGreaterThan(0);
  });

  it('renders the Arabic RTL surface', async () => {
    const { container } = renderWithQuery(<EscalationsPage />, { locale: 'ar' });

    expect(await screen.findByText('سياسات التصعيد')).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
