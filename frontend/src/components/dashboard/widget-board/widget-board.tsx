'use client';

import * as React from 'react';
import { Responsive, type ItemCallback, type Layout, type Layouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './widget-board.css';
import { Check, LayoutGrid, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SectionGrid } from '@/components/layout/section-grid';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { BOARD_TEXT, pickText } from './board-i18n';
import { DEFAULT_ROWS, WIDGET_REGISTRY, getWidgetDefinition, type WidgetDefinition } from './registry';
import {
  BOARD_BREAKPOINTS,
  BOARD_COLS,
  BOARD_GAP_PX,
  BOARD_ROW_HEIGHT_PX,
  COLLAPSED_PLACEHOLDER_PX,
  createEmptyBoard,
  applyBoardPreset,
  isCustomized,
  mirrorLayout,
  pxToRows,
  readUserBoard,
  sanitizeUserBoard,
  sanitizeLayout,
  stackLayout,
  writeUserBoard,
  type BoardBreakpoint,
  type DashboardAlertThreshold,
  type DashboardHorizon,
  type DashboardPreset,
  type DashboardScope,
  type PersistedItem,
  type PersistedUserBoard,
} from './layout-utils';
import { WidgetFrame } from './widget-frame';
import { WidgetPickerSheet } from './widget-picker-sheet';
import { DashboardPreferencesProvider } from './dashboard-preferences-context';
import {
  loadDashboardPreference,
  resetDashboardPreference,
  saveDashboardPreference,
  saveTenantDashboardDefault,
} from './dashboard-preferences-api';

type ResizeHandle = NonNullable<Layout['resizeHandles']>[number];

/** Width resize from either edge; height from the bottom edge/corners. */
const RESIZE_HANDLES: ResizeHandle[] = ['e', 'w', 's', 'se', 'sw'];

/**
 * Token-driven staggered reveal wrapper (moved here from dashboard/page.tsx so
 * the static composition keeps the exact same top-to-bottom cascade). The
 * incremental delay derives from `--ds-duration-fast` — no magic milliseconds —
 * and `animate-fade-up` is disabled globally under prefers-reduced-motion.
 */
function Reveal({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div
      className="animate-fade-up"
      style={
        {
          animationDelay: `calc(${index} * (var(--ds-duration-fast) / 2))`,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

/**
 * The exact pre-board dashboard composition (stacked sections, alerts + tasks
 * side by side). Rendered for the server pass, before hydration, and for every
 * user who has never customized their board — guaranteeing zero visual or
 * behavioral regression on the default path. Frames still measure themselves
 * so switching into the grid is pixel-continuous.
 */
function StaticComposition({
  defs,
  onHeightChange,
}: {
  defs: readonly WidgetDefinition[];
  onHeightChange: (id: string, px: number) => void;
}) {
  let order = 0;
  return (
    <div className="space-y-6">
      {DEFAULT_ROWS.map((row) => {
        const rowDefs = row
          .map((id) => defs.find((def) => def.id === id))
          .filter((def): def is WidgetDefinition => Boolean(def));
        if (rowDefs.length === 0) return null;
        const index = order++;

        if (rowDefs.length === 1) {
          const def = rowDefs[0];
          return (
            <Reveal key={def.id} index={index}>
              <WidgetFrame def={def} mode="static" onHeightChange={onHeightChange} />
            </Reveal>
          );
        }

        return (
          <Reveal key={row.join('+')} index={index}>
            <SectionGrid cols={2}>
              {rowDefs.map((def) => (
                <WidgetFrame
                  key={def.id}
                  def={def}
                  mode="static"
                  fill
                  onHeightChange={onHeightChange}
                />
              ))}
            </SectionGrid>
          </Reveal>
        );
      })}
    </div>
  );
}

/**
 * WidgetBoard — the customizable dashboard.
 *
 * - Widget registry wraps the existing dashboard widgets (see ./registry).
 * - react-grid-layout renders the responsive grid; the container width is
 *   measured locally (SSR-safe: the grid only mounts client-side with a real
 *   width, the server renders the static composition).
 * - Edit mode: drag by handle, resize from edges, add/remove via the picker
 *   sheet, reset to default. Layouts persist per user under the single
 *   locally for immediate startup and to the tenant-scoped preferences API.
 * - Auto-height: rows track each widget's measured content height, so the
 *   default grid layout reproduces the original `space-y-6` composition and
 *   live content changes (loading tables, self-hiding banners) never clip.
 */
export function WidgetBoard() {
  const { user, tenant, hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const isRtl = direction === 'rtl';
  const userKey = user?.id ?? 'anonymous';

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [hydrated, setHydrated] = React.useState(false);
  const [width, setWidth] = React.useState(0);
  const [editMode, setEditMode] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [board, setBoard] = React.useState<PersistedUserBoard>(createEmptyBoard);
  const [heights, setHeights] = React.useState<Record<string, number>>({});
  const [syncState, setSyncState] = React.useState<'idle' | 'saving' | 'saved' | 'local'>('idle');
  const [teamDefaultSaving, setTeamDefaultSaving] = React.useState(false);
  const [boardAnnouncement, setBoardAnnouncement] = React.useState('');
  const boardRef = React.useRef(board);
  const saveTimerRef = React.useRef<number | null>(null);
  const dirtyRef = React.useRef(false);

  // Hydrate the persisted board + measure the container. Reading localStorage
  // only after mount keeps the server and first client render identical (both
  // show the default static composition), avoiding hydration mismatches.
  React.useEffect(() => {
    const el = containerRef.current;
    if (el) setWidth(el.offsetWidth);
    dirtyRef.current = false;
    const localBoard = readUserBoard(userKey);
    const teamBoard = sanitizeUserBoard(tenant?.settings?.dashboard_defaults);
    const initialBoard = localBoard ?? teamBoard ?? createEmptyBoard();
    boardRef.current = initialBoard;
    setBoard(initialBoard);
    setHydrated(true);

    let cancelled = false;
    void loadDashboardPreference()
      .then(({ board: remoteBoard }) => {
        if (cancelled || dirtyRef.current) return;
        if (remoteBoard) {
          boardRef.current = remoteBoard;
          setBoard(remoteBoard);
          writeUserBoard(userKey, remoteBoard);
        }
        setSyncState('saved');
      })
      .catch(() => {
        if (!cancelled) setSyncState('local');
      });

    const observer =
      el && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => setWidth(el.offsetWidth))
        : null;
    observer?.observe(el as Element);
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [tenant?.settings?.dashboard_defaults, userKey]);

  React.useEffect(
    () => () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  /** Local cache is immediate; the tenant-scoped server copy is debounced. */
  const persistBoard = React.useCallback(
    (next: PersistedUserBoard) => {
      boardRef.current = next;
      dirtyRef.current = true;
      setBoard(next);
      writeUserBoard(userKey, next);
      setSyncState('saving');
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        void saveDashboardPreference(next)
          .then(() => setSyncState('saved'))
          .catch(() => setSyncState('local'));
      }, 450);
    },
    [userKey],
  );

  const handleHeightChange = React.useCallback((id: string, px: number) => {
    setHeights((prev) => {
      const rounded = Math.round(px);
      const current = prev[id];
      // Ignore sub-2px jitter so measurement can never oscillate with layout.
      if (current !== undefined && Math.abs(current - rounded) < 2) return prev;
      return { ...prev, [id]: rounded };
    });
  }, []);

  // Permission gating: widgets the user cannot see exist neither on the board
  // nor in the picker — identical to the old page-level `hasCyber` gating.
  const permissionDefs = React.useMemo(
    () => WIDGET_REGISTRY.filter((def) => !def.permission || hasPermission(def.permission)),
    [hasPermission],
  );
  const visibleDefs = React.useMemo(
    () =>
      permissionDefs.filter(
        (def) => board.scope === 'all' || def.suite === 'all' || def.suite === board.scope,
      ),
    [board.scope, permissionDefs],
  );
  const enabledDefs = React.useMemo(
    () => visibleDefs.filter((def) => !board.hidden.includes(def.id)),
    [visibleDefs, board.hidden],
  );

  const activeBp: BoardBreakpoint =
    width >= BOARD_BREAKPOINTS.lg
      ? 'lg'
      : width >= BOARD_BREAKPOINTS.md
        ? 'md'
        : 'xs';
  const customized = isCustomized(board);
  // Default path renders the original static composition — no regression for
  // users who never customize. The grid takes over for edit mode + custom
  // layouts, once the container width is known.
  const showGrid = hydrated && width > 0 && (editMode || customized);

  const layouts = React.useMemo<Layouts>(() => {
    const enabledIds = enabledDefs.map((def) => def.id);
    const lgBase = sanitizeLayout(board.layouts.lg, 'lg', enabledIds);
    const mdBase = sanitizeLayout(board.layouts.md, 'md', enabledIds);
    const xsBase = board.layouts.xs
      ? sanitizeLayout(board.layouts.xs, 'xs', enabledIds)
      : stackLayout(mdBase, 'xs');

    const result: Layouts = {};
    (['lg', 'md', 'xs'] as const).forEach((bp) => {
      const base = bp === 'lg' ? lgBase : bp === 'md' ? mdBase : xsBase;
      const cols = BOARD_COLS[bp];
      const items = base.map<Layout>((item) => {
        const def = getWidgetDefinition(item.i);
        const minRows = def ? pxToRows(def.minHeightPx) : 1;
        const minW = def ? Math.min(def.minW, cols) : 1;
        // Guard stale/hand-edited storage: keep w >= minW and x in bounds.
        const w = Math.max(item.w, minW);
        const x = Math.max(0, Math.min(item.x, cols - w));
        const sizedByUser = def ? board.sized.includes(item.i) : false;
        const measured = heights[item.i];

        let h = item.h;
        if (def && sizedByUser) {
          // The user chose this height; respect it (content scrolls inside).
          h = Math.max(item.h, minRows);
        } else if (def) {
          // Auto-height: track measured content; collapse fully-empty widgets
          // in view mode (matching how the old page showed nothing), but keep
          // an editable placeholder while customizing.
          if (measured === undefined) h = pxToRows(def.estimatedHeightPx);
          else if (measured < 2) h = editMode ? pxToRows(COLLAPSED_PLACEHOLDER_PX) : 0;
          else h = pxToRows(measured);
        }

        return {
          i: item.i,
          x,
          y: item.y,
          w,
          h,
          minW,
          // Collapsed (h=0) items must carry minH=0 — GridItem warns when
          // minH exceeds h. Resizing is disabled in view mode, so the 0
          // lower bound is never user-reachable.
          minH: h === 0 ? 0 : Math.max(1, Math.min(h, minRows)),
        };
      });
      result[bp] = isRtl ? mirrorLayout(items, cols) : items;
    });
    return result;
  }, [enabledDefs, board.layouts, board.sized, editMode, heights, isRtl]);

  // Keep DOM/focus order aligned with the current visual order after users
  // move widgets. This also makes screen-reader reading order predictable.
  const renderDefs = React.useMemo(() => {
    const positions = new Map(
      ((layouts[activeBp] ?? []) as Layout[]).map(
        (item): [string, number] => [item.i, item.y * BOARD_COLS[activeBp] + item.x],
      ),
    );
    return [...enabledDefs].sort(
      (a, b) =>
        (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [activeBp, enabledDefs, layouts]);

  /** Persist the committed grid layout (after drag/resize) in logical coords. */
  const commitLayout = React.useCallback(
    (current: Layout[], sizedId?: string) => {
      const prev = boardRef.current;
      const cols = BOARD_COLS[activeBp];
      const items: PersistedItem[] = current.map((item) => ({
        i: item.i,
        x: isRtl ? Math.max(0, cols - item.x - item.w) : item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      }));
      const sized =
        sizedId && !prev.sized.includes(sizedId) ? [...prev.sized, sizedId] : prev.sized;
      persistBoard({
        ...prev,
        sized,
        layouts: { ...prev.layouts, [activeBp]: items },
      });
    },
    [activeBp, isRtl, persistBoard],
  );

  const handleDragStop: ItemCallback = (layout) => commitLayout(layout);
  const handleResizeStop: ItemCallback = (layout, oldItem, newItem) =>
    // A height change turns auto-height off for that widget; width-only
    // resizes keep content-driven heights.
    commitLayout(layout, oldItem && newItem && newItem.h !== oldItem.h ? newItem.i : undefined);

  const toggleWidget = React.useCallback(
    (id: string, enabled: boolean) => {
      const prev = boardRef.current;
      const hidden = enabled
        ? prev.hidden.filter((hiddenId) => hiddenId !== id)
        : Array.from(new Set([...prev.hidden, id]));
      persistBoard({ ...prev, hidden });
    },
    [persistBoard],
  );

  const resetBoard = React.useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    const teamDefault = sanitizeUserBoard(tenant?.settings?.dashboard_defaults);
    const next = teamDefault ?? createEmptyBoard();
    writeUserBoard(userKey, null);
    boardRef.current = next;
    dirtyRef.current = true;
    setBoard(next);
    setSyncState('saving');
    void resetDashboardPreference()
      .then(() => setSyncState('saved'))
      .catch(() => setSyncState('local'));
  }, [tenant?.settings?.dashboard_defaults, userKey]);

  const removeWidget = React.useCallback(
    (id: string) => toggleWidget(id, false),
    [toggleWidget],
  );

  const updatePreference = React.useCallback(
    (
      key: 'scope' | 'horizonDays' | 'alertThreshold',
      value: DashboardScope | DashboardHorizon | DashboardAlertThreshold,
    ) => persistBoard({ ...boardRef.current, [key]: value } as PersistedUserBoard),
    [persistBoard],
  );

  const changePreset = React.useCallback(
    (preset: DashboardPreset) => persistBoard(applyBoardPreset(boardRef.current, preset)),
    [persistBoard],
  );

  const moveWidget = React.useCallback(
    (id: string, direction: -1 | 1) => {
      const prev = boardRef.current;
      const enabledIds = visibleDefs
        .filter((def) => !prev.hidden.includes(def.id))
        .map((def) => def.id);
      const items = sanitizeLayout(prev.layouts[activeBp], activeBp, enabledIds);
      const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
      const index = sorted.findIndex((item) => item.i === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) return;
      const current = sorted[index];
      const target = sorted[targetIndex];
      const currentPosition = { x: current.x, y: current.y, w: current.w };
      current.x = target.x;
      current.y = target.y;
      current.w = target.w;
      target.x = currentPosition.x;
      target.y = currentPosition.y;
      target.w = currentPosition.w;
      persistBoard({
        ...prev,
        layouts: { ...prev.layouts, [activeBp]: items },
      });
      setBoardAnnouncement(pickText(BOARD_TEXT.widgetMoved, locale));
    },
    [activeBp, locale, persistBoard, visibleDefs],
  );

  const resizeWidget = React.useCallback(
    (id: string, direction: -1 | 1) => {
      const prev = boardRef.current;
      const enabledIds = visibleDefs
        .filter((def) => !prev.hidden.includes(def.id))
        .map((def) => def.id);
      const items = sanitizeLayout(prev.layouts[activeBp], activeBp, enabledIds);
      const item = items.find((candidate) => candidate.i === id);
      const def = getWidgetDefinition(id);
      if (!item || !def) return;
      const cols = BOARD_COLS[activeBp];
      const nextWidth = Math.max(Math.min(def.minW, cols), Math.min(cols, item.w + direction));
      if (nextWidth === item.w) return;
      item.w = nextWidth;
      item.x = Math.min(item.x, cols - nextWidth);
      persistBoard({
        ...prev,
        layouts: { ...prev.layouts, [activeBp]: items },
      });
      setBoardAnnouncement(pickText(BOARD_TEXT.widgetResized, locale));
    },
    [activeBp, locale, persistBoard, visibleDefs],
  );

  const handleSaveTeamDefault = React.useCallback(async () => {
    if (!tenant) return;
    setTeamDefaultSaving(true);
    try {
      await saveTenantDashboardDefault(tenant.id, tenant.settings, boardRef.current);
      toast.success(pickText(BOARD_TEXT.teamDefaultSaved, locale));
    } catch {
      toast.error(pickText(BOARD_TEXT.syncLocal, locale));
    } finally {
      setTeamDefaultSaving(false);
    }
  }, [locale, tenant]);

  const openCustomizer = React.useCallback(() => setEditMode(true), []);

  return (
    <DashboardPreferencesProvider
      value={{
        scope: board.scope,
        horizonDays: board.horizonDays,
        alertThreshold: board.alertThreshold,
        openCustomizer,
      }}
    >
      <div
        ref={containerRef}
        className="widget-board space-y-4"
        data-editing={editMode || undefined}
      >
      {/* Screen-reader announcement when customize mode toggles. */}
      <p className="sr-only" aria-live="polite">
        {hydrated
          ? pickText(editMode ? BOARD_TEXT.editModeOn : BOARD_TEXT.editModeOff, locale)
          : ''}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {boardAnnouncement}
      </p>

      {editMode ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="me-auto min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {pickText(BOARD_TEXT.editMode, locale)}
            </p>
            <p className="text-xs text-muted-foreground">
              {pickText(BOARD_TEXT.editHint, locale)}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            {pickText(BOARD_TEXT.addWidget, locale)}
          </Button>
          <Button variant="outline" size="sm" onClick={resetBoard}>
            <RotateCcw className="me-1.5 h-4 w-4" aria-hidden="true" />
            {pickText(BOARD_TEXT.resetDefault, locale)}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditMode(false);
              setPickerOpen(false);
            }}
          >
            <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
            {pickText(BOARD_TEXT.done, locale)}
          </Button>
        </div>
      ) : !enabledDefs.some((def) => def.id === 'welcome-hero') ? (
        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={openCustomizer}
          >
            <SlidersHorizontal className="me-1.5 h-4 w-4" aria-hidden="true" />
            {pickText(BOARD_TEXT.customize, locale)}
          </Button>
        </div>
      ) : null}

      {showGrid ? (
        enabledDefs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
            <LayoutGrid className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {pickText(BOARD_TEXT.emptyBoard, locale)}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditMode(true);
                setPickerOpen(true);
              }}
            >
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pickText(BOARD_TEXT.addWidget, locale)}
            </Button>
          </div>
        ) : (
          <Responsive
            className={cn('wb-grid', editMode && 'select-none')}
            width={width}
            breakpoints={BOARD_BREAKPOINTS}
            cols={BOARD_COLS}
            layouts={layouts}
            rowHeight={BOARD_ROW_HEIGHT_PX}
            margin={[BOARD_GAP_PX, 0]}
            containerPadding={[0, 0]}
            compactType="vertical"
            isDraggable={editMode}
            isResizable={editMode}
            resizeHandles={RESIZE_HANDLES}
            draggableHandle=".wb-drag-handle"
            onDragStop={handleDragStop}
            onResizeStop={handleResizeStop}
            useCSSTransforms
          >
            {renderDefs.map((def, index) => (
              <div key={def.id} className="wb-cell">
                <WidgetFrame
                  def={def}
                  mode="grid"
                  editMode={editMode}
                  manualHeight={board.sized.includes(def.id)}
                  revealIndex={index}
                  onHeightChange={handleHeightChange}
                  onRemove={editMode ? removeWidget : undefined}
                  onMove={editMode ? moveWidget : undefined}
                  onResize={editMode ? resizeWidget : undefined}
                />
              </div>
            ))}
          </Responsive>
        )
      ) : (
        <StaticComposition defs={visibleDefs} onHeightChange={handleHeightChange} />
      )}

      <WidgetPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        defs={permissionDefs}
        hiddenIds={board.hidden}
        onToggle={toggleWidget}
        onReset={resetBoard}
        preset={board.preset}
        scope={board.scope}
        horizonDays={board.horizonDays}
        alertThreshold={board.alertThreshold}
        onPresetChange={changePreset}
        onScopeChange={(value) => updatePreference('scope', value)}
        onHorizonChange={(value) => updatePreference('horizonDays', value)}
        onAlertThresholdChange={(value) => updatePreference('alertThreshold', value)}
        syncState={syncState}
        canSaveTeamDefault={Boolean(tenant && hasPermission('tenant:write'))}
        onSaveTeamDefault={handleSaveTeamDefault}
        teamDefaultSaving={teamDefaultSaving}
      />
      </div>
    </DashboardPreferencesProvider>
  );
}
