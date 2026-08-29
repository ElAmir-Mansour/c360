/**
 * Role-matrix template parser — turns an uploaded XLSX/CSV/JSON template into
 * the normalized {@link RoleMatrixImportPayload} pieces (roster + grants).
 *
 * Grid contract (matches the server template): a header row
 * `domain | permission | <role-slug> | <role-slug> | …` followed by one row per
 * permission key; a cell counts as GRANTED when it contains X/x/✓/1/true. The
 * XLSX path is multi-sheet aware (finds the sheet whose name contains "grants",
 * and optionally a "roles" roster sheet) so both the server-generated
 * single-sheet grid AND the rich documentation template parse. This is
 * deserialization only — the SERVER re-validates everything on import.
 */

import type {
  RoleMatrixImportRolePayload,
} from '@/lib/lex/admin';

export interface ParsedRoleMatrixFile {
  grants: Record<string, string[]>;
  roles: RoleMatrixImportRolePayload[];
}

const GRANT_MARKS = new Set(['x', '✓', '✔', 'true', '1', 'yes']);

function isGrantMark(value: string): boolean {
  return GRANT_MARKS.has(value.trim().toLowerCase());
}

function isPermissionKey(value: string): boolean {
  return /^[a-z][a-z0-9_-]*(:[a-z][a-z0-9_*-]*){1,2}$/.test(value.trim().toLowerCase());
}

function readFile(file: File, as: 'text'): Promise<string>;
function readFile(file: File, as: 'arrayBuffer'): Promise<ArrayBuffer>;
function readFile(file: File, as: 'text' | 'arrayBuffer'): Promise<string | ArrayBuffer> {
  return as === 'text' ? file.text() : file.arrayBuffer();
}

/* ------------------------------------------------------------------------- *
 * Grid → payload
 * ------------------------------------------------------------------------- */

/**
 * parseGrantsMatrix locates the header row (the one whose second column is
 * "permission" — tolerant of the label variants in the rich template), reads
 * the role slugs from the remaining header cells, then collects X-marked cells.
 * Rows whose permission cell is not a `a:b[:c]` key (section banners, "(auto)"
 * baseline rows) are skipped.
 */
function parseGrantsMatrix(matrix: string[][]): Record<string, string[]> {
  let headerIndex = -1;
  for (let i = 0; i < Math.min(matrix.length, 10); i += 1) {
    const second = (matrix[i]?.[1] ?? '').trim().toLowerCase();
    if (second === 'permission' || second === 'permission slug' || second.startsWith('permission')) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new Error('grants grid header row not found (expected a "permission" column)');
  }
  const header = matrix[headerIndex];
  const slugs: Array<{ column: number; slug: string }> = [];
  for (let column = 2; column < header.length; column += 1) {
    const slug = (header[column] ?? '').trim().toLowerCase();
    if (slug) slugs.push({ column, slug });
  }
  if (slugs.length === 0) {
    throw new Error('grants grid has no role columns');
  }

  const grants: Record<string, string[]> = {};
  for (const { slug } of slugs) grants[slug] = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const permission = (row[1] ?? '').trim().toLowerCase();
    if (!permission || !isPermissionKey(permission)) continue;
    for (const { column, slug } of slugs) {
      if (isGrantMark(row[column] ?? '')) {
        grants[slug].push(permission);
      }
    }
  }
  return grants;
}

/** parseRolesMatrix reads an optional roster sheet (header row contains "slug"). */
function parseRolesMatrix(matrix: string[][]): RoleMatrixImportRolePayload[] {
  let headerIndex = -1;
  for (let i = 0; i < Math.min(matrix.length, 10); i += 1) {
    if ((matrix[i] ?? []).some((cell) => cell.trim().toLowerCase() === 'slug')) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) return [];
  const header = (matrix[headerIndex] ?? []).map((cell) => cell.trim().toLowerCase());
  const col = (...names: string[]) => {
    for (const name of names) {
      const index = header.indexOf(name);
      if (index !== -1) return index;
    }
    return -1;
  };
  const columns = {
    code: col('code'),
    slug: col('slug'),
    nameEn: col('role (en)', 'name_en', 'name (en)'),
    nameAr: col('role (ar)', 'name_ar', 'name (ar)'),
    tier: col('tier'),
    orgUnit: col('org unit / section', 'org_unit', 'org unit'),
    reportsTo: col('reports to', 'reports_to'),
    escalation: col('escalation', 'escalation_level'),
    isSystem: col('is_system', 'is system'),
    active: col('active'),
  };
  const cell = (row: string[], index: number) => (index >= 0 ? (row[index] ?? '').trim() : '');
  const yes = (value: string, fallback: boolean) => {
    const v = value.trim().toLowerCase();
    if (!v) return fallback;
    return v === 'yes' || v === 'true' || v === '1';
  };
  const roles: RoleMatrixImportRolePayload[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const slug = cell(row, columns.slug).toLowerCase();
    if (!slug) continue;
    const escalationRaw = cell(row, columns.escalation).replace(/^l/i, '');
    roles.push({
      code: cell(row, columns.code).toUpperCase() || undefined,
      slug,
      name_en: cell(row, columns.nameEn),
      name_ar: cell(row, columns.nameAr) || undefined,
      tier: cell(row, columns.tier) || undefined,
      org_unit: cell(row, columns.orgUnit) || undefined,
      reports_to: cell(row, columns.reportsTo) || undefined,
      escalation_level: Number.parseInt(escalationRaw, 10) || 0,
      is_system: yes(cell(row, columns.isSystem), false),
      active: yes(cell(row, columns.active), true),
    });
  }
  return roles;
}

