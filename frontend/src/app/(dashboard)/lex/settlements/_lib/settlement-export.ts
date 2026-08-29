/**
 * Settlement / ADR CSV export helpers (Feature 6 — list-page export).
 *
 * Pure, framework-free utilities that turn the loaded settlement register (or a
 * single settlement's negotiation rounds) into an RFC 4180 CSV document and
 * trigger a client-side download. The list page wires {@link exportSettlementsCsv}
 * to an Export button in its header and to a bulk-export action over the
 * selected rows; the detail page (or a list row) may wire
 * {@link exportSettlementRoundsCsv} for a single settlement's rounds.
 *
 * Design mirrors the sibling `_components/timeline-export.ts`:
 *   - RFC 4180 field escaping (quote-wrap + double embedded quotes).
 *   - Leading UTF-8 BOM + CRLF line endings so Arabic counterparty names and
 *     terms render correctly in Excel / Numbers / LibreOffice.
 *   - A filesystem-safe, DATED filename.
 *
 * No React, no JSX, no i18n hook — these are pure functions usable from any
 * event handler and trivially unit-testable. The bilingual column headers are
 * owned internally (English + professional MSA) and selected by an explicit
 * `locale` option so the export honours the active surface locale without
 * coupling to React context.
 */

import type {
  Settlement,
  SettlementNegotiationRound,
} from '@/lib/lex/settlements';
import { downloadBlob } from '@/lib/format';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

// ---------------------------------------------------------------------------
// Bilingual column-header catalog (owned internally per the _lib contract).
// Legal glossary: تسوية (settlement) / مفاوضة·تفاوض (negotiation) /
// طرف مقابل (counterparty) / صلح·وساطة·تحكيم (ADR methods, resolved upstream).
// ---------------------------------------------------------------------------

interface SettlementExportLabels {
  /** Header row for the settlements register export. */
  settlements: {
    reference: string;
    title: string;
    status: string;
    method: string;
    value: string;
    currency: string;
    counterpartyName: string;
    createdAt: string;
    updatedAt: string;
  };
  /** Header row for the negotiation-rounds export. */
  rounds: {
    settlementReference: string;
    roundNumber: string;
    proposedBy: string;
    proposedValue: string;
    currency: string;
    outcome: string;
  };
}

const exportLabels: LexBilingual<SettlementExportLabels> = {
  en: {
    settlements: {
      reference: 'Reference',
      title: 'Title',
      status: 'Status',
      method: 'Method',
      value: 'Value',
      currency: 'Currency',
      counterpartyName: 'Counterparty',
      createdAt: 'Created at',
      updatedAt: 'Updated at',
    },
    rounds: {
      settlementReference: 'Settlement reference',
      roundNumber: 'Round',
      proposedBy: 'Proposed by',
      proposedValue: 'Proposed value',
      currency: 'Currency',
      outcome: 'Outcome',
    },
  },
  ar: {
    settlements: {
      reference: 'المرجع',
      title: 'العنوان',
      status: 'الحالة',
      method: 'الأسلوب',
      value: 'القيمة',
      currency: 'العملة',
      counterpartyName: 'الطرف المقابل',
      createdAt: 'تاريخ الإنشاء',
      updatedAt: 'آخر تحديث',
    },
    rounds: {
      settlementReference: 'مرجع التسوية',
      roundNumber: 'الجولة',
      proposedBy: 'مُقدِّم العرض',
      proposedValue: 'القيمة المقترحة',
      currency: 'العملة',
      outcome: 'النتيجة',
    },
  },
};

/** Resolve the export column headers for a locale (English fallback). */
function resolveExportLabels(locale: AppLocale = 'en'): SettlementExportLabels {
  return resolveLexBilingual(exportLabels, locale);
}

// ---------------------------------------------------------------------------
// CSV primitives (RFC 4180 — mirrors timeline-export.ts).
// ---------------------------------------------------------------------------

/**
 * Escape a single CSV field per RFC 4180: wrap in double quotes and double any
 * embedded quotes whenever the value contains a quote, comma, CR or LF. `null` /
 * `undefined` become an empty cell. Numbers are stringified verbatim (Western
 * digits) so spreadsheet apps parse them numerically.
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

/** Join a row of cells, escaping each per RFC 4180. */
function csvRow(cells: readonly unknown[]): string {
  return cells.map(escapeCsvField).join(',');
}

/**
 * Assemble a header + data-rows document with a leading UTF-8 BOM and CRLF line
 * endings for maximum spreadsheet compatibility (Arabic-safe).
 */
function buildCsvDocument(header: readonly unknown[], rows: readonly unknown[][]): string {
  const lines = [csvRow(header), ...rows.map((cells) => csvRow(cells))];
  return `﻿${lines.join('\r\n')}`;
}

// ---------------------------------------------------------------------------
// Filenames (dated, filesystem-safe).
// ---------------------------------------------------------------------------

