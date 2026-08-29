/**
 * Streaming transport for background pleading generation.
 *
 * Wire contract:
 *   POST   /legal-cases/{caseId}/pleadings/{pleadingId}/generation
 *   GET    /legal-cases/{caseId}/pleadings/{pleadingId}/generation
 *   GET    /legal-cases/{caseId}/pleadings/{pleadingId}/generation/events
 *   DELETE /legal-cases/{caseId}/pleadings/{pleadingId}/generation
 *   POST   /legal-cases/{caseId}/pleadings/{pleadingId}/generation/retry
 *
 * POST, retry, and the events endpoint return text/event-stream responses.
 * The GET response is the durable snapshot used to restore visible progress
 * after navigation or a dropped stream. Cancelling the browser reader never
 * cancels the server job; only the explicit DELETE action does that.
 */

import { apiDelete } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { getCSRFToken, CSRF_HEADER } from '@/lib/csrf';
import { getApiUrl } from '@/lib/env';
import { LOCALE_COOKIE_NAME } from '@/lib/i18n';
import { fetchSuiteData } from '@/lib/suite-api';
import { getActiveImpersonationToken } from '@/stores/impersonation-store';

const BASE = '/api/v1/lex';

export type PleadingGenerationStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface PleadingGenerationState {
  pleading_id: string;
  job_id?: string | null;
  status: PleadingGenerationStatus;
  progress?: number | null;
  current_section?: string | null;
  body?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  can_retry?: boolean;
  last_event_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface StartPleadingGenerationPayload {
  language: string;
  draft_prompt?: string;
}

export interface PleadingGenerationStartedEvent {
  pleading_id?: string;
  job_id?: string;
  progress?: number;
  message?: string;
}

export interface PleadingGenerationSectionEvent {
  heading?: string;
  section?: string;
  index?: number;
  total?: number;
  progress?: number;
}

export interface PleadingGenerationDeltaEvent {
  text: string;
  progress?: number;
}

export interface PleadingGenerationCompletedEvent {
  pleading_id?: string;
  job_id?: string;
  body?: string;
  progress?: number;
  pleading?: Record<string, unknown>;
}

export interface PleadingGenerationFailedEvent {
  code?: string;
  error?: string;
  message?: string;
  can_retry?: boolean;
}

export interface PleadingGenerationStreamHandlers {
  onSnapshot?: (state: PleadingGenerationState) => void;
  onStarted?: (event: PleadingGenerationStartedEvent) => void;
  onSection?: (event: PleadingGenerationSectionEvent) => void;
  onDelta?: (event: PleadingGenerationDeltaEvent) => void;
  onCompleted?: (event: PleadingGenerationCompletedEvent) => void;
  onFailed?: (event: PleadingGenerationFailedEvent) => void;
  onCancelled?: () => void;
  onEventId?: (eventId: string) => void;
  signal?: AbortSignal;
}

interface GenerationFrame {
  event: string;
  data: string;
  id?: string;
}

function generationPath(caseId: string, pleadingId: string): string {
  return `${BASE}/legal-cases/${encodeURIComponent(caseId)}/pleadings/${encodeURIComponent(pleadingId)}/generation`;
}

function readLocaleCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const row = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE_NAME}=`));
  if (!row) return undefined;
  return decodeURIComponent(row.slice(LOCALE_COOKIE_NAME.length + 1)).trim() || undefined;
}

function streamHeaders(lastEventId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };
  const token = getActiveImpersonationToken() ?? getAccessToken();
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  const csrf = getCSRFToken();
  if (csrf && CSRF_HEADER) headers[CSRF_HEADER] = csrf;
  const locale = readLocaleCookie();
  if (locale) headers['X-Locale'] = locale;
  if (lastEventId) headers['Last-Event-ID'] = lastEventId;
  headers['X-Request-ID'] =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return headers;
}

function parseFrame(raw: string): GenerationFrame | null {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    if (field === 'id') id = value;
    if (field === 'data') data.push(value);
  }

  if (data.length === 0 && event === 'message' && !id) return null;
  return { event, data: data.join('\n'), id };
}

function parseData<T>(frame: GenerationFrame): T {
  if (!frame.data.trim()) return {} as T;
  try {
    return JSON.parse(frame.data) as T;
  } catch {
    return {} as T;
  }
}

function dispatchFrame(
  frame: GenerationFrame,
  handlers: PleadingGenerationStreamHandlers,
): void {
  if (frame.id) handlers.onEventId?.(frame.id);
  switch (frame.event) {
    case 'job':
    case 'snapshot':
      handlers.onSnapshot?.(parseData<PleadingGenerationState>(frame));
      break;
    case 'generation_started':
      handlers.onStarted?.(parseData<PleadingGenerationStartedEvent>(frame));
      break;
    case 'section':
      handlers.onSection?.(parseData<PleadingGenerationSectionEvent>(frame));
      break;
    case 'delta': {
      const event = parseData<Partial<PleadingGenerationDeltaEvent>>(frame);
      if (typeof event.text === 'string') {
        handlers.onDelta?.({ text: event.text, progress: event.progress });
      }
      break;
    }
    case 'generation_completed':
      handlers.onCompleted?.(parseData<PleadingGenerationCompletedEvent>(frame));
      break;
    case 'generation_failed':
      handlers.onFailed?.(parseData<PleadingGenerationFailedEvent>(frame));
      break;
    case 'cancelled':
      handlers.onCancelled?.();
      break;
    default:
      break;
  }
}

export async function readPleadingGenerationStream(
  body: ReadableStream<Uint8Array>,
  handlers: PleadingGenerationStreamHandlers,
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
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const frame = parseFrame(buffer.slice(0, separator));
        buffer = buffer.slice(separator + 2);
        if (frame) dispatchFrame(frame, handlers);
        separator = buffer.indexOf('\n\n');
      }
    }
    const tail = (buffer + decoder.decode()).trim();
    if (tail) {
      const frame = parseFrame(tail);
      if (frame) dispatchFrame(frame, handlers);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The server may have already closed the completed stream.
    }
  }
}

async function streamGeneration(
  url: string,
  payload: StartPleadingGenerationPayload | undefined,
  handlers: PleadingGenerationStreamHandlers,
  lastEventId?: string,
  method: 'GET' | 'POST' = 'POST',
): Promise<void> {
  if (
    typeof fetch !== 'function' ||
    typeof ReadableStream === 'undefined' ||
    typeof TextDecoder === 'undefined'
  ) {
    throw new Error('Streaming is unavailable in this browser.');
  }

  const response = await fetch(`${getApiUrl()}${url}`, {
    method,
    credentials: 'same-origin',
    headers: streamHeaders(lastEventId),
    body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
    signal: handlers.signal,
  });

  if (!response.ok) {
    let message = `Generation request failed with status ${response.status}.`;
    try {
      const payload = (await response.json()) as {
        error?: { message?: string } | string;
        message?: string;
      };
      message =
        (typeof payload.error === 'object' ? payload.error?.message : payload.error) ??
        payload.message ??
        message;
    } catch {
      // Keep the status-derived message when the response is not JSON.
    }
    throw new Error(message);
  }
  if (!response.body) {
    throw new Error('The generation stream did not return a readable body.');
  }
  await readPleadingGenerationStream(response.body, handlers);
}

export function startPleadingGeneration(
  caseId: string,
  pleadingId: string,
  payload: StartPleadingGenerationPayload,
  handlers: PleadingGenerationStreamHandlers,
): Promise<void> {
  return streamGeneration(generationPath(caseId, pleadingId), payload, handlers);
}

export function retryPleadingGeneration(
  caseId: string,
  pleadingId: string,
  handlers: PleadingGenerationStreamHandlers,
  lastEventId?: string,
): Promise<void> {
  return streamGeneration(
    `${generationPath(caseId, pleadingId)}/retry`,
    undefined,
    handlers,
    lastEventId,
  );
}

export function resumePleadingGeneration(
  caseId: string,
  pleadingId: string,
  handlers: PleadingGenerationStreamHandlers,
  lastEventId?: string,
): Promise<void> {
  return streamGeneration(
    `${generationPath(caseId, pleadingId)}/events`,
    undefined,
    handlers,
    lastEventId,
    'GET',
  );
}

export function getPleadingGeneration(
  caseId: string,
  pleadingId: string,
): Promise<PleadingGenerationState> {
  return fetchSuiteData<PleadingGenerationState>(generationPath(caseId, pleadingId));
}

export function cancelPleadingGeneration(
  caseId: string,
  pleadingId: string,
): Promise<void> {
  return apiDelete<void>(generationPath(caseId, pleadingId));
}
