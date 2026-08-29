'use client';

/**
 * NodeMap — ClarioDR recovery-process node map.
 * =============================================
 *
 * A networked visualisation of the recovery process: nodes (sites / services /
 * tasks) and edges (replication / dependency links), with parallel branches and
 * the longest dependency chain ("critical path") emphasised. The visual layer is
 * an SVG laid out with `dagre` (a real layered DAG layout); the layout is
 * deterministic so the picture and its screen-reader alternative agree.
 *
 * Real DR shapes only: built from `DRTopology` (sites + replication edges),
 * a bootgraph boot plan, or a runbook task DAG — mapped via the helpers in
 * `node-map-graph.ts`. The component itself takes the already-generic
 * `NodeMapNode[]` / `NodeMapEdge[]` so it composes over any of them.
 *
 * Accessibility (SVG graphs are NOT keyboard-navigable on their own, WCAG):
 *   - the `<svg>` is `aria-hidden` and paired with an EQUIVALENT, keyboard-
 *     navigable text alternative — a real `<table>` of nodes (kind, status,
 *     depends-on, on-critical-path) plus an ordered critical-path list. Screen
 *     readers and keyboard users get the full graph as structured content.
 *   - status is shown via StatusChip (icon/text + colour, never colour alone).
 *   - <640px reflow: the SVG is horizontally scrollable in a labelled region and
 *     the table collapses to stacked cards (WCAG 1.4.10).
 *   - First-class RTL via logical properties; the SVG is mirrored under RTL with
 *     a flip transform so flow reads start→end in both directions, while text
 *     inside nodes is counter-flipped to stay legible.
 *   - All copy is supplied via `labels` (bilingual-ready).
 *
 * Token-driven only: node fills/strokes use `--ds-*` CSS vars resolved through
 * inline `style` (SVG presentation attributes cannot resolve Tailwind classes),
 * and every Tailwind class is a token-backed key.
 */

import * as React from 'react';
import {
  GitBranch,
  Network,
  Server,
  ListChecks,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusChip } from '@/components/shared/status-chip';
import { EmptyState } from '@/components/common/empty-state';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { fontSize as dsFontSize } from '@/styles/tokens';
import {
  layoutGraph,
  edgePointsToPolyline,
  statusToTone,
  type NodeMapNode,
  type NodeMapEdge,
  type LayoutOptions,
} from './node-map-graph';

/**
 * SVG `<text>` cannot resolve Tailwind classes, so font sizes are read from the
 * type-scale token source of truth (not hardcoded px). Node title → `body`,
 * sublabel → `caption`, status → `overline`.
 */
const NODE_FONT = {
  title: dsFontSize.body[0],
  sublabel: dsFontSize.caption[0],
  status: dsFontSize.overline[0],
} as const;

/** All visible strings — supply localized copy for bilingual / RTL surfaces. */
export interface NodeMapLabels {
  /** Accessible name for the whole figure. */
  figureAriaLabel: string;
  /** Accessible name for the scrollable diagram region. */
  diagramAriaLabel: string;
  /** Heading for the screen-reader / keyboard text alternative. */
  textAlternativeHeading: string;
  /** Intro sentence describing the graph (node + edge counts injected). */
  textAlternativeSummary: (nodeCount: number, edgeCount: number) => string;
  /** Table column headers. */
  node: string;
  kind: string;
  status: string;
  dependsOn: string;
  criticalPath: string;
  /** Critical-path section heading + "on the path" marker. */
  criticalPathHeading: string;
  onCriticalPath: string;
  yes: string;
  no: string;
  none: string;
  /** node-kind display names. */
  kinds: Record<NodeMapNode['kind'], string>;
  /** Empty-state copy. */
  emptyTitle: string;
  emptyDescription: string;
}

export interface NodeMapProps {
  nodes: NodeMapNode[];
  edges: NodeMapEdge[];
  labels: NodeMapLabels;
  /** Map a status token to a localized status label. */
  statusLabel: (status: string) => string;
  title?: string;
  description?: string;
  /** Layout overrides (direction/size). */
  layoutOptions?: LayoutOptions;
  /** Render the page right-to-left (mirrors the SVG flow). */
  rtl?: boolean;
  className?: string;
}

const KIND_ICON: Record<NodeMapNode['kind'], LucideIcon> = {
  site: Network,
  service: Server,
  task: ListChecks,
};

/** Resolve a status token to a token-backed CSS-var colour for SVG fills. */
function statusVarFor(status: string): { fill: string; stroke: string; text: string } {
  const tone = statusToTone(status);
  switch (tone) {
    case 'success':
      return {
        fill: 'hsl(var(--ds-state-success) / 0.12)',
        stroke: 'hsl(var(--ds-state-success))',
        text: 'hsl(var(--ds-text-primary))',
      };
    case 'info':
      return {
        fill: 'hsl(var(--ds-state-info) / 0.12)',
        stroke: 'hsl(var(--ds-state-info))',
        text: 'hsl(var(--ds-text-primary))',
      };
    case 'warning':
      return {
        fill: 'hsl(var(--ds-state-warning) / 0.14)',
        stroke: 'hsl(var(--ds-state-warning))',
        text: 'hsl(var(--ds-text-primary))',
      };
    case 'danger':
      return {
        fill: 'hsl(var(--ds-state-error) / 0.12)',
        stroke: 'hsl(var(--ds-state-error))',
        text: 'hsl(var(--ds-text-primary))',
      };
    default:
      return {
        fill: 'hsl(var(--ds-surface-card))',
        stroke: 'hsl(var(--ds-border-default))',
        text: 'hsl(var(--ds-text-primary))',
      };
  }
}

