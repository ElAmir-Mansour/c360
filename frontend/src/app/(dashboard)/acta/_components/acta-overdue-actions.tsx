'use client';

import Link from 'next/link';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { ArrowRight, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge, severityMap } from '@/components/shared/status-badge';
import type { ActaActionItemSummary } from '@/types/suites';
import {
  useActaCommonLabels,
  useActaDashboardLabels,
  useActaPriorityLabels,
} from '../_lib/acta-i18n';

interface ActaOverdueActionsProps {
  items: ActaActionItemSummary[];
}

export function ActaOverdueActions({ items }: ActaOverdueActionsProps) {
  const common = useActaCommonLabels();
  const t = useActaDashboardLabels();
  const priorityLabels = useActaPriorityLabels();
  return (
    <SectionCard
      title={t.overdueTitle}
      description={t.overdueDescription}
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link href="/acta/action-items?status=overdue">
            {common.openTracker}
            <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
          </Link>
        </Button>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          size="compact"
          title={t.overdueEmptyTitle}
          description={t.overdueEmptyDescription}
        />
      ) : (
        <div className="space-y-3">
          {items.slice(0, 10).map((item) => {
            const daysOverdue = Math.max(
              differenceInCalendarDays(new Date(), parseISO(item.due_date)),
              0,
            );
            return (
              <Link
                key={item.id}
                href={`/acta/action-items?status=overdue`}
                className="block rounded-xl border px-4 py-3 transition hover:border-primary"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.committee_name} • {item.assignee_name}
                    </p>
                  </div>
                  <StatusBadge
                    status={item.priority}
                    map={severityMap}
                    label={priorityLabels[item.priority] ?? item.priority}
                    size="sm"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="font-medium text-destructive">
                    {t.daysOverdue(daysOverdue)}
                  </span>
                  <span>{t.dueOn(formatDate(item.due_date))}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}
