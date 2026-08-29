'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { apiGet } from '@/lib/api';
import type { BadgeConfig } from '@/config/navigation';
import { useSidebarStore } from '@/stores/sidebar-store';
import { useRealtimeStore } from '@/stores/realtime-store';

type BadgeMap = Map<string, number | undefined>;

const BASE_POLL_MS = 120_000; // 2 min base (was per-badge 30-60s intervals)

export function useBadgeCounts(configs: BadgeConfig[]): BadgeMap {
  const [counts, setCounts] = useState<BadgeMap>(new Map());
  const collapsed = useSidebarStore((s) => s.collapsed);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  // Stable endpoint signature to avoid re-running effect on every render
  const endpointSignature = useMemo(
    () => configs.map((c) => c.endpoint).join(','),
    [configs],
  );

  // Distinct realtime topics across all badge configs that should trigger an
  // immediate refresh (WebSocket-driven freshness; polling is the fallback).
  const topicList = useMemo(
    () => Array.from(new Set(configs.flatMap((c) => c.topics ?? []))).sort(),
    [endpointSignature], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Deduplicate configs by endpoint
  const uniqueConfigs = useMemo(() => {
    const map = new Map<string, BadgeConfig>();
    for (const cfg of configs) {
      if (!map.has(cfg.endpoint)) {
        map.set(cfg.endpoint, cfg);
      }
    }
    return map;
  }, [endpointSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeEndpoints = useMemo(
    () => new Set(uniqueConfigs.keys()),
    [uniqueConfigs],
  );

  useEffect(() => {
    setCounts((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      for (const endpoint of prev.keys()) {
        if (!activeEndpoints.has(endpoint)) {
          next.delete(endpoint);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeEndpoints]);

  // Single batched fetch for all badge endpoints
  const fetchAll = useCallback(async () => {
    if (!isMountedRef.current) return;

    const entries = Array.from(uniqueConfigs.entries());
    if (entries.length === 0) return;

    const results = await Promise.allSettled(
      entries.map(async ([endpoint, cfg]) => {
        const resp = await apiGet<Record<string, unknown>>(endpoint);
        const payload =
          resp.data && typeof resp.data === 'object'
            ? (resp.data as Record<string, unknown>)
            : resp;
        const value = payload[cfg.key];
        const count = Array.isArray(value) ? value.length : value;
        return {
          endpoint,
          value: typeof count === 'number' ? count : undefined,
        } as const;
      }),
    );

    if (!isMountedRef.current) return;

    setCounts((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const result of results) {
        if (result.status === 'fulfilled' && typeof result.value.value === 'number') {
          if (prev.get(result.value.endpoint) !== result.value.value) {
            next.set(result.value.endpoint, result.value.value);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [uniqueConfigs]);

  // Aggregate event count across the configured topics. Increments whenever a
  // relevant WebSocket event is published, signalling a refresh is warranted.
  const topicSignal = useRealtimeStore((s) =>
    topicList.reduce((sum, topic) => sum + (s.topicEvents[topic]?.count ?? 0), 0),
  );

  // Refetch immediately when a relevant realtime event arrives (skip initial 0).
  const lastSignalRef = useRef(0);
  useEffect(() => {
    if (topicSignal > lastSignalRef.current) {
      lastSignalRef.current = topicSignal;
      void fetchAll();
    }
  }, [topicSignal, fetchAll]);

  useEffect(() => {
    isMountedRef.current = true;

    if (uniqueConfigs.size === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setCounts((prev) => (prev.size === 0 ? prev : new Map()));
      return () => {
        isMountedRef.current = false;
      };
    }

    // Fetch once immediately
    void fetchAll();

    // Single interval for all badges; double interval when sidebar collapsed
    const interval = collapsed ? BASE_POLL_MS * 2 : BASE_POLL_MS;
    intervalRef.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchAll();
    }, interval);

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAll, collapsed, uniqueConfigs.size]);

  return counts;
}
