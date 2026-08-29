import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';

/**
 * @deprecated Use `EmptyState` from `@/components/common/empty-state` with
 * `size="compact"` — the canonical empty-state primitive. This thin adapter
 * keeps the historic `<SectionEmpty>` API compiling.
 */
export interface SectionEmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

/** @deprecated Thin adapter over the canonical `EmptyState` (compact). */
export function SectionEmpty({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: SectionEmptyProps) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={action}
      size="compact"
      className={className}
      {...props}
    />
  );
}
