'use client';

/**
 * Global Cmd/Ctrl+K command palette (items 37, 39 + palette half of 21).
 *
 * Result model — five kinds of sections, in order:
 *   1. Recent     — product-scoped "recently viewed" entities (`useRecentItems`,
 *                   localStorage `recent:global`), recorded by detail pages
 *                   via `<RecordRecent />` and by selecting entity results here.
 *   2. Favorites  — starred pages/entities (`useFavorites`). Every row with a
 *                   destination shows a star toggle.
 *   3. Navigation — permission-filtered pages from `@/config/navigation`
 *                   (same registry the sidebar renders, so the palette never
 *                   routes somewhere the sidebar would hide).
 *   4. Actions    — feature-contributed commands from the shared store
 *                   (`registerCommands`), e.g. the lex suite's jump/quick-action
 *                   set while under `/lex`.
 *   5. Search results — a debounced entity search fanned only across the active
 *                   subscribed product's list endpoints (verified
 *                   against each page's own fetcher): acta meetings/committees,
 *                   lex contracts/documents/matters/obligations/regulations/
 *                   clauses/signatures, visus reports/dashboards, data
 *                   sources/pipelines, cyber alerts/assets, admin users/tenants.
 *                   Results are grouped by type with a type icon; Enter opens.
 *
 * Group labels are bilingual (en/ar) via a local label bundle keyed off the
 * active locale. Combobox + listbox ARIA pattern with aria-activedescendant
 * keyboard navigation is preserved from the previous implementation.
 */

import { useEffect, useRef, useState, useCallback, useMemo, useId } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import {
  Search,
  X,
  Database,
  GitBranch,
  FileText,
  LayoutDashboard,
  Command,
  Briefcase,
  ClipboardList,
  BookMarked,
  Library,
  ScrollText,
  PenLine,
  CalendarDays,
  Landmark,
  AlertTriangle,
  Monitor,
  Users,
  Building2,
  Gavel,
  Inbox,
  Compass,
  Clock,
  Star,
} from 'lucide-react';
import { useCommandPaletteStore, type PaletteCommand } from '@/stores/command-palette-store';
import { useCommandPalette } from '@/hooks/use-command-palette';
import { useDebounce } from '@/hooks/use-debounce';
import { useRecentItems, recordVisit, type RecentItemType } from '@/hooks/use-recent-items';
import { useFavorites, type FavoriteItem } from '@/hooks/use-favorites';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { SUITES, familyOf, navigation } from '@/config/navigation';
import { canAccessWith } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { enterpriseApi } from '@/lib/enterprise';
import { dataSuiteApi } from '@/lib/data-suite';
import type { PaginatedResponse } from '@/types/api';
import type { CyberAlert, CyberAsset } from '@/types/cyber';
import type { User } from '@/types/models';
import type { Tenant } from '@/types/tenant';
import { useNavigationLabels } from './navigation-labels';
import { useStickySuiteSegment } from './use-sticky-suite';
import {
  isPaletteHrefInScope,
  isPaletteSearchSourceInScope,
  resolvePaletteProductScope,
  type PaletteSearchSourceScope,
} from './command-palette-scope';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_SEARCH_LENGTH = 2;

interface PaletteEntry {
  id: string;
  label: string;
  /** Row meta shown on the trailing edge (hidden when equal to the group label). */
  section: string;
  icon: React.ElementType;
  /** Navigation target (mutually exclusive with `run`). */
  href?: string;
  /** Imperative action (mutually exclusive with `href`). */
  run?: () => void;
  /** Extra lower-cased match terms beyond the label. */
  keywords?: string[];
  /** Entity type — set for search results / recents / favorites rows. */
  entityType?: RecentItemType;
  /** Entity id, paired with `entityType`. */
  entityId?: string;
}

type NavEntry = PaletteEntry & { href: string };

interface PaletteGroup {
  id: string;
  label: string;
  entries: PaletteEntry[];
}

