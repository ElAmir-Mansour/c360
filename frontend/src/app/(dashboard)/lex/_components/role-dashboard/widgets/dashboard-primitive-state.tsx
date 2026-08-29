'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { FeedbackState } from '@/components/shared/feedback-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The dashboard's non-ready presentation states.
 *
 * A numeric zero is intentionally absent: zero is valid, ready dashboard data
 * and must be rendered by the owning primitive rather than treated as empty.
 * Every string is supplied by the caller after locale resolution.
 */
export type DashboardPrimitiveStateProps =
  | {
      state: 'loading';
      label: string;
      className?: string;
    }
  | {
      state: 'empty';
      title: string;
      description?: string;
      className?: string;
    }
  | {
      state: 'error';
      title: string;
      description?: string;
      retryLabel: string;
      onRetry: () => void;
      className?: string;
    };

/**
 * Shared loading, empty, and retryable-error treatment for dashboard widgets.
 * Ready content, including zero values, bypasses this component.
 */
export function DashboardPrimitiveState(props: DashboardPrimitiveStateProps) {
  if (props.state === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label={props.label}
        className={cn(
          'flex min-h-32 flex-col items-center justify-center gap-3 px-6 py-8',
          props.className,
        )}
      >
        <Skeleton
          className="h-10 w-10 rounded-[var(--wt-radius-pill)] bg-[var(--wt-track)]"
          aria-hidden="true"
        />
        <div className="flex w-full max-w-xs flex-col items-center gap-2" aria-hidden="true">
          <Skeleton className="h-4 w-2/5 bg-[var(--wt-track)]" />
          <Skeleton className="h-3 w-3/5 bg-[var(--wt-track)]" />
        </div>
        <span className="sr-only">{props.label}</span>
      </div>
    );
  }

  if (props.state === 'empty') {
    return (
      <FeedbackState
        tone="empty"
        size="compact"
        role="status"
        aria-live="polite"
        title={props.title}
        description={props.description}
        className={props.className}
      />
    );
  }

  return (
    <FeedbackState
      tone="error"
      size="compact"
      title={props.title}
      description={props.description}
      action={{
        label: props.retryLabel,
        onClick: props.onRetry,
        icon: RefreshCw,
      }}
      className={cn(
        '[&_button]:bg-[var(--wt-teal-700)] [&_button]:text-[color:var(--wt-surface)] [&_button]:shadow-none',
        '[&_button:hover]:bg-[var(--wt-teal-900)] [&_button:focus-visible]:ring-[color:var(--wt-teal-700)]',
        props.className,
      )}
    />
  );
}
