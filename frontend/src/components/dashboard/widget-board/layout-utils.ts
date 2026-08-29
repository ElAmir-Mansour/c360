import type { Layout } from 'react-grid-layout';
import { DEFAULT_ROWS, getWidgetDefinition } from './registry';

/**
 * Grid math + persistence for the dashboard widget board.
 *
 * Coordinate model:
 * - Layouts are STORED in logical (LTR) coordinates. When the app renders RTL
 *   (Arabic default) the board mirrors `x` at the react-grid-layout boundary
 *   (`mirrorLayout`, an involution) so the same saved layout reads correctly
 *   in both directions.
 * - `rowHeight` is 2px with zero vertical margin; each widget's row span is
 *   derived from its measured content height plus a 24px gutter baked into the
 *   span (`pxToRows`). That reproduces the page's `space-y-6` stacking to
 *   within a pixel, which is how the default board layout visually matches the
 *   original, non-customizable dashboard.
 */

export type BoardBreakpoint = 'lg' | 'md' | 'xs';
export type DashboardPreset =
  | 'recommended'
  | 'my-work'
  | 'operations'
  | 'executive-risk'
  | 'admin';
export type DashboardScope = 'all' | 'watheeq' | 'cyber' | 'data';
export type DashboardHorizon = 7 | 30 | 90;
export type DashboardAlertThreshold = 'critical' | 'high' | 'medium';

/** Single localStorage key (spec'd); per-user boards nest under `users`. */
export const BOARD_STORAGE_KEY = 'dashboard:layout:v2';
const LEGACY_BOARD_STORAGE_KEY = 'dashboard:layout:v1';

/** Container-width breakpoints (px). ~896px is where the 2-col row splits. */
export const BOARD_BREAKPOINTS: Record<BoardBreakpoint, number> = { lg: 1080, md: 700, xs: 0 };
export const BOARD_COLS: Record<BoardBreakpoint, number> = { lg: 12, md: 8, xs: 4 };
export const BOARD_BREAKPOINT_IDS: readonly BoardBreakpoint[] = ['lg', 'md', 'xs'];

/** 1 grid row == 2px, so measured pixel heights map near-exactly to rows. */
export const BOARD_ROW_HEIGHT_PX = 2;
/** Vertical gutter between widgets — matches the page's `space-y-6` (24px). */
export const BOARD_GAP_PX = 24;
/** Height given to self-hidden (empty) widgets while edit mode shows them. */
export const COLLAPSED_PLACEHOLDER_PX = 76;

/** Convert a measured pixel height into a row span (gutter included). */
export function pxToRows(px: number): number {
  return Math.max(1, Math.ceil((px + BOARD_GAP_PX) / BOARD_ROW_HEIGHT_PX));
}

export interface PersistedItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PersistedUserBoard {
  /** Widget ids the user removed from the board. */
  hidden: string[];
  /** Widget ids whose HEIGHT the user resized manually (auto-height off). */
  sized: string[];
  /** Saved positions per breakpoint, in logical (LTR) coordinates. */
  layouts: Partial<Record<BoardBreakpoint, PersistedItem[]>>;
  /** Role-oriented starting point. Individual widget toggles can refine it. */
  preset: DashboardPreset;
  /** Focus the board on one suite while retaining cross-suite work widgets. */
  scope: DashboardScope;
  /** Time window used by activity, task, and trend widgets. */
  horizonDays: DashboardHorizon;
  /** Lowest alert severity promoted into action surfaces. */
  alertThreshold: DashboardAlertThreshold;
}

interface PersistedBoardFile {
  version: 2;
  users: Record<string, PersistedUserBoard>;
}

export function createEmptyBoard(): PersistedUserBoard {
  return {
    hidden: [],
    sized: [],
    layouts: {},
    preset: 'recommended',
    scope: 'all',
    horizonDays: 30,
    alertThreshold: 'high',
  };
}

