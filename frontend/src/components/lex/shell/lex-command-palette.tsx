'use client';

/**
 * Lex command-palette DELEGATE (thin contributor — no UI of its own).
 *
 * The dashboard shell mounts ONE global `<CommandPalette />` (Cmd/Ctrl+K) that
 * renders entries from `useCommandPaletteStore`. Rather than mount a second
 * palette, this component *delegates* the lex command set into that shared
 * store while the user is anywhere under `/lex`:
 *
 *   1. Jump-to-domain commands for every shell route (bilingual, lex-scoped
 *      labels) — registered statically, surfaced in the palette's Actions group.
 *   2. Quick actions: New request, New case, AI drafting, Export.
 *   3. A search section that debounces the live palette query and registers
 *      result commands for lex cases + legal requests (the two record types the
 *      global palette's own async search does not already cover; contracts /
 *      matters / clauses / signatures already come from the global palette).
 *      Results carry `entityType`/`entityId`, so the global palette groups them
 *      under their typed buckets and selecting/starring them feeds the shared
 *      Recent/Favorites sections.
 *
 * Commands are removed again on unmount (the store returns an unregister fn), so
 * leaving `/lex` cleans up. All registrations are id-stable, so re-running on
 * locale/query change simply replaces in place. Data failures are swallowed —
 * the palette must never throw.
 */

import { useEffect, useRef, useState } from 'react';
import { Gavel, Inbox, Sparkles, Download, FilePlus2, type LucideIcon } from 'lucide-react';
import {
  useCommandPaletteStore,
  type PaletteCommand,
} from '@/stores/command-palette-store';
import { useLocale } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { canAccessWith } from '@/lib/permissions';
import { resolveLocalized } from '@/lib/i18n/localized';
import { casesApi } from '@/lib/lex/cases';
import { lexRequestsApi } from '@/lib/lex/requests';
import { LEX_NAV_ROUTES } from './lex-routes';
import { useLexShellLabels } from './lex-shell-labels';

const SEARCH_DEBOUNCE_MS = 220;
const MIN_QUERY = 2;

export function LexCommandPalette() {
  const { locale } = useLocale();
  const labels = useLexShellLabels();
  const { hasPermission } = useAuth();
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands);
  const query = useCommandPaletteStore((s) => s.query);

  // ---- 1 & 2: static jump-to-domain + quick-action commands ---------------
  // Re-registered when the resolved labels (locale) or permissions change.
  // Only routes the persona can access are surfaced — same `canAccessWith`
  // gate the top-nav uses, so the palette never jumps to a denied module.
  useEffect(() => {
    const jump: PaletteCommand[] = LEX_NAV_ROUTES.filter((route) =>
      canAccessWith(hasPermission, route.permission),
    ).map((route) => ({
      id: `lex-jump-${route.id}`,
      label: labels.routes[route.id] ?? route.id,
      section: labels.palette.jumpSection,
      icon: route.icon as LucideIcon,
      href: route.href,
      // Bilingual search index: EN handles + AR synonyms + the localized route
      // label so a query in either language resolves the jump command.
      keywords: [
        'lex',
        'legal',
        'قانوني',
        'وثيق',
        route.id.replace(/_/g, ' '),
        labels.routes[route.id] ?? route.id,
      ],
    }));

    const actions: PaletteCommand[] = [
      {
        id: 'lex-action-new-request',
        label: labels.palette.actions.newRequest,
        section: labels.palette.actionsSection,
        icon: FilePlus2,
        href: '/lex/service-desk/new',
        keywords: ['new', 'request', 'intake', 'service desk', 'جديد', 'طلب', 'استقبال', 'مكتب الخدمة'],
      },
      {
        id: 'lex-action-new-case',
        label: labels.palette.actions.newCase,
        section: labels.palette.actionsSection,
        icon: Gavel,
        href: '/lex/cases',
        keywords: ['new', 'case', 'litigation', 'matter', 'جديد', 'قضية', 'تقاضي', 'ملف'],
      },
      {
        id: 'lex-action-ai-drafting',
        label: labels.palette.actions.aiDrafting,
        section: labels.palette.actionsSection,
        icon: Sparkles,
        href: '/lex/drafting',
        keywords: ['ai', 'draft', 'drafting', 'generate', 'ذكاء اصطناعي', 'مسودة', 'صياغة', 'إنشاء'],
      },
      {
        id: 'lex-action-export',
        label: labels.palette.actions.export,
        section: labels.palette.actionsSection,
        icon: Download,
        href: '/lex/reports',
        keywords: ['export', 'download', 'report', 'تصدير', 'تنزيل', 'تقرير'],
      },
    ];

    return registerCommands([...jump, ...actions]);
  }, [labels, registerCommands, hasPermission]);

  // ---- 3: debounced live search over lex cases + legal requests -----------
  const [debounced, setDebounced] = useState('');
  const unregisterRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    const id = window.setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    // Clear any previously-registered search results when the query is too short.
    if (debounced.length < MIN_QUERY) {
      unregisterRef.current?.();
      unregisterRef.current = null;
      return;
    }

    let cancelled = false;
    const run = async () => {
      const [cases, requests] = await Promise.all([
        casesApi
          .listCases({ page: 1, per_page: 5, search: debounced, order: 'desc' })
          .then((res) => res.data)
          .catch(() => []),
        lexRequestsApi
          .listRequests({ page: 1, per_page: 5, search: debounced, order: 'desc' })
          .then((res) => res.data)
          .catch(() => []),
      ]);
      if (cancelled) return;

      const caseCommands: PaletteCommand[] = cases.map((c) => {
        const title = resolveLocalized(c.title, locale);
        return {
          id: `lex-search-case-${c.id}`,
          label: c.case_number ? `${c.case_number} · ${title}`.trim() : title || c.case_number,
          section: labels.palette.casesSection,
          icon: Gavel,
          href: `/lex/cases/${c.id}`,
          keywords: ['case', 'قضية', c.case_number],
          entityType: 'case' as const,
          entityId: c.id,
        };
      });

      const requestCommands: PaletteCommand[] = requests.map((r) => {
        const title = resolveLocalized(r.title, locale);
        return {
          id: `lex-search-request-${r.id}`,
          label: r.request_number ? `${r.request_number} · ${title}`.trim() : title || r.request_number,
          section: labels.palette.requestsSection,
          icon: Inbox,
          href: `/lex/service-desk/${r.id}`,
          keywords: ['request', 'طلب', r.request_number],
          entityType: 'request' as const,
          entityId: r.id,
        };
      });

      // Replace the previous result batch atomically.
      unregisterRef.current?.();
      unregisterRef.current = registerCommands([...caseCommands, ...requestCommands]);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [debounced, labels, locale, registerCommands]);

  // Final cleanup of any lingering search results on unmount (leaving /lex).
  useEffect(() => () => unregisterRef.current?.(), []);

  return null;
}
