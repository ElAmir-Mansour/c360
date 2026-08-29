'use client';

/**
 * ActivityTimeline (Feature 10).
 *
 * Renders the endpoint audit log from getActivityResult as a vertical
 * who/what/when timeline. Each row shows the actor, a humanized
 * action, the relative time, and an expandable secret-free detail bag (pretty
 * JSON). Failed reads surface as unavailable rather than empty. Read-only
 * surface — no RBAC gating beyond the page's `lex:read`.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ChevronDown, ChevronUp, User } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { getActivityResult, type ActivityEntry } from '@/lib/lex/integrations';
import { useDetailOpsLabels } from '../_lib/detail-ops-labels';
import { formatRelative, prettyJson } from '../_lib/detail-ops-format';

interface ActivityTimelineProps {
  endpointId: string;
}

/** "integration.secret.rotated" → "Integration · secret · rotated". */
function humanizeAction(action: string): string {
  return action
    .split(/[.:_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' · ');
}

function hasDetail(entry: ActivityEntry): boolean {
  return Boolean(entry.detail && Object.keys(entry.detail).length > 0);
}

export function ActivityTimeline({ endpointId }: ActivityTimelineProps) {
  const t = useDetailOpsLabels();
  const { locale, direction } = useLocaleOrDefault();
  const [expanded, setExpanded] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['lex-integration-activity', endpointId],
    queryFn: () => getActivityResult(endpointId),
    enabled: Boolean(endpointId),
  });

  const rows = q.data?.entries ?? [];
  const degraded = q.data?.degraded ?? false;

  return (
    <SectionCard title={t.activityTitle} description={t.activitySubtitle}>
      {q.isLoading ? (
        <LoadingSkeleton variant="list-item" count={4} />
      ) : q.isError || degraded ? (
        <ErrorState
          variant="generic"
          title={t.activityTitle}
          message={t.opsError}
          onRetry={() => void q.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={t.activityEmpty}
          description={t.activitySubtitle}
          size="compact"
        />
      ) : (
        <ol className="relative space-y-4 ps-5" dir={direction}>
          {/* Rail. */}
          <span
            className="absolute bottom-1 top-1 w-px bg-border ltr:left-1.5 rtl:right-1.5"
            aria-hidden
          />
          {rows.map((entry, i) => {
            const detailOpen = expanded === i;
            return (
              <li key={`${entry.at}-${i}`} className="relative">
                <span
                  className="absolute top-1 h-3 w-3 rounded-full border-2 border-background bg-primary ltr:-left-[1.35rem] rtl:-right-[1.35rem]"
                  aria-hidden
                />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  <span className="font-medium text-foreground">
                    {humanizeAction(entry.action)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelative(entry.at, locale)}
                  </span>
                </div>
                <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="h-3 w-3" aria-hidden />
                  {entry.actor || t.activitySystemActor}
                </div>
                {hasDetail(entry) ? (
                  <div className="mt-1">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-caption text-primary hover:underline"
                      onClick={() => setExpanded(detailOpen ? null : i)}
                      aria-expanded={detailOpen}
                    >
                      {detailOpen ? (
                        <ChevronUp className="h-3 w-3" aria-hidden />
                      ) : (
                        <ChevronDown className="h-3 w-3" aria-hidden />
                      )}
                      {detailOpen ? t.activityHideDetail : t.activityShowDetail}
                    </button>
                    {detailOpen ? (
                      <pre
                        className={cn(
                          'mt-1 max-h-48 overflow-auto rounded-lg border bg-muted/30 p-2 text-caption leading-relaxed',
                        )}
                        dir="ltr"
                      >
                        {prettyJson(entry.detail)}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}
