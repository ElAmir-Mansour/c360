'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useRealtimeStore } from '@/stores/realtime-store';
import { useNotificationStore } from '@/stores/notification-store';
import type { ConnectionStatus, Notification } from '@/types/models';
import { apiGet } from '@/lib/api';
import { isApiError } from '@/types/api';

/**
 * Slow safety-net polling while the websocket is unavailable. Dashboard data
 * remains useful during an outage without continuously polling alongside a
 * healthy realtime connection.
 */
export const DASHBOARD_FALLBACK_POLL_MS = 60_000;

interface UseDashboardRealtimeDataOptions {
  wsTopics?: string[];
  onNewItem?: (notification: Notification) => void;
  params?: Record<string, unknown>;
  refreshOnFocus?: boolean;
  pollInterval?: number;
  enabled?: boolean;
}

interface UseDashboardRealtimeDataResult<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  isValidating: boolean;
  isPermissionDenied: boolean;
  mutate: () => Promise<void>;
  lastUpdate: Date | null;
  connectionStatus: ConnectionStatus;
  isFallbackPolling: boolean;
}

export function useDashboardRealtimeData<T>(
  url: string,
  options: UseDashboardRealtimeDataOptions = {},
): UseDashboardRealtimeDataResult<T> {
  const {
    wsTopics = [],
    onNewItem,
    params,
    pollInterval = 0,
    enabled = true,
  } = options;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasConnectedRef = useRef(false);
  const previousConnectionRef = useRef<ConnectionStatus | null>(null);
  const onNewItemRef = useRef(onNewItem);
  onNewItemRef.current = onNewItem;
  const connectionStatus = useNotificationStore((state) => state.connectionStatus);

  const topicSignature = wsTopics.join('|');
  const stableTopics = useMemo(
    () => (topicSignature ? topicSignature.split('|') : []),
    [topicSignature],
  );

  const queryKey = useMemo(() => (params ? [url, params] : [url]), [url, params]);
  const queryKeyString = JSON.stringify(queryKey);
  const usesRealtime = stableTopics.length > 0;
  const isFallbackPolling =
    enabled && usesRealtime && connectionStatus !== 'connected';

  const query: UseQueryResult<T, unknown> = useQuery<T, unknown>({
    queryKey,
    queryFn: () => apiGet<T>(url, params),
    refetchInterval: (activeQuery) =>
      getDashboardRefetchInterval(
        activeQuery.state.error,
        pollInterval,
        isFallbackPolling,
      ),
    refetchIntervalInBackground: false,
    // The shared client deliberately disables focus refresh globally. Dashboard
    // queries opt back in so a stale tab reconciles as soon as the user returns.
    refetchOnWindowFocus: options.refreshOnFocus ?? true,
    refetchOnReconnect: true,
    enabled,
    retry: (failureCount, error) => {
      if (isDashboardPermissionDenied(error)) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const { register, unregister } = useRealtimeStore();
  const queryEvent = useRealtimeStore((state) => state.queryEvents[queryKeyString]);
  const { refetch } = query;
  const permissionDenied = isDashboardPermissionDenied(query.error);
  const lastUpdate = query.dataUpdatedAt > 0 ? new Date(query.dataUpdatedAt) : null;

  useEffect(() => {
    if (!enabled || permissionDenied || stableTopics.length === 0) return;

    for (const topic of stableTopics) {
      register(topic, queryKeyString);
    }

    return () => {
      for (const topic of stableTopics) {
        unregister(topic, queryKeyString);
      }
    };
  }, [stableTopics, queryKeyString, register, unregister, enabled, permissionDenied]);

  useEffect(() => {
    if (!queryEvent || !enabled || permissionDenied) {
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      void refetch();
      if (onNewItemRef.current && isNotificationPayload(queryEvent.payload)) {
        onNewItemRef.current(queryEvent.payload);
      }
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [enabled, permissionDenied, refetch, queryEvent]);

  // A recovered socket may have missed events while it was down. Reconcile
  // once on a genuine re-open, but not on the initial connection bootstrap.
  useEffect(() => {
    const previous = previousConnectionRef.current;
    previousConnectionRef.current = connectionStatus;

    if (connectionStatus !== 'connected') {
      return;
    }
    if (
      previous &&
      previous !== 'connected' &&
      enabled &&
      !permissionDenied &&
      (hasConnectedRef.current || query.isError)
    ) {
      void refetch();
    }
    hasConnectedRef.current = true;
  }, [connectionStatus, enabled, permissionDenied, query.isError, refetch]);

  const mutate = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: query.data,
    error: query.error ?? undefined,
    isLoading: query.isLoading,
    isValidating: query.isFetching,
    isPermissionDenied: permissionDenied,
    mutate,
    lastUpdate,
    connectionStatus,
    isFallbackPolling,
  };
}

function isDashboardPermissionDenied(error: unknown): boolean {
  return isApiError(error) && error.status === 403;
}

export function getDashboardRefetchInterval(
  error: unknown,
  requestedInterval: number,
  needsFallback: boolean,
): number | false {
  if (isDashboardPermissionDenied(error)) {
    return false;
  }
  if (requestedInterval > 0) {
    return requestedInterval;
  }
  return needsFallback ? DASHBOARD_FALLBACK_POLL_MS : false;
}

function isNotificationPayload(payload: unknown): payload is Notification {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  return 'id' in payload && 'title' in payload && 'body' in payload && 'category' in payload;
}