/** Presets are intentional starting points, never immutable templates. */
export const PRESET_HIDDEN_WIDGETS: Record<DashboardPreset, readonly string[]> = {
  recommended: [],
  'my-work': ['suites-launcher', 'onboarding-checklist', 'metrics-strip'],
  operations: ['welcome-hero', 'onboarding-checklist', 'activity-timeline'],
  'executive-risk': ['onboarding-checklist', 'recent-alerts', 'my-tasks'],
  admin: ['critical-alerts', 'recent-alerts', 'my-tasks'],
};

export function applyBoardPreset(
  board: PersistedUserBoard,
  preset: DashboardPreset,
): PersistedUserBoard {
  return {
    ...board,
    preset,
    hidden: [...PRESET_HIDDEN_WIDGETS[preset]],
    sized: [],
    layouts: {},
  };
}

export function isCustomized(board: PersistedUserBoard): boolean {
  return (
    board.hidden.length > 0 ||
    board.sized.length > 0 ||
    Object.keys(board.layouts).length > 0 ||
    board.preset !== 'recommended' ||
    board.scope !== 'all' ||
    board.horizonDays !== 30 ||
    board.alertThreshold !== 'high'
  );
}

function readFile(): PersistedBoardFile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      window.localStorage.getItem(BOARD_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_BOARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      ![1, 2].includes(Number((parsed as PersistedBoardFile).version)) ||
      typeof (parsed as PersistedBoardFile).users !== 'object'
    ) {
      return null;
    }
    return parsed as PersistedBoardFile;
  } catch {
    return null;
  }
}

function isPreset(value: unknown): value is DashboardPreset {
  return ['recommended', 'my-work', 'operations', 'executive-risk', 'admin'].includes(
    String(value),
  );
}

function isScope(value: unknown): value is DashboardScope {
  return ['all', 'watheeq', 'cyber', 'data'].includes(String(value));
}

function isHorizon(value: unknown): value is DashboardHorizon {
  return value === 7 || value === 30 || value === 90;
}

function isAlertThreshold(value: unknown): value is DashboardAlertThreshold {
  return ['critical', 'high', 'medium'].includes(String(value));
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function sanitizePersistedItems(value: unknown): PersistedItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is PersistedItem =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as PersistedItem).i === 'string' &&
      Number.isFinite((item as PersistedItem).x) &&
      Number.isFinite((item as PersistedItem).y) &&
      Number.isFinite((item as PersistedItem).w) &&
      Number.isFinite((item as PersistedItem).h),
  );
  return items.length > 0 ? items : undefined;
}

/** Read (and defensively validate) one user's saved board. */
export function readUserBoard(userKey: string): PersistedUserBoard | null {
  const entry = readFile()?.users?.[userKey];
  return sanitizeUserBoard(entry);
}

/** Validate local, server, or tenant-default JSON against the current schema. */
export function sanitizeUserBoard(value: unknown): PersistedUserBoard | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<PersistedUserBoard>;
  const layouts: PersistedUserBoard['layouts'] = {};
  for (const bp of BOARD_BREAKPOINT_IDS) {
    const items = sanitizePersistedItems(entry.layouts?.[bp]);
    if (items) layouts[bp] = items;
  }
  return {
    hidden: sanitizeStringArray(entry.hidden),
    sized: sanitizeStringArray(entry.sized),
    layouts,
    preset: isPreset(entry.preset) ? entry.preset : 'recommended',
    scope: isScope(entry.scope) ? entry.scope : 'all',
    horizonDays: isHorizon(entry.horizonDays) ? entry.horizonDays : 30,
    alertThreshold: isAlertThreshold(entry.alertThreshold) ? entry.alertThreshold : 'high',
  };
}

/** Write (or clear, with `null`) one user's board without touching others. */
export function writeUserBoard(userKey: string, board: PersistedUserBoard | null): void {
  if (typeof window === 'undefined') return;
  try {
    const file = readFile() ?? { version: 2 as const, users: {} };
    file.version = 2;
    if (board) {
      file.users[userKey] = board;
    } else {
      delete file.users[userKey];
    }
    window.localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(file));
    window.localStorage.removeItem(LEGACY_BOARD_STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode / quota) — customization stays in-memory.
  }
}

