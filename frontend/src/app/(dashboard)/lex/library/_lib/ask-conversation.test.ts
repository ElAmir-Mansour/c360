import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  askReducer,
  initialAskState,
  isNotConfiguredError,
  useAskConversation,
  type AskState,
  type AskStreamTransport,
} from './ask-conversation';
import { readSSEStream } from '@/lib/enterprise/reference-library-stream';
import type { LexReferenceAskCitation } from '@/types/suites';

const CITATIONS: LexReferenceAskCitation[] = [
  { doc_id: 'doc-1', title_ar: 'كفالة', title_en: 'Guaranty', snippet: '...', page: 3, score: 0.9 },
];

// ── Reducer (pure state machine) ──────────────────────────────────────────────

describe('askReducer', () => {
  it('ask → adds a streaming turn and marks pending', () => {
    const next = askReducer(initialAskState, { type: 'ask', id: 't1', question: 'q' });
    expect(next.pending).toBe(true);
    expect(next.turns).toHaveLength(1);
    expect(next.turns[0]).toMatchObject({ id: 't1', question: 'q', answer: '', status: 'streaming' });
  });

  it('token → appends only to a streaming turn', () => {
    let state: AskState = askReducer(initialAskState, { type: 'ask', id: 't1', question: 'q' });
    state = askReducer(state, { type: 'token', id: 't1', text: 'ab' });
    state = askReducer(state, { type: 'token', id: 't1', text: 'cd' });
    expect(state.turns[0].answer).toBe('abcd');
  });

  it('citations → attaches citations + model while streaming', () => {
    let state = askReducer(initialAskState, { type: 'ask', id: 't1', question: 'q' });
    state = askReducer(state, {
      type: 'citations',
      id: 't1',
      citations: CITATIONS,
      model: 'm',
      latencyMs: 10,
    });
    // citations do NOT finalise the turn — it keeps streaming until `done`.
    expect(state.turns[0].status).toBe('streaming');
    expect(state.pending).toBe(true);
    expect(state.turns[0].citations).toHaveLength(1);
    expect(state.turns[0].model).toBe('m');
    expect(state.turns[0].latencyMs).toBe(10);
  });

  it('citations without model does not wipe a previously-set model', () => {
    let state = askReducer(initialAskState, { type: 'ask', id: 't1', question: 'q' });
    state = askReducer(state, { type: 'citations', id: 't1', citations: [], model: 'm', latencyMs: 5 });
    state = askReducer(state, { type: 'citations', id: 't1', citations: CITATIONS });
    expect(state.turns[0].model).toBe('m');
    expect(state.turns[0].latencyMs).toBe(5);
    expect(state.turns[0].citations).toHaveLength(1);
  });

  it('done → finalises a streaming turn and clears pending', () => {
    let state = askReducer(initialAskState, { type: 'ask', id: 't1', question: 'q' });
    state = askReducer(state, { type: 'token', id: 't1', text: 'answer' });
    state = askReducer(state, { type: 'citations', id: 't1', citations: CITATIONS, model: 'm' });
    state = askReducer(state, { type: 'done', id: 't1' });
    expect(state.pending).toBe(false);
    expect(state.turns[0].status).toBe('done');
    expect(state.turns[0].answer).toBe('answer');
    expect(state.turns[0].citations).toHaveLength(1);
  });

  it('error / not-configured → set status and clear pending', () => {
    let state = askReducer(initialAskState, { type: 'ask', id: 't1', question: 'q' });
    state = askReducer(state, { type: 'error', id: 't1' });
    expect(state.turns[0].status).toBe('error');
    expect(state.pending).toBe(false);

    let s2 = askReducer(initialAskState, { type: 'ask', id: 't2', question: 'q' });
    s2 = askReducer(s2, { type: 'not-configured', id: 't2' });
    expect(s2.turns[0].status).toBe('not-configured');
  });

  it('done after error does not override the terminal error status', () => {
    let state = askReducer(initialAskState, { type: 'ask', id: 't1', question: 'q' });
    state = askReducer(state, { type: 'error', id: 't1' });
    state = askReducer(state, { type: 'done', id: 't1' });
    expect(state.turns[0].status).toBe('error');
  });

  it('stop → finalises the in-flight turn, keeping the partial answer', () => {
    let state = askReducer(initialAskState, { type: 'ask', id: 't1', question: 'q' });
    state = askReducer(state, { type: 'token', id: 't1', text: 'partial' });
    state = askReducer(state, { type: 'stop' });
    expect(state.pending).toBe(false);
    expect(state.turns[0].status).toBe('done');
    expect(state.turns[0].answer).toBe('partial');
  });

  it('token after done does not mutate a finalised turn', () => {
    let state = askReducer(initialAskState, { type: 'ask', id: 't1', question: 'q' });
    state = askReducer(state, { type: 'done', id: 't1' });
    state = askReducer(state, { type: 'token', id: 't1', text: 'late' });
    expect(state.turns[0].answer).toBe('');
  });

  it('reset → returns to the initial state', () => {
    let state = askReducer(initialAskState, { type: 'ask', id: 't1', question: 'q' });
    state = askReducer(state, { type: 'reset' });
    expect(state).toEqual(initialAskState);
  });
});

