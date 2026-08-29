'use client';

/**
 * Case-timeline panel (CAP-084..088) — a self-contained, embeddable block that
 * surfaces a matter's estimated duration, external-hold state, and the
 * classified delay-event register. Designed to be dropped onto a matter/case
 * detail page (it owns its own queries keyed by matterId) but is also rendered
 * standalone on the settlements area's timeline route.
 *
 * This is the THIN SHELL: it owns the timeline query, all four mutations, and
 * all dialog state, then composes the two presentational/self-fetching blocks
 * (`<TimelineOverview/>` + `<DelayEventList/>`) and the dialogs. The delay-event
 * data lives inside `<DelayEventList/>`; the shell still invalidates that query
 * by its prefix `['lex-matter-delay-events', matterId]` after every mutation.
 *
 * Permission gating is delegated to the caller via `canWrite`; when false the
 * panel renders read-only (no action buttons / dialogs).
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { downloadBlob } from '@/lib/format';
import { showApiError, showInfo, showSuccess } from '@/lib/toast';
import { useRealtimeStore } from '@/stores/realtime-store';
import { delayCategoryLabel, useSettlementLabels } from './labels';
import { TimelineOverview } from './timeline-overview';
import { DelayEventList, delayEventsQueryKey } from './delay-event-list';
import { DeadlinesCard, deadlinesQueryKey } from './deadlines-card';
import { HoldHistoryCard, holdHistoryQueryKey } from './hold-history-card';
import {
  settlementsApi,
  type LegalCaseDelayEvent,
  type RecordDelayEventPayload,
  type SetExternalHoldPayload,
  type UpdateMatterTimelinePayload,
} from '@/lib/lex/settlements';
import { TimelineEstimateDialog } from './timeline-estimate-dialog';
import { TimelineHoldDialog } from './timeline-hold-dialog';
import { DelayEventDialog } from './delay-event-dialog';
import { buildTimelineCsv, timelineCsvFilename } from './timeline-export';

/**
 * Realtime (#19): the notifications websocket only ever delivers ONE envelope
 * type — `notification.new` (see `hooks/use-websocket.ts`). The actual lex
 * domain event rides INSIDE the notification record (`message.data`): the raw
 * CloudEvent type is in `data.data.event_type`, the matter in
 * `data.data.matter_id`, and `data.category === 'case'`. So the panel subscribes
 * to the single `notification.new` topic and filters the payload down to THIS
 * matter's timeline events.
 *
 * Fully fail-safe: until the server-side notification rules that forward lex
 * matter events are deployed, the topic simply never carries a matching payload
 * and nothing happens (no throw, no spurious refetch). See backend report
 * (notification-service `rule_engine.go` lex.matter.* rules).
 */
const REALTIME_TOPIC = 'notification.new';

/** CloudEvent type prefix for lex matter-timeline domain events. */
const LEX_MATTER_EVENT_PREFIX = 'com.clario360.lex.matter.';

/** Throttle window (ms) so a burst of realtime events shows at most one toast. */
const REALTIME_TOAST_THROTTLE_MS = 4000;

interface CaseTimelinePanelProps {
  matterId: string;
  canWrite: boolean;
}

