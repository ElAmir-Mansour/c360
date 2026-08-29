/**
 * Public surface of the rehearse drill-calendar feature: the calendar component,
 * the cadence-attention banner, the pure cadence-enforcement helpers, and the
 * feature-local labels. Imported by the rehearse route page.
 */

export { DrillCalendar } from './drill-calendar';
export { DrillCadenceBanner } from './drill-cadence-banner';
export {
  assessSchedule,
  compareByAttention,
  formatCadenceHorizon,
  lastCompletedAt,
  resolveNextRun,
  summarizeCadence,
  DUE_SOON_WINDOW_SECONDS,
  OVERDUE_GRACE_SECONDS,
  type DrillCadenceAssessment,
  type DrillCadenceStatus,
  type DrillCadenceSummary,
} from './drill-cadence';
export {
  drillCalendarLabels,
  useDrillCalendarLabels,
  type DrillCalendarLabels,
} from './drill-calendar-labels';