/* ------------------------------------------------------------------------- *
 * XLSX (multi-sheet, jszip + DOMParser — same technique as the org import)
 * ------------------------------------------------------------------------- */

interface WorkbookSheet {
  name: string;
  matrix: string[][];
}

async function workbookSheets(file: File): Promise<WorkbookSheet[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await readFile(file, 'arrayBuffer'));
  const parser = new DOMParser();

  const shared: string[] = [];
  const sharedFile = zip.file('xl/sharedStrings.xml');
  if (sharedFile) {
    const doc = parser.parseFromString(await sharedFile.async('text'), 'application/xml');
    doc.querySelectorAll('si').forEach((node) => shared.push(node.textContent ?? ''));
  }

  // Map sheet name → worksheet target via workbook.xml + its relationships.
  const workbookFile = zip.file('xl/workbook.xml');
  if (!workbookFile) throw new Error('not an XLSX workbook');
  const workbookDoc = parser.parseFromString(await workbookFile.async('text'), 'application/xml');
  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  const relTargets = new Map<string, string>();
  if (relsFile) {
    const relsDoc = parser.parseFromString(await relsFile.async('text'), 'application/xml');
    relsDoc.querySelectorAll('Relationship').forEach((node) => {
      const id = node.getAttribute('Id') ?? '';
      const target = node.getAttribute('Target') ?? '';
      if (id && target) relTargets.set(id, target.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'));
    });
  }

  const sheets: WorkbookSheet[] = [];
  const sheetNodes = Array.from(workbookDoc.querySelectorAll('sheets > sheet'));
  for (let index = 0; index < sheetNodes.length; index += 1) {
    const node = sheetNodes[index];
    const name = node.getAttribute('name') ?? `sheet${index + 1}`;
    const relId = node.getAttribute('r:id') ?? node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '';
    const target = relTargets.get(relId) ?? `xl/worksheets/sheet${index + 1}.xml`;
    const worksheet = zip.file(target);
    if (!worksheet) continue;
    const doc = parser.parseFromString(await worksheet.async('text'), 'application/xml');
    if (doc.querySelector('parsererror')) continue;
    const matrix: string[][] = [];
    doc.querySelectorAll('sheetData > row').forEach((rowNode) => {
      const rowNumber = Number(rowNode.getAttribute('r')) || matrix.length + 1;
      const values: string[] = [];
      rowNode.querySelectorAll('c').forEach((cellNode) => {
        const reference = cellNode.getAttribute('r') ?? '';
        const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A';
        let column = 0;
        for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
        const raw = cellNode.querySelector('v')?.textContent ?? cellNode.querySelector('is')?.textContent ?? '';
        values[column - 1] = cellNode.getAttribute('t') === 's' ? shared[Number(raw)] ?? '' : raw;
      });
      matrix[rowNumber - 1] = values;
    });
    // Normalize sparse rows to dense string arrays.
    for (let i = 0; i < matrix.length; i += 1) {
      matrix[i] = Array.from(matrix[i] ?? [], (value) => value ?? '');
    }
    sheets.push({ name, matrix });
  }
  return sheets;
}

/* ------------------------------------------------------------------------- *
 * CSV (grants grid only — hand-rolled quoted parser, matching the org import)
 * ------------------------------------------------------------------------- */

function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/* ------------------------------------------------------------------------- *
 * Entry point
 * ------------------------------------------------------------------------- */

export async function parseRoleMatrixFile(file: File): Promise<ParsedRoleMatrixFile> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.json')) {
    const parsed = JSON.parse(await readFile(file, 'text')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as {
        grants?: Record<string, string[]>;
        roles?: RoleMatrixImportRolePayload[];
        headers?: string[];
        rows?: string[][];
      };
      // Server-template JSON shape {headers, rows} → grid parse.
      if (Array.isArray(record.headers) && Array.isArray(record.rows)) {
        return { grants: parseGrantsMatrix([record.headers, ...record.rows]), roles: [] };
      }
      if (record.grants && typeof record.grants === 'object') {
        return { grants: record.grants, roles: Array.isArray(record.roles) ? record.roles : [] };
      }
    }
    throw new Error('JSON import must be a {grants, roles?} payload or a {headers, rows} grid');
  }
  if (lower.endsWith('.csv')) {
    return { grants: parseGrantsMatrix(csvRows(await readFile(file, 'text'))), roles: [] };
  }
  const sheets = await workbookSheets(file);
  if (sheets.length === 0) throw new Error('the workbook contains no readable sheets');
  const grantsSheet =
    sheets.find((sheet) => sheet.name.toLowerCase().includes('grant')) ?? sheets[0];
  const rolesSheet = sheets.find((sheet) => sheet.name.toLowerCase().includes('role') && sheet !== grantsSheet);
  return {
    grants: parseGrantsMatrix(grantsSheet.matrix),
    roles: rolesSheet ? parseRolesMatrix(rolesSheet.matrix) : [],
  };
}
