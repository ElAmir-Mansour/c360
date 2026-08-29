import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { lexAdminApi } from '@/lib/lex/admin';
import type { SLATarget } from '@/lib/lex/admin';

/**
 * service-sla — Feature 4 data layer for the step-1 service picker.
 *
 * A requester building a "New Legal Request" wants to see the turnaround
 * promise (working days) for each service tile. The SLA targets live behind an
 * ADMIN endpoint (`lexAdminApi.listSLATargets`), so a plain requester will get
 * a 403. This module fetches them FAIL-SOFT: it never throws, never retries,
 * and resolves to an empty map on any error — the picker must keep working with
 * no SLA badge rather than break.
 *
 * The integrator owns all bilingual copy (e.g. "X working days" / "X يوم عمل");
 * here we only expose the raw turnaround numbers, keyed by service code so the
 * card can look its own SLA up in O(1).
 */

/**
 * Turnaround per priority tier for one service code. `normal`/`urgent` carry the
 * upper-bound deadline (`turnaround_working_days`) — the historical single figure,
 * kept stable for existing consumers. `normalFrom`/`urgentFrom` add the lower bound
 * (`turnaround_working_days_from`) so a tile can render the full From–To window.
 */
export interface ServiceSlaDays {
  /** Upper-bound `turnaround_working_days` for the `normal` priority target, if defined. */
  normal?: number;
  /** Upper-bound `turnaround_working_days` for the `urgent` priority target, if defined. */
  urgent?: number;
  /** Lower-bound `turnaround_working_days_from` for the `normal` target, if defined. */
  normalFrom?: number;
  /** Lower-bound `turnaround_working_days_from` for the `urgent` target, if defined. */
  urgentFrom?: number;
}

/** Map keyed by `SLATarget.service_code` → per-priority turnaround days. */
export type ServiceSlaMap = ReadonlyMap<string, ServiceSlaDays>;

export interface UseServiceSlaTargetsResult {
  /**
   * SLA turnaround days keyed by `SLATarget.service_code`. Empty when the
   * requester lacks admin permission (403) or no targets are configured.
   */
  slaByCode: ServiceSlaMap;
  /** True while the (fail-soft) fetch is in flight. */
  isLoading: boolean;
}

/** Query key for the requester-side, fail-soft SLA fetch. */
export const SERVICE_SLA_QUERY_KEY = ['lex-service-sla-targets'] as const;

/**
 * Build the `service_code → { normal?, urgent? }` map from a flat list of SLA
 * targets. Only `active` targets contribute; later actives for the same
 * (code, priority) win (last-write — the list is small and admin-curated).
 */
function buildSlaMap(targets: readonly SLATarget[]): ServiceSlaMap {
  const map = new Map<string, ServiceSlaDays>();
  for (const target of targets) {
    if (!target.active) continue;
    const existing = map.get(target.service_code) ?? {};
    map.set(target.service_code, {
      ...existing,
      [target.priority]: target.turnaround_working_days,
      [`${target.priority}From`]: target.turnaround_working_days_from,
    });
  }
  return map;
}

const EMPTY_SLA_MAP: ServiceSlaMap = new Map<string, ServiceSlaDays>();

/**
 * useServiceSlaTargets — fail-soft hook returning SLA turnaround days keyed by
 * service code, for the step-1 service catalog cards.
 *
 * - Calls `lexAdminApi.listSLATargets({ page: 1, per_page: 200 })`.
 * - `retry: false`: a 403 (requester without admin perms) is a normal outcome,
 *   not a transient failure to retry.
 * - On ANY error the query resolves to an empty list (never throws / blocks the
 *   picker), so `slaByCode` is simply empty and no SLA badge is shown.
 */
export function useServiceSlaTargets(): UseServiceSlaTargetsResult {
  const query = useQuery({
    queryKey: SERVICE_SLA_QUERY_KEY,
    queryFn: async (): Promise<readonly SLATarget[]> => {
      try {
        const res = await lexAdminApi.listSLATargets({ page: 1, per_page: 200 });
        return res.data;
      } catch {
        // Fail-soft: a requester without admin perms gets 403 — the picker must
        // keep working with no SLA badge rather than surface an error.
        return [];
      }
    },
    retry: false,
  });

  const slaByCode = useMemo(
    () => (query.data ? buildSlaMap(query.data) : EMPTY_SLA_MAP),
    [query.data],
  );

  return { slaByCode, isLoading: query.isLoading };
}
