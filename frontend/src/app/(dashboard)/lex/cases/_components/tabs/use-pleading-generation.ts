'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  casesApi,
  type LegalPleading,
  type PleadingGenerationState,
  type PleadingGenerationStatus,
  type PleadingGenerationStreamHandlers,
  type StartPleadingGenerationPayload,
} from '@/lib/lex/cases';

export type PleadingGenerationViewStatus =
  | PleadingGenerationStatus
  | 'disconnected'
  | 'cancelling'
  | 'retrying';

export interface PleadingGenerationView {
  pleadingId: string;
  status: PleadingGenerationViewStatus;
  progress: number;
  section?: string;
  streamedBody: string;
  error?: string;
  errorCode?: string;
  canRetry: boolean;
  lastEventId?: string;
}

interface UsePleadingGenerationOptions {
  caseId: string;
  onCompleted?: (pleadingId: string) => void;
}

const ACTIVE_STATUSES = new Set<PleadingGenerationViewStatus>([
  'queued',
  'running',
  'disconnected',
  'cancelling',
  'retrying',
]);

function clampProgress(value: number | null | undefined, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, value));
}

function fromServerState(state: PleadingGenerationState): PleadingGenerationView {
  return {
    pleadingId: state.pleading_id,
    status: state.status,
    progress: clampProgress(
      state.progress,
      state.status === 'completed' ? 100 : 0,
    ),
    section: state.current_section ?? undefined,
    streamedBody: state.body ?? '',
    error: state.error_message ?? undefined,
    errorCode: state.error_code ?? undefined,
    canRetry:
      state.can_retry ??
      (state.status === 'failed' || state.status === 'cancelled'),
    lastEventId: state.last_event_id ?? undefined,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePleadingGeneration({
  caseId,
  onCompleted,
}: UsePleadingGenerationOptions) {
  const [generations, setGenerations] = useState<
    Record<string, PleadingGenerationView>
  >({});
  const controllers = useRef(new Map<string, AbortController>());
  const pollTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const restored = useRef(new Set<string>());

  const patch = useCallback(
    (
      pleadingId: string,
      update:
        | Partial<PleadingGenerationView>
        | ((current: PleadingGenerationView) => Partial<PleadingGenerationView>),
    ) => {
      setGenerations((current) => {
        const existing: PleadingGenerationView = current[pleadingId] ?? {
          pleadingId,
          status: 'idle',
          progress: 0,
          streamedBody: '',
          canRetry: false,
        };
        const next = typeof update === 'function' ? update(existing) : update;
        return {
          ...current,
          [pleadingId]: { ...existing, ...next },
        };
      });
    },
    [],
  );

  const stopPolling = useCallback((pleadingId: string) => {
    const timer = pollTimers.current.get(pleadingId);
    if (timer) clearTimeout(timer);
    pollTimers.current.delete(pleadingId);
  }, []);

  const applySnapshot = useCallback(
    (state: PleadingGenerationState) => {
      const next = fromServerState(state);
      setGenerations((current) => ({ ...current, [state.pleading_id]: next }));
      if (state.status === 'completed') onCompleted?.(state.pleading_id);
      return next;
    },
    [onCompleted],
  );

  const poll = useCallback(
    async (pleadingId: string) => {
      stopPolling(pleadingId);
      try {
        const snapshot = await casesApi.getPleadingGeneration(caseId, pleadingId);
        const next = applySnapshot(snapshot);
        if (next.status === 'queued' || next.status === 'running') {
          const timer = setTimeout(() => void poll(pleadingId), 1500);
          pollTimers.current.set(pleadingId, timer);
        }
      } catch (error) {
        patch(pleadingId, {
          status: 'disconnected',
          error: errorMessage(error),
          canRetry: true,
        });
      }
    },
    [applySnapshot, caseId, patch, stopPolling],
  );

  const streamHandlers = useCallback(
    (
      pleadingId: string,
      controller: AbortController,
    ): PleadingGenerationStreamHandlers => ({
      signal: controller.signal,
      onSnapshot: (state) => {
        const snapshot = fromServerState(state);
        patch(pleadingId, (current) => ({
          ...snapshot,
          progress: clampProgress(state.progress, current.progress),
          streamedBody: snapshot.streamedBody || current.streamedBody,
        }));
        if (state.status === 'completed') onCompleted?.(pleadingId);
      },
      onEventId: (lastEventId) => patch(pleadingId, { lastEventId }),
      onStarted: (event) =>
        patch(pleadingId, {
          status: 'running',
          progress: clampProgress(event.progress, 2),
          error: undefined,
          errorCode: undefined,
          canRetry: false,
        }),
      onSection: (event) =>
        patch(pleadingId, (current) => ({
          status: 'running',
          section: event.heading ?? event.section ?? current.section,
          progress: clampProgress(event.progress, current.progress),
        })),
      onDelta: (event) =>
        patch(pleadingId, (current) => ({
          status: 'running',
          streamedBody: `${current.streamedBody}${event.text}`,
          progress: clampProgress(event.progress, current.progress),
        })),
      onCompleted: (event) => {
        patch(pleadingId, (current) => ({
          status: 'completed',
          progress: 100,
          streamedBody: event.body ?? current.streamedBody,
          section: undefined,
          error: undefined,
          canRetry: false,
        }));
        onCompleted?.(pleadingId);
      },
      onFailed: (event) =>
        patch(pleadingId, {
          status: 'failed',
          error: event.message ?? event.error,
          errorCode: event.code,
          canRetry: event.can_retry ?? true,
        }),
      onCancelled: () =>
        patch(pleadingId, {
          status: 'cancelled',
          section: undefined,
          canRetry: true,
        }),
    }),
    [onCompleted, patch],
  );

  const runStream = useCallback(
    async (
      pleadingId: string,
      mode: 'start' | 'retry' | 'resume',
      payload?: StartPleadingGenerationPayload,
    ) => {
      stopPolling(pleadingId);
      restored.current.add(pleadingId);
      controllers.current.get(pleadingId)?.abort();
      const controller = new AbortController();
      controllers.current.set(pleadingId, controller);
      patch(pleadingId, {
        status: mode === 'retry' ? 'retrying' : 'queued',
        progress: mode === 'resume' ? generations[pleadingId]?.progress ?? 0 : 0,
        streamedBody:
          mode === 'resume'
            ? generations[pleadingId]?.streamedBody ?? ''
            : '',
        section: undefined,
        error: undefined,
        errorCode: undefined,
        canRetry: false,
      });

      try {
        const handlers = streamHandlers(pleadingId, controller);
        if (mode === 'retry') {
          await casesApi.retryPleadingGeneration(
            caseId,
            pleadingId,
            handlers,
          );
        } else if (mode === 'resume') {
          await casesApi.resumePleadingGeneration(
            caseId,
            pleadingId,
            handlers,
            generations[pleadingId]?.lastEventId,
          );
        } else if (payload) {
          await casesApi.streamPleadingGeneration(
            caseId,
            pleadingId,
            payload,
            handlers,
          );
        }
      } catch (error) {
        if (!isAbortError(error)) {
          if (mode === 'resume') {
            await poll(pleadingId);
          } else {
            patch(pleadingId, {
              status: 'disconnected',
              error: errorMessage(error),
              canRetry: true,
            });
          }
        }
      } finally {
        if (controllers.current.get(pleadingId) === controller) {
          controllers.current.delete(pleadingId);
        }
      }
    },
    [caseId, generations, patch, poll, stopPolling, streamHandlers],
  );

  const start = useCallback(
    (pleadingId: string, payload: StartPleadingGenerationPayload) =>
      runStream(pleadingId, 'start', payload),
    [runStream],
  );

  const retry = useCallback(
    (pleadingId: string) => runStream(pleadingId, 'retry'),
    [runStream],
  );

  const cancel = useCallback(
    async (pleadingId: string) => {
      stopPolling(pleadingId);
      controllers.current.get(pleadingId)?.abort();
      controllers.current.delete(pleadingId);
      patch(pleadingId, { status: 'cancelling' });
      try {
        await casesApi.cancelPleadingGeneration(caseId, pleadingId);
        patch(pleadingId, {
          status: 'cancelled',
          section: undefined,
          canRetry: true,
        });
      } catch (error) {
        patch(pleadingId, {
          status: 'disconnected',
          error: errorMessage(error),
          canRetry: true,
        });
      }
    },
    [caseId, patch, stopPolling],
  );

  const resume = useCallback(
    (pleadingId: string) => runStream(pleadingId, 'resume'),
    [runStream],
  );

  const restore = useCallback(
    async (pleadings: LegalPleading[]) => {
      const candidates = pleadings.filter(
        (pleading) =>
          pleading.status === 'draft' &&
          !pleading.body?.trim() &&
          !restored.current.has(pleading.id),
      );
      await Promise.all(
        candidates.map(async (pleading) => {
          restored.current.add(pleading.id);
          try {
            const state = await casesApi.getPleadingGeneration(caseId, pleading.id);
            const next = applySnapshot(state);
            if (next.status === 'queued' || next.status === 'running') {
              await runStream(pleading.id, 'resume');
            }
          } catch {
            // An empty manual draft may have no generation resource.
          }
        }),
      );
    },
    [applySnapshot, caseId, runStream],
  );

  const dismiss = useCallback((pleadingId: string) => {
    setGenerations((current) => {
      const { [pleadingId]: _dismissed, ...remaining } = current;
      return remaining;
    });
  }, []);

  useEffect(
    () => () => {
      // Detach only. The durable server job continues until its own terminal
      // state or an explicit user cancellation.
      controllers.current.forEach((controller) => controller.abort());
      pollTimers.current.forEach((timer) => clearTimeout(timer));
      controllers.current.clear();
      pollTimers.current.clear();
    },
    [],
  );

  return {
    generations,
    start,
    retry,
    cancel,
    resume,
    restore,
    dismiss,
    isActive: (pleadingId: string) =>
      ACTIVE_STATUSES.has(generations[pleadingId]?.status),
  };
}
