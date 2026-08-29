/**
 * Pure, side-effect-free org-chart layout helpers.
 *
 * Builds a d3-hierarchy tidy tree from the flat OrgEntity[] registry, keyed on
 * `parent_id` (with `path[]` used as an ancestry oracle for escalation coverage
 * and cycle detection). Supports MULTIPLE roots by stacking them under a single
 * synthetic virtual root so a single tidy-tree pass lays everything out; the
 * virtual root is flagged so the renderer can hide it and stack its children.
 *
 * Nothing here touches React or the DOM — it is unit-testable in isolation and
 * cheap enough to recompute on every collapse/expand for ~200 nodes.
 */
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy';
import type { OrgEntity, OrgRoleKey } from '@/lib/lex/admin';

/** Virtual-root sentinel id; never collides with a real UUID. */
export const VIRTUAL_ROOT_ID = '__org_root__';

/** The three roles that together constitute a "ready" escalation ladder. */
export const ESCALATION_ROLE_KEYS = [
  'section_supervisor',
  'department_manager',
  'shared_services_manager',
] as const;
export type EscalationRoleKey = (typeof ESCALATION_ROLE_KEYS)[number];

/** Node card geometry (px) — drives both layout spacing and SVG rendering. */
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 96;
export const H_GAP = 28; // horizontal gap between sibling cards
export const V_GAP = 64; // vertical gap between generations

export interface EscalationCoverage {
  /** True when all three escalation roles are reachable up the ancestry. */
  ready: boolean;
  /** Escalation roles NOT reachable on this entity or any ancestor. */
  missing: EscalationRoleKey[];
}

/** Datum carried on each hierarchy node. The root carries `virtual: true`. */
export interface OrgChartDatum {
  id: string;
  /** Underlying entity; absent only on the synthetic virtual root. */
  entity?: OrgEntity;
  virtual?: boolean;
  /** Direct children data (pre-collapse), used to seed the d3 hierarchy. */
  children?: OrgChartDatum[];
  /** Locally-computed escalation coverage (absent on the virtual root). */
  coverage?: EscalationCoverage;
}

export interface PositionedNode {
  id: string;
  entity?: OrgEntity;
  virtual: boolean;
  /** Center coordinates from the tidy-tree pass. */
  x: number;
  y: number;
  depth: number;
  parentId: string | null;
  /** Whether this node currently has rendered children (post-collapse). */
  hasChildren: boolean;
  /** Whether this node's subtree is collapsed (children hidden). */
  collapsed: boolean;
  /** Number of direct children in the FULL tree (ignores collapse). */
  totalChildren: number;
  coverage?: EscalationCoverage;
}

export interface PositionedEdge {
  id: string;
  sourceId: string;
  targetId: string;
  /** Endpoints (card-edge anchored) for drawing the connector path. */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export interface OrgLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  /** Bounding box of the laid-out (non-virtual) nodes, in layout space. */
  bounds: { minX: number; minY: number; width: number; height: number };
  /** Whether a synthetic virtual root was injected (multi-root registry). */
  hasVirtualRoot: boolean;
}

/* -------------------------------------------------------------------------- *
 * Indexing & escalation coverage
 * -------------------------------------------------------------------------- */

/** Lookup table keyed by entity id. */
export function indexById(entities: OrgEntity[]): Map<string, OrgEntity> {
  const map = new Map<string, OrgEntity>();
  for (const e of entities) map.set(e.id, e);
  return map;
}

function hasRole(entity: OrgEntity, role: OrgRoleKey): boolean {
  return (entity.roles ?? []).some((r) => r.role_key === role);
}

/**
 * computeCoverage walks `entity` + its ancestors (via `path[]`, root-first
 * ancestor ids) across the loaded set. An escalation role counts as covered if
 * the entity OR any reachable ancestor assigns it. Ancestors missing from the
 * loaded set are skipped (best-effort, mirrors the flat registry view).
 */
