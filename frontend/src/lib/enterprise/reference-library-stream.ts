/**
 * "Ask the Library" (Second Brain) streaming transport.
 *
 * Consumes the real Server-Sent-Events stream exposed by
 * `POST /api/v1/lex/reference-library/ask/stream` and hands each decoded frame
 * to a set of callbacks. The wire is the canonical SSE framing
 * (`event: <name>\ndata: <json>\n\n`, media type `text/event-stream`):
 *
 *   event: meta       {refused?, cached?, sources?}
 *   event: token      {text}                       ← appended live to the answer
 *   event: citations  {citations:[…], model?, latency_ms?}
 *   event: error      {error}                       ← graceful failure
 *   event: done       {}                            ← finalise the turn
 *
 * This module is transport-only and holds NO React state; the conversation hook
 * ({@link useAskConversation}) maps these callbacks onto its reducer. It is also
 * deliberately free of any auth/env/axios wiring so it stays trivially unit
 * testable against a mocked {@link ReadableStream} of SSE frames — the caller in
 * `api.ts` builds the authenticated `fetch` and passes us the response body.
 */

import { isApiError } from '@/types/api';
import type {
  LexReferenceAskCitation,
  LexReferenceAskResponse,
} from '@/types/suites';

/** `event: meta` payload — early hints emitted before the answer streams. */
export interface AskStreamMeta {
  refused?: boolean;
  cached?: boolean;
  /** Retrieved sources, surfaced as citation chips before the answer completes. */
  sources?: LexReferenceAskCitation[];
}

/** `event: citations` payload — the authoritative citation set + model line. */
export interface AskStreamCitations {
  citations: LexReferenceAskCitation[];
  model?: string;
  latency_ms?: number;
}

/** Normalised error handed to {@link AskStreamHandlers.onError}. */
export interface AskStreamError {
  message: string;
  /** True when the failure means the Second-Brain service is not enabled (503). */
  notConfigured: boolean;
}

/** Callbacks driven by the decoded SSE stream (and the non-stream fallback). */
export interface AskStreamHandlers {
  onMeta?: (meta: AskStreamMeta) => void;
  onToken?: (text: string) => void;
  /**
   * Terminal structured payload for a streamed generation (e.g. the assembled
   * clause object after its text streamed as tokens). Drafting uses this.
   */
  onClause?: (clause: Record<string, unknown>) => void;
  onCitations?: (citations: AskStreamCitations) => void;
  onError?: (error: AskStreamError) => void;
  onDone?: () => void;
  /** Aborts an in-flight stream (user pressed "Stop", or the panel unmounted). */
  signal?: AbortSignal;
}

/** A single parsed SSE frame. */
export interface SSEFrame {
  event: string;
  data: string;
}

// ── SSE frame parsing ────────────────────────────────────────────────────────

/**
 * Parse one raw SSE frame (the text between two blank-line separators) into its
 * `event`/`data` fields per the EventStream grammar. Multiple `data:` lines are
 * joined with `\n`; a leading space after the field colon is stripped. Returns
 * null for comment-only / empty frames (nothing to dispatch).
 */
export function parseSSEFrame(raw: string): SSEFrame | null {
  let event = 'message';
  const dataLines: string[] = [];
  let sawData = false;

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '' || line.startsWith(':')) continue; // blank / comment
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      dataLines.push(value);
      sawData = true;
    }
  }

  if (!sawData && event === 'message') return null;
  return { event, data: dataLines.join('\n') };
}

