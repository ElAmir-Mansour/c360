import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LexSignatureEnvelope } from '@/types/suites';
import {
  LEX_SIGNATURE_SUMMARY_ENDPOINT,
  SIGNATURE_SUMMARY_MAX_IDS,
  countSignatureRollup,
  dedupeContractIds,
  getSignatureSummaries,
  isAwaitingSignature,
  isReminderEligible,
  pickReminderEnvelope,
  resendReminder,
  signatureStatusTone,
  signatureSummariesQueryKey,
  type LexContractSignatureSummary,
} from './use-signature-summaries';

const { fetchSuiteDataMock, listSignaturesMock, sendSignatureMock } = vi.hoisted(() => ({
  fetchSuiteDataMock: vi.fn(),
  listSignaturesMock: vi.fn(),
  sendSignatureMock: vi.fn(),
}));

vi.mock('@/lib/suite-api', () => ({
  fetchSuiteData: fetchSuiteDataMock,
}));

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: {
    lex: {
      listSignatures: listSignaturesMock,
      sendSignature: sendSignatureMock,
    },
  },
}));

function summary(
  overrides: Partial<LexContractSignatureSummary> = {},
): LexContractSignatureSummary {
  return {
    contract_id: 'c-1',
    envelope_status: 'sent',
    provider: 'native',
    pending_count: 2,
    stuck: false,
    ...overrides,
  };
}

