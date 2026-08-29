'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { enterpriseApi } from '@/lib/enterprise/api';
import { userDisplayName } from '@/lib/enterprise/utils';
import type { UserDirectoryEntry } from '@/types/suites';
import { managerTasksApi, type ManagerTask } from '@/lib/lex/manager-tasks';

import {
  canSeeManagerTasks,
  hasManagerTaskOversight,
  managerTaskAssigneeRoles,
} from '../../tasks/_lib/task-policy';
import type {
  ManagerTaskRow,
  ManagerTasksPanelProps,
} from '../../_components/role-dashboard/widgets/manager-tasks-panel';

const SOFT = { staleTime: 60_000, retry: false as const };
/** Rows shown in the dashboard band. The full board lives at /lex/tasks. */
const PANEL_ROWS = 6;
/**
 * One page wide enough to summarise the caller's board without paginating.
 * `summary` is computed from this page, so a caller with more than this many
 * tasks would under-report — `truncated` says so rather than hiding it.
 */
const SUMMARY_PAGE = 100;

export interface ManagerTasksPanelModel {
  /** False when the role has no task board at all — caller omits the band. */
  isVisible: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  props: ManagerTasksPanelProps | null;
  /** True when the caller's board exceeds `SUMMARY_PAGE` and totals are partial. */
  truncated: boolean;
}

/**
 * Task Management dashboard band, shared by the Legal Director's bespoke
 * container and the registry-driven manager dashboards so both render the same
 * numbers from the same request.
 *
 * Scope is decided SERVER-side: `managerTaskOversight` gives the director and
 * admins the whole tenant's board and filters everyone else to
 * `assignee_id = caller OR created_by = caller`. `hasManagerTaskOversight` here
 * only picks the caption, never the data.
 */
export function useManagerTasksPanel(
  roleSlug: string | null | undefined,
): ManagerTasksPanelModel {
  const isVisible = canSeeManagerTasks(roleSlug);
  const oversight = hasManagerTaskOversight(roleSlug);

  const tasks = useQuery({
    queryKey: ['role-dash', 'manager-tasks', roleSlug ?? 'unscoped'],
    queryFn: () => managerTasksApi.list({ page: 1, per_page: SUMMARY_PAGE }),
    enabled: isVisible,
    ...SOFT,
  });

  // Assignee identities live in platform_core, tasks in lex_db, and a task row
  // carries only `assignee_id`. Resolve the pool this role can assign to; an
  // unresolved id falls back to a neutral label rather than leaking a raw UUID.
  const directory = useQuery({
    queryKey: ['role-dash', 'manager-task-assignees', roleSlug ?? 'unscoped'],
    queryFn: () => loadAssigneeDirectory(roleSlug),
    enabled: isVisible,
    ...SOFT,
  });

  return useMemo<ManagerTasksPanelModel>(() => {
    const refetch = () => {
      void tasks.refetch();
      void directory.refetch();
    };
    if (!isVisible) {
      return { isVisible: false, isLoading: false, isError: false, refetch, props: null, truncated: false };
    }

    // The directory is decoration: a failure there must not blank the board, so
    // only the task request drives the error state.
    if (tasks.isError) {
      return { isVisible: true, isLoading: false, isError: true, refetch, props: null, truncated: false };
    }
    if (tasks.isLoading) {
      return { isVisible: true, isLoading: true, isError: false, refetch, props: null, truncated: false };
    }

    const items = tasks.data?.data ?? [];
    const total = tasks.data?.meta.total ?? items.length;
    const names = new Map(
      (directory.data ?? []).map((entry) => [entry.id, userDisplayName(entry)]),
    );

    const rows: ManagerTaskRow[] = orderForPanel(items)
      .slice(0, PANEL_ROWS)
      .map((task) => ({
        id: task.id,
        title: task.title,
        assigneeName: names.get(task.assignee_id) ?? '—',
        status: task.status,
        updatedAt: task.updated_at,
      }));

    return {
      isVisible: true,
      isLoading: false,
      isError: false,
      refetch,
      truncated: total > items.length,
      props: {
        rows,
        summary: {
          awaitingReview: items.filter((task) => task.status === 'submitted').length,
          inProgress: items.filter((task) => task.status === 'in_progress').length,
          total,
        },
        hasOversight: oversight,
      },
    };
  }, [
    isVisible,
    oversight,
    tasks.data,
    tasks.isError,
    tasks.isLoading,
    tasks.refetch,
    directory.data,
    directory.refetch,
  ]);
}

/**
 * Panel ordering: what needs a human first, then most recently touched. The
 * /lex/tasks page keeps its own ordering — this is a six-row summary, not a
 * second copy of the board.
 */
const STATUS_RANK: Record<ManagerTask['status'], number> = {
  submitted: 0,
  correction_required: 1,
  in_progress: 2,
  assigned: 3,
  accepted: 4,
  cancelled: 5,
};

function orderForPanel(items: ManagerTask[]): ManagerTask[] {
  return [...items].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

async function loadAssigneeDirectory(
  roleSlug: string | null | undefined,
): Promise<UserDirectoryEntry[]> {
  const roles = managerTaskAssigneeRoles(roleSlug);
  const byID = new Map<string, UserDirectoryEntry>();

  if (roles.length > 0) {
    const groups = await Promise.allSettled(
      roles.map((candidate) => enterpriseApi.users.listByRole(candidate)),
    );
    for (const group of groups) {
      if (group.status !== 'fulfilled') continue;
      for (const entry of group.value) byID.set(entry.id, entry);
    }
  }
  if (byID.size > 0) return [...byID.values()];

  // Assignee-only roles (officer, advisor) resolve no pool of their own, and
  // some deployments do not seed the reference role slugs. Fall back to the
  // directory so a task never renders with an unresolved assignee.
  const response = await enterpriseApi.users.list({
    page: 1,
    per_page: 200,
    sort: 'first_name',
    order: 'asc',
  });
  return response.data;
}
