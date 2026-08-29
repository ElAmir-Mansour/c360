'use client';

/**
 * Delay-event register (part of the case-timeline panel split).
 *
 * Owns its OWN react-query for the matter's delay events so this component can
 * carry filter / sort / pagination / search / selection state INSIDE itself
 * without touching the shell. The query key PREFIX is intentionally
 * `['lex-matter-delay-events', matterId]` so the shell's mutation
 * `invalidateQueries({ queryKey: ['lex-matter-delay-events', matterId] })` keeps
 * matching even though additional key segments (filters/sort/search) are
 * appended after `matterId`.
 *
 * Interaction features built in here:
 *   #6  Filter chips      — category (court/government/department/expert/all) +
 *                            status (all/open/resolved). `open` filters via the
 *                            backend `open` param; "resolved" has no backend
 *                            param so it is applied CLIENT-SIDE to the loaded
 *                            page(s) (documented limitation).
 *   #7  Sort control      — column (opened/resolved/category/created) + direction
 *                            via backend `sort` + `sort_dir`. Default opened desc.
 *   #8  Pagination        — `useInfiniteQuery` "Load more" accumulating pages,
 *                            with `Showing n of total`.
 *   #9  Search            — debounced `SearchInput` bound to backend `q`.
 *   #13 Edit & reopen     — per-row edit dialog (PATCH) + reopen confirm (POST).
 *   #14 Bulk resolve      — selection mode + "Resolve selected (n)".
 *   #18 Attribution       — resolves `created_by` UUID → display name via the
 *                            shared user directory (`enterpriseApi.users.list`).
 *
 * The edit / reopen / bulk-resolve mutations live HERE because this component
 * owns the query; on success they invalidate this list AND the shell's
 * `['lex-matter-timeline', matterId]` query so the overview refreshes too.
 */

import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, MoreVertical, Pencil, PlayCircle, Plus, RotateCcw, X } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { RelativeTime } from '@/components/shared/relative-time';
import { SearchInput } from '@/components/shared/forms/search-input';
import { SectionCard } from '@/components/suites/section-card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatDateTime, getAvatarColor, getInitials } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import { enterpriseApi } from '@/lib/enterprise/api';
import { userDisplayName } from '@/lib/enterprise/utils';
import { delayCategoryLabel, useSettlementLabels } from './labels';
import { delayCategoryMeta } from './delay-category-meta';
import { DelayDuration } from './delay-duration';
import { DelayEventEditDialog } from './delay-event-edit-dialog';
import {
  DELAY_CATEGORY_VALUES,
  settlementsApi,
  type DelayCategory,
  type EditDelayEventPayload,
  type LegalCaseDelayEvent,
} from '@/lib/lex/settlements';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'open' | 'resolved';
type SortColumn = 'opened_at' | 'resolved_at' | 'category' | 'created_at';
type SortDir = 'asc' | 'desc';

export interface DelayEventListProps {
  matterId: string;
  canWrite: boolean;
  /** Open the "record delay event" dialog (owned by the shell). */
  onRecordDelay: () => void;
  /** Request resolution of a single event; shell opens the confirm dialog + mutates. */
  onResolve: (event: LegalCaseDelayEvent) => void;
}

/**
 * Base react-query key for this matter's delay events. The shell invalidates by
 * this exact prefix; extend with extra segments (filters/sort/search) AFTER the
 * `matterId` so prefix invalidation continues to match.
 */
export function delayEventsQueryKey(matterId: string): [string, string] {
  return ['lex-matter-delay-events', matterId];
}

