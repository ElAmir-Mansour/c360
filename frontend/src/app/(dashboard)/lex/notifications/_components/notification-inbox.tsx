'use client';

/**
 * NotificationInbox — the durable in-app legal-affairs inbox (CAP-156), lifted to
 * the premium Lex list surface.
 *
 * Layout: a <LexListShell> with
 *   - a computed <LexKpiStrip> (unread / total / read / top category),
 *   - a filter container (category select, unread-only, refresh) in the shell's
 *     filter slot, and "mark all read" as the hero action,
 *   - a timeline-style body: rows grouped by day (Today / Yesterday / Earlier),
 *     each row color-coded per category via a category accent, with a unified
 *     category chip and KSA-localized relative time.
 *
 * Loading -> <LexListSkeleton> (via the shell); empty -> <LexEmptyState> (via the
 * shell) with a real CTA ("Adjust filters"). Bilingual title/body are server
 * {ar,en} LocalizedText resolved via resolveLocalized; chrome strings come from
 * the feature label hook. RTL-safe (logical spacing; the accent bar uses border-s
 * so it flips in Arabic; the open arrow mirrors).
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CheckCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  FileText,
  Gavel,
  Handshake,
  RefreshCw,
  Scale,
  CalendarClock,
  CheckCircle2,
  Inbox,
  MailOpen,
  Tags,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LexListShell } from '@/components/lex/list-shell';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import { showApiError, showSuccess } from '@/lib/toast';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  LEX_NOTIFICATION_CATEGORIES,
  lexNotificationsApi,
  type LexNotificationCategory,
  type LexNotificationInboxItem,
} from '@/lib/lex/notifications';
import type { NotificationsLabels } from '../_lib/notifications-labels';

const CATEGORY_ICON: Record<LexNotificationCategory, LucideIcon> = {
  request: FileText,
  case: Scale,
  hearing: CalendarClock,
  judgment: Gavel,
  contract: Handshake,
  general: Bell,
};

/**
 * Per-category accent. Each entry spells out FULL, literal Tailwind classes
 * (Tailwind's JIT only sees complete strings) for the inline-start accent bar,
 * the icon-disc tint and the unread background wash. Logical `border-s-*` flips
 * automatically in Arabic mode.
 */
interface CategoryAccent {
  bar: string;
  disc: string;
  chip: string;
  wash: string;
}

const CATEGORY_ACCENT: Record<LexNotificationCategory, CategoryAccent> = {
  request: {
    bar: 'border-s-info-500',
    disc: 'bg-info-500/12 text-info-500',
    chip: 'border-info-500/40 bg-info-500/10 text-info-500',
    wash: 'bg-info-500/5',
  },
  case: {
    bar: 'border-s-[hsl(var(--ds-brand-primary))]',
    disc: 'bg-[hsl(var(--ds-brand-primary)/0.12)] text-[hsl(var(--ds-brand-primary))]',
    chip: 'border-[hsl(var(--ds-brand-primary)/0.4)] bg-[hsl(var(--ds-brand-primary)/0.1)] text-[hsl(var(--ds-brand-primary))]',
    wash: 'bg-[hsl(var(--ds-brand-primary)/0.05)]',
  },
  hearing: {
    bar: 'border-s-warning-500',
    disc: 'bg-warning-500/14 text-warning-500',
    chip: 'border-warning-500/40 bg-warning-500/12 text-warning-500',
    wash: 'bg-warning-500/6',
  },
  judgment: {
    bar: 'border-s-error-500',
    disc: 'bg-error-500/12 text-error-500',
    chip: 'border-error-500/40 bg-error-500/10 text-error-500',
    wash: 'bg-error-500/5',
  },
  contract: {
    bar: 'border-s-success-500',
    disc: 'bg-success-500/12 text-success-500',
    chip: 'border-success-500/40 bg-success-500/10 text-success-500',
    wash: 'bg-success-500/5',
  },
  general: {
    bar: 'border-s-neutral-400',
    disc: 'bg-muted text-muted-foreground',
    chip: 'border-border bg-muted/60 text-muted-foreground',
    wash: 'bg-muted/30',
  },
};

