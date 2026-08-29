/**
 * CAP-110 — clause-comment fe-client.
 *
 * Per-cap data layer for the clause collaboration thread. Talks directly to the
 * lex gateway (`/api/v1/lex/...`) via the shared `apiGet/apiPost/apiPut/apiDelete`
 * helpers and unwraps the `{ data }` envelope inline — deliberately NOT routed
 * through the shared enterprise/suites client so this cap stays self-contained.
 *
 * `author_name` is derived server-side from the JWT — the client NEVER sends it.
 * Add/update payloads carry only `{ body, mentions }` (mentions parsed from the
 * body's `@handle` tokens); `parent_comment_id` threads a reply.
 */

import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';

const BASE = '/api/v1/lex';

/** A JSON object (comment metadata), mirroring the shared JsonObject shape. */
export type ClauseCommentMetadata = Record<string, unknown>;

/** A persisted clause collaboration note (mirrors backend ContractClauseComment). */
export interface ClauseComment {
  id: string;
  tenant_id: string;
  contract_id: string;
  clause_id: string;
  parent_comment_id?: string | null;
  body: string;
  mentions: string[];
  metadata: ClauseCommentMetadata | null;
  author_user_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface ClauseCommentWritePayload {
  body: string;
  mentions: string[];
  parent_comment_id?: string;
}

/** Build the comments collection endpoint for a clause. */
function commentsEndpoint(contractId: string, clauseId: string): string {
  return `${BASE}/contracts/${contractId}/clauses/${clauseId}/comments`;
}

export const clauseCommentsApi = {
  list: (contractId: string, clauseId: string): Promise<ClauseComment[]> =>
    apiGet<{ data: ClauseComment[] }>(commentsEndpoint(contractId, clauseId)).then(
      (res) => res.data ?? [],
    ),

  add: (
    contractId: string,
    clauseId: string,
    payload: ClauseCommentWritePayload,
  ): Promise<ClauseComment> =>
    apiPost<{ data: ClauseComment }>(commentsEndpoint(contractId, clauseId), payload).then(
      (res) => res.data,
    ),

  update: (
    contractId: string,
    clauseId: string,
    commentId: string,
    payload: ClauseCommentWritePayload,
  ): Promise<ClauseComment> =>
    apiPut<{ data: ClauseComment }>(
      `${commentsEndpoint(contractId, clauseId)}/${commentId}`,
      payload,
    ).then((res) => res.data),

  remove: (contractId: string, clauseId: string, commentId: string): Promise<void> =>
    apiDelete<void>(`${commentsEndpoint(contractId, clauseId)}/${commentId}`),
};
