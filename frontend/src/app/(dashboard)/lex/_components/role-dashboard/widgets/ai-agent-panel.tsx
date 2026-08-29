'use client';

/**
 * "My AI Agent" panel — LEX-LD-GAP-DESIGN §G4.
 *
 * Two columns, per the mockup: a session rail (search field + recent chats) and
 * a conversation column whose resting state is the "What can I help with?"
 * composer. Once a conversation is open the composer keeps its place beneath the
 * transcript, so the surface never re-lays-out around the reader mid-turn.
 *
 * PURE PRESENTATION, like every sibling in this directory. The panel performs no
 * data access, holds no session identity and never decides whether the assistant
 * exists: the container owns `lex:ai:use`, the `LEX_AI_ENABLED` probe, the
 * transport and the session id, and hands this file resolved props. The only
 * state kept here is the reader's own two text fields — the rail's filter and
 * the composer's draft — which are input state, not application state.
 *
 * ABSENCE IS NOT A STATE HERE. When the caller is not entitled to the assistant,
 * or the deployment did not enable it, the dashboard omits the whole band; there
 * is deliberately no "unavailable" case in the union below, because a panel that
 * renders nothing and a panel that is not rendered would be two ways to say the
 * same thing.
 */

import * as React from 'react';
import { Bot, MessageSquarePlus, Search, SendHorizontal, Sparkles, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';

import { useLegalDirectorDashboardLabels } from '../../../_lib/role-dashboards/legal-director-i18n';
import { DashboardPrimitiveState } from './dashboard-primitive-state';
import { PanelShell } from './panel-shell';
import styles from './ai-agent-panel.module.css';

/**
 * The three actions ride the shared `Button` primitive (focus ring, disabled and
 * dark-mode states) re-skinned onto the Watheeq `--wt-*` register, the same way
 * every other panel in this composition adapts a shared primitive. Layout stays
 * in the CSS module; only the button chrome is expressed here, so a module class
 * and a utility class can never fight over the same property.
 */
const NEW_CHAT_CLASS = cn(
  'w-full justify-center gap-2 rounded-[var(--wt-radius-pill)] px-4 shadow-none',
  'border-[length:var(--wt-card-border-width)] border-[color:var(--wt-teal-300)]',
  'bg-[var(--wt-canvas)] text-[color:var(--wt-teal-900)]',
  'hover:border-[color:var(--wt-teal-300)] hover:bg-[var(--wt-track)] hover:text-[color:var(--wt-teal-900)]',
  'focus-visible:ring-[color:var(--wt-teal-700)]',
);

const SESSION_CLASS = cn(
  'h-auto w-full flex-col items-start justify-start gap-0.5 whitespace-normal px-3 py-2 text-start',
  'rounded-[var(--wt-radius-kpi-card)] shadow-none',
  'border-[length:var(--wt-card-border-width)] border-[color:var(--wt-teal-300)]',
  'bg-[var(--wt-surface)] text-[color:var(--wt-teal-900)]',
  'hover:bg-[var(--wt-canvas)] hover:text-[color:var(--wt-teal-900)]',
  'focus-visible:ring-[color:var(--wt-teal-700)]',
  // The open conversation is marked by an inline-start rail AND a heavier title,
  // never by colour alone; `aria-current` carries the same fact to assistive tech.
  'aria-[current=true]:border-s-4 aria-[current=true]:border-s-[color:var(--wt-teal-700)]',
  'aria-[current=true]:bg-[var(--wt-canvas)]',
);

const SEND_CLASS = cn(
  'gap-2 rounded-[var(--wt-radius-pill)] px-4 shadow-none',
  'bg-[var(--wt-teal-700)] text-[color:var(--wt-surface)]',
  'hover:bg-[var(--wt-teal-900)] focus-visible:ring-[color:var(--wt-teal-700)]',
  'disabled:bg-[var(--wt-track)] disabled:text-[color:var(--wt-teal-700)]',
);

/**
 * Longest question the composer accepts. Mirrors `ai.MaxMessageLength` in
 * `backend/internal/lex/ai/model.go`; the server is still the authority and
 * rejects an over-long message with a validation error, this only stops the
 * reader typing past the bound with no feedback.
 */
export const AI_AGENT_MESSAGE_MAX_LENGTH = 4000;

/** One conversation in the rail. */
export interface AiAgentSession {
  id: string;
  title: string;
  /** ISO timestamp of the conversation's last turn; rendered as relative time. */
  updatedAt: string;
}

/**
 * One rendered turn. Persisted `tool` rows are the audit record of which legal
 * data the model read — they carry no operator-facing prose, so the caller
 * folds them into the assistant turn they belong to rather than passing them
 * here as turns of their own.
 */
export interface AiAgentTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Grounding tools the model read for this turn. Assistant turns only. */
  groundedInCount?: number;
}