/**
 * Build the default layout for a breakpoint from `DEFAULT_ROWS`, restricted to
 * the widgets the user can see. Shared rows split the columns evenly; a shared
 * row reduced to one visible widget takes full width (mirrors the old page's
 * permission-dependent composition).
 */
export function buildDefaultLayout(bp: BoardBreakpoint, enabledIds: readonly string[]): PersistedItem[] {
  const cols = BOARD_COLS[bp];
  const items: PersistedItem[] = [];
  let y = 0;

  for (const row of DEFAULT_ROWS) {
    const rowIds = row.filter((id) => enabledIds.includes(id));
    if (rowIds.length === 0) continue;

    if (bp === 'xs' || rowIds.length === 1) {
      for (const id of rowIds) {
        const def = getWidgetDefinition(id);
        if (!def) continue;
        const h = pxToRows(def.estimatedHeightPx);
        items.push({ i: id, x: 0, y, w: cols, h });
        y += h;
      }
      continue;
    }

    const span = Math.floor(cols / rowIds.length);
    let x = 0;
    let rowH = 1;
    rowIds.forEach((id, index) => {
      const def = getWidgetDefinition(id);
      if (!def) return;
      const w = index === rowIds.length - 1 ? cols - x : span;
      const h = pxToRows(def.estimatedHeightPx);
      rowH = Math.max(rowH, h);
      items.push({ i: id, x, y, w, h });
      x += w;
    });
    y += rowH;
  }

  // Future-proofing: any enabled widget not present in DEFAULT_ROWS lands at
  // the bottom, full width.
  for (const id of enabledIds) {
    if (items.some((item) => item.i === id)) continue;
    const def = getWidgetDefinition(id);
    if (!def) continue;
    const h = pxToRows(def.estimatedHeightPx);
    items.push({ i: id, x: 0, y, w: cols, h });
    y += h;
  }

  return items;
}

/**
 * Reconcile a stored layout with the current widget set: drop unknown/removed
 * widgets, clamp coordinates into the column bounds, and append newly enabled
 * widgets at the bottom. Falls back to the default layout when nothing is
 * stored for the breakpoint.
 */
export function sanitizeLayout(
  stored: PersistedItem[] | undefined,
  bp: BoardBreakpoint,
  enabledIds: readonly string[],
): PersistedItem[] {
  const cols = BOARD_COLS[bp];
  if (!stored) return buildDefaultLayout(bp, enabledIds);

  const kept = stored
    .filter((item) => enabledIds.includes(item.i) && getWidgetDefinition(item.i))
    .map((item) => {
      const w = Math.max(1, Math.min(Math.round(item.w) || 1, cols));
      const x = Math.max(0, Math.min(Math.round(item.x) || 0, cols - w));
      return {
        i: item.i,
        x,
        y: Math.max(0, Math.round(item.y) || 0),
        w,
        h: Math.max(1, Math.round(item.h) || 1),
      };
    });

  const present = new Set(kept.map((item) => item.i));
  let bottom = kept.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  for (const id of enabledIds) {
    if (present.has(id)) continue;
    const def = getWidgetDefinition(id);
    if (!def) continue;
    const h = pxToRows(def.estimatedHeightPx);
    kept.push({ i: id, x: 0, y: bottom, w: cols, h });
    bottom += h;
  }

  return kept;
}

/**
 * Derive a stacked (single-column) layout from another breakpoint's layout,
 * preserving reading order (y, then x). Used for the narrow breakpoint when
 * the user has only customized the wide one.
 */
export function stackLayout(from: readonly PersistedItem[], bp: BoardBreakpoint): PersistedItem[] {
  const cols = BOARD_COLS[bp];
  const sorted = [...from].sort((a, b) => a.y - b.y || a.x - b.x);
  let y = 0;
  return sorted.map((item) => {
    const stacked: PersistedItem = { i: item.i, x: 0, y, w: cols, h: item.h };
    y += item.h;
    return stacked;
  });
}

/** Mirror x-coordinates for RTL rendering. Involutive: mirror(mirror(l)) == l. */
export function mirrorLayout(items: readonly Layout[], cols: number): Layout[] {
  return items.map((item) => ({ ...item, x: Math.max(0, cols - item.x - item.w) }));
}
