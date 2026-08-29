import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { formatRelativeAt } from '@/lib/lex/ksa';

import {
  AiAgentPanel,
  AI_AGENT_MESSAGE_MAX_LENGTH,
  type AiAgentPanelProps,
  type AiAgentReadyProps,
  type AiAgentSession,
  type AiAgentTurn,
} from './ai-agent-panel';

/** Injected "now" so every relative session timestamp is deterministic. */
const REFERENCE = new Date(2026, 8, 21, 9, 0, 0);

const SESSIONS: AiAgentSession[] = [
  {
    id: 'session-1',
    title: 'Contract renewal exposure',
    updatedAt: new Date(2026, 8, 21, 8, 0, 0).toISOString(),
  },
  {
    id: 'session-2',
    title: 'Litigation reserve summary',
    updatedAt: new Date(2026, 8, 18, 9, 0, 0).toISOString(),
  },
];

const TURNS: AiAgentTurn[] = [
  { id: 'turn-1', role: 'user', content: 'Which contracts expire this quarter?' },
  {
    id: 'turn-2',
    role: 'assistant',
    content: 'Four contracts expire before 31 December.',
    groundedInCount: 2,
  },
];

function readyProps(overrides: Partial<AiAgentReadyProps> = {}): AiAgentPanelProps {
  return {
    state: 'ready',
    sessions: SESSIONS,
    activeSessionId: null,
    turns: [],
    isLoadingTurns: false,
    isSending: false,
    sendFailure: null,
    now: REFERENCE,
    onAsk: vi.fn(),
    onSelectSession: vi.fn(),
    onNewChat: vi.fn(),
    ...overrides,
  };
}

function composer(): HTMLTextAreaElement {
  return screen.getByLabelText('Ask anything') as HTMLTextAreaElement;
}

