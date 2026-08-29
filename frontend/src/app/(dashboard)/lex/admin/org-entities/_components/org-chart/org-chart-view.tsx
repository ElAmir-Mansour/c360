'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Network } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexAdminApi, type OrgEntity } from '@/lib/lex/admin';
import {
  buildDatum,
  collapsibleIds,
  computeLayout,
  indexById,
} from '../../_lib/org-chart-layout';
import { orgChartLabels } from '../../_lib/org-chart-i18n';
import { exportPng, exportSvg, printChart } from '../../_lib/org-chart-export';
import { OrgChartToolbar } from './org-chart-toolbar';
import { OrgChartCanvas, type OrgChartCanvasHandle } from './org-chart-canvas';

interface OrgChartViewProps {
  /** When true, drag-to-reparent is enabled; otherwise the chart is read-only. */
  canWrite?: boolean;
}

interface PendingReparent {
  dragged: OrgEntity;
  target: OrgEntity;
}

/**
 * Self-contained interactive org chart. Fetches the full org-entity registry,
 * lays it out as a tidy tree, and renders a zoomable / pannable / collapsible
 * canvas with drag-to-reparent, search-to-center, and SVG/PNG/print export.
 *
 * Owns its own loading / empty / error states and its own react-query cache
 * entry, so the host page only needs to mount it with a `canWrite` flag.
 */
export default function OrgChartView({ canWrite = false }: OrgChartViewProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const { locale, direction } = useLocaleOrDefault();
  const t = locale === 'ar' ? orgChartLabels.ar : orgChartLabels.en;

  const canvasRef = useRef<OrgChartCanvasHandle>(null);

  const query = useQuery({
    queryKey: ['lex-admin-org-entities', 'chart'],
    queryFn: () => lexAdminApi.listOrgEntities({ page: 1, per_page: 500 }),
  });

  const entities = useMemo<OrgEntity[]>(() => query.data?.data ?? [], [query.data]);

  /* ---- collapse / expand state ---------------------------------------- */
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const toggleNode = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedIds(new Set(collapsibleIds(entities)));
  }, [entities]);

  const expandAll = useCallback(() => setCollapsedIds(new Set()), []);

  /* ---- layout ---------------------------------------------------------- */
  const byId = useMemo(() => indexById(entities), [entities]);
  const { root, hasVirtualRoot } = useMemo(
    () => buildDatum(entities, byId),
    [entities, byId],
  );
  const layout = useMemo(
    () => computeLayout(root, collapsedIds, hasVirtualRoot),
    [root, collapsedIds, hasVirtualRoot],
  );

  /* ---- search ---------------------------------------------------------- */
  const [searchValue, setSearchValue] = useState('');
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const findMatch = useCallback(
    (term: string): OrgEntity | undefined => {
      const q = term.trim().toLowerCase();
      if (!q) return undefined;
      return entities.find((e) => {
        const en = (e.name?.en ?? '').toLowerCase();
        const ar = e.name?.ar ?? '';
        return (
          e.code.toLowerCase().includes(q) ||
          en.includes(q) ||
          ar.includes(term.trim())
        );
      });
    },
    [entities],
  );

  const searchMatched = useMemo(
    () => (searchValue.trim() ? Boolean(findMatch(searchValue)) : true),
    [searchValue, findMatch],
  );

  const submitSearch = useCallback(() => {
    const match = findMatch(searchValue);
    if (!match) {
      setHighlightId(null);
      return;
    }
    // Reveal the match by expanding any collapsed ancestor along its path.
    setCollapsedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const ancestor of match.path ?? []) next.delete(ancestor);
      return next;
    });
    setHighlightId(match.id);
    // Defer centering until the (possibly re-expanded) layout has settled.
    requestAnimationFrame(() => canvasRef.current?.centerOn(match.id));
  }, [findMatch, searchValue]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value);
    if (!value.trim()) setHighlightId(null);
  }, []);

  /* ---- reparent mutation ---------------------------------------------- */
  const [pending, setPending] = useState<PendingReparent | null>(null);

  const reparent = useMutation({
    mutationFn: ({ dragged, target }: PendingReparent) =>
      lexAdminApi.updateOrgEntity(dragged.id, { parent_id: target.id }),
    onSuccess: async () => {
      showSuccess(t.reparent.success);
      setPending(null);
      await qc.invalidateQueries({ queryKey: ['lex-admin-org-entities'] });
    },
    onError: (err) => {
      showApiError(err);
      setPending(null);
    },
  });

  const handleReparentRequest = useCallback(
    (draggedId: string, targetId: string) => {
      const dragged = byId.get(draggedId);
      const target = byId.get(targetId);
      if (dragged && target) setPending({ dragged, target });
    },
    [byId],
  );

  /* ---- export ---------------------------------------------------------- */
  const handleExportSvg = useCallback(
    () => exportSvg(canvasRef.current?.getSvg() ?? null, 'lex-org-chart.svg'),
    [],
  );
  const handleExportPng = useCallback(() => {
    exportPng(canvasRef.current?.getSvg() ?? null, 'lex-org-chart.png').catch(showApiError);
  }, []);

  /* ---- render states --------------------------------------------------- */
  if (query.isLoading) {
    return (
      <SectionCard title={t.title} description={t.description}>
        <LoadingSkeleton variant="chart" label={t.loading} />
      </SectionCard>
    );
  }

  if (query.isError) {
    return (
      <SectionCard title={t.title} description={t.description}>
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden />
          </div>
          <h3 className="mb-1 text-base font-semibold">{t.errorTitle}</h3>
          <p className="mb-5 max-w-sm text-sm text-muted-foreground">{t.errorDescription}</p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            {t.retry}
          </Button>
        </div>
      </SectionCard>
    );
  }

  if (entities.length === 0) {
    return (
      <SectionCard title={t.title} description={t.description}>
        <EmptyState icon={Network} title={t.emptyTitle} description={t.emptyDescription} />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={t.title}
      description={t.description}
      contentClassName="space-y-4"
    >
      <OrgChartToolbar
        t={t}
        canWrite={canWrite}
        searchValue={searchValue}
        searchMatched={searchMatched}
        onSearchChange={handleSearchChange}
        onSearchSubmit={submitSearch}
        onZoomIn={() => canvasRef.current?.zoomIn()}
        onZoomOut={() => canvasRef.current?.zoomOut()}
        onFit={() => canvasRef.current?.fit()}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onExportSvg={handleExportSvg}
        onExportPng={handleExportPng}
        onPrint={printChart}
      />

      <OrgChartCanvas
        ref={canvasRef}
        layout={layout}
        entities={entities}
        t={t}
        locale={locale}
        direction={direction}
        canWrite={canWrite}
        highlightId={highlightId}
        onToggle={toggleNode}
        onOpen={(id) => router.push(`/lex/admin/org-entities/${id}`)}
        onReparentRequest={handleReparentRequest}
      />

      {/* Reparent confirmation */}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.reparent.title}</DialogTitle>
            <DialogDescription>
              {pending
                ? t.reparent.body(
                    resolveLocalized(pending.dragged.name, locale) || pending.dragged.code,
                    resolveLocalized(pending.target.name, locale) || pending.target.code,
                  )
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={reparent.isPending}>
              {t.reparent.cancel}
            </Button>
            <Button
              onClick={() => pending && reparent.mutate(pending)}
              disabled={reparent.isPending}
            >
              {t.reparent.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
