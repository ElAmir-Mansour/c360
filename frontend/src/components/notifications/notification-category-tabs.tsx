'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useNotificationsLabels } from './notifications-i18n';

interface CategoryTab {
  key: keyof ReturnType<typeof useNotificationsLabels>['tabs'];
}

const TABS: CategoryTab[] = [
  { key: 'all' },
  { key: 'unread' },
  { key: 'security' },
  { key: 'workflow' },
  { key: 'data' },
  { key: 'governance' },
  { key: 'legal' },
  { key: 'system' },
];

interface NotificationCategoryTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  counts?: Partial<Record<string, number>>;
}

export function NotificationCategoryTabs({
  activeTab,
  onTabChange,
  counts = {},
}: NotificationCategoryTabsProps) {
  const labels = useNotificationsLabels();
  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
        {TABS.map((tab) => {
          const count = counts[tab.key];
          return (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className={cn(
                'relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm',
                tab.key === 'unread' && (count ?? 0) > 0 && 'text-primary',
              )}
            >
              {labels.tabs[tab.key]}
              {count !== undefined && count > 0 && (
                <Badge
                  variant={tab.key === 'unread' ? 'default' : 'secondary'}
                  className="h-4 min-w-4 px-1 text-overline"
                >
                  {count > 99 ? '99+' : count}
                </Badge>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {/*
        These tabs act as a category filter — the matching notification list is
        rendered by the page outside this component. Radix still emits an
        `aria-controls` on every trigger pointing at a tab panel, so we mount an
        empty (forceMount) panel per tab to keep that reference valid and avoid
        an `aria-valid-attr-value` violation. `m-0` keeps them visually inert.
      */}
      {TABS.map((tab) => (
        <TabsContent key={tab.key} value={tab.key} forceMount className="m-0" />
      ))}
    </Tabs>
  );
}