export function NodeMap({
  nodes: nodesProp,
  edges: edgesProp,
  labels,
  statusLabel,
  title,
  description,
  layoutOptions,
  rtl = false,
  className,
}: NodeMapProps) {
  // Defend against an undefined/null list reaching the view (e.g. when the
  // backing query errored or returned an empty payload): never iterate
  // `undefined`. With empty lists the component renders its `EmptyState`.
  const nodes = nodesProp ?? [];
  const edges = edgesProp ?? [];

  const layout = React.useMemo(
    () => layoutGraph(nodes, edges, layoutOptions),
    [nodes, edges, layoutOptions],
  );

  const nodeById = React.useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n])),
    [layout.nodes],
  );
  const predecessorsById = React.useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of edges) {
      const list = m.get(e.to) ?? [];
      list.push(e.from);
      m.set(e.to, list);
    }
    return m;
  }, [edges]);

  // Unique marker ids — declared before any early return so the Hook order is
  // stable across renders (React rules-of-hooks).
  const arrowId = React.useId();
  const arrowCriticalId = `${arrowId}-cp`;

  if (nodes.length === 0) {
    return (
      <Card className={className}>
        {(title || description) && (
          <CardHeader>
            {title && <CardTitle>{title}</CardTitle>}
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
        )}
        <CardContent>
          <EmptyState
            icon={GitBranch}
            title={labels.emptyTitle}
            description={labels.emptyDescription}
            size="compact"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className="space-y-gutter">
        <figure
          className="m-0"
          role="figure"
          aria-label={labels.figureAriaLabel}
        >
          {/* Visual SVG layer — decorative; the table below is the real content. */}
          <div
            role="region"
            aria-label={labels.diagramAriaLabel}
            tabIndex={0}
            className="w-full overflow-x-auto rounded-card border border-outline-subtle bg-bg-subtle p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            <svg
              role="presentation"
              aria-hidden="true"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              style={{
                maxWidth: '100%',
                height: 'auto',
                transform: rtl ? 'scaleX(-1)' : undefined,
              }}
            >
              <defs>
                <marker
                  id={arrowId}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    fill="hsl(var(--ds-border-strong))"
                  />
                </marker>
                <marker
                  id={arrowCriticalId}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    fill="hsl(var(--ds-state-warning))"
                  />
                </marker>
              </defs>

              {/* Edges (drawn first, under the nodes). */}
              {layout.edges.map((edge) => {
                if (edge.points.length < 2) return null;
                return (
                  <polyline
                    key={edge.id}
                    points={edgePointsToPolyline(edge.points)}
                    fill="none"
                    stroke={
                      edge.onCriticalPath
                        ? 'hsl(var(--ds-state-warning))'
                        : 'hsl(var(--ds-border-strong))'
                    }
                    strokeWidth={edge.onCriticalPath ? 2.5 : 1.5}
                    strokeDasharray={edge.onCriticalPath ? undefined : '4 3'}
                    markerEnd={`url(#${
                      edge.onCriticalPath ? arrowCriticalId : arrowId
                    })`}
                  />
                );
              })}

              {/* Nodes. */}
              {layout.nodes.map((node) => {
                const colors = statusVarFor(node.status);
                const left = node.x - node.width / 2;
                const top = node.y - node.height / 2;
                return (
                  <g
                    key={node.id}
                    transform={
                      rtl
                        ? `translate(${node.x}, ${node.y}) scale(-1, 1) translate(${-node.x}, ${-node.y})`
                        : undefined
                    }
                  >
                    <rect
                      x={left}
                      y={top}
                      width={node.width}
                      height={node.height}
                      rx={12}
                      fill={colors.fill}
                      stroke={
                        node.onCriticalPath
                          ? 'hsl(var(--ds-state-warning))'
                          : colors.stroke
                      }
                      strokeWidth={node.onCriticalPath ? 2.5 : 1.5}
                    />
                    <text
                      x={left + 16}
                      y={top + 28}
                      fill={colors.text}
                      style={{ font: `600 ${NODE_FONT.title} var(--font-sans, sans-serif)` }}
                    >
                      {truncate(node.label, 22)}
                    </text>
                    {node.sublabel ? (
                      <text
                        x={left + 16}
                        y={top + 48}
                        fill="hsl(var(--ds-text-muted))"
                        style={{ font: `400 ${NODE_FONT.sublabel} var(--font-sans, sans-serif)` }}
                      >
                        {truncate(node.sublabel, 26)}
                      </text>
                    ) : null}
                    <text
                      x={left + 16}
                      y={top + 66}
                      fill={colors.stroke}
                      style={{ font: `600 ${NODE_FONT.status} var(--font-sans, sans-serif)` }}
                    >
                      {statusLabel(node.status)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Equivalent accessible text alternative — the REAL keyboard content. */}
          <figcaption className="mt-gutter">
            <h3 className="text-body font-semibold text-content-primary">
              {labels.textAlternativeHeading}
            </h3>
            <p className="mt-1 text-body-sm text-content-secondary">
              {labels.textAlternativeSummary(nodes.length, edges.length)}
            </p>

            {/* Critical-path ordered list. */}
            {layout.criticalPath.length > 0 ? (
              <div className="mt-3">
                <h4 className="flex items-center gap-1.5 text-body-sm font-semibold text-content-primary">
                  <ShieldCheck
                    className="size-4 text-state-warning"
                    aria-hidden="true"
                  />
                  {labels.criticalPathHeading}
                </h4>
                <ol className="mt-2 flex flex-col gap-1">
                  {layout.criticalPath.map((id, i) => {
                    const n = nodeById.get(id);
                    if (!n) return null;
                    return (
                      <li
                        key={id}
                        className="flex items-center gap-2 text-body-sm text-content-secondary"
                      >
                        <span
                          className="inline-flex h-6 min-w-6 items-center justify-center rounded-pill bg-brand-gold-500/20 px-1.5 text-caption font-semibold tabular-nums text-brand-gold-700"
                          aria-hidden="true"
                        >
                          {i + 1}
                        </span>
                        <span className="font-medium text-content-primary">
                          {n.label}
                        </span>
                        <StatusChip
                          tone={statusToTone(n.status)}
                          size="sm"
                          label={statusLabel(n.status)}
                        />
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}

            {/* Full node table — desktop; stacked cards under 640px. */}
            <div className="mt-3 hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-start text-body-sm">
                <caption className="sr-only">
                  {labels.textAlternativeSummary(nodes.length, edges.length)}
                </caption>
                <thead>
                  <tr className="border-b border-outline-subtle text-content-muted">
                    <th scope="col" className="px-3 py-2 text-start font-semibold">
                      {labels.node}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">
                      {labels.kind}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">
                      {labels.status}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">
                      {labels.dependsOn}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">
                      {labels.criticalPath}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {layout.nodes.map((node) => {
                    const KindIcon = KIND_ICON[node.kind];
                    const preds = (predecessorsById.get(node.id) ?? [])
                      .map((p) => nodeById.get(p)?.label ?? p)
                      .join(', ');
                    return (
                      <tr
                        key={node.id}
                        className="border-b border-outline-subtle/60"
                      >
                        <th
                          scope="row"
                          className="px-3 py-2 text-start font-medium text-content-primary"
                        >
                          {node.label}
                        </th>
                        <td className="px-3 py-2 text-content-secondary">
                          <span className="inline-flex items-center gap-1.5">
                            <KindIcon
                              className="size-3.5 text-content-muted"
                              aria-hidden="true"
                            />
                            {labels.kinds[node.kind]}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <StatusChip
                            tone={statusToTone(node.status)}
                            size="sm"
                            label={statusLabel(node.status)}
                          />
                        </td>
                        <td className="px-3 py-2 text-content-secondary">
                          {preds || labels.none}
                        </td>
                        <td className="px-3 py-2 text-content-secondary">
                          {node.onCriticalPath ? labels.yes : labels.no}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Stacked-card reflow under 640px. */}
            <ul className="mt-3 flex flex-col gap-2 sm:hidden">
              {layout.nodes.map((node) => {
                const KindIcon = KIND_ICON[node.kind];
                const preds = (predecessorsById.get(node.id) ?? [])
                  .map((p) => nodeById.get(p)?.label ?? p)
                  .join(', ');
                return (
                  <li
                    key={node.id}
                    className="rounded-card border border-outline-subtle bg-surface-card p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-medium text-content-primary">
                        <KindIcon
                          className="size-3.5 text-content-muted"
                          aria-hidden="true"
                        />
                        {node.label}
                      </span>
                      <StatusChip
                        tone={statusToTone(node.status)}
                        size="sm"
                        label={statusLabel(node.status)}
                      />
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-caption">
                      <div>
                        <dt className="font-semibold uppercase text-content-muted">
                          {labels.kind}
                        </dt>
                        <dd className="text-content-secondary">
                          {labels.kinds[node.kind]}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase text-content-muted">
                          {labels.criticalPath}
                        </dt>
                        <dd className="text-content-secondary">
                          {node.onCriticalPath ? labels.yes : labels.no}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="font-semibold uppercase text-content-muted">
                          {labels.dependsOn}
                        </dt>
                        <dd className="text-content-secondary">
                          {preds || labels.none}
                        </dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          </figcaption>
        </figure>
      </CardContent>
    </Card>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export default NodeMap;
