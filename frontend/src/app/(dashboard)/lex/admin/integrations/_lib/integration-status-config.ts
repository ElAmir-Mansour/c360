/**
 * StatusBadge config builders for the admin/integrations console.
 *
 * The shared {@link StatusBadge} primitive renders from a {@link StatusConfig}
 * map ({ [value]: { label, color, icon } }). The wire enums (IntegrationStatus,
 * IntegrationHealthGrade, SyncRunStatus) carry no display copy, so we pair them
 * here with bilingual labels (resolved at the call site) + a token color +
 * a lucide icon. Colors are restricted to the badge `colorMap` keys
 * (red/orange/yellow/green/blue/purple/gray/teal).
 */
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleHelp,
  CircleSlash,
  Clock,
  PauseCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { StatusConfig } from '@/lib/status-configs';
import type {
  IntegrationHealthGrade,
  IntegrationStatus,
  SyncRunStatus,
} from '@/lib/lex/integrations';
import type { IntegrationConsoleLabels } from '../_labels';

type BadgeColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray' | 'teal';

const STATUS_COLOR: Record<IntegrationStatus, BadgeColor> = {
  planned: 'gray',
  active: 'green',
  disabled: 'gray',
  error: 'red',
};

const STATUS_ICON: Record<IntegrationStatus, LucideIcon> = {
  planned: Clock,
  active: CheckCircle2,
  disabled: PauseCircle,
  error: XCircle,
};

/** Build the IntegrationStatus → {label,color,icon} config for the active locale. */
export function buildStatusConfig(t: IntegrationConsoleLabels): StatusConfig {
  return {
    planned: { label: t.statusPlanned, color: STATUS_COLOR.planned, icon: STATUS_ICON.planned },
    active: { label: t.statusActive, color: STATUS_COLOR.active, icon: STATUS_ICON.active },
    disabled: { label: t.statusDisabled, color: STATUS_COLOR.disabled, icon: STATUS_ICON.disabled },
    error: { label: t.statusError, color: STATUS_COLOR.error, icon: STATUS_ICON.error },
  };
}

const GRADE_COLOR: Record<IntegrationHealthGrade, BadgeColor> = {
  healthy: 'green',
  degraded: 'orange',
  down: 'red',
  unconfigured: 'gray',
  disabled: 'gray',
};

const GRADE_ICON: Record<IntegrationHealthGrade, LucideIcon> = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  down: XCircle,
  unconfigured: CircleHelp,
  disabled: CircleSlash,
};

/** Build the IntegrationHealthGrade → {label,color,icon} config. */
export function buildHealthGradeConfig(t: IntegrationConsoleLabels): StatusConfig {
  return {
    healthy: { label: t.gradeHealthy, color: GRADE_COLOR.healthy, icon: GRADE_ICON.healthy },
    degraded: { label: t.gradeDegraded, color: GRADE_COLOR.degraded, icon: GRADE_ICON.degraded },
    down: { label: t.gradeDown, color: GRADE_COLOR.down, icon: GRADE_ICON.down },
    unconfigured: {
      label: t.gradeUnconfigured,
      color: GRADE_COLOR.unconfigured,
      icon: GRADE_ICON.unconfigured,
    },
    disabled: { label: t.gradeDisabled, color: GRADE_COLOR.disabled, icon: GRADE_ICON.disabled },
  };
}

const SYNC_STATUS_COLOR: Record<SyncRunStatus, BadgeColor> = {
  succeeded: 'green',
  partial: 'orange',
  failed: 'red',
};

const SYNC_STATUS_ICON: Record<SyncRunStatus, LucideIcon> = {
  succeeded: CheckCircle2,
  partial: AlertTriangle,
  failed: Ban,
};

/** Build the SyncRunStatus → {label,color,icon} config for the ledger. */
export function buildSyncStatusConfig(t: IntegrationConsoleLabels): StatusConfig {
  return {
    succeeded: {
      label: t.syncStatusSucceeded,
      color: SYNC_STATUS_COLOR.succeeded,
      icon: SYNC_STATUS_ICON.succeeded,
    },
    partial: {
      label: t.syncStatusPartial,
      color: SYNC_STATUS_COLOR.partial,
      icon: SYNC_STATUS_ICON.partial,
    },
    failed: {
      label: t.syncStatusFailed,
      color: SYNC_STATUS_COLOR.failed,
      icon: SYNC_STATUS_ICON.failed,
    },
  };
}

/** Kinds whose connectors expose a Syncer (Sync Now control is meaningful). */
const SYNC_CAPABLE_KINDS = new Set(['najiz', 'hr', 'archiving', 'email', 'internal']);

/** True when the kind's connector supports an on-demand sync. */
export function isSyncCapable(kind: string): boolean {
  return SYNC_CAPABLE_KINDS.has(kind);
}
