import { CheckCircle, Clock, AlertTriangle, Ban, FileEdit } from 'lucide-react';
import type { StatusConfig } from '@/lib/status-configs';
import type { MessageKey } from '@/lib/i18n/messages';

type Translate = (key: MessageKey) => string;

/**
 * StatusBadge config for the *server-computed* license state
 * (active | in_grace | expired | suspended) returned by TenantLicense.State()
 * (backend model.go:93). The client NEVER recomputes this — it only renders the
 * server string through this config (spec §E.4).
 *
 * Built as a factory so the human-readable labels are localized via useT(); the
 * color/icon mapping is locale-independent.
 */
export function licenseStateConfig(t: Translate): StatusConfig {
  return {
    active: { label: t('platformConsole.licensing.stateActive'), color: 'green', icon: CheckCircle },
    in_grace: { label: t('platformConsole.licensing.stateInGrace'), color: 'yellow', icon: Clock },
    expired: { label: t('platformConsole.licensing.stateExpired'), color: 'red', icon: AlertTriangle },
    suspended: { label: t('platformConsole.licensing.stateSuspended'), color: 'gray', icon: Ban },
  };
}

/** StatusBadge config for plan lifecycle status (active | retired | draft). */
export function planStatusConfig(t: Translate): StatusConfig {
  return {
    active: { label: t('platformConsole.licensing.stateActive'), color: 'green', icon: CheckCircle },
    retired: { label: t('platformConsole.licensing.planRetired'), color: 'gray', icon: Ban },
    draft: { label: t('platformConsole.licensing.planDraft'), color: 'gray', icon: FileEdit },
  };
}

/** Format a limit value for display: null/undefined == unlimited, 0 == revoked. */
export function formatLimit(limit: number | null | undefined, t: Translate): string {
  if (limit === null || limit === undefined) return t('platformConsole.licensing.unlimited');
  if (limit === 0) return t('platformConsole.licensing.revoked');
  return limit.toLocaleString();
}

/** Format a byte count or plain seat usage as "used / limit". */
export function formatSeats(used?: number, limit?: number | null): string {
  const u = used ?? 0;
  if (limit === null || limit === undefined) return `${u.toLocaleString()} / ∞`;
  return `${u.toLocaleString()} / ${limit.toLocaleString()}`;
}

/** True when seat usage meets or exceeds the limit (over-allocated). */
export function isOverSeats(used?: number, limit?: number | null): boolean {
  if (limit === null || limit === undefined || limit <= 0) return false;
  return (used ?? 0) >= limit;
}
