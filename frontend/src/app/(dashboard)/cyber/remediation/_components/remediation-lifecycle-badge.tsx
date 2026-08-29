'use client';

import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import type { RemediationStatus } from '@/types/cyber';
import { useRemediationLabels } from '../_lib/remediation-i18n';

/**
 * Remediation lifecycle status → canonical StatusBadge tone. Delegates to the
 * shared StatusBadge so the lifecycle chip shares one token-driven visual
 * language with every other status/severity pill (no bespoke hex/palette
 * classes). In-flight states pulse.
 */
const STATUS_TONE: Record<RemediationStatus, { tone: StatusTone; pulse?: boolean }> = {
  draft: { tone: 'neutral' },
  pending_approval: { tone: 'warning' },
  approved: { tone: 'info' },
  rejected: { tone: 'danger' },
  revision_requested: { tone: 'warning' },
  dry_run_running: { tone: 'pending', pulse: true },
  dry_run_completed: { tone: 'pending' },
  dry_run_failed: { tone: 'danger' },
  execution_pending: { tone: 'info' },
  executing: { tone: 'info', pulse: true },
  executed: { tone: 'teal' },
  execution_failed: { tone: 'danger' },
  verification_pending: { tone: 'teal', pulse: true },
  verified: { tone: 'primary' },
  verification_failed: { tone: 'danger' },
  rollback_pending: { tone: 'warning' },
  rolling_back: { tone: 'warning', pulse: true },
  rolled_back: { tone: 'neutral' },
  rollback_failed: { tone: 'danger' },
  closed: { tone: 'primary' },
};

interface RemediationLifecycleBadgeProps {
  status: RemediationStatus;
  className?: string;
}

export function RemediationLifecycleBadge({ status, className }: RemediationLifecycleBadgeProps) {
  const t = useRemediationLabels();
  const config = STATUS_TONE[status] ?? { tone: 'neutral' as StatusTone };
  const label = t.lifecycleStatus[status] ?? status;
  return (
    <StatusBadge
      status={status}
      tone={config.tone}
      label={label}
      icon={null}
      size="sm"
      className={config.pulse ? `motion-safe:animate-pulse ${className ?? ''}` : className}
    />
  );
}
