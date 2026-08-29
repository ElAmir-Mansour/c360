'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { DRGroupSummary, DRReplicationSummary } from '@/lib/clario-dr';

/**
 * Shared DR group/stream selection, sourced from the URL search params so the
 * selection is deep-linkable and survives navigation between the console routes.
 *
 * The Recovery Operations Console replaced the monolith's React-state threading
 * (`selectedGroupId` / `activeStreamId`) with `?group=` / `?stream=`. This hook
 * reproduces the monolith's *derivation* of the active ids exactly:
 *
 *   activeGroupId  = ?group= ?? groupId(firstGroupFromContext)
 *   activeStreamId = ?stream= ?? selectWorkbenchStreamId(groupSummary, replication)
 *
 * The base selection comes from the URL; the fallbacks come from live data passed
 * in by the caller (group list + group summary + replication summary), mirroring
 * `selectWorkbenchStreamId` and the `selectedGroupId ?? groups[0]` logic in the
 * original page.tsx.
 */

const GROUP_PARAM = 'group';
const STREAM_PARAM = 'stream';

/** Minimal shape needed to resolve a group's canonical id (matches monolith). */
export interface DRGroupRef {
  id?: string;
  group_id?: string;
  groupId?: string;
}

/**
 * Member-stream shape used by `selectWorkbenchStreamId`. Mirrors the monolith's
 * `GroupSummaryLike.members[].stream` and replication-stream rows.
 */
interface DRStreamRef {
  stream_id?: string | null;
}

interface DRGroupSummaryContext {
  members?: Array<{ stream?: DRStreamRef | null }> | null;
  worst_live_rpo?: DRStreamRef | null;
}

interface DRReplicationContext {
  worst_live_rpo?: DRStreamRef | null;
  rpo_breaches?: DRStreamRef[] | null;
  streams?: DRStreamRef[] | null;
}

export interface UseDRSelectionContext {
  /** Group list (typically `posture.groups`) used to pick a default group. */
  groups?: DRGroupRef[] | null;
  /** Active group summary, used for the workbench-stream fallback. */
  groupSummary?: (DRGroupSummary & DRGroupSummaryContext) | DRGroupSummaryContext | null;
  /** Replication summary, used for the workbench-stream fallback. */
  replication?: (DRReplicationSummary & DRReplicationContext) | DRReplicationContext | null;
}

export interface UseDRSelectionResult {
  /** Raw `?group=` value (null when unset). */
  groupId: string | null;
  /** Raw `?stream=` value (null when unset). */
  streamId: string | null;
  /** `?group=` falling back to the first group in context. */
  activeGroupId: string | null;
  /** `?stream=` falling back to the derived workbench stream id. */
  activeStreamId: string | null;
  /** Write `?group=` (pass null/'' to clear). */
  setGroup: (groupID: string | null) => void;
  /** Write `?stream=` (pass null/'' to clear). */
  setStream: (streamID: string | null) => void;
}

/**
 * Resolve a group's canonical id, treating empty/`null`/`undefined` strings as
 * absent. Byte-identical to the monolith's `groupId()` helper.
 */
export function resolveDRGroupId(group: DRGroupRef): string | null {
  const id = (group.group_id ?? group.groupId ?? group.id ?? '').trim();
  if (!id || id === 'null' || id === 'undefined') {
    return null;
  }
  return id;
}

/**
 * Pick the stream id used by the recovery workbench. Reproduces the monolith's
 * `selectWorkbenchStreamId(group, replication)` exactly.
 */
export function selectWorkbenchStreamId(
  group?: DRGroupSummaryContext | null,
  replication?: DRReplicationContext | null,
): string | null {
  const memberStream = group?.members?.map((member) => member.stream?.stream_id).find(Boolean);
  if (memberStream) return memberStream;
  if (group?.worst_live_rpo?.stream_id) return group.worst_live_rpo.stream_id;
  return (
    replication?.worst_live_rpo?.stream_id ??
    replication?.rpo_breaches?.[0]?.stream_id ??
    replication?.streams?.[0]?.stream_id ??
    null
  );
}

export function useDRSelection(context: UseDRSelectionContext = {}): UseDRSelectionResult {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? '';

  const { groups, groupSummary, replication } = context;

  const groupId = searchParams?.get(GROUP_PARAM) || null;
  const streamId = searchParams?.get(STREAM_PARAM) || null;

  const activeGroupId = useMemo(() => {
    if (groupId) return groupId;
    for (const group of groups ?? []) {
      const resolved = resolveDRGroupId(group);
      if (resolved) return resolved;
    }
    return null;
  }, [groupId, groups]);

  const activeStreamId = useMemo(() => {
    if (streamId) return streamId;
    return selectWorkbenchStreamId(
      (groupSummary as DRGroupSummaryContext | null) ?? null,
      (replication as DRReplicationContext | null) ?? null,
    );
  }, [streamId, groupSummary, replication]);

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(search);
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, search],
  );

  const setGroup = useCallback(
    (nextGroupID: string | null) => updateParam(GROUP_PARAM, nextGroupID),
    [updateParam],
  );

  const setStream = useCallback(
    (nextStreamID: string | null) => updateParam(STREAM_PARAM, nextStreamID),
    [updateParam],
  );

  return { groupId, streamId, activeGroupId, activeStreamId, setGroup, setStream };
}
