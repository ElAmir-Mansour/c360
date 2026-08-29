'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Active-runbook selection sourced from the URL `?runbook=` search param — the
 * smallest real alternative to a (non-existent) runbook LIST endpoint, as the
 * Wave-E foundation documented.
 *
 * `@/lib/clario-dr` exposes only `createDRRunbook` (POST), `fetchDRRunbook(id)`
 * (GET) and `updateDRRunbook(id)` (PUT) — the studio-runbooks collection has NO
 * GET, so there is no list to browse. Instead the active runbook id lives in the
 * URL (mirroring the shared `useDRSelection` `?group=`/`?stream=` pattern) so the
 * selection is deep-linkable and survives navigation; `useDRRunbook(id)` is driven
 * off it. `createRunbook` returns the new runbook, so a freshly authored runbook
 * can be selected by writing its id to the param without needing a catalogue.
 *
 * If a browsable catalogue is later required, add a real `GET /studio/runbooks`
 * to `@/lib/clario-dr` + `CLARIO_DR_ENDPOINTS.studioRunbooks` and a
 * `useDRRunbooks()` query keyed `['clario-dr', 'runbooks']` first.
 */

const RUNBOOK_PARAM = 'runbook';

export interface UseRunbookSelectionResult {
  /** Raw `?runbook=` value (null when unset). */
  runbookId: string | null;
  /** Write `?runbook=` (pass null/'' to clear). */
  setRunbook: (runbookId: string | null) => void;
}

export function useRunbookSelection(): UseRunbookSelectionResult {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? '';

  const raw = searchParams?.get(RUNBOOK_PARAM)?.trim() ?? '';
  const runbookId = raw && raw !== 'null' && raw !== 'undefined' ? raw : null;

  const setRunbook = useCallback(
    (nextRunbookId: string | null) => {
      const params = new URLSearchParams(search);
      const normalized = nextRunbookId?.trim() ?? '';
      if (!normalized) {
        params.delete(RUNBOOK_PARAM);
      } else {
        params.set(RUNBOOK_PARAM, normalized);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, search],
  );

  return { runbookId, setRunbook };
}
