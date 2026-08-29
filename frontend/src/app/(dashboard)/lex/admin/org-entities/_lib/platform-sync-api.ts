/**
 * Module-local API surface for the Platform Org-Unit Sync feature.
 *
 * Deliberately NOT part of `@/lib/lex/admin.ts` (the orchestrator owns that and
 * we must not edit it). The endpoint this feature needs —
 *   GET /api/v1/lex/org-entities/platform-units
 * returns the platform-unit references known to the legal registry. The result
 * wrapper keeps "empty but loaded" distinct from "request failed" so the view
 * can render the right state.
 */
import { apiGet } from '@/lib/api';
import { LEX_ADMIN_ENDPOINTS } from '@/lib/lex/admin';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import type { LocalizedText } from '@/types/forms';

/**
 * A node in the platform_core organisation directory. `name` arrives either as
 * a bilingual {@link LocalizedText} object or a bare legacy string; normalise it
 * with {@link platformUnitName} before display.
 */
export interface PlatformOrgUnit {
  id: string;
  code?: string;
  name: LocalizedText | string;
  parent_id?: string | null;
  active: boolean;
}

export interface PlatformOrgUnitsResult {
  units: PlatformOrgUnit[];
  /** True when the backend request failed or returned an unreadable shape. */
  degraded: boolean;
}

/** Endpoint this feature expects the backend to serve. Exported for callers/tests. */
export const PLATFORM_UNITS_ENDPOINT = `${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/platform-units`;

/**
 * Fetch the platform-unit references known to Lex. Never throws; callers use
 * `degraded` to distinguish a failed request from a successful empty registry.
 */
export async function fetchPlatformOrgUnitsResult(): Promise<PlatformOrgUnitsResult> {
  try {
    const res = await apiGet<unknown>(PLATFORM_UNITS_ENDPOINT);
    if (Array.isArray(res)) {
      return { units: res as PlatformOrgUnit[], degraded: false };
    }
    if (res && typeof res === 'object' && Array.isArray((res as { data?: unknown }).data)) {
      return { units: (res as { data: PlatformOrgUnit[] }).data, degraded: false };
    }
    return { units: [], degraded: true };
  } catch {
    return { units: [], degraded: true };
  }
}

/** Contract-shaped convenience wrapper returning just the unit array. */
export async function fetchPlatformOrgUnits(): Promise<PlatformOrgUnit[]> {
  const result = await fetchPlatformOrgUnitsResult();
  return result.units;
}

/**
 * Resolve a platform unit's display name to a plain string for the active
 * locale. Handles both the bilingual object and the bare-string legacy shape via
 * {@link resolveLocalized}.
 */
export function platformUnitName(
  unit: Pick<PlatformOrgUnit, 'name'>,
  locale: AppLocale,
): string {
  return resolveLocalized(unit.name, locale);
}
