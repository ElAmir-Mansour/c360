import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';
import {
  lexSupportApi,
  lexSupportSubjectApi,
  type LexSupportDirectory,
  type LexSupportRequest,
  type LexSupportSubjectRecord,
} from '@/lib/lex/support';
import {
  SupportComposerHost,
  openLexSupportComposer,
  supportContextFromPathname,
} from './support-composer';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderHost(locale: 'en' | 'ar' = 'en') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LocaleProvider
      locale={locale}
      direction={locale === 'ar' ? 'rtl' : 'ltr'}
      messages={getMessages(locale)}
    >
      <QueryClientProvider client={client}>
        <SupportComposerHost />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

function createdRequest(): LexSupportRequest {
  return {
    id: 'support-1',
    tenant_id: 'tenant-1',
    requester_id: 'requester-1',
    requester_entity_id: 'contracts',
    target_entity_id: 'cases',
    assignee_id: 'helper-1',
    subject: 'Review the litigation position',
    body: '',
    priority: 'normal',
    subject_type: 'case',
    subject_id: 'case-1',
    status: 'open',
    resolution_note: '',
    expires_at: '2026-08-05T08:00:00Z',
    accepted_at: null,
    closed_at: null,
    created_at: '2026-07-31T08:00:00Z',
    updated_at: '2026-07-31T08:00:00Z',
  };
}

const CASES_ENTITY = {
  id: 'cases',
  code: 'CASES',
  entity_type: 'section',
  name: { en: 'Cases', ar: 'القضايا' },
};

const HELPER = {
  user_id: 'helper-1',
  first_name: 'Aisha',
  last_name: 'Saleh',
  employee_code: 'E-10',
  title: { en: 'Legal Officer', ar: 'مسؤول قانوني' },
  manager_user_id: null,
};

/** Directory with one org unit that has one active member. */
function mockDirectory() {
  return vi
    .spyOn(lexSupportApi, 'directory')
    .mockImplementation(async (entityId): Promise<LexSupportDirectory> =>
      entityId
        ? { entities: [CASES_ENTITY], selected_entity_id: 'cases', members: [HELPER] }
        : { entities: [CASES_ENTITY], members: [] },
    );
}

function caseRecord(
  id = 'case-1',
  number = 'CASE-2026-014',
  title = 'Supplier dispute',
): LexSupportSubjectRecord {
  return {
    subject_type: 'case',
    subject_id: id,
    number,
    title: { en: title, ar: 'نزاع مع مورد' },
  };
}

/** Fill in the mandatory routing + subject fields so a submit can go through. */
async function completeRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: 'Team or department' }));
  await user.click(await screen.findByRole('option', { name: /Cases/ }));

  const memberSelect = screen.getByRole('combobox', { name: 'Colleague' });
  await waitFor(() => expect(memberSelect).toBeEnabled());
  await user.click(memberSelect);
  await user.click(await screen.findByRole('option', { name: /Aisha Saleh/ }));

  await user.type(screen.getByLabelText('Subject'), 'Review the litigation position');
}

afterEach(() => vi.restoreAllMocks());

