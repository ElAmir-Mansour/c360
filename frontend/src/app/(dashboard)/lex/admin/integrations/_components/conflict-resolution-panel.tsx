'use client';

/**
 * ConflictResolutionPanel (#20) — the reconciliation conflicts queue for one
 * endpoint.
 *
 * Reads `getConflictsResult(id)` (GET /integrations/{id}/conflicts, populated by
 * Reconcile) and renders each field-level divergence in a `.table-premium`:
 * external_id, field, and the SOURCE vs lex value side-by-side, plus the
 * connector-suggested resolution. Per row the operator may resolve with
 * merge / override / ignore (`resolveConflict`, manage-gated); a bulk bar applies
 * one resolution to every selected open conflict. A status filter + small KPI
 * strip keep the queue navigable. Read helper reports degraded reads explicitly;
 * the resolve mutation surfaces errors via toast.
 *
 * Every string flows through the bilingual extensibility label module. RTL-safe
 * (logical properties; the table never relies on left/right). Manage gate
 * (`canManage` ⇐ `lex:integration:manage`): read-only users see the queue but no
 * resolve affordances.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ar as arLocale, enUS } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, GitMerge, Loader2, Replace, ShieldQuestion, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KpiCard } from '@/components/shared/kpi-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  CONFLICT_RESOLUTIONS,
  lexIntegrationsApi,
  type Conflict,
  type ConflictResolution,
  type ConflictStatus,
} from '@/lib/lex/integrations';
import {
  conflictStatusLabel,
  fillExtToken,
  resolutionHint,
  resolutionLabel,
  useExtensibilityLabels,
  type ExtensibilityLabels,
} from '../_lib/extensibility-labels';

/** React-query key for an endpoint's conflicts queue. */
export const CONFLICTS_KEY = 'lex-integration-conflicts';

type StatusFilter = 'all' | ConflictStatus;

const RESOLUTION_ICON: Record<ConflictResolution, typeof GitMerge> = {
  merge: GitMerge,
  override: Replace,
  ignore: XCircle,
};

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export interface ConflictResolutionPanelProps {
  endpointId: string;
  /** Manage gate (`lex:integration:manage`); read-only users get no actions. */
  canManage: boolean;
}

