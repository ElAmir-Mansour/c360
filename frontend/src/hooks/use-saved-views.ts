"use client";

/**
 * Platform-wide saved views (item 27) + opt-in SERVER persistence (#12).
 *
 * A saved view is a named snapshot of a list page's state — filter map, sort,
 * hidden columns and row density. By DEFAULT it persists per route in
 * localStorage under `views:<routeKey>` (unchanged, backward-compatible). Any
 * DataTable page can consume this via the `<SavedViewsBar>` (standalone, above
 * its own toolbar) or through the `savedViews` prop on `<DataTable>` which
 * mounts the bar and wires the capture/apply plumbing automatically.
 *
 * SERVER MODE (opt-in): pass `persistence={{ mode: 'server', namespace:
 * 'lex-contracts' }}` and the hook CRUDs against the lex `/saved-views`
 * endpoints instead of localStorage. Server views carry a share scope
 * (personal / team / org) and an optional default-for-role marker:
 *   - personal views are owner-only; team/org views are tenant-visible and
 *     writable by the owner or a `lex:catalog:manage` holder (mirrors the
 *     backend SavedViewService rules — the backend stays the boundary).
 *   - a shared view whose `role_slug` matches the caller's ACTIVE legal role
 *     (from `useLexContext`) is that user's default and is auto-applied on
 *     mount by `<SavedViewsBar>` exactly like a local default.
 *   - `setDefaultView` remains a per-USER preference and therefore stays
 *     device-local (marker key `views:<routeKey>:my-default`) — it needs no
 *     write access to the (possibly foreign-owned) view and overrides the
 *     role default. Admins set the role-wide default via `setRoleDefault`.
 * Mutations are optimistic; any rejected mutation triggers a conflict-safe
 * refetch (sequence-guarded so a stale response never clobbers newer state).
 *
 * Back-compat: this generalizes the original lex-only hook (which stored
 * `{ id, name, params }` under `clario360.savedViews.<namespace>`). Legacy
 * blobs are migrated on first read — `params` becomes `filters` — so existing
 * lex users keep their saved views. Callers that pass no `persistence` see
 * byte-identical localStorage behaviour, per namespace, as before.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useLexContext } from "@/lib/lex/use-lex-context";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
  type SavedViewScope,
  type ServerSavedView,
  type UpdateSavedViewInput,
} from "@/lib/lex/saved-views";

export type { SavedViewScope } from "@/lib/lex/saved-views";

export type SavedViewDensity = "comfortable" | "compact";

export interface SavedViewSort {
  column: string;
  direction: "asc" | "desc";
}

/** The page state a saved view captures. Only `filters` is mandatory. */
export interface SavedViewState {
  filters: Record<string, string | string[]>;
  sort?: SavedViewSort;
  hiddenColumns?: string[];
  density?: SavedViewDensity;
}

export interface SavedView extends SavedViewState {
  id: string;
  name: string;
  /** At most one view per routeKey is the default; it is auto-applied by
   *  `<SavedViewsBar>` when the page mounts with a pristine state. In server
   *  mode this is RESOLVED (my-default marker, else role default) — never
   *  persisted inside the opaque payload. */
  isDefault?: boolean;

  // ── Server persistence only (persistence.mode === 'server') ──────────────
  /** Share scope of the server row (personal / team / org). */
  scope?: SavedViewScope;
  /** Legal-role slug this shared view is the default for, if any. */
  roleSlug?: string | null;
  /** Server owner id (used to recompute ownership when auth hydrates late). */
  ownerUserId?: string;
  /** True when the caller owns the server row. */
  ownedByMe?: boolean;
  /** True when the caller may rename / re-scope / delete this view
   *  (owner, or `lex:catalog:manage` holder for shared views). */
  canEdit?: boolean;
  /** True while an optimistic create/update for this view is in flight. */
  pending?: boolean;
}

/** Opt-in persistence config. Omit (or `mode: 'local'`) for the default
 *  localStorage behaviour — existing callers are untouched. */
export interface SavedViewsPersistence {
  mode: "local" | "server";
  /** Server namespace (e.g. 'lex-contracts'); defaults to the routeKey. */
  namespace?: string;
}

/** Options for `saveView` — only meaningful in server mode. */
export interface SaveViewOptions {
  /** Share scope for a NEWLY created view (server default: personal). */
  scope?: SavedViewScope;
}

