"use client";

/**
 * SavedViewsBar — platform-wide saved views for list pages (item 27), with
 * opt-in SERVER persistence (#12).
 *
 * Renders the route's saved views as applyable chips plus a "save current
 * view" popover. Each chip carries a menu with rename / set-as-default /
 * delete; the default view is auto-applied once when the page mounts with a
 * pristine (filter-less) state. Views persist per route via
 * `useSavedViews` (localStorage `views:<routeKey>` by default), capturing
 * filters and — when the host page provides them — sort, hidden columns and
 * density.
 *
 * SERVER MODE: pass `persistence={{ mode: 'server', namespace:
 * 'lex-contracts' }}` and views live on the lex `/saved-views` endpoints
 * instead. Chips then show a share-scope indicator (person / team / org
 * icon), the save popover offers the share scope, and admins holding
 * `lex:catalog:manage` can mark a shared view as the default for their
 * active legal role (auto-applied for every holder of that role on mount).
 * Mutating menu items are hidden on views the caller cannot edit — the
 * backend remains the authorization boundary.
 *
 * Mount it standalone above any toolbar, or let `<DataTable savedViews={…}>`
 * mount and wire it automatically.
 *
 * Back-compat: the original lex-only API keeps working unchanged —
 * `namespace` is a deprecated alias of `routeKey`, `onApply` still receives
 * the view's filter map as its first argument, and `labels` accepts the old
 * `{ save, saved, empty }` shape (all keys now optional; defaults are
 * bilingual en/ar, resolved from the active locale). Omitting `persistence`
 * keeps the localStorage behaviour byte-identical.
 */

