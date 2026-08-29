'use client';

import { resolveLocalized } from '@/lib/i18n/localized';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import type { AppDirection, AppLocale } from '@/lib/i18n';
import type { OrgEntity } from '@/lib/lex/admin';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  isReparentForbidden,
  orthogonalConnector,
  type OrgLayout,
  type PositionedNode,
} from '../../_lib/org-chart-layout';
import type { OrgChartLabels } from '../../_lib/org-chart-i18n';
import { OrgChartNode } from './org-chart-node';

export interface OrgChartCanvasHandle {
  /** Live SVG element, for export. */
  getSvg: () => SVGSVGElement | null;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Reset pan/zoom so the whole tree fits the viewport. */
  fit: () => void;
  /** Center a node by id at the current (or a sensible) zoom. */
  centerOn: (id: string) => void;
}

interface OrgChartCanvasProps {
  layout: OrgLayout;
  entities: OrgEntity[];
  t: OrgChartLabels;
  locale: AppLocale;
  direction: AppDirection;
  canWrite: boolean;
  highlightId: string | null;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  /** Fired with a valid (non-cyclic) reparent request for confirmation. */
  onReparentRequest: (draggedId: string, targetId: string) => void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
const ZOOM_STEP = 1.2;

interface Transform {
  x: number;
  y: number;
  k: number;
}

/**
 * The zoomable / pannable SVG canvas. Manual transform state on an inner <g>
 * keeps it framework-light and export-friendly (the live SVG is what we
 * serialise). Pan = drag the background; zoom = wheel or imperative controls.
 * Nodes live in <foreignObject> so the HTML cards render and export crisply.
 */
export const OrgChartCanvas = forwardRef<OrgChartCanvasHandle, OrgChartCanvasProps>(
  function OrgChartCanvas(
    {
      layout,
      entities,
      t,
      locale,
      direction,
      canWrite,
      highlightId,
      onToggle,
      onOpen,
      onReparentRequest,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
    const [viewport, setViewport] = useState({ width: 800, height: 560 });
    const [activeDragId, setActiveDragId] = useState<string | null>(null);

    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    );

    const nodeById = useMemo(() => {
      const map = new Map<string, PositionedNode>();
      for (const n of layout.nodes) map.set(n.id, n);
      return map;
    }, [layout.nodes]);

    /* ---- viewport sizing ------------------------------------------------- */
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const update = () =>
        setViewport({ width: el.clientWidth, height: el.clientHeight });
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    /* ---- fit-to-view ----------------------------------------------------- */
    const fit = useCallback(() => {
      const { width: bw, height: bh, minX, minY } = layout.bounds;
      const vw = viewport.width || 800;
      const vh = viewport.height || 560;
      if (bw <= 0 || bh <= 0) {
        setTransform({ x: 0, y: 0, k: 1 });
        return;
      }
      const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(vw / bw, vh / bh)));
      const x = (vw - bw * k) / 2 - minX * k;
      const y = (vh - bh * k) / 2 - minY * k;
      setTransform({ x, y, k });
    }, [layout.bounds, viewport.width, viewport.height]);

    // Auto-fit on first meaningful layout / viewport.
    const didFit = useRef(false);
    useEffect(() => {
      if (!didFit.current && layout.nodes.length > 0 && viewport.width > 0) {
        fit();
        didFit.current = true;
      }
    }, [fit, layout.nodes.length, viewport.width]);

