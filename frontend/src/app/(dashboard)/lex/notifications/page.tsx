'use client';

/**
 * Legal-affairs NOTIFICATIONS page (Phase 4, CAP-156..164): a two-tab surface
 * for the durable in-app inbox and the per-user subscription preferences.
 * Permission-gated (§8.7) on lex:notification:view; mutations within the tabs
 * gate on lex:notification:manage. Arabic-first + RTL.
 *
 * Chrome: the tab bar sits at the top; each tab owns its own premium chrome —
 * the inbox renders a <LexListShell> (header + KPI strip + filters), and the
 * preferences panel renders its own lightweight header — so there is exactly one
 * page header per tab.
 */
import { useState } from 'react';
import { Bell, Settings2 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocale } from '@/components/providers/locale-provider';
import { useNotificationsLabels } from './_lib/notifications-labels';
import { NotificationInbox } from './_components/notification-inbox';
import { NotificationPreferences } from './_components/notification-preferences';

type NotificationsTab = 'inbox' | 'preferences';

export default function LexNotificationsPage() {
  const { locale, direction } = useLocale();
  const labels = useNotificationsLabels();
  const [tab, setTab] = useState<NotificationsTab>('inbox');

  return (
    <LexRouteGuard route="/lex/notifications">
      <div className="space-y-6" dir={direction} lang={locale}>
        <Tabs value={tab} onValueChange={(value) => setTab(value as NotificationsTab)}>
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            <TabsTrigger value="inbox" className="min-w-32">
              <Bell className="me-1.5 h-4 w-4" />
              {labels.tabs.inbox}
            </TabsTrigger>
            <TabsTrigger value="preferences" className="min-w-32">
              <Settings2 className="me-1.5 h-4 w-4" />
              {labels.tabs.preferences}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === 'inbox' ? (
          <NotificationInbox labels={labels} />
        ) : (
          <div className="space-y-6 motion-safe:animate-fade-up">
            <PageHeader
              title={labels.preferences.title}
              description={labels.preferences.description}
              eyebrow={null}
            />
            <NotificationPreferences labels={labels} />
          </div>
        )}
      </div>
    </LexRouteGuard>
  );
}
