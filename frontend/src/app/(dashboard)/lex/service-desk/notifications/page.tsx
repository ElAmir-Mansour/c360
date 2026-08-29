'use client';

/**
 * Legal Service Desk — Notifications inbox + channel preferences
 * (`/lex/service-desk/notifications`, CAP-156..164).
 *
 * Two tabbed surfaces:
 *   - Inbox: the authenticated user's durable in-app notifications, with
 *     per-row "Mark read" and a header "Mark all read".
 *   - Channel preferences: a category × channel matrix of opt-out switches. A
 *     channel is ON unless a subscription row exists with `enabled:false`.
 *
 * Subscriptions are an OPT-OUT model: absence of a row = enabled by default.
 */

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Briefcase,
  CalendarClock,
  CheckCheck,
  FileSignature,
  Gavel,
  Inbox,
  Megaphone,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showError, showSuccess } from '@/lib/toast';
import {
  lexRequestsApi,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationInboxItem,
  type NotificationSubscription,
} from '@/lib/lex/requests';
import {
  NOTIFICATION_CATEGORY_OPTIONS,
  NOTIFICATION_CHANNEL_OPTIONS,
  useNotificationsLabels,
  type NotificationsLabels,
} from './_labels';

const INBOX_QUERY_KEY = ['lex-inbox'] as const;
const INBOX_COUNTS_QUERY_KEY = ['lex-inbox-counts'] as const;
const SUBSCRIPTIONS_QUERY_KEY = ['lex-subscriptions'] as const;

/** Decorative icon per category (semantics only). */
const CATEGORY_ICONS: Record<(typeof NOTIFICATION_CATEGORY_OPTIONS)[number], LucideIcon> = {
  request: Inbox,
  case: Briefcase,
  hearing: CalendarClock,
  judgment: Gavel,
  contract: FileSignature,
  general: Megaphone,
};

/* ------------------------------------------------------------------------- *
 * Inbox tab
 * ------------------------------------------------------------------------- */

function CategoryBadge({
  category,
  labels,
}: {
  category: NotificationCategory;
  labels: NotificationsLabels;
}) {
  const known = (NOTIFICATION_CATEGORY_OPTIONS as readonly string[]).includes(category);
  const Icon = known
    ? CATEGORY_ICONS[category as (typeof NOTIFICATION_CATEGORY_OPTIONS)[number]]
    : Bell;
  const label = known
    ? labels.categoryLabels[category as (typeof NOTIFICATION_CATEGORY_OPTIONS)[number]]
    : category;
  return (
    <Badge variant="outline" className="gap-1.5">
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </Badge>
  );
}

