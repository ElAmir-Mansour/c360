'use client';

/**
 * Upcoming-deadlines card (features #10 create + #11 countdown) for the
 * case-timeline panel split.
 *
 * SELF-CONTAINED: owns its OWN react-query for the matter's deadline
 * obligations AND the create mutation, so the shell only needs to render
 * `<DeadlinesCard matterId=.. canWrite=.. />`. The query key PREFIX is
 * `['lex-matter-deadlines', matterId]` so a shell-level
 * `invalidateQueries({ queryKey: ['lex-matter-deadlines', matterId] })` keeps
 * matching even if extra key segments are appended later.
 *
 * Each row renders the deadline title, due date and a COUNTDOWN badge derived
 * from `days_until_due`, toned by urgency (overdue=rose, ≤3 days=gold,
 * else emerald), plus the deadline kind and a reminder indicator.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CalendarClock, Plus } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import { deadlineTypeLabel, useSettlementLabels } from './labels';
import { DeadlineCreateDialog } from './deadline-create-dialog';
import {
  settlementsApi,
  type CreateDeadlinePayload,
  type DeadlineObligation,
} from '@/lib/lex/settlements';

export interface DeadlinesCardProps {
  matterId: string;
  canWrite: boolean;
}

/**
 * Base react-query key for this matter's deadlines. The shell invalidates by
 * this exact prefix; extend with extra segments AFTER `matterId` so prefix
 * invalidation keeps matching.
 */
export function deadlinesQueryKey(matterId: string): [string, string] {
  return ['lex-matter-deadlines', matterId];
}

/** Tonal classes for the countdown badge, by urgency. */
function countdownBadgeClass(daysUntilDue: number): string {
  if (daysUntilDue < 0) {
    // Overdue.
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (daysUntilDue <= 3) {
    // Imminent.
    return 'border-warning-100 bg-warning-50 text-warning-700 dark:text-warning-300';
  }
  if (daysUntilDue <= 14) {
    return 'border-sky-200 bg-sky-50 text-sky-700';
  }
  return 'border-success-100 bg-success-50 text-success-700';
}

/** Leading accent bar tone, mirroring the urgency colour. */
function countdownAccentClass(daysUntilDue: number): string {
  if (daysUntilDue < 0) return 'bg-rose-400/70';
  if (daysUntilDue <= 3) return 'bg-warning-300/70';
  if (daysUntilDue <= 14) return 'bg-sky-400/70';
  return 'bg-success-300/70';
}

export function DeadlinesCard({ matterId, canWrite }: DeadlinesCardProps) {
  const L = useSettlementLabels();
  const labels = L.timeline.deadlines;
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);

  const deadlinesQuery = useQuery({
    queryKey: deadlinesQueryKey(matterId),
    queryFn: () => settlementsApi.listDeadlines(matterId),
    enabled: Boolean(matterId),
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateDeadlinePayload) =>
      settlementsApi.createDeadline(matterId, payload),
    onSuccess: () => {
      // No dedicated "deadline created" toast key exists in the label catalog;
      // reuse the section title as a neutral success message (see REPORT).
      showSuccess(labels.add);
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: deadlinesQueryKey(matterId) });
      void queryClient.invalidateQueries({ queryKey: ['lex-matter-timeline', matterId] });
    },
    onError: (error) => {
      showApiError(error);
    },
  });

  const deadlines = deadlinesQuery.data?.data ?? [];

  const countdownLabel = (deadline: DeadlineObligation): string => {
    const n = deadline.days_until_due;
    if (n === 0) return labels.dueToday;
    if (n > 0) return labels.inDays(n);
    return labels.daysAgo(Math.abs(n));
  };

  return (
    <>
      <SectionCard
        title={labels.upcomingTitle}
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {labels.add}
            </Button>
          ) : undefined
        }
      >
        {deadlinesQuery.isLoading ? (
          <LoadingSkeleton variant="list-item" count={3} />
        ) : deadlinesQuery.isError ? (
          <ErrorState
            error={deadlinesQuery.error}
            onRetry={() => void deadlinesQuery.refetch()}
          />
        ) : deadlines.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={labels.empty}
            description={labels.upcomingTitle}
            size="compact"
          />
        ) : (
          <div className="space-y-3">
            {deadlines.map((deadline) => (
              <div
                key={deadline.id}
                className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5"
              >
                <span
                  className={cn(
                    'absolute inset-y-0 start-0 w-1',
                    countdownAccentClass(deadline.days_until_due),
                  )}
                  aria-hidden
                />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="capitalize">
                        {deadlineTypeLabel(L, deadline.type)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(countdownBadgeClass(deadline.days_until_due))}
                      >
                        {countdownLabel(deadline)}
                      </Badge>
                      {deadline.reminder_enabled ? (
                        <span
                          className="inline-flex items-center text-muted-foreground"
                          title={labels.add}
                        >
                          <BellRing className="h-3.5 w-3.5" aria-hidden />
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 truncate text-sm font-medium">
                      {deadline.title || '—'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {labels.fieldDate}: {formatDateTime(deadline.due_date)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <DeadlineCreateDialog
        open={dialogOpen}
        loading={createMutation.isPending}
        onOpenChange={(open) => {
          if (!createMutation.isPending) setDialogOpen(open);
        }}
        onSubmit={(payload) => createMutation.mutate(payload)}
      />
    </>
  );
}
