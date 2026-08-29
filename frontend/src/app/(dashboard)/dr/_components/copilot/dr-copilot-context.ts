/**
 * Prompt-grounding helpers for the console-wide DR Copilot.
 *
 * The real chat wire contract (`DRCopilotChatRequest` in `@/types/clario-dr`) is
 * `{ session_id?: string | null; message: string }` — there is NO group/stream
 * field on the request, so the only way to ground a prompt in the operator's
 * current console selection is to PREFIX the typed message with a compact,
 * machine-parseable context block (the same approach `dr-copilot-commands.tsx`
 * uses for its canned operator prompts). We do NOT invent payload fields.
 *
 * Kept React-free so it can be unit-tested and reused by the launcher, the panel,
 * and the war-room embed without pulling in client-only imports.
 */

/** The slice of the live console selection a copilot turn can be grounded in. */
export interface DRCopilotGrounding {
  /** Active protection-group id (`?group=` ?? first posture group). */
  groupId: string | null;
  /** Human group name, when the posture/summary resolves one. */
  groupName: string | null;
  /** Active replication-stream id (`?stream=` ?? derived workbench stream). */
  streamId: string | null;
  /** Active recovery-run id when the panel is embedded in a war room. */
  runId?: string | null;
  /** The console route the operator is currently on (for situational answers). */
  route?: string | null;
}

/**
 * Render the grounding as a short, labelled block. Only includes the fields that
 * actually resolve, so an empty selection produces no noise. Returns an empty
 * string when nothing is selected (the caller then sends the bare message).
 */
export function formatDRCopilotGrounding(grounding: DRCopilotGrounding): string {
  const lines: string[] = [];

  if (grounding.groupName || grounding.groupId) {
    const name = grounding.groupName ?? 'unnamed';
    lines.push(grounding.groupId ? `Group: ${name} (${grounding.groupId})` : `Group: ${name}`);
  }
  if (grounding.streamId) {
    lines.push(`Stream: ${grounding.streamId}`);
  }
  if (grounding.runId) {
    lines.push(`Active recovery run: ${grounding.runId}`);
  }
  if (grounding.route) {
    lines.push(`Console route: ${grounding.route}`);
  }

  return lines.join('\n');
}

/**
 * Combine the operator's typed message with the resolved console context so the
 * copilot answers against the right group/stream/run. The user's words always
 * lead; the context is appended under a clearly delimited header so the model can
 * separate intent from situational facts. When nothing is selected the message
 * is returned verbatim (trimmed).
 */
export function buildGroundedDRCopilotMessage(
  message: string,
  grounding: DRCopilotGrounding,
): string {
  const trimmed = message.trim();
  const context = formatDRCopilotGrounding(grounding);
  if (!context) return trimmed;
  return `${trimmed}\n\n--- Current ClarioDR console context ---\n${context}`;
}
