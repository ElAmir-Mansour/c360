import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { Button } from '@/components/ui/button';
import type { CaseClassification, LegalCase, LegalCourt } from '@/lib/lex/cases';
import { CaseFormDialog } from './case-form-dialog';
import { indexSelectableClassifications } from './classification-picker';

const {
  createCaseMock,
  getCascadeMock,
  listCourtsMock,
  listSelectableMock,
  updateCaseMock,
} = vi.hoisted(() => ({
  createCaseMock: vi.fn(),
  getCascadeMock: vi.fn(),
  listCourtsMock: vi.fn(),
  listSelectableMock: vi.fn(),
  updateCaseMock: vi.fn(),
}));

vi.mock('@/lib/lex/cases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/lex/cases')>();
  return {
    ...actual,
    casesApi: {
      ...actual.casesApi,
      createCase: createCaseMock,
      getClassificationCascade: getCascadeMock,
      listCourts: listCourtsMock,
      listSelectableClassifications: listSelectableMock,
      updateCase: updateCaseMock,
    },
  };
});

vi.mock('@/components/lex/creation-guidance', () => ({
  LexCreationGuidance: () => null,
}));

// Per-test permission set. The empty-court notice offers the admin link only to
// holders of lex:catalog:manage — the same gate the courts admin screen uses.
let currentPerms: string[] = [];
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) => currentPerms.includes(perm),
    user: { id: 'user-1' },
    isAuthenticated: true,
    isHydrated: true,
  }),
}));

vi.mock('@/components/shared/forms/org-entity-picker', () => ({
  OrgEntityPicker: (props: { ariaLabel: string; value: string; onChange: (value: string) => void }) => (
    <Button
      type="button"
      variant="outline"
      aria-label={props.ariaLabel}
      data-value={props.value}
      onClick={() => props.onChange('entity-1')}
    >
      Choose organisation
    </Button>
  ),
}));

vi.mock('@/components/lex/lex-record-picker', () => ({
  LexRecordPicker: (props: {
    ariaLabel: string;
    kind: 'contract' | 'legal_request';
    value: string;
    onChange: (value: string) => void;
  }) => (
    <Button
      type="button"
      variant="outline"
      aria-label={props.ariaLabel}
      data-value={props.value}
      onClick={() =>
        props.onChange(props.value ? '' : props.kind === 'contract' ? 'contract-1' : 'request-1')
      }
    >
      {props.kind}
    </Button>
  ),
}));