    const zoomBy = useCallback(
      (factor: number, originX?: number, originY?: number) => {
        setTransform((prev) => {
          const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.k * factor));
          if (k === prev.k) return prev;
          const ox = originX ?? viewport.width / 2;
          const oy = originY ?? viewport.height / 2;
          // Keep the zoom origin point stationary.
          const x = ox - ((ox - prev.x) * k) / prev.k;
          const y = oy - ((oy - prev.y) * k) / prev.k;
          return { x, y, k };
        });
      },
      [viewport.width, viewport.height],
    );

    const centerOn = useCallback(
      (id: string) => {
        const node = nodeById.get(id);
        if (!node) return;
        setTransform((prev) => {
          const k = Math.max(prev.k, 0.85);
          return {
            k,
            x: viewport.width / 2 - node.x * k,
            y: viewport.height / 2 - node.y * k,
          };
        });
      },
      [nodeById, viewport.width, viewport.height],
    );

    useImperativeHandle(
      ref,
      () => ({
        getSvg: () => svgRef.current,
        zoomIn: () => zoomBy(ZOOM_STEP),
        zoomOut: () => zoomBy(1 / ZOOM_STEP),
        fit,
        centerOn,
      }),
      [zoomBy, fit, centerOn],
    );

    /* ---- wheel zoom ------------------------------------------------------ */
    const handleWheel = useCallback(
      (e: React.WheelEvent) => {
        e.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        const ox = rect ? e.clientX - rect.left : undefined;
        const oy = rect ? e.clientY - rect.top : undefined;
        zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, ox, oy);
      },
      [zoomBy],
    );

    /* ---- background pan -------------------------------------------------- */
    const panState = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
    const [panning, setPanning] = useState(false);

    const onBgPointerDown = useCallback(
      (e: React.PointerEvent) => {
        // Only start a pan from the background layer (not a node card).
        if ((e.target as HTMLElement).closest('[data-org-node]')) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        panState.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
        setPanning(true);
      },
      [transform.x, transform.y],
    );

    const onBgPointerMove = useCallback((e: React.PointerEvent) => {
      const p = panState.current;
      if (!p) return;
      setTransform((prev) => ({
        ...prev,
        x: p.tx + (e.clientX - p.x),
        y: p.ty + (e.clientY - p.y),
      }));
    }, []);

    const onBgPointerUp = useCallback((e: React.PointerEvent) => {
      panState.current = null;
      setPanning(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* no-op */
      }
    }, []);

    /* ---- drag-to-reparent ------------------------------------------------ */
    const forbiddenTargets = useMemo(() => {
      if (!activeDragId) return new Set<string>();
      const set = new Set<string>();
      for (const n of layout.nodes) {
        if (isReparentForbidden(activeDragId, n.id, entities)) set.add(n.id);
      }
      return set;
    }, [activeDragId, entities, layout.nodes]);

    const handleDragStart = useCallback((e: DragStartEvent) => {
      setActiveDragId(String(e.active.id));
    }, []);

    const handleDragEnd = useCallback(
      (e: DragEndEvent) => {
        const draggedId = String(e.active.id);
        const targetId = e.over ? String(e.over.id) : null;
        setActiveDragId(null);
        if (!targetId || targetId === draggedId) return;
        if (isReparentForbidden(draggedId, targetId, entities)) return;
        onReparentRequest(draggedId, targetId);
      },
      [entities, onReparentRequest],
    );

    const activeEntity = activeDragId
      ? nodeById.get(activeDragId)?.entity ?? null
      : null;

    return (
      <div
        ref={containerRef}
        dir={direction}
        className={cn(
          'relative h-[clamp(420px,62vh,760px)] w-full overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_1px_1px,theme(colors.border)_1px,transparent_0)] [background-size:22px_22px]',
          panning ? 'cursor-grabbing' : 'cursor-grab',
        )}
        onWheel={handleWheel}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        onPointerLeave={onBgPointerUp}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragId(null)}
        >
          <svg
            ref={svgRef}
            className="absolute inset-0 h-full w-full select-none"
            viewBox={`0 0 ${viewport.width} ${viewport.height}`}
            role="img"
            aria-label={t.title}
          >
            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
              {/* Connectors */}
              <g fill="none" stroke="currentColor" className="text-border" strokeWidth={1.5}>
                {layout.edges.map((edge) => (
                  <path key={edge.id} d={orthogonalConnector(edge)} />
                ))}
              </g>

              {/* Node cards */}
              {layout.nodes.map((node) => (
                <foreignObject
                  key={node.id}
                  x={node.x - NODE_WIDTH / 2}
                  y={node.y - NODE_HEIGHT / 2}
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT + 16 /* room for the toggle pill overhang */}
                  style={{ overflow: 'visible' }}
                >
                  <div data-org-node={node.id} dir={direction}>
                    <OrgChartNode
                      node={node}
                      t={t}
                      locale={locale}
                      canWrite={canWrite}
                      highlighted={highlightId === node.id}
                      dragActive={activeDragId !== null}
                      dropForbidden={forbiddenTargets.has(node.id)}
                      onToggle={onToggle}
                      onOpen={onOpen}
                    />
                  </div>
                </foreignObject>
              ))}
            </g>
          </svg>

          <DragOverlay dropAnimation={null}>
            {activeEntity ? (
              <div
                style={{ width: NODE_WIDTH }}
                className="rounded-xl border border-primary/40 bg-card p-3 shadow-lg"
              >
                <span className="block font-mono text-caption text-muted-foreground">
                  {activeEntity.code}
                </span>
                <span className="block truncate text-sm font-semibold" dir="auto">
                  {resolveLocalized(activeEntity.name, locale) || activeEntity.code}
                </span>
                <span className="mt-1 block text-caption text-muted-foreground">
                  {t.node.dragHint}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    );
  },
);
