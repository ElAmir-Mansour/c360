import type {
  OrgEntityType,
  OrgRolePayload,
  OrgRoleKey,
  OrgStructureImportRow,
  OrgEmployeeMapping,
} from '@/lib/lex/admin';

type FlatRow = Record<string, unknown>;

function readFile(file: File, mode: 'text'): Promise<string>;
function readFile(file: File, mode: 'arrayBuffer'): Promise<ArrayBuffer>;
function readFile(file: File, mode: 'text' | 'arrayBuffer'): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    if (mode === 'text') reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function bool(value: unknown): boolean | undefined {
  const normalized = text(value).toLowerCase();
  if (!normalized) return undefined;
  return !['false', '0', 'no', 'inactive'].includes(normalized);
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (!text(value)) return {};
  const parsed = JSON.parse(text(value)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('metadata_json must be a JSON object');
  return parsed as Record<string, unknown>;
}

function roles(value: unknown): OrgRolePayload[] {
  if (Array.isArray(value)) return value as OrgRolePayload[];
  if (!text(value)) return [];
  const parsed = JSON.parse(text(value)) as unknown;
  if (!Array.isArray(parsed)) throw new Error('roles_json must be a JSON array');
  return parsed as OrgRolePayload[];
}

function employees(value: unknown): OrgEmployeeMapping[] {
  if (Array.isArray(value)) return value as OrgEmployeeMapping[];
  if (!text(value)) return [];
  const parsed = JSON.parse(text(value)) as unknown;
  if (!Array.isArray(parsed)) throw new Error('employees_json must be a JSON array');
  return parsed as OrgEmployeeMapping[];
}

function normalizeRow(source: FlatRow, index: number): OrgStructureImportRow {
  const nestedName = source.name && typeof source.name === 'object'
    ? source.name as Record<string, unknown>
    : {};
  const parsedRoles = roles(source.roles ?? source.roles_json);
  const simpleRoleKey = text(source.role_key);
  const simpleRoleHolder = text(source.role_holder_user_id);
  if (simpleRoleKey || simpleRoleHolder) {
    if (!simpleRoleKey || !simpleRoleHolder) {
      throw new Error(`Row ${Number(source.row) || index + 2}: role_key and role_holder_user_id must be provided together`);
    }
    parsedRoles.push({
      role_key: simpleRoleKey as OrgRoleKey,
      user_id: simpleRoleHolder,
      label: { en: simpleRoleKey.replaceAll('_', ' '), ar: simpleRoleKey.replaceAll('_', ' ') },
    });
  }
  return {
    row: Number(source.row) || index + 2,
    code: text(source.code).toUpperCase(),
    parent_code: text(source.parent_code).toUpperCase() || undefined,
    entity_type: (text(source.entity_type) || 'department') as OrgEntityType,
    name: {
      en: text(source.name_en ?? nestedName.en),
      ar: text(source.name_ar ?? nestedName.ar),
    },
    active: bool(source.active),
    platform_org_unit_id: text(source.platform_org_unit_id) || undefined,
    manager_user_id: text(source.manager_user_id) || undefined,
    roles: parsedRoles,
    employees: employees(source.employees ?? source.employees_json),
    metadata: jsonObject(source.metadata ?? source.metadata_json),
  };
}

async function workbookRows(file: File): Promise<FlatRow[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await readFile(file, 'arrayBuffer'));
  const worksheet = zip.file('xl/worksheets/sheet1.xml');
  if (!worksheet) throw new Error('The XLSX workbook does not contain a first worksheet.');
  const parser = new DOMParser();
  const sharedFile = zip.file('xl/sharedStrings.xml');
  const shared: string[] = [];
  if (sharedFile) {
    const doc = parser.parseFromString(await sharedFile.async('text'), 'application/xml');
    doc.querySelectorAll('si').forEach((node) => shared.push(node.textContent ?? ''));
  }
  const doc = parser.parseFromString(await worksheet.async('text'), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The XLSX worksheet is malformed.');
  const matrix: string[][] = [];
  doc.querySelectorAll('sheetData > row').forEach((rowNode) => {
    const rowNumber = Number(rowNode.getAttribute('r')) || matrix.length + 1;
    const values: string[] = [];
    rowNode.querySelectorAll('c').forEach((cell) => {
      const reference = cell.getAttribute('r') ?? '';
      const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A';
      let column = 0;
      for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
      const raw = cell.querySelector('v')?.textContent ?? cell.querySelector('is')?.textContent ?? '';
      values[column - 1] = cell.getAttribute('t') === 's' ? shared[Number(raw)] ?? '' : raw;
    });
    matrix[rowNumber - 1] = values;
  });
  const headers = (matrix[0] ?? []).map((value) => value.trim().toLowerCase());
  return matrix.slice(1).map((values, index) => Object.fromEntries([
    ['row', index + 2],
    ...headers.map((header, column) => [header, values?.[column]?.trim() ?? '']),
  ])).filter((row) => Object.entries(row).some(([key, value]) => key !== 'row' && text(value)));
}

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

async function parsedCsvRows(file: File): Promise<FlatRow[]> {
  const matrix = csvRows(await readFile(file, 'text'));
  const headers = (matrix.shift() ?? []).map((value) => value.trim().toLowerCase());
  return matrix
    .map((values, index) => Object.fromEntries([
      ['row', index + 2],
      ...headers.map((header, column) => [header, values[column]?.trim() ?? '']),
    ]))
    .filter((row) => Object.entries(row).some(([key, value]) => key !== 'row' && text(value)));
}

export async function parseOrgStructureFile(file: File): Promise<OrgStructureImportRow[]> {
  let raw: FlatRow[];
  if (file.name.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(await readFile(file, 'text')) as unknown;
    if (!Array.isArray(parsed)) throw new Error('JSON import must be an array of organizational entities.');
    raw = parsed.filter((value): value is FlatRow => Boolean(value) && typeof value === 'object');
  } else if (file.name.toLowerCase().endsWith('.csv')) {
    raw = await parsedCsvRows(file);
  } else {
    raw = await workbookRows(file);
  }
  return raw.map(normalizeRow);
}