/** KPI theme per category for the "top category" tile. */
const CATEGORY_KPI_THEME: Record<LexNotificationCategory, LexKpiItem['theme']> = {
  request: 'sky',
  case: 'primary',
  hearing: 'amber',
  judgment: 'red',
  contract: 'emerald',
  general: 'violet',
};

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** Day-bucket key for grouping. Pure, base-injectable for determinism. */
type DayBucket = 'today' | 'yesterday' | 'earlier';

function dayBucket(value: string, now: Date): DayBucket {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'earlier';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return 'today';
  if (t >= startOfToday - 86_400_000) return 'yesterday';
  return 'earlier';
}

interface NotificationInboxProps {
  labels: NotificationsLabels;
}

export function NotificationInbox({ labels }: NotificationInboxProps) {
  const { locale } = useLocale();
  const f = useLexFormat();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  // §8.7/§9 — marking notifications read is a notification-manage action.
  const canWrite = hasPermission('lex:notification:manage');
  const [readScope, setReadScope] = useState<'all' | 'unread' | 'read'>('all');
  const unreadOnly = readScope === 'unread';
  const [category, setCategory] = useState<LexNotificationCategory | 'all'>('all');
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      category: category === 'all' ? undefined : category,
      unread: readScope === 'all' ? undefined : readScope === 'unread',
    }),
    [category, readScope],
  );

  const inboxQuery = useQuery({
    queryKey: ['lex-notifications', 'inbox', page, filters],
    queryFn: () =>
      lexNotificationsApi.listInbox(
        { page, per_page: 25, sort: 'created_at', order: 'desc' },
        filters,
      ),
  });
  const countsQuery = useQuery({
    queryKey: ['lex-notifications', 'counts'],
    queryFn: () => lexNotificationsApi.getInboxCounts(),
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['lex-notifications', 'inbox'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-notifications', 'counts'] }),
    ]);
  };

  const markReadMutation = useMutation({
    mutationFn: (id: string) => lexNotificationsApi.markRead(id),
    onSuccess: async () => {
      showSuccess(labels.toast.marked);
      await invalidate();
    },
    onError: showApiError,
  });

  const markAllMutation = useMutation({
    mutationFn: () => lexNotificationsApi.markAllRead(),
    onSuccess: async (result) => {
      showSuccess(labels.toast.markedAll(result.updated));
      await invalidate();
    },
    onError: showApiError,
  });

  // Memoize the page items so the downstream KPI / grouping memos stay stable
  // between renders (the `?? []` would otherwise mint a new array each render).
  const items = useMemo(() => inboxQuery.data?.data ?? [], [inboxQuery.data?.data]);
  const meta = inboxQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / (meta.per_page || 25))) : 1;
  const unread = countsQuery.data?.unread ?? 0;
  const total = countsQuery.data?.total ?? 0;
  const read = Math.max(0, total - unread);
  const unreadShare = percent(unread, total);
  const readShare = percent(read, total);

  // --- KPI strip (computed client-side from the badge counts + current page) ---
  // "Top category" is derived from the items on the current page; informative,
  // not a global aggregate, so it always reflects what the user is looking at.
  const topCategory = useMemo(() => {
    if (items.length === 0) return null;
    const tally = new Map<LexNotificationCategory, number>();
    for (const it of items) tally.set(it.category, (tally.get(it.category) ?? 0) + 1);
    let best: LexNotificationCategory | null = null;
    let bestN = 0;
    for (const [cat, n] of tally) {
      if (n > bestN) {
        best = cat;
        bestN = n;
      }
    }
    return best;
  }, [items]);

  const kpiItems: LexKpiItem[] = useMemo(
    () => [
      {
        id: 'unread',
        label: labels.kpis.unread,
        value: unread,
        theme: unread > 0 ? 'amber' : 'emerald',
        icon: Bell,
        loading: countsQuery.isLoading,
        description: labels.kpis.unread,
        progress: unreadShare,
        progressLabel: labels.kpis.total,
        detail: labels.kpis.total,
        detailValue: `${unreadShare}%`,
        onAction: () => {
          setReadScope('unread');
          setPage(1);
        },
        pressed: readScope === 'unread',
      },
      {
        id: 'total',
        label: labels.kpis.total,
        value: total,
        theme: 'primary',
        icon: Inbox,
        loading: countsQuery.isLoading,
        description: labels.pageDescription,
        detail: labels.kpis.total,
        detailValue: total,
        onAction: () => {
          setReadScope('all');
          setCategory('all');
          setPage(1);
        },
        pressed: readScope === 'all' && category === 'all',
      },
      {
        id: 'read',
        label: labels.kpis.read,
        value: read,
        theme: 'emerald',
        icon: CheckCircle2,
        loading: countsQuery.isLoading,
        description: labels.kpis.read,
        progress: readShare,
        progressLabel: labels.kpis.total,
        detail: labels.kpis.total,
        detailValue: `${readShare}%`,
        onAction: () => {
          setReadScope('read');
          setPage(1);
        },
        pressed: readScope === 'read',
      },
      {
        id: 'top-category',
        label: labels.kpis.topCategory,
        value: topCategory ? labels.categoryLabels[topCategory] : labels.kpis.none,
        theme: topCategory ? CATEGORY_KPI_THEME[topCategory] : 'violet',
        icon: topCategory ? CATEGORY_ICON[topCategory] : Tags,
        loading: inboxQuery.isLoading,
        description: labels.kpis.topCategory,
        detail: labels.kpis.total,
        detailValue: items.length,
        onAction: () => {
          if (topCategory) setCategory(topCategory);
          setPage(1);
        },
        pressed: Boolean(topCategory && category === topCategory),
      },
    ],
    [
      labels,
      unread,
      total,
      read,
      topCategory,
      items.length,
      unreadShare,
      readShare,
      countsQuery.isLoading,
      inboxQuery.isLoading,
      category,
      readScope,
    ],
  );

  // --- Day grouping (timeline-style story, newest first) ---
  const grouped = useMemo(() => {
    const now = new Date();
    const buckets: Record<DayBucket, LexNotificationInboxItem[]> = {
      today: [],
      yesterday: [],
      earlier: [],
    };
    for (const it of items) buckets[dayBucket(it.created_at, now)].push(it);
    return (['today', 'yesterday', 'earlier'] as const)
      .map((bucket) => ({ bucket, rows: buckets[bucket] }))
      .filter((g) => g.rows.length > 0);
  }, [items]);

  const isEmpty = !inboxQuery.isLoading && !inboxQuery.isError && items.length === 0;

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Filter className="h-3.5 w-3.5" aria-hidden />
        {labels.inbox.categoryFilter}
      </span>
      <Select
        value={category}
        onValueChange={(value) => {
          setCategory(value as LexNotificationCategory | 'all');
          setPage(1);
        }}
      >
        <SelectTrigger className="w-44" aria-label={labels.inbox.categoryFilter}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{labels.inbox.allCategories}</SelectItem>
          {LEX_NOTIFICATION_CATEGORIES.map((value) => (
            <SelectItem key={value} value={value}>
              {labels.categoryLabels[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant={unreadOnly ? 'default' : 'outline'}
        size="sm"
        className=""
        onClick={() => {
          setReadScope((prev) => (prev === 'unread' ? 'all' : 'unread'));
          setPage(1);
        }}
      >
        <MailOpen className="me-1.5 h-3.5 w-3.5" />
        {labels.inbox.unreadOnly}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void inboxQuery.refetch()}
        disabled={inboxQuery.isFetching}
      >
        <RefreshCw className={cn('me-1.5 h-3.5 w-3.5', inboxQuery.isFetching && 'animate-spin')} />
        {labels.inbox.refresh}
      </Button>
    </div>
  );

  const heroActions =
    canWrite && unread > 0 ? (
      <Button
        type="button"
        onClick={() => markAllMutation.mutate()}
        disabled={markAllMutation.isPending}
        className="gap-2 motion-safe:animate-spring-pop"
      >
        <CheckCheck className="h-4 w-4" aria-hidden />
        {labels.inbox.markAllRead}
      </Button>
    ) : null;

  if (inboxQuery.isError) {
    return (
      <div className="space-y-6">
        <LexKpiStrip items={kpiItems} />
        <ErrorState message={labels.inbox.loadError} onRetry={() => void inboxQuery.refetch()} />
      </div>
    );
  }

  return (
    <LexListShell
      title={labels.pageTitle}
      description={labels.pageDescription}
      eyebrow={null}
      actions={heroActions}
      kpi={<LexKpiStrip items={kpiItems} />}
      filters={filterBar}
      loading={inboxQuery.isLoading}
      skeletonRows={6}
      skeletonCols={3}
      framedBody={false}
      empty={
        isEmpty
          ? {
              icon: Bell,
              title: unreadOnly ? labels.inbox.emptyUnreadTitle : labels.inbox.emptyTitle,
              description: unreadOnly
                ? labels.inbox.emptyUnreadDescription
                : labels.inbox.emptyDescription,
              action:
                unreadOnly || category !== 'all'
                  ? {
                      label: labels.inbox.allCategories,
                      icon: Inbox,
                      onClick: () => {
                        setReadScope('all');
                        setCategory('all');
                        setPage(1);
                      },
                    }
                  : undefined,
            }
          : null
      }
    >
      <div className="space-y-6">
        {grouped.map(({ bucket, rows }) => (
          <section key={bucket} className="space-y-2.5">
            <div className="flex items-center gap-3 px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {labels.groups[bucket]}
              </h3>
              <span className="h-px flex-1 bg-border/60" aria-hidden />
              <span className="text-xs tabular-nums text-muted-foreground">
                {f.formatNumber(rows.length)}
              </span>
            </div>
            <div className="space-y-2.5">
              {rows.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  labels={labels}
                  locale={locale}
                  f={f}
                  canWrite={canWrite}
                  marking={markReadMutation.isPending}
                  onMarkRead={() => markReadMutation.mutate(item.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 pt-5">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {f.formatNumber(page)} / {f.formatNumber(totalPages)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          </Button>
        </div>
      ) : null}
    </LexListShell>
  );
}

function NotificationRow({
  item,
  labels,
  locale,
  f,
  canWrite,
  marking,
  onMarkRead,
}: {
  item: LexNotificationInboxItem;
  labels: NotificationsLabels;
  locale: 'ar' | 'en';
  f: ReturnType<typeof useLexFormat>;
  canWrite: boolean;
  marking: boolean;
  onMarkRead: () => void;
}) {
  const Icon = CATEGORY_ICON[item.category] ?? Bell;
  const accent = CATEGORY_ACCENT[item.category] ?? CATEGORY_ACCENT.general;
  const title = resolveLocalized(item.title, locale);
  const body = resolveLocalized(item.body, locale);

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border border-border/60 px-4 py-3.5 ps-5',
        'border-s-4 shadow-elevation-1',
        'transition-[box-shadow,background-color] duration-fast ease-standard',
        'hover:shadow-elevation-2',
        accent.bar,
        item.read ? 'bg-card/70' : cn(accent.wash, 'bg-card'),
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-border/50',
              accent.disc,
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'truncate',
                  item.read ? 'font-medium text-foreground/90' : 'font-semibold text-foreground',
                )}
              >
                {title}
              </span>
              {!item.read ? (
                <span
                  className="inline-flex items-center rounded-full bg-[image:var(--ds-gradient-primary)] px-2 py-0.5 text-overline font-semibold uppercase text-primary-foreground motion-safe:animate-spring-pop"
                  aria-label={labels.state.unread}
                >
                  {labels.inbox.newMarker}
                </span>
              ) : null}
            </div>
            {body ? <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{body}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  accent.chip,
                )}
              >
                <Icon className="h-3 w-3" aria-hidden />
                {labels.categoryLabels[item.category]}
              </span>
              <span className="tabular-nums" title={f.formatDual(item.created_at)}>
                {f.formatRelative(item.created_at)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {item.action_url ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={item.action_url}>
                <ExternalLink className="me-1.5 h-3.5 w-3.5 rtl:-scale-x-100" />
                {labels.inbox.open}
              </Link>
            </Button>
          ) : null}
          {canWrite && !item.read ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onMarkRead}
              disabled={marking}
              className=""
            >
              <Check className="me-1.5 h-3.5 w-3.5" />
              {labels.inbox.markRead}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
