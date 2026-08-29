import * as React from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Ban,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  StatusBadge,
  statusBadgeVariants,
  type StatusTone,
} from '@/components/shared/status-badge';

/**
 * @deprecated Use `StatusBadge` from `@/components/shared/status-badge` — the
 * canonical status primitive. `StatusPill` remains as a thin adapter that maps
 * the ClarioDR run-state vocabulary onto the canonical tone ramps so the
 * existing DR call sites keep compiling (and now share one visual language).
 */
export type StatusPillStatus =
  | 'running'
  | 'pending'
  | 'passed'
  | 'failed'
  | 'degraded'
  | 'blocked';

/** Run-state → canonical tone (token state ramps). */
const STATUS_TONE: Record<StatusPillStatus, StatusTone> = {
  running: 'info',
  pending: 'neutral',
  passed: 'success',
  failed: 'danger',
  degraded: 'warning',
  blocked: 'warning',
};

/** Per-status icon. `running` spins to signal in-flight execution. */
const STATUS_ICON: Record<StatusPillStatus, LucideIcon> = {
  running: Loader2,
  pending: Clock,
  passed: CheckCircle2,
  failed: XCircle,
  degraded: AlertTriangle,
  blocked: Ban,
};

/** Default English labels — callers SHOULD pass localized `label` for bilingual UI. */
const DEFAULT_LABEL: Record<StatusPillStatus, string> = {
  running: 'Running',
  pending: 'Pending',
  passed: 'Passed',
  failed: 'Failed',
  degraded: 'Degraded',
  blocked: 'Blocked',
};

export interface StatusPillProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The semantic run-state. Drives colour + icon. */
  status: StatusPillStatus;
  /**
   * Visible, localizable label. Defaults to an English fallback for the status.
   * Pass the translated string for bilingual / RTL surfaces.
   */
  label?: React.ReactNode;
  /** Hide the visible text and render an icon-only pill. Requires `aria-label`. */
  iconOnly?: boolean;
  size?: 'sm' | 'md';
}

/** @deprecated Thin adapter over the canonical `StatusBadge`. */
const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  (
    {
      status,
      size = 'md',
      label,
      iconOnly = false,
      className,
      'aria-label': ariaLabel,
      ...props
    },
    ref,
  ) => {
    return (
      <StatusBadge
        ref={ref}
        role="status"
        data-status={status}
        aria-label={iconOnly ? ariaLabel ?? DEFAULT_LABEL[status] : ariaLabel}
        status={status}
        tone={STATUS_TONE[status]}
        label={label ?? DEFAULT_LABEL[status]}
        hideLabel={iconOnly}
        icon={STATUS_ICON[status]}
        iconClassName={cn(
          status === 'running' && 'animate-spin motion-reduce:animate-none',
        )}
        size={size}
        className={cn(
          // Preserve the pill's historic display voice on top of the canonical
          // chrome: token radius + uppercase display type.
          'rounded-pill font-display font-semibold uppercase tracking-widest',
          className,
        )}
        {...props}
      />
    );
  },
);
StatusPill.displayName = 'StatusPill';

/**
 * @deprecated Compat alias — the canonical variants now live on
 * `statusBadgeVariants` (tone/size/appearance) in `shared/status-badge`.
 */
const statusPillVariants = statusBadgeVariants;

export { StatusPill, statusPillVariants };
export default StatusPill;