const STORAGE_PREFIX = "views:";
/** Storage prefix used by the original lex-only hook; read once for migration. */
const LEGACY_STORAGE_PREFIX = "clario360.savedViews.";

/** Permission key that may write shared views / role defaults (backend rule). */
const MANAGE_PERMISSION = "lex:catalog:manage";

const DENSITIES: readonly SavedViewDensity[] = ["comfortable", "compact"];

/** Reserved URL params owned by `useDataTable`; never written as filters. */
const RESERVED_URL_PARAMS = new Set([
  "page",
  "per_page",
  "sort",
  "order",
  "search",
]);

function storageKey(routeKey: string): string {
  return `${STORAGE_PREFIX}${routeKey}`;
}

/** Device-local "my default" marker used in SERVER mode. Distinct from the
 *  `views:<routeKey>` blob so server mode never touches local-mode data. */
function defaultMarkerKey(routeKey: string): string {
  return `${STORAGE_PREFIX}${routeKey}:my-default`;
}

function isFilterValue(value: unknown): value is string | string[] {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every((v) => typeof v === "string"))
  );
}

function normalizeFilters(raw: unknown): Record<string, string | string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const filters: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isFilterValue(value)) {
      filters[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return filters;
}

function normalizeSort(raw: unknown): SavedViewSort | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as Partial<SavedViewSort>;
  if (
    typeof candidate.column === "string" &&
    candidate.column !== "" &&
    (candidate.direction === "asc" || candidate.direction === "desc")
  ) {
    return { column: candidate.column, direction: candidate.direction };
  }
  return undefined;
}

/** Coerce one untrusted parsed item into a SavedView (or drop it). Accepts
 *  the legacy `{ params }` shape alongside the current `{ filters }` shape. */
function normalizeView(raw: unknown): SavedView | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id === "") return null;
  if (typeof candidate.name !== "string" || candidate.name === "") return null;

  const filtersSource =
    candidate.filters !== undefined ? candidate.filters : candidate.params;

  const view: SavedView = {
    id: candidate.id,
    name: candidate.name,
    filters: normalizeFilters(filtersSource),
  };

  const sort = normalizeSort(candidate.sort);
  if (sort) view.sort = sort;

  if (Array.isArray(candidate.hiddenColumns)) {
    view.hiddenColumns = candidate.hiddenColumns.filter(
      (c): c is string => typeof c === "string",
    );
  }

  if (DENSITIES.includes(candidate.density as SavedViewDensity)) {
    view.density = candidate.density as SavedViewDensity;
  }

  if (candidate.isDefault === true) view.isDefault = true;

  return view;
}

function parseViews(raw: string | null): SavedView[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map(normalizeView)
      .filter((v): v is SavedView => v !== null);
  } catch {
    return null;
  }
}

function writeViews(routeKey: string, views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(routeKey), JSON.stringify(views));
  } catch {
    /* ignore quota / serialization errors */
  }
}

/** Read views for a route; on first read, migrate any legacy lex-era blob
 *  (`clario360.savedViews.<routeKey>`) into the `views:<routeKey>` key. */