function safeJsonParse<T>(data: string): T | null {
  const trimmed = data.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

/** Detect the "Second Brain not configured / unavailable" class of message. */
export function isNotConfiguredMessage(message: string): boolean {
  return /second[\s-]?brain|not[\s-]?configured|not[\s-]?enabled|unavailable|503/i.test(
    message,
  );
}

/** True when a thrown API error means the Second-Brain service is not enabled. */
export function isNotConfiguredApiError(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.status === 503 ||
      error.code === 'NOT_CONFIGURED' ||
      error.code === 'SERVICE_UNAVAILABLE')
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Route a decoded frame to the matching handler. Exported for unit tests. */
export function dispatchSSEFrame(
  frame: SSEFrame,
  handlers: AskStreamHandlers,
): void {
  switch (frame.event) {
    case 'meta': {
      const meta = safeJsonParse<AskStreamMeta>(frame.data);
      if (meta) handlers.onMeta?.(meta);
      break;
    }
    case 'token': {
      const payload = safeJsonParse<{ text?: string }>(frame.data);
      if (payload && typeof payload.text === 'string' && payload.text.length > 0) {
        handlers.onToken?.(payload.text);
      }
      break;
    }
    case 'citations': {
      const payload = safeJsonParse<AskStreamCitations>(frame.data);
      handlers.onCitations?.({
        citations: payload?.citations ?? [],
        model: payload?.model,
        latency_ms: payload?.latency_ms,
      });
      break;
    }
    case 'clause': {
      const clause = safeJsonParse<Record<string, unknown>>(frame.data);
      if (clause) handlers.onClause?.(clause);
      break;
    }
    case 'error': {
      const payload = safeJsonParse<{ error?: string }>(frame.data);
      const message = payload?.error ?? '';
      handlers.onError?.({
        message,
        notConfigured: isNotConfiguredMessage(message),
      });
      break;
    }
    case 'done': {
      handlers.onDone?.();
      break;
    }
    default:
      break;
  }
}

// ── Stream reader ─────────────────────────────────────────────────────────────

/**
 * Read an SSE response body to completion, decoding UTF-8 chunks, buffering on
 * the blank-line frame separator and dispatching each frame to {@link handlers}.
 * Honours `handlers.signal` for client-side abort (releases the reader lock).
 */
export async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  handlers: AskStreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    for (;;) {
      if (handlers.signal?.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      // Normalise CRLF → LF so frames separated by either \n\n or \r\n\r\n split
      // uniformly; per-line trailing \r is also stripped in parseSSEFrame.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r\n/g,
        '\n',
      );
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const frame = parseSSEFrame(raw);
        if (frame) dispatchSSEFrame(frame, handlers);
      }
    }
    // Flush any trailing frame that arrived without a terminating blank line.
    const tail = (buffer + decoder.decode()).trim();
    if (tail) {
      const frame = parseSSEFrame(tail);
      if (frame) dispatchSSEFrame(frame, handlers);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Reader already released / stream already closed — nothing to do.
    }
  }
}

// ── Non-streaming fallback (endpoint not deployed / no streaming) ─────────────

/** Split into word+trailing-whitespace chunks for a natural typewriter cadence. */
export function splitIntoChunks(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Fallback path used when the streaming endpoint is not deployed (404/405), the
 * browser can't stream, or the initial request errors at the network layer: call
 * the non-streaming `ask()` and REPLAY its real answer through the same handlers
 * with a typewriter reveal, so the panel behaves identically. Nothing is
 * fabricated — the tokens are the model's actual words and citations/model/
 * latency are the server's real values.
 */
export async function streamFallback(
  ask: () => Promise<LexReferenceAskResponse>,
  handlers: AskStreamHandlers,
  chunkDelayMs = 16,
): Promise<void> {
  let response: LexReferenceAskResponse;
  try {
    response = await ask();
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (isNotConfiguredApiError(error)) {
      handlers.onError?.({
        message: isApiError(error) ? error.message : '',
        notConfigured: true,
      });
      return;
    }
    handlers.onError?.({
      message: isApiError(error) ? error.message : 'ask_failed',
      notConfigured: false,
    });
    return;
  }

  for (const chunk of splitIntoChunks(response.answer ?? '')) {
    if (handlers.signal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    handlers.onToken?.(chunk);
    await sleep(chunkDelayMs, handlers.signal);
  }
  handlers.onCitations?.({
    citations: response.citations ?? [],
    model: response.model,
    latency_ms: response.latency_ms,
  });
  handlers.onDone?.();
}
