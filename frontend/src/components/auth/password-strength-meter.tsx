'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/components/providers/locale-provider';
import type { MessageKey } from '@/lib/i18n/messages';

interface PasswordRequirement {
  /** i18n key for the requirement label. */
  labelKey: MessageKey;
  test: (password: string) => boolean;
}

const REQUIREMENTS: PasswordRequirement[] = [
  { labelKey: 'auth.passwordMeter.reqLength', test: (p) => p.length >= 12 },
  { labelKey: 'auth.passwordMeter.reqUppercase', test: (p) => /[A-Z]/.test(p) },
  { labelKey: 'auth.passwordMeter.reqLowercase', test: (p) => /[a-z]/.test(p) },
  { labelKey: 'auth.passwordMeter.reqNumber', test: (p) => /[0-9]/.test(p) },
  { labelKey: 'auth.passwordMeter.reqSpecial', test: (p) => /[^a-zA-Z0-9]/.test(p) },
];

type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong';

interface StrengthResult {
  level: StrengthLevel;
  score: number;
  metCount: number;
}

function calculateStrength(password: string): StrengthResult {
  const metCount = REQUIREMENTS.filter((r) => r.test(password)).length;
  let level: StrengthLevel;

  if (metCount <= 1) {
    level = 'weak';
  } else if (metCount <= 3) {
    level = 'fair';
  } else if (metCount === 4) {
    level = 'good';
  } else {
    // All 5 met — strong only if also ≥ 16 chars
    level = password.length >= 16 ? 'strong' : 'good';
  }

  return { level, score: metCount, metCount };
}

const STRENGTH_CONFIG: Record<
  StrengthLevel,
  { labelKey: MessageKey; color: string; segments: number }
> = {
  weak: { labelKey: 'auth.passwordMeter.levelWeak', color: 'bg-error-500', segments: 1 },
  fair: { labelKey: 'auth.passwordMeter.levelFair', color: 'bg-orange-400', segments: 2 },
  good: { labelKey: 'auth.passwordMeter.levelGood', color: 'bg-yellow-400', segments: 3 },
  strong: { labelKey: 'auth.passwordMeter.levelStrong', color: 'bg-primary', segments: 4 },
};

interface PasswordStrengthMeterProps {
  password: string;
  className?: string;
}

export function PasswordStrengthMeter({ password, className }: PasswordStrengthMeterProps) {
  const t = useT();
  const { level, metCount } = calculateStrength(password);
  const config = STRENGTH_CONFIG[level];
  const levelLabel = t(config.labelKey);

  if (!password) return null;

  return (
    <div className={cn('space-y-3', className)} aria-live="polite">
      {/* Strength bar */}
      <div className="space-y-1">
        <div className="flex gap-1" role="progressbar" aria-label={t('auth.passwordMeter.strengthAria').replace('{level}', levelLabel)} aria-valuenow={config.segments} aria-valuemin={0} aria-valuemax={4}>
          {[1, 2, 3, 4].map((seg) => (
            <div
              key={seg}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-all duration-300',
                seg <= config.segments ? config.color : 'bg-muted',
              )}
            />
          ))}
        </div>
        <p className={cn('text-xs font-medium', {
          'text-error-500': level === 'weak',
          'text-warning-700 dark:text-warning-300': level === 'fair',
          'text-yellow-600': level === 'good',
          'text-primary': level === 'strong',
        })}>
          {levelLabel}
        </p>
      </div>

      {/* Requirements checklist */}
      <ul className="space-y-1" aria-label={t('auth.passwordMeter.requirementsAria')}>
        {REQUIREMENTS.map((req) => {
          const met = req.test(password);
          return (
            <li key={req.labelKey} className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full transition-colors',
                  met ? 'bg-primary text-white' : 'bg-muted text-muted-foreground',
                )}
                aria-hidden="true"
              >
                <Check className="h-2.5 w-2.5" />
              </span>
              <span className={cn(met ? 'text-primary' : 'text-muted-foreground')}>
                {t(req.labelKey)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