describe('isNotConfiguredError', () => {
  it('detects a 503 as not-configured', () => {
    expect(isNotConfiguredError({ status: 503, code: 'X', message: 'm' })).toBe(true);
    expect(isNotConfiguredError({ status: 500, code: 'X', message: 'm' })).toBe(false);
    expect(isNotConfiguredError(new Error('boom'))).toBe(false);
  });
});

// ── Hook (reducer + injected streaming transport) ─────────────────────────────

/** A fake transport that drives the handlers as if SSE frames had arrived. */
const streamingTransport: AskStreamTransport = async (_payload, handlers) => {
  handlers.onMeta?.({ cached: false });
  handlers.onToken?.('الكفيل ');
  handlers.onToken?.('يرجع.');
  handlers.onCitations?.({ citations: CITATIONS, model: 'test-model', latency_ms: 42 });
  handlers.onDone?.();
};

describe('useAskConversation', () => {
  it('streams tokens live and finalises with citations', async () => {
    const { result } = renderHook(() =>
      useAskConversation({ askStream: streamingTransport }),
    );
    await act(async () => {
      await result.current.submit('ما حكم الكفالة؟');
    });
    await waitFor(() => expect(result.current.state.turns[0]?.status).toBe('done'));
    expect(result.current.state.turns[0].answer).toBe('الكفيل يرجع.');
    expect(result.current.state.turns[0].citations).toHaveLength(1);
    expect(result.current.state.turns[0].model).toBe('test-model');
    expect(result.current.isPending).toBe(false);
  });

  it('drives the reducer from a REAL SSE ReadableStream via the transport', async () => {
    const encoder = new TextEncoder();
    const frames = [
      'event: token\ndata: {"text":"a"}\n\n',
      'event: token\ndata: {"text":"b"}\n\n',
      'event: citations\ndata: {"citations":[],"model":"m","latency_ms":7}\n\n',
      'event: done\ndata: {}\n\n',
    ];
    const transport: AskStreamTransport = async (_payload, handlers) => {
      let i = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (i < frames.length) controller.enqueue(encoder.encode(frames[i++]));
          else controller.close();
        },
      });
      await readSSEStream(body, handlers);
    };
    const { result } = renderHook(() => useAskConversation({ askStream: transport }));
    await act(async () => {
      await result.current.submit('q');
    });
    await waitFor(() => expect(result.current.state.turns[0]?.status).toBe('done'));
    expect(result.current.state.turns[0].answer).toBe('ab');
    expect(result.current.state.turns[0].model).toBe('m');
  });

  it('routes a not-configured error to the graceful state', async () => {
    const transport: AskStreamTransport = async (_payload, handlers) => {
      handlers.onError?.({ message: 'second brain not configured', notConfigured: true });
    };
    const { result } = renderHook(() => useAskConversation({ askStream: transport }));
    await act(async () => {
      await result.current.submit('q');
    });
    await waitFor(() =>
      expect(result.current.state.turns[0]?.status).toBe('not-configured'),
    );
  });

  it('finalises a stream that closes without an explicit done frame', async () => {
    const transport: AskStreamTransport = async (_payload, handlers) => {
      handlers.onToken?.('partial');
      // no onDone — the hook's safety net must finalise the turn
    };
    const { result } = renderHook(() => useAskConversation({ askStream: transport }));
    await act(async () => {
      await result.current.submit('q');
    });
    await waitFor(() => expect(result.current.state.turns[0]?.status).toBe('done'));
    expect(result.current.state.turns[0].answer).toBe('partial');
  });

  it('stop() aborts mid-stream and keeps the partial answer', async () => {
    let received: AbortSignal | undefined;
    const transport: AskStreamTransport = (_payload, handlers) => {
      received = handlers.signal;
      handlers.onToken?.('partial answer');
      // Simulate an open stream: never resolve until aborted.
      return new Promise<void>((_resolve, reject) => {
        handlers.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    };
    const { result } = renderHook(() => useAskConversation({ askStream: transport }));
    act(() => {
      void result.current.submit('q');
    });
    await waitFor(() => expect(result.current.state.turns[0]?.answer).toBe('partial answer'));
    expect(result.current.isPending).toBe(true);
    act(() => {
      result.current.stop();
    });
    await waitFor(() => expect(result.current.state.turns[0]?.status).toBe('done'));
    expect(result.current.state.turns[0].answer).toBe('partial answer');
    expect(received?.aborted).toBe(true);
    expect(result.current.isPending).toBe(false);
  });
});
