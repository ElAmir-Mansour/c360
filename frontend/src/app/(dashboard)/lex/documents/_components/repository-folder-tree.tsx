/**
 * P0 — Hierarchical folder navigation for the Watheeq legal documents
 * repository.
 *
 * `RepositoryFolderTree` turns the flat `LexDocumentFolderSummary[]` (each entry
 * carries a '/'-delimited `path` plus its own `document_count`) into a
 * collapsible, keyboard-navigable tree. Every node shows its segment name, a
 * folder icon and a roll-up count (its own count plus every descendant's), and
 * highlights when its full path is the active filter. Selecting a node calls
 * `onSelect(fullPath)`; re-selecting the active node toggles the filter off. An
 * "All documents" root clears the folder filter entirely.
 *
 * `FolderBreadcrumb` renders the active `folder_path` as clickable ancestor
 * segments (Home / seg / seg) with RTL-aware separators.
 *
 * Self-contained bilingual (EN + MSA-AR) chrome — no hardcoded English — and
 * RTL-correct via logical properties (ps-/pe-, start-/end-, rtl:-scale-x-100).
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Layers,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useLocale } from '@/components/providers/locale-provider';
import type { LexDocumentFolderSummary } from '@/types/suites';

/* -------------------------------------------------------------------------- */
/* Bilingual chrome                                                            */
/* -------------------------------------------------------------------------- */

interface FolderNavLabels {
  allDocuments: string;
  home: string;
  expand: string;
  collapse: string;
  documentsCount: (count: number) => string;
  treeAriaLabel: string;
  breadcrumbAriaLabel: string;
}

function useFolderNavLabels(): FolderNavLabels {
  const { locale } = useLocale();
  return useMemo<FolderNavLabels>(() => {
    if (locale === 'ar') {
      return {
        allDocuments: 'كل الوثائق',
        home: 'الجذر',
        expand: 'توسيع',
        collapse: 'طي',
        documentsCount: (count) => `${count.toLocaleString('ar')} وثيقة`,
        treeAriaLabel: 'شجرة المجلدات',
        breadcrumbAriaLabel: 'مسار المجلد',
      };
    }
    return {
      allDocuments: 'All documents',
      home: 'Home',
      expand: 'Expand',
      collapse: 'Collapse',
      documentsCount: (count) =>
        `${count.toLocaleString('en')} ${count === 1 ? 'document' : 'documents'}`,
      treeAriaLabel: 'Folder tree',
      breadcrumbAriaLabel: 'Folder path',
    };
  }, [locale]);
}

/* -------------------------------------------------------------------------- */
/* Tree model                                                                 */
/* -------------------------------------------------------------------------- */

interface FolderNode {
  /** Full '/'-delimited path of this node. */
  path: string;
  /** Last path segment (the human-facing name). */
  name: string;
  /** Tree depth (root segments are depth 0). */
  depth: number;
  /** Count attributed directly to this exact path. */
  ownCount: number;
  /** ownCount + every descendant's ownCount. */
  rollupCount: number;
  children: FolderNode[];
}

/** Normalise a raw folder path into clean, non-empty segments. */
function splitPath(path: string): string[] {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * Build a hierarchical tree from the flat folder list. Intermediate ancestors
 * that never appear as their own row are synthesised with `ownCount = 0`, then
 * roll-up counts are computed bottom-up.
 */
function buildFolderTree(folders: LexDocumentFolderSummary[]): FolderNode[] {
  const byPath = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];

  const ensureNode = (segments: string[], depth: number): FolderNode => {
    const fullPath = segments.join('/');
    const existing = byPath.get(fullPath);
    if (existing) {
      return existing;
    }
    const node: FolderNode = {
      path: fullPath,
      name: segments[segments.length - 1] ?? fullPath,
      depth,
      ownCount: 0,
      rollupCount: 0,
      children: [],
    };
    byPath.set(fullPath, node);
    if (depth === 0) {
      roots.push(node);
    } else {
      const parent = ensureNode(segments.slice(0, -1), depth - 1);
      parent.children.push(node);
    }
    return node;
  };

  for (const folder of folders) {
    const segments = splitPath(folder.path);
    if (segments.length === 0) {
      continue;
    }
    const node = ensureNode(segments, segments.length - 1);
    node.ownCount += folder.document_count;
  }

  const computeRollup = (node: FolderNode): number => {
    let total = node.ownCount;
    for (const child of node.children) {
      total += computeRollup(child);
    }
    node.rollupCount = total;
    return total;
  };

  const sortNodes = (nodes: FolderNode[]): void => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };

  for (const root of roots) {
    computeRollup(root);
  }
  sortNodes(roots);

  return roots;
}