function envelope(overrides: Partial<LexSignatureEnvelope> = {}): LexSignatureEnvelope {
  return {
    id: 'env-1',
    tenant_id: 't-1',
    target_type: 'contract',
    contract_id: 'c-1',
    title: 'MSA signature',
    subject: 'Please sign',
    message: '',
    provider: 'native',
    method: 'otp',
    status: 'sent',
    evidence_metadata: {},
    created_by: 'u-1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  } as LexSignatureEnvelope;
}

beforeEach(() => {
  fetchSuiteDataMock.mockReset();
  listSignaturesMock.mockReset();
  sendSignatureMock.mockReset();
});

describe('dedupeContractIds', () => {
  it('drops blanks and duplicates while preserving first-occurrence order', () => {
    expect(dedupeContractIds(['b', '', 'a', 'b', '  ', 'a'])).toEqual(['b', 'a']);
  });
});

describe('getSignatureSummaries', () => {
  it('returns [] without a network call when no ids are passed', async () => {
    await expect(getSignatureSummaries([])).resolves.toEqual([]);
    expect(fetchSuiteDataMock).not.toHaveBeenCalled();
  });

  it('batches the page ids into one comma-separated request', async () => {
    fetchSuiteDataMock.mockResolvedValue([summary()]);

    await getSignatureSummaries(['c-1', 'c-2', 'c-1']);

    expect(fetchSuiteDataMock).toHaveBeenCalledTimes(1);
    expect(fetchSuiteDataMock).toHaveBeenCalledWith(LEX_SIGNATURE_SUMMARY_ENDPOINT, {
      contract_ids: 'c-1,c-2',
    });
  });

  it('chunks oversized batches under the server id cap', async () => {
    fetchSuiteDataMock.mockResolvedValue([]);
    const ids = Array.from({ length: SIGNATURE_SUMMARY_MAX_IDS + 3 }, (_, i) => `c-${i}`);

    await getSignatureSummaries(ids);

    expect(fetchSuiteDataMock).toHaveBeenCalledTimes(2);
    const firstBatch = fetchSuiteDataMock.mock.calls[0][1].contract_ids.split(',');
    const secondBatch = fetchSuiteDataMock.mock.calls[1][1].contract_ids.split(',');
    expect(firstBatch).toHaveLength(SIGNATURE_SUMMARY_MAX_IDS);
    expect(secondBatch).toHaveLength(3);
  });
});

describe('signatureSummariesQueryKey', () => {
  it('is stable across reorderings of the same id set', () => {
    expect(signatureSummariesQueryKey(['b', 'a'])).toEqual(
      signatureSummariesQueryKey(['a', 'b']),
    );
  });
});

describe('status logic', () => {
  it('maps each rollup status onto its chip tone', () => {
    expect(signatureStatusTone('none')).toBe('neutral');
    expect(signatureStatusTone('draft')).toBe('neutral');
    expect(signatureStatusTone('sent')).toBe('info');
    expect(signatureStatusTone('partially_signed')).toBe('info');
    expect(signatureStatusTone('completed')).toBe('ok');
    expect(signatureStatusTone('expired')).toBe('warn');
    expect(signatureStatusTone('declined')).toBe('danger');
    expect(signatureStatusTone(undefined)).toBe('neutral');
    expect(signatureStatusTone('future_state')).toBe('neutral');
  });

  it('flags awaiting + reminder-eligible statuses', () => {
    expect(isAwaitingSignature('sent')).toBe(true);
    expect(isAwaitingSignature('partially_signed')).toBe(true);
    expect(isAwaitingSignature('draft')).toBe(false);
    expect(isReminderEligible('draft')).toBe(true);
    expect(isReminderEligible('sent')).toBe(true);
    expect(isReminderEligible('completed')).toBe(false);
    expect(isReminderEligible('none')).toBe(false);
    expect(isReminderEligible(undefined)).toBe(false);
  });

  it('counts pending and stuck rows over a loaded batch', () => {
    const counts = countSignatureRollup([
      summary({ envelope_status: 'sent', stuck: true }),
      summary({ envelope_status: 'partially_signed', stuck: false }),
      summary({ envelope_status: 'completed', stuck: false }),
      summary({ envelope_status: 'none' }),
    ]);
    expect(counts).toEqual({ pending: 2, stuck: 1 });
  });
});

describe('pickReminderEnvelope', () => {
  it('prefers the newest in-flight envelope over drafts', () => {
    const picked = pickReminderEnvelope([
      envelope({ id: 'old-sent', status: 'sent', created_at: '2026-06-01T00:00:00Z' }),
      envelope({ id: 'new-draft', status: 'draft', created_at: '2026-07-05T00:00:00Z' }),
      envelope({ id: 'new-viewed', status: 'viewed', created_at: '2026-07-02T00:00:00Z' }),
    ]);
    expect(picked?.id).toBe('new-viewed');
  });

  it('falls back to the newest draft when nothing is in flight', () => {
    const picked = pickReminderEnvelope([
      envelope({ id: 'signed', status: 'signed', created_at: '2026-07-03T00:00:00Z' }),
      envelope({ id: 'draft', status: 'draft', created_at: '2026-07-01T00:00:00Z' }),
    ]);
    expect(picked?.id).toBe('draft');
  });

  it('yields null for empty or terminal-only lists', () => {
    expect(pickReminderEnvelope([])).toBeNull();
    expect(
      pickReminderEnvelope([
        envelope({ status: 'signed' }),
        envelope({ status: 'cancelled' }),
      ]),
    ).toBeNull();
  });
});

describe('resendReminder', () => {
  it('reports no_envelope when the contract has no envelopes', async () => {
    listSignaturesMock.mockResolvedValue({ data: [], meta: { total: 0 } });

    await expect(resendReminder('c-1')).resolves.toEqual({ kind: 'no_envelope' });
    expect(listSignaturesMock).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { contract_id: 'c-1' } }),
    );
    expect(sendSignatureMock).not.toHaveBeenCalled();
  });

  it('reports not_actionable when every envelope is terminal', async () => {
    listSignaturesMock.mockResolvedValue({
      data: [envelope({ status: 'signed' })],
      meta: { total: 1 },
    });

    await expect(resendReminder('c-1')).resolves.toEqual({
      kind: 'not_actionable',
      envelopeStatus: 'signed',
    });
    expect(sendSignatureMock).not.toHaveBeenCalled();
  });

  it('dispatches a draft envelope through the send API', async () => {
    listSignaturesMock.mockResolvedValue({
      data: [envelope({ id: 'env-draft', status: 'draft' })],
      meta: { total: 1 },
    });
    sendSignatureMock.mockResolvedValue(envelope({ id: 'env-draft', status: 'sent' }));

    await expect(resendReminder('c-1')).resolves.toEqual({
      kind: 'sent',
      envelopeId: 'env-draft',
    });
    expect(sendSignatureMock).toHaveBeenCalledWith('env-draft');
  });

  it('reports resent when the server accepts a re-send of an in-flight envelope', async () => {
    listSignaturesMock.mockResolvedValue({
      data: [envelope({ id: 'env-sent', status: 'sent' })],
      meta: { total: 1 },
    });
    sendSignatureMock.mockResolvedValue(envelope({ id: 'env-sent', status: 'sent' }));

    await expect(resendReminder('c-1')).resolves.toEqual({
      kind: 'resent',
      envelopeId: 'env-sent',
    });
  });

  it('degrades a 409 on an in-flight envelope to already_in_flight', async () => {
    listSignaturesMock.mockResolvedValue({
      data: [envelope({ id: 'env-sent', status: 'sent' })],
      meta: { total: 1 },
    });
    sendSignatureMock.mockRejectedValue({
      status: 409,
      code: 'CONFLICT',
      message: 'only draft signature envelopes can be sent',
    });

    await expect(resendReminder('c-1')).resolves.toEqual({
      kind: 'already_in_flight',
      envelopeId: 'env-sent',
    });
  });

  it('re-throws a 409 on a draft (a real FSM problem, not a reminder no-op)', async () => {
    listSignaturesMock.mockResolvedValue({
      data: [envelope({ id: 'env-draft', status: 'draft' })],
      meta: { total: 1 },
    });
    const conflict = { status: 409, code: 'CONFLICT', message: 'blocked' };
    sendSignatureMock.mockRejectedValue(conflict);

    await expect(resendReminder('c-1')).rejects.toBe(conflict);
  });

  it('re-throws unexpected errors for the caller error toast', async () => {
    listSignaturesMock.mockResolvedValue({
      data: [envelope({ id: 'env-sent', status: 'sent' })],
      meta: { total: 1 },
    });
    const forbidden = { status: 403, code: 'FORBIDDEN', message: 'nope' };
    sendSignatureMock.mockRejectedValue(forbidden);

    await expect(resendReminder('c-1')).rejects.toBe(forbidden);
  });
});
