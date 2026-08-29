import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * @deprecated Use `Skeleton` from `@/components/ui/skeleton` — the shaped
 * variants (`<Skeleton variant="kpi" />`, `<Skeleton.Table rows={8} />`, …)
 * now live on the canonical primitive. `LoadingSkeleton` remains as a thin
 * adapter that preserves the historic wrapper semantics (`count` repetition,
 * composite variants, `role="status"` live region + sr-only label).
 */
export type SkeletonVariant =
  // original (do not remove)
  | 'card'
  | 'table-row'
  | 'list-item'
  | 'text'
  | 'avatar'
  | 'chart'
  // semantic additions
  | 'kpi'
  | 'table'
  | 'list'
  | 'detail'
  | 'form';

interface SkeletonProps {
  variant?: SkeletonVariant;
  count?: number;
  className?: string;
  /** Accessible label announced to screen readers while loading. */
  label?: string;
}

/** @deprecated Thin adapter over the canonical `Skeleton` shaped variants. */
export function LoadingSkeleton({
  variant = 'card',
  count = 1,
  className,
  label = 'Loading…',
}: SkeletonProps) {
  // Composite variants interpret `count` as inner-row count and render once.
  const isComposite =
    variant === 'table' || variant === 'list' || variant === 'form';
  const innerRows = Math.max(1, count);

  // KPI placeholders default to a responsive grid; others stack vertically.
  const containerClass =
    variant === 'kpi'
      ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4'
      : 'space-y-3';

  // Composite variants render a single block; the rest repeat `count` times.
  const blocks = isComposite ? [0] : Array.from({ length: count }, (_, i) => i);

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn(containerClass, className)}
    >
      {blocks.map((idx) => (
        <Skeleton key={idx} variant={variant} rows={innerRows} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