/** All ancestor paths of `path` (inclusive of the path itself, exclusive of root-clear). */
function ancestorChain(path: string | undefined): string[] {
  if (!path) {
    return [];
  }
  const segments = splitPath(path);
  const chain: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    chain.push(segments.slice(0, i + 1).join('/'));
  }
  return chain;
}

/* -------------------------------------------------------------------------- */
/* RepositoryFolderTree                                                        */
/* -------------------------------------------------------------------------- */

export interface RepositoryFolderTreeProps {
  /** Flat folder summaries from `getDocumentRepositorySummary().folders`. */
  folders: LexDocumentFolderSummary[];
  /** The full path of the currently selected folder, if any. */
  activeFolderPath?: string;
  /** Called with the full path when a node is selected, or `undefined` to clear. */
  onSelect: (path: string | undefined) => void;
  /** Optional extra class names for the tree container. */
  className?: string;
}

export function RepositoryFolderTree({
  folders,
  activeFolderPath,
  onSelect,
  className,
}: RepositoryFolderTreeProps) {
  const labels = useFolderNavLabels();

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const totalCount = useMemo(
    () => tree.reduce((sum, node) => sum + node.rollupCount, 0),
    [tree],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Auto-expand the ancestor chain of the active folder so it is always visible.
  useEffect(() => {
    const chain = ancestorChain(activeFolderPath);
    if (chain.length === 0) {
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      // Expand every ancestor except the leaf itself.
      for (const ancestor of chain.slice(0, -1)) {
        next.add(ancestor);
      }
      return next;
    });
  }, [activeFolderPath]);

  const toggleExpanded = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (path: string | undefined) => {
      if (path && path === activeFolderPath) {
        onSelect(undefined);
        return;
      }
      onSelect(path);
    },
    [activeFolderPath, onSelect],
  );

  const isRootActive = !activeFolderPath;

  return (
    <div
      role="tree"
      aria-label={labels.treeAriaLabel}
      aria-orientation="vertical"
      className={cn('flex flex-col gap-0.5', className)}
    >
      {/* All documents root */}
      <button
        type="button"
        role="treeitem"
        aria-selected={isRootActive}
        aria-level={1}
        onClick={() => handleSelect(undefined)}
        className={cn(
          'group flex w-full items-center gap-2 rounded-lg py-2 ps-2 pe-3 text-start text-sm',
          'transition-colors motion-safe:transition-all',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-ring)]',
          isRootActive
            ? 'bg-[var(--ds-accent-soft)] font-semibold text-[var(--ds-accent)]'
            : 'text-[var(--ds-text)] hover:bg-[var(--ds-surface-muted)]',
        )}
      >
        <Layers
          className={cn(
            'h-4 w-4 shrink-0',
            isRootActive ? 'text-[var(--ds-accent)]' : 'text-[var(--ds-text-muted)]',
          )}
          aria-hidden
        />
        <span className="flex-1 truncate">{labels.allDocuments}</span>
        <FolderCountBadge count={totalCount} active={isRootActive} label={labels} />
      </button>

      {tree.map((node) => (
        <FolderTreeNode
          key={node.path}
          node={node}
          activeFolderPath={activeFolderPath}
          expanded={expanded}
          onToggle={toggleExpanded}
          onSelect={handleSelect}
          labels={labels}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* FolderTreeNode (recursive)                                                  */
/* -------------------------------------------------------------------------- */

interface FolderTreeNodeProps {
  node: FolderNode;
  activeFolderPath?: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string | undefined) => void;
  labels: FolderNavLabels;
}

function FolderTreeNode({
  node,
  activeFolderPath,
  expanded,
  onToggle,
  onSelect,
  labels,
}: FolderTreeNodeProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.path);
  const isActive = node.path === activeFolderPath;
  // Depth 0 sits at the same indent as the root row's content (ps-2 + icon).
  const indentRem = 0.5 + node.depth * 0.875;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!hasChildren) {
      return;
    }
    // Arrow keys honour the logical (writing-direction-aware) tree convention:
    // "forward" opens a node, "back" collapses it.
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const opens = event.key === 'ArrowRight';
      event.preventDefault();
      if (opens && !isExpanded) {
        onToggle(node.path);
      } else if (!opens && isExpanded) {
        onToggle(node.path);
      }
    }
  };

  return (
    <div role="none" className="flex flex-col">
      <div
        role="treeitem"
        aria-selected={isActive}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-level={node.depth + 2}
        className={cn(
          'group flex items-center rounded-lg text-sm',
          'transition-colors motion-safe:transition-all',
          isActive
            ? 'bg-[var(--ds-accent-soft)] font-semibold text-[var(--ds-accent)]'
            : 'text-[var(--ds-text)] hover:bg-[var(--ds-surface-muted)]',
        )}
      >
        {/* Chevron / spacer — separate control so it never selects the node. */}
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node.path);
            }}
            className={cn(
              'flex h-7 w-6 shrink-0 items-center justify-center rounded-md',
              'text-[var(--ds-text-muted)] hover:text-[var(--ds-text)]',
              'focus-visible:outline-none',
            )}
            style={{ marginInlineStart: `${indentRem}rem` }}
            title={isExpanded ? labels.collapse : labels.expand}
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 transition-transform rtl:-scale-x-100',
                isExpanded && 'rotate-90 rtl:-rotate-90',
              )}
              aria-hidden
            />
          </button>
        ) : (
          <span
            aria-hidden
            className="h-7 w-6 shrink-0"
            style={{ marginInlineStart: `${indentRem}rem` }}
          />
        )}

        <button
          type="button"
          onClick={() => onSelect(node.path)}
          onKeyDown={handleKeyDown}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pe-2 text-start',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-ring)]',
          )}
        >
          {hasChildren && isExpanded ? (
            <FolderOpen
              className={cn(
                'h-4 w-4 shrink-0',
                isActive ? 'text-[var(--ds-accent)]' : 'text-[var(--ds-text-muted)]',
              )}
              aria-hidden
            />
          ) : (
            <Folder
              className={cn(
                'h-4 w-4 shrink-0',
                isActive ? 'text-[var(--ds-accent)]' : 'text-[var(--ds-text-muted)]',
              )}
              aria-hidden
            />
          )}
          <span className="min-w-0 flex-1 truncate" title={node.name}>
            {node.name}
          </span>
          <FolderCountBadge count={node.rollupCount} active={isActive} label={labels} />
        </button>
      </div>

      {hasChildren && isExpanded ? (
        <div role="group" className="flex flex-col gap-0.5">
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.path}
              node={child}
              activeFolderPath={activeFolderPath}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              labels={labels}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* FolderCountBadge                                                            */
/* -------------------------------------------------------------------------- */

interface FolderCountBadgeProps {
  count: number;
  active: boolean;
  label: FolderNavLabels;
}

function FolderCountBadge({ count, active, label }: FolderCountBadgeProps) {
  return (
    <span
      className={cn(
        'ms-auto inline-flex shrink-0 items-center justify-center rounded-full px-2 py-0.5',
        'text-xs font-medium tabular-nums',
        active
          ? 'bg-[var(--ds-accent)]/15 text-[var(--ds-accent)]'
          : 'bg-[var(--ds-surface-muted)] text-[var(--ds-text-muted)]',
      )}
      aria-label={label.documentsCount(count)}
    >
      {count.toLocaleString()}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* FolderBreadcrumb                                                            */
/* -------------------------------------------------------------------------- */

export interface FolderBreadcrumbProps {
  /** The active folder path, '/'-delimited; empty/undefined shows just Home. */
  path?: string;
  /** Navigate to an ancestor path, or `undefined` for the repository root. */
  onNavigate: (path: string | undefined) => void;
  /** Optional extra class names for the breadcrumb container. */
  className?: string;
}

export function FolderBreadcrumb({ path, onNavigate, className }: FolderBreadcrumbProps) {
  const labels = useFolderNavLabels();
  const segments = useMemo(() => splitPath(path ?? ''), [path]);

  const crumbs = useMemo(
    () =>
      segments.map((segment, index) => ({
        name: segment,
        path: segments.slice(0, index + 1).join('/'),
        isLast: index === segments.length - 1,
      })),
    [segments],
  );

  return (
    <nav
      aria-label={labels.breadcrumbAriaLabel}
      className={cn('flex min-w-0 items-center gap-1 text-sm', className)}
    >
      <ol className="flex min-w-0 items-center gap-1">
        <li className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => onNavigate(undefined)}
            aria-current={crumbs.length === 0 ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-1.5 py-1',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-ring)]',
              crumbs.length === 0
                ? 'font-semibold text-[var(--ds-text)]'
                : 'text-[var(--ds-text-muted)] hover:text-[var(--ds-text)]',
            )}
          >
            <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{labels.home}</span>
          </button>
        </li>

        {crumbs.map((crumb) => (
          <li key={crumb.path} className="flex min-w-0 items-center gap-1">
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-muted)] rtl:-scale-x-100"
              aria-hidden
            />
            {crumb.isLast ? (
              <span
                aria-current="page"
                title={crumb.name}
                className="truncate font-semibold text-[var(--ds-text)]"
              >
                {crumb.name}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(crumb.path)}
                title={crumb.name}
                className={cn(
                  'truncate rounded-md px-1.5 py-1 text-[var(--ds-text-muted)] hover:text-[var(--ds-text)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-ring)]',
                )}
              >
                {crumb.name}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
