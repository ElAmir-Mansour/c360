// Human-readable labels for the Recover "Prove" surface (Prompt 10).
//
// Display text resolves through the 'recover' i18n namespace: callers pass the
// translator from `useRecoverT()` so labels localize (en/ar). The numeric/date
// formatters below stay pure.

/** A minimal translator shape (the namespaced translator from `useRecoverT`). */
type Translate = (key: string) => string;

/** Maps a sub-solution slug to its localized display label. */
export function subSolutionLabel(t: Translate, slug: string): string {
  switch (slug) {
    case 'it_dr':
      return t('prove.subItDr');
    case 'cloud_dr':
      return t('prove.subCloudDr');
    case 'cyber_recovery':
      return t('prove.subCyberRecovery');
    default:
      return slug || t('prove.subFallback');
  }
}

/** Maps an audit action verb to its localized key. */
const ACTION_KEYS: Record<string, string> = {
  'runbook.run.started': 'prove.actRunbookStarted',
  'runbook.run.completed': 'prove.actRunbookCompleted',
  'runbook.run.failed': 'prove.actRunbookFailed',
  'runbook.edited.live': 'prove.actRunbookEditedLive',
  'rehearsal.started': 'prove.actRehearsalStarted',
  'rehearsal.completed': 'prove.actRehearsalCompleted',
  'failover.executed': 'prove.actFailoverExecuted',
  'cyber.clean_point.selected': 'prove.actCleanPointSelected',
  'cyber.target.provisioned': 'prove.actTargetProvisioned',
  'cyber.recovery.run': 'prove.actRecoveryRun',
  'cyber.integrity.evaluated': 'prove.actIntegrityEvaluated',
  'cyber.approval.requested': 'prove.actApprovalRequested',
  'cyber.approval.granted': 'prove.actApprovalGranted',
  'cyber.return_to_production': 'prove.actReturnedToProduction',
  'cyber.flow.aborted': 'prove.actFlowAborted',
};

/** A short, readable phrase for an audit action verb. */
export function actionLabel(t: Translate, action: string): string {
  const key = ACTION_KEYS[action];
  return key ? t(key) : action;
}

/** Formats a seconds count as a compact h/m/s label. */
export function formatSeconds(s: number | undefined | null): string {
  if (s === undefined || s === null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Formats an ISO timestamp for the timeline / tables (local, second precision). */
export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
