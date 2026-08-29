/**
 * Status / mode presentation helpers for the integration sync-run ledger.
 *
 * Builds the `StatusConfig` maps the shared `<StatusBadge>` consumes, keyed by
 * the wire enums from `@/lib/lex/integrations` ({@link SyncRunStatus},
 * {@link SyncMode}). Labels are bilingual at the call site, resolved from the
 * shared `integrationLabels` so this stays consistent with the rest of the
 * console. Module-local so we never touch the shared i18n catalog.
 */
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, GitCompareArrows } from 'lucide-react';
import type { StatusConfig } from '@/lib/status-configs';
import type { SyncRunStatus, SyncMode } from '@/lib/lex/integrations';
import type { IntegrationConsoleLabels } from '../../../_labels';

/** Build the StatusBadge config for sync-run terminal statuses. */
export function syncStatusConfig(t: IntegrationConsoleLabels): StatusConfig {
  return {
    succeeded: { label: t.syncStatusSucceeded, color: 'green', icon: CheckCircle2 },
    partial: { label: t.syncStatusPartial, color: 'yellow', icon: AlertTriangle },
    failed: { label: t.syncStatusFailed, color: 'red', icon: XCircle },
  };
}

/** Build the StatusBadge config for sync modes (full / delta). */
export function syncModeConfig(t: IntegrationConsoleLabels): StatusConfig {
  return {
    full: { label: t.modeFull, color: 'blue', icon: RefreshCw },
    delta: { label: t.modeDelta, color: 'teal', icon: GitCompareArrows },
  };
}

/** Narrowing guard for a wire status that may arrive as an arbitrary string. */
export function normalizeSyncStatus(status: string): SyncRunStatus {
  return status === 'succeeded' || status === 'partial' || status === 'failed'
    ? status
    : 'failed';
}

/** Narrowing guard for a wire mode that may arrive as an arbitrary string. */
export function normalizeSyncMode(mode: string): SyncMode {
  return mode === 'full' ? 'full' : 'delta';
}

/**
 * Human-readable duration between two ISO timestamps. Returns the fallback when
 * either timestamp is missing / unparseable. Sub-second runs render as `<1s`.
 */
export function runDuration(startedAt: string, finishedAt: string, fallback: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return fallback;
  const ms = end - start;
  if (ms < 1000) return '<1s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}
