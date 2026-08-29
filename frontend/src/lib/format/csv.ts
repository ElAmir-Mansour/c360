/**
 * Locale-aware CSV export — the canonical helper behind table "Export → CSV"
 * actions.
 *
 * What it localizes:
 *  - HEADER ROW: column headers may be plain strings (pass an
 *    already-localized label), `{ en, ar }` bilingual objects, or i18n-registry
 *    keys (`headerKey` + a namespace) — resolved through
 *    `@/lib/i18n/registry`, defaulting to the shared 'table' namespace.
 *  - BOOLEANS: rendered via the 'table' namespace's `export.yes` / `export.no`.
 *  - EMPTY CELLS: `null` / `undefined` render as an empty field (machine-safe).
 *
 * What it deliberately does NOT localize: numbers and dates. CSV is a data
 * interchange format — numbers stay ASCII with `.` decimals and dates stay
 * ISO-8601 so Excel/Sheets and downstream parsers read them regardless of the
 * viewer's locale. (Digit shaping belongs to on-screen rendering via
 * `useFormat`.)
 *
 * `downloadCsv` prepends a UTF-8 BOM so Excel opens Arabic content correctly.
 *
 * Pure (buildCsv) and SSR-safe; only `downloadCsv` touches the DOM.
 */

import { DEFAULT_LOCALE, type AppLocale } from '@/lib/i18n';
import { readNamespaceMessage } from '@/lib/i18n/registry';
// Side-effect import: guarantees the 'table' namespace (yes/no labels,
// header strings) is registered before any resolution below.
import { TABLE_NAMESPACE } from '@/lib/i18n/table-messages';

/** A CSV column: where the value comes from and how the header is labelled. */
export interface CsvColumn<TRow> {
  /** Row property read when no `value` accessor is given. */
  key: string;
  /**
   * Header label: an already-localized string or a bilingual `{ en, ar }`
   * object resolved against the export locale.
   */
  header?: string | { en: string; ar: string };
  /**
   * Alternatively, an i18n-registry key (dot-path) resolved in
   * `headerNamespace` (option) — e.g. `headerKey: 'pagination.rowsPerPage'`.
   */
  headerKey?: string;
  /** Custom accessor when the cell is not a direct row property. */
  value?: (row: TRow) => unknown;
}

export interface BuildCsvOptions {
  /** Locale used for header/boolean localization. Defaults to the app default (ar). */
  locale?: AppLocale;
  /** Registry namespace for `headerKey` columns. Defaults to 'table'. */
  headerNamespace?: string;
  /** Field delimiter. Defaults to ','. */
  delimiter?: string;
}

/**
 * RFC 4180 field escaping: quote when the field contains the delimiter, a
 * quote, or a line break; double any embedded quotes.
 */
export function csvEscape(field: string, delimiter = ','): string {
  if (
    field.includes(delimiter) ||
    field.includes('"') ||
    field.includes('\n') ||
    field.includes('\r')
  ) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function resolveHeader<TRow>(
  column: CsvColumn<TRow>,
  locale: AppLocale,
  namespace: string,
): string {
  if (column.headerKey) {
    const resolved = readNamespaceMessage(namespace, locale, column.headerKey);
    if (resolved !== undefined) return resolved;
  }
  if (typeof column.header === 'string') return column.header;
  if (column.header) {
    const side = locale === 'ar' ? column.header.ar : column.header.en;
    return side || column.header.en || column.header.ar;
  }
  return column.headerKey ?? column.key;
}

function serializeCell(value: unknown, locale: AppLocale): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') {
    return (
      readNamespaceMessage(TABLE_NAMESPACE, locale, value ? 'export.yes' : 'export.no') ??
      (value ? 'Yes' : 'No')
    );
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeCell(item, locale)).join('; ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Build a CSV document (CRLF rows, escaped fields, localized header row) from
 * rows + column definitions.
 */
export function buildCsv<TRow>(
  rows: readonly TRow[],
  columns: readonly CsvColumn<TRow>[],
  options: BuildCsvOptions = {},
): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const namespace = options.headerNamespace ?? TABLE_NAMESPACE;
  const delimiter = options.delimiter ?? ',';

  const headerLine = columns
    .map((column) => csvEscape(resolveHeader(column, locale, namespace), delimiter))
    .join(delimiter);

  const dataLines = rows.map((row) =>
    columns
      .map((column) => {
        const raw = column.value
          ? column.value(row)
          : (row as Record<string, unknown>)[column.key];
        return csvEscape(serializeCell(raw, locale), delimiter);
      })
      .join(delimiter),
  );

  return [headerLine, ...dataLines].join('\r\n');
}

/**
 * Trigger a browser download of CSV text. Prepends the UTF-8 BOM so Excel
 * detects the encoding and renders Arabic headers/cells correctly.
 * Client-only (uses the DOM).
 */
export function downloadCsv(filename: string, csvText: string): void {
  const blob = new Blob([`\uFEFF${csvText}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
