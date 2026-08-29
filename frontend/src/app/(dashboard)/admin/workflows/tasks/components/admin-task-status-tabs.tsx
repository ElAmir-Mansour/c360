'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TaskCounts } from '@/types/models';
import type { AppLocale } from '@/lib/i18n';
import { getAdminWorkflowLabels } from '../_lib/admin-workflow-i18n';

interface AdminTaskStatusTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  counts?: TaskCounts;
  locale: AppLocale;
}

export function AdminTaskStatusTabs({
  activeTab,
  onTabChange,
  counts,
  locale,
}: AdminTaskStatusTabsProps) {
  const labels = getAdminWorkflowLabels(locale);
  const allCount = counts
    ? (counts.pending ?? 0) +
      (counts.claimed_by_me ?? 0) +
      (counts.completed ?? 0) +
      (counts.overdue ?? 0) +
      (counts.escalated ?? 0)
    : undefined;

  const tabs = [
    { key: 'all', label: labels.taskTabs.all, count: allCount },
    { key: 'pending', label: labels.taskTabs.pending, count: counts?.pending },
    { key: 'claimed', label: labels.taskTabs.claimed, count: counts?.claimed_by_me },
    { key: 'completed', label: labels.taskTabs.completed, count: counts?.completed },
    { key: 'overdue', label: labels.taskTabs.overdue, count: counts?.overdue, urgent: true },
  ];

  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.key}
            value={tab.key}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm',
              tab.urgent && (tab.count ?? 0) > 0 && 'text-destructive',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <Badge
                variant={tab.urgent && tab.count > 0 ? 'destructive' : 'secondary'}
                className="h-4 min-w-4 px-1 text-overline"
              >
                {tab.count}
              </Badge>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.key} value={tab.key} forceMount className="sr-only" />
      ))}
    </Tabs>
  );
}
