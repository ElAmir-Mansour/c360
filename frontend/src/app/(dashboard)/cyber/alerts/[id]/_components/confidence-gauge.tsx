'use client';

import { cn } from '@/lib/utils';

import { useAlertLabels } from '../../_lib/alerts-i18n';

interface ConfidenceGaugeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

function getConfig(score: number, labels: ReturnType<typeof useAlertLabels>['gauge']) {
  if (score >= 85) return { label: labels.veryHigh, color: 'hsl(var(--severity-critical))', bg: 'bg-error-50 dark:bg-error-700/30', text: 'text-error-500 dark:text-error-300' };
  if (score >= 70) return { label: labels.high, color: 'hsl(var(--severity-high))', bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-600 dark:text-orange-400' };
  if (score >= 50) return { label: labels.medium, color: 'hsl(var(--severity-medium))', bg: 'bg-yellow-50 dark:bg-yellow-950/30', text: 'text-yellow-600 dark:text-yellow-400' };
  return { label: labels.low, color: 'hsl(var(--status-success))', bg: 'bg-primary/10 dark:bg-brand-primary-800/30', text: 'text-primary' };
}

export function ConfidenceGauge({ score, size = 'md' }: ConfidenceGaugeProps) {
  const t = useAlertLabels();
  const { label, color, bg, text } = getConfig(score, t.gauge);
  const radius = size === 'lg' ? 52 : size === 'md' ? 42 : 30;
  const stroke = size === 'lg' ? 8 : size === 'md' ? 6 : 5;
  const dim = (radius + stroke) * 2;
  const circumference = 2 * Math.PI * radius;
  // Half-circle gauge: use 180° arc
  const halfCirc = circumference / 2;
  const offset = halfCirc - (score / 100) * halfCirc;

  const textSize = size === 'lg' ? 'text-3xl' : size === 'md' ? 'text-2xl' : 'text-lg';

  return (
    <div className={cn('flex flex-col items-center rounded-xl p-4', bg)}>
      <div className="relative" style={{ width: dim, height: dim / 2 + stroke }}>
        <svg
          width={dim}
          height={dim / 2 + stroke}
          className="overflow-visible"
        >
          {/* Background track */}
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeOpacity={0.1}
            strokeDasharray={`${halfCirc} ${circumference}`}
            strokeDashoffset={0}
            transform={`rotate(-180 ${dim / 2} ${dim / 2})`}
          />
          {/* Filled arc */}
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${halfCirc} ${circumference}`}
            strokeDashoffset={offset}
            transform={`rotate(-180 ${dim / 2} ${dim / 2})`}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <span className={cn('font-bold tabular-nums', textSize, text)}>{score}%</span>
        </div>
      </div>
      <p className={cn('mt-1 text-xs font-medium', text)}>{`${label} ${t.gauge.confidenceSuffix}`}</p>
    </div>
  );
}
