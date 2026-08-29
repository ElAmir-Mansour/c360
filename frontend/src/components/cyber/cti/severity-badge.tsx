'use client';

import {
  StatusBadge,
  severityMap,
} from '@/components/shared/status-badge';

/**
 * @deprecated Use `StatusBadge` with `severityMap` from
 * `@/components/shared/status-badge`. This thin adapter keeps the historic
 * `<CTISeverityBadge>` API compiling while rendering the canonical,
 * token-driven severity visual (the old implementation painted hardcoded hex
 * backgrounds that ignored dark mode).
 */
interface SeverityBadgeProps {
  severity: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function CTISeverityBadge({ severity, size = 'md', className }: SeverityBadgeProps) {
  return (
    <StatusBadge
      status={severity}
      map={severityMap}
      size={size}
      className={className}
    />
  );
}