/** Icon per entity type (recents, favorites and grouped search results). */
const TYPE_ICONS: Record<RecentItemType, React.ElementType> = {
  page: Compass,
  matter: Briefcase,
  case: Gavel,
  contract: FileText,
  request: Inbox,
  document: FileText,
  obligation: ClipboardList,
  regulation: BookMarked,
  clause: ScrollText,
  library: Library,
  signature: PenLine,
  meeting: CalendarDays,
  committee: Landmark,
  report: FileText,
  dashboard: LayoutDashboard,
  source: Database,
  pipeline: GitBranch,
  alert: AlertTriangle,
  asset: Monitor,
  user: Users,
  tenant: Building2,
  other: Clock,
};

interface PaletteText {
  groups: {
    recent: string;
    favorites: string;
    navigation: string;
    actions: string;
  };
  types: Record<RecentItemType, string>;
  searching: string;
  addFavorite: string;
  removeFavorite: string;
}

/**
 * Local bilingual bundle for palette chrome. Kept in-component (rather than the
 * shared i18n message files) so the palette owns its group vocabulary.
 */
const PALETTE_TEXT: Record<'en' | 'ar', PaletteText> = {
  en: {
    groups: {
      recent: 'Recent',
      favorites: 'Favorites',
      navigation: 'Navigation',
      actions: 'Actions',
    },
    types: {
      page: 'Pages',
      matter: 'Matters',
      case: 'Cases',
      contract: 'Contracts',
      request: 'Requests',
      document: 'Documents',
      obligation: 'Obligations',
      regulation: 'Regulations',
      clause: 'Clauses',
      library: 'Reference Library',
      signature: 'Signatures',
      meeting: 'Meetings',
      committee: 'Committees',
      report: 'Reports',
      dashboard: 'Dashboards',
      source: 'Data Sources',
      pipeline: 'Pipelines',
      alert: 'Alerts',
      asset: 'Assets',
      user: 'Users',
      tenant: 'Tenants',
      other: 'Other',
    },
    searching: 'Searching…',
    addFavorite: 'Add to favorites',
    removeFavorite: 'Remove from favorites',
  },
  ar: {
    groups: {
      recent: 'الأخيرة',
      favorites: 'المفضلة',
      navigation: 'التنقل',
      actions: 'الإجراءات',
    },
    types: {
      page: 'الصفحات',
      matter: 'الملفات القانونية',
      case: 'القضايا',
      contract: 'العقود',
      request: 'الطلبات',
      document: 'الوثائق',
      obligation: 'الالتزامات',
      regulation: 'اللوائح',
      clause: 'البنود',
      library: 'المكتبة المرجعية',
      signature: 'التوقيعات',
      meeting: 'الاجتماعات',
      committee: 'اللجان',
      report: 'التقارير',
      dashboard: 'لوحات المعلومات',
      source: 'مصادر البيانات',
      pipeline: 'خطوط البيانات',
      alert: 'التنبيهات',
      asset: 'الأصول',
      user: 'المستخدمون',
      tenant: 'المستأجرون',
      other: 'أخرى',
    },
    searching: 'جارٍ البحث…',
    addFavorite: 'إضافة إلى المفضلة',
    removeFavorite: 'إزالة من المفضلة',
  },
};

function buildNavEntries(
  hasPermission: (p: string) => boolean,
  navLabel: (id: string, fallback: string) => string,
  navigationLabel: string,
): NavEntry[] {
  const entries: NavEntry[] = [];
  for (const section of navigation) {
    if (section.permission !== '*:read' && !hasPermission(section.permission)) continue;
    for (const item of section.items) {
      // Same registry/requirement model as the sidebar (§12): the palette must
      // never route a user to a page the sidebar would hide.
      if (item.permission !== '*:read' && !canAccessWith(hasPermission, item.permission))
        continue;
      entries.push({
        id: item.id,
        label: navLabel(item.id, item.label),
        href: item.href,
        section: section.label ? navLabel(section.id, section.label) : navigationLabel,
        icon: item.icon,
      });
    }
  }
  return entries;
}

function commandToEntry(command: PaletteCommand): PaletteEntry {
  return {
    id: command.id,
    label: command.label,
    section: command.section,
    icon: command.icon ?? Command,
    href: command.href,
    run: command.run,
    keywords: command.keywords?.map((keyword) => keyword.toLowerCase()),
    entityType: command.entityType,
    entityId: command.entityId,
  };
}

