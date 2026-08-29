import { describe, expect, it, vi } from 'vitest';
import type {
  CreateLegalRequestPayload,
  LegalRequest,
} from '@/lib/lex/requests';
import {
  createAndSubmitLegalRequest,
  RequestSubmissionError,
} from './request-submission';

const payload: CreateLegalRequestPayload = {
  request_type: 'contract_review',
  service_id: 'service-1',
  title: { en: 'Review supply agreement', ar: '' },
  description: 'Review the attached agreement.',
  requester_name: 'Mohammed Al-Amri',
  beneficiary_entity_id: 'entity-1',
  department: 'Procurement',
  priority: 'normal',
  requester_approval_required: false,
  provider_approval_required: true,
  metadata: { requested_due_date: '2026-08-10' },
};

const draft: LegalRequest = {
  id: 'request-1',
  cycle: 1,
  tenant_id: 'tenant-1',
  request_number: 'REQ-20260726-0001',
  request_type: payload.request_type,
  service_id: payload.service_id,
  title: payload.title,
  description: payload.description,
  requester_user_id: 'user-1',
  requester_name: payload.requester_name,
  beneficiary_entity_id: payload.beneficiary_entity_id,
  department: payload.department,
  priority: payload.priority,
  status: 'draft',
  requester_approval_required: false,
  provider_approval_required: true,
  metadata: payload.metadata ?? {},
  created_by: 'user-1',
  created_at: '2026-07-26T08:00:00Z',
  updated_at: '2026-07-26T08:00:00Z',
};

describe('createAndSubmitLegalRequest', () => {
  it('creates the governed draft and then submits it', async () => {
    const submitted = { ...draft, status: 'pending_provider_approval' as const };
    const api = {
      createRequest: vi.fn().mockResolvedValue(draft),
      submitRequest: vi.fn().mockResolvedValue(submitted),
    };

    await expect(
      createAndSubmitLegalRequest(api, payload, '  Final intake note  '),
    ).resolves.toEqual(submitted);

    expect(api.createRequest).toHaveBeenCalledWith(payload);
    expect(api.submitRequest).toHaveBeenCalledWith(draft.id, {
      notes: 'Final intake note',
    });
  });

  it('retries submission against an existing server draft without duplicating it', async () => {
    const submitted = { ...draft, status: 'submitted' as const };
    const api = {
      createRequest: vi.fn(),
      submitRequest: vi.fn().mockResolvedValue(submitted),
    };

    await createAndSubmitLegalRequest(api, payload, '', draft);

    expect(api.createRequest).not.toHaveBeenCalled();
    expect(api.submitRequest).toHaveBeenCalledWith(draft.id, {});
  });

  it('preserves the created draft when submission fails so the caller can retry', async () => {
    const failure = new Error('approval service unavailable');
    const api = {
      createRequest: vi.fn().mockResolvedValue(draft),
      submitRequest: vi.fn().mockRejectedValue(failure),
    };

    const result = createAndSubmitLegalRequest(api, payload, '');

    await expect(result).rejects.toBeInstanceOf(RequestSubmissionError);
    await expect(result).rejects.toMatchObject({
      draft,
      originalError: failure,
    });
  });
});