export function computeCoverage(
  entity: OrgEntity,
  byId: Map<string, OrgEntity>,
): EscalationCoverage {
  const covered = new Set<EscalationRoleKey>();
  const chain: OrgEntity[] = [entity];
  for (const ancestorId of entity.path ?? []) {
    if (ancestorId === entity.id) continue;
    const ancestor = byId.get(ancestorId);
    if (ancestor) chain.push(ancestor);
  }
  for (const role of ESCALATION_ROLE_KEYS) {
    if (chain.some((node) => hasRole(node, role))) covered.add(role);
  }
  const missing = ESCALATION_ROLE_KEYS.filter((role) => !covered.has(role));
  return { ready: missing.length === 0, missing };
}

/* -------------------------------------------------------------------------- *
 * Descendant / cycle helpers (for drag-to-reparent guards)
 * -------------------------------------------------------------------------- */

/**
 * collectDescendantIds returns the set of ids strictly beneath `rootId`,
 * derived from `parent_id` links (downward) AND `path[]` membership (in case a
 * descendant's parent is absent from the loaded set). Inclusive of nothing —
 * the root itself is excluded.
 */
export function collectDescendantIds(
  rootId: string,
  entities: OrgEntity[],
): Set<string> {
  const childrenOf = new Map<string, OrgEntity[]>();
  for (const e of entities) {
    const key = e.parent_id ?? '';
    if (!key) continue;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), e]);
  }
  const out = new Set<string>();
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    if (out.has(node.id)) continue;
    out.add(node.id);
    stack.push(...(childrenOf.get(node.id) ?? []));
  }
  // Belt-and-suspenders: anything whose path[] contains rootId is a descendant.
  for (const e of entities) {
    if (e.id !== rootId && (e.path ?? []).includes(rootId)) out.add(e.id);
  }
  return out;
}

/**
 * isReparentForbidden returns true when moving `draggedId` under `targetId`
 * would create a cycle (target is the node itself, or a descendant of it) or is
 * a no-op (target is already the current parent).
 */
export function isReparentForbidden(
  draggedId: string,
  targetId: string,
  entities: OrgEntity[],
): boolean {
  if (draggedId === targetId) return true;
  const dragged = entities.find((e) => e.id === draggedId);
  if (dragged && dragged.parent_id === targetId) return true; // no-op
  if ((entities.find((e) => e.id === targetId)?.path ?? []).includes(draggedId)) {
    return true;
  }
  return collectDescendantIds(draggedId, entities).has(targetId);
}

/* -------------------------------------------------------------------------- *
 * Hierarchy assembly
 * -------------------------------------------------------------------------- */

/**
 * buildDatum assembles the nested OrgChartDatum tree from the flat list. Real
 * roots are entities with no parent (or whose parent is absent from the set).
 * When more than one real root exists, they are stacked under a virtual root.
 */
export function buildDatum(
  entities: OrgEntity[],
  byId: Map<string, OrgEntity>,
): { root: OrgChartDatum; hasVirtualRoot: boolean } {
  const childrenOf = new Map<string, OrgEntity[]>();
  const roots: OrgEntity[] = [];
  for (const e of entities) {
    const parent = e.parent_id ?? null;
    if (parent && byId.has(parent)) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), e]);
    } else {
      roots.push(e);
    }
  }
  const sortByCode = (a: OrgEntity, b: OrgEntity) => a.code.localeCompare(b.code);

  const toDatum = (entity: OrgEntity, seen: Set<string>): OrgChartDatum => {
    seen.add(entity.id);
    const kids = (childrenOf.get(entity.id) ?? [])
      .filter((c) => !seen.has(c.id)) // defensive against malformed cycles
      .sort(sortByCode)
      .map((c) => toDatum(c, seen));
    return {
      id: entity.id,
      entity,
      coverage: computeCoverage(entity, byId),
      children: kids.length ? kids : undefined,
    };
  };

  const seen = new Set<string>();
  const rootData = roots.sort(sortByCode).map((r) => toDatum(r, seen));

  if (rootData.length === 1) {
    return { root: rootData[0], hasVirtualRoot: false };
  }
  return {
    root: { id: VIRTUAL_ROOT_ID, virtual: true, children: rootData },
    hasVirtualRoot: true,
  };
}

/* -------------------------------------------------------------------------- *
 * Tidy-tree layout
 * -------------------------------------------------------------------------- */

