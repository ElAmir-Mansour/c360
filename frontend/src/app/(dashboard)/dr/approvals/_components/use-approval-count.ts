'use client';

import { useMemo } from 'react';
import { useDRFailbackRuns, useDRFailoverRuns } from '../../_hooks/use-dr-queries';
import { itemsNeedingApproval, type ApprovalItem } from '../../_lib/collaboration';

/**
 * Live count of recovery decisions awaiting a `dr:write` operator's approval.
 *
 * Reuses the SAME shared query hooks (`useDRFailoverRuns` / `useDRFailbackRuns`,
 * keys `['clario-dr','failover-runs']` / `['clario-dr','failback-runs']`) and the
 * SAME `itemsNeedingApproval` selector the inbox page renders, so the badge count
 * and the visible queue can never disagree — they read one cache entry each.
 *
 * Exposed standalone (no UI) so the DR layout/nav can badge the Approvals entry
 * later WITHOUT this build touching layout/nav. It is intentionally cheap: the
 * heavy work is a memoised pure fold over already-cached lists.
 */
export interface ApprovalCount {
  /** Number of pending approvals (0 when nothing is awaiting). */
  count: number;
  /** The pending items themselves, oldest-waiting first (shared with the page). */
  items: ApprovalItem[];
  /** True while either underlying list is loading and no data has arrived yet. */
  isLoading: boolean;
  /** True when either underlying list failed to load. */
  isError: boolean;
}

export function useApprovalCount(): ApprovalCount {
  const failoverQuery = useDRFailoverRuns();
  const failbackQuery = useDRFailbackRuns();

  const items = useMemo(
    () => itemsNeedingApproval(failoverQuery.data ?? [], failbackQuery.data ?? []),
    [failoverQuery.data, failbackQuery.data],
  );

  const isLoading =
    (failoverQuery.isLoading && failoverQuery.data === undefined) ||
    (failbackQuery.isLoading && failbackQuery.data === undefined);

  return {
    count: items.length,
    items,
    isLoading,
    isError: Boolean(failoverQuery.error) || Boolean(failbackQuery.error),
  };
}
