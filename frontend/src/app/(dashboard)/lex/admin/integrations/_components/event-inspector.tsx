'use client';

/**
 * EventInspector (#17) — inbound/outbound event stream for one endpoint OR the
 * whole tenant.
 *
 * When `endpointId` is set it reads GET /integrations/{id}/events; when omitted
 * it reads the tenant-wide GET /integrations/events and adds an Integration
 * column. Filterable by direction / kind / status (server-side) plus a free-text
 * client filter over kind / result-action / error. Each row shows direction, the
 * event kind, a signature-valid badge, status, result action, relative time, and
 * an expandable REDACTED payload (never an un-redacted one). An INBOUND event can
 * be REPLAYED (POST /integrations/events/{eventId}/replay) — gated on `canManage`
 * (`lex:integration:manage`); read-only users see the table only.
 *
 * Replay is optimistic (the row is marked busy), toasts on result, and
 * invalidates the relevant react-query keys. Reads use an explicit degraded flag
 * so read failures are not confused with an empty event stream. RTL via `dir`.
 */
import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Inbox,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { StatusBadge } from '@/components/shared/status-badge';
import { RelativeTime } from '@/components/shared/relative-time';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showSuccess, showBackendError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  getEventsResult,
  getEventsAllResult,
  replayEvent,
  EVENT_DIRECTIONS,
  EVENT_STATUSES,
  type EventDirection,
  type EventFilters,
  type EventStatus,
  type IntegrationEvent,
} from '@/lib/lex/integrations';
import {
  buildDirectionConfig,
  buildEventStatusConfig,
  useObservabilityLabels,
} from '../_lib/observability-labels';

interface EventInspectorProps {
  /** When set: per-endpoint events. When omitted: tenant-wide view. */
  endpointId?: string;
  /** Gated on `lex:integration:manage`; read-only users get the table only. */
  canManage?: boolean;
  /**
   * Optional map endpoint id → display name, used only in the tenant-wide view
   * to label the Integration column. Falls back to the raw id.
   */
  endpointNames?: Record<string, string>;
}

const EVENTS_KEY = 'lex-integration-events';
const EVENTS_ALL_KEY = 'lex-integration-events-all';
const ALL = '__all__';

