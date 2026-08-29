'use client';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { RiskPostureSummary } from '@/types/cyber';
import { useVcisoLabels } from '../_lib/vciso-i18n';

function gradeColor(grade: string): string {
  if (grade === 'A' || grade === 'B') return 'text-primary';
  if (grade === 'C') return 'text-warning-700 dark:text-warning-300';
  return 'text-status-error';
}

function gradeBackground(grade: string): string {
  if (grade === 'A' || grade === 'B') return 'bg-primary/10 border-primary/30';
  if (grade === 'C') return 'bg-warning-50 border-warning-300 dark:bg-warning-800/30 dark:border-warning-800';
  return 'bg-error-50 border-error-100 dark:bg-error-700/30 dark:border-error-700';
}

function componentBarColor(value: number): string {
  if (value <= 30) return 'bg-primary';
  if (value <= 60) return 'bg-severity-medium';
  return 'bg-severity-critical';
}

function formatComponentLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function RiskPostureSummary({ posture }: { posture: RiskPostureSummary }) {
  const t = useVcisoLabels();
  const isUp = posture.trend === 'increasing';
  const isDown = posture.trend === 'decreasing';

  return (
    <div className="rounded-lg border bg-card p-6 space-y-6">
      {/* Grade and score row */}
      <div className="flex items-center gap-6">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-xl border-2 text-5xl font-bold ${gradeBackground(posture.grade)} ${gradeColor(posture.grade)}`}
        >
          {posture.grade}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground font-medium uppercase tracking-wide">
            {t.posture.riskScore}
          </span>
          <span className="text-4xl font-bold text-foreground">
            {posture.overall_score}
          </span>
          {/* Trend indicator */}
          <div className="flex items-center gap-1 text-sm font-medium">
            {isUp ? (
              <TrendingUp className="h-4 w-4 text-status-error" />
            ) : isDown ? (
              <TrendingDown className="h-4 w-4 text-primary" />
            ) : (
              <Minus className="h-4 w-4 text-muted-foreground" />
            )}
            <span
              className={
                isUp
                  ? 'text-status-error'
                  : isDown
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }
            >
              {posture.trend_delta > 0 ? '+' : ''}
              {posture.trend_delta.toFixed(1)}
            </span>
            <span className="text-muted-foreground font-normal">{t.posture.vsLastPeriod}</span>
          </div>
        </div>
      </div>

      {/* Component bars */}
      {Object.keys(posture.components).length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">{t.posture.riskComponents}</p>
          {Object.entries(posture.components).map(([key, value]) => (
            <div key={key} className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatComponentLabel(key)}</span>
                <span className="font-medium tabular-nums">{value}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${componentBarColor(value)}`}
                  style={{ width: `${Math.min(value, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
