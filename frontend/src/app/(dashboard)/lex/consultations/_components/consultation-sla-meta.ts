/**
 * Shared, pure SLA risk/tone helper for the Lex consultations feature.
 *
 * This module is deliberately framework-free (no React, no JSX) so it can be
 * consumed from columns, KPI math, board cards, the SLA panel, tests, etc.
 *
 * IMPORTANT: it does NOT depend on the full `Consultation` type. This helper
 * takes a narrow, explicit input shape so list rows, board cards, and panels can
 * pass only the SLA fields they already have.
 */

import type { StatTone } from '@/components/shared/stat-card';

/**
 * Window (in milliseconds) inside which an unbreached, response-due consultation
 * is considered "due soon". Defined as the next 24 hours.
 */
export const SLA_DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Semantic SLA risk level for a single consultation. */
export type SlaRiskLevel = 'breached' | 'due_soon' | 'on_track' | 'none';

/**
 * Narrow input for {@link slaRisk}. All fields are optional so partial list rows
 * resolve gracefully to `none`.
 */
export interface SlaRiskInput {
  /** Backend-computed breach flag, if already evaluated server-side. */
  breached?: boolean;
  /** ISO timestamp the response is due by, or null/undefined if no SLA. */
  responseDueAt?: string | null;
  /** Whether the acknowledgement step has been completed. */
  ackDone?: boolean;
}

/** Result of an SLA risk evaluation: a level plus a presentational tone. */
export interface SlaRiskResult {
  level: SlaRiskLevel;
  tone: StatTone;
}

/** Map an SLA risk level onto a presentational {@link StatTone}. */
export const SLA_RISK_TONE: Record<SlaRiskLevel, StatTone> = {
  breached: 'rose',
  due_soon: 'gold',
  on_track: 'emerald',
  none: 'slate',
};

/**
 * Evaluate the SLA risk for a consultation.
 *
 * Rules (in precedence order):
 *  1. `breached === true`            → `breached`  (rose)
 *  2. no `responseDueAt`             → `none`      (slate)
 *  3. due date already in the past   → `breached`  (rose)
 *  4. due within the next 24h        → `due_soon`  (gold)
 *  5. otherwise                      → `on_track`  (emerald)
 *
 * `ackDone` is accepted for forward-compatibility (a later agent may suppress
 * "due soon" once acknowledged); it currently does not alter the level so the
 * helper stays a stable, predictable building block.
 *
 * Pure: depends only on its input and `Date.now()`. Pass `now` for testability.
 */
export function slaRisk(input: SlaRiskInput, now: number = Date.now()): SlaRiskResult {
  if (input.breached) {
    return { level: 'breached', tone: SLA_RISK_TONE.breached };
  }

  const due = input.responseDueAt;
  if (!due) {
    return { level: 'none', tone: SLA_RISK_TONE.none };
  }

  const dueTs = new Date(due).getTime();
  if (Number.isNaN(dueTs)) {
    return { level: 'none', tone: SLA_RISK_TONE.none };
  }

  const remaining = dueTs - now;
  if (remaining <= 0) {
    return { level: 'breached', tone: SLA_RISK_TONE.breached };
  }

  if (remaining <= SLA_DUE_SOON_WINDOW_MS) {
    return { level: 'due_soon', tone: SLA_RISK_TONE.due_soon };
  }

  return { level: 'on_track', tone: SLA_RISK_TONE.on_track };
}