export function ConflictResolutionPanel({ endpointId, canManage }: ConflictResolutionPanelProps) {
  const t = useExtensibilityLabels();
  const { locale } = useLocaleOrDefault();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<StatusFilter>('open');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkResolution, setBulkResolution] = useState<ConflictResolution>('merge');

  const query = useQuery({
    queryKey: [CONFLICTS_KEY, endpointId],
    queryFn: () => lexIntegrationsApi.getConflictsResult(endpointId),
    enabled: Boolean(endpointId),
    staleTime: 15_000,
  });

  const conflicts = useMemo(() => query.data?.conflicts ?? [], [query.data]);
  const degraded = query.data?.degraded ?? false;
  const stats = useMemo(() => {
    let open = 0;
    let resolved = 0;
    for (const c of conflicts) {
      if (c.status === 'resolved') resolved += 1;
      else open += 1;
    }
    return { open, resolved, total: conflicts.length };
  }, [conflicts]);
  const openShare = percent(stats.open, stats.total);
  const resolvedShare = percent(stats.resolved, stats.total);

  const visible = useMemo(
    () => (filter === 'all' ? conflicts : conflicts.filter((c) => c.status === filter)),
    [conflicts, filter],
  );

  // Only OPEN rows are selectable / resolvable.
  const openVisible = useMemo(() => visible.filter((c) => c.status === 'open'), [visible]);

  const resolveOne = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: ConflictResolution }) =>
      lexIntegrationsApi.resolveConflict(id, resolution),
    onSuccess: async () => {
      showSuccess(t.toastConflictResolved);
      await qc.invalidateQueries({ queryKey: [CONFLICTS_KEY, endpointId] });
    },
    onError: showApiError,
  });

  const resolveBulk = useMutation({
    mutationFn: async ({ ids, resolution }: { ids: string[]; resolution: ConflictResolution }) => {
      let n = 0;
      for (const id of ids) {
        await lexIntegrationsApi.resolveConflict(id, resolution);
        n += 1;
      }
      return n;
    },
    onSuccess: async (n) => {
      showSuccess(fillExtToken(t.toastConflictsResolved, { n }));
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: [CONFLICTS_KEY, endpointId] });
    },
    onError: showApiError,
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (prev.size === openVisible.length) return new Set();
      return new Set(openVisible.map((c) => c.id));
    });
  }

  const busy = resolveOne.isPending || resolveBulk.isPending;
  const selectedOpen = openVisible.filter((c) => selected.has(c.id));

  if (query.isLoading) {
    return <LoadingSkeleton variant="table-row" count={5} />;
  }
  if (query.isError || degraded) {
    return (
      <ErrorState
        variant="generic"
        title={t.conflictsErrorTitle}
        message={t.conflictsErrorBody}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="conflict-resolution-kpi-grid">
        <KpiCard
          appearance="operational"
          title={t.conflictsKpiOpen}
          value={stats.open}
          tone="gold"
          icon={AlertTriangle}
          progress={openShare}
          progressLabel={t.conflictsKpiTotal}
          detail={t.conflictsFilterAll}
          detailValue={`${openShare}%`}
          onAction={() => setFilter('open')}
          pressed={filter === 'open'}
        />
        <KpiCard
          appearance="operational"
          title={t.conflictsKpiResolved}
          value={stats.resolved}
          tone="emerald"
          icon={CheckCircle2}
          progress={resolvedShare}
          progressLabel={t.conflictsKpiTotal}
          detail={t.conflictsFilterAll}
          detailValue={`${resolvedShare}%`}
          onAction={() => setFilter('resolved')}
          pressed={filter === 'resolved'}
        />
        <KpiCard
          appearance="operational"
          title={t.conflictsKpiTotal}
          value={stats.total}
          tone="slate"
          detail={t.conflictsKpiOpen}
          detailValue={stats.open}
          onAction={() => setFilter('all')}
          pressed={filter === 'all'}
        />
      </div>

      {/* Status filter. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex overflow-hidden rounded-md border" role="tablist">
          {(
            [
              ['open', t.conflictsFilterOpen],
              ['resolved', t.conflictsFilterResolved],
              ['all', t.conflictsFilterAll],
            ] as const
          ).map(([key, label], i) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                i > 0 && 'border-s',
                filter === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-transparent text-muted-foreground hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {!canManage ? <p className="text-xs text-muted-foreground">{t.conflictsManageOnly}</p> : null}
      </div>

      {/* Bulk bar (manage-gated). */}
      {canManage && selectedOpen.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2">
          <span className="text-sm font-medium">{fillExtToken(t.conflictsSelected, { n: selectedOpen.length })}</span>
          <div className="ms-auto flex items-center gap-2">
            <Select
              value={bulkResolution}
              onValueChange={(v) => setBulkResolution(v as ConflictResolution)}
              disabled={busy}
            >
              <SelectTrigger className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONFLICT_RESOLUTIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {resolutionLabel(t, r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              onClick={() =>
                resolveBulk.mutate({
                  ids: selectedOpen.map((c) => c.id),
                  resolution: bulkResolution,
                })
              }
              disabled={busy}
            >
              {resolveBulk.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              {t.conflictsBulkResolve}
            </Button>
          </div>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t.conflictsEmptyTitle} description={t.conflictsEmptyBody} />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-premium w-full">
            <thead>
              <tr>
                {canManage ? (
                  <th className="w-10">
                    <Checkbox
                      checked={openVisible.length > 0 && selected.size === openVisible.length}
                      onCheckedChange={toggleAll}
                      disabled={openVisible.length === 0 || busy}
                      aria-label={t.conflictsSelectAll}
                    />
                  </th>
                ) : null}
                <th>{t.conflictsColExternalId}</th>
                <th>{t.conflictsColField}</th>
                <th>{t.conflictsColSource}</th>
                <th>{t.conflictsColLex}</th>
                <th>{t.conflictsColSuggested}</th>
                <th>{t.conflictsColStatus}</th>
                <th>{t.conflictsColDetected}</th>
                {canManage ? <th>{t.conflictsColActions}</th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((conflict) => (
                <ConflictRow
                  key={conflict.id}
                  conflict={conflict}
                  canManage={canManage}
                  selected={selected.has(conflict.id)}
                  busy={busy}
                  pendingId={resolveOne.isPending ? resolveOne.variables?.id : undefined}
                  locale={locale}
                  t={t}
                  onToggle={() => toggle(conflict.id)}
                  onResolve={(resolution) => resolveOne.mutate({ id: conflict.id, resolution })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------- *
 * One conflict row.
 * --------------------------------------------------------------------------- */

interface ConflictRowProps {
  conflict: Conflict;
  canManage: boolean;
  selected: boolean;
  busy: boolean;
  pendingId?: string;
  locale: AppLocale;
  t: ExtensibilityLabels;
  onToggle: () => void;
  onResolve: (resolution: ConflictResolution) => void;
}

function ConflictRow({
  conflict,
  canManage,
  selected,
  busy,
  pendingId,
  locale,
  t,
  onToggle,
  onResolve,
}: ConflictRowProps) {
  const isOpen = conflict.status === 'open';
  const rowPending = busy && pendingId === conflict.id;
  const suggested = conflict.suggested as ConflictResolution | undefined;
  const detected = formatWhen(conflict.detected_at, locale);

  return (
    <tr className={cn(!isOpen && 'opacity-70')}>
      {canManage ? (
        <td>
          {isOpen ? (
            <Checkbox checked={selected} onCheckedChange={onToggle} disabled={busy} aria-label={conflict.external_id} />
          ) : null}
        </td>
      ) : null}
      <td className="whitespace-nowrap font-mono text-xs">{conflict.external_id || '—'}</td>
      <td className="whitespace-nowrap font-medium">{conflict.field || '—'}</td>
      <td className="max-w-[14rem] truncate" dir="ltr" title={conflict.source_value}>
        {conflict.source_value || '—'}
      </td>
      <td className="max-w-[14rem] truncate" dir="ltr" title={conflict.lex_value}>
        {conflict.lex_value || '—'}
      </td>
      <td>
        {suggested && CONFLICT_RESOLUTIONS.includes(suggested) ? (
          <Badge variant="outline" className="gap-1 normal-case tracking-normal">
            <ShieldQuestion className="h-3 w-3" aria-hidden />
            {resolutionLabel(t, suggested)}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{t.conflictsNoSuggestion}</span>
        )}
      </td>
      <td>
        <Badge variant={isOpen ? 'warning' : 'success'}>{conflictStatusLabel(t, conflict.status)}</Badge>
      </td>
      <td className="whitespace-nowrap text-xs text-muted-foreground">{detected}</td>
      {canManage ? (
        <td>
          {isOpen ? (
            <div className="flex items-center gap-1">
              {CONFLICT_RESOLUTIONS.map((r) => {
                const Icon = RESOLUTION_ICON[r];
                return (
                  <Button
                    key={r}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => onResolve(r)}
                    disabled={busy}
                    title={resolutionHint(t, r)}
                  >
                    {rowPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Icon className="me-1 h-3.5 w-3.5" aria-hidden />
                    )}
                    {resolutionLabel(t, r)}
                  </Button>
                );
              })}
            </div>
          ) : conflict.resolution && CONFLICT_RESOLUTIONS.includes(conflict.resolution as ConflictResolution) ? (
            <Badge variant="outline" className="normal-case tracking-normal">
              {resolutionLabel(t, conflict.resolution as ConflictResolution)}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
      ) : null}
    </tr>
  );
}

function formatWhen(value: string, locale: AppLocale): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'PP p', { locale: locale === 'ar' ? arLocale : enUS });
}

export default ConflictResolutionPanel;
