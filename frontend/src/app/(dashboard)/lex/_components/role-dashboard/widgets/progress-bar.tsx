'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import styles from './progress-bar.module.css';

export type ProgressBarTone = 'critical' | 'high' | 'medium' | 'optimal';
export type ProgressBarSize = 'workload' | 'escalation';

export interface ProgressBarProps {
  label: string;
  value: number;
  max: number;
  tone: ProgressBarTone;
  size?: ProgressBarSize;
}

function visualPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }

  return Math.min(Math.max((value / max) * 100, 0), 100);
}

export function ProgressBar({
  label,
  value,
  max,
  tone,
  size = 'workload',
}: ProgressBarProps) {
  const fillPercent = visualPercent(value, max);
  const accessibleMax = Math.max(max, 0);
  const accessibleValue = Math.min(Math.max(value, 0), accessibleMax);

  return (
    <div
      className={cn(styles.track, size === 'escalation' && styles.escalationSize)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={accessibleMax}
      aria-valuenow={accessibleValue}
      aria-valuetext={label}
      data-value={value}
      data-max={max}
    >
      <div
        className={cn(styles.fill, styles[tone])}
        style={{ inlineSize: `${fillPercent}%` }}
        data-progress-fill=""
      />
    </div>
  );
}

export interface ProgressBarSkeletonProps {
  label: string;
  size?: ProgressBarSize;
}

export function ProgressBarSkeleton({
  label,
  size = 'workload',
}: ProgressBarSkeletonProps) {
  return (
    <Skeleton
      className={cn(
        styles.skeleton,
        size === 'escalation' && styles.skeletonEscalationSize,
      )}
      aria-label={label}
      aria-busy="true"
    />
  );
}
