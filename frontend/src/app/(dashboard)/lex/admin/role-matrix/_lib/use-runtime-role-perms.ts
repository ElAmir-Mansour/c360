/**
 * Runtime role-permission source for the Legal Role Matrix.
 *
 * Per design v2 §6 the grid must render from the SAME role permission sets the
 * server enforces, so doc↔runtime drift is visible. This hook fetches the
 * tenant's roles from `/api/v1/roles` (the rows `LegalAffairsRoleSeeder` upserts
 * into `platform_core.roles`), lines them up by slug with the canonical
 * frontend source, and returns:
 *   - `permsByCode`: the EFFECTIVE permission set per role code — the live
 *     tenant's set when the seeded role is found, otherwise the canonical
 *     fallback (so the view still renders before/without seeding);
 *   - `drift`: per-role differences between canonical and live (extra/missing
 *     keys), surfaced as a banner so a mis-seeded tenant is obvious in-product;
 *   - `seeded`: whether any of the 14 legal roles were found on the tenant.
 *
 * The fetch is best-effort: on error or while loading, the canonical source is
 * used and `drift` is empty — the matrix is informational and must never block.
 */
'use client';

import { useMemo } from 'react';
import { useApiQuery } from '@/hooks/use-api';
import type { Role } from '@/types/models';
import type { RoleCode } from './legal-role-matrix';
import {
  CANONICAL_ROLE_PERMS,
  CANONICAL_PERMS_BY_CODE,
  CODE_BY_SLUG,
  diffRolePermissions,
  type RolePermDrift,
} from './legal-role-permissions';

export interface RuntimeRolePerms {
  /** Effective permission set per role code (live tenant, or canonical fallback). */
  permsByCode: Record<RoleCode, readonly string[]>;
  /** Per-role drift findings (empty when everything is in sync). */
  drift: RolePermDrift[];
  /** True once at least one of the 14 legal roles is found on the tenant. */
  seeded: boolean;
  isLoading: boolean;
}

export function useRuntimeRolePerms(): RuntimeRolePerms {
  // Best-effort: never throw, never retry-storm; this view is informational.
  const { data, isLoading } = useApiQuery<Role[]>(['roles'], '/api/v1/roles', {
    retry: false,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const roles = data ?? [];
    const bySlug = new Map(roles.map((r) => [r.slug, r]));

    const permsByCode = { ...CANONICAL_PERMS_BY_CODE } as Record<
      RoleCode,
      readonly string[]
    >;
    const drift: RolePermDrift[] = [];
    let seeded = false;

    for (const canon of CANONICAL_ROLE_PERMS) {
      const live = bySlug.get(canon.slug);
      if (!live) continue;
      seeded = true;
      const code = CODE_BY_SLUG[canon.slug];
      permsByCode[code] = live.permissions;
      const d = diffRolePermissions(code, canon.slug, live.permissions);
      if (d) drift.push(d);
    }

    return { permsByCode, drift, seeded, isLoading };
  }, [data, isLoading]);
}
