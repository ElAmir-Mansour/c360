import { describe, it, expect } from 'vitest';
import {
  parseSSEFrame,
  dispatchSSEFrame,
  readSSEStream,
  splitIntoChunks,
  streamFallback,
  isNotConfiguredMessage,
  isNotConfiguredApiError,
  type AskStreamHandlers,
  type AskStreamMeta,
  type AskStreamCitations,
  type AskStreamError,
} from './reference-library-stream';
import type { LexReferenceAskResponse } from '@/types/suites';

/** Build a ReadableStream that emits the given UTF-8 string chunks in order. */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

/** Collect every handler callback invocation for assertions. */
function recordingHandlers(signal?: AbortSignal) {
  const meta: AskStreamMeta[] = [];
  const tokens: string[] = [];
  const citations: AskStreamCitations[] = [];
  const errors: AskStreamError[] = [];
  let done = 0;
  const handlers: AskStreamHandlers = {
    signal,
    onMeta: (m) => meta.push(m),
    onToken: (t) => tokens.push(t),
    onCitations: (c) => citations.push(c),
    onError: (e) => errors.push(e),
    onDone: () => {
      done += 1;
    },
  };
  return { handlers, meta, tokens, citations, errors, getDone: () => done };
}

describe('parseSSEFrame', () => {
  it('parses event + data fields, stripping a leading space', () => {
    expect(parseSSEFrame('event: token\ndata: {"text":"hi"}')).toEqual({
      event: 'token',
      data: '{"text":"hi"}',
    });
  });

  it('joins multiple data lines with \\n', () => {
    expect(parseSSEFrame('event: token\ndata: a\ndata: b')).toEqual({
      event: 'token',
      data: 'a\nb',
    });
  });

  it('ignores comments and returns null for empty frames', () => {
    expect(parseSSEFrame(': keep-alive')).toBeNull();
    expect(parseSSEFrame('')).toBeNull();
  });

  it('tolerates trailing CR (CRLF wire)', () => {
    expect(parseSSEFrame('event: done\r\ndata: {}\r')).toEqual({
      event: 'done',
      data: '{}',
    });
  });
});

describe('dispatchSSEFrame', () => {
  it('routes each event type to its handler', () => {
    const r = recordingHandlers();
    dispatchSSEFrame({ event: 'meta', data: '{"cached":true}' }, r.handlers);
    dispatchSSEFrame({ event: 'token', data: '{"text":"ab"}' }, r.handlers);
    dispatchSSEFrame(
      { event: 'citations', data: '{"citations":[],"model":"m","latency_ms":9}' },
      r.handlers,
    );
    dispatchSSEFrame({ event: 'done', data: '{}' }, r.handlers);
    expect(r.meta).toEqual([{ cached: true }]);
    expect(r.tokens).toEqual(['ab']);
    expect(r.citations[0]).toEqual({ citations: [], model: 'm', latency_ms: 9 });
    expect(r.getDone()).toBe(1);
  });

  it('flags a 503-style error frame as not-configured', () => {
    const r = recordingHandlers();
    dispatchSSEFrame(
      { event: 'error', data: '{"error":"second brain not configured"}' },
      r.handlers,
    );
    expect(r.errors[0]).toEqual({
      message: 'second brain not configured',
      notConfigured: true,
    });
  });

  it('ignores empty/whitespace token frames and malformed JSON', () => {
    const r = recordingHandlers();
    dispatchSSEFrame({ event: 'token', data: '{"text":""}' }, r.handlers);
    dispatchSSEFrame({ event: 'token', data: 'not json' }, r.handlers);
    expect(r.tokens).toEqual([]);
  });
});

