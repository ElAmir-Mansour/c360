import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSkeleton, type SkeletonVariant } from '@/components/common/loading-skeleton';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Header-end actions (buttons, menus). Sits opposite the title block. */
  actions?: React.ReactNode;
  /**
   * Secondary header row rendered BELOW the title/actions row — e.g. a filter
   * bar, segmented control, or search field. Kept distinct from `actions` so
   * the title row stays compact while toolbars get full width.
   */
  headerToolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  /**
   * Loading state. When true the body is replaced with a token-driven
   * `LoadingSkeleton` (header stays visible) so the section keeps its shape.
   */
  isLoading?: boolean;
  /** Skeleton variant used while `isLoading`. Defaults to `'list'`. */
  loadingVariant?: SkeletonVariant;
  /** Number of skeleton rows/blocks while `isLoading`. Defaults to `3`. */
  loadingCount?: number;
  /**
   * Empty state. When true (and not loading) the body is replaced with
   * `emptyState`. Pass an `<EmptyState … />` node, or rely on nothing rendering.
   */
  isEmpty?: boolean;
  /** Content rendered in the body when `isEmpty` (typically an `EmptyState`). */
  emptyState?: React.ReactNode;
}

export function SectionCard({
  title,
  description,
  actions,
  headerToolbar,
  children,
  className,
  contentClassName,
  isLoading = false,
  loadingVariant = 'list',
  loadingCount = 3,
  isEmpty = false,
  emptyState,
}: SectionCardProps) {
  // Body resolution: loading > empty > children. Loading wins so a refetch over
  // an empty result still shows the skeleton rather than the empty state.
  let body: React.ReactNode = children;
  if (isLoading) {
    body = (
      <LoadingSkeleton variant={loadingVariant} count={loadingCount} />
    );
  } else if (isEmpty) {
    body = emptyState ?? null;
  }

  return (
    <Card className={className}>
      <CardHeader
        className={cn(
          'space-y-0',
          // Only add the toolbar gap when a toolbar is present.
          headerToolbar && 'gap-4',
        )}
      >
        <div className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {headerToolbar ? <div className="w-full">{headerToolbar}</div> : null}
      </CardHeader>
      <CardContent className={cn('pt-0', contentClassName)}>{body}</CardContent>
    </Card>
  );
}
