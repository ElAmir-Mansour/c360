'use client';

import { useRealtimeData } from '@/hooks/use-realtime-data';
import { API_ENDPOINTS } from '@/lib/constants';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExposureScore } from '@/types/cyber';
import { useCtemLabels } from '../_lib/ctem-i18n';

// Exposure grade ramp — token-driven so ring/ink/surface re-theme in dark mode.
const GRADE_CONFIG: Record<string, { color: string; ring: string; bg: string }> = {
  A: { color: 'text-primary', ring: 'stroke-status-success', bg: 'bg-primary/10' },
  B: { color: 'text-status-info', ring: 'stroke-status-info', bg: 'bg-status-info/10' },
  C: { color: 'text-warning-700 dark:text-warning-300', ring: 'stroke-status-warning', bg: 'bg-status-warning/10' },
  D: { color: 'text-severity-high', ring: 'stroke-severity-high', bg: 'bg-severity-high/10' },
  F: { color: 'text-status-error', ring: 'stroke-status-error', bg: 'bg-status-error/10' },
};

export function ExposureScoreGauge() {
  const t = useCtemLabels();
  const { data: envelope, isLoading } = useRealtimeData<{ data: ExposureScore }>(
    API_ENDPOINTS.CYBER_CTEM_EXPOSURE_SCORE,
    { pollInterval: 120000 },
  );

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  }

  const score = envelope?.data;
  if (!score) return null;

  const grade = score.grade ?? 'C';
  const config = GRADE_CONFIG[grade] ?? GRADE_CONFIG.C;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score.score / 100) * circumference;

  // Backend scoring engine returns: 'worsening' (score up = bad), 'improving' (score down = good), 'stable'
  const TrendIcon = score.trend === 'worsening'
    ? TrendingUp
    : score.trend === 'improving'
    ? TrendingDown
    : Minus;

  const trendColor = score.trend === 'worsening'
    ? 'text-status-error'
    : score.trend === 'improving'
    ? 'text-primary'
    : 'text-muted-foreground';

  return (
    <div className={cn('flex flex-col items-center rounded-xl border p-6', config.bg)}>
      <p className="mb-3 text-sm font-semibold">{t.gauge.title}</p>
      <div className="relative">
        <svg width="140" height="140" className="-rotate-90">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="currentColor" strokeOpacity={0.1} strokeWidth={10} />
          <circle
            cx="70" cy="70" r={radius}
            fill="none"
            className={config.ring}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-4xl font-bold tabular-nums', config.color)}>{score.score}</span>
          <span className={cn('text-2xl font-black', config.color)}>{grade}</span>
        </div>
      </div>
      <div className={cn('mt-2 flex items-center gap-1 text-sm', trendColor)}>
        <TrendIcon className="h-4 w-4" />
        <span>{t.gauge.pts(Math.abs(score.trend_delta).toFixed(1))}</span>
      </div>
    </div>
  );
}
