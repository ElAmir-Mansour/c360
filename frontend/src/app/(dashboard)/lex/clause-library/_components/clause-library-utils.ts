'use client';

import type { LexClauseLibraryEntry } from '@/types/suites';
import type { ClausePrefill } from '../../drafting/_components/clause-prefill';
import type { ClauseTaxonomyLabels } from './clause-taxonomy-labels';

export type ClauseCopyFormat = 'en' | 'ar' | 'bilingual';

export interface ClauseVersionReference {
  key: 'current' | 'supersedes' | 'deprecated_by' | 'replacement';
  label: string;
  field: 'id' | 'supersedes_id' | 'deprecated_by_id' | 'replacement_clause_id';
  id: string | null;
  entry: LexClauseLibraryEntry | null;
  version: number | null;
  status: string | null;
}

export interface ClauseCompareField {
  key: string;
  label: string;
  currentValue: string;
  comparisonValue: string;
  changed: boolean;
}

export const CLAUSE_DRAFTING_PATH = '/lex/drafting';

export function formatClauseVersion(
  version: number | null | undefined,
  taxonomy?: ClauseTaxonomyLabels,
): string {
  if (typeof version === 'number' && Number.isFinite(version)) {
    return `v${version}`;
  }
  return taxonomy?.compare.versionNotSet ?? 'Version not set';
}

export function formatClauseToken(
  value: string | null | undefined,
  taxonomy?: ClauseTaxonomyLabels,
): string {
  if (!value) {
    return taxonomy?.notSet ?? 'Not set';
  }
  return value.replace(/_/g, ' ');
}

export function clauseDisplayTitle(entry: LexClauseLibraryEntry): string {
  return entry.title_en || entry.title_ar || entry.code;
}

export function buildClauseCopyText(entry: LexClauseLibraryEntry, format: ClauseCopyFormat): string {
  if (format === 'en') {
    return joinNonEmpty([entry.title_en, entry.text_en]);
  }

  if (format === 'ar') {
    return joinNonEmpty([entry.title_ar, entry.text_ar]);
  }

  const english = joinNonEmpty([entry.title_en, entry.text_en]);
  const arabic = joinNonEmpty([entry.title_ar, entry.text_ar]);

  return joinNonEmpty([
    entry.code ? `[${entry.code}]` : '',
    english ? `EN\n${english}` : '',
    arabic ? `AR\n${arabic}` : '',
  ]);
}

export function buildClauseDraftingPrefill(entry: LexClauseLibraryEntry): ClausePrefill {
  return {
    title_en: entry.title_en || undefined,
    title_ar: entry.title_ar || undefined,
    text_en: entry.text_en || undefined,
    text_ar: entry.text_ar || undefined,
    clause_type: typeof entry.clause_type === 'string' ? entry.clause_type : undefined,
    risk_level: typeof entry.risk_level === 'string' ? entry.risk_level : undefined,
  };
}

export function tryQueueClauseForDrafting(entry: LexClauseLibraryEntry): boolean {
  // The existing ClausePrefill shape is useful, but its live consumer is the
  // clause-library create flow. Until drafting has an inbound consumer, callers
  // should use the clipboard fallback instead of leaving a stale prefill key.
  void buildClauseDraftingPrefill(entry);
  return false;
}

// English fallbacks used only when no taxonomy is supplied (e.g. the label-less
// `resolveDefaultCompareTarget` path, which never renders these captions).
const DEFAULT_REFERENCE_LABELS: ClauseTaxonomyLabels['compare']['references'] = {
  current: 'Current version',
  supersedes: 'Supersedes',
  deprecated_by: 'Deprecated by',
  replacement: 'Replacement clause',
};

export function getClauseVersionReferences(
  entry: LexClauseLibraryEntry,
  relatedEntries: LexClauseLibraryEntry[] = [],
  taxonomy?: ClauseTaxonomyLabels,
): ClauseVersionReference[] {
  const referenceLabels = taxonomy?.compare.references ?? DEFAULT_REFERENCE_LABELS;
  const relatedById = new Map<string, LexClauseLibraryEntry>(
    [entry, ...relatedEntries].map((item) => [item.id, item]),
  );

  const fromId = (
    key: ClauseVersionReference['key'],
    label: string,
    field: ClauseVersionReference['field'],
    id: string | null | undefined,
  ): ClauseVersionReference => {
    const related = id ? relatedById.get(id) ?? null : null;
    return {
      key,
      label,
      field,
      id: id ?? null,
      entry: related,
      version: related?.version ?? null,
      status: related?.status ?? null,
    };
  };

  return [
    {
      key: 'current',
      label: referenceLabels.current,
      field: 'id',
      id: entry.id,
      entry,
      version: entry.version,
      status: entry.status,
    },
    fromId('supersedes', referenceLabels.supersedes, 'supersedes_id', entry.supersedes_id),
    fromId('deprecated_by', referenceLabels.deprecated_by, 'deprecated_by_id', entry.deprecated_by_id),
    fromId('replacement', referenceLabels.replacement, 'replacement_clause_id', entry.replacement_clause_id),
  ];
}

