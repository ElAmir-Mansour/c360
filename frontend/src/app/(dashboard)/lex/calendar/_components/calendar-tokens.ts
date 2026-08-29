/**
 * Shared visual tokens for the Unified Legal Calendar so the grid, agenda,
 * filter chips and KPI strip all speak the same colour language.
 *
 * Severity colours mirror the shared `EventCalendar` / `SeverityIndicator`
 * palette. Type colours give each of the seven sources a stable hue (used for
 * the left rail accent + filter dots) so a glance at the grid maps to a source.
 */

import type { KpiColorTheme } from '@/components/shared/kpi-card';
import type { LegalEventSeverity, LegalEventType } from '../_lib/calendar-events';

/** Severity dot fills (solid). */
export const SEVERITY_DOT: Record<LegalEventSeverity, string> = {
  critical: 'bg-error-500 dark:bg-error-300',
  high: 'bg-warning-500 dark:bg-warning-300',
  medium: 'bg-yellow-500 dark:bg-yellow-400',
  low: 'bg-blue-500 dark:bg-blue-400',
  info: 'bg-neutral-400 dark:bg-neutral-500',
};

/** Severity pills for agenda `kind`-style chips. */
export const SEVERITY_PILL: Record<LegalEventSeverity, string> = {
  critical: 'bg-error-100 text-error-600 dark:bg-error-700/30 dark:text-error-300',
  high: 'bg-warning-100 text-warning-700 dark:bg-warning-800/30 dark:text-warning-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  info: 'bg-secondary text-foreground/70 dark:bg-neutral-ink dark:text-foreground/60',
};

/** One stable hue per source — used on filter dots + event-pill rails. */
export const TYPE_DOT: Record<LegalEventType, string> = {
  hearing: 'bg-brand-primary-600',
  contract_renewal: 'bg-brand-teal-500',
  contract_expiry: 'bg-error-500',
  signature_deadline: 'bg-brand-accent-500',
  obligation: 'bg-warning-500',
  settlement_milestone: 'bg-brand-primary-800',
  service_sla: 'bg-neutral-500',
};

/**
 * Per-source rail accent (border colour) for event pills. Logical (`border-s-*`)
 * so the rail sits on the inline-start edge and mirrors with the document
 * direction in Arabic/RTL mode.
 */
export const TYPE_RAIL: Record<LegalEventType, string> = {
  hearing: 'border-s-brand-primary-600',
  contract_renewal: 'border-s-brand-teal-500',
  contract_expiry: 'border-s-error-500',
  signature_deadline: 'border-s-brand-accent-500',
  obligation: 'border-s-warning-500',
  settlement_milestone: 'border-s-brand-primary-800',
  service_sla: 'border-s-neutral-500',
};

/** Per-source KPI theme (for the future per-type tiles, if wired). */
export const TYPE_THEME: Record<LegalEventType, KpiColorTheme> = {
  // Nearest on-brand KpiColorTheme value per type (union offers only `primary`
  // + `teal` as brand hues); due/overdue types keep red/amber.
  hearing: 'primary',
  contract_renewal: 'teal',
  contract_expiry: 'red',
  signature_deadline: 'teal',
  obligation: 'amber',
  settlement_milestone: 'primary',
  service_sla: 'primary',
};