function InboxRow({
  item,
  labels,
  onMarkRead,
  isMarking,
}: {
  item: NotificationInboxItem;
  labels: NotificationsLabels;
  onMarkRead: (id: string) => void;
  isMarking: boolean;
}) {
  const { locale } = useLocale();
  const f = useLexFormat();
  const isUnread = !item.read_at;
  const title = resolveLocalized(item.title, locale) || labels.inbox.untitled;
  const body = resolveLocalized(item.body, locale);

  return (
    <li
      className={[
        'flex flex-col gap-3 rounded-xl border px-4 py-3 transition-colors duration-fast ease-standard sm:flex-row sm:items-start sm:justify-between',
        'motion-safe:hover:shadow-elevation-1',
        isUnread
          ? 'border-primary/30 bg-primary/[0.04]'
          : 'border-[color:var(--panel-border)] bg-card/50',
      ].join(' ')}
    >
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge category={item.category} labels={labels} />
          {isUnread ? (
            <span
              className="inline-block h-2 w-2 rounded-full bg-primary"
              aria-label={labels.inbox.unread(1)}
            />
          ) : null}
        </div>
        <p
          className={[
            'truncate text-sm',
            isUnread ? 'font-semibold text-foreground' : 'font-normal text-foreground/90',
          ].join(' ')}
        >
          {title}
        </p>
        {body ? <p className="text-sm text-muted-foreground">{body}</p> : null}
        <p className="text-xs tabular-nums text-muted-foreground">
          {f.formatRelative(item.created_at)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {item.action_url ? (
          <Button variant="outline" size="sm" asChild>
            <a href={item.action_url}>{labels.inbox.open}</a>
          </Button>
        ) : null}
        {isUnread ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onMarkRead(item.id)}
            disabled={isMarking}
          >
            {labels.inbox.markRead}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function InboxTab({ labels }: { labels: NotificationsLabels }) {
  const queryClient = useQueryClient();

  const inboxQuery = useQuery({
    queryKey: [...INBOX_QUERY_KEY],
    queryFn: () => lexRequestsApi.listInbox({ page: 1, per_page: 50 }),
  });

  const countsQuery = useQuery({
    queryKey: [...INBOX_COUNTS_QUERY_KEY],
    queryFn: () => lexRequestsApi.getInboxCounts(),
  });

  const invalidateInbox = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...INBOX_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: [...INBOX_COUNTS_QUERY_KEY] }),
    ]);
  }, [queryClient]);

  const markReadMutation = useMutation({
    mutationFn: (id: string) => lexRequestsApi.markInboxRead(id),
    onSuccess: async () => {
      await invalidateInbox();
      showSuccess(labels.inbox.markReadSuccess);
    },
    onError: () => showError(labels.inbox.markReadError),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => lexRequestsApi.markAllInboxRead(),
    onSuccess: async () => {
      await invalidateInbox();
      showSuccess(labels.inbox.markAllReadSuccess);
    },
    onError: () => showError(labels.inbox.markReadError),
  });

  const items = inboxQuery.data?.data ?? [];
  const counts = countsQuery.data;
  const unread = counts?.unread ?? 0;
  const total = counts?.total ?? inboxQuery.data?.meta.total ?? items.length;

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={unread > 0 ? 'default' : 'secondary'}>{labels.inbox.unread(unread)}</Badge>
      <Badge variant="outline">{labels.inbox.total(total)}</Badge>
      <Button
        variant="outline"
        size="sm"
        onClick={() => markAllReadMutation.mutate()}
        disabled={markAllReadMutation.isPending || unread === 0}
      >
        <CheckCheck className="me-1.5 h-4 w-4" aria-hidden />
        {labels.inbox.markAllRead}
      </Button>
    </div>
  );

  return (
    <SectionCard
      title={labels.inbox.sectionTitle}
      description={labels.inbox.sectionDescription}
      actions={header}
    >
      {inboxQuery.isError ? (
        <ErrorState onRetry={() => inboxQuery.refetch()} />
      ) : inboxQuery.isLoading ? (
        <div className="space-y-3">
          <LoadingSkeleton variant="list-item" count={4} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={labels.inbox.emptyTitle}
          description={labels.inbox.emptyDescription}
          size="compact"
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              labels={labels}
              onMarkRead={(id) => markReadMutation.mutate(id)}
              isMarking={markReadMutation.isPending}
            />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Preferences tab — category × channel opt-out matrix
 * ------------------------------------------------------------------------- */

/**
 * Build a `(category, channel) -> subscription` lookup. The backend stores at
 * most one override per pair; the latest wins if duplicates ever appear.
 */
function indexSubscriptions(
  subscriptions: NotificationSubscription[],
): Map<string, NotificationSubscription> {
  const index = new Map<string, NotificationSubscription>();
  for (const sub of subscriptions) {
    index.set(`${sub.category}::${sub.channel}`, sub);
  }
  return index;
}

function PreferencesTab({ labels }: { labels: NotificationsLabels }) {
  const queryClient = useQueryClient();

  const subscriptionsQuery = useQuery({
    queryKey: [...SUBSCRIPTIONS_QUERY_KEY],
    queryFn: () => lexRequestsApi.listSubscriptions(),
  });

  const upsertMutation = useMutation({
    mutationFn: (payload: {
      category: NotificationCategory;
      channel: NotificationChannel;
      enabled: boolean;
    }) => lexRequestsApi.upsertSubscription(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...SUBSCRIPTIONS_QUERY_KEY] });
      showSuccess(labels.preferences.saved);
    },
    onError: () => showError(labels.preferences.saveError),
  });

  const index = useMemo(
    () => indexSubscriptions(subscriptionsQuery.data ?? []),
    [subscriptionsQuery.data],
  );

  /** Opt-out semantics: enabled unless an explicit `enabled:false` row exists. */
  const isEnabled = useCallback(
    (category: NotificationCategory, channel: NotificationChannel) => {
      const sub = index.get(`${category}::${channel}`);
      return sub ? sub.enabled : true;
    },
    [index],
  );

  return (
    <SectionCard
      title={labels.preferences.sectionTitle}
      description={labels.preferences.sectionDescription}
    >
      {subscriptionsQuery.isError ? (
        <ErrorState onRetry={() => subscriptionsQuery.refetch()} />
      ) : subscriptionsQuery.isLoading ? (
        <div className="space-y-3">
          <LoadingSkeleton variant="table-row" count={6} />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{labels.preferences.optOutNote}</p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--panel-border)] text-start">
                  <th className="py-2 pe-4 text-start font-medium text-muted-foreground">
                    {labels.preferences.categoryColumn}
                  </th>
                  {NOTIFICATION_CHANNEL_OPTIONS.map((channel) => (
                    <th
                      key={channel}
                      className="px-4 py-2 text-center font-medium text-muted-foreground"
                    >
                      {labels.channelLabels[channel]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_CATEGORY_OPTIONS.map((category) => {
                  const Icon = CATEGORY_ICONS[category];
                  return (
                    <tr
                      key={category}
                      className="border-b border-[color:var(--panel-border)] last:border-0"
                    >
                      <td className="py-3 pe-4 align-top">
                        <div className="flex items-start gap-2.5">
                          <Icon
                            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">
                              {labels.categoryLabels[category]}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {labels.categoryDescriptions[category]}
                            </p>
                          </div>
                        </div>
                      </td>
                      {NOTIFICATION_CHANNEL_OPTIONS.map((channel) => {
                        const enabled = isEnabled(category, channel);
                        return (
                          <td key={channel} className="px-4 py-3 text-center align-middle">
                            <div className="flex justify-center">
                              <Switch
                                checked={enabled}
                                disabled={upsertMutation.isPending}
                                aria-label={`${labels.categoryLabels[category]} · ${labels.channelLabels[channel]}`}
                                onCheckedChange={(next) =>
                                  upsertMutation.mutate({ category, channel, enabled: next })
                                }
                              />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Page
 * ------------------------------------------------------------------------- */

export default function NotificationsPage() {
  const { locale, direction } = useLocale();
  const labels = useNotificationsLabels();
  const [tab, setTab] = useState<'inbox' | 'preferences'>('inbox');

  return (
    <LexRouteGuard requirement="lex:request:view">
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          eyebrow={labels.pageEyebrow}
          title={labels.pageTitle}
          description={labels.pageDescription}
        />

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as 'inbox' | 'preferences')}
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger value="inbox">{labels.tabs.inbox}</TabsTrigger>
            <TabsTrigger value="preferences">{labels.tabs.preferences}</TabsTrigger>
          </TabsList>

          <TabsContent value="inbox">
            <InboxTab labels={labels} />
          </TabsContent>

          <TabsContent value="preferences">
            <PreferencesTab labels={labels} />
          </TabsContent>
        </Tabs>
      </div>
    </LexRouteGuard>
  );
}