import * as React from "react";
import {
  BookmarkPlus,
  Building2,
  Check,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Star,
  StarOff,
  Trash2,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import {
  useSavedViews,
  type SavedView,
  type SavedViewDensity,
  type SavedViewScope,
  type SavedViewSort,
  type SavedViewsPersistence,
} from "@/hooks/use-saved-views";

export type { SavedView, SavedViewsPersistence } from "@/hooks/use-saved-views";

export interface SavedViewsBarLabels {
  save?: string;
  saved?: string;
  empty?: string;
  namePlaceholder?: string;
  rename?: string;
  delete?: string;
  setDefault?: string;
  clearDefault?: string;
  defaultBadge?: string;
  menu?: string;
  // Server-persistence additions (all optional; bilingual defaults below).
  scopeLabel?: string;
  scopePersonal?: string;
  scopeTeam?: string;
  scopeOrg?: string;
  roleDefaultSet?: string;
  roleDefaultClear?: string;
  roleDefaultBadge?: string;
  loading?: string;
  syncError?: string;
}

const LABELS: Record<"en" | "ar", Required<SavedViewsBarLabels>> = {
  en: {
    save: "Save current view",
    saved: "Saved views",
    empty: "No saved views yet",
    namePlaceholder: "View name",
    rename: "Rename view",
    delete: "Delete view",
    setDefault: "Set as default",
    clearDefault: "Clear default",
    defaultBadge: "Default view",
    menu: "View options",
    scopeLabel: "Visibility",
    scopePersonal: "Personal",
    scopeTeam: "Team",
    scopeOrg: "Organization",
    roleDefaultSet: "Set as default for my role",
    roleDefaultClear: "Clear role default",
    roleDefaultBadge: "Role default",
    loading: "Loading saved views…",
    syncError: "Couldn't sync saved views",
  },
  ar: {
    save: "حفظ العرض الحالي",
    saved: "العروض المحفوظة",
    empty: "لا توجد عروض محفوظة بعد",
    namePlaceholder: "اسم العرض",
    rename: "إعادة تسمية العرض",
    delete: "حذف العرض",
    setDefault: "تعيين كعرض افتراضي",
    clearDefault: "إلغاء التعيين الافتراضي",
    defaultBadge: "العرض الافتراضي",
    menu: "خيارات العرض",
    scopeLabel: "نطاق المشاركة",
    scopePersonal: "شخصي",
    scopeTeam: "الفريق",
    scopeOrg: "المنشأة",
    roleDefaultSet: "تعيينه افتراضيًا لدوري",
    roleDefaultClear: "إلغاء افتراضي الدور",
    roleDefaultBadge: "افتراضي الدور",
    loading: "جارٍ تحميل العروض المحفوظة…",
    syncError: "تعذّرت مزامنة العروض المحفوظة",
  },
};

/** Share-scope indicator icons: person / team / org. */
const SCOPE_ICONS: Record<SavedViewScope, LucideIcon> = {
  personal: User,
  team: Users,
  org: Building2,
};

const SCOPES: readonly SavedViewScope[] = ["personal", "team", "org"];

function scopeLabelOf(
  scope: SavedViewScope,
  labels: Required<SavedViewsBarLabels>,
): string {
  switch (scope) {
    case "team":
      return labels.scopeTeam;
    case "org":
      return labels.scopeOrg;
    default:
      return labels.scopePersonal;
  }
}

export interface SavedViewsBarProps {
  /** Stable route key; views persist under localStorage `views:<routeKey>`
   *  unless `persistence` opts into server mode. */
  routeKey?: string;
  /** @deprecated Legacy alias of `routeKey` (kept for the lex call sites). */
  namespace?: string;
  /** Opt-in persistence config. Omit for the default localStorage behaviour;
   *  `{ mode: 'server', namespace: 'lex-contracts' }` moves the views to the
   *  lex `/saved-views` endpoints (share scopes + role defaults). */
  persistence?: SavedViewsPersistence;
  /** The page's current filter map — captured on save, compared for the
   *  active-chip highlight. */
  activeFilters: Record<string, string | string[]>;
  /** Current sort, captured on save when provided (DataTable wires this). */
  sort?: SavedViewSort;
  /** Currently hidden column ids, captured on save when provided. */
  hiddenColumns?: string[];
  /** Current row density, captured on save when provided. */
  density?: SavedViewDensity;
  /** Apply a view. Receives the view's filter map first (legacy signature)
   *  and the full view second for callers that also restore sort/columns. */
  onApply: (
    filters: Record<string, string | string[]>,
    view: SavedView,
  ) => void;
  /** Auto-apply the default view once, when the page mounts without any
   *  active filters (deep links win). Defaults to true. */
  autoApplyDefault?: boolean;
  labels?: SavedViewsBarLabels;
  className?: string;
}

function normalizedEntries(
  map: Record<string, string | string[]>,
): Array<[string, string | string[]]> {
  return Object.entries(map).filter(([, v]) =>
    Array.isArray(v) ? v.length > 0 : v !== "" && v != null,
  );
}

function paramsEqual(
  a: Record<string, string | string[]>,
  b: Record<string, string | string[]>,
): boolean {
  const ae = normalizedEntries(a).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  const be = normalizedEntries(b).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  if (ae.length !== be.length) return false;
  return ae.every(([key, av], i) => {
    const [bKey, bv] = be[i];
    if (key !== bKey) return false;
    if (Array.isArray(av) || Array.isArray(bv)) {
      const aa = Array.isArray(av) ? [...av].sort() : [av];
      const ba = Array.isArray(bv) ? [...bv].sort() : [bv];
      return aa.length === ba.length && aa.every((v, j) => v === ba[j]);
    }
    return av === bv;
  });
}

function hasActiveFilters(filters: Record<string, string | string[]>): boolean {
  return normalizedEntries(filters).length > 0;
}

export function SavedViewsBar({
  routeKey,
  namespace,
  persistence,
  activeFilters,
  sort,
  hiddenColumns,
  density,
  onApply,
  autoApplyDefault = true,
  labels,
  className,
}: SavedViewsBarProps) {
  const { locale } = useLocaleOrDefault();
  const resolved = React.useMemo(() => {
    const base = { ...(locale === "ar" ? LABELS.ar : LABELS.en) };
    if (labels) {
      for (const [key, value] of Object.entries(labels)) {
        if (value !== undefined) {
          base[key as keyof SavedViewsBarLabels] = value;
        }
      }
    }
    return base;
  }, [locale, labels]);

  const resolvedRouteKey = routeKey ?? namespace ?? "default";
  const {
    views,
    hydrated,
    defaultView,
    saveView,
    renameView,
    deleteView,
    setDefaultView,
    mode,
    syncError,
    myRoleSlug,
    canManageRoleDefaults,
    setRoleDefault,
    setViewScope,
  } = useSavedViews(resolvedRouteKey, persistence);
  const serverMode = mode === "server";

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState<SavedViewScope>("personal");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const canSave =
    hasActiveFilters(activeFilters) ||
    sort !== undefined ||
    density !== undefined ||
    (hiddenColumns?.length ?? 0) > 0;

  React.useEffect(() => {
    if (open) {
      // Focus the input once the popover content mounts.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    setName("");
    setScope("personal");
  }, [open]);

  const handleSave = React.useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveView(
      trimmed,
      { filters: activeFilters, sort, hiddenColumns, density },
      serverMode ? { scope } : undefined,
    );
    setName("");
    setOpen(false);
  }, [name, saveView, activeFilters, sort, hiddenColumns, density, serverMode, scope]);

  const activeViewId = React.useMemo(() => {
    const match = views.find((view) => {
      if (!paramsEqual(view.filters, activeFilters)) return false;
      if (view.sort && sort) {
        return (
          view.sort.column === sort.column &&
          view.sort.direction === sort.direction
        );
      }
      return true;
    });
    return match?.id;
  }, [views, activeFilters, sort]);

  // Auto-apply the default view exactly once per mount: only after hydration
  // (in server mode: first fetch + persona context settled, so the
  // default-for-my-role is known), and only when the page arrived pristine
  // (no deep-linked filters).
  const defaultDecidedRef = React.useRef(false);
  const onApplyRef = React.useRef(onApply);
  onApplyRef.current = onApply;
  React.useEffect(() => {
    if (!hydrated || defaultDecidedRef.current) return;
    defaultDecidedRef.current = true;
    if (!autoApplyDefault || !defaultView) return;
    if (hasActiveFilters(activeFilters)) return;
    if (
      paramsEqual(defaultView.filters, activeFilters) &&
      !defaultView.sort &&
      !defaultView.density &&
      !(defaultView.hiddenColumns && defaultView.hiddenColumns.length > 0)
    ) {
      return;
    }
    onApplyRef.current(defaultView.filters, defaultView);
  }, [hydrated, autoApplyDefault, defaultView, activeFilters]);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {serverMode && !hydrated ? (
        <div
          className="flex items-center gap-1.5"
          role="status"
          aria-label={resolved.loading}
        >
          <span className="h-6 w-24 animate-pulse rounded-full bg-muted" aria-hidden />
          <span className="h-6 w-20 animate-pulse rounded-full bg-muted" aria-hidden />
          <span className="sr-only">{resolved.loading}</span>
        </div>
      ) : views.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {views.map((view) => (
            <SavedViewChip
              key={view.id}
              view={view}
              active={view.id === activeViewId}
              serverMode={serverMode}
              myRoleSlug={myRoleSlug}
              canManageRoleDefaults={canManageRoleDefaults}
              labels={resolved}
              onApply={() => onApply(view.filters, view)}
              onDelete={() => deleteView(view.id)}
              onRename={(nextName) => renameView(view.id, nextName)}
              onToggleDefault={() =>
                setDefaultView(view.isDefault ? null : view.id)
              }
              onSetScope={(nextScope) => setViewScope(view.id, nextScope)}
              onSetRoleDefault={(roleSlug) => setRoleDefault(view.id, roleSlug)}
            />
          ))}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">{resolved.empty}</span>
      )}

      {serverMode && hydrated && syncError && (
        <span className="text-xs text-muted-foreground" role="status">
          {resolved.syncError}
        </span>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            disabled={!canSave}
          >
            <BookmarkPlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{resolved.save}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-64 space-y-2 p-3"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <p className="text-xs font-medium text-foreground">{resolved.save}</p>
          <div className="flex items-center gap-1.5">
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
              placeholder={resolved.namePlaceholder}
              className="h-8 text-sm"
              aria-label={resolved.save}
            />
            <Button
              type="button"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleSave}
              disabled={!name.trim()}
              aria-label={resolved.save}
            >
              <Check className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          {serverMode && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                {resolved.scopeLabel}
              </p>
              <div
                role="group"
                aria-label={resolved.scopeLabel}
                className="grid grid-cols-3 gap-1"
              >
                {SCOPES.map((option) => {
                  const Icon = SCOPE_ICONS[option];
                  const selected = scope === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setScope(option)}
                      aria-pressed={selected}
                      className={cn(
                        "inline-flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[11px] font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">
                        {scopeLabelOf(option, resolved)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SavedViewChip({
  view,
  active,
  serverMode,
  myRoleSlug,
  canManageRoleDefaults,
  labels,
  onApply,
  onDelete,
  onRename,
  onToggleDefault,
  onSetScope,
  onSetRoleDefault,
}: {
  view: SavedView;
  active: boolean;
  serverMode: boolean;
  myRoleSlug: string | null;
  canManageRoleDefaults: boolean;
  labels: Required<SavedViewsBarLabels>;
  onApply: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onToggleDefault: () => void;
  onSetScope: (scope: SavedViewScope) => void;
  onSetRoleDefault: (roleSlug: string | null) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(view.name);
  const editInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) {
      setDraft(view.name);
      const id = window.setTimeout(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [editing, view.name]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== view.name) onRename(trimmed);
    setEditing(false);
  };

  // In local mode every view is writable; in server mode the hook computed
  // `canEdit` (owner, or lex:catalog:manage on shared views).
  const canEdit = !serverMode || view.canEdit === true;
  const scope: SavedViewScope = view.scope ?? "personal";
  const shared = scope === "team" || scope === "org";
  const ScopeIcon = SCOPE_ICONS[scope];
  const canSetRoleDefault =
    serverMode && canManageRoleDefaults && shared && myRoleSlug !== null;
  const canClearRoleDefault =
    serverMode && canManageRoleDefaults && Boolean(view.roleSlug);
  // Downgrading a role-default view to personal implies clearing the role
  // default — only offer it to a manage-holder (backend rejects it otherwise).
  const canMakePersonal = !view.roleSlug || canManageRoleDefaults;

  const titleParts = [view.name];
  if (serverMode) titleParts.push(scopeLabelOf(scope, labels));
  if (view.isDefault) titleParts.push(labels.defaultBadge);
  if (serverMode && view.roleSlug) titleParts.push(labels.roleDefaultBadge);

  return (
    <span
      className={cn(
        "group inline-flex items-center gap-1 rounded-full border py-0.5 pe-1 ps-2.5 text-xs font-medium transition-colors",
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border/80 bg-card/70 text-foreground hover:border-primary/20 hover:bg-primary/5",
        view.pending && "opacity-60",
      )}
      aria-busy={view.pending || undefined}
    >
      {editing ? (
        <input
          ref={editInputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          onBlur={commitRename}
          className="h-5 w-32 rounded bg-transparent px-1 text-xs outline-none ring-1 ring-ring"
          aria-label={`${labels.rename}: ${view.name}`}
        />
      ) : (
        <button
          type="button"
          onClick={onApply}
          className="inline-flex max-w-[12rem] items-center gap-1 truncate text-start outline-none focus-visible:underline"
          aria-pressed={active}
          title={titleParts.join(" — ")}
        >
          {serverMode ? (
            <>
              <ScopeIcon
                className={cn("h-3 w-3 shrink-0", !active && "opacity-60")}
                aria-hidden
              />
              <span className="sr-only">({scopeLabelOf(scope, labels)})</span>
              {(view.isDefault || view.roleSlug) && (
                <Star className="h-2.5 w-2.5 shrink-0 fill-current" aria-hidden />
              )}
            </>
          ) : (
            <Star
              className={cn(
                "h-3 w-3 shrink-0",
                view.isDefault || active ? "fill-current" : "opacity-60",
              )}
              aria-hidden
            />
          )}
          <span className="truncate">{view.name}</span>
          {view.isDefault && (
            <span className="sr-only">({labels.defaultBadge})</span>
          )}
          {serverMode && view.roleSlug && (
            <span className="sr-only">({labels.roleDefaultBadge})</span>
          )}
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 outline-none transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${labels.menu}: ${view.name}`}
          >
            <MoreHorizontal className="h-3 w-3" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {canEdit && (
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil className="me-2 h-3.5 w-3.5" aria-hidden />
              {labels.rename}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onToggleDefault}>
            {view.isDefault ? (
              <StarOff className="me-2 h-3.5 w-3.5" aria-hidden />
            ) : (
              <Star className="me-2 h-3.5 w-3.5" aria-hidden />
            )}
            {view.isDefault ? labels.clearDefault : labels.setDefault}
          </DropdownMenuItem>
          {serverMode && canEdit && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ScopeIcon className="me-2 h-3.5 w-3.5" aria-hidden />
                {labels.scopeLabel}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {SCOPES.map((option) => {
                  const OptionIcon = SCOPE_ICONS[option];
                  const selected = scope === option;
                  const disabled =
                    option === "personal" ? !canMakePersonal : false;
                  return (
                    <DropdownMenuItem
                      key={option}
                      disabled={disabled}
                      onSelect={() => {
                        if (!selected) onSetScope(option);
                      }}
                    >
                      <OptionIcon className="me-2 h-3.5 w-3.5" aria-hidden />
                      <span className="flex-1">
                        {scopeLabelOf(option, labels)}
                      </span>
                      {selected && (
                        <Check className="ms-2 h-3.5 w-3.5" aria-hidden />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {(canSetRoleDefault || canClearRoleDefault) &&
            (view.roleSlug ? (
              <DropdownMenuItem onSelect={() => onSetRoleDefault(null)}>
                <PinOff className="me-2 h-3.5 w-3.5" aria-hidden />
                {labels.roleDefaultClear}
              </DropdownMenuItem>
            ) : (
              canSetRoleDefault && (
                <DropdownMenuItem onSelect={() => onSetRoleDefault(myRoleSlug)}>
                  <Pin className="me-2 h-3.5 w-3.5" aria-hidden />
                  {labels.roleDefaultSet}
                </DropdownMenuItem>
              )
            ))}
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="me-2 h-3.5 w-3.5" aria-hidden />
                {labels.delete}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
