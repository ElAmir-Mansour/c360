import type { Investigation } from '@/lib/lex/investigations';

export const INVESTIGATION_WORKSPACE_VALUES = [
  'fraud',
  'compliance',
  'forensics',
  'board',
] as const;

export type InvestigationWorkspace = (typeof INVESTIGATION_WORKSPACE_VALUES)[number];

const WORKSPACE_ALIASES: Record<InvestigationWorkspace, ReadonlySet<string>> = {
  fraud: new Set(['fraud', 'internalfraud', 'financialfraud', 'corporatefraud']),
  compliance: new Set(['compliance', 'audit', 'complianceaudit', 'regulatoryaudit']),
  forensics: new Set(['forensics', 'forensic', 'digitalforensics', 'digitalforensic']),
  board: new Set(['board', 'boardreview', 'governance', 'governancereview']),
};

const BOARD_REVIEW_STATUSES = new Set<Investigation['status']>([
  'results_recorded',
  'pending_approval',
  'approved',
  'closed',
]);

function normalizeWorkspaceToken(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
    : '';
}

export function parseInvestigationWorkspace(
  value: string | null | undefined,
): InvestigationWorkspace | null {
  const token = normalizeWorkspaceToken(value);
  return (
    INVESTIGATION_WORKSPACE_VALUES.find((workspace) =>
      WORKSPACE_ALIASES[workspace].has(token),
    ) ?? null
  );
}

export function investigationWorkspace(
  investigation: Pick<Investigation, 'metadata'>,
): InvestigationWorkspace | null {
  const metadata = investigation.metadata;
  if (!metadata) return null;

  for (const key of ['workspace', 'investigation_workspace', 'investigation_type', 'type']) {
    const workspace = parseInvestigationWorkspace(
      typeof metadata[key] === 'string' ? metadata[key] : null,
    );
    if (workspace) return workspace;
  }
  return null;
}

/**
 * Category workspaces are metadata-scoped. Board review is intentionally a
 * cross-workspace governance queue, so records at a reviewable lifecycle state
 * also appear there. Explicitly board-tagged intake remains visible before it
 * reaches the review stage.
 */
export function investigationBelongsToWorkspace(
  investigation: Pick<Investigation, 'metadata' | 'status'>,
  workspace: InvestigationWorkspace,
): boolean {
  const taggedWorkspace = investigationWorkspace(investigation);
  if (workspace === 'board') {
    return taggedWorkspace === 'board' || BOARD_REVIEW_STATUSES.has(investigation.status);
  }
  return taggedWorkspace === workspace;
}

export function scopeInvestigationsToWorkspace<T extends Pick<Investigation, 'metadata' | 'status'>>(
  investigations: T[],
  workspace: InvestigationWorkspace,
): T[] {
  return investigations.filter((investigation) =>
    investigationBelongsToWorkspace(investigation, workspace),
  );
}

export function withInvestigationWorkspaceMetadata(
  existing: Record<string, unknown> | null | undefined,
  workspace: InvestigationWorkspace | null | undefined,
): Record<string, unknown> {
  if (!workspace) return { ...(existing ?? {}) };
  return {
    ...(existing ?? {}),
    workspace,
    investigation_type: workspace,
  };
}
