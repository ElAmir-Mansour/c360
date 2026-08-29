'use client';

import { useMemo } from 'react';
import {
  Clock,
  LogIn,
  Upload,
  AlertTriangle,
  CheckSquare,
  Settings,
  FileText,
  Activity,
  Inbox,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { API_ENDPOINTS } from '@/lib/constants';
import { subDays, formatISO } from 'date-fns';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import type { AppLocale } from '@/lib/i18n';
import { useFormat, type AppFormatter } from '@/lib/format/index';
import { formatNumber } from '@/lib/format/numerals';
import { Button } from '@/components/ui/button';
import { isApiError, type PaginatedResponse } from '@/types/api';
import type { AuditLog } from '@/types/models';
import { statusVar, type StatusTone } from '@/lib/design-tokens';
import { apiGet } from '@/lib/api';
import { useDashboardViewPreferences } from './widget-board/dashboard-preferences-context';

const COPY = {
  en: {
    title: 'Live Activity',
    eventCount: (total: number) => `${total} event${total === 1 ? '' : 's'}`,
    unavailableTitle: 'Activity unavailable',
    unavailableDescription: 'Your current role has limited audit access.',
    loadError: 'Failed to load activity',
    retry: 'Retry',
    emptyTitle: 'All quiet',
    emptyDescription: (days: number) => `No recent activity in the last ${days} days.`,
  },
  ar: {
    title: 'النشاط المباشر',
    eventCount: (total: number) => `${formatNumber(total, 'ar')} حدثًا`,
    unavailableTitle: 'النشاط غير متاح',
    unavailableDescription: 'دورك الحالي يملك وصولًا محدودًا إلى سجل التدقيق.',
    loadError: 'تعذّر تحميل النشاط',
    retry: 'إعادة المحاولة',
    emptyTitle: 'لا توجد مستجدات',
    emptyDescription: (days: number) =>
      `لا يوجد نشاط حديث خلال آخر ${formatNumber(days, 'ar')} يومًا.`,
  },
} as const;

const ACTION_LABELS: Record<string, { en: string; ar: string }> = {
  'alert.counted': { en: 'Alert Counted', ar: 'تم عد التنبيه' },
  'alert.stats.viewed': { en: 'Alert Stats Viewed', ar: 'تم عرض إحصاءات التنبيهات' },
  'alert.listed': { en: 'Alert Listed', ar: 'تم عرض قائمة التنبيهات' },
  'cyber.alert.counted': { en: 'Alert Counted', ar: 'تم عد التنبيه' },
  'cyber.alert.stats.viewed': { en: 'Alert Stats Viewed', ar: 'تم عرض إحصاءات التنبيهات' },
  'cyber.alert.listed': { en: 'Alert Listed', ar: 'تم عرض قائمة التنبيهات' },
  'alert.created': { en: 'Alert Created', ar: 'تم إنشاء التنبيه' },
  'alert.escalated': { en: 'Alert Escalated', ar: 'تم تصعيد التنبيه' },
  'user.login': { en: 'User Login', ar: 'تسجيل دخول مستخدم' },
  'file.uploaded': { en: 'File Uploaded', ar: 'تم رفع ملف' },
  'task.created': { en: 'Task Created', ar: 'تم إنشاء مهمة' },
  'task.updated': { en: 'Task Updated', ar: 'تم تحديث مهمة' },
  'workflow.created': { en: 'Workflow Created', ar: 'تم إنشاء سير عمل' },
  'settings.updated': { en: 'Settings Updated', ar: 'تم تحديث الإعدادات' },
  'document.created': { en: 'Document Created', ar: 'تم إنشاء مستند' },
  'contract.created': { en: 'Contract Created', ar: 'تم إنشاء عقد' },
};

const AR_ACTION_TERMS: Record<string, string> = {
  alert: 'تنبيه',
  alerts: 'التنبيهات',
  counted: 'تم العد',
  stats: 'الإحصاءات',
  viewed: 'تم العرض',
  listed: 'تم عرض القائمة',
  created: 'تم الإنشاء',
  updated: 'تم التحديث',
  escalated: 'تم التصعيد',
  login: 'تسجيل الدخول',
  upload: 'رفع',
  uploaded: 'تم الرفع',
  file: 'ملف',
  task: 'مهمة',
  workflow: 'سير العمل',
  settings: 'الإعدادات',
  document: 'مستند',
  contract: 'عقد',
};

const AR_RESOURCE_TYPES: Record<string, string> = {
  alert: 'تنبيه',
  alerts: 'تنبيهات',
  file: 'ملف',
  task: 'مهمة',
  workflow: 'سير عمل',
  document: 'مستند',
  contract: 'عقد',
  user: 'مستخدم',
};

function pickActivityCopy(locale: AppLocale) {
  return locale === 'ar' ? COPY.ar : COPY.en;
}

function normalizeActionKey(action: string): string {
  return action.trim().toLowerCase().replace(/[_\s]+/g, '.');
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function humanizeEnglishAction(action: string): string {
  return titleCase(action.replace(/[_\\.]+/g, ' ').trim());
}

function humanizeArabicAction(action: string): string {
  const parts = action
    .replace(/[_\\.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '';
  return parts.map((part) => AR_ACTION_TERMS[part.toLowerCase()] ?? part).join(' · ');
}

/* Severity tone mapping based on action type */
function getActionSeverityTone(action: string): StatusTone {
  if (action.includes('alert') || action.includes('escalat') || action.includes('breach')) return 'error';
  if (action.includes('fail') || action.includes('error') || action.includes('reject')) return 'error';
  if (action.includes('task') || action.includes('workflow') || action.includes('create')) return 'warning';
  if (action.includes('update') || action.includes('settings') || action.includes('login')) return 'info';
  if (action.includes('complet') || action.includes('resolv') || action.includes('approv')) return 'success';
  return 'info';
}

function getActionIcon(action: string) {
  if (action.includes('login')) return LogIn;
  if (action.includes('upload') || action.includes('file')) return Upload;
  if (action.includes('alert')) return AlertTriangle;
  if (action.includes('task') || action.includes('workflow')) return CheckSquare;
  if (action.includes('settings') || action.includes('update')) return Settings;
  if (action.includes('document') || action.includes('contract')) return FileText;
  return Clock;
}

function formatAction(log: AuditLog, locale: AppLocale): string {
  const normalized = normalizeActionKey(log.action);
  const action =
    ACTION_LABELS[normalized]?.[locale] ??
    (locale === 'ar' ? humanizeArabicAction(log.action) : humanizeEnglishAction(log.action));
  if (log.resource_id) {
    const resourceType =
      locale === 'ar'
        ? AR_RESOURCE_TYPES[log.resource_type?.toLowerCase?.() ?? ''] ?? log.resource_type
        : log.resource_type;
    return `${action}: ${resourceType} ${log.resource_id.slice(0, 8)}`;
  }
  return action;
}

function formatActivityRelativeTime(
  date: string | Date | null | undefined,
  formatRelative: AppFormatter['formatRelative'],
): string {
  try {
    return formatRelative(date) || '—';
  } catch {
    return '—';
  }
}

/* Timeline dot with severity glow */
function TimelineDot({ action }: { action: string }) {
  const tone = getActionSeverityTone(action);

  return (
    <div className="relative flex h-3 w-3 flex-shrink-0 items-center justify-center">
      <div
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: `0 0 8px hsl(var(--status-${tone}) / 0.4)` }}
      />
      <div
        className="relative z-[1] h-3 w-3 rounded-full"
        style={{ backgroundColor: statusVar(tone) }}
      />
    </div>
  );
}

/* Live pulsing dot */
function LiveDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span
        className="absolute inline-flex h-full w-full rounded-full opacity-75"
        style={{
          backgroundColor: statusVar('success'),
          animation: 'live-dot-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
        }}
      />
      <span
        className="relative inline-flex h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: statusVar('success') }}
      />
    </span>
  );
}

