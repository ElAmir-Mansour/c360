import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  LegalPleading,
  PleadingGenerationStreamHandlers,
} from '@/lib/lex/cases';
import { PleadingsTab } from './pleadings-tab';

const {
  cancelPleadingGenerationMock,
  createPleadingMock,
  getPleadingGenerationMock,
  listPleadingsMock,
  resumePleadingGenerationMock,
  retryPleadingGenerationMock,
  streamPleadingGenerationMock,
} = vi.hoisted(() => ({
  cancelPleadingGenerationMock: vi.fn(),
  createPleadingMock: vi.fn(),
  getPleadingGenerationMock: vi.fn(),
  listPleadingsMock: vi.fn(),
  resumePleadingGenerationMock: vi.fn(),
  retryPleadingGenerationMock: vi.fn(),
  streamPleadingGenerationMock: vi.fn(),
}));

vi.mock('@/lib/lex/cases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/lex/cases')>();
  return {
    ...actual,
    casesApi: {
      ...actual.casesApi,
      cancelPleadingGeneration: cancelPleadingGenerationMock,
      createPleading: createPleadingMock,
      getPleadingGeneration: getPleadingGenerationMock,
      listPleadings: listPleadingsMock,
      resumePleadingGeneration: resumePleadingGenerationMock,
      retryPleadingGeneration: retryPleadingGenerationMock,
      streamPleadingGeneration: streamPleadingGenerationMock,
    },
  };
});

const DRAFT: LegalPleading = {
  id: 'pleading-1',
  case_id: 'case-1',
  pleading_number: 'PLD-20260727-0001',
  type: 'statement_of_claim',
  title: 'Statement of claim',
  body: '',
  direction: 'outgoing',
  status: 'draft',
  ai_generated: false,
  current_version: 1,
  created_at: '2026-07-27T08:00:00.000Z',
  updated_at: '2026-07-27T08:00:00.000Z',
};

describe('PleadingsTab background AI generation', () => {
  beforeEach(() => {
    cancelPleadingGenerationMock.mockReset();
    cancelPleadingGenerationMock.mockResolvedValue(undefined);
    createPleadingMock.mockReset();
    getPleadingGenerationMock.mockReset();
    listPleadingsMock.mockReset();
    resumePleadingGenerationMock.mockReset();
    resumePleadingGenerationMock.mockImplementation(
      async (
        _caseId: string,
        pleadingId: string,
        handlers: PleadingGenerationStreamHandlers,
      ) => {
        handlers.onSnapshot?.({
          pleading_id: pleadingId,
          status: 'running',
          progress: 58,
          current_section: 'Legal grounds',
        });
      },
    );
    retryPleadingGenerationMock.mockReset();
    streamPleadingGenerationMock.mockReset();
  });

  it('persists an empty draft first, closes intake, then streams visible progress', async () => {
    const user = userEvent.setup();
    listPleadingsMock
      .mockResolvedValueOnce([])
      .mockResolvedValue([DRAFT]);
    createPleadingMock.mockResolvedValue(DRAFT);
    getPleadingGenerationMock.mockResolvedValue({
      pleading_id: DRAFT.id,
      status: 'running',
      progress: 35,
      current_section: 'Facts',
    });
    streamPleadingGenerationMock.mockImplementation(
      async (
        _caseId: string,
        _pleadingId: string,
        _payload: unknown,
        handlers: PleadingGenerationStreamHandlers,
      ) => {
        handlers.onStarted?.({ job_id: 'job-1', progress: 5 });
        handlers.onSection?.({ heading: 'Facts', progress: 35 });
        handlers.onDelta?.({ text: 'The claimant submits that…', progress: 45 });
      },
    );

    renderWithQuery(<PleadingsTab caseId="case-1" canWrite />);

    await user.click(await screen.findByRole('button', { name: 'New pleading' }));
    await user.type(
      screen.getByPlaceholderText('Statement of claim'),
      'Statement of claim',
    );
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Generate body with AI drafting',
      }),
    );
    await user.type(
      screen.getByPlaceholderText(
        'Draft a statement of claim for an unpaid invoice dispute...',
      ),
      'Draft a statement of claim for an unpaid invoice dispute.',
    );
    await user.click(screen.getByRole('button', { name: 'Create pleading' }));

    await waitFor(() =>
      expect(createPleadingMock).toHaveBeenCalledWith(
        'case-1',
        expect.objectContaining({
          title: 'Statement of claim',
          body: '',
          generate_body: false,
          language: 'en',
          metadata: { generation_requested: true },
        }),
      ),
    );
    await waitFor(() =>
      expect(streamPleadingGenerationMock).toHaveBeenCalledWith(
        'case-1',
        DRAFT.id,
        {
          language: 'en',
          draft_prompt:
            'Draft a statement of claim for an unpaid invoice dispute.',
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );

    expect(
      screen.queryByRole('dialog', { name: 'Add pleading' }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText('Generating pleading').length).toBeGreaterThan(
        0,
      ),
    );
    expect(screen.getByText('45% complete')).toBeInTheDocument();
  });

  it('restores a failed background job and retries it through the retry stream', async () => {
    const user = userEvent.setup();
    listPleadingsMock.mockResolvedValue([DRAFT]);
    getPleadingGenerationMock.mockResolvedValue({
      pleading_id: DRAFT.id,
      status: 'failed',
      progress: 48,
      error_code: 'DRAFTING_PROVIDER_ERROR',
      error_message: 'The drafting provider stopped unexpectedly.',
      can_retry: true,
      last_event_id: 'event-12',
    });
    retryPleadingGenerationMock.mockImplementation(
      async (
        _caseId: string,
        _pleadingId: string,
        handlers: PleadingGenerationStreamHandlers,
      ) => {
        handlers.onStarted?.({ job_id: 'job-2', progress: 3 });
      },
    );

    renderWithQuery(<PleadingsTab caseId="case-1" canWrite />);

    expect(await screen.findByText('Draft generation failed')).toBeInTheDocument();
    expect(
      screen.getByText('The drafting provider stopped unexpectedly.'),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Retry generation' }),
    );

    await waitFor(() =>
      expect(retryPleadingGenerationMock).toHaveBeenCalledWith(
        'case-1',
        DRAFT.id,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    await waitFor(() =>
      expect(screen.getAllByText('Generating pleading').length).toBeGreaterThan(
        0,
      ),
    );
  });

  it('cancels the durable server job only after an explicit user action', async () => {
    const user = userEvent.setup();
    listPleadingsMock.mockResolvedValue([DRAFT]);
    getPleadingGenerationMock.mockResolvedValue({
      pleading_id: DRAFT.id,
      status: 'running',
      progress: 58,
      current_section: 'Legal grounds',
    });

    renderWithQuery(<PleadingsTab caseId="case-1" canWrite />);

    await waitFor(() =>
      expect(screen.getAllByText('Generating pleading').length).toBeGreaterThan(
        0,
      ),
    );
    await user.click(
      screen.getByRole('button', { name: 'Cancel generation' }),
    );

    await waitFor(() =>
      expect(cancelPleadingGenerationMock).toHaveBeenCalledWith(
        'case-1',
        DRAFT.id,
      ),
    );
    expect(
      await screen.findByText('Draft generation cancelled'),
    ).toBeInTheDocument();
  });
});
