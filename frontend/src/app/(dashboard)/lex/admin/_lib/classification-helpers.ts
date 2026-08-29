/**
 * Pure helpers for the case-classification taxonomy admin page: translation
 * coverage, appearance metadata (colour + icon tokens), import diffing, and
 * snapshot restore payloads. No React, no I/O — every export is deterministic
 * so the page/components can call them inside `useMemo` or mutation bodies.
 */
import {
  Briefcase,
  Building2,
  FileText,
  Gavel,
  Landmark,
  Scale,
  Shield,
  ShieldCheck,
  Tag,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type {
  CaseClassification,
  CreateCaseClassificationPayload,
  UpdateCaseClassificationPayload,
} from '@/lib/lex/admin';

/* --------------------------------------------------------------------------- *
 * Translation coverage (#7)
 * --------------------------------------------------------------------------- */

export type TranslationStatus = 'complete' | 'missing-en' | 'missing-ar' | 'missing-both';

export interface TranslationCoverage {
  total: number;
  complete: number;
  missingEn: number;
  missingAr: number;
  pct: number;
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function nodeTranslationStatus(node: CaseClassification): TranslationStatus {
  const en = hasText(node.name?.en);
  const ar = hasText(node.name?.ar);
  if (en && ar) return 'complete';
  if (!en && !ar) return 'missing-both';
  return en ? 'missing-ar' : 'missing-en';
}

export function buildTranslationCoverage(flat: CaseClassification[]): TranslationCoverage {
  let complete = 0;
  let missingEn = 0;
  let missingAr = 0;
  for (const node of flat) {
    const status = nodeTranslationStatus(node);
    if (status === 'complete') complete += 1;
    if (status === 'missing-en' || status === 'missing-both') missingEn += 1;
    if (status === 'missing-ar' || status === 'missing-both') missingAr += 1;
  }
  const total = flat.length;
  const pct = total === 0 ? 100 : Math.round((complete / total) * 100);
  return { total, complete, missingEn, missingAr, pct };
}

/* --------------------------------------------------------------------------- *
 * Appearance metadata (#10) — colour + icon tokens stored on
 * metadata.appearance ({color, icon}). Colours are semantic Tailwind tokens
 * that resolve in both light and dark themes; never raw hex.
 * --------------------------------------------------------------------------- */

export interface ClassificationColor {
  key: string;
  label: string;
  className: string;
}

export const CLASSIFICATION_COLORS: readonly ClassificationColor[] = [
  { key: 'slate', label: 'Slate', className: 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-300' },
  { key: 'emerald', label: 'Emerald', className: 'bg-success-500/15 text-success-600 dark:text-success-300' },
  { key: 'teal', label: 'Teal', className: 'bg-brand-teal-500/15 text-brand-teal-700 dark:text-brand-teal-300' },
  { key: 'sky', label: 'Deep Teal', className: 'bg-brand-primary-500/15 text-brand-primary-600 dark:text-brand-primary-300' },
  { key: 'indigo', label: 'Dark Teal', className: 'bg-brand-primary-800/15 text-brand-primary-800 dark:text-brand-primary-200' },
  { key: 'amber', label: 'Amber', className: 'bg-warning-500/15 text-warning-700 dark:text-warning-300' },
  { key: 'rose', label: 'Rose', className: 'bg-rose-500/15 text-rose-600 dark:text-rose-300' },
  { key: 'gold', label: 'Gold', className: 'bg-[hsl(var(--gold)/0.15)] text-[hsl(var(--gold))]' },
] as const;

export interface ClassificationIcon {
  key: string;
  label: string;
}

export const CLASSIFICATION_ICONS: readonly ClassificationIcon[] = [
  { key: 'tag', label: 'Tag' },
  { key: 'scale', label: 'Scale' },
  { key: 'gavel', label: 'Gavel' },
  { key: 'file-text', label: 'Document' },
  { key: 'briefcase', label: 'Matter' },
  { key: 'building', label: 'Entity' },
  { key: 'landmark', label: 'Regulatory' },
  { key: 'shield', label: 'Compliance' },
  { key: 'shield-check', label: 'Approved' },
  { key: 'users', label: 'People' },
] as const;

const ICON_MAP: Record<string, LucideIcon> = {
  tag: Tag,
  scale: Scale,
  gavel: Gavel,
  'file-text': FileText,
  briefcase: Briefcase,
  building: Building2,
  landmark: Landmark,
  shield: Shield,
  'shield-check': ShieldCheck,
  users: Users,
};

export function getClassificationIcon(key: string | undefined): LucideIcon {
  return (key ? ICON_MAP[key] : undefined) ?? Tag;
}

export interface ClassificationAppearance {
  color?: string;
  icon?: string;
}

export function readAppearance(node: CaseClassification): ClassificationAppearance {
  const metadata = node.metadata ?? {};
  const nested = metadata.appearance;
  const source =
    nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : metadata;
  const color = source.color;
  const icon = source.icon;
  const result: ClassificationAppearance = {};
  if (hasText(color)) result.color = (color as string).trim();
  if (hasText(icon)) result.icon = (icon as string).trim();
  return result;
}

export function appearanceMetadata(
  existing: Record<string, unknown>,
  next: ClassificationAppearance,
): Record<string, unknown> {
  const base = { ...(existing ?? {}) };
  const appearance: Record<string, unknown> = {};
  if (hasText(next.color)) appearance.color = next.color!.trim();
  if (hasText(next.icon)) appearance.icon = next.icon!.trim();
  if (Object.keys(appearance).length > 0) base.appearance = appearance;
  else delete base.appearance;
  // Drop any legacy top-level color/icon so the nested shape is canonical.
  delete base.color;
  delete base.icon;
  return base;
}

/* --------------------------------------------------------------------------- *
 * Import diff (#8) — mirrors the lightweight normalize used in page.tsx so a
 * dry-run preview can show what an import would create / update / skip.
 * --------------------------------------------------------------------------- */

export type ImportAction = 'create' | 'update' | 'skip';

export interface ImportDiffRow {
  code: string;
  action: ImportAction;
  reason?: string;
  changes?: string[];
}

export interface ImportDiff {
  creates: number;
  updates: number;
  skips: number;
  rows: ImportDiffRow[];
}

function rawString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function rawLocalized(row: Record<string, unknown>, localeKey: 'en' | 'ar'): string {
  const name = row.name;
  if (name && typeof name === 'object' && localeKey in name) {
    const value = (name as Record<string, unknown>)[localeKey];
    return value == null ? '' : String(value).trim();
  }
  return rawString(row, [`name_${localeKey}`, `name.${localeKey}`]);
}

function rawBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'active'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'inactive'].includes(normalized)) return false;
  return undefined;
}

function rawNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
  }
  return undefined;
}

export function buildImportDiff(
  rawRows: Record<string, unknown>[],
  byCode: Map<string, CaseClassification>,
  byId: Map<string, CaseClassification>,
): ImportDiff {
  const rows: ImportDiffRow[] = [];
  let creates = 0;
  let updates = 0;
  let skips = 0;

  rawRows.forEach((raw, index) => {
    const code = rawString(raw, ['code']).toUpperCase();
    if (!code) {
      skips += 1;
      rows.push({ code: code || `Row ${index + 1}`, action: 'skip', reason: 'Missing code.' });
      return;
    }

    const nameEn = rawLocalized(raw, 'en');
    const nameAr = rawLocalized(raw, 'ar');
    if (!nameEn && !nameAr) {
      skips += 1;
      rows.push({ code, action: 'skip', reason: 'Missing English or Arabic name.' });
      return;
    }

    const id = rawString(raw, ['id']);
    const existing = (id ? byId.get(id) : undefined) ?? byCode.get(code);

    if (!existing) {
      creates += 1;
      rows.push({ code, action: 'create' });
      return;
    }

    const parentSpecified =
      Object.prototype.hasOwnProperty.call(raw, 'parent_id') ||
      Object.prototype.hasOwnProperty.call(raw, 'parent_code');
    const parentId = rawString(raw, ['parent_id']);
    const parentCode = rawString(raw, ['parent_code']).toUpperCase();
    const sort = rawNumber(raw.sort);
    const active = rawBool(raw.active);

    const changes: string[] = [];
    if (nameEn && nameEn !== (existing.name.en ?? '')) changes.push('name_en');
    if (nameAr && nameAr !== (existing.name.ar ?? '')) changes.push('name_ar');
    if (sort !== undefined && sort !== existing.sort) changes.push('sort');
    if (active !== undefined && active !== existing.active) changes.push('active');
    if (parentSpecified) {
      const resolvedParent = parentId
        ? parentId
        : parentCode
          ? byCode.get(parentCode)?.id ?? ''
          : '';
      if ((existing.parent_id ?? '') !== resolvedParent) changes.push('parent');
    }

    if (changes.length === 0) {
      skips += 1;
      rows.push({ code, action: 'skip', reason: 'No changes.' });
      return;
    }

    updates += 1;
    rows.push({ code, action: 'update', changes });
  });

  return { creates, updates, skips, rows };
}

/* --------------------------------------------------------------------------- *
 * Snapshot restore (#6) — snapshots are plain CaseClassification objects (with
 * extra snapshot_at/snapshot_reason fields) written via writeSnapshot.
 * --------------------------------------------------------------------------- */

type ClassificationSnapshot = Partial<CaseClassification> & Record<string, unknown>;

function snapshotName(snapshot: ClassificationSnapshot): { en: string; ar: string } {
  const name = snapshot.name as Record<string, unknown> | undefined;
  if (name && typeof name === 'object') {
    return {
      en: hasText(name.en) ? String(name.en).trim() : '',
      ar: hasText(name.ar) ? String(name.ar).trim() : '',
    };
  }
  return { en: '', ar: '' };
}

export function restorePayloadFromSnapshot(
  snapshot: ClassificationSnapshot,
): UpdateCaseClassificationPayload {
  return {
    name: snapshotName(snapshot),
    sort: typeof snapshot.sort === 'number' ? snapshot.sort : 0,
    active: typeof snapshot.active === 'boolean' ? snapshot.active : true,
    parent_id: snapshot.parent_id ?? null,
  };
}

export function createPayloadFromSnapshot(
  snapshot: ClassificationSnapshot,
): CreateCaseClassificationPayload {
  return {
    code: hasText(snapshot.code) ? String(snapshot.code).trim().toUpperCase() : '',
    parent_id: snapshot.parent_id ?? null,
    name: snapshotName(snapshot),
    sort: typeof snapshot.sort === 'number' ? snapshot.sort : 0,
    active: typeof snapshot.active === 'boolean' ? snapshot.active : true,
  };
}
