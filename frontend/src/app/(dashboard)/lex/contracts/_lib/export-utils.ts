/**
 * Sovereignty & export utilities for the contracts workspace (§15).
 *
 * `csvWithBom` is the client-side counterpart of the hardened server report
 * (`GET /api/v1/lex/reports/contracts`). Excel on Windows sniffs a CSV file's
 * encoding and, without a byte-order mark, decodes UTF-8 Arabic cells as
 * Windows-1252 mojibake (e.g. «العقد» renders as "Ø§Ù„Ø¹Ù‚Ø¯"). Prepending
 * U+FEFF pins the file to UTF-8 so Arabic titles, parties, and status labels
 * survive the round-trip into spreadsheet tools.
 *
 * The bilingual `serverExportLabels` bundle names the hardened server-side
 * export (BOM + tenant watermark + PDPL redaction applied by lex-service)
 * following the canonical label-object pattern in `contracts-labels.ts`.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/** UTF-8 byte-order mark. Excel requires it to decode Arabic CSV cells. */
export const CSV_BOM = '\uFEFF';

/** RFC 4180 quoting: every cell is quoted and embedded quotes are doubled. */
export function csvEscapeCell(cell: unknown): string {
  return `"${String(cell ?? '').replace(/"/g, '""')}"`;
}

/**
 * Serialises rows (header first) into CSV text prefixed with the UTF-8 BOM.
 * Keeps the `\n` row separator of the previous inline page builder so the
 * output is byte-identical apart from the added BOM — the mojibake fix.
 */
export function csvWithBom(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return CSV_BOM + rows.map((cells) => cells.map(csvEscapeCell).join(',')).join('\n');
}

/** `csvWithBom` wrapped into a `downloadBlob`-ready Blob. */
export function csvBlobWithBom(rows: ReadonlyArray<ReadonlyArray<unknown>>): Blob {
  return new Blob([csvWithBom(rows)], { type: 'text/csv;charset=utf-8;' });
}

/**
 * Date-stamped filename for the server contracts report. Parity with the
 * existing header-export filename on the contracts list page.
 */
export function contractsReportFilename(now: Date = new Date()): string {
  return `contracts-report-${now.toISOString().slice(0, 10)}.csv`;
}

/* ------------------------------------------------------------------------- *
 * Server export (watermarked) — bilingual labels for the menu item that
 * triggers the hardened `/reports/contracts` download.
 * ------------------------------------------------------------------------- */

export interface ServerExportLabels {
  /** Menu-item / button label for the hardened server-side report. */
  serverExport: string;
  /** Hover hint explaining what the server adds over the client CSV. */
  serverExportHint: string;
}

export const serverExportLabels: LexBilingual<ServerExportLabels> = {
  en: {
    serverExport: 'Server export (watermarked)',
    serverExportHint:
      'Full filtered report rendered in-Kingdom: UTF-8 BOM, tenant watermark, and PDPL redaction applied server-side.',
  },
  ar: {
    serverExport: 'تصدير من الخادم (بعلامة مائية)',
    serverExportHint:
      'تقرير كامل مُصفّى يُنشأ داخل المملكة: ترميز UTF-8 مع علامة الترتيب، وعلامة مائية للمستأجر، وإخفاء البيانات وفق نظام حماية البيانات الشخصية من جانب الخادم.',
  },
};

export function useServerExportLabels(): ServerExportLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(serverExportLabels, locale), [locale]);
}