export function resolveDefaultCompareTarget(
  entry: LexClauseLibraryEntry,
  relatedEntries: LexClauseLibraryEntry[] = [],
): LexClauseLibraryEntry | null {
  const references = getClauseVersionReferences(entry, relatedEntries);
  return (
    references.find((reference) => reference.key !== 'current' && reference.entry)?.entry ??
    null
  );
}

export function buildClauseCompareFields(
  current: LexClauseLibraryEntry,
  comparison: LexClauseLibraryEntry | null,
  taxonomy: ClauseTaxonomyLabels,
): ClauseCompareField[] {
  const { compare, notSet } = taxonomy;
  // Localized display for free-text / list / boolean cells.
  const text = (value: unknown) => displayValue(value, notSet, compare.yes, compare.no);

  // `read` returns the RAW token (used only for change detection); `format`
  // returns the localized display. Enum-valued rows resolve their value through
  // the taxonomy resolvers so no raw token (status/governance/risk/clause type)
  // ever reaches the surface.
  const fields: Array<{
    key: string;
    read: (entry: LexClauseLibraryEntry) => unknown;
    format: (entry: LexClauseLibraryEntry) => string;
  }> = [
    { key: 'version', read: (entry) => entry.version, format: (entry) => formatClauseVersion(entry.version, taxonomy) },
    { key: 'title_en', read: (entry) => entry.title_en, format: (entry) => text(entry.title_en) },
    { key: 'title_ar', read: (entry) => entry.title_ar, format: (entry) => text(entry.title_ar) },
    { key: 'text_en', read: (entry) => entry.text_en, format: (entry) => text(entry.text_en) },
    { key: 'text_ar', read: (entry) => entry.text_ar, format: (entry) => text(entry.text_ar) },
    { key: 'status', read: (entry) => entry.status, format: (entry) => taxonomy.status(entry.status) },
    { key: 'governance_status', read: (entry) => entry.governance_status, format: (entry) => taxonomy.status(entry.governance_status) },
    { key: 'risk_level', read: (entry) => entry.risk_level, format: (entry) => taxonomy.risk(entry.risk_level) },
    { key: 'clause_type', read: (entry) => entry.clause_type, format: (entry) => taxonomy.clauseType(entry.clause_type) },
    { key: 'category', read: (entry) => entry.category, format: (entry) => text(entry.category) },
    { key: 'jurisdiction', read: (entry) => entry.jurisdiction, format: (entry) => text(entry.jurisdiction) },
    { key: 'source', read: (entry) => entry.source, format: (entry) => text(entry.source) },
    { key: 'tags', read: (entry) => entry.tags, format: (entry) => text(entry.tags) },
    { key: 'supersedes_id', read: (entry) => entry.supersedes_id, format: (entry) => text(entry.supersedes_id) },
    { key: 'deprecated_by_id', read: (entry) => entry.deprecated_by_id, format: (entry) => text(entry.deprecated_by_id) },
    { key: 'replacement_clause_id', read: (entry) => entry.replacement_clause_id, format: (entry) => text(entry.replacement_clause_id) },
  ];

  return fields.map((field) => {
    const currentRaw = field.read(current);
    const comparisonRaw = comparison ? field.read(comparison) : null;
    return {
      key: field.key,
      label: compare.captions[field.key] ?? field.key,
      currentValue: field.format(current),
      comparisonValue: comparison ? field.format(comparison) : compare.noComparison,
      // Diff on the RAW tokens (not the localized labels) so a locale switch
      // never changes which rows are flagged as changed.
      changed: comparison ? compareKey(currentRaw) !== compareKey(comparisonRaw) : false,
    };
  });
}

export function summarizeClauseRelation(
  reference: ClauseVersionReference,
  taxonomy?: ClauseTaxonomyLabels,
): string {
  if (!reference.id) {
    return taxonomy?.notSet ?? 'Not set';
  }
  if (!reference.entry) {
    return taxonomy?.compare.notLoaded(reference.id) ?? `${reference.id} (not loaded)`;
  }
  return `${formatClauseVersion(reference.entry.version, taxonomy)} - ${clauseDisplayTitle(reference.entry)}`;
}

function displayValue(value: unknown, notSet: string, yes: string, no: string): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : notSet;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : notSet;
  }

  if (typeof value === 'string') {
    return value.trim() ? value : notSet;
  }

  if (typeof value === 'boolean') {
    return value ? yes : no;
  }

  return notSet;
}

// Normalizes a raw field read to a stable, locale-independent key used purely
// for change detection between two clause versions.
function compareKey(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value);
}

function joinNonEmpty(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}
