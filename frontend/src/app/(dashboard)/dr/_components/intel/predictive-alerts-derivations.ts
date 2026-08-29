/**
 * predictive-alerts-derivations.ts — pure, deterministic ranking + severity logic
 * for the ClarioDR predictive RPO/breach alert surface.
 *
 * Every value is read straight off a REAL `DRPrediction` (`@/types/clario-dr`):
 *
 *   - `predicted_breach_seconds` (nullable)  -> the ETA to an RPO breach.
 *   - `breach_forecast`          (boolean)   -> the model projects an RPO breach.
 *   - `throughput_collapse`      (boolean)   -> apply-throughput has collapsed.
 *   - `smoothed_lag_seconds`, `lag_trend_slope`, `throughput_trend_slope`,
 *     `rpo_objective_seconds`, `group_label`, `stream_id`                    -> context.
 *
 * No fields are invented. Severity + ETA are derived ONLY from the above. The
 * functions are pure (no `Date.now()` / no I/O) so the component stays a thin
 * renderer and the unit tests are deterministic.
 */

import type { DRPrediction } from '@/types/clario-dr';

/** Severity ramp for a predictive alert (maps onto the `state-*` design tokens). */
export type PredictiveAlertSeverity = 'critical' | 'warning' | 'info';

/** Where the operator is sent to act on a given prediction. */
export type PredictiveAlertActionTarget = 'protect' | 'recover';

/**
 * A single ranked predictive alert, fully derived from one `DRPrediction`. The
 * component renders this verbatim — it performs no further derivation.
 */
export interface PredictiveAlert {
  /** Stable React key + de-dup key (the prediction's own id). */
  id: string;
  /** The stream the forecast is about. */
  streamId: string;
  /** Human group/workload label carried on the prediction (`group_label`). */
  groupLabel: string;
  severity: PredictiveAlertSeverity;
  /**
   * ETA to breach in seconds, or `null` when the model reported no finite
   * horizon (e.g. a throughput-collapse alert with no breach forecast yet).
   */
  etaSeconds: number | null;
  /** The kind of issue this alert represents. */
  kind: 'rpo_breach_forecast' | 'throughput_collapse';
  /** The route the recommended action deep-links to. */
  actionTarget: PredictiveAlertActionTarget;
  /** The fully-built href for the recommended action (stream preset for protect). */
  actionHref: string;
  /** Sort weight (higher = more urgent); used only for stable ranking. */
  rank: number;
  /** The objective the live lag is being measured against (`rpo_objective_seconds`). */
  rpoObjectiveSeconds: number;
  /** Current smoothed replication lag (`smoothed_lag_seconds`). */
  lagSeconds: number;
}

/**
 * Below this ETA (in seconds) an RPO-breach forecast is treated as imminent and
 * escalated from `warning` to `critical`. 15 minutes mirrors the war-room's
 * at-risk horizon for an operator to still act before the objective is missed.
 */
export const PREDICTIVE_BREACH_IMMINENT_SECONDS = 15 * 60;

/**
 * True when a prediction is worth surfacing as an alert at all: either the model
 * forecasts an RPO breach, or apply-throughput has collapsed. A steady stream
 * (neither flag set) produces no alert. Read straight off the real flags.
 */
export function isPredictiveAlert(prediction: DRPrediction): boolean {
  return prediction.breach_forecast || prediction.throughput_collapse;
}

/** Build the recommended-action href for an alert from its derived target. */
function buildActionHref(target: PredictiveAlertActionTarget, streamId: string): string {
  if (target === 'protect') {
    // Preset the stream so /dr/protect opens on the at-risk stream's workbench.
    return `/dr/protect?stream=${encodeURIComponent(streamId)}`;
  }
  return '/dr/recover';
}

/**
 * Derive a single ranked alert from a real `DRPrediction`. Returns `null` when
 * the prediction carries neither risk flag (nothing to surface).
 *
 * Severity ladder (icon + text + token always paired by the renderer):
 *   - `critical` — a breach forecast with a finite ETA at/under the imminent
 *                  horizon (operator must act now), OR a breach forecast that
 *                  also shows throughput collapse (compounding failure).
 *   - `warning`  — any other breach forecast, or a standalone throughput
 *                  collapse (degrading, not yet breaching).
 *   - `info`     — reserved; never produced here since a non-alert returns null.
 *
 * Recommended action:
 *   - a breach forecast routes to PROTECT (tune replication on the stream);
 *   - a standalone throughput collapse routes to RECOVER (the stream may need a
 *     failover/recovery decision rather than a replication tweak).
 */
export function deriveAlert(prediction: DRPrediction): PredictiveAlert | null {
  if (!isPredictiveAlert(prediction)) return null;

  const eta =
    typeof prediction.predicted_breach_seconds === 'number' &&
    Number.isFinite(prediction.predicted_breach_seconds)
      ? Math.max(0, prediction.predicted_breach_seconds)
      : null;

  const breach = prediction.breach_forecast;
  const collapse = prediction.throughput_collapse;

  const imminent = breach && eta !== null && eta <= PREDICTIVE_BREACH_IMMINENT_SECONDS;

  let severity: PredictiveAlertSeverity;
  if (breach && (imminent || collapse)) {
    severity = 'critical';
  } else {
    severity = 'warning';
  }

  const kind: PredictiveAlert['kind'] = breach ? 'rpo_breach_forecast' : 'throughput_collapse';
  const actionTarget: PredictiveAlertActionTarget = breach ? 'protect' : 'recover';

  // Rank: severity dominates, then the soonest finite ETA wins (a null ETA sorts
  // after any finite one within the same severity band).
  const severityWeight = severity === 'critical' ? 2_000_000 : 1_000_000;
  const etaWeight = eta === null ? 0 : Math.max(0, 1_000_000 - Math.min(eta, 1_000_000));
  const rank = severityWeight + etaWeight;

  return {
    id: prediction.id,
    streamId: prediction.stream_id,
    groupLabel: prediction.group_label,
    severity,
    etaSeconds: eta,
    kind,
    actionTarget,
    actionHref: buildActionHref(actionTarget, prediction.stream_id),
    rank,
    rpoObjectiveSeconds: prediction.rpo_objective_seconds,
    lagSeconds: prediction.smoothed_lag_seconds,
  };
}

/**
 * Derive and rank all surfaceable alerts from a list of predictions. Steady
 * streams are dropped; the rest are sorted most-urgent-first (severity, then
 * soonest ETA, then stream id for a stable tiebreak).
 */
export function deriveAlerts(predictions: DRPrediction[]): PredictiveAlert[] {
  return predictions
    .map(deriveAlert)
    .filter((alert): alert is PredictiveAlert => alert !== null)
    .sort((left, right) => {
      if (right.rank !== left.rank) return right.rank - left.rank;
      return left.streamId.localeCompare(right.streamId);
    });
}