function entryMatches(entry: PaletteEntry, normalizedQuery: string): boolean {
  if (entry.label.toLowerCase().includes(normalizedQuery)) return true;
  return (entry.keywords ?? []).some((keyword) => keyword.includes(normalizedQuery));
}

/** Maps a palette row to the typed favorite/recent shape. */
function favoriteOf(entry: PaletteEntry & { href: string }): Omit<FavoriteItem, 'at'> {
  return {
    type: entry.entityType ?? 'page',
    id: entry.entityId ?? entry.id,
    title: entry.label,
    href: entry.href,
  };
}

/**
 * One fan-out target of the debounced entity search. Every endpoint here was
 * verified to accept a text query by reading its own list page's fetcher
 * (`search` via useDataTable/FetchParams, or a dedicated `q` search route).
 */
interface SearchSource {
  key: string;
  product: PaletteSearchSourceScope;
  permission: string;
  type: RecentItemType;
  fetch: (q: string) => Promise<PaletteEntry[]>;
}

function useSearchSources(text: PaletteText, locale: 'en' | 'ar'): SearchSource[] {
  return useMemo<SearchSource[]>(() => {
    const entry = (
      type: RecentItemType,
      id: string,
      label: string,
      href: string,
      keywords?: string[],
    ): PaletteEntry => ({
      id: `${type}-${id}`,
      label,
      section: text.types[type],
      icon: TYPE_ICONS[type],
      href,
      keywords,
      entityType: type,
      entityId: id,
    });
    const localizedTitle = (en: string, ar?: string) => (locale === 'ar' && ar ? ar : en);

    return [
      {
        key: 'meetings',
        product: 'acta',
        permission: 'acta:read',
        type: 'meeting',
        fetch: async (q) => {
          const res = await enterpriseApi.acta.listMeetings({ page: 1, per_page: 5, search: q, order: 'desc' });
          return res.data.map((m) => entry('meeting', m.id, m.title, `/acta/meetings/${m.id}`));
        },
      },
      {
        key: 'committees',
        product: 'acta',
        permission: 'acta:read',
        type: 'committee',
        fetch: async (q) => {
          const res = await enterpriseApi.acta.listCommittees({ page: 1, per_page: 5, search: q, order: 'desc' });
          return res.data.map((c) => entry('committee', c.id, c.name, `/acta/committees/${c.id}`));
        },
      },
      {
        key: 'contracts',
        product: 'lex',
        permission: 'lex:read',
        type: 'contract',
        fetch: async (q) => {
          const res = await enterpriseApi.lex.searchContracts(q, { page: 1, per_page: 5, order: 'desc' });
          return res.data.map((c) => entry('contract', c.id, c.title, `/lex/contracts/${c.id}`));
        },
      },
      {
        key: 'matters',
        product: 'lex',
        permission: 'lex:read',
        type: 'matter',
        fetch: async (q) => {
          const res = await enterpriseApi.lex.listMatters({ page: 1, per_page: 5, search: q, order: 'desc' });
          return res.data.map((m) => entry('matter', m.id, m.title, `/lex/matters/${m.id}`));
        },
      },
      {
        key: 'documents',
        product: 'lex',
        permission: 'lex:read',
        type: 'document',
        fetch: async (q) => {
          const res = await enterpriseApi.lex.listDocuments({ page: 1, per_page: 5, search: q, order: 'desc' });
          return res.data.map((d) => entry('document', d.id, d.title ?? d.file_name ?? 'Document', '/lex/documents'));
        },
      },
      {
        key: 'obligations',
        product: 'lex',
        permission: 'lex:read',
        type: 'obligation',
        fetch: async (q) => {
          const res = await enterpriseApi.lex.listObligations({ page: 1, per_page: 5, search: q, order: 'desc' });
          return res.data.map((o) => entry('obligation', o.id, o.title, '/lex/obligations'));
        },
      },
      {
        key: 'regulations',
        product: 'lex',
        permission: 'lex:read',
        type: 'regulation',
        fetch: async (q) => {
          const res = await enterpriseApi.lex.searchRegulations({ q, page: 1, per_page: 5 });
          return res.data.map((r) =>
            entry('regulation', r.item.id, localizedTitle(r.item.title_en, r.item.title_ar), '/lex/regulations'),
          );
        },
      },
      {
        key: 'clauses',
        product: 'lex',
        permission: 'lex:read',
        type: 'clause',
        fetch: async (q) => {
          const res = await enterpriseApi.lex.searchClauseLibrary({ q, page: 1, per_page: 5 });
          return res.data.map((r) =>
            entry('clause', r.item.id, localizedTitle(r.item.title_en, r.item.title_ar), '/lex/clause-library'),
          );
        },
      },
      {
        key: 'signatures',
        product: 'lex',
        permission: 'lex:read',
        type: 'signature',
        fetch: async (q) => {
          const res = await enterpriseApi.lex.listSignatures({ page: 1, per_page: 5, search: q, order: 'desc' });
          return res.data.map((s) => entry('signature', s.id, s.title, '/lex/signatures'));
        },
      },
      {
        key: 'library',
        product: 'lex',
        permission: 'lex:read',
        type: 'library',
        fetch: async (q) => {
          const res = await enterpriseApi.lex.referenceLibrary.list({ page: 1, per_page: 5, search: q, order: 'desc' });
          return res.data.map((d) =>
            entry('library', d.id, localizedTitle(d.title_en, d.title_ar), `/lex/library/${d.id}`),
          );
        },
      },
      {
        key: 'reports',
        product: 'visus',
        permission: 'visus:read',
        type: 'report',
        fetch: async (q) => {
          const res = await enterpriseApi.visus.listReports({ page: 1, per_page: 5, search: q, order: 'desc' });
          return res.data.map((r) => entry('report', r.id, r.name, '/visus/reports'));
        },
      },
      {
        key: 'dashboards',
        product: 'visus',
        permission: 'visus:read',
        type: 'dashboard',
        fetch: async (q) => {
          const res = await enterpriseApi.visus.listDashboards({ page: 1, per_page: 5, search: q, order: 'desc' });
          return res.data.map((d) => entry('dashboard', d.id, d.name, `/visus/dashboards/${d.id}`));
        },
      },
      {
        key: 'data-sources',
        product: 'data',
        permission: 'data:read',
        type: 'source',
        fetch: async (q) => {
          const res = await dataSuiteApi.listSources({ page: 1, per_page: 5, search: q, order: 'desc' });
          return res.data.map((s) => entry('source', s.id, s.name, `/data/sources/${s.id}`));
        },
      },
      {
        key: 'pipelines',
        product: 'data',
        permission: 'data:read',
        type: 'pipeline',
        fetch: async (q) => {
          const res = await dataSuiteApi.listPipelines({ page: 1, per_page: 5, search: q, order: 'desc' });
          return res.data.map((p) => entry('pipeline', p.id, p.name, `/data/pipelines/${p.id}`));
        },
      },
      {
        // Verified: /cyber/alerts page passes `search` through
        // flattenAlertFetchParams to GET /api/v1/cyber/alerts.
        key: 'cyber-alerts',
        product: 'cyber',
        permission: 'cyber:read',
        type: 'alert',
        fetch: async (q) => {
          const res = await apiGet<PaginatedResponse<CyberAlert>>(API_ENDPOINTS.CYBER_ALERTS, {
            page: 1,
            per_page: 5,
            search: q,
          });
          return res.data.map((a) => entry('alert', a.id, a.title, `/cyber/alerts/${a.id}`));
        },
      },
      {
        // Verified: /cyber/assets page passes `search` through
        // flattenAssetFetchParams to GET /api/v1/cyber/assets.
        key: 'cyber-assets',
        product: 'cyber',
        permission: 'cyber:read',
        type: 'asset',
        fetch: async (q) => {
          const res = await apiGet<PaginatedResponse<CyberAsset>>(API_ENDPOINTS.CYBER_ASSETS, {
            page: 1,
            per_page: 5,
            search: q,
          });
          return res.data.map((a) => entry('asset', a.id, a.name, `/cyber/assets/${a.id}`));
        },
      },
      {
        // Verified: /admin/users page's fetchUsers passes `search` to
        // GET /api/v1/users. No user detail route exists, so results deep-link
        // to the users table pre-filtered via the URL `search` param (which
        // useDataTable reads back).
        key: 'admin-users',
        product: 'platform',
        permission: 'users:read',
        type: 'user',
        fetch: async (q) => {
          const res = await apiGet<PaginatedResponse<User>>('/api/v1/users', {
            page: 1,
            per_page: 5,
            search: q,
          });
          return res.data.map((u) => {
            const name = u.full_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;
            return entry(
              'user',
              u.id,
              name,
              `/admin/users?search=${encodeURIComponent(u.email)}`,
              [u.email.toLowerCase()],
            );
          });
        },
      },
      {
        // Verified: /admin/tenants page's fetchTenants passes `search` to
        // GET /api/v1/tenants; detail route /admin/tenants/[tenantId] exists.
        key: 'admin-tenants',
        product: 'platform',
        permission: 'admin:tenants',
        type: 'tenant',
        fetch: async (q) => {
          const res = await apiGet<PaginatedResponse<Tenant>>('/api/v1/tenants', {
            page: 1,
            per_page: 5,
            search: q,
          });
          return res.data.map((t) =>
            entry('tenant', t.id, t.name, `/admin/tenants/${t.id}`, [t.slug.toLowerCase()]),
          );
        },
      },
    ];
  }, [text, locale]);
}