describe('support composer', () => {
  it('recognizes supported detail routes but not list/new routes', () => {
    const caseId = '43cb6ac6-914d-4b24-a00b-86db08266897';
    const requestId = '5cd988f0-11f2-4c03-afb7-9106e128423f';
    expect(supportContextFromPathname(`/lex/cases/${caseId}/overview`)).toEqual({
      subjectType: 'case',
      subjectId: caseId,
    });
    expect(supportContextFromPathname('/lex/contracts/new')).toBeUndefined();
    expect(supportContextFromPathname('/lex/contracts/archived')).toBeUndefined();
    expect(supportContextFromPathname('/lex/contracts/compliance')).toBeUndefined();
    expect(supportContextFromPathname('/lex/consultations/archive')).toBeUndefined();
    expect(supportContextFromPathname('/lex/investigations/forensics')).toBeUndefined();
    expect(supportContextFromPathname('/lex/consultations')).toBeUndefined();
    expect(supportContextFromPathname(`/lex/service-desk/${requestId}`)).toEqual({
      subjectType: 'request',
      subjectId: requestId,
    });
  });

  it('names the bound record by its case number instead of only its type', async () => {
    mockDirectory();
    vi.spyOn(lexSupportSubjectApi, 'search').mockResolvedValue([]);
    const resolve = vi.spyOn(lexSupportSubjectApi, 'resolve').mockResolvedValue(caseRecord());
    renderHost();

    act(() => openLexSupportComposer({ subjectType: 'case', subjectId: 'case-1' }));

    const badge = await screen.findByText(/Linked record: Case/);
    expect(badge).toHaveTextContent('Linked record: Case CASE-2026-014');
    expect(resolve).toHaveBeenCalledWith('case', 'case-1');
  });

  it('falls back to the type-only label when the linked record cannot be read, and still submits the link', async () => {
    const directory = mockDirectory();
    vi.spyOn(lexSupportSubjectApi, 'search').mockResolvedValue([]);
    vi.spyOn(lexSupportSubjectApi, 'resolve').mockRejectedValue(new Error('forbidden'));
    const create = vi.spyOn(lexSupportApi, 'create').mockResolvedValue(createdRequest());
    vi.spyOn(lexSupportApi, 'previewExpiry').mockResolvedValue({
      business_days: 3,
      expires_at: '2026-08-05T08:00:00Z',
    });
    renderHost();

    act(() => openLexSupportComposer({ subjectType: 'case', subjectId: 'case-1' }));

    expect(await screen.findByText('Linked to this Case')).toBeInTheDocument();
    expect(screen.queryByText(/Linked record:/)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Colleague' })).toBeDisabled();

    const user = userEvent.setup();
    await completeRequiredFields(user);
    await waitFor(() => expect(directory).toHaveBeenCalledWith('cases'));

    await user.type(screen.getByLabelText('Validity window (business days)'), '3');
    expect(await screen.findByText(/Server-calculated expiry:/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        target_entity_id: 'cases',
        assignee_id: 'helper-1',
        subject: 'Review the litigation position',
        body: undefined,
        priority: 'normal',
        business_days: 3,
        subject_type: 'case',
        subject_id: 'case-1',
      });
    });
  });

  it('links a record chosen in the picker when no context was supplied', async () => {
    mockDirectory();
    const search = vi
      .spyOn(lexSupportSubjectApi, 'search')
      .mockResolvedValue([caseRecord('case-9', 'CASE-2026-099', 'Lease termination')]);
    vi.spyOn(lexSupportSubjectApi, 'resolve').mockResolvedValue(
      caseRecord('case-9', 'CASE-2026-099', 'Lease termination'),
    );
    const create = vi.spyOn(lexSupportApi, 'create').mockResolvedValue(createdRequest());
    renderHost();

    act(() => openLexSupportComposer());

    // Nothing is linked, so the record picker stays inert until a type is chosen.
    const recordPicker = await screen.findByRole('combobox', { name: 'Record' });
    expect(recordPicker).toBeDisabled();
    expect(screen.queryByText(/Linked record:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Linked to this/)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Record type' }));
    await user.click(await screen.findByRole('option', { name: 'Case' }));

    await waitFor(() => expect(search).toHaveBeenCalledWith('case', ''));
    await user.click(screen.getByRole('combobox', { name: 'Record' }));
    await user.click(await screen.findByRole('option', { name: /CASE-2026-099/ }));

    expect(await screen.findByText(/Linked record: Case/)).toHaveTextContent('CASE-2026-099');

    await completeRequiredFields(user);
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ subject_type: 'case', subject_id: 'case-9' }),
      );
    });
  });

  it('clears an auto-bound record so a request can be raised with no linked file', async () => {
    mockDirectory();
    vi.spyOn(lexSupportSubjectApi, 'search').mockResolvedValue([caseRecord()]);
    vi.spyOn(lexSupportSubjectApi, 'resolve').mockResolvedValue(caseRecord());
    const create = vi.spyOn(lexSupportApi, 'create').mockResolvedValue(createdRequest());
    renderHost();

    act(() => openLexSupportComposer({ subjectType: 'case', subjectId: 'case-1' }));

    expect(await screen.findByText(/Linked record: Case/)).toHaveTextContent('CASE-2026-014');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove the linked record' }));

    await waitFor(() => expect(screen.queryByText(/Linked record:/)).not.toBeInTheDocument());
    expect(screen.queryByText(/Linked to this Case/)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Record' })).toBeDisabled();

    await completeRequiredFields(user);
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ subject_type: undefined, subject_id: undefined }),
      );
    });
  });

  it('refuses a record type with no record rather than dropping half a link', async () => {
    mockDirectory();
    vi.spyOn(lexSupportSubjectApi, 'search').mockResolvedValue([]);
    const create = vi.spyOn(lexSupportApi, 'create');
    renderHost();

    act(() => openLexSupportComposer());

    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Record type' }));
    await user.click(await screen.findByRole('option', { name: 'Contract' }));

    await completeRequiredFields(user);
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(
      await screen.findByText('Choose a record, or set the record type back to “No linked record”.'),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('stamps the Arabic dialog with full RTL direction and Arabic linked-record copy', async () => {
    mockDirectory();
    vi.spyOn(lexSupportSubjectApi, 'search').mockResolvedValue([]);
    vi.spyOn(lexSupportSubjectApi, 'resolve').mockResolvedValue(caseRecord());
    renderHost('ar');

    act(() => openLexSupportComposer({ subjectType: 'case', subjectId: 'case-1' }));

    const dialog = await screen.findByRole('dialog', { name: 'طلب دعم' });
    expect(dialog).toHaveAttribute('dir', 'rtl');
    expect(screen.getByLabelText('الزميل')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'نوع السجل' })).toBeInTheDocument();
    expect(await screen.findByText(/السجل المرتبط: قضية/)).toHaveTextContent('CASE-2026-014');
  });

  it('rejects a non-policy business-day duration without truncating it', async () => {
    mockDirectory();
    vi.spyOn(lexSupportSubjectApi, 'search').mockResolvedValue([]);
    const create = vi.spyOn(lexSupportApi, 'create');
    renderHost();
    act(() => openLexSupportComposer());

    const user = userEvent.setup();
    const duration = await screen.findByLabelText('Validity window (business days)');
    await user.type(duration, '367');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(screen.getByText('Enter a whole number from 1 to 366.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});
