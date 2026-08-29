export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapData<T>(payload: unknown): T | undefined {
  if (isRecord(payload) && 'data' in payload) {
    return payload.data as T;
  }
  return payload as T;
}

export function unwrapList<T>(payload: unknown, keys: string[] = []): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!isRecord(payload)) return [];

  const data = payload.data;
  if (Array.isArray(data)) return data as T[];

  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value as T[];
  }

  return [];
}

export function unwrapTotal(payload: unknown, fallback: number): number {
  if (!isRecord(payload)) return fallback;
  if (typeof payload.total === 'number') return payload.total;
  const meta = payload.meta;
  if (isRecord(meta) && typeof meta.total === 'number') return meta.total;
  return fallback;
}

export function parseJsonObjectInput(raw: string, label = 'JSON'): JsonRecord {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const parsed = JSON.parse(trimmed) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

export function parseJsonArrayInput<T = unknown>(raw: string, label = 'JSON'): T[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`);
  }
  return parsed as T[];
}

export function prettyJson(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function readBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
