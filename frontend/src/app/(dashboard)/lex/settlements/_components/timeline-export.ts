/**
 * Case-timeline export helpers (feature #20).
 *
 * Pure, framework-free utilities that turn a matter's loaded {@link MatterTimeline}
 * plus its full delay-event register into a CSV document. The shell
 * (`case-timeline-panel.tsx`) wires these to the Export/Print menu: it fetches
 * the full delay-event page, calls {@link buildTimelineCsv}, then triggers a
 * client-side download via the shared `downloadBlob` helper.
 *
 * Kept dependency-free (no React, no i18n hook) so it is trivially testable and
 * can be reused server-side later. Display strings (the CSV headers and the
 * human-readable delay category) are passed in by the caller, which already has
 * the bilingual label catalog in hand.
 */

import type { LegalCaseDelayEvent, MatterTimeline } from '@/lib/lex/settlements';

/**
 * Caller-supplied display strings for the CSV. Sourced from the settlements
 * label catalog so the export honours the active locale. All optional — sensible
 * neutral English fallbacks are used when a key is omitted.
 */
export interface TimelineCsvLabels {
  /** Maps a raw delay-category token to its display label (locale-aware). */
  categoryLabel?: (category: string) => string;
  summary?: {
    heading?: string;
    matterNumber?: string;
    title?: string;
    estimatedDuration?: string;
    estimatedCompletion?: string;
    openDelayDays?: string;
    externalHold?: string;
    externalHoldCategory?: string;
    externalHoldSince?: string;
  };
  register?: {
    heading?: string;
    category?: string;
    reason?: string;
    openedAt?: string;
    resolvedAt?: string;
    resolved?: string;
    durationDays?: string;
  };
  /** Yes/No tokens for boolean cells. */
  yes?: string;
  no?: string;
}

/**
 * Escape a single CSV field per RFC 4180: wrap in double quotes and double any
 * embedded quotes whenever the value contains a quote, comma, CR or LF. `null`
 * / `undefined` become an empty cell.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Join a row of already-stringified cells, escaping each. */
function csvRow(cells: unknown[]): string {
  return cells.map(escapeCsvField).join(',');
}

/** Whole days a delay event spanned (resolved → opened..resolved, else opened..now). */
function delayDurationDays(event: LegalCaseDelayEvent): number {
  const start = Date.parse(event.opened_at);
  if (Number.isNaN(start)) {
    return 0;
  }
  const endRaw = event.resolved && event.resolved_at ? Date.parse(event.resolved_at) : Date.now();
  const end = Number.isNaN(endRaw) ? Date.now() : endRaw;
  const ms = Math.max(0, end - start);
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Build the full CSV document: a small timeline-summary section followed by a
 * blank line and the delay-event register (one row per event). Uses CRLF line
 * endings (Excel-friendly) and a leading BOM so non-ASCII (Arabic) reasons and
 * labels render correctly in spreadsheet apps.
 */
export function buildTimelineCsv(
  timeline: MatterTimeline,
  events: LegalCaseDelayEvent[],
  labels: TimelineCsvLabels = {},
): string {
  const s = labels.summary ?? {};
  const r = labels.register ?? {};
  const yes = labels.yes ?? 'Yes';
  const no = labels.no ?? 'No';
  const categoryLabel = labels.categoryLabel ?? ((c: string) => c);

  const lines: string[] = [];

  // --- timeline summary section -----------------------------------------
  lines.push(csvRow([s.heading ?? 'Case timeline summary']));
  lines.push(csvRow([s.matterNumber ?? 'Matter number', timeline.matter_number]));
  lines.push(csvRow([s.title ?? 'Title', timeline.title]));
  lines.push(
    csvRow([
      s.estimatedDuration ?? 'Estimated duration (days)',
      timeline.estimated_duration_days ?? '',
    ]),
  );
  lines.push(
    csvRow([
      s.estimatedCompletion ?? 'Estimated completion date',
      timeline.estimated_completion_date ?? '',
    ]),
  );
  lines.push(csvRow([s.openDelayDays ?? 'Open delay days', timeline.open_delay_days]));
  lines.push(csvRow([s.externalHold ?? 'External hold', timeline.external_hold ? yes : no]));
  lines.push(
    csvRow([
      s.externalHoldCategory ?? 'External hold category',
      timeline.external_hold_category ? categoryLabel(timeline.external_hold_category) : '',
    ]),
  );
  lines.push(
    csvRow([s.externalHoldSince ?? 'External hold since', timeline.external_hold_since ?? '']),
  );

  // blank separator row
  lines.push('');

  // --- delay-event register section -------------------------------------
  lines.push(csvRow([r.heading ?? 'Delay events']));
  lines.push(
    csvRow([
      r.category ?? 'Category',
      r.reason ?? 'Reason',
      r.openedAt ?? 'Opened at',
      r.resolvedAt ?? 'Resolved at',
      r.resolved ?? 'Resolved',
      r.durationDays ?? 'Duration (days)',
    ]),
  );
  for (const event of events) {
    lines.push(
      csvRow([
        categoryLabel(event.category),
        event.reason,
        event.opened_at,
        event.resolved_at ?? '',
        event.resolved ? yes : no,
        delayDurationDays(event),
      ]),
    );
  }

  // Leading BOM + CRLF endings for maximum spreadsheet compatibility.
  return `﻿${lines.join('\r\n')}`;
}

/** A filesystem-safe export filename for a matter's timeline CSV. */
export function timelineCsvFilename(matterNumber: string): string {
  const safe = (matterNumber || 'matter').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `case-timeline-${safe || 'matter'}.csv`;
}
