import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  DRCopilotChatResult,
  DRCopilotSessionTranscript,
} from '@/types/clario-dr';

/**
 * Real test for the console-wide DR Copilot launcher (#9).
 *
 * Proves the launcher is genuine wiring, not a stub:
 *  - clicking the floating action opens the slide-over panel;
 *  - typing + sending calls the REAL `chatDRCopilot` action with the operator
 *    message GROUNDED in the current group/stream selection (the wire contract
 *    has no group/stream field, so grounding rides in the message text);
 *  - the returned answer renders in the conversation thread;
 *  - loading a session id calls `fetchDRCopilotSessionTranscript` and renders
 *    the transcript's messages;
 *  - without `dr:write` the composer is disabled.
 *
 * The grounding helper is also unit-tested directly.
 */

// --- next/navigation -------------------------------------------------------
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/recover',
  useSearchParams: () => new URLSearchParams('group=g1&stream=stream-77'),
}));

// --- auth / permission gating (mutable per test) ---------------------------
const canWriteRef = { current: true };
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) => (perm === 'dr:write' ? canWriteRef.current : true),
    user: { id: 'u1' },
  }),
}));

// --- query hooks (group/stream context for grounding) ----------------------
vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRPosture: () => ({
    data: { groups: [{ group_id: 'g1', name: 'Payments core' }] },
    isLoading: false,
  }),
  useDRGroupSummary: () => ({
    data: { group_id: 'g1', name: 'Payments core', rto_objective_seconds: 900 },
    isLoading: false,
  }),
}));

// --- sonner (inert toasts) -------------------------------------------------
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// --- real copilot I/O: keep the rest of the lib, override the two copilot fns -
// Hoisted so the `vi.mock` factory (itself hoisted) can reference these.
const { chatDRCopilot, fetchDRCopilotSessionTranscript } = vi.hoisted(() => ({
  chatDRCopilot: vi.fn<(payload: unknown) => Promise<DRCopilotChatResult>>(),
  fetchDRCopilotSessionTranscript:
    vi.fn<(sessionID: string) => Promise<DRCopilotSessionTranscript>>(),
}));

vi.mock('@/lib/clario-dr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/clario-dr')>();
  return { ...actual, chatDRCopilot, fetchDRCopilotSessionTranscript };
});

// Imported AFTER the mocks above so it binds to the mocked modules.
import { DRCopilotLauncher } from './dr-copilot-launcher';
import {
  buildGroundedDRCopilotMessage,
  formatDRCopilotGrounding,
} from './dr-copilot-context';

function chatResult(answer: string): DRCopilotChatResult {
  return {
    session_id: 'sess-1',
    message_id: 'msg-1',
    answer,
    provider: 'anthropic',
    model: 'test-model',
    latency_ms: 42,
    iterations: 1,
    proposed_action: null,
    tool_calls: [],
  };
}

function transcript(): DRCopilotSessionTranscript {
  return {
    session: {
      id: 'sess-9',
      tenant_id: 't1',
      user_id: 'u1',
      title: 'Recovery review',
      provider: 'anthropic',
      model: 'test-model',
      message_count: 2,
      created_at: '2026-06-14T10:00:00Z',
      updated_at: '2026-06-14T10:05:00Z',
    },
    messages: [
      {
        id: 'm1',
        session_id: 'sess-9',
        tenant_id: 't1',
        seq: 1,
        role: 'user',
        content: 'What is our RPO posture?',
        latency_ms: 0,
        created_at: '2026-06-14T10:00:00Z',
      },
      {
        id: 'm2',
        session_id: 'sess-9',
        tenant_id: 't1',
        seq: 2,
        role: 'assistant',
        content: 'RPO is within objective for Payments core.',
        latency_ms: 88,
        created_at: '2026-06-14T10:01:00Z',
      },
    ],
  };
}

beforeEach(() => {
  canWriteRef.current = true;
  chatDRCopilot.mockReset();
  fetchDRCopilotSessionTranscript.mockReset();
});

