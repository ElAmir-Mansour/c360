'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAccessToken } from '@/lib/auth';
import { getWsUrl } from '@/lib/env';
import { useCTIStore } from '@/stores/cti-store';
import type { CTIThreatEvent, CTIWebSocketMessage } from '@/types/cti';

type CTIWebSocketStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';
const MAX_RECONNECT_ATTEMPTS = 5;

function buildWebSocketUrl(token: string): string {
  const wsBase = getWsUrl();
  return `${wsBase}/ws/v1/cyber/cti/ws?token=${encodeURIComponent(token)}`;
}

export function useCTIWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const [status, setStatus] = useState<CTIWebSocketStatus>('idle');
  const pushLiveEvent = useCTIStore((state) => state.pushLiveEvent);
  const refreshExecutiveSnapshot = useCTIStore((state) => state.refreshExecutiveSnapshot);

  const scheduleRefresh = useCallback(() => {
    if (refreshRef.current) {
      clearTimeout(refreshRef.current);
    }
    refreshRef.current = setTimeout(() => {
      void refreshExecutiveSnapshot();
    }, 400);
  }, [refreshExecutiveSnapshot]);

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token || typeof window === 'undefined') {
      setStatus('closed');
      return;
    }

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    setStatus('connecting');
    const socket = new WebSocket(buildWebSocketUrl(token));
    wsRef.current = socket;

    socket.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setStatus('connected');
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as CTIWebSocketMessage<CTIThreatEvent>;
        const type = message.type ?? '';

        if (type.includes('threat-event.created') || type.includes('threat-event.updated')) {
          pushLiveEvent(message.data);
          scheduleRefresh();
          return;
        }

        if (
          type.includes('campaign.created') ||
          type.includes('campaign.updated') ||
          type.includes('campaign.status-changed') ||
          type.includes('campaign.event-linked') ||
          type.includes('brand-abuse.detected') ||
          type.includes('brand-abuse.updated') ||
          type.includes('brand-abuse.takedown-changed')
        ) {
          scheduleRefresh();
        }
      } catch (error) {
        window.console.error('[CTI WS] message parse failed', error);
      }
    };

    socket.onerror = (error) => {
      setStatus('error');
      window.console.warn('[CTI WS] connection unavailable; dashboard will continue with polling fallback', error);
    };

    socket.onclose = (event) => {
      setStatus('closed');
      wsRef.current = null;
      if (!mountedRef.current || event.wasClean) {
        return;
      }
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;
        const delay = Math.min(30_000, 1000 * 2 ** (reconnectAttemptsRef.current - 1));
        reconnectRef.current = setTimeout(connect, delay);
      }
    };
  }, [pushLiveEvent, scheduleRefresh]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
      }
      if (refreshRef.current) {
        clearTimeout(refreshRef.current);
      }
      reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return {
    ws: wsRef.current,
    status,
  };
}
