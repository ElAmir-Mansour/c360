'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatNumber } from '@/lib/format/numerals';

export interface KpiAnnouncementItem {
  id: string;
  label: string;
  value: number | string | null | undefined;
}

interface KpiLiveAnnouncerProps {
  items: readonly KpiAnnouncementItem[];
  /** Groups rapid websocket/query updates into one calm screen-reader message. */
  throttleMs?: number;
}

interface PendingChange {
  label: string;
  value: number | string;
}

/**
 * Announces KPI changes without narrating the initial dashboard load. Updates
 * that arrive close together are collapsed by KPI id and spoken as one polite,
 * atomic message instead of a burst of competing live-region updates.
 */
export function KpiLiveAnnouncer({
  items,
  throttleMs = 1_200,
}: KpiLiveAnnouncerProps) {
  const { locale } = useLocaleOrDefault();
  const [announcement, setAnnouncement] = useState('');
  const previousRef = useRef<Map<string, number | string>>(new Map());
  const pendingRef = useRef<Map<string, PendingChange>>(new Map());
  const initializedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const current = new Map<string, number | string>();

    for (const item of items) {
      if (item.value !== null && item.value !== undefined) {
        current.set(item.id, item.value);
      }
    }

    if (!initializedRef.current) {
      previousRef.current = current;
      initializedRef.current = true;
      return;
    }

    for (const item of items) {
      if (item.value === null || item.value === undefined) continue;
      const previous = previousRef.current.get(item.id);
      if (previous !== undefined && previous !== item.value) {
        pendingRef.current.set(item.id, { label: item.label, value: item.value });
      }
    }
    previousRef.current = current;

    if (pendingRef.current.size === 0) return;

    if (timerRef.current) return;

    timerRef.current = setTimeout(() => {
      const changes = Array.from(pendingRef.current.values()).map(({ label, value }) => {
        const localizedValue = typeof value === 'number' ? formatNumber(value, locale) : value;
        return `${label}: ${localizedValue}`;
      });
      pendingRef.current.clear();
      setAnnouncement(
        locale === 'ar'
          ? `تم تحديث لوحة المعلومات. ${changes.join('؛ ')}`
          : `Dashboard updated. ${changes.join('; ')}.`,
      );
      timerRef.current = null;
    }, throttleMs);
  }, [items, locale, throttleMs]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  );
}