function classification(
  id: string,
  code: string,
  en: string,
  ar: string,
  overrides: Partial<CaseClassification> = {},
): CaseClassification {
  return {
    id,
    code,
    name: { en, ar },
    path: [],
    is_system: true,
    active: true,
    sort: 10,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

const commercial = classification('classification-commercial', 'COMMERCIAL', 'Commercial', 'تجارية');
const eviction = classification('classification-eviction', 'EVICTION', 'Eviction', 'إخلاء', { sort: 20 });

const court: LegalCourt = {
  id: 'court-1',
  tenant_id: 'tenant-1',
  code: 'CRT-1',
  name: { en: 'Configured court', ar: 'محكمة مهيأة' },
  active: true,
  is_system: false,
  sort: 1,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const savedCase: LegalCase = {
  id: 'case-1',
  tenant_id: 'tenant-1',
  case_number: 'CASE-1',
  case_type: 'COMMERCIAL',
  classification_id: commercial.id,
  company_status: 'plaintiff',
  title: { en: 'Claim', ar: 'مطالبة' },
  description: '',
  status: 'intake',
  priority: 'medium',
  metadata: { beneficiary_entity_id: 'entity-1' },
  created_by: 'user-1',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

beforeEach(() => {
  currentPerms = [];
  createCaseMock.mockReset();
  createCaseMock.mockResolvedValue(savedCase);
  updateCaseMock.mockReset();
  updateCaseMock.mockResolvedValue(savedCase);
  listSelectableMock.mockReset();
  listSelectableMock.mockResolvedValue({
    data: [commercial, eviction],
    meta: { page: 1, per_page: 100, total: 2, total_pages: 1 },
  });
  getCascadeMock.mockReset();
  getCascadeMock.mockResolvedValue({
    classification_id: commercial.id,
    code: commercial.code,
    name: commercial.name,
    resolved_at: '2026-08-01T00:00:00Z',
    chain: [commercial],
  });
  listCourtsMock.mockReset();
  listCourtsMock.mockResolvedValue({
    data: [court],
    meta: { page: 1, per_page: 100, total: 1, total_pages: 1 },
  });
});

async function completeRequiredIntake(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: /Title \(Arabic\)/ }), 'مطالبة');
  await user.click(screen.getByRole('button', { name: 'Owning organisational unit' }));
  await user.click(screen.getByRole('combobox', { name: 'Classification' }));
  await user.click(await screen.findByText('Commercial'));
}

describe('CaseFormDialog creation intake', () => {
  it('uses the canonical taxonomy code and keeps contract/request linkage mutually exclusive', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <CaseFormDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );

    await completeRequiredIntake(user);
    const contractPicker = screen.getByRole('button', { name: 'Related contract' });
    const requestPicker = screen.getByRole('button', { name: 'Related legal request' });
    await user.click(contractPicker);
    expect(contractPicker).toHaveAttribute('data-value', 'contract-1');
    await user.click(requestPicker);
    expect(requestPicker).toHaveAttribute('data-value', 'request-1');
    expect(contractPicker).toHaveAttribute('data-value', '');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(createCaseMock).not.toHaveBeenCalled();
    const courtPicker = await screen.findByRole('combobox', { name: 'Competent court' });
    await user.click(courtPicker);
    await user.click(await screen.findByText('Configured court'));
    await user.click(screen.getByRole('button', { name: 'Create case' }));

    await waitFor(() => expect(createCaseMock).toHaveBeenCalledTimes(1));
    expect(createCaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        case_type: 'COMMERCIAL',
        classification_id: commercial.id,
        other_case_type: null,
        contract_id: null,
        request_id: 'request-1',
        court_id: 'court-1',
      }),
    );
  });

  it('requires a persisted description when Other is selected', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CaseFormDialog open onOpenChange={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: /Title \(Arabic\)/ }), 'مطالبة');
    await user.click(screen.getByRole('button', { name: 'Owning organisational unit' }));
    await user.click(screen.getByRole('combobox', { name: 'Classification' }));
    await user.click(await screen.findByText('Other'));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Describe the other case type.');
    expect(screen.getByText('Intake & classification')).toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: /Describe the other case type/ }),
      'Property boundary dispute',
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: 'Create case' }));

    await waitFor(() => expect(createCaseMock).toHaveBeenCalledTimes(1));
    expect(createCaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        case_type: 'OTHER',
        classification_id: null,
        other_case_type: 'Property boundary dispute',
      }),
    );
  });

  it('shows an explicit empty court catalogue without inventing court names', async () => {
    listCourtsMock.mockResolvedValue({
      data: [],
      meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
    });
    const user = userEvent.setup();
    renderWithQuery(<CaseFormDialog open onOpenChange={vi.fn()} />);

    await completeRequiredIntake(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('combobox', { name: 'Competent court' }));

    expect(
      await screen.findByText('No courts are configured yet. Ask an administrator to add the court catalogue.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Riyadh Commercial Court')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Court number')).not.toBeInTheDocument();
  });

  it('offers the catalogue admin a link to populate the empty court list', async () => {
    currentPerms = ['lex:catalog:manage'];
    listCourtsMock.mockResolvedValue({
      data: [],
      meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
    });
    const user = userEvent.setup();
    renderWithQuery(<CaseFormDialog open onOpenChange={vi.fn()} />);

    await completeRequiredIntake(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const notice = await screen.findByTestId('court-catalogue-empty');
    expect(notice).toHaveTextContent('No courts configured');
    const link = screen.getByRole('link', { name: /Manage courts/ });
    expect(link).toHaveAttribute('href', '/lex/admin/courts');
    // The notice explains the emptiness; it never suggests a court to pick.
    expect(screen.queryByText('Configured court')).not.toBeInTheDocument();
  });

  it('tells a non-admin why the court list is empty without offering a link', async () => {
    currentPerms = ['lex:catalog:view'];
    listCourtsMock.mockResolvedValue({
      data: [],
      meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
    });
    const user = userEvent.setup();
    renderWithQuery(<CaseFormDialog open onOpenChange={vi.fn()} />);

    await completeRequiredIntake(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const notice = await screen.findByTestId('court-catalogue-empty');
    expect(notice).toHaveTextContent('Ask an administrator with catalogue permissions');
    expect(screen.queryByRole('link', { name: /Manage courts/ })).not.toBeInTheDocument();
  });

  it('hides the empty notice once the catalogue has courts', async () => {
    currentPerms = ['lex:catalog:manage'];
    const user = userEvent.setup();
    renderWithQuery(<CaseFormDialog open onOpenChange={vi.fn()} />);

    await completeRequiredIntake(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('combobox', { name: 'Competent court' })).toBeInTheDocument();
    await waitFor(() => expect(listCourtsMock).toHaveBeenCalled());
    expect(screen.queryByTestId('court-catalogue-empty')).not.toBeInTheDocument();
  });

  it('renders Arabic labels and an RTL Arabic title input', async () => {
    renderWithQuery(<CaseFormDialog open onOpenChange={vi.fn()} />, { locale: 'ar' });

    expect(await screen.findByText('الاستقبال والتصنيف')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'التصنيف' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /العنوان \(عربي\)/ })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'العقد المرتبط' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'الطلب القانوني المرتبط' })).toBeInTheDocument();
  });

  it('preserves a legacy court notice and uses cleared_fields when an edit removes a link', async () => {
    listCourtsMock.mockResolvedValue({
      data: [],
      meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
    });
    const user = userEvent.setup();
    const legacyCase: LegalCase = {
      ...savedCase,
      contract_id: 'contract-1',
      court_id: null,
      competent_court: 'Legacy court spelling',
    };
    renderWithQuery(
      <CaseFormDialog legalCase={legacyCase} open onOpenChange={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Related contract' }));
    expect(screen.getByRole('button', { name: 'Related contract' })).toHaveAttribute(
      'data-value',
      '',
    );
    await user.click(screen.getByRole('button', { name: /Court & owners/ }));
    expect(await screen.findByText('Historical court value')).toBeInTheDocument();
    expect(screen.getByText(/Legacy court spelling is retained on this case/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateCaseMock).toHaveBeenCalledTimes(1));
    expect(updateCaseMock).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        contract_id: null,
        cleared_fields: expect.arrayContaining(['contract_id']),
      }),
    );
  });
});

describe('indexSelectableClassifications', () => {
  it('returns only active top-level options while retaining child lookup for existing values', () => {
    const child = classification('child', 'RD_EVICTION', 'Eviction cascade', 'تدرج الإخلاء', {
      parent_id: eviction.id,
    });
    const inactive = classification('inactive', 'INACTIVE', 'Inactive', 'غير نشط', { active: false });
    const result = indexSelectableClassifications([
      { ...eviction, children: [child] },
      inactive,
      commercial,
    ]);

    expect(result.roots.map((item) => item.code)).toEqual(['COMMERCIAL', 'EVICTION']);
    expect(result.byId.get(child.id)?.code).toBe('RD_EVICTION');
  });
});
