/**
 * Typed HTTP client for the Watheeq (Lex) legal AI assistant — the backend of
 * the Legal Director dashboard's "My AI Agent" panel (LEX-LD-GAP-DESIGN §G4):
 *
 *   POST /api/v1/lex/ai/chat            → one grounded turn
 *   GET  /api/v1/lex/ai/sessions        → the caller's recent conversations
 *   GET  /api/v1/lex/ai/sessions/{id}   → one conversation's full transcript
 *
 * Every response uses the standard suite `{ data }` envelope, so the reads ride
 * `fetchSuiteData` and the write rides `apiPost` — the same authenticated axios
 * pipeline (Bearer token, CSRF, 401 refresh) as every other lex client.
 *
 * Field names mirror `internal/lex/ai/model.go` verbatim instead of being
 * camel-cased, matching `reports.ts` and the DR copilot types. A transcript is
 * an audit record, and a record that renames its own fields on the way through
 * the client is harder to reconcile with the server's copy of it.
 *
 * TWO GATES, ONE SIGNAL. The assistant is feature-flagged off by default
 * (`LEX_AI_ENABLED`) and, when off, `lex/handler/routes.go` does not mount
 * `/ai/*` AT ALL — so a deployment without the assistant answers 404 rather
 * than 503. A caller without the dedicated `lex:ai:use` permission answers 403.
 * Neither is a failure of anything the caller asked for, which is why
 * {@link isLexAiSurfaceAbsent} exists: it is the only signal the frontend gets,
 * and the panel is expected to disappear on it rather than report an error.
 */

import { apiPost } from '@/lib/api';
import { fetchSuiteData } from '@/lib/suite-api';
import { isApiError } from '@/types/api';

/** Base path for the Lex assistant surface. */
const LEX_AI_BASE = '/api/v1/lex/ai';

/**
 * One assistant conversation. Sessions are keyed server-side by
 * `(tenant_id, user_id)`: a legal director never sees another user's transcript.
 */
export interface LexAiSession {
  id: string;
  title: string;
  provider: string;
  model: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * The audited record of one grounding-tool invocation — which real, already
 * permitted legal data the model read to answer a turn.
 */
export interface LexAiToolCall {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  success: boolean;
  result_summary: string;
}

/**
 * One persisted turn. `tool` rows carry a single tool's JSON result rather than
 * operator-facing prose, which is why the role is widened beyond user/assistant.
 */
export interface LexAiMessage {
  id: string;
  session_id: string;
  seq: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_call_id?: string;
  tool_calls?: LexAiToolCall[];
  latency_ms: number;
  created_at: string;
}

/** The caller's recent conversations, newest first (the chat rail). */
export interface LexAiSessionList {
  sessions: LexAiSession[];
}

/** One conversation's full transcript, oldest turn first. */
export interface LexAiSessionTranscript {
  session: LexAiSession;
  messages: LexAiMessage[];
}

/** The result of a single `POST /ai/chat` turn. */
export interface LexAiChatResult {
  session_id: string;
  message_id: string;
  answer: string;
  tool_calls?: LexAiToolCall[];
  provider: string;
  model: string;
  latency_ms: number;
  /** Model round-trips this turn consumed (1 = answered without reading a tool). */
  iterations: number;
}

export interface LexAiChatRequest {
  /** Omit to open a new conversation; the server mints and returns the id. */
  session_id?: string;
  message: string;
}

/**
 * Fetch the caller's recent conversations. `limit` is optional; the server
 * applies its own default and ceiling, so an unbounded call is safe.
 */
export async function listLexAiSessions(limit?: number): Promise<LexAiSessionList> {
  return fetchSuiteData<LexAiSessionList>(
    `${LEX_AI_BASE}/sessions`,
    limit === undefined ? undefined : { limit },
  );
}

/** Fetch one conversation's full transcript. */
export async function getLexAiSession(sessionId: string): Promise<LexAiSessionTranscript> {
  return fetchSuiteData<LexAiSessionTranscript>(
    `${LEX_AI_BASE}/sessions/${encodeURIComponent(sessionId)}`,
  );
}

/**
 * Ask one grounded question. `apiPost` resolves to the axios body — the suite
 * `{ data }` envelope — so unwrap one more level, exactly as `switchLexPersona`
 * does for the persona endpoint.
 */
export async function askLexAi(request: LexAiChatRequest): Promise<LexAiChatResult> {
  const body: LexAiChatRequest = { message: request.message };
  if (request.session_id) body.session_id = request.session_id;
  const envelope = await apiPost<{ data: LexAiChatResult }>(`${LEX_AI_BASE}/chat`, body);
  return envelope.data;
}

/**
 * True when this deployment has no assistant for this caller — either the
 * feature flag is off (the routes are not mounted, so 404) or the caller does
 * not hold `lex:ai:use` (403). Both are configuration, not failure: the caller
 * asked for a dashboard, not for an assistant, so the band is removed rather
 * than replaced with an error.
 *
 * A network outage reports `status: 0` and is deliberately NOT absorbed here —
 * that is a real, retryable failure of a surface the deployment does have.
 */
export function isLexAiSurfaceAbsent(error: unknown): boolean {
  return isApiError(error) && (error.status === 404 || error.status === 403);
}

/**
 * True when the environment wired no LLM provider key. Like the DR copilot's
 * 503, this is an intentional state of the deployment rather than a fault, so
 * it reads as a calm notice instead of a retry prompt.
 */
export function isLexAiProviderOffline(error: unknown): boolean {
  return isApiError(error) && (error.status === 503 || error.code === 'AI_UNAVAILABLE');
}

/**
 * True when the model's own safety classifiers declined the request. It is a
 * content outcome, not a transport failure, and the backend surfaces it as 422
 * precisely so it is not reported as a server error.
 */
export function isLexAiRefusal(error: unknown): boolean {
  return isApiError(error) && (error.status === 422 || error.code === 'AI_REFUSED');
}

/**
 * True when the caller holds `lex:ai:use` but can read no legal domain, so
 * there is nothing to ground an answer on. The backend refuses rather than let
 * the model answer from its own priors — a distinction worth showing the user.
 *
 * Only meaningful on a chat turn: the same 403 on the session probe means the
 * caller lacks `lex:ai:use` entirely, which {@link isLexAiSurfaceAbsent}
 * already resolves before a turn can be sent.
 */
export function isLexAiUngrounded(error: unknown): boolean {
  return isApiError(error) && error.status === 403;
}
