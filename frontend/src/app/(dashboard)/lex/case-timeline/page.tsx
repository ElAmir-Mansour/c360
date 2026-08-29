'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { History, LayoutGrid, Pause, Search } from 'lucide-react';
import Link from 'next/link';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { SectionCard } from '@/components/suites/section-card';
import { Combobox } from '@/components/shared/forms/combobox';
import { Button } from '@/components/ui/button';
import { LexEmptyState } from '@/components/lex/empty-state';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { settlementsApi } from '@/lib/lex/settlements';
import { CaseTimelinePanel } from '../settlements/_components/case-timeline-panel';
import { useSettlementLabels } from '../settlements/_components/labels';
import { useTimelineExtra } from './_components/labels';
import {
  pushRecentMatter,
  readRecentMatters,
  type RecentMatter,
} from './_components/recent-matters';

/** Build the human-readable label for a matter option / recent chip. */
function matterLabel(title: string, matterNumber?: string | null): string {
  return matterNumber ? `${title} (${matterNumber})` : title;
}

/**
 * Standalone case-timeline workspace: pick a matter, then drive its
 * estimated-duration / external-hold / delay-event timeline via the shared
 * {@link CaseTimelinePanel}. The same panel is embedded on the settlement detail
 * (and is ready to embed on the matter detail) so this route is the
 * navigation-reachable entry point for CAP-084..088.
 *
 * Selection is deep-linkable via `?matterId=` (#17): the param seeds the picker
 * on load and is kept in sync (shallow `router.replace`) as the user picks. The
 * picker also offers quick-filter affordances (#16): recently-viewed chips
 * (localStorage), an "on hold only" toggle that sources options from the
 * cross-matter timeline summary, and last-selected restore when no param is set.
 */
export default function LexCaseTimelinePage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const L = useSettlementLabels();
  const extra = useTimelineExtra();
  const labels = L.timeline;
  // §9 — case-timeline edits (deadlines/holds) are case mutations.
  const canWrite = hasPermission('lex:case:edit');

  const router = useRouter();
  const pathname = usePathname() ?? '/lex/case-timeline';
  const searchParams = useSearchParams();
  const urlMatterId = searchParams?.get('matterId') ?? '';

  const [matterId, setMatterId] = useState(urlMatterId);
  const [onHoldOnly, setOnHoldOnly] = useState(false);
  const [recent, setRecent] = useState<RecentMatter[]>([]);

  // Hydrate recently-viewed matters from localStorage on mount.
  useEffect(() => {
    setRecent(readRecentMatters());
  }, []);

  // Keep local selection in sync with the URL when it changes externally
  // (e.g. browser back/forward, or a deep link from the portfolio dashboard).
  useEffect(() => {
    setMatterId((current) => (current === urlMatterId ? current : urlMatterId));
  }, [urlMatterId]);

  // When there is no `?matterId=` on first load, restore the last-selected
  // matter from the recents list (#16) by writing it into the URL.
  useEffect(() => {
    if (urlMatterId || recent.length === 0) {
      return;
    }
    const last = recent[0];
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('matterId', last.id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run once recents hydrate while no param is set
  }, [recent, urlMatterId]);

  // Default picker source: all matters (searchable).
  const allMattersQuery = useQuery({
    queryKey: ['lex-case-timeline-matter-options'],
    queryFn: () => settlementsApi.searchMatters(''),
    enabled: !onHoldOnly,
  });

  // "On hold only" source: cross-matter timeline summaries filtered to holds.
  const onHoldQuery = useQuery({
    queryKey: ['lex-case-timeline-on-hold-options'],
    queryFn: () =>
      settlementsApi.listMatterTimelines({ on_hold: true, page: 1, per_page: 50 }),
    enabled: onHoldOnly,
  });

  const matterOptions = useMemo(() => {
    if (onHoldOnly) {
      return (onHoldQuery.data?.data ?? []).map((m) => ({
        value: m.matter_id,
        label: matterLabel(m.title, m.matter_number),
      }));
    }
    return (allMattersQuery.data?.data ?? []).map((m) => ({
      value: m.id,
      label: matterLabel(m.title, m.matter_number),
    }));
  }, [onHoldOnly, onHoldQuery.data, allMattersQuery.data]);

  const optionsLoading = onHoldOnly ? onHoldQuery.isLoading : allMattersQuery.isLoading;

  /** Commit a selection: update local state, the URL (#17), and recents (#16). */
  const selectMatter = useCallback(
    (id: string) => {
      setMatterId(id);

      const next = new URLSearchParams(searchParams?.toString() ?? '');
      if (id) {
        next.set('matterId', id);
      } else {
        next.delete('matterId');
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });

      if (id) {
        const opt = matterOptions.find((o) => o.value === id);
        // Prefer the freshly-resolved option label; fall back to an existing
        // recent label (so re-selecting a recent keeps its name) then the id.
        const label =
          opt?.label ?? recent.find((m) => m.id === id)?.label ?? id;
        setRecent(pushRecentMatter({ id, label }));
      }
    },
    [matterOptions, pathname, recent, router, searchParams],
  );

  // Quick-jump chips: the recents that are NOT the current selection.
  const recentChips = useMemo(
    () => recent.filter((m) => m.id !== matterId).slice(0, 5),
    [recent, matterId],
  );

  return (
    <LexRouteGuard route="/lex/case-timeline">
      <div className="space-y-6 motion-safe:animate-fade-up" dir={direction} lang={locale}>
        <PageHeader
          eyebrow={extra.eyebrow}
          title={labels.title}
          description={labels.description}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/lex/case-timeline/portfolio">
                <LayoutGrid className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {labels.dashboard.title}
              </Link>
            </Button>
          }
        />

        <SectionCard
          title={labels.delayEventsTitle}
          description={labels.delayEventsDescription}
          actions={
            <Button
              type="button"
              size="sm"
              variant={onHoldOnly ? 'default' : 'outline'}
              aria-pressed={onHoldOnly}
              onClick={() => setOnHoldOnly((v) => !v)}
            >
              <Pause className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {labels.dashboard.mattersOnHold}
            </Button>
          }
        >
          {optionsLoading ? (
            <LoadingSkeleton variant="list-item" count={1} />
          ) : (
            <div className="space-y-3">
              <div className="max-w-md">
                <Combobox
                  options={matterOptions}
                  value={matterId}
                  onChange={selectMatter}
                  placeholder={labels.title}
                  searchPlaceholder={labels.title}
                  className="w-full"
                />
              </div>

              {recentChips.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <History className="h-3.5 w-3.5" aria-hidden />
                    {extra.recentlyViewed}
                  </span>
                  {recentChips.map((m) => (
                    <Button
                      key={m.id}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2.5 text-xs font-normal duration-fast ease-emphasized"
                      onClick={() => selectMatter(m.id)}
                    >
                      <span className="truncate" dir="auto">{m.label}</span>
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </SectionCard>

        {matterId ? (
          <CaseTimelinePanel matterId={matterId} canWrite={canWrite} />
        ) : (
          <SectionCard title={labels.title} description={labels.description}>
            <LexEmptyState
              icon={Search}
              title={labels.delayEmptyTitle}
              description={extra.empty.pickerHint}
              action={{
                label: labels.dashboard.title,
                icon: LayoutGrid,
                onClick: () => router.push('/lex/case-timeline/portfolio'),
              }}
            />
          </SectionCard>
        )}
      </div>
    </LexRouteGuard>
  );
}