describe('AiAgentPanel', () => {
  it('rests on the two-column session rail and "What can I help with?" composer', () => {
    const { container } = renderWithQuery(<AiAgentPanel {...readyProps()} />);

    expect(screen.getByRole('heading', { level: 2, name: 'My AI Agent' })).toBeVisible();
    expect(screen.getByText('What can I help with?')).toBeVisible();
    expect(composer()).toHaveAttribute('placeholder', 'Ask anything');
    expect(composer()).toHaveAttribute('maxlength', String(AI_AGENT_MESSAGE_MAX_LENGTH));

    // Left rail: the search field and the recent chats the mockup calls for.
    const rail = screen.getByRole('complementary', { name: 'Recent chats' });
    expect(within(rail).getByRole('searchbox', { name: 'Search chats' })).toBeVisible();
    expect(within(rail).getAllByRole('button', { name: /Contract renewal exposure/ })).toHaveLength(1);
    expect(
      Array.from(container.querySelectorAll('[data-ai-agent-session]')).map((button) =>
        button.getAttribute('data-ai-agent-session'),
      ),
    ).toEqual(['session-1', 'session-2']);

    // No transcript yet, so the resting hero stands in for one.
    expect(container.querySelector('[data-ai-agent-transcript]')).toBeNull();
  });

  it('renders session timestamps against the injected now, not the wall clock', () => {
    renderWithQuery(<AiAgentPanel {...readyProps()} />);

    expect(
      screen.getByRole('button', { name: /Contract renewal exposure/ }),
    ).toHaveTextContent(formatRelativeAt(SESSIONS[0].updatedAt, 'en', REFERENCE));
  });

  it('distinguishes an empty rail from a filtered-out one', () => {
    const { unmount } = renderWithQuery(
      <AiAgentPanel {...readyProps({ sessions: [] })} />,
    );

    expect(screen.getByText('No chats yet')).toBeVisible();
    expect(screen.queryByText('No chats match your search')).not.toBeInTheDocument();

    unmount();
    renderWithQuery(<AiAgentPanel {...readyProps()} />);
    const search = screen.getByRole('searchbox', { name: 'Search chats' });

    fireEvent.change(search, { target: { value: 'litigation' } });
    expect(screen.getByRole('button', { name: /Litigation reserve summary/ })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Contract renewal exposure/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'merger' } });
    expect(screen.getByText('No chats match your search')).toBeVisible();
    expect(screen.queryByText('No chats yet')).not.toBeInTheDocument();
  });

  it('renders a populated transcript with its speakers and grounding disclosure', () => {
    const { container } = renderWithQuery(
      <AiAgentPanel {...readyProps({ turns: TURNS, activeSessionId: 'session-1' })} />,
    );

    const transcript = screen.getByRole('list', { name: 'Conversation' });
    const turns = within(transcript).getAllByRole('listitem');

    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveAttribute('data-ai-agent-turn', 'user');
    expect(turns[0]).toHaveTextContent('You');
    expect(turns[0]).toHaveTextContent('Which contracts expire this quarter?');
    expect(turns[1]).toHaveAttribute('data-ai-agent-turn', 'assistant');
    expect(turns[1]).toHaveTextContent('AI Agent');
    expect(turns[1]).toHaveTextContent('Grounded in 2 legal sources');
    // A user turn is never claimed to be grounded in anything.
    expect(turns[0]).not.toHaveTextContent('Grounded in');
    // The hero is replaced by the conversation, not stacked above it.
    expect(screen.queryByText('What can I help with?')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-ai-agent-session="session-1"]'),
    ).toHaveAttribute('aria-current', 'true');
    expect(
      container.querySelector('[data-ai-agent-session="session-2"]'),
    ).not.toHaveAttribute('aria-current');
  });

  it('holds the composer closed while a question is in flight and announces it', () => {
    renderWithQuery(<AiAgentPanel {...readyProps({ turns: TURNS, isSending: true })} />);

    expect(composer()).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled();
    const pending = screen.getByRole('status');
    expect(pending).toHaveTextContent('Thinking…');
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(pending).toHaveAttribute('aria-live', 'polite');
  });

  it('shows a loading state for a transcript that is still being read', () => {
    renderWithQuery(<AiAgentPanel {...readyProps({ isLoadingTurns: true })} />);

    expect(screen.getByRole('status', { name: 'Loading AI Agent data' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    // Reading a transcript never disables the composer — only sending does.
    expect(composer()).not.toBeDisabled();
  });

  it('names the four send failures apart, keeping the composer usable', () => {
    const cases = [
      ['failed', 'The assistant could not answer. Send your question again.'],
      ['refused', 'The assistant declined to answer this request.'],
      ['providerOffline', 'The assistant is not configured in this environment.'],
      [
        'noGrounding',
        'You can read no legal domain, so there is nothing to ground an answer on.',
      ],
    ] as const;

    for (const [failure, message] of cases) {
      const { unmount } = renderWithQuery(
        <AiAgentPanel {...readyProps({ sendFailure: failure })} />,
      );

      expect(screen.getByRole('alert')).toHaveTextContent(message);
      // A failed question is not a failed panel: the reader can resend at once.
      expect(composer()).not.toBeDisabled();
      unmount();
    }
  });

  it('submits a trimmed question, clears the draft, and refuses a blank one', () => {
    const onAsk = vi.fn();
    renderWithQuery(<AiAgentPanel {...readyProps({ onAsk })} />);
    const field = composer();
    const send = screen.getByRole('button', { name: /Send/ });

    expect(send).toBeDisabled();

    fireEvent.change(field, { target: { value: '   ' } });
    expect(send).toBeDisabled();

    fireEvent.change(field, { target: { value: '  Summarise open litigation  ' } });
    fireEvent.click(send);

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith('Summarise open litigation');
    expect(field).toHaveValue('');
  });

  it('sends on Enter and keeps Shift+Enter as a newline', () => {
    const onAsk = vi.fn();
    renderWithQuery(<AiAgentPanel {...readyProps({ onAsk })} />);
    const field = composer();

    fireEvent.change(field, { target: { value: 'Which obligations are overdue?' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(onAsk).not.toHaveBeenCalled();
    expect(field).toHaveValue('Which obligations are overdue?');

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith('Which obligations are overdue?');
  });

  it('reports session selection and new-chat intent to the caller', () => {
    const onSelectSession = vi.fn();
    const onNewChat = vi.fn();
    renderWithQuery(<AiAgentPanel {...readyProps({ onSelectSession, onNewChat })} />);

    fireEvent.click(screen.getByRole('button', { name: /Litigation reserve summary/ }));
    expect(onSelectSession).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith('session-2');

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('provides loading and retryable error companions under the same title', () => {
    const { unmount } = renderWithQuery(<AiAgentPanel state="loading" />);

    expect(screen.getByRole('heading', { name: 'My AI Agent' })).toBeVisible();
    expect(screen.getByRole('status', { name: 'Loading AI Agent data' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    // A panel that could not be read offers no composer to type into.
    expect(screen.queryByLabelText('Ask anything')).not.toBeInTheDocument();

    unmount();
    const onRetry = vi.fn();
    renderWithQuery(<AiAgentPanel state="error" onRetry={onRetry} />);

    expect(screen.getByRole('heading', { name: 'My AI Agent' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load AI Agent data');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders Arabic copy, Arabic-Indic digits and an RTL workspace', () => {
    const { container } = renderWithQuery(
      <AiAgentPanel {...readyProps({ turns: TURNS })} />,
      { locale: 'ar' },
    );

    expect(
      screen.getByRole('heading', { name: 'وكيل الذكاء الاصطناعي الخاص بي' }),
    ).toBeVisible();
    expect(container.querySelector('[data-ai-agent-panel]')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByLabelText('اسأل عن أي شيء')).toBeVisible();
    expect(screen.getByRole('button', { name: 'محادثة جديدة' })).toBeVisible();
    expect(screen.getByText('أنت')).toBeVisible();
    // The grounding count is localized, not left in Latin digits.
    expect(screen.getByText('مرتكز على ٢ من المصادر القانونية')).toBeVisible();
    expect(
      screen.getByRole('button', { name: /Litigation reserve summary/ }),
    ).toHaveTextContent(formatRelativeAt(SESSIONS[1].updatedAt, 'ar', REFERENCE));
  });

  it('marks user-supplied and model-supplied strings as bidi-neutral', () => {
    renderWithQuery(<AiAgentPanel {...readyProps({ turns: TURNS })} />, { locale: 'ar' });

    expect(screen.getByText('Contract renewal exposure')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('Four contracts expire before 31 December.')).toHaveAttribute(
      'dir',
      'auto',
    );
    expect(screen.getByLabelText('اسأل عن أي شيء')).toHaveAttribute('dir', 'auto');
  });

  it('stays presentation-only, token-bound and logical-property-only', () => {
    const source = readFileSync(resolve(process.cwd(), __dirname, 'ai-agent-panel.tsx'), 'utf8');

    expect(source).not.toMatch(/#[\da-f]{3,8}/i);
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr)-/);
    // The panel never fetches, never holds a session identity and never decides
    // whether the assistant exists — the container owns all three.
    expect(source).not.toMatch(
      /\bfetch\s*\(|\baxios\b|\buseQuery\b|\buseMutation\b|useRoleDashboardData|hasPermission/,
    );
    expect(source).not.toContain('ai-client');
    expect(source).not.toContain("'/api/");
    // Actions ride the shared Button primitive, not raw <button> elements.
    expect(source).not.toMatch(/<button\b/);
    // The open conversation is never marked by colour alone.
    expect(source).toContain('aria-[current=true]:border-s-4');

    const css = readFileSync(
      resolve(process.cwd(), __dirname, 'ai-agent-panel.module.css'),
      'utf8',
    );

    expect(css).not.toMatch(/#[\da-f]{3,8}/i);
    expect(css).not.toMatch(/(?:margin|padding|border|inset)-(?:left|right)\b/);
    expect(css).not.toMatch(/^\s*(?:left|right|top|bottom):/m);
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container (min-width: 44rem)');
    // The two-column split is the mockup's, and it collapses rather than scrolls.
    expect(css).toContain('grid-template-columns: minmax(0, 32fr) minmax(0, 68fr)');
  });
});
