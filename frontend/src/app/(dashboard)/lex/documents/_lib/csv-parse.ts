/**
 * Dependency-free, RFC-4180-style CSV / TSV parser for the Watheeq legal
 * documents guided bulk-import flow.
 *
 * No `papaparse`/`xlsx` (they are NOT installed). These are small, pure,
 * unit-friendly functions: they take a string in, return plain data out, and
 * have no React / DOM / network dependencies.
 *
 * Supported (RFC-4180 superset):
 *   - quoted fields wrapping the delimiter, newlines, and leading/trailing space
 *   - escaped quotes inside a quoted field (`""` → `"`)
 *   - CRLF (`\r\n`), bare LF (`\n`), and bare CR (`\r`) row terminators
 *   - a leading UTF-8 BOM (stripped)
 *   - auto-detection of comma vs tab as the delimiter
 *   - a header row (first non-empty row), with the remaining rows as records
 */

export type CsvDelimiter = ',' | '\t';

export interface ParsedCsv {
  /** Detected delimiter (`,` or `\t`). */
  delimiter: CsvDelimiter;
  /** Header cells from the first row (trimmed). */
  headers: string[];
  /**
   * Data rows keyed by header name. Short rows are padded with `''`, extra
   * cells beyond the header width are dropped.
   */
  rows: Array<Record<string, string>>;
  /** Raw matrix (header row + data rows) before header-keying. */
  matrix: string[][];
}

/**
 * detectDelimiter inspects the FIRST line of the input and picks the delimiter
 * with the higher count outside of quotes. Tabs win ties only when there is at
 * least one tab; otherwise the default is a comma.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = firstPhysicalLine(stripBom(text));
  let commas = 0;
  let tabs = 0;
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const ch = firstLine[i];
    if (ch === '"') {
      // Skip an escaped quote pair so it does not flip the quote state.
      if (inQuotes && firstLine[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === ',') commas += 1;
    else if (ch === '\t') tabs += 1;
  }
  if (tabs > 0 && tabs >= commas) return '\t';
  return ',';
}

/**
 * parseDelimited tokenises the full document into a matrix of string cells,
 * honouring quoted fields, escaped quotes, and CRLF/LF/CR row terminators. The
 * delimiter is passed in (use {@link detectDelimiter} to choose it).
 *
 * Trailing empty lines are dropped. A row that is a single empty cell (a blank
 * physical line) is skipped so stray newlines do not create phantom records.
 */
export function parseDelimited(text: string, delimiter: CsvDelimiter): string[][] {
  const input = stripBom(text);
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false; // whether the current row has any content/cells yet

  const pushField = () => {
    row.push(field);
    field = '';
    started = true;
  };
  const pushRow = () => {
    pushField();
    // Skip rows that are entirely empty (a single blank field).
    if (!(row.length === 1 && row[0] === '')) {
      matrix.push(row);
    }
    row = [];
    started = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      started = true;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      continue;
    }
    if (ch === '\r') {
      // Treat CRLF and bare CR as a single row terminator.
      pushRow();
      if (input[i + 1] === '\n') i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      continue;
    }
    field += ch;
    started = true;
  }

  // Flush a trailing field/row if the file does not end with a newline.
  if (started || field !== '' || row.length > 0) {
    pushRow();
  }

  return matrix;
}

/**
 * parseCsv is the high-level entry point: it auto-detects the delimiter (unless
 * one is forced), parses the matrix, then keys data rows by the trimmed header
 * names. Duplicate header names keep the LAST occurrence's column when keying
 * (matrix access remains positional).
 */
export function parseCsv(text: string, forced?: CsvDelimiter): ParsedCsv {
  const delimiter = forced ?? detectDelimiter(text);
  const matrix = parseDelimited(text, delimiter);

  if (matrix.length === 0) {
    return { delimiter, headers: [], rows: [], matrix };
  }

  const headers = matrix[0].map((cell) => cell.trim());
  const rows: Array<Record<string, string>> = [];
  for (let r = 1; r < matrix.length; r += 1) {
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) {
      record[headers[c]] = matrix[r][c] ?? '';
    }
    rows.push(record);
  }

  return { delimiter, headers, rows, matrix };
}

/**
 * normalizeHeaderKey lowercases a header, strips spaces / underscores / dashes,
 * so fuzzy auto-mapping can compare `Source Record ID`, `source_record_id`, and
 * `sourceRecordId` as equal.
 */
export function normalizeHeaderKey(header: string): string {
  return header.toLowerCase().replace(/[\s_\-]+/g, '').trim();
}

/**
 * splitTagsCell splits a raw tag cell on `;` or `,`, trims, and drops empties.
 */
export function splitTagsCell(cell: string): string[] {
  return cell
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function firstPhysicalLine(text: string): string {
  const nl = text.search(/[\r\n]/);
  return nl === -1 ? text : text.slice(0, nl);
}
