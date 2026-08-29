'use client';

/**
 * useEntitySiblings resolves the previous/next organization ids relative to
 * `currentId`, for the entity-detail toolbar's prev/next navigation (#2).
 *
 * MIRRORS THE LIST PAGE'S DEFAULT VIEW — the Entity-360 register is aggregated
 * entirely client-side by `useEntities()` (see `entities/_lib/entity-data.ts`)
 * and `aggregateEntities()` returns a DETERMINISTIC order: total SAR exposure
 * desc, then record count desc, then name asc. The list page renders that array
 * as-is under no search/filter, so neighbours here match the row order a user
 * last saw on the (default) list.
 *
 * There is no dedicated counterparty-master endpoint and no server "index of id"
 * query — this hook simply reuses the SAME `['lex-entities', …]` React-Query
 * caches the detail page already populated (no extra network round-trip) and
 * finds `currentId` in the aggregated list. If it is not present (a stale/renamed
 * org, or an active search on the list the user navigated from), both neighbours
 * resolve to `null` and the prev/next buttons disable — an acceptable degrade,
 * not an error. The hook never throws.
 */

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useEntities } from '../../_lib/entity-data';

export interface UseEntitySiblingsResult {
  prevId: string | null;
  nextId: string | null;
  isLoading: boolean;
}

export function useEntitySiblings(currentId: string): UseEntitySiblingsResult {
  const { locale } = useLocaleOrDefault();
  const { entities, isLoading } = useEntities(locale);

  const index = entities.findIndex((e) => e.id === currentId);
  if (index === -1) {
    return { prevId: null, nextId: null, isLoading };
  }

  return {
    prevId: index > 0 ? entities[index - 1].id : null,
    nextId: index < entities.length - 1 ? entities[index + 1].id : null,
    isLoading,
  };
}
