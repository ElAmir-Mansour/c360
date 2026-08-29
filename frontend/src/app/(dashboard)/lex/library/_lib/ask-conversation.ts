'use client';

/**
 * "Ask the Library" conversation state machine + transport binding.
 *
 * Streaming is REAL: the reducer below is driven by the token-streaming SSE
 * transport ({@link AskStreamHandlers} → `enterpriseApi.lex.referenceLibrary
 * .askStream`), which appends `token` frames to the answer live as they arrive
 * and renders citation chips when the `citations` frame lands. When the stream
 * endpoint is not deployed (404/405) or the browser can't stream, the transport
 * transparently falls back to the non-streaming `POST /reference-library/ask`
 * and replays its real answer with a typewriter reveal — so the panel behaves
 * identically. A 503 (Second Brain not enabled) degrades to a graceful
 * "coming soon" state; nothing is ever fabricated.
 *
 * The reducer is pure and unit-tested (`ask-conversation.test.ts`).
 */

import { useCallback, useReducer, useRef } from 'react';
import { enterpriseApi } from '@/lib/enterprise';
import {
  isNotConfiguredApiError,
  type AskStreamHandlers,
} from '@/lib/enterprise/reference-library-stream';
import type { LexReferenceAskCitation } from '@/types/suites';

export type AskTurnStatus = 'streaming' | 'done' | 'error' | 'not-configured';

export interface AskTurn {
  id: string;
  question: string;
  /** Accumulated answer text (grows as `token` frames arrive). */
  answer: string;
  citations: LexReferenceAskCitation[];
  model?: string;
  latencyMs?: number;
  status: AskTurnStatus;
}

export interface AskState {
  turns: AskTurn[];
  /** True while a turn is actively streaming. */
  pending: boolean;
}

export type AskAction =
  | { type: 'ask'; id: string; question: string }
  | { type: 'token'; id: string; text: string }
  | {
      type: 'citations';
      id: string;
      citations: LexReferenceAskCitation[];
      model?: string;
      latencyMs?: number;
    }
  | { type: 'done'; id: string }
  | { type: 'error'; id: string }
  | { type: 'not-configured'; id: string }
  | { type: 'stop' }
  | { type: 'reset' };

export const initialAskState: AskState = { turns: [], pending: false };

function patchTurn(
  state: AskState,
  id: string,
  patch: (turn: AskTurn) => AskTurn,
): AskState {
  return {
    ...state,
    turns: state.turns.map((t) => (t.id === id ? patch(t) : t)),
  };
}

export function askReducer(state: AskState, action: AskAction): AskState {
  switch (action.type) {
    case 'ask':
      return {
        turns: [
          ...state.turns,
          {
            id: action.id,
            question: action.question,
            answer: '',
            citations: [],
            status: 'streaming',
          },
        ],
        pending: true,
      };
    case 'token':
      return patchTurn(state, action.id, (t) =>
        t.status === 'streaming' ? { ...t, answer: t.answer + action.text } : t,
      );
    case 'citations':
      // Attach (or refine) citations while still streaming — `meta.sources`
      // previews them early, the `citations` frame delivers the final set +
      // model line. Model/latency only overwrite when provided.
      return patchTurn(state, action.id, (t) =>
        t.status === 'streaming'
          ? {
              ...t,
              citations: action.citations,
              model: action.model ?? t.model,
              latencyMs: action.latencyMs ?? t.latencyMs,
            }
          : t,
      );
    case 'done':
      return {
        ...patchTurn(state, action.id, (t) =>
          t.status === 'streaming' ? { ...t, status: 'done' } : t,
        ),
        pending: false,
      };
    case 'error':
      return {
        ...patchTurn(state, action.id, (t) =>
          t.status === 'streaming' ? { ...t, status: 'error' } : t,
        ),
        pending: false,
      };
    case 'not-configured':
      return {
        ...patchTurn(state, action.id, (t) =>
          t.status === 'streaming' ? { ...t, status: 'not-configured' } : t,
        ),
        pending: false,
      };
    case 'stop':
      // User pressed "Stop": finalise the in-flight turn, keeping the partial
      // answer + any citations received so far.
      return {
        ...state,
        turns: state.turns.map((t) =>
          t.status === 'streaming' ? { ...t, status: 'done' } : t,
        ),
        pending: false,
      };
    case 'reset':
      return initialAskState;
    default:
      return state;
  }
}

/** True when the error means the Second-Brain service is not enabled (not a bug). */
export const isNotConfiguredError = isNotConfiguredApiError;

let turnSeq = 0;

/** Injectable streaming transport (defaults to the real enterprise API). */
export type AskStreamTransport = (
  payload: { question: string; topK?: number; docIds?: string[] },
  handlers: AskStreamHandlers,
  options?: { fallbackChunkDelayMs?: number },
) => Promise<void>;

export interface UseAskConversationOptions {
  topK?: number;
  docIds?: string[];
  /** Typewriter delay used only by the non-stream fallback (0 in tests). */
  chunkDelayMs?: number;
  /** Overrides the streaming transport for tests. */
  askStream?: AskStreamTransport;
}

/**
 * React hook wrapping the reducer + streaming transport. Exposes the turn list,
 * `submit(question)` (streams a cited answer), `stop()` (aborts the in-flight
 * stream but keeps the partial answer), and `reset()` (clears the conversation).
 * Concurrent submits are ignored while a turn is pending.
 */
export function useAskConversation(options: UseAskConversationOptions = {}) {
  const [state, dispatch] = useReducer(askReducer, initialAskState);
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef(false);

  const askStream = options.askStream ?? enterpriseApi.lex.referenceLibrary.askStream;
  const { topK, docIds, chunkDelayMs } = options;

  const submit = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question || pendingRef.current) return;
      pendingRef.current = true;
      turnSeq += 1;
      const id = `turn-${turnSeq}`;
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: 'ask', id, question });

      const handlers: AskStreamHandlers = {
        signal: controller.signal,
        onMeta: (meta) => {
          if (meta.sources && meta.sources.length > 0) {
            dispatch({ type: 'citations', id, citations: meta.sources });
          }
        },
        onToken: (text) => dispatch({ type: 'token', id, text }),
        onCitations: (c) =>
          dispatch({
            type: 'citations',
            id,
            citations: c.citations,
            model: c.model,
            latencyMs: c.latency_ms,
          }),
        onError: (err) =>
          dispatch({ type: err.notConfigured ? 'not-configured' : 'error', id }),
        onDone: () => dispatch({ type: 'done', id }),
      };

      try {
        await askStream({ question, topK, docIds }, handlers, {
          fallbackChunkDelayMs: chunkDelayMs,
        });
        // Safety net: if the stream closed without an explicit `done`/`error`
        // frame, finalise the (still-streaming) turn so it isn't stuck typing.
        dispatch({ type: 'done', id });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Aborted by stop()/reset() — state already finalised or discarded.
        } else {
          dispatch({ type: 'error', id });
        }
      } finally {
        pendingRef.current = false;
        abortRef.current = null;
      }
    },
    [askStream, topK, docIds, chunkDelayMs],
  );

  /** Abort the in-flight stream, keeping whatever answer has arrived so far. */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    pendingRef.current = false;
    dispatch({ type: 'stop' });
  }, []);

  /** Abort any in-flight stream and clear the whole conversation. */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    pendingRef.current = false;
    dispatch({ type: 'reset' });
  }, []);

  return { state, submit, stop, reset, isPending: state.pending };
}
