import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { SaveDraftTargetActions } from './drafting-workspace-panels';

const mocks = vi.hoisted(() => ({
  createContract: vi.fn(),
  createDocument: vi.fn(),
  createMatter: vi.fn(),
  showBackendError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: {
      id: 'aa98e049-fd48-4f3b-bd18-5aaf2431f85c',
      first_name: 'Super',
      last_name: 'User',
      full_name: 'Super User',
      email: 'super.user@example.com',
    },
  }),
}));

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: {
    lex: {
      createContract: mocks.createContract,
      createDocument: mocks.createDocument,
      createMatter: mocks.createMatter,
    },
  },
}));

vi.mock('@/lib/toast', () => ({
  showApiError: vi.fn(),
  showBackendError: mocks.showBackendError,
  showSuccess: mocks.showSuccess,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createContract.mockResolvedValue({ id: 'contract-1' });
  mocks.createDocument.mockResolvedValue({ id: 'document-1' });
  mocks.createMatter.mockResolvedValue({ id: 'matter-1' });
});

describe('SaveDraftTargetActions', () => {
  it('maps a draft to the strict contract, document, and matter create payloads', async () => {
    const user = userEvent.setup();
    const text = 'This is the approved contract draft.';
    renderWithQuery(
      <SaveDraftTargetActions
        title="Approved contract"
        text={text}
        payload={{ source_task: 'contract' }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /save contract/i }));
    await waitFor(() => expect(mocks.createContract).toHaveBeenCalledTimes(1));
    const contractPayload = mocks.createContract.mock.calls[0][0];
    expect(contractPayload).toEqual({
      title: 'Approved contract',
      description: text,
      type: 'service_agreement',
      party_a_name: 'Internal legal team',
      party_b_name: 'Counterparty',
      currency: 'SAR',
      owner_user_id: 'aa98e049-fd48-4f3b-bd18-5aaf2431f85c',
      owner_name: 'Super User',
      metadata: {
        source_task: 'contract',
        draft_text: text,
        source_surface: 'lex_drafting',
      },
    });
    expect(contractPayload).not.toHaveProperty('status');
    expect(contractPayload).not.toHaveProperty('document_text');

    await user.click(screen.getByRole('button', { name: /save document/i }));
    await waitFor(() => expect(mocks.createDocument).toHaveBeenCalledTimes(1));
    const documentPayload = mocks.createDocument.mock.calls[0][0];
    expect(documentPayload).toEqual({
      title: 'Approved contract',
      description: text,
      type: 'other',
      confidentiality: 'internal',
      metadata: {
        source_task: 'contract',
        text,
        document_kind: 'contract_draft',
        source_surface: 'lex_drafting',
      },
    });
    expect(documentPayload).not.toHaveProperty('status');

    await user.click(screen.getByRole('button', { name: /save matter/i }));
    await waitFor(() => expect(mocks.createMatter).toHaveBeenCalledTimes(1));
    expect(mocks.createMatter).toHaveBeenCalledWith({
      title: 'Approved contract',
      description: text,
      type: 'contract',
      status: 'open',
      priority: 'medium',
      owner_user_id: 'aa98e049-fd48-4f3b-bd18-5aaf2431f85c',
      owner_name: 'Super User',
      metadata: {
        source_task: 'contract',
        draft_text: text,
        source_surface: 'lex_drafting',
      },
    });
  });
});
