'use client';

import { DatabaseZap, Workflow } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { DRGroupRollup, DRGroupSummary } from '@/types/clario-dr';
import {
  MetricTile,
  MiniDatum,
  PercentBar,
  StatusBadge,
  formatDate,
  formatSeconds,
  resolveGroupId,
  shortHash,
} from './protect-shared';
import { useProtectStateLabels } from './protect-labels';

/**
 * Protection groups (extracted verbatim, behaviour-preserving, from the original
 * `dr/page.tsx` "groups" tab). Left rail lists every protection group; the right
 * pane renders the selected group's summary: KPI tiles, latest recovery point,
 * and the boot-order / member-stream table.
 */
export function ProtectionGroups({
  groups,
  selectedGroupId,
  groupSummary,
  groupSummaryLoading,
  groupSummaryError,
  onSelectGroup,
  onRetryGroup,
  onOpenAdvisor,
}: {
  groups: DRGroupRollup[];
  selectedGroupId: string | null;
  groupSummary: DRGroupSummary | null;
  groupSummaryLoading: boolean;
  groupSummaryError: unknown;
  onSelectGroup: (id: string) => void;
  onRetryGroup: () => void;
  /** Opens the recovery advisor (the in-page onboarding path for a first group). */
  onOpenAdvisor?: () => void;
}) {
  const L = useProtectStateLabels();
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{L.groupsTitle}</CardTitle>
          <CardDescription>{L.groupsSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {groups.length === 0 ? (
            <EmptyState
              icon={DatabaseZap}
              title={L.noGroupsTitle}
              description={L.noGroupsDescription}
              action={
                onOpenAdvisor
                  ? { label: L.noGroupsAction, onClick: onOpenAdvisor }
                  : undefined
              }
              className="border border-dashed"
              size="compact"
            />
          ) : (
            groups.map((group) => {
              const id = resolveGroupId(group);
              if (!id) return null;
              const selected = id === selectedGroupId;
              return (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    'w-full rounded-lg border bg-card px-4 py-3 text-start transition hover:border-primary/30',
                    selected && 'border-primary/50 bg-primary/5',
                  )}
                  aria-pressed={selected}
                  onClick={() => onSelectGroup(id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{group.name ?? id}</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {id} / {group.member_count ?? 0} members / {group.stream_count ?? 0} streams
                      </div>
                    </div>
                    <StatusBadge status={group.health ?? 'empty'} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                    <MiniDatum
                      label={L.miniRpo}
                      value={formatSeconds(group.worst_live_rpo?.rpo_seconds)}
                      tone={group.worst_live_rpo?.breaches_rpo ? 'rose' : 'gold'}
                    />
                    <MiniDatum label={L.miniTarget} value={formatSeconds(group.rpo_objective_seconds)} tone="gold" />
                    <MiniDatum label={L.miniRto} value={formatSeconds(group.rto_objective_seconds)} tone="gold" />
                  </div>
                  <div className="mt-3">
                    <PercentBar value={group.replication_percent} />
                  </div>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">{groupSummary?.name ?? L.groupDetailFallback}</CardTitle>
            <CardDescription>{L.groupDetailSubtitle}</CardDescription>
          </div>
          {groupSummary ? <StatusBadge status={groupSummary.health ?? 'empty'} /> : null}
        </CardHeader>
        <CardContent>
          {groupSummaryLoading ? (
            <LoadingSkeleton variant="card" count={2} />
          ) : groupSummaryError && !groupSummary ? (
            <ErrorState message={L.summaryLoadError} onRetry={onRetryGroup} />
          ) : !groupSummary ? (
            <EmptyState
              icon={Workflow}
              title={L.noGroupSelectedTitle}
              description={L.noGroupSelectedDescription}
              size="compact"
            />
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricTile label={L.metricMembers} value={groupSummary.member_count ?? 0} tone="sky" />
                <MetricTile label={L.metricStreams} value={groupSummary.stream_count ?? 0} tone="sky" />
                <MetricTile label={L.metricRpoObjective} value={formatSeconds(groupSummary.rpo_objective_seconds)} tone="gold" />
                <MetricTile label={L.metricRtoObjective} value={formatSeconds(groupSummary.rto_objective_seconds)} tone="gold" />
              </div>

              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{L.latestRecoveryPoint}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {groupSummary.latest_recovery_point?.id ?? L.noPointSealed}
                    </div>
                  </div>
                  <StatusBadge
                    status={groupSummary.latest_recovery_point?.is_validated ? 'healthy' : 'warning'}
                    label={groupSummary.latest_recovery_point?.is_validated ? L.validated : L.pending}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
                  <MiniDatum
                    label={L.miniRpo}
                    value={formatSeconds(groupSummary.latest_recovery_point?.rpo_seconds)}
                    tone="gold"
                  />
                  <MiniDatum
                    label={L.miniRetention}
                    value={formatDate(groupSummary.latest_recovery_point?.retention_until)}
                    tone="gold"
                  />
                  <MiniDatum
                    label={L.miniLegalHold()}
                    value={groupSummary.latest_recovery_point?.legal_hold ? L.valueWorm : L.valuePolicy}
                    tone="slate"
                  />
                  <MiniDatum
                    label={L.miniHash}
                    value={shortHash(groupSummary.latest_recovery_point?.content_hash)}
                    tone="slate"
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{L.bootOrderTitle}</h3>
                  <Badge variant="outline">{L.membersCount((groupSummary.members ?? []).length)}</Badge>
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{L.colOrder}</TableHead>
                        <TableHead>{L.colSite}</TableHead>
                        <TableHead>{L.colKind}</TableHead>
                        <TableHead>{L.colRpo}</TableHead>
                        <TableHead>{L.colStreamHealth}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(groupSummary.members ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="p-0">
                            <EmptyState
                              icon={Workflow}
                              title={L.noMembersTitle}
                              description={L.noMembersDescription}
                              size="compact"
                            />
                          </TableCell>
                        </TableRow>
                      ) : (
                        [...(groupSummary.members ?? [])]
                          .sort((left, right) => (left.boot_order ?? 0) - (right.boot_order ?? 0))
                          .map((member) => (
                            <TableRow key={`${member.site_id}-${member.boot_order}`}>
                              <TableCell className="font-mono">{member.boot_order ?? '-'}</TableCell>
                              <TableCell>
                                <div className="font-medium">{member.site_name ?? member.site_id}</div>
                                <div className="font-mono text-xs text-muted-foreground">{member.site_id}</div>
                              </TableCell>
                              <TableCell className="capitalize">{member.site_kind ?? 'site'}</TableCell>
                              <TableCell>{formatSeconds(member.stream?.rpo_seconds)}</TableCell>
                              <TableCell>
                                <StatusBadge status={member.stream?.health ?? member.stream?.status ?? 'empty'} />
                              </TableCell>
                            </TableRow>
                          ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