/* Skeleton loading item */
function SkeletonItem({ index }: { index: number }) {
  return (
    <div
      className="flex items-start gap-3 px-4 py-3"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="mt-1 flex items-center gap-2.5">
        <div className="h-3 w-3 rounded-full bg-border skeleton-shimmer" />
        <div className="h-7 w-7 rounded-full bg-border skeleton-shimmer" />
      </div>
      <div className="flex-1 space-y-2">
        <div
          className="h-3.5 rounded skeleton-shimmer bg-border"
          style={{ width: `${65 + (index % 3) * 10}%` }}
        />
        <div
          className="h-2.5 w-[30%] rounded skeleton-shimmer bg-border"
        />
      </div>
    </div>
  );
}

export function ActivityTimeline() {
  const { user } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const formatter = useFormat();
  const copy = pickActivityCopy(locale);
  const { horizonDays } = useDashboardViewPreferences();
  const activityStart = useMemo(
    () => formatISO(subDays(new Date(), horizonDays)),
    [horizonDays],
  );

  const { data, error, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'activity', horizonDays],
    queryFn: () =>
      apiGet<PaginatedResponse<AuditLog>>(API_ENDPOINTS.AUDIT_LOGS, {
        user_id: user?.id,
        per_page: 20,
        date_from: activityStart,
      }),
    enabled: !!user?.id,
    refetchInterval: (activeQuery) =>
      isDashboardPermissionDenied(activeQuery.state.error) ? false : 120000,
    retry: (failureCount, queryError) => {
      if (isDashboardPermissionDenied(queryError)) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const logs = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const permissionDenied = isDashboardPermissionDenied(error);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
      className="flex flex-col rounded-2xl border border-border/60"
      style={{
        background: 'hsl(var(--card) / 0.6)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
      dir={direction}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{copy.title}</h3>
          {!permissionDenied && <LiveDot />}
        </div>
        {!isLoading && total > 0 && (
          <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {copy.eventCount(total)}
          </span>
        )}
      </div>

      {/* Scrollable content — focusable so keyboard users can scroll it (WCAG 2.1.1). */}
      <div
        className="relative overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        style={{ maxHeight: 380 }}
        tabIndex={0}
        role="region"
        aria-label={copy.title}
      >
        {/* Vertical timeline line */}
        {!isLoading && logs.length > 0 && (
          <div
            className="absolute top-3 bottom-3"
            style={{
              left: 21,
              width: 1,
              backgroundColor: 'hsl(var(--border))',
            }}
          />
        )}

        {/* Loading */}
        {isLoading && (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonItem key={i} index={i} />
            ))}
          </div>
        )}

        {/* Permission limited */}
        {permissionDenied && !isLoading && (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-success/[0.08]">
              <Inbox className="h-[22px] w-[22px]" style={{ color: statusVar('success') }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-muted-foreground">{copy.unavailableTitle}</p>
              <p className="mt-0.5 text-xs text-muted-foreground/70">
                {copy.unavailableDescription}
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {isError && !permissionDenied && !isLoading && (
          <div className="flex flex-col items-center gap-2 px-4 py-8">
            <p className="text-sm text-muted-foreground">{copy.loadError}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="h-auto rounded-md bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
            >
              {copy.retry}
            </Button>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && !permissionDenied && logs.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-success/[0.08]">
              <Inbox className="h-[22px] w-[22px]" style={{ color: statusVar('success') }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-muted-foreground">{copy.emptyTitle}</p>
              <p className="mt-0.5 text-xs text-muted-foreground/70">
                {copy.emptyDescription(horizonDays)}
              </p>
            </div>
          </div>
        )}

        {/* Event list */}
        {!isLoading && !isError && !permissionDenied && logs.length > 0 && (
          <AnimatePresence initial={false}>
            {logs.map((log) => {
              const Icon = getActionIcon(log.action);
              return (
                <motion.div
                  key={log.id}
                  layout
                  initial={{ opacity: 0, x: -20, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: 'auto' }}
                  exit={{ opacity: 0, x: 20, height: 0 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                  className="overflow-hidden"
                >
                  <div className="relative flex items-start gap-3 px-4 py-3">
                    <div className="mt-1 flex flex-shrink-0 items-center gap-2.5">
                      <TimelineDot action={log.action} />
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/60">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{formatAction(log, locale)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatActivityRelativeTime(log.created_at, formatter.formatRelative)}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
}

function isDashboardPermissionDenied(error: unknown): boolean {
  return isApiError(error) && error.status === 403;
}