/**
 * Why the last question produced no answer. The four cases are kept apart
 * because they call for four different reader responses: resend, rephrase, tell
 * an administrator, or ask for access.
 */
export type AiAgentSendFailure = 'failed' | 'refused' | 'providerOffline' | 'noGrounding';

export interface AiAgentReadyProps {
  /** Recent conversations, newest first. Order is the caller's, never re-sorted. */
  sessions: AiAgentSession[];
  /** The open conversation, or null while the composer is on its resting state. */
  activeSessionId: string | null;
  /** The open conversation's turns, oldest first. */
  turns: AiAgentTurn[];
  /** True while the open conversation's transcript is still being read. */
  isLoadingTurns: boolean;
  /** True while a question is in flight; the composer is held closed meanwhile. */
  isSending: boolean;
  /** Outcome of the last question, or null when it answered (or none was asked). */
  sendFailure: AiAgentSendFailure | null;
  /** The caller's stable "now" for relative timestamps. Defaults to this instant. */
  now?: Date;
  onAsk: (message: string) => void;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
}

export type AiAgentPanelProps =
  | { state: 'loading' }
  | { state: 'error'; onRetry: () => void }
  | ({ state: 'ready' } & AiAgentReadyProps);

/** The rail: a new-chat action, a client-side filter, and the recent chats. */
function SessionRail({
  sessions,
  activeSessionId,
  now,
  onSelectSession,
  onNewChat,
  baseId,
}: Pick<AiAgentReadyProps, 'sessions' | 'activeSessionId' | 'now' | 'onSelectSession' | 'onNewChat'> & {
  baseId: string;
}) {
  const labels = useLegalDirectorDashboardLabels();
  const formatter = useLexFormat();
  const [search, setSearch] = React.useState('');

  const needle = search.trim().toLocaleLowerCase();
  const visible = needle
    ? sessions.filter((session) => session.title.toLocaleLowerCase().includes(needle))
    : sessions;

  return (
    <aside className={styles.rail} aria-label={labels.aiAgent.recent}>
      <Button type="button" variant="outline" size="sm" className={NEW_CHAT_CLASS} onClick={onNewChat}>
        <MessageSquarePlus className="size-4 shrink-0" aria-hidden="true" />
        {labels.aiAgent.newChat}
      </Button>

      <div className={styles.search}>
        <label className="sr-only" htmlFor={`${baseId}-search`}>
          {labels.aiAgent.searchLabel}
        </label>
        <Search className={styles.searchIcon} aria-hidden="true" />
        <input
          id={`${baseId}-search`}
          type="search"
          className={styles.searchField}
          value={search}
          placeholder={labels.aiAgent.searchPlaceholder}
          onChange={(event) => setSearch(event.target.value)}
          dir="auto"
        />
      </div>

      <p className={styles.railTitle}>{labels.aiAgent.recent}</p>

      {visible.length === 0 ? (
        <p className={styles.railEmpty} role="status">
          {/*
           * An empty rail and a filtered-out rail read identically on screen and
           * mean opposite things, so they never share one string.
           */}
          {sessions.length === 0 ? labels.aiAgent.noChats : labels.aiAgent.noMatches}
        </p>
      ) : (
        <ul className={styles.sessions}>
          {visible.map((session) => (
            <li key={session.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={SESSION_CLASS}
                data-ai-agent-session={session.id}
                aria-current={session.id === activeSessionId ? 'true' : undefined}
                onClick={() => onSelectSession(session.id)}
              >
                <span className={styles.sessionTitle} dir="auto">
                  {session.title}
                </span>
                <span className={styles.sessionTime}>
                  {formatter.formatRelative(session.updatedAt, now)}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/** One turn: who spoke, what they said, and what the answer was grounded in. */
function TranscriptTurn({ turn }: { turn: AiAgentTurn }) {
  const labels = useLegalDirectorDashboardLabels();
  const formatter = useLexFormat();
  const isUser = turn.role === 'user';
  const Icon = isUser ? UserRound : Bot;
  const grounded = turn.groundedInCount ?? 0;

  return (
    <li className={styles.turn} data-ai-agent-turn={turn.role}>
      <p className={styles.turnRole}>
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {isUser ? labels.aiAgent.you : labels.aiAgent.assistant}
      </p>
      <p className={styles.turnContent} dir="auto">
        {turn.content}
      </p>
      {!isUser && grounded > 0 ? (
        <p className={styles.grounding}>
          {labels.aiAgent.groundedIn(formatter.formatNumber(grounded), grounded === 1)}
        </p>
      ) : null}
    </li>
  );
}

/** The conversation column: transcript (or its resting hero) above the composer. */
function Conversation({
  turns,
  isLoadingTurns,
  isSending,
  sendFailure,
  onAsk,
  baseId,
}: Pick<
  AiAgentReadyProps,
  'turns' | 'isLoadingTurns' | 'isSending' | 'sendFailure' | 'onAsk'
> & { baseId: string }) {
  const labels = useLegalDirectorDashboardLabels();
  const [draft, setDraft] = React.useState('');

  const message = draft.trim();
  const canSend = message.length > 0 && !isSending;

  const ask = () => {
    if (!canSend) return;
    onAsk(message);
    setDraft('');
  };

  return (
    <div className={styles.conversation}>
      {turns.length === 0 ? (
        <div className={styles.hero}>
          <Bot className={styles.heroIcon} aria-hidden="true" />
          <p className={styles.heroHeading}>{labels.aiAgent.heading}</p>
          <p className={styles.heroIntro}>{labels.aiAgent.intro}</p>
        </div>
      ) : (
        <ol
          className={styles.transcript}
          aria-label={labels.aiAgent.transcript}
          data-ai-agent-transcript=""
        >
          {turns.map((turn) => (
            <TranscriptTurn key={turn.id} turn={turn} />
          ))}
        </ol>
      )}

      {isLoadingTurns ? (
        <DashboardPrimitiveState state="loading" label={labels.states.aiAgent.loading} />
      ) : null}

      {isSending ? (
        <p className={styles.pending} role="status" aria-live="polite" aria-busy="true">
          {labels.aiAgent.sending}
        </p>
      ) : null}

      {sendFailure ? (
        <p className={styles.failure} role="alert">
          {labels.aiAgent.errors[sendFailure]}
        </p>
      ) : null}

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <label className="sr-only" htmlFor={`${baseId}-ask`}>
          {labels.aiAgent.askLabel}
        </label>
        <textarea
          id={`${baseId}-ask`}
          className={styles.composerField}
          value={draft}
          rows={2}
          maxLength={AI_AGENT_MESSAGE_MAX_LENGTH}
          placeholder={labels.aiAgent.askPlaceholder}
          disabled={isSending}
          dir="auto"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter keeps the newline a legal question often
            // needs. Composition (IME) keystrokes are left alone.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              ask();
            }
          }}
        />
        <Button type="submit" size="sm" className={SEND_CLASS} disabled={!canSend}>
          {/* The glyph points along the reading direction, so it flips with it. */}
          <SendHorizontal className="size-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
          {labels.aiAgent.send}
        </Button>
      </form>
    </div>
  );
}

/**
 * Presentation-only assistant surface. Loading and error are the whole panel's
 * states — the rail could not be read at all — while a failed question degrades
 * inside the ready conversation, where the composer is still usable.
 */
export function AiAgentPanel(props: AiAgentPanelProps) {
  const labels = useLegalDirectorDashboardLabels();
  const formatter = useLexFormat();
  const baseId = React.useId();
  const title = labels.panels.aiAgent;

  if (props.state === 'loading') {
    return (
      <PanelShell title={title} icon={Sparkles} className={styles.panel}>
        <DashboardPrimitiveState state="loading" label={labels.states.aiAgent.loading} />
      </PanelShell>
    );
  }

  if (props.state === 'error') {
    return (
      <PanelShell title={title} icon={Sparkles} className={styles.panel}>
        <DashboardPrimitiveState
          state="error"
          title={labels.states.aiAgent.error}
          retryLabel={labels.actions.retry}
          onRetry={props.onRetry}
        />
      </PanelShell>
    );
  }

  return (
    <PanelShell title={title} icon={Sparkles} className={styles.panel}>
      <div className={styles.workspace} dir={formatter.direction} data-ai-agent-panel="">
        <SessionRail
          sessions={props.sessions}
          activeSessionId={props.activeSessionId}
          now={props.now}
          onSelectSession={props.onSelectSession}
          onNewChat={props.onNewChat}
          baseId={baseId}
        />
        <Conversation
          turns={props.turns}
          isLoadingTurns={props.isLoadingTurns}
          isSending={props.isSending}
          sendFailure={props.sendFailure}
          onAsk={props.onAsk}
          baseId={baseId}
        />
      </div>
    </PanelShell>
  );
}