describe('DRCopilotLauncher', () => {
  it('opens the panel and asks the copilot with a grounded message', async () => {
    chatDRCopilot.mockResolvedValue(chatResult('Failover risk is low; one approval gate pending.'));
    const user = userEvent.setup();

    renderWithQuery(<DRCopilotLauncher />);

    // The panel is not mounted until the launcher is opened.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open the clariodr copilot/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/clariodr copilot/i)).toBeInTheDocument();

    const composer = within(dialog).getByLabelText(/message to the dr copilot/i);
    await user.type(composer, 'Is it safe to fail over now?');
    await user.click(within(dialog).getByRole('button', { name: /^ask clariodr$/i }));

    await waitFor(() => expect(chatDRCopilot).toHaveBeenCalledTimes(1));

    const payload = chatDRCopilot.mock.calls[0][0] as { session_id: string | null; message: string };
    expect(payload.session_id).toBeNull();
    // Operator words lead; the console selection is folded into the message text.
    expect(payload.message).toContain('Is it safe to fail over now?');
    expect(payload.message).toContain('Payments core');
    expect(payload.message).toContain('g1');
    expect(payload.message).toContain('stream-77');

    expect(
      await within(dialog).findByText(/failover risk is low; one approval gate pending\./i),
    ).toBeInTheDocument();
  });

  // Graceful degradation: an environment with no LLM provider key returns a
  // 503 `llm_unavailable` (not a 500). The panel renders that as a calm,
  // intentional "copilot isn't configured" notice — never the amber
  // "something broke, retry" error — so an unkeyed environment looks deliberate.
  it('shows an intentional "not configured" notice when the copilot LLM is unavailable (503)', async () => {
    chatDRCopilot.mockRejectedValue({
      status: 503,
      code: 'llm_unavailable',
      message: 'copilot: llm provider unavailable',
    });
    const user = userEvent.setup();

    renderWithQuery(<DRCopilotLauncher />);
    await user.click(screen.getByRole('button', { name: /open the clariodr copilot/i }));
    const dialog = await screen.findByRole('dialog');

    await user.type(
      within(dialog).getByLabelText(/message to the dr copilot/i),
      'Explain failover risk',
    );
    await user.click(within(dialog).getByRole('button', { name: /^ask clariodr$/i }));

    await waitFor(() => expect(chatDRCopilot).toHaveBeenCalledTimes(1));

    // The calm, informational notice is shown...
    expect(
      await within(dialog).findByText(/configured in this environment/i),
    ).toBeInTheDocument();
    // ...and NOT the generic retryable error.
    expect(
      within(dialog).queryByText(/failed to query the dr copilot/i),
    ).not.toBeInTheDocument();
  });

  // A genuine failure (not an availability signal) still shows the amber,
  // retryable error — the graceful path is scoped to the unavailable case only.
  it('shows the generic retryable error for a non-availability failure (500)', async () => {
    chatDRCopilot.mockRejectedValue({
      status: 500,
      code: 'internal',
      message: 'internal error',
    });
    const user = userEvent.setup();

    renderWithQuery(<DRCopilotLauncher />);
    await user.click(screen.getByRole('button', { name: /open the clariodr copilot/i }));
    const dialog = await screen.findByRole('dialog');

    await user.type(
      within(dialog).getByLabelText(/message to the dr copilot/i),
      'Explain failover risk',
    );
    await user.click(within(dialog).getByRole('button', { name: /^ask clariodr$/i }));

    await waitFor(() => expect(chatDRCopilot).toHaveBeenCalledTimes(1));

    expect(
      await within(dialog).findByText(/failed to query the dr copilot/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText(/configured in this environment/i),
    ).not.toBeInTheDocument();
  });

  it('loads a prior transcript by session id', async () => {
    fetchDRCopilotSessionTranscript.mockResolvedValue(transcript());
    const user = userEvent.setup();

    renderWithQuery(<DRCopilotLauncher />);
    await user.click(screen.getByRole('button', { name: /open the clariodr copilot/i }));
    const dialog = await screen.findByRole('dialog');

    const sessionField = within(dialog).getByPlaceholderText(/session id/i);
    await user.type(sessionField, 'sess-9');
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }));

    // react-query forwards the mutation variable as the first arg (a second
    // mutation-context arg follows), so assert on the leading argument.
    await waitFor(() => expect(fetchDRCopilotSessionTranscript).toHaveBeenCalledTimes(1));
    expect(fetchDRCopilotSessionTranscript.mock.calls[0][0]).toBe('sess-9');

    expect(await within(dialog).findByText(/what is our rpo posture\?/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/rpo is within objective for payments core\./i),
    ).toBeInTheDocument();
  });

  it('disables the composer without dr:write', async () => {
    canWriteRef.current = false;
    const user = userEvent.setup();

    renderWithQuery(<DRCopilotLauncher />);
    await user.click(screen.getByRole('button', { name: /open the clariodr copilot/i }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByLabelText(/message to the dr copilot/i)).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /^ask clariodr$/i })).toBeDisabled();
    expect(chatDRCopilot).not.toHaveBeenCalled();
  });

  it('renders a custom embedded trigger (war-room embed)', async () => {
    const user = userEvent.setup();

    renderWithQuery(
      <DRCopilotLauncher
        runId="run-123"
        trigger={<button type="button">Ask about this run</button>}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /open the clariodr copilot/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ask about this run/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  // Arabic / RTL: the launcher chrome and panel composer resolve to professional
  // MSA when the active locale is `ar`, so an Arabic operator sees a fully Arabic
  // copilot (the product name "ClarioDR" stays Latin by design).
  it('renders the launcher and panel in Arabic under the ar locale', async () => {
    const user = userEvent.setup();

    renderWithQuery(<DRCopilotLauncher />, { locale: 'ar' });

    // Floating action carries the Arabic accessible name; the English one is gone.
    const opener = screen.getByRole('button', { name: 'فتح مساعد ClarioDR' });
    expect(
      screen.queryByRole('button', { name: /open the clariodr copilot/i }),
    ).not.toBeInTheDocument();

    await user.click(opener);
    const dialog = await screen.findByRole('dialog');

    // Sheet title + composer field resolve to MSA.
    expect(within(dialog).getByText('مساعد ClarioDR')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('رسالة إلى مساعد الاسترداد')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'اسأل ClarioDR' })).toBeInTheDocument();
  });
});

