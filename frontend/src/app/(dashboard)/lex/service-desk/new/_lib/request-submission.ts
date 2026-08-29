import type {
  CreateLegalRequestPayload,
  LegalRequest,
  SubmitLegalRequestPayload,
} from '@/lib/lex/requests';

interface RequestSubmissionApi {
  createRequest: (payload: CreateLegalRequestPayload) => Promise<LegalRequest>;
  submitRequest: (
    id: string,
    payload: SubmitLegalRequestPayload,
  ) => Promise<LegalRequest>;
}

/**
 * Carries the successfully-created draft when the second lifecycle transition
 * fails. The caller can retry submission against that exact draft instead of
 * creating a duplicate request.
 */
export class RequestSubmissionError extends Error {
  readonly draft: LegalRequest;
  readonly originalError: unknown;

  constructor(draft: LegalRequest, originalError: unknown) {
    super('The legal request was saved as a draft but could not be submitted.');
    this.name = 'RequestSubmissionError';
    this.draft = draft;
    this.originalError = originalError;
  }
}

function submissionPayload(notes: string): SubmitLegalRequestPayload {
  const normalized = notes.trim();
  return normalized ? { notes: normalized } : {};
}

/**
 * Executes the real two-command request lifecycle:
 *
 * 1. create the governed draft with its attachments;
 * 2. submit it so approvals/routing can start.
 *
 * When `existingDraft` is supplied after a partial failure, only step 2 is
 * retried. This prevents duplicate draft rows and duplicate attachment links.
 */
export async function createAndSubmitLegalRequest(
  api: RequestSubmissionApi,
  payload: CreateLegalRequestPayload,
  notes: string,
  existingDraft?: LegalRequest | null,
): Promise<LegalRequest> {
  const draft = existingDraft ?? (await api.createRequest(payload));

  try {
    return await api.submitRequest(draft.id, submissionPayload(notes));
  } catch (error) {
    throw new RequestSubmissionError(draft, error);
  }
}
