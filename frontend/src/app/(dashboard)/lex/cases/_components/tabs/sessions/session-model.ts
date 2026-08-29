/**
 * Session metadata model — reads/writes the court-session detail that lives on a
 * hearing's `metadata` JSONB (persisted verbatim by the backend). Preserves any
 * unknown metadata keys on write so nothing else is clobbered.
 */

import type { CaseHearing } from '@/lib/lex/cases';
import type { SessionType } from './sessions-i18n';
import { SESSION_TYPES } from './sessions-i18n';

export interface RequiredDoc {
  id: string;
  label: string;
  provided: boolean;
}

export interface AdjournmentRecord {
  from_date: string;
  to_date?: string;
  reason: string;
  at: string;
}

export interface SessionMeta {
  session_type: SessionType | null;
  session_number: number | null;
  title: string;
  agenda: string;
  chamber: string;
  presiding_judge: string;
  presiding_judge_title: string;
  attendee_names: string[];
  status: 'scheduled' | 'upcoming' | 'completed' | 'adjourned' | 'cancelled' | null;
  duration_minutes: number | null;
  required_action: string;
  attendees: string[];
  required_documents: RequiredDoc[];
  adjournment: AdjournmentRecord | null;
}

function rec(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `d-${Math.random().toString(36).slice(2, 10)}`;
}

function parseRequiredDocs(value: unknown): RequiredDoc[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const r = rec(item);
      const label = str(r.label).trim();
      if (!label) return null;
      return {
        id: str(r.id).trim() || newId(),
        label,
        provided: r.provided === true,
      } satisfies RequiredDoc;
    })
    .filter((d): d is RequiredDoc => d !== null);
}

function parseAdjournment(value: unknown): AdjournmentRecord | null {
  const r = rec(value);
  const from = str(r.from_date).trim();
  const reason = str(r.reason).trim();
  if (!from && !reason) return null;
  return {
    from_date: from,
    to_date: str(r.to_date).trim() || undefined,
    reason,
    at: str(r.at).trim(),
  };
}

export function readSessionMeta(hearing: CaseHearing): SessionMeta {
  const m = rec(hearing.metadata);
  const typeRaw = str(m.session_type).trim();
  const session_type = (SESSION_TYPES as readonly string[]).includes(typeRaw)
    ? (typeRaw as SessionType)
    : null;
  return {
    session_type,
    session_number: num(m.session_number),
    title: str(m.title).trim(),
    agenda: str(m.agenda).trim(),
    chamber: str(m.chamber).trim(),
    presiding_judge: str(m.presiding_judge).trim(),
    presiding_judge_title: str(m.presiding_judge_title).trim(),
    attendee_names: Array.isArray(m.attendee_names)
      ? m.attendee_names.filter((v): v is string => typeof v === 'string' && v.length > 0)
      : [],
    status: ['scheduled', 'upcoming', 'completed', 'adjourned', 'cancelled'].includes(
      str(m.status),
    )
      ? (str(m.status) as SessionMeta['status'])
      : null,
    duration_minutes: num(m.duration_minutes),
    required_action: str(m.required_action).trim(),
    attendees: Array.isArray(m.attendees)
      ? m.attendees.filter((v): v is string => typeof v === 'string' && v.length > 0)
      : [],
    required_documents: parseRequiredDocs(m.required_documents),
    adjournment: parseAdjournment(m.adjournment),
  };
}

/**
 * Build the full hearing metadata object for a write: keep unknown keys, set the
 * session keys, and drop the adjournment key when there is none.
 */
export function buildSessionMetadata(
  existingMetadata: CaseHearing['metadata'],
  meta: SessionMeta,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...rec(existingMetadata) };
  out.session_type = meta.session_type ?? null;
  out.session_number = meta.session_number;
  out.title = meta.title;
  out.agenda = meta.agenda;
  out.chamber = meta.chamber;
  out.presiding_judge = meta.presiding_judge;
  out.presiding_judge_title = meta.presiding_judge_title;
  out.attendee_names = meta.attendee_names;
  out.status = meta.status;
  out.duration_minutes = meta.duration_minutes;
  out.required_action = meta.required_action;
  out.attendees = meta.attendees;
  out.required_documents = meta.required_documents;
  if (meta.adjournment) {
    out.adjournment = meta.adjournment;
  } else {
    delete out.adjournment;
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * Ordering helpers
 * ------------------------------------------------------------------------- */

function time(value: string | null | undefined): number {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** All sessions oldest → newest (the map/path order). */
export function chronological(hearings: CaseHearing[]): CaseHearing[] {
  return [...hearings].sort((a, b) => time(a.hearing_date) - time(b.hearing_date));
}

/** The soonest session at or after now, or null. */
export function nextSession(hearings: CaseHearing[]): CaseHearing | null {
  const now = Date.now();
  const upcoming = chronological(hearings).filter((h) => time(h.hearing_date) >= now);
  return upcoming[0] ?? null;
}

/** Past sessions, most recent first. */
export function pastSessions(hearings: CaseHearing[]): CaseHearing[] {
  const now = Date.now();
  return chronological(hearings)
    .filter((h) => time(h.hearing_date) < now)
    .reverse();
}

export function isPast(value: string | null | undefined): boolean {
  return time(value) < Date.now() && Boolean(value);
}

export function isToday(value: string | null | undefined): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
