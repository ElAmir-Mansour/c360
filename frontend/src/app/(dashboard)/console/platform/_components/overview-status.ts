import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ShieldCheck,
  Clock,
  ShieldX,
  ShieldAlert,
} from 'lucide-react';
import type { StatusConfig } from '@/lib/status-configs';
import type { MessageKey } from '@/lib/i18n/messages';
import type { CircuitState } from '@/types/platform';

/**
 * StatusBadge configs scoped to the Platform Overview screen. Kept local to the
 * route (not added to the shared lib/status-configs.ts) so this screen owns its
 * tone mapping without touching foundation files. Colors use the StatusBadge
 * palette names ("green" → brand primary, "red"/"orange"/"yellow"/"gray").
 *
 * The configs are exposed as factories that take the active `t` translator so
 * every status label is localized (Arabic-first / RTL). They are built inside a
 * component render (where `useT()` is available), not at module load.
 */

type Translate = (key: MessageKey) => string;

/** Fleet service status (G1: healthy/degraded/unhealthy/unknown). */
export function fleetStatusConfig(t: Translate): StatusConfig {
  return {
    healthy: {
      label: t('platformConsole.status.healthy'),
      color: 'green',
      icon: CheckCircle,
    },
    degraded: {
      label: t('platformConsole.status.degraded'),
      color: 'orange',
      icon: AlertTriangle,
    },
    unhealthy: {
      label: t('platformConsole.status.unhealthy'),
      color: 'red',
      icon: XCircle,
    },
    unknown: {
      label: t('platformConsole.status.unknown'),
      color: 'gray',
      icon: HelpCircle,
    },
  };
}

/** Circuit-breaker state (G1: closed/open/half-open). */
export function circuitStatusConfig(t: Translate): StatusConfig {
  return {
    closed: {
      label: t('platformConsole.overview.breakerClosed'),
      color: 'green',
      icon: ShieldCheck,
    },
    open: {
      label: t('platformConsole.overview.breakerOpen'),
      color: 'red',
      icon: ShieldX,
    },
    'half-open': {
      label: t('platformConsole.overview.breakerHalfOpen'),
      color: 'yellow',
      icon: ShieldAlert,
    },
  };
}

/** Computed license state (server-derived; never recompute client-side). */
export function licenseStateConfig(t: Translate): StatusConfig {
  return {
    active: {
      label: t('platformConsole.overview.licenseActive'),
      color: 'green',
      icon: CheckCircle,
    },
    in_grace: {
      label: t('platformConsole.overview.licenseInGrace'),
      color: 'yellow',
      icon: Clock,
    },
    expired: {
      label: t('platformConsole.overview.licenseExpired'),
      color: 'red',
      icon: XCircle,
    },
    suspended: {
      label: t('platformConsole.overview.licenseSuspended'),
      color: 'gray',
      icon: ShieldX,
    },
  };
}

/** Provisioning lifecycle status. */
export function provisioningStatusConfig(t: Translate): StatusConfig {
  return {
    pending: {
      label: t('platformConsole.overview.provPending'),
      color: 'gray',
      icon: Clock,
    },
    provisioning: {
      label: t('platformConsole.overview.provProvisioning'),
      color: 'blue',
      icon: Clock,
    },
    failed: {
      label: t('platformConsole.overview.provFailed'),
      color: 'red',
      icon: XCircle,
    },
    completed: {
      label: t('platformConsole.overview.provCompleted'),
      color: 'green',
      icon: CheckCircle,
    },
  };
}

/** Severity config for the critical-audit panel (high/critical emphasis). */
export function severityConfig(t: Translate): StatusConfig {
  return {
    critical: {
      label: t('platformConsole.overview.sevCritical'),
      color: 'red',
      icon: ShieldAlert,
    },
    high: {
      label: t('platformConsole.overview.sevHigh'),
      color: 'orange',
      icon: ShieldAlert,
    },
    medium: {
      label: t('platformConsole.overview.sevMedium'),
      color: 'yellow',
      icon: ShieldAlert,
    },
    low: {
      label: t('platformConsole.overview.sevLow'),
      color: 'gray',
      icon: ShieldAlert,
    },
  };
}

/** Per-dependency readiness check status → StatusBadge dot color. */
export function checkDotColor(status: string | null | undefined): string {
  const s = String(status ?? '').toLowerCase();
  if (s === 'ok' || s === 'up' || s === 'healthy' || s === 'pass') return 'green';
  if (s === 'degraded' || s === 'warn' || s === 'warning') return 'orange';
  if (s === 'down' || s === 'fail' || s === 'unhealthy' || s === 'error') return 'red';
  return 'gray';
}

/** Localized label for a per-dependency readiness check status. */
export function checkStatusLabel(t: Translate, status: string): string {
  const color = checkDotColor(status);
  if (color === 'green') return t('platformConsole.status.healthy');
  if (color === 'orange') return t('platformConsole.status.degraded');
  if (color === 'red') return t('platformConsole.status.unhealthy');
  return t('platformConsole.status.unknown');
}

/** Map a circuit-breaker state to a StatusBadge status string (identity, typed). */
export function circuitState(state: CircuitState): string {
  return state;
}