export function EventInspector({ endpointId, canManage = false, endpointNames }: EventInspectorProps) {
  const t = useObservabilityLabels();
  const { locale, direction } = useLocaleOrDefault();
  const qc = useQueryClient();
  const isGlobal = !endpointId;

  const statusConfig = buildEventStatusConfig(t);
  const directionConfig = buildDirectionConfig(t);

  // Server-side filters.
  const [dirFilter, setDirFilter] = useState<EventDirection | typeof ALL>(ALL);
  const [statusFilter, setStatusFilter] = useState<EventStatus | typeof ALL>(ALL);
  // Free-text client filter over kind / result-action / error.
  const [search, setSearch] = useState('');

  const filters: EventFilters = useMemo(
    () => ({
      direction: dirFilter === ALL ? undefined : dirFilter,
      status: statusFilter === ALL ? undefined : statusFilter,
      limit: 100,
    }),
    [dirFilter, statusFilter],
  );

  const queryKey = isGlobal
    ? [EVENTS_ALL_KEY, filters]
    : [EVENTS_KEY, endpointId, filters];

  const q = useQuery({
    queryKey,
    queryFn: () => (isGlobal ? getEventsAllResult(filters) : getEventsResult(endpointId!, filters)),
    staleTime: 15_000,
  });

  const allEvents = useMemo(() => q.data?.events ?? [], [q.data]);
  const degraded = q.data?.degraded ?? false;

  const events = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allEvents;
    return allEvents.filter((e) =>
      [e.kind, e.result_action, e.error].some((f) => f?.toLowerCase().includes(term)),
    );
  }, [allEvents, search]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replayTarget, setReplayTarget] = useState<IntegrationEvent | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function invalidate() {
    await qc.invalidateQueries({ queryKey: [isGlobal ? EVENTS_ALL_KEY : EVENTS_KEY] });
    // Keep the other view in sync (a per-endpoint replay also affects global).
    await qc.invalidateQueries({ queryKey: [isGlobal ? EVENTS_KEY : EVENTS_ALL_KEY] });
  }

  const replay = useMutation({
    mutationFn: (eventId: string) => replayEvent(eventId),
    onMutate: (eventId) => setReplayingId(eventId),
    onSuccess: async () => {
      showSuccess(t.toastReplayed);
      await invalidate();
    },
    onError: (e) => showBackendError(e, t.observabilityError),
    onSettled: () => setReplayingId(null),
  });

  const colSpan = (isGlobal ? 8 : 7) + (canManage ? 1 : 0);

  return (
    <div className="space-y-3" dir={direction} lang={locale}>
      {/* Filter toolbar. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.eventsSearchPlaceholder}
          className="h-9 w-full max-w-xs"
          aria-label={t.eventsSearchPlaceholder}
        />

        <Select value={dirFilter} onValueChange={(v) => setDirFilter(v as EventDirection | typeof ALL)}>
          <SelectTrigger className="h-9 w-[10rem]" aria-label={t.filterDirection}>
            <SelectValue placeholder={t.filterDirection} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{`${t.filterDirection}: ${t.filterAll}`}</SelectItem>
            {EVENT_DIRECTIONS.map((d) => (
              <SelectItem key={d} value={d}>
                {directionConfig[d]?.label ?? d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as EventStatus | typeof ALL)}>
          <SelectTrigger className="h-9 w-[10rem]" aria-label={t.filterStatus}>
            <SelectValue placeholder={t.filterStatus} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{`${t.filterStatus}: ${t.filterAll}`}</SelectItem>
            {EVENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {statusConfig[s]?.label ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ms-auto"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
        >
          <RefreshCw className={cn('me-1.5 h-4 w-4', q.isFetching && 'animate-spin')} aria-hidden />
          {t.refresh}
        </Button>
      </div>

      {q.isLoading ? (
        <LoadingSkeleton variant="table-row" count={5} />
      ) : q.isError || degraded ? (
        <ErrorState
          variant="generic"
          title={t.eventsTitle}
          message={t.observabilityError}
          onRetry={() => void q.refetch()}
        />
      ) : events.length === 0 ? (
        <EmptyState icon={Inbox} title={t.eventsEmpty} description={t.eventsEmptyHint} size="compact" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-premium w-full text-sm">
            <thead>
              <tr>
                <th className="w-8" aria-hidden />
                <th className="text-start">{t.colDirection}</th>
                {isGlobal ? <th className="text-start">{t.colEndpoint}</th> : null}
                <th className="text-start">{t.colEventKind}</th>
                <th className="text-start">{t.colSignature}</th>
                <th className="text-start">{t.colStatus}</th>
                <th className="text-start">{t.colResultAction}</th>
                <th className="text-start">{t.colWhen}</th>
                {canManage ? <th className="text-end">{t.colActions}</th> : null}
              </tr>
            </thead>
            <tbody>
              {events.map((evt: IntegrationEvent) => {
                const isOpen = expanded.has(evt.id);
                const rowBusy = replayingId === evt.id && replay.isPending;
                const canReplay = canManage && evt.direction === 'inbound';
                const sigInbound = evt.direction === 'inbound';
                return (
                  <Fragment key={evt.id}>
                    <tr>
                      <td className="align-middle">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(evt.id)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                          aria-label={isOpen ? t.hidePayload : t.showPayload}
                          aria-expanded={isOpen}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" aria-hidden />
                          ) : (
                            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                          )}
                        </button>
                      </td>
                      <td>
                        <StatusBadge status={evt.direction} config={directionConfig} size="sm" />
                      </td>
                      {isGlobal ? (
                        <td className="max-w-[12rem] truncate" title={evt.endpoint_id}>
                          {endpointNames?.[evt.endpoint_id] ?? evt.endpoint_id}
                        </td>
                      ) : null}
                      <td className="max-w-[14rem] truncate" title={evt.kind} dir="ltr">
                        {evt.kind || '—'}
                      </td>
                      <td>
                        {sigInbound ? (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 text-xs',
                              evt.signature_valid ? 'text-primary' : 'text-destructive',
                            )}
                          >
                            {evt.signature_valid ? (
                              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                            ) : (
                              <ShieldX className="h-3.5 w-3.5" aria-hidden />
                            )}
                            {evt.signature_valid ? t.signatureValid : t.signatureInvalid}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t.signatureNA}</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={evt.status} config={statusConfig} size="sm" />
                      </td>
                      <td className="max-w-[12rem] truncate" title={evt.result_action}>
                        {evt.result_action || '—'}
                      </td>
                      <td className="whitespace-nowrap">
                        <RelativeTime date={evt.occurred_at} />
                      </td>
                      {canManage ? (
                        <td className="text-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setReplayTarget(evt)}
                            disabled={!canReplay || rowBusy || replay.isPending}
                            title={canReplay ? t.replay : t.replayInboundOnly}
                          >
                            {rowBusy ? (
                              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden />
                            )}
                            {rowBusy ? t.replaying : t.replay}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={colSpan} className="bg-muted/20">
                          <div className="space-y-2 px-2 py-2">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
                              <span className="font-medium">{t.payloadTitle}</span>
                            </div>
                            <pre
                              className="max-h-64 overflow-auto rounded-lg border bg-background p-3 text-caption leading-relaxed text-foreground"
                              dir="ltr"
                            >
                              {evt.payload_redacted || '—'}
                            </pre>
                            {evt.error ? (
                              <div className="space-y-1">
                                <p className="text-caption font-medium text-destructive">{t.errorTitle}</p>
                                <pre
                                  className="max-h-32 overflow-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-caption leading-relaxed text-destructive"
                                  dir="ltr"
                                >
                                  {evt.error}
                                </pre>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <ConfirmDialog
          open={replayTarget !== null}
          onOpenChange={(open) => {
            if (!open) setReplayTarget(null);
          }}
          title={t.replayConfirmTitle}
          description={t.replayConfirmBody}
          confirmLabel={t.replay}
          loading={replay.isPending}
          onConfirm={async () => {
            if (replayTarget) await replay.mutateAsync(replayTarget.id);
            setReplayTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

export default EventInspector;
