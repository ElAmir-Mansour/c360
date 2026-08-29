'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatNumber } from '@/lib/format/numerals';
import { API_ENDPOINTS } from '@/lib/constants';
import { useDashboardRealtimeData } from './use-dashboard-realtime-data';
import { useDashboardText } from './dashboard-i18n';
import { useDashboardViewPreferences } from './widget-board/dashboard-preferences-context';
import type { DashboardAlertThreshold } from './widget-board/layout-utils';
import { Button } from '@/components/ui/button';

interface AlertStats {
  by_severity: Array<{ name: string; count: number }>;
  open_count: number;
}

const PROMOTED_SEVERITIES: Record<DashboardAlertThreshold, readonly string[]> = {
  critical: ['critical'],
  high: ['critical', 'high'],
  medium: ['critical', 'high', 'medium'],
};

export function promotedSeverities(
  threshold: DashboardAlertThreshold,
): readonly string[] {
  return PROMOTED_SEVERITIES[threshold];
}

export function CriticalAlertsBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { hasPermission } = useAuth();
  const { locale } = useLocaleOrDefault();
  const t = useDashboardText();
  const { alertThreshold } = useDashboardViewPreferences();
  const hasCyber = hasPermission('cyber:read');

  const { data: envelope, isLoading } = useDashboardRealtimeData<{ data: AlertStats }>(
    API_ENDPOINTS.CYBER_ALERTS_STATS,
    {
      wsTopics: ['alert.created', 'alert.escalated', 'alert.resolved'],
      enabled: hasCyber,
    },
  );

  const stats = envelope?.data;
  const severityMap = Object.fromEntries(
    (stats?.by_severity ?? []).map((s) => [s.name, s.count]),
  );
  const criticalCount = severityMap['critical'] ?? 0;
  const highCount = severityMap['high'] ?? 0;
  const mediumCount = severityMap['medium'] ?? 0;
  const promotedCounts: Record<string, number> = {
    critical: criticalCount,
    high: highCount,
    medium: mediumCount,
  };
  const totalPromoted = promotedSeverities(alertThreshold).reduce(
    (total, severity) => total + promotedCounts[severity],
    0,
  );
  const isVisible = hasCyber && !isLoading && totalPromoted > 0 && !dismissed;

  const severityLabels: Record<string, string> = {
    critical: t.banner.criticalAlerts,
    high: t.banner.highSeverity,
    medium: t.banner.mediumSeverity,
  };
  const pills = promotedSeverities(alertThreshold)
    .filter((severity) => promotedCounts[severity] > 0)
    .map((severity) => ({
      label: severityLabels[severity],
      count: promotedCounts[severity],
      href: `/cyber/alerts?severity=${severity}`,
    }));

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.35, ease: 'easeInOut' }}
          style={{ overflow: 'hidden' }}
        >
          <div
            className="rounded-2xl px-5 py-3"
            style={{
              background: 'linear-gradient(135deg, #DC2626, #991B1B)',
              animation: 'critical-pulse 2.5s ease-in-out infinite',
            }}
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {/* Left: icon + message */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <AlertTriangle className="h-[18px] w-[18px] text-white" />
                </div>
                <span className="text-sm font-semibold text-white whitespace-nowrap">
                  <bdi>{formatNumber(totalPromoted, locale)}</bdi> {t.banner.itemsRequireAttention}
                </span>
              </div>

              {/* Center: quick-action pills */}
              <div className="flex items-center gap-2 flex-wrap">
                {pills.map((pill) => (
                  <Link key={pill.href} href={pill.href}>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-card/[0.18] px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-card/30">
                      <bdi>{formatNumber(pill.count, locale)}</bdi> {pill.label}
                      <ArrowRight className="h-3 w-3 rtl:-scale-x-100" />
                    </span>
                  </Link>
                ))}
              </div>

              {/* Right: dismiss button */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setDismissed(true)}
                className="h-8 min-h-8 w-8 min-w-8 flex-shrink-0 rounded-lg hover:bg-card/15"
                aria-label={t.banner.dismiss}
              >
                <X className="h-[18px] w-[18px] text-white" />
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