export function DelayEventList({ matterId, canWrite, onRecordDelay, onResolve }: DelayEventListProps) {
  const L = useSettlementLabels();
  const labels = L.timeline;
  const queryClient = useQueryClient();

  // --- list controls (#6 / #7 / #9) -------------------------------------
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<DelayCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('opened_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // --- selection (#14) ---------------------------------------------------
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // --- edit / reopen (#13) ----------------------------------------------
  const [editTarget, setEditTarget] = useState<LegalCaseDelayEvent | null>(null);
  const [reopenTarget, setReopenTarget] = useState<LegalCaseDelayEvent | null>(null);

  // `open` is the only backend status param; "resolved only" is client-side.
  const backendOpenOnly = statusFilter === 'open';

  const delayQuery = useInfiniteQuery({
    // Prefix preserved so the shell's prefix-invalidation matches; params appended.
    queryKey: [
      ...delayEventsQueryKey(matterId),
      { q: search, category: categoryFilter, status: statusFilter, sort: sortColumn, dir: sortDir },
    ],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      settlementsApi.listDelayEvents(
        matterId,
        { page: pageParam, per_page: PAGE_SIZE },
        {
          q: search.trim() || undefined,
          category: categoryFilter === 'all' ? undefined : categoryFilter,
          open: backendOpenOnly ? true : undefined,
          sort: sortColumn,
          sort_dir: sortDir,
        },
      ),
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.total_pages ? lastPage.meta.page + 1 : undefined,
    enabled: Boolean(matterId),
  });

  const pages = useMemo(() => delayQuery.data?.pages ?? [], [delayQuery.data]);
  const loadedEvents = useMemo(() => pages.flatMap((p) => p.data), [pages]);
  const total = pages[0]?.meta.total ?? 0;

  // #6 "resolved only" — applied client-side over the loaded page(s).
  const visibleEvents = useMemo(
    () => (statusFilter === 'resolved' ? loadedEvents.filter((e) => e.resolved) : loadedEvents),
    [loadedEvents, statusFilter],
  );

  // The number we *show* is the rendered count. For the client-side "resolved"
  // case the backend `total` counts unfiltered rows, so report the visible count
  // for both; otherwise the total comes from the paginated response meta.
  const shownCount = visibleEvents.length;
  const totalCount = statusFilter === 'resolved' ? visibleEvents.length : total;

  // --- attribution (#18): resolve created_by UUID → display name --------
  const usersQuery = useQuery({
    queryKey: ['lex-user-directory'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200 }),
    staleTime: 5 * 60 * 1000,
  });
  const userMap = useMemo(() => {
    const map = new Map<string, { name: string }>();
    for (const u of usersQuery.data?.data ?? []) {
      map.set(u.id, { name: userDisplayName(u) });
    }
    return map;
  }, [usersQuery.data]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: delayEventsQueryKey(matterId) }),
      queryClient.invalidateQueries({ queryKey: ['lex-matter-timeline', matterId] }),
    ]);
  };

  // --- mutations (#13 / #14) --------------------------------------------
  const editMutation = useMutation({
    mutationFn: ({ eventId, payload }: { eventId: string; payload: EditDelayEventPayload }) =>
      settlementsApi.editDelayEvent(matterId, eventId, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.delayRecorded);
      setEditTarget(null);
      await invalidate();
    },
    onError: showApiError,
  });

  const reopenMutation = useMutation({
    mutationFn: (eventId: string) => settlementsApi.reopenDelayEvent(matterId, eventId),
    onSuccess: async () => {
      showSuccess(labels.toast.delayResolved);
      setReopenTarget(null);
      await invalidate();
    },
    onError: showApiError,
  });

  const bulkResolveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(
        ids.map((id) =>
          settlementsApi.resolveDelayEvent(matterId, id, { also_clear_external_hold: false }),
        ),
      ),
    onSuccess: async () => {
      showSuccess(labels.toast.delayResolved);
      setBulkConfirmOpen(false);
      setSelectedIds(new Set());
      setSelectionMode(false);
      await invalidate();
    },
    onError: showApiError,
  });

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  const selectedCount = selectedIds.size;

  const sortColumnOptions: Array<{ value: SortColumn; label: string }> = [
    { value: 'opened_at', label: labels.sort.opened },
    { value: 'resolved_at', label: labels.sort.resolved },
    { value: 'category', label: labels.sort.category },
    { value: 'created_at', label: labels.sort.created },
  ];

  const renderAttribution = (event: LegalCaseDelayEvent) => {
    const entry = userMap.get(event.created_by);
    // Display name when resolvable, else a short id slice as a graceful fallback.
    const name = entry?.name ?? event.created_by.slice(0, 8);
    const [first, last] = (entry?.name ?? '').split(' ');
    const initials = entry ? getInitials(first ?? '', last ?? '') : event.created_by.slice(0, 2).toUpperCase();
    const colorClass = getAvatarColor(entry?.name ?? event.created_by);
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Avatar className="h-5 w-5 text-[10px]">
          <AvatarFallback className={cn(colorClass, 'text-white font-medium')}>
            {initials}
          </AvatarFallback>
        </Avatar>
        <span>
          {labels.attribution.recordedBy}: <span className="font-medium text-foreground">{name}</span>
        </span>
      </span>
    );
  };

  const renderControls = () => (
    <div className="space-y-3">
      <SearchInput
        value={search}
        onChange={(v) => setSearch(v)}
        placeholder={labels.search.placeholder}
        loading={delayQuery.isFetching && !delayQuery.isFetchingNextPage}
      />
      <div className="flex flex-wrap items-center gap-2">
        {/* #6 status filter */}
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-9 w-auto min-w-[8rem]">
            <SelectValue placeholder={labels.filter.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{labels.filter.all}</SelectItem>
            <SelectItem value="open">{labels.filter.open}</SelectItem>
            <SelectItem value="resolved">{labels.filter.resolved}</SelectItem>
          </SelectContent>
        </Select>

        {/* #6 category filter */}
        <Select
          value={categoryFilter}
          onValueChange={(v) => setCategoryFilter(v as DelayCategory | 'all')}
        >
          <SelectTrigger className="h-9 w-auto min-w-[9rem]">
            <SelectValue placeholder={labels.filter.allCategories} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{labels.filter.allCategories}</SelectItem>
            {DELAY_CATEGORY_VALUES.map((category) => (
              <SelectItem key={category} value={category}>
                {labels.filter.categoryOptions[category]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* #7 sort column */}
        <Select value={sortColumn} onValueChange={(v) => setSortColumn(v as SortColumn)}>
          <SelectTrigger className="h-9 w-auto min-w-[9rem]">
            <SelectValue placeholder={labels.sort.label} />
          </SelectTrigger>
          <SelectContent>
            {sortColumnOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* #7 sort direction */}
        <Select value={sortDir} onValueChange={(v) => setSortDir(v as SortDir)}>
          <SelectTrigger className="h-9 w-auto min-w-[8rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">{labels.sort.newestFirst}</SelectItem>
            <SelectItem value="asc">{labels.sort.oldestFirst}</SelectItem>
          </SelectContent>
        </Select>

        {/* #14 selection mode toggle */}
        {canWrite ? (
          selectionMode ? (
            <Button size="sm" variant="ghost" className="ms-auto" onClick={clearSelection}>
              <X className="me-1.5 h-3.5 w-3.5" />
              {labels.bulk.clearSelection}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="ms-auto"
              onClick={() => setSelectionMode(true)}
            >
              <ListChecks className="me-1.5 h-3.5 w-3.5" />
              {labels.bulk.select}
            </Button>
          )
        ) : null}
      </div>

      {/* #14 bulk action bar */}
      {selectionMode ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {labels.pagination.showing(selectedCount, shownCount)}
          </span>
          <Button
            size="sm"
            disabled={selectedCount === 0 || bulkResolveMutation.isPending}
            onClick={() => setBulkConfirmOpen(true)}
          >
            <PlayCircle className="me-1.5 h-3.5 w-3.5" />
            {labels.bulk.resolveSelected(selectedCount)}
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <SectionCard
      title={labels.delayEventsTitle}
      description={labels.delayEventsDescription}
      actions={
        canWrite ? (
          <Button size="sm" onClick={onRecordDelay}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {labels.recordDelay}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {renderControls()}

        {delayQuery.isLoading ? (
          <LoadingSkeleton variant="list-item" count={3} />
        ) : delayQuery.isError ? (
          <ErrorState message={labels.delayError} onRetry={() => void delayQuery.refetch()} />
        ) : visibleEvents.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={labels.delayEmptyTitle}
            description={labels.delayEmptyDescription}
          />
        ) : (
          <>
            <div className="space-y-3">
              {visibleEvents.map((event) => {
                const meta = delayCategoryMeta(event.category);
                const CategoryIcon = meta.icon;
                const isSelected = selectedIds.has(event.id);
                return (
                  <div
                    key={event.id}
                    className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5"
                  >
                    <span
                      className={`absolute inset-y-0 start-0 w-1 ${
                        event.resolved ? 'bg-success-300/70' : 'bg-warning-300/70'
                      }`}
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        {/* #14 per-row checkbox — only for OPEN rows in selection mode */}
                        {selectionMode && canWrite && !event.resolved ? (
                          <Checkbox
                            className="mt-1"
                            checked={isSelected}
                            onCheckedChange={() => toggleSelected(event.id)}
                            aria-label={labels.bulk.select}
                          />
                        ) : null}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={cn('gap-1.5', meta.badgeClassName)}>
                              <CategoryIcon className="h-3 w-3" aria-hidden />
                              {delayCategoryLabel(L, event.category)}
                            </Badge>
                            <Badge variant={event.resolved ? 'success' : 'warning'}>
                              {event.resolved ? labels.resolved : labels.open}
                            </Badge>
                            <DelayDuration openedAt={event.opened_at} resolvedAt={event.resolved_at} />
                          </div>
                          <p className="mt-1.5 text-sm">{event.reason || '—'}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {renderAttribution(event)}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {labels.openedAt}: {formatDateTime(event.opened_at)}
                            {event.resolved_at
                              ? ` • ${labels.resolvedAt}: ${formatDateTime(event.resolved_at)}`
                              : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!event.resolved ? (
                          <>
                            <RelativeTime date={event.opened_at} />
                            {canWrite && !selectionMode ? (
                              <Button size="sm" variant="outline" onClick={() => onResolve(event)}>
                                <PlayCircle className="me-1.5 h-3.5 w-3.5" />
                                {labels.resolve}
                              </Button>
                            ) : null}
                          </>
                        ) : (
                          <RelativeTime date={event.resolved_at ?? event.updated_at} />
                        )}
                        {/* #13 row actions: edit (always) + reopen (resolved) */}
                        {canWrite && !selectionMode ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                                <span className="sr-only">{labels.editEvent.edit}</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setEditTarget(event)}>
                                <Pencil className="me-2 h-3.5 w-3.5" />
                                {labels.editEvent.edit}
                              </DropdownMenuItem>
                              {event.resolved ? (
                                <DropdownMenuItem onClick={() => setReopenTarget(event)}>
                                  <RotateCcw className="me-2 h-3.5 w-3.5" />
                                  {labels.editEvent.reopen}
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* #8 pagination */}
            <div className="flex flex-col items-center gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                {labels.pagination.showing(shownCount, totalCount)}
              </p>
              {delayQuery.hasNextPage ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={delayQuery.isFetchingNextPage}
                  onClick={() => void delayQuery.fetchNextPage()}
                >
                  {labels.pagination.loadMore}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* #13 edit dialog */}
      {canWrite ? (
        <DelayEventEditDialog
          open={editTarget !== null}
          loading={editMutation.isPending}
          event={editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          onSubmit={(payload) => {
            if (editTarget) {
              editMutation.mutate({ eventId: editTarget.id, payload });
            }
          }}
        />
      ) : null}

      {/* #13 reopen confirm */}
      {canWrite ? (
        <ConfirmDialog
          open={reopenTarget !== null}
          onOpenChange={(open) => {
            if (!open) setReopenTarget(null);
          }}
          title={labels.editEvent.reopenTitle}
          description={labels.editEvent.reopenDescription(reopenTarget?.reason ?? '')}
          confirmLabel={labels.editEvent.reopenConfirm}
          loading={reopenMutation.isPending}
          onConfirm={() => {
            if (reopenTarget) {
              reopenMutation.mutate(reopenTarget.id);
            }
          }}
        />
      ) : null}

      {/* #14 bulk-resolve confirm */}
      {canWrite ? (
        <ConfirmDialog
          open={bulkConfirmOpen}
          onOpenChange={setBulkConfirmOpen}
          title={labels.resolveDialog.title}
          description={labels.bulk.resolveSelected(selectedCount)}
          confirmLabel={labels.resolveDialog.confirm}
          loading={bulkResolveMutation.isPending}
          onConfirm={() => {
            if (selectedCount > 0) {
              bulkResolveMutation.mutate(Array.from(selectedIds));
            }
          }}
        />
      ) : null}
    </SectionCard>
  );
}
