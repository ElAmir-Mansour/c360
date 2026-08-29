/**
 * Pure SLA-projection helpers for the "New Legal Request" wizard
 * (improvement #4: live SLA promise preview).
 *
 * These functions are deliberately side-effect free: they NEVER read
 * `Date.now()` at module scope or inside the helpers — the caller (the React
 * component) passes an explicit `from: Date` so the projection is deterministic
 * and unit-testable. The calendar maths here is an *approximation* used only for
 * an at-a-glance preview chip; the authoritative due dates are computed
 * server-side against the tenant working-calendar engine (holidays, Ramadan
 * hours, half-days, etc.) which this client has no knowledge of.
 */
import { addDays } from 'date-fns';
import type { SLATarget, SLATargetPriority } from '@/lib/lex/admin';

/** A projected, human-facing SLA promise for a single request. */
export interface SlaProjection {
  /** Localised acknowledgement window, e.g. "2 working days" / "yawm 'amal". */
  ackText: string;
  /** Localised turnaround window, e.g. "5 working days". */
  turnaroundText: string;
  /**
   * Lower bound of the turnaround window, in working days (earliest promise). Equal
   * to `turnaroundToDays` when the target has no distinct lower bound.
   */
  turnaroundFromDays: number;
  /** Upper bound of the turnaround window, in working days (the enforced deadline). */
  turnaroundToDays: number;
  /** Approximate calendar date the acknowledgement is due by. */
  ackDueApprox: Date;
  /** Approximate calendar date of the earliest promise (the From bound). */
  turnaroundDueFromApprox: Date;
  /** Approximate calendar date the resolution is due by (the To bound / deadline). */
  turnaroundDueApprox: Date;
  /** Escalation tier offsets (in days) carried straight from the target. */
  escalation: { l1: number; l2: number; l3: number };
}

/**
 * pickSlaTarget selects the single active SLA target whose `service_code` and
 * `priority` match the request being drafted. Returns `null` when no service is
 * chosen yet or when nothing matches (e.g. a service without an SLA target).
 */
export function pickSlaTarget(
  targets: SLATarget[],
  serviceCode: string | undefined,
  priority: SLATargetPriority,
): SLATarget | null {
  if (!serviceCode) return null;
  return (
    targets.find(
      (target) =>
        target.active &&
        target.service_code === serviceCode &&
        target.priority === priority,
    ) ?? null
  );
}

/**
 * addWorkingDaysApprox advances `from` by `workingDays` working days using a
 * simple KSA weekend rule: Friday (getDay() === 5) and Saturday (=== 6) are
 * skipped (hopped over) and do not consume a working day. This is an
 * APPROXIMATION — it ignores public/religious holidays and Ramadan calendars,
 * which the server-side working-calendar engine applies authoritatively.
 */
function addWorkingDaysApprox(from: Date, workingDays: number): Date {
  let cursor = from;
  let remaining = Math.max(0, Math.ceil(workingDays));
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    const day = cursor.getDay(); // 0 = Sun … 5 = Fri, 6 = Sat
    if (day !== 5 && day !== 6) {
      remaining -= 1;
    }
  }
  return cursor;
}

/**
 * projectSla turns an SLA target into approximate calendar due dates relative to
 * `from`. The acknowledgement window is honoured per its unit: `working_days`
 * hops over weekends; `working_hours` is collapsed to whole working days
 * (ceil(hours / 8)) for the calendar approximation only — the human-readable
 * `ackText` still states the original hours. Turnaround is always counted in
 * working days.
 *
 * The numeric texts here are intentionally locale-neutral placeholders; the
 * component re-renders the acknowledgement / turnaround lines through its own
 * bilingual labels. They are populated so the projection is self-describing and
 * directly testable.
 */
export function projectSla(target: SLATarget, from: Date): SlaProjection {
  const ackUnitIsHours = target.ack_window_unit === 'working_hours';
  // For the calendar approximation only, fold an hours-based ack window into
  // whole working days at an 8-hour working day. The displayed text keeps hours.
  const ackWorkingDaysApprox = ackUnitIsHours
    ? Math.max(1, Math.ceil(target.ack_window_value / 8))
    : target.ack_window_value;

  // From–To turnaround window. The lower bound defaults to the upper bound (a
  // single-figure window) and is clamped so `from <= to` always holds client-side.
  const turnaroundToDays = target.turnaround_working_days;
  const rawFrom = target.turnaround_working_days_from;
  const turnaroundFromDays =
    typeof rawFrom === 'number' && rawFrom > 0 && rawFrom <= turnaroundToDays
      ? rawFrom
      : turnaroundToDays;

  const ackDueApprox = addWorkingDaysApprox(from, ackWorkingDaysApprox);
  const turnaroundDueFromApprox = addWorkingDaysApprox(from, turnaroundFromDays);
  const turnaroundDueApprox = addWorkingDaysApprox(from, turnaroundToDays);

  const ackText = ackUnitIsHours
    ? `${target.ack_window_value} working hours`
    : `${target.ack_window_value} working days`;
  const turnaroundText =
    turnaroundFromDays === turnaroundToDays
      ? `${turnaroundToDays} working days`
      : `${turnaroundFromDays}–${turnaroundToDays} working days`;

  return {
    ackText,
    turnaroundText,
    turnaroundFromDays,
    turnaroundToDays,
    ackDueApprox,
    turnaroundDueFromApprox,
    turnaroundDueApprox,
    escalation: {
      l1: target.escalation_l1_days,
      l2: target.escalation_l2_days,
      l3: target.escalation_l3_days,
    },
  };
}