describe('dr-copilot-context grounding helpers', () => {
  it('formats only the resolved selection fields', () => {
    expect(
      formatDRCopilotGrounding({
        groupId: 'g1',
        groupName: 'Payments core',
        streamId: 'stream-77',
        runId: 'run-9',
        route: '/dr/recover',
      }),
    ).toBe(
      'Group: Payments core (g1)\nStream: stream-77\nActive recovery run: run-9\nConsole route: /dr/recover',
    );
  });

  it('returns an empty context when nothing is selected', () => {
    expect(
      formatDRCopilotGrounding({ groupId: null, groupName: null, streamId: null }),
    ).toBe('');
  });

  it('sends the bare message when there is no context to ground in', () => {
    expect(
      buildGroundedDRCopilotMessage('plain question', {
        groupId: null,
        groupName: null,
        streamId: null,
      }),
    ).toBe('plain question');
  });

  it('appends the context block under a delimiter when grounded', () => {
    const built = buildGroundedDRCopilotMessage('check drift', {
      groupId: 'g1',
      groupName: 'Payments core',
      streamId: null,
    });
    expect(built.startsWith('check drift')).toBe(true);
    expect(built).toContain('--- Current ClarioDR console context ---');
    expect(built).toContain('Group: Payments core (g1)');
  });
});