function readViews(routeKey: string): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const current = parseViews(
      window.localStorage.getItem(storageKey(routeKey)),
    );
    if (current) return current;

    const legacy = parseViews(
      window.localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${routeKey}`),
    );
    if (legacy && legacy.length > 0) {
      writeViews(routeKey, legacy);
      return legacy;
    }
    return [];
  } catch {
    return [];
  }
}

function readDefaultMarker(routeKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(defaultMarkerKey(routeKey));
  } catch {
    return null;
  }
}

function writeDefaultMarker(routeKey: string, id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id === null) window.localStorage.removeItem(defaultMarkerKey(routeKey));
    else window.localStorage.setItem(defaultMarkerKey(routeKey), id);
  } catch {
    /* ignore quota errors */
  }
}

/** Deterministic id from a name slug + a uniqueness suffix derived from existing ids. */
function makeId(name: string, existing: SavedView[]): string {
  const slug =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "view";
  let candidate = slug;
  let counter = 1;
  const taken = new Set(existing.map((v) => v.id));
  while (taken.has(candidate)) {
    counter += 1;
    candidate = `${slug}-${counter}`;
  }
  return candidate;
}

/** Clone + strip a SavedViewState so only meaningful fields are persisted. */
function normalizeState(state: SavedViewState): SavedViewState {
  const next: SavedViewState = { filters: normalizeFilters(state.filters) };
  if (state.sort) next.sort = { ...state.sort };
  if (state.hiddenColumns) next.hiddenColumns = [...state.hiddenColumns];
  if (state.density) next.density = state.density;
  return next;
}

/** Serialize a (normalized) state into the opaque server payload blob. */
function statePayload(state: SavedViewState): Record<string, unknown> {
  const payload: Record<string, unknown> = { filters: state.filters };
  if (state.sort) payload.sort = state.sort;
  if (state.hiddenColumns && state.hiddenColumns.length > 0) {
    payload.hiddenColumns = state.hiddenColumns;
  }
  if (state.density) payload.density = state.density;
  return payload;
}

/** True for the tenant-visible scopes (team / org). */
function isSharedScope(scope: SavedViewScope | undefined): boolean {
  return scope === "team" || scope === "org";
}

/** Map one server row into the client SavedView shape. The payload is run
 *  through the same normalizer as localStorage blobs (it is untrusted), and
 *  any `isDefault` inside it is DISCARDED — defaults are resolved from the
 *  role marker / device-local marker, never from the opaque payload. */
function fromServerView(
  row: ServerSavedView,
  myUserId: string,
  canManage: boolean,
): SavedView {
  const payload =
    row.payload && typeof row.payload === "object" ? row.payload : {};
  const normalized = normalizeView({ ...payload, id: row.id, name: row.name });
  const base: SavedView = normalized ?? {
    id: row.id,
    name: row.name,
    filters: {},
  };
  delete base.isDefault;
  const ownedByMe = myUserId !== "" && row.owner_user_id === myUserId;
  return {
    ...base,
    scope: row.scope,
    roleSlug: row.role_slug ?? null,
    ownerUserId: row.owner_user_id,
    ownedByMe,
    canEdit: ownedByMe || (isSharedScope(row.scope) && canManage),
  };
}

export interface UseSavedViewsReturn {
  views: SavedView[];
  /** True once the initial hydration has settled — the localStorage read in
   *  local mode; the first server fetch AND the persona context in server
   *  mode (so the role default is known before the bar auto-applies). */
  hydrated: boolean;
  /** The resolved default view for this route, if any. In server mode:
   *  device-local "my default" marker first, else the view whose `roleSlug`
   *  matches the caller's active legal role. */
  defaultView: SavedView | undefined;
  /** Upsert by (case-insensitive) name: overwriting an existing view keeps
   *  its id and default flag but replaces the captured state. Server mode
   *  only overwrites views the caller can edit; `options.scope` picks the
   *  share scope for a NEW server view (default personal). */
  saveView: (name: string, state: SavedViewState, options?: SaveViewOptions) => void;
  renameView: (id: string, name: string) => void;
  deleteView: (id: string) => void;
  /** Flag one view as MY default (pass `null` to clear). Per-user preference:
   *  local-mode views persist it in the blob; server mode keeps it as a
   *  device-local marker (no write access to the shared row required). */
  setDefaultView: (id: string | null) => void;

  // ── Server persistence extras (inert in local mode) ────────────────────
  /** Active persistence mode. */
  mode: "local" | "server";
  /** True while a server fetch is in flight (initial or refetch). */
  syncing: boolean;
  /** True when the last server sync failed (views may be stale). */
  syncError: boolean;
  /** Conflict-safe refetch from the server (no-op in local mode). */
  refetch: () => Promise<void>;
  /** The caller's active legal-role slug (from `useLexContext`), if any. */
  myRoleSlug: string | null;
  /** True when the caller holds `lex:catalog:manage` (may edit shared views
   *  and set/clear role defaults). Always false in local mode. */
  canManageRoleDefaults: boolean;
  /** Admin: mark a SHARED view as the default for a role (`null` clears).
   *  Upsert semantics — the previous default for that role is demoted. */
  setRoleDefault: (id: string, roleSlug: string | null) => void;
  /** Change a view's share scope (owner, or manage-holder for shared). */
  setViewScope: (id: string, scope: SavedViewScope) => void;
}

export function useSavedViews(
  routeKey: string,
  persistence?: SavedViewsPersistence,
): UseSavedViewsReturn {
  const serverMode = persistence?.mode === "server";
  const namespace = serverMode
    ? persistence?.namespace ?? routeKey
    : routeKey;

  const [views, setViews] = useState<SavedView[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [localDefaultId, setLocalDefaultId] = useState<string | null>(null);

  // Persona / permission context — safe defaults when the lex provider is not
  // mounted (non-lex pages) or in local mode.
  const { user, hasPermission } = useAuth();
  const { activeRole, loading: personaLoading } = useLexContext();
  const myUserId = user?.id ?? "";
  const myRoleSlug = serverMode ? activeRole?.slug ?? null : null;
  const canManageRoleDefaults = serverMode && hasPermission(MANAGE_PERMISSION);

  // Latest values for async callbacks without dep churn.
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const mapCtxRef = useRef({ myUserId, canManage: canManageRoleDefaults });
  mapCtxRef.current = { myUserId, canManage: canManageRoleDefaults };

  const mapRow = useCallback(
    (row: ServerSavedView): SavedView =>
      fromServerView(row, mapCtxRef.current.myUserId, mapCtxRef.current.canManage),
    [],
  );

  // Conflict-safe server sync: every fetch takes a sequence number; only the
  // NEWEST response may write state, so an optimistic update followed by a
  // refetch can never be clobbered by an older in-flight response.
  const requestSeqRef = useRef(0);
  const refetch = useCallback(async (): Promise<void> => {
    if (!serverMode) return;
    const seq = ++requestSeqRef.current;
    setSyncing(true);
    try {
      const rows = await listSavedViews(namespace);
      if (seq !== requestSeqRef.current) return;
      setViews(rows.map(mapRow));
      setSyncError(false);
    } catch {
      if (seq !== requestSeqRef.current) return;
      setSyncError(true);
    } finally {
      if (seq === requestSeqRef.current) {
        setSyncing(false);
        setHydrated(true);
      }
    }
  }, [serverMode, namespace, mapRow]);

  // Hydrate after mount (SSR-safe; re-run on key / mode change).
  useEffect(() => {
    if (serverMode) {
      setViews([]);
      setHydrated(false);
      setSyncError(false);
      setLocalDefaultId(readDefaultMarker(routeKey));
      void refetch();
      return;
    }
    setViews(readViews(routeKey));
    setHydrated(true);
  }, [serverMode, routeKey, refetch]);

  // Recompute ownership/editability when auth hydrates after the first fetch.
  useEffect(() => {
    if (!serverMode) return;
    setViews((prev) => {
      let changed = false;
      const next = prev.map((v) => {
        const ownedByMe = myUserId !== "" && v.ownerUserId === myUserId;
        const canEdit =
          ownedByMe || (isSharedScope(v.scope) && canManageRoleDefaults);
        if (v.ownedByMe === ownedByMe && v.canEdit === canEdit) return v;
        changed = true;
        return { ...v, ownedByMe, canEdit };
      });
      return changed ? next : prev;
    });
  }, [serverMode, myUserId, canManageRoleDefaults]);

  // Keep multiple bars / tabs in sync via the storage event (local mode only —
  // server mode owns no `views:<routeKey>` blob).
  useEffect(() => {
    if (serverMode || typeof window === "undefined") return;
    const key = storageKey(routeKey);
    const handler = (event: StorageEvent) => {
      if (event.key === key) {
        setViews(readViews(routeKey));
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [serverMode, routeKey]);

  const persist = useCallback(
    (updater: (prev: SavedView[]) => SavedView[]) => {
      setViews((prev) => {
        const next = updater(prev);
        writeViews(routeKey, next);
        return next;
      });
    },
    [routeKey],
  );

  const saveView = useCallback(
    (name: string, state: SavedViewState, options?: SaveViewOptions) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const nextState = normalizeState(state);

      if (!serverMode) {
        persist((prev) => {
          const existingIndex = prev.findIndex(
            (v) => v.name.toLowerCase() === trimmed.toLowerCase(),
          );
          if (existingIndex >= 0) {
            const next = [...prev];
            const existing = next[existingIndex];
            next[existingIndex] = {
              id: existing.id,
              name: existing.name,
              ...(existing.isDefault ? { isDefault: true } : {}),
              ...nextState,
            };
            return next;
          }
          return [...prev, { id: makeId(trimmed, prev), name: trimmed, ...nextState }];
        });
        return;
      }

      const payload = statePayload(nextState);
      const existing = viewsRef.current.find(
        (v) =>
          !v.pending &&
          v.canEdit &&
          v.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) {
        // Optimistic overwrite: identity/share fields stay, the captured
        // state is REPLACED (mirrors local-mode upsert — stale sort/density
        // keys must not linger).
        setViews((prev) =>
          prev.map((v) =>
            v.id === existing.id
              ? {
                  id: v.id,
                  name: v.name,
                  scope: v.scope,
                  roleSlug: v.roleSlug,
                  ownerUserId: v.ownerUserId,
                  ownedByMe: v.ownedByMe,
                  canEdit: v.canEdit,
                  ...nextState,
                  pending: true,
                }
              : v,
          ),
        );
        updateSavedView(existing.id, { payload })
          .then((row) => {
            setViews((prev) =>
              prev.map((v) => (v.id === existing.id ? mapRow(row) : v)),
            );
          })
          .catch(() => void refetch());
        return;
      }

      const scope: SavedViewScope = options?.scope ?? "personal";
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setViews((prev) => [
        ...prev,
        {
          id: tempId,
          name: trimmed,
          ...nextState,
          scope,
          roleSlug: null,
          ownerUserId: mapCtxRef.current.myUserId || undefined,
          ownedByMe: true,
          canEdit: true,
          pending: true,
        },
      ]);
      createSavedView({ namespace, name: trimmed, scope, payload })
        .then((row) => {
          setViews((prev) =>
            prev.map((v) => (v.id === tempId ? mapRow(row) : v)),
          );
        })
        .catch(() => {
          setViews((prev) => prev.filter((v) => v.id !== tempId));
          void refetch();
        });
    },
    [serverMode, namespace, persist, mapRow, refetch],
  );

  const renameView = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;

      if (!serverMode) {
        persist((prev) =>
          prev.map((v) => (v.id === id ? { ...v, name: trimmed } : v)),
        );
        return;
      }

      const target = viewsRef.current.find((v) => v.id === id);
      if (!target || target.pending || !target.canEdit) return;
      setViews((prev) =>
        prev.map((v) =>
          v.id === id ? { ...v, name: trimmed, pending: true } : v,
        ),
      );
      updateSavedView(id, { name: trimmed })
        .then((row) => {
          setViews((prev) => prev.map((v) => (v.id === id ? mapRow(row) : v)));
        })
        .catch(() => void refetch());
    },
    [serverMode, persist, mapRow, refetch],
  );

  const deleteView = useCallback(
    (id: string) => {
      if (!serverMode) {
        persist((prev) => prev.filter((v) => v.id !== id));
        return;
      }

      const target = viewsRef.current.find((v) => v.id === id);
      if (!target || target.pending || !target.canEdit) return;
      setViews((prev) => prev.filter((v) => v.id !== id));
      if (localDefaultId === id) {
        writeDefaultMarker(routeKey, null);
        setLocalDefaultId(null);
      }
      deleteSavedView(id).catch(() => void refetch());
    },
    [serverMode, routeKey, localDefaultId, persist, refetch],
  );

  const setDefaultView = useCallback(
    (id: string | null) => {
      if (serverMode) {
        // Per-user preference: a device-local marker, never a server write —
        // it must work on shared views the caller cannot edit.
        writeDefaultMarker(routeKey, id);
        setLocalDefaultId(id);
        return;
      }
      persist((prev) =>
        prev.map((v) => {
          const isDefault = id !== null && v.id === id;
          if (Boolean(v.isDefault) === isDefault) return v;
          const next = { ...v };
          if (isDefault) next.isDefault = true;
          else delete next.isDefault;
          return next;
        }),
      );
    },
    [serverMode, routeKey, persist],
  );

  const setRoleDefault = useCallback(
    (id: string, roleSlug: string | null) => {
      if (!serverMode) return;
      const target = viewsRef.current.find((v) => v.id === id);
      if (!target || target.pending || !isSharedScope(target.scope)) return;
      // Optimistic upsert: assign the slug to the target and demote any other
      // holder of the same role default (backend does this transactionally).
      setViews((prev) =>
        prev.map((v) => {
          if (v.id === id) return { ...v, roleSlug, pending: true };
          if (roleSlug && v.roleSlug === roleSlug) return { ...v, roleSlug: null };
          return v;
        }),
      );
      updateSavedView(id, { role_slug: roleSlug ?? "" })
        .then((row) => {
          setViews((prev) => prev.map((v) => (v.id === id ? mapRow(row) : v)));
        })
        .catch(() => void refetch());
    },
    [serverMode, mapRow, refetch],
  );

  const setViewScope = useCallback(
    (id: string, scope: SavedViewScope) => {
      if (!serverMode) return;
      const target = viewsRef.current.find((v) => v.id === id);
      if (!target || target.pending || !target.canEdit || target.scope === scope)
        return;
      const input: UpdateSavedViewInput = { scope };
      const clearsRole = scope === "personal" && Boolean(target.roleSlug);
      if (clearsRole) input.role_slug = ""; // a personal view cannot be a role default
      setViews((prev) =>
        prev.map((v) =>
          v.id === id
            ? {
                ...v,
                scope,
                ...(clearsRole ? { roleSlug: null } : {}),
                pending: true,
              }
            : v,
        ),
      );
      updateSavedView(id, input)
        .then((row) => {
          setViews((prev) => prev.map((v) => (v.id === id ? mapRow(row) : v)));
        })
        .catch(() => void refetch());
    },
    [serverMode, mapRow, refetch],
  );

  // Server mode: resolve the default flag — device-local "my default" marker
  // first, else the shared view marked as the default for my active role.
  const resolvedViews = useMemo(() => {
    if (!serverMode) return views;
    const explicit =
      localDefaultId && views.some((v) => v.id === localDefaultId)
        ? localDefaultId
        : null;
    const roleDefaultId = myRoleSlug
      ? views.find((v) => v.roleSlug === myRoleSlug)?.id ?? null
      : null;
    const defaultId = explicit ?? roleDefaultId;
    return views.map((v) => {
      const isDefault = defaultId !== null && v.id === defaultId;
      if (Boolean(v.isDefault) === isDefault) return v;
      const next = { ...v };
      if (isDefault) next.isDefault = true;
      else delete next.isDefault;
      return next;
    });
  }, [serverMode, views, localDefaultId, myRoleSlug]);

  const defaultView = useMemo(
    () => resolvedViews.find((v) => v.isDefault),
    [resolvedViews],
  );

  // In server mode the bar must not auto-apply until the persona context has
  // settled too — otherwise the role default could be missed on first paint.
  const exposedHydrated = serverMode ? hydrated && !personaLoading : hydrated;

  return {
    views: resolvedViews,
    hydrated: exposedHydrated,
    defaultView,
    saveView,
    renameView,
    deleteView,
    setDefaultView,
    mode: serverMode ? "server" : "local",
    syncing,
    syncError,
    refetch,
    myRoleSlug,
    canManageRoleDefaults,
    setRoleDefault,
    setViewScope,
  };
}

// ─── URL applier ────────────────────────────────────────────────────────────

/** The portion of a saved view that lives in page-owned (URL) state. */
export interface SavedViewApplyState {
  filters: Record<string, string | string[]>;
  sort?: SavedViewSort;
}

/**
 * Batched applier for pages driven by `useDataTable`'s URL contract
 * (`page`/`per_page`/`sort`/`order`/`search` reserved; every other param is a
 * filter). Replaces all filter params and — when the view captured one — the
 * sort in a SINGLE `router.push`, because sequential `setFilter` calls clone
 * the same stale searchParams and clobber each other. Preserves `per_page` and
 * `search`, resets `page` to 1, and keeps the current sort when the view does
 * not declare one.
 */
export function useApplySavedViewState(): (state: SavedViewApplyState) => void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (state: SavedViewApplyState) => {
      const params = new URLSearchParams();
      const preserve = (key: string) => {
        const value = searchParams?.get(key);
        if (value) params.set(key, value);
      };
      preserve("per_page");
      preserve("search");

      for (const [key, value] of Object.entries(state.filters)) {
        if (RESERVED_URL_PARAMS.has(key)) continue;
        if (Array.isArray(value)) {
          for (const v of value) {
            if (v !== "") params.append(key, v);
          }
        } else if (value !== undefined && value !== "") {
          params.set(key, value);
        }
      }

      if (state.sort) {
        params.set("sort", state.sort.column);
        params.set("order", state.sort.direction);
      } else {
        preserve("sort");
        preserve("order");
      }
      params.set("page", "1");

      const base = pathname ?? "";
      const qs = params.toString();
      router.push(qs ? `${base}?${qs}` : base);
    },
    [router, pathname, searchParams],
  );
}