export function CommandPalette() {
  useCommandPalette(); // register global Cmd+K listener
  const { open, query, setQuery, close } = useCommandPaletteStore();
  const registeredCommands = useCommandPaletteStore((s) => s.commands);
  const { hasPermission, user, permissionsVersion } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const stickySegment = useStickySuiteSegment(pathname);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const { nav, shell } = useNavigationLabels();
  const { locale } = useLocaleOrDefault();
  const text = PALETTE_TEXT[locale] ?? PALETTE_TEXT.en;
  const listboxId = useId();
  const optionId = (idx: number) => `${listboxId}-option-${idx}`;
  const groupLabelId = (groupId: string) => `${listboxId}-group-${groupId}`;

  const { items: recentItems } = useRecentItems();
  const { isFavorite, toggle: toggleFavorite, favorites } = useFavorites();

  // SUITES is the existing subscription/access registry used by the suite
  // switcher and route shell. Subscribe to both permission hydration signals:
  // hasPermission is stable and would not invalidate this memo on its own.
  const accessibleProductFamilies = useMemo(
    () =>
      SUITES.filter((suite) => canAccessWith(hasPermission, suite.permission)).map((suite) =>
        familyOf(suite.segment),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- user + permissionsVersion are the reactive permission signals.
    [hasPermission, user, permissionsVersion],
  );
  const activeProduct = useMemo(
    () => resolvePaletteProductScope(pathname, stickySegment, accessibleProductFamilies),
    [pathname, stickySegment, accessibleProductFamilies],
  );
  const hrefIsInScope = useCallback(
    (href: string) => isPaletteHrefInScope(href, activeProduct, accessibleProductFamilies),
    [activeProduct, accessibleProductFamilies],
  );

  const navigationLabel = text.groups.navigation;
  const navEntries = useMemo(
    () => buildNavEntries(hasPermission, nav, navigationLabel).filter((entry) => hrefIsInScope(entry.href)),
    [hasPermission, nav, navigationLabel, hrefIsInScope],
  );
  const commandEntries = useMemo(
    () =>
      Object.values(registeredCommands)
        .map(commandToEntry)
        .filter((entry) => !entry.href || hrefIsInScope(entry.href)),
    [registeredCommands, hrefIsInScope],
  );
  const recentEntries = useMemo<PaletteEntry[]>(
    () =>
      recentItems.filter((item) => hrefIsInScope(item.href)).map((item) => ({
        id: `recent-${item.href}`,
        label: item.title,
        section: text.types[item.type] ?? text.types.other,
        icon: TYPE_ICONS[item.type] ?? Clock,
        href: item.href,
        entityType: item.type,
        entityId: item.id,
      })),
    [recentItems, text, hrefIsInScope],
  );
  const favoriteEntries = useMemo<PaletteEntry[]>(
    () =>
      favorites.filter((item) => hrefIsInScope(item.href)).map((item) => ({
        id: `favorite-${item.href}`,
        label: item.title,
        section: text.types[item.type] ?? text.types.other,
        icon: TYPE_ICONS[item.type] ?? Star,
        href: item.href,
        entityType: item.type,
        entityId: item.id,
      })),
    [favorites, text, hrefIsInScope],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const debouncedQuery = useDebounce(normalizedQuery, SEARCH_DEBOUNCE_MS);
  const recordSearchEnabled = open && debouncedQuery.length >= MIN_SEARCH_LENGTH;

  const allSources = useSearchSources(text, locale === 'ar' ? 'ar' : 'en');
  const sources = useMemo(
    () =>
      allSources.filter((source) =>
        isPaletteSearchSourceInScope(source.product, activeProduct, accessibleProductFamilies),
      ),
    [allSources, activeProduct, accessibleProductFamilies],
  );
  const searchQueries = useQueries({
    queries: sources.map((source) => ({
      queryKey: ['command-palette', source.key, debouncedQuery] as const,
      queryFn: () => source.fetch(debouncedQuery),
      enabled: recordSearchEnabled && hasPermission(source.permission),
      staleTime: 30_000,
    })),
  });
  const searchResults = useMemo(
    () => searchQueries.flatMap((result) => result.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources.map((source) => source.key).join(','), searchQueries.map((result) => result.dataUpdatedAt).join(',')],
  );
  const isSearching =
    recordSearchEnabled && searchQueries.some((result) => result.isLoading && result.isFetching);

  // ---- Section assembly ----------------------------------------------------
  const groups = useMemo<PaletteGroup[]>(() => {
    const list: PaletteGroup[] = [];
    const push = (id: string, label: string, entries: PaletteEntry[]) => {
      if (entries.length > 0) list.push({ id, label, entries });
    };

    if (!normalizedQuery) {
      push('recent', text.groups.recent, recentEntries.slice(0, 6));
      push('favorites', text.groups.favorites, favoriteEntries.slice(0, 6));
      push('navigation', text.groups.navigation, navEntries.slice(0, 8));
      push('actions', text.groups.actions, commandEntries.filter((e) => !e.entityType).slice(0, 8));
      return list;
    }

    push(
      'recent',
      text.groups.recent,
      recentEntries.filter((e) => entryMatches(e, normalizedQuery)).slice(0, 4),
    );
    push(
      'favorites',
      text.groups.favorites,
      favoriteEntries.filter((e) => entryMatches(e, normalizedQuery)).slice(0, 4),
    );
    push(
      'navigation',
      text.groups.navigation,
      navEntries.filter((e) => entryMatches(e, normalizedQuery)).slice(0, 6),
    );
    // Registered commands without entity metadata are actions; entity-typed
    // registered commands (e.g. lex case/request search results) are merged
    // into the typed result buckets below.
    const commandMatches = commandEntries.filter((e) => entryMatches(e, normalizedQuery));
    push('actions', text.groups.actions, commandMatches.filter((e) => !e.entityType).slice(0, 6));

    // Search results, grouped by type (each entry's `section` is its type label).
    const buckets = new Map<string, PaletteEntry[]>();
    for (const e of [...commandMatches.filter((entry) => entry.entityType), ...searchResults]) {
      const bucket = buckets.get(e.section);
      if (bucket) bucket.push(e);
      else buckets.set(e.section, [e]);
    }
    for (const [label, entries] of buckets) {
      push(`results-${label}`, label, entries.slice(0, 5));
    }
    return list;
  }, [normalizedQuery, text, recentEntries, favoriteEntries, navEntries, commandEntries, searchResults]);

  // Flat list for keyboard navigation + per-group offsets for option ids.
  const { flat, renderGroups } = useMemo(() => {
    let offset = 0;
    const withOffsets = groups.map((group) => {
      const g = { ...group, offset };
      offset += group.entries.length;
      return g;
    });
    return { flat: groups.flatMap((group) => group.entries), renderGroups: withOffsets };
  }, [groups]);

  const select = useCallback(
    (entry: PaletteEntry) => {
      // Selection hands focus ownership to the destination route/action. Do
      // not restore focus to the original launcher: the Watheeq search field
      // intentionally opens this palette on focus, so restoring it here would
      // immediately reopen the dialog and obscure the navigation transition.
      // Escape/backdrop dismissal still restores focus through the effect
      // below because those paths do not clear triggerRef.
      triggerRef.current = null;
      close();
      if (entry.run) {
        entry.run();
        return;
      }
      if (entry.href) {
        // Selecting an entity result feeds the Recent section (item 39).
        if (entry.entityType && entry.entityId) {
          recordVisit({
            type: entry.entityType,
            id: entry.entityId,
            title: entry.label,
            href: entry.href,
          });
        }
        router.push(entry.href);
      }
    },
    [close, router],
  );

  useEffect(() => {
    if (open) {
      // Remember the element that had focus so we can restore it on close.
      triggerRef.current = document.activeElement as HTMLElement | null;
      setTimeout(() => inputRef.current?.focus(), 50);
      setActiveIdx(0);
    } else if (triggerRef.current) {
      // Return focus to the invoking element when the palette closes.
      triggerRef.current.focus?.();
      triggerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Keep the active option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIdx))}`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flat[activeIdx]) {
      select(flat[activeIdx]);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/50 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-lg rounded-xl border bg-popover shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={shell('shell.commandPalette')}
        aria-modal="true"
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={shell('shell.searchPagesAndActions')}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label={shell('shell.search')}
            role="combobox"
            aria-expanded
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-activedescendant={flat[activeIdx] ? optionId(activeIdx) : undefined}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              aria-label={shell('shell.clearSearch')}
              type="button"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={shell('shell.commandPalette')}
          className="max-h-80 overflow-y-auto py-2"
        >
          {flat.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {normalizedQuery && isSearching ? (
                text.searching
              ) : (
                <>
                  {shell('shell.noResultsFor')} &ldquo;{query}&rdquo;
                </>
              )}
            </p>
          ) : (
            renderGroups.map((group) => (
              <div key={group.id} role="group" aria-labelledby={groupLabelId(group.id)}>
                <div
                  id={groupLabelId(group.id)}
                  role="presentation"
                  className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {group.label}
                </div>
                {group.entries.map((entry, i) => {
                  const idx = group.offset + i;
                  const Icon = entry.icon;
                  const starred = entry.href ? isFavorite(entry.href) : false;
                  return (
                    <div
                      key={entry.id}
                      id={optionId(idx)}
                      role="option"
                      aria-selected={idx === activeIdx}
                      onClick={() => select(entry)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={cn(
                        'group flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-start text-sm transition-colors',
                        idx === activeIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                      {entry.section && entry.section !== group.label && (
                        <span className="shrink-0 text-xs text-muted-foreground">{entry.section}</span>
                      )}
                      {entry.href && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(favoriteOf(entry as PaletteEntry & { href: string }));
                          }}
                          aria-label={starred ? text.removeFavorite : text.addFavorite}
                          aria-pressed={starred}
                          className={cn(
                            'shrink-0 rounded-sm p-1 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            starred
                              ? 'text-primary opacity-100'
                              : cn(
                                  'text-muted-foreground hover:text-foreground',
                                  idx === activeIdx
                                    ? 'opacity-100'
                                    : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                                ),
                          )}
                        >
                          <Star className={cn('h-3.5 w-3.5', starred && 'fill-current')} aria-hidden />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Async result-count announcer for screen readers (async record
            queries update the list after the user has stopped typing). */}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {normalizedQuery
            ? flat.length === 0
              ? isSearching
                ? text.searching
                : `${shell('shell.noResultsFor')} ${query}`
              : String(flat.length)
            : ''}
        </div>

        {/* Footer hint */}
        <div className="border-t px-4 py-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{shell('shell.keyboardNavigate')}</span>
          <span>{shell('shell.keyboardOpen')}</span>
          <span>{shell('shell.keyboardClose')}</span>
        </div>
      </div>
    </div>
  );
}