/** Local YYYY-MM-DD stamp for export filenames. */
function dateStamp(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Sanitise an arbitrary token into a safe filename segment. */
function safeSegment(token: string, fallback: string): string {
  const safe = (token || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || fallback;
}

/** Dated filename for the settlements-register CSV, e.g. `settlements-2026-06-25.csv`. */
export function settlementsCsvFilename(date: Date = new Date()): string {
  return `settlements-${dateStamp(date)}.csv`;
}

/**
 * Dated filename for a single settlement's negotiation-rounds CSV, e.g.
 * `settlement-rounds-RECON-001-2026-06-25.csv`.
 */
export function settlementRoundsCsvFilename(reference: string, date: Date = new Date()): string {
  return `settlement-rounds-${safeSegment(reference, 'settlement')}-${dateStamp(date)}.csv`;
}

// ---------------------------------------------------------------------------
// Document builders (pure — exported for testing / server-side reuse).
// ---------------------------------------------------------------------------

/**
 * Build the settlements-register CSV string. One row per settlement with the
 * columns: reference, title, status, method, value, currency, counterparty_name,
 * created_at, updated_at. Status and method are emitted as RAW backend tokens so
 * the export is locale-stable and re-importable; only the HEADER row is
 * localised. Pass `opts.statusLabel` / `opts.methodLabel` to instead emit the
 * human-readable display values (e.g. the list page's resolved labels).
 */
export function buildSettlementsCsv(
  settlements: readonly Settlement[],
  opts: SettlementsCsvOptions = {},
): string {
  const L = resolveExportLabels(opts.locale).settlements;
  const statusLabel = opts.statusLabel ?? ((s: string) => s);
  const methodLabel = opts.methodLabel ?? ((m: string) => m);

  const header = [
    L.reference,
    L.title,
    L.status,
    L.method,
    L.value,
    L.currency,
    L.counterpartyName,
    L.createdAt,
    L.updatedAt,
  ];

  const rows = settlements.map((s) => [
    s.reference,
    s.title,
    statusLabel(s.status),
    methodLabel(s.method),
    s.value ?? '',
    s.currency ?? '',
    s.counterparty_name ?? '',
    s.created_at,
    s.updated_at,
  ]);

  return buildCsvDocument(header, rows);
}

/**
 * Build a negotiation-rounds CSV string for one (or more) settlements. One row
 * per round with the columns: settlement reference, round_number, proposed_by,
 * proposed_value, currency, outcome. Accepts either a single {@link Settlement}
 * (rounds read from `settlement.rounds`) or an explicit `(reference, rounds)`
 * pairing, so the caller can export rounds it fetched separately.
 */
export function buildSettlementRoundsCsv(
  source: RoundsSource,
  opts: SettlementRoundsCsvOptions = {},
): string {
  const L = resolveExportLabels(opts.locale).rounds;

  const header = [
    L.settlementReference,
    L.roundNumber,
    L.proposedBy,
    L.proposedValue,
    L.currency,
    L.outcome,
  ];

  const groups = normalizeRoundsSource(source);
  const rows: unknown[][] = [];
  for (const { reference, rounds } of groups) {
    for (const round of rounds) {
      rows.push([
        reference,
        round.round_number,
        round.proposed_by,
        round.proposed_value ?? '',
        round.currency ?? '',
        round.outcome ?? '',
      ]);
    }
  }

  return buildCsvDocument(header, rows);
}

// ---------------------------------------------------------------------------
// Download triggers (the integrator calls THESE).
// ---------------------------------------------------------------------------

export interface SettlementsCsvOptions {
  /** Active surface locale; selects the localised header row. Defaults to English. */
  locale?: AppLocale;
  /** Optional resolver for human-readable status (defaults to the raw token). */
  statusLabel?: (status: string) => string;
  /** Optional resolver for human-readable method (defaults to the raw token). */
  methodLabel?: (method: string) => string;
  /** Override the export filename (otherwise a dated default is used). */
  filename?: string;
}

export interface SettlementRoundsCsvOptions {
  /** Active surface locale; selects the localised header row. Defaults to English. */
  locale?: AppLocale;
  /** Override the export filename (otherwise a dated default is used). */
  filename?: string;
}

/** A `(reference, rounds)` pairing for the rounds export. */
export interface SettlementRoundsGroup {
  reference: string;
  rounds: readonly SettlementNegotiationRound[];
}

/**
 * Rounds can be exported from a single loaded settlement (rounds read off
 * `settlement.rounds`), an array of settlements, or explicit reference/rounds
 * groupings the caller assembled itself.
 */
export type RoundsSource = Settlement | readonly Settlement[] | readonly SettlementRoundsGroup[];

function isSettlement(value: Settlement | SettlementRoundsGroup): value is Settlement {
  return 'id' in value && 'status' in value;
}

/** Normalise the polymorphic rounds source into uniform `(reference, rounds)` groups. */
function normalizeRoundsSource(source: RoundsSource): SettlementRoundsGroup[] {
  const items = Array.isArray(source) ? source : [source as Settlement];
  return (items as Array<Settlement | SettlementRoundsGroup>).map((item) =>
    isSettlement(item)
      ? { reference: item.reference, rounds: item.rounds ?? [] }
      : item,
  );
}

/**
 * Build the settlements-register CSV and trigger a client-side download with a
 * dated filename. This is the primary entry the list page wires to its header
 * Export button (pass all loaded settlements) and to the bulk-export action
 * (pass only the selected rows).
 *
 * Returns the number of settlement rows written (useful for a success toast).
 */
export function exportSettlementsCsv(
  settlements: readonly Settlement[],
  opts: SettlementsCsvOptions = {},
): number {
  const csv = buildSettlementsCsv(settlements, opts);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, opts.filename ?? settlementsCsvFilename());
  return settlements.length;
}

/**
 * Build a negotiation-rounds CSV and trigger a client-side download. The default
 * filename embeds the settlement reference when exporting a single settlement;
 * pass `opts.filename` to override (e.g. for a multi-settlement export).
 *
 * Returns the number of round rows written.
 */
export function exportSettlementRoundsCsv(
  source: RoundsSource,
  opts: SettlementRoundsCsvOptions = {},
): number {
  const csv = buildSettlementRoundsCsv(source, opts);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

  const groups = normalizeRoundsSource(source);
  const total = groups.reduce((sum, g) => sum + g.rounds.length, 0);
  const defaultName =
    groups.length === 1
      ? settlementRoundsCsvFilename(groups[0].reference)
      : `settlement-rounds-${dateStamp()}.csv`;

  downloadBlob(blob, opts.filename ?? defaultName);
  return total;
}
