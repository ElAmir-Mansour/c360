/**
 * Feature 7 / 9 — contracts list risk-score chip.
 *
 * A tiny, purely presentational cell that renders the contract risk posture as a
 * unified, tone-tinted CHIP: a `SeverityIndicator` (icon-only, colored by
 * `toIndicatorSeverity(riskLevel)`) seated in a soft pill whose ring + wash match
 * the severity ramp, with the numeric 0–100 score (Arabic-Indic in ar mode via
 * `useLexFormat`) rendered beside it. When the contract has not been analyzed yet
 * (`riskScore` is null/undefined) it degrades to a muted em-dash carrying a
 * bilingual "not analyzed" tooltip — so the column never shows a bare snake-case
 * token or raw number.
 *
 * No data fetching, no state — the column header/sort wiring is owned by the
 * list page integrator. Bilingual labels mirror the canonical lex token-record
 * pattern (`LexBilingual<T> = { en, ar }` resolved by the active locale).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { LexRiskLevel } from '@/types/suites';
import {
  resolveLexBilingual,
  type LexBilingual,
} from '../../_lib/lex-i18n';
import { toIndicatorSeverity } from '../[id]/_components/risk-severity';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (English + Modern Standard Arabic).
 * ------------------------------------------------------------------------- */

interface ContractRiskCellLabels {
  /** Tooltip + screen-reader affordance when no risk score has been computed. */
  notAnalyzed: string;
  /** Tooltip prefix for the numeric score (e.g. "Risk score 72"). */
  scoreLabel: (score: string) => string;
}

const contractRiskCellLabels: LexBilingual<ContractRiskCellLabels> = {
  en: {
    notAnalyzed: 'Not analyzed',
    scoreLabel: (score) => `Risk score ${score}`,
  },
  ar: {
    notAnalyzed: 'لم يُحلَّل',
    scoreLabel: (score) => `درجة المخاطر ${score}`,
  },
};

export function useContractRiskCellLabels(): ContractRiskCellLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => resolveLexBilingual(contractRiskCellLabels, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Helper.
 * ------------------------------------------------------------------------- */

/**
 * Clamp + round a raw backend risk score onto the displayed 0–100 integer
 * scale. Returns `null` for non-finite or unset values so callers can render the
 * "not analyzed" affordance. Western digits are preserved on both locales — the
 * caller localizes (Arabic-Indic) at render time.
 */
export function formatRiskScore(score?: number | null): number | null {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Tone-tinted chip chrome per severity, spelled out literally so Tailwind's JIT
 * scanner can statically detect each class. Mirrors the design-system semantic
 * ramp used by `rowAccentClass` / `SeverityIndicator` so the chip re-themes in
 * dark mode and reads consistently against the rest of the suite.
 */
const CHIP_TONE: Record<Severity, string> = {
  critical:
    'border-error-500/35 bg-error-500/8 text-error-700 dark:text-error-300',
  high: 'border-error-500/30 bg-error-500/6 text-error-700 dark:text-error-300',
  warning:
    'border-warning-500/30 bg-warning-500/7 text-warning-700 dark:text-warning-300',
  medium:
    'border-warning-500/30 bg-warning-500/7 text-warning-700 dark:text-warning-300',
  low: 'border-info-500/30 bg-info-500/6 text-info-700 dark:text-info-300',
  info: 'border-border/70 bg-muted/50 text-muted-foreground',
};

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

export interface ContractRiskCellProps {
  riskLevel: LexRiskLevel;
  riskScore?: number | null;
  className?: string;
}

export function ContractRiskCell({
  riskLevel,
  riskScore,
  className,
}: ContractRiskCellProps) {
  const labels = useContractRiskCellLabels();
  const f = useLexFormat();
  const score = formatRiskScore(riskScore);

  if (score === null) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border border-dashed border-border/70 px-2.5 py-0.5 text-sm text-muted-foreground',
          className,
        )}
        title={labels.notAnalyzed}
        aria-label={labels.notAnalyzed}
      >
        —
      </span>
    );
  }

  const severity = toIndicatorSeverity(riskLevel);
  const display = f.formatNumber(score);
  const scoreLabel = labels.scoreLabel(display);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5',
        'transition-colors duration-fast ease-standard',
        CHIP_TONE[severity],
        className,
      )}
      title={scoreLabel}
    >
      <SeverityIndicator severity={severity} showLabel={false} size="sm" />
      <span className="text-sm font-semibold tabular-nums" aria-label={scoreLabel}>
        {display}
      </span>
    </span>
  );
}
