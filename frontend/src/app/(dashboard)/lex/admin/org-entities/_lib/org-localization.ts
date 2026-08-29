/**
 * Pure compute for the bilingual completeness QA panel (Watheeq / Saudi).
 *
 * Given the flat list of {@link OrgEntity} records returned by
 * `lexAdminApi.listOrgEntities`, this module scans every localizable string —
 * the entity `name` and each `role.label` — and reports which side of the
 * bilingual {@link LocalizedText} pair (ar / en) is missing.
 *
 * A localized string is "complete" only when BOTH `en` and `ar` are non-empty
 * after trimming. Anything else is a gap; if exactly one side is filled we
 * record that gap (carrying the side that IS present so the UI can preview it).
 * If BOTH sides are empty we still surface it as a gap (defaulting the missing
 * side to `ar`, with an empty present string) so an entirely-unlabelled record
 * is never silently treated as localized.
 *
 * Everything here is framework-free and side-effect-free so it can be unit
 * tested in isolation and reused by the QA UI.
 */
import type { OrgEntity } from '@/lib/lex/admin';
import type { LocalizedText } from '@/types/forms';

/** What kind of string a gap was found on. */
export type LocalizationScope = 'entity_name' | 'role_label';

/** Which bilingual side is absent. */
export type LocalizationSide = 'ar' | 'en';

/**
 * A single bilingual-completeness gap on one localizable string.
 */
export interface LocalizationGap {
  /** Owning entity id (used for the deep-link to the edit form). */
  entityId: string;
  /** Owning entity code (human-facing identifier). */
  entityCode: string;
  /** Whether the gap is on the entity name or a role label. */
  scope: LocalizationScope;
  /** The role key when `scope === 'role_label'`. */
  roleKey?: string;
  /** The side that is MISSING. */
  missing: LocalizationSide;
  /** The text of the side that IS filled (may be '' when both sides empty). */
  present: string;
}

/** Coverage percentages and counts driving the KPI strip. */
export interface LocalizationCoverage {
  /** Share of entity NAMES that are fully bilingual, 0..100, rounded. */
  entitiesPct: number;
  /** Share of ROLE LABELS that are fully bilingual, 0..100, rounded. */
  rolesPct: number;
  /** Share of ALL localizable strings (names + labels) complete, 0..100. */
  overallPct: number;
  /** Total localizable strings scanned (names + role labels). */
  total: number;
  /** Count of localizable strings that are fully bilingual. */
  complete: number;
}

/** Result of a full scan: the flat gap list plus aggregate coverage. */
export interface LocalizationScanResult {
  items: LocalizationGap[];
  coverage: LocalizationCoverage;
}

/** Trimmed-empty test for a single string. */
function isBlank(value: string | undefined | null): boolean {
  return !value || value.trim().length === 0;
}

function percent(complete: number, total: number): number {
  return total === 0 ? 100 : Math.round((complete / total) * 100);
}

/**
 * Inspect one {@link LocalizedText} pair and return the gap (if any).
 * Returns `null` when both sides are filled (complete).
 */
function inspectPair(
  text: LocalizedText,
): { missing: LocalizationSide; present: string } | null {
  const enBlank = isBlank(text.en);
  const arBlank = isBlank(text.ar);

  if (!enBlank && !arBlank) {
    return null; // complete
  }
  if (enBlank && !arBlank) {
    return { missing: 'en', present: text.ar.trim() };
  }
  if (arBlank && !enBlank) {
    return { missing: 'ar', present: text.en.trim() };
  }
  // Both blank — surface as a gap so the record is never silently "localized".
  return { missing: 'ar', present: '' };
}

/**
 * Scan all `entities` for bilingual-completeness gaps across entity names and
 * role labels, returning the ordered gap list plus aggregate coverage.
 */
export function scanLocalization(
  entities: readonly OrgEntity[],
): LocalizationScanResult {
  const items: LocalizationGap[] = [];

  let entityTotal = 0;
  let entityComplete = 0;
  let roleTotal = 0;
  let roleComplete = 0;

  for (const entity of entities) {
    // Entity name -----------------------------------------------------------
    entityTotal += 1;
    const nameGap = inspectPair(entity.name);
    if (nameGap) {
      items.push({
        entityId: entity.id,
        entityCode: entity.code,
        scope: 'entity_name',
        missing: nameGap.missing,
        present: nameGap.present,
      });
    } else {
      entityComplete += 1;
    }

    // Role labels -----------------------------------------------------------
    for (const role of entity.roles ?? []) {
      roleTotal += 1;
      const labelGap = inspectPair(role.label);
      if (labelGap) {
        items.push({
          entityId: entity.id,
          entityCode: entity.code,
          scope: 'role_label',
          roleKey: role.role_key,
          missing: labelGap.missing,
          present: labelGap.present,
        });
      } else {
        roleComplete += 1;
      }
    }
  }

  const total = entityTotal + roleTotal;
  const complete = entityComplete + roleComplete;

  return {
    items,
    coverage: {
      entitiesPct: percent(entityComplete, entityTotal),
      rolesPct: percent(roleComplete, roleTotal),
      overallPct: percent(complete, total),
      total,
      complete,
    },
  };
}