describe('readSSEStream', () => {
  it('decodes a full SSE conversation from a mocked ReadableStream', async () => {
    const r = recordingHandlers();
    const body = sseStream([
      'event: meta\ndata: {"cached":false}\n\n',
      'event: token\ndata: {"text":"الكفيل "}\n\n',
      'event: token\ndata: {"text":"يرجع."}\n\n',
      'event: citations\ndata: {"citations":[{"doc_id":"d1","title_ar":"ك","title_en":"G","snippet":"s","page":3,"score":0.9}],"model":"m","latency_ms":42}\n\n',
      'event: done\ndata: {}\n\n',
    ]);
    await readSSEStream(body, r.handlers);
    expect(r.tokens.join('')).toBe('الكفيل يرجع.');
    expect(r.citations[0].citations).toHaveLength(1);
    expect(r.citations[0].model).toBe('m');
    expect(r.getDone()).toBe(1);
  });

  it('reassembles frames split across chunk boundaries', async () => {
    const r = recordingHandlers();
    // A single "token" frame delivered byte-fragmented across three reads.
    const body = sseStream(['event: to', 'ken\ndata: {"text":"x"}', '\n\nevent: done\ndata: {}\n\n']);
    await readSSEStream(body, r.handlers);
    expect(r.tokens).toEqual(['x']);
    expect(r.getDone()).toBe(1);
  });

  it('aborts promptly when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = recordingHandlers(controller.signal);
    const body = sseStream(['event: token\ndata: {"text":"x"}\n\n']);
    await expect(readSSEStream(body, r.handlers)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(r.tokens).toEqual([]);
  });
});

describe('splitIntoChunks', () => {
  it('re-joins to the original text', () => {
    const text = 'الكفيل يرجع على المدين.';
    expect(splitIntoChunks(text).join('')).toBe(text);
  });
});

describe('streamFallback', () => {
  const RESPONSE: LexReferenceAskResponse = {
    answer: 'الكفيل يرجع على المدين.',
    citations: [
      { doc_id: 'd1', title_ar: 'ك', title_en: 'G', snippet: 's', page: 3, score: 0.9 },
    ],
    model: 'test-model',
    latency_ms: 42,
  };

  it('replays the non-stream answer as tokens + citations + done', async () => {
    const r = recordingHandlers();
    await streamFallback(async () => RESPONSE, r.handlers, 0);
    expect(r.tokens.join('')).toBe(RESPONSE.answer);
    expect(r.citations[0]).toEqual({
      citations: RESPONSE.citations,
      model: 'test-model',
      latency_ms: 42,
    });
    expect(r.getDone()).toBe(1);
  });

  it('maps a 503 ApiError to a not-configured error', async () => {
    const r = recordingHandlers();
    await streamFallback(
      async () => {
        throw { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'nope' };
      },
      r.handlers,
      0,
    );
    expect(r.errors[0]?.notConfigured).toBe(true);
    expect(r.getDone()).toBe(0);
  });

  it('maps other failures to a generic error', async () => {
    const r = recordingHandlers();
    await streamFallback(
      async () => {
        throw { status: 500, code: 'HTTP_500', message: 'boom' };
      },
      r.handlers,
      0,
    );
    expect(r.errors[0]).toEqual({ message: 'boom', notConfigured: false });
  });

  it('propagates an AbortError instead of swallowing it', async () => {
    const r = recordingHandlers();
    const abortErr = new DOMException('aborted', 'AbortError');
    await expect(
      streamFallback(async () => {
        throw abortErr;
      }, r.handlers, 0),
    ).rejects.toBe(abortErr);
  });
});

describe('classification helpers', () => {
  it('isNotConfiguredMessage detects the not-configured wording', () => {
    expect(isNotConfiguredMessage('Second Brain not configured')).toBe(true);
    expect(isNotConfiguredMessage('service unavailable')).toBe(true);
    expect(isNotConfiguredMessage('rate limited')).toBe(false);
  });

  it('isNotConfiguredApiError detects a 503 API error', () => {
    expect(isNotConfiguredApiError({ status: 503, code: 'X', message: 'm' })).toBe(true);
    expect(isNotConfiguredApiError({ status: 500, code: 'X', message: 'm' })).toBe(false);
    expect(isNotConfiguredApiError(new Error('boom'))).toBe(false);
  });
});
