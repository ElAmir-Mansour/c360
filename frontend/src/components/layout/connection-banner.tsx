'use client';

import { useState, useEffect, useRef } from 'react';
import { WifiOff, RefreshCw, X, CheckCircle2 } from 'lucide-react';
import { useNotificationStore } from '@/stores/notification-store';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatNumber } from '@/lib/format/numerals';
import { cn } from '@/lib/utils';

const BANNER_DISMISSED_KEY = 'clario360_banner_dismissed';

const COPY = {
  en: {
    restored: 'Connection restored.',
    reconnectingIn: (s: string) => `Connection lost. Attempting to reconnect in ${s}s`,
    reconnecting: 'Connection lost. Attempting to reconnect…',
    failed: 'Unable to establish real-time connection. Some features may not update automatically.',
    attempt: (n: string) => `Attempt ${n}`,
    refresh: 'Refresh page',
    dismiss: 'Dismiss banner',
  },
  ar: {
    restored: 'تمت استعادة الاتصال.',
    reconnectingIn: (s: string) => `انقطع الاتصال. تجري إعادة الاتصال خلال ${s} ثانية`,
    reconnecting: 'انقطع الاتصال. تجري إعادة الاتصال…',
    failed: 'تعذّر تأسيس الاتصال المباشر. قد لا تتحدّث بعض الميزات تلقائيًا.',
    attempt: (n: string) => `المحاولة ${n}`,
    refresh: 'تحديث الصفحة',
    dismiss: 'إغلاق الشريط',
  },
} as const;

export function ConnectionBanner() {
  const { locale } = useLocaleOrDefault();
  const copy = COPY[locale] ?? COPY.en;
  const connectionStatus = useNotificationStore((s) => s.connectionStatus);
  const reconnectAttempt = useNotificationStore((s) => s.reconnectAttempt);
  const nextRetryAt = useNotificationStore((s) => s.nextRetryAt);
  const [dismissed, setDismissed] = useState(false);
  const [showRestored, setShowRestored] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const hasConnectedRef = useRef(false);
  const hadConnectionLossRef = useRef(false);

  // Show the success banner only after a real, observed connection loss. The
  // store starts at `disconnected`, so treating the first socket open as a
  // recovery made every fresh page load announce "Connection restored".
  useEffect(() => {
    if (connectionStatus === 'connected') {
      const shouldAnnounce =
        hasConnectedRef.current && hadConnectionLossRef.current;
      hasConnectedRef.current = true;
      hadConnectionLossRef.current = false;

      if (shouldAnnounce) {
        setShowRestored(true);
        const timer = setTimeout(() => setShowRestored(false), 3000);
        return () => clearTimeout(timer);
      }
    } else {
      setShowRestored(false);
      if (
        hasConnectedRef.current &&
        connectionStatus !== 'connecting'
      ) {
        hadConnectionLossRef.current = true;
      }
    }
  }, [connectionStatus]);

  // Dismiss resets on new disconnect cycle
  useEffect(() => {
    if (connectionStatus !== 'connected' && connectionStatus !== 'connecting') {
      const wasDismissed = sessionStorage.getItem(BANNER_DISMISSED_KEY) === '1';
      setDismissed(wasDismissed);
    } else if (connectionStatus === 'connected') {
      sessionStorage.removeItem(BANNER_DISMISSED_KEY);
      setDismissed(false);
    }
  }, [connectionStatus]);

  useEffect(() => {
    if (connectionStatus !== 'reconnecting' || !nextRetryAt) {
      setCountdown(0);
      return;
    }

    const updateCountdown = () => {
      setCountdown(Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000)));
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [connectionStatus, nextRetryAt]);

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(BANNER_DISMISSED_KEY, '1');
  };

  if (showRestored) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-10 items-center justify-center gap-2 bg-primary px-4 text-sm font-medium text-white"
      >
        <CheckCircle2 className="h-4 w-4" />
        {copy.restored}
      </div>
    );
  }

  if (connectionStatus === 'connected' || connectionStatus === 'connecting') {
    return null;
  }

  // `disconnected` is the store's pre-socket bootstrap state. It is not an
  // outage until this page has actually held a live connection once.
  if (connectionStatus === 'disconnected' && !hasConnectedRef.current) {
    return null;
  }

  if (dismissed) return null;

  const isReconnecting = connectionStatus === 'reconnecting';
  const isFailed = connectionStatus === 'failed';

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'sticky top-0 z-50 flex h-10 items-center justify-center gap-3 px-4 text-sm font-medium',
        isReconnecting && 'bg-warning-500 text-white',
        isFailed && 'bg-destructive text-destructive-foreground',
      )}
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-center">
        {isReconnecting
          ? countdown > 0
            ? copy.reconnectingIn(formatNumber(countdown, locale))
            : copy.reconnecting
          : copy.failed}
      </span>
      {isReconnecting && (
        <span className="hidden text-xs sm:inline">
          {copy.attempt(formatNumber(reconnectAttempt, locale))}
        </span>
      )}
      {isFailed && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-white/20"
          >
            <RefreshCw className="h-3 w-3" />
            {copy.refresh}
          </button>
          <button
            onClick={handleDismiss}
            aria-label={copy.dismiss}
            className="rounded p-0.5 hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