/**
 * computeLayout runs a d3 tidy-tree pass over the (possibly collapsed) datum,
 * honouring `collapsedIds`. The d3 vertical axis (`depth`) maps to screen Y and
 * the breadth axis to screen X, giving a classic top-down org chart. The
 * virtual root is laid out but excluded from the returned node/edge sets; its
 * children become visual roots.
 */
export function computeLayout(
  rootDatum: OrgChartDatum,
  collapsedIds: Set<string>,
  hasVirtualRoot: boolean,
): OrgLayout {
  // Snapshot full child counts before collapse prunes the hierarchy view.
  const totalChildCount = new Map<string, number>();
  const walk = (d: OrgChartDatum) => {
    totalChildCount.set(d.id, d.children?.length ?? 0);
    d.children?.forEach(walk);
  };
  walk(rootDatum);

  const root = hierarchy<OrgChartDatum>(rootDatum, (d) =>
    collapsedIds.has(d.id) ? undefined : d.children,
  );

  const layout = tree<OrgChartDatum>()
    .nodeSize([NODE_WIDTH + H_GAP, NODE_HEIGHT + V_GAP])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.25));

  const laidOut = layout(root) as HierarchyPointNode<OrgChartDatum>;

  const allNodes = laidOut.descendants();
  const visible = allNodes.filter(
    (n) => !(hasVirtualRoot && n.data.id === VIRTUAL_ROOT_ID),
  );

  const nodes: PositionedNode[] = visible.map((n) => {
    const isVirtualParent = hasVirtualRoot && n.parent?.data.id === VIRTUAL_ROOT_ID;
    return {
      id: n.data.id,
      entity: n.data.entity,
      virtual: Boolean(n.data.virtual),
      x: n.x,
      y: n.y,
      depth: n.depth,
      parentId: isVirtualParent ? null : n.parent?.data.id ?? null,
      hasChildren: (n.children?.length ?? 0) > 0,
      collapsed: collapsedIds.has(n.data.id) && (totalChildCount.get(n.data.id) ?? 0) > 0,
      totalChildren: totalChildCount.get(n.data.id) ?? 0,
      coverage: n.data.coverage,
    };
  });

  const edges: PositionedEdge[] = laidOut
    .links()
    .filter((l) => !(hasVirtualRoot && l.source.data.id === VIRTUAL_ROOT_ID))
    .map((l) => ({
      id: `${l.source.data.id}->${l.target.data.id}`,
      sourceId: l.source.data.id,
      targetId: l.target.data.id,
      sx: l.source.x,
      sy: l.source.y + NODE_HEIGHT / 2,
      tx: l.target.x,
      ty: l.target.y - NODE_HEIGHT / 2,
    }));

  // Bounds over visible (real) nodes, padded by half a card on every side.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - NODE_WIDTH / 2);
    maxX = Math.max(maxX, n.x + NODE_WIDTH / 2);
    minY = Math.min(minY, n.y - NODE_HEIGHT / 2);
    maxY = Math.max(maxY, n.y + NODE_HEIGHT / 2);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = NODE_WIDTH;
    minY = 0;
    maxY = NODE_HEIGHT;
  }
  const pad = 48;
  const bounds = {
    minX: minX - pad,
    minY: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };

  return { nodes, edges, bounds, hasVirtualRoot };
}

/** All non-virtual, collapsible node ids (i.e. nodes that have children). */
export function collapsibleIds(entities: OrgEntity[]): string[] {
  const hasChild = new Set<string>();
  for (const e of entities) if (e.parent_id) hasChild.add(e.parent_id);
  return entities.filter((e) => hasChild.has(e.id)).map((e) => e.id);
}

/**
 * orthogonalConnector returns an SVG path string for an elbow connector from a
 * source bottom-anchor to a target top-anchor (vertical-then-horizontal-then-
 * vertical), the standard org-chart connector shape.
 */
export function orthogonalConnector(e: PositionedEdge): string {
  const midY = (e.sy + e.ty) / 2;
  return `M${e.sx},${e.sy} V${midY} H${e.tx} V${e.ty}`;
}