export function CaseTimelinePanel({ matterId, canWrite }: CaseTimelinePanelProps) {
  const queryClient = useQueryClient();
  const L = useSettlementLabels();
  const labels = L.timeline;

  const [estimateOpen, setEstimateOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [delayOpen, setDelayOpen] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<LegalCaseDelayEvent | null>(null);

  const timelineQuery = useQuery({
    queryKey: ['lex-matter-timeline', matterId],
    queryFn: () => settlementsApi.getTimeline(matterId),
    enabled: Boolean(matterId),
  });

  const refresh = async () => {
    await Promise.all([
      timelineQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: delayEventsQueryKey(matterId) }),
      queryClient.invalidateQueries({ queryKey: ['lex-matter', matterId] }),
    ]);
  };

  // --- #19 realtime ------------------------------------------------------
  // Subscribe (while mounted for this matterId) to the `notification.new` topic
  // on the shared realtime store, which `useWebSocket` feeds from every inbound
  // websocket message. We bind it to ONE sentinel query key, then on each new
  // store entry filter the notification payload to this matter's lex timeline
  // events before invalidating the four matter-scoped queries + showing a
  // throttled, subtle toast. Entirely fail-safe: irrelevant notifications are
  // ignored and a never-firing topic does nothing.
  const realtimeKey = `lex-timeline-panel:${matterId}`;
  const registerTopic = useRealtimeStore((state) => state.register);
  const unregisterTopic = useRealtimeStore((state) => state.unregister);
  const realtimeEvent = useRealtimeStore((state) => state.queryEvents[realtimeKey]);
  const lastToastAtRef = useRef(0);
  const handledCountRef = useRef(0);

  useEffect(() => {
    if (!matterId) return;
    registerTopic(REALTIME_TOPIC, realtimeKey);
    return () => {
      unregisterTopic(REALTIME_TOPIC, realtimeKey);
    };
  }, [matterId, realtimeKey, registerTopic, unregisterTopic]);

  useEffect(() => {
    if (!realtimeEvent || !matterId) return;
    // Only react to genuinely new store events for this mount.
    if (realtimeEvent.count <= handledCountRef.current) return;
    handledCountRef.current = realtimeEvent.count;

    // The websocket envelope is always `notification.new`; the lex domain event
    // rides inside the notification record. Pull out the matter + event type and
    // bail unless this is a lex matter-timeline event for THIS matter (avoids
    // cross-matter refetches / misleading toasts).
    // Payload shape (from notification-service rule_engine): the record's own
    // `type` is the notification kind ("matter.timeline"); the raw CloudEvent
    // type, matter id and actor id live in the nested `data` metadata. NOTE the
    // record `category` is "legal" (DB CHECK constraint) — do NOT filter on it.
    const payload = realtimeEvent.payload as
      | {
          type?: string;
          data?: { matter_id?: string; event_type?: string; actor_id?: string } | null;
        }
      | null
      | undefined;
    const meta = payload?.data ?? undefined;
    const eventType = meta?.event_type;
    const eventMatterId = meta?.matter_id;
    const isLexMatterEvent =
      payload?.type === 'matter.timeline' ||
      (eventType?.startsWith(LEX_MATTER_EVENT_PREFIX) ?? false);
    if (!isLexMatterEvent || eventMatterId !== matterId) return;

    void queryClient.invalidateQueries({ queryKey: ['lex-matter-timeline', matterId] });
    void queryClient.invalidateQueries({ queryKey: delayEventsQueryKey(matterId) });
    void queryClient.invalidateQueries({ queryKey: deadlinesQueryKey(matterId) });
    void queryClient.invalidateQueries({ queryKey: holdHistoryQueryKey(matterId) });

    // Throttle toasts so a burst of events doesn't spam the user. The backend
    // payload carries only an actor id (no display name — there is no lex-local
    // user table), so we show the generic "updated" toast; the by-name variants
    // (`delayRecordedBy`/`delayResolvedBy`) are reserved for when actor-name
    // resolution is wired in.
    const now = Date.now();
    if (now - lastToastAtRef.current < REALTIME_TOAST_THROTTLE_MS) return;
    lastToastAtRef.current = now;
    showInfo(labels.realtime.updated);
  }, [realtimeEvent, matterId, queryClient, labels.realtime]);

  // --- #20 export & print ------------------------------------------------
  const handleExportCsv = async () => {
    const current = timelineQuery.data;
    if (!current) return;
    try {
      const page = await settlementsApi.listDelayEvents(
        matterId,
        { page: 1, per_page: 1000 },
        { sort: 'opened_at', sort_dir: 'desc' },
      );
      const csv = buildTimelineCsv(current, page.data, {
        categoryLabel: (category) => delayCategoryLabel(L, category),
        yes: labels.exportMenu.yes,
        no: labels.exportMenu.no,
        summary: {
          heading: labels.title,
          matterNumber: labels.exportMenu.matterNumber,
          title: labels.exportMenu.title,
          estimatedDuration: labels.estimatedDuration,
          estimatedCompletion: labels.estimatedCompletion,
          openDelayDays: labels.openDelayDays,
          externalHold: labels.externalHold,
          externalHoldCategory: labels.holdCategory,
          externalHoldSince: labels.holdSince,
        },
        register: {
          heading: labels.delayEventsTitle,
          category: labels.filter.label,
          reason: labels.exportMenu.reason,
          openedAt: labels.openedAt,
          resolvedAt: labels.resolvedAt,
          resolved: labels.resolved,
          durationDays: labels.duration.label,
        },
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      downloadBlob(blob, timelineCsvFilename(current.matter_number));
    } catch (error) {
      showApiError(error);
    }
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const estimateMutation = useMutation({
    mutationFn: (payload: UpdateMatterTimelinePayload) =>
      settlementsApi.updateTimeline(matterId, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.estimateUpdated);
      setEstimateOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const holdMutation = useMutation({
    mutationFn: (payload: SetExternalHoldPayload) => settlementsApi.setExternalHold(matterId, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.holdUpdated);
      setHoldOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const delayMutation = useMutation({
    mutationFn: (payload: RecordDelayEventPayload) =>
      settlementsApi.recordDelayEvent(matterId, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.delayRecorded);
      setDelayOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ eventId, alsoClear }: { eventId: string; alsoClear: boolean }) =>
      settlementsApi.resolveDelayEvent(matterId, eventId, { also_clear_external_hold: alsoClear }),
    onSuccess: async () => {
      showSuccess(labels.toast.delayResolved);
      setResolveTarget(null);
      await refresh();
    },
    onError: showApiError,
  });

  if (timelineQuery.isLoading) {
    return (
      <SectionCard title={labels.title} description={labels.description}>
        <LoadingSkeleton variant="card" count={4} />
      </SectionCard>
    );
  }

  if (timelineQuery.isError || !timelineQuery.data) {
    return (
      <SectionCard title={labels.title} description={labels.description}>
        <ErrorState message={labels.delayError} onRetry={() => void timelineQuery.refetch()} />
      </SectionCard>
    );
  }

  const timeline = timelineQuery.data;

  return (
    <div className="space-y-4">
      {/* #20 panel-level export / print menu */}
      <div className="flex items-center justify-end print:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Download className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {labels.exportMenu.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void handleExportCsv()}>
              <FileSpreadsheet className="me-2 h-3.5 w-3.5" aria-hidden />
              {labels.exportMenu.csv}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handlePrint}>
              <Printer className="me-2 h-3.5 w-3.5" aria-hidden />
              {labels.exportMenu.print}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <TimelineOverview
        timeline={timeline}
        canWrite={canWrite}
        onSetEstimate={() => setEstimateOpen(true)}
        onToggleHold={() => setHoldOpen(true)}
      />

      <DeadlinesCard matterId={matterId} canWrite={canWrite} />

      <DelayEventList
        matterId={matterId}
        canWrite={canWrite}
        onRecordDelay={() => setDelayOpen(true)}
        onResolve={(event) => setResolveTarget(event)}
      />

      <HoldHistoryCard matterId={matterId} />

      {canWrite ? (
        <>
          <TimelineEstimateDialog
            open={estimateOpen}
            loading={estimateMutation.isPending}
            timeline={timeline}
            onOpenChange={setEstimateOpen}
            onSubmit={(payload) => estimateMutation.mutate(payload)}
          />
          <TimelineHoldDialog
            open={holdOpen}
            loading={holdMutation.isPending}
            timeline={timeline}
            onOpenChange={setHoldOpen}
            onSubmit={(payload) => holdMutation.mutate(payload)}
          />
          <DelayEventDialog
            open={delayOpen}
            loading={delayMutation.isPending}
            onOpenChange={setDelayOpen}
            onSubmit={(payload) => delayMutation.mutate(payload)}
          />
          <ConfirmDialog
            open={resolveTarget !== null}
            onOpenChange={(open) => {
              if (!open) setResolveTarget(null);
            }}
            title={labels.resolveDialog.title}
            description={labels.resolveDialog.description(resolveTarget?.reason ?? '')}
            confirmLabel={labels.resolveDialog.confirm}
            loading={resolveMutation.isPending}
            onConfirm={() => {
              if (resolveTarget) {
                resolveMutation.mutate({ eventId: resolveTarget.id, alsoClear: true });
              }
            }}
          />
        </>
      ) : null}
    </div>
  );
}
