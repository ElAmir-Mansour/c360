'use client';

import * as React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  GripVertical,
  History,
  PencilLine,
  Plus,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { CaseClassification } from '@/lib/lex/admin';
import type { ClassificationLabels } from '../../_lib/admin-labels';
import {
  getClassificationIcon,
  nodeTranslationStatus,
  readAppearance,
  CLASSIFICATION_COLORS,
  type TranslationStatus,
} from '../../_lib/classification-helpers';
import { ClassificationUsageBadge } from './classification-usage-badge';

export type MoveDirection = 'up' | 'down';

export interface ClassificationTreeNodeExtraLabels {
  dragHandle: string;
  selectRow: (name: string) => string;
  inlineRename: string;
  toggleActive: string;
  history: string;
  usageTooltip: string;
  translation: Record<TranslationStatus, string>;
}

const defaultExtraLabels: ClassificationTreeNodeExtraLabels = {
  dragHandle: 'Drag to reorder or reparent',
  selectRow: (name) => `Select ${name}`,
  inlineRename: 'Rename classification',
  toggleActive: 'Toggle active',
  history: 'History',
  usageTooltip: 'Matters using this classification',
  translation: {
    complete: 'Translation complete',
    'missing-en': 'Missing English name',
    'missing-ar': 'Missing Arabic name',
    'missing-both': 'Missing English and Arabic names',
  },
};

const TRANSLATION_DOT: Record<TranslationStatus, string> = {
  complete: 'bg-success-500',
  'missing-en': 'bg-warning-500',
  'missing-ar': 'bg-warning-500',
  'missing-both': 'bg-destructive',
};

interface Props {
  node: CaseClassification;
  depth: number;
  labels: ClassificationLabels;
  canWrite: boolean;
  expanded: Set<string>;
  moveStates?: Map<string, { canMoveUp: boolean; canMoveDown: boolean }>;
  moving?: boolean;
  selectedPreviewId?: string | null;
  onToggle: (id: string) => void;
  onPreview: (node: CaseClassification) => void;
  onMove: (node: CaseClassification, direction: MoveDirection) => void;
  onEdit: (node: CaseClassification) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (node: CaseClassification) => void;
  // #4 Audit history
  onHistory?: (node: CaseClassification) => void;
  // Localized "N matters" formatter for the inline usage badge.
  matterCount?: (n: number) => string;
  // #1 Drag-and-drop
  dndEnabled?: boolean;
  // #2 Usage badge
  usageById?: Map<string, number>;
  usageLoading?: boolean;
  // #3 Selection
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectChange?: (id: string, checked: boolean) => void;
  // #4 Inline edit
  onInlineRename?: (node: CaseClassification, name: { en?: string; ar?: string }) => void;
  onToggleActive?: (node: CaseClassification, active: boolean) => void;
  // #9 Focus / scroll
  focusedId?: string | null;
  // #3 Actionable-warning highlight: briefly ring the offending node.
  highlightedId?: string | null;
  // #9 Roving-tabindex: notify the page which node became focused.
  onFocusNode?: (node: CaseClassification) => void;
  // Extra (merge/bulk/usage etc.) labels — optional, English defaults.
  extraLabels?: Partial<ClassificationTreeNodeExtraLabels>;
}

export function ClassificationTreeNode({
  node,
  depth,
  labels,
  canWrite,
  expanded,
  moveStates,
  moving,
  selectedPreviewId,
  onToggle,
  onPreview,
  onMove,
  onEdit,
  onAddChild,
  onDelete,
  onHistory,
  matterCount,
  dndEnabled,
  usageById,
  usageLoading,
  selectable,
  selectedIds,
  onSelectChange,
  onInlineRename,
  onToggleActive,
  focusedId,
  highlightedId,
  onFocusNode,
  extraLabels,
}: Props) {
  const { locale } = useLocaleOrDefault();
  const t = React.useMemo(
    () => ({
      ...defaultExtraLabels,
      ...extraLabels,
      translation: { ...defaultExtraLabels.translation, ...(extraLabels?.translation ?? {}) },
    }),
    [extraLabels],
  );

  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(node.id);
  const moveState = moveStates?.get(node.id);
  const selected = selectedPreviewId === node.id;
  const isFocused = focusedId === node.id;
  const isHighlighted = highlightedId === node.id;
  const isChecked = selectedIds?.has(node.id) ?? false;
  // Roving tabindex: only the focused node is tab-reachable; arrow keys move
  // focus between visible nodes. The page seeds focusedId with the first node.
  const rovingTabIndex = isFocused ? 0 : -1;

  const resolvedName = resolveLocalized(node.name, locale) || node.code;
  const translationStatus = nodeTranslationStatus(node);
  const appearance = readAppearance(node);
  const AppearanceIcon = getClassificationIcon(appearance.icon);
  const colorToken = appearance.color
    ? CLASSIFICATION_COLORS.find((color) => color.key === appearance.color)
    : undefined;

  // #1 Drag-and-drop — handle is draggable, the whole row is a drop target.
  const draggable = useDraggable({ id: node.id, disabled: !dndEnabled || !canWrite });
  const droppable = useDroppable({ id: node.id, disabled: !dndEnabled });

  // #4 Inline edit state.
  const [editing, setEditing] = React.useState(false);
  const [draftName, setDraftName] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // #9 When this node becomes the roving-focused node, move DOM focus to its row
  // so arrow-key navigation continues to land here — but ONLY when focus is
  // already inside the tree (another node row is active). This keeps keyboard
  // navigation flowing without stealing focus on the initial focus seed.
  React.useEffect(() => {
    if (!isFocused) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
    const insideTree = active.hasAttribute('data-node-id');
    if (insideTree && rowRef.current && active !== rowRef.current) {
      rowRef.current.focus({ preventScroll: true });
    }
  }, [isFocused]);

  const startEditing = () => {
    if (!canWrite || !onInlineRename) return;
    setDraftName(resolveLocalized(node.name, locale) ?? '');
    setEditing(true);
  };

  const commitEditing = () => {
    if (!editing) return;
    setEditing(false);
    const next = draftName.trim();
    const current = (resolveLocalized(node.name, locale) ?? '').trim();
    if (!next || next === current) return;
    onInlineRename?.(node, locale === 'ar' ? { ar: next } : { en: next });
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraftName('');
  };

  const dragStyle: React.CSSProperties | undefined = draggable.transform
    ? { transform: CSS.Translate.toString(draggable.transform) }
    : undefined;

  const setRowRef = (element: HTMLDivElement | null) => {
    droppable.setNodeRef(element);
    rowRef.current = element;
  };

  return (
    <div role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={isChecked}>
      <div
        ref={setRowRef}
        id={`cls-node-${node.id}`}
        data-node-id={node.id}
        tabIndex={rovingTabIndex}
        onFocus={() => onFocusNode?.(node)}
        style={{ marginInlineStart: depth * 20, ...dragStyle }}
        className={cn(
          'relative flex items-center gap-2 overflow-hidden rounded-lg border bg-card px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected && 'border-primary/50 ring-1 ring-primary/30',
          isFocused && 'ring-2 ring-primary/60',
          isHighlighted && 'animate-pulse border-primary bg-primary/10 ring-2 ring-primary',
          droppable.isOver && dndEnabled && 'border-primary bg-primary/5',
          draggable.isDragging && 'opacity-60',
        )}
      >
        <span
          className={cn(
            'absolute inset-y-0 start-0 w-1',
            colorToken
              ? colorToken.className
              : node.active
                ? 'bg-teal-400/70'
                : 'bg-muted',
          )}
          aria-hidden
        />

        {dndEnabled && canWrite ? (
          <button
            type="button"
            ref={draggable.setActivatorNodeRef}
            aria-label={t.dragHandle}
            title={t.dragHandle}
            className="inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            {...draggable.listeners}
            {...draggable.attributes}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : null}

        {selectable ? (
          <Checkbox
            checked={isChecked}
            aria-label={t.selectRow(resolvedName)}
            onCheckedChange={(value) => onSelectChange?.(node.id, value === true)}
          />
        ) : null}

        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-expanded={isOpen}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />}
          </button>
        ) : (
          <span className="inline-block h-6 w-6" aria-hidden />
        )}

        <span
          className={cn(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded',
            colorToken ? colorToken.className : 'text-muted-foreground',
          )}
          aria-hidden
        >
          <AppearanceIcon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <Input
                ref={inputRef}
                value={draftName}
                aria-label={t.inlineRename}
                className="h-7 max-w-[16rem] py-1 text-sm"
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitEditing}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitEditing();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelEditing();
                  }
                }}
              />
            ) : (
              <p
                className={cn('truncate text-sm font-medium', canWrite && onInlineRename && 'cursor-text')}
                onDoubleClick={startEditing}
                title={canWrite && onInlineRename ? t.inlineRename : undefined}
              >
                {resolvedName}
              </p>
            )}
            <span className="font-mono text-xs text-muted-foreground">{node.code}</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn('inline-block h-2 w-2 shrink-0 rounded-full', TRANSLATION_DOT[translationStatus])}
                    aria-label={t.translation[translationStatus]}
                  />
                </TooltipTrigger>
                <TooltipContent>{t.translation[translationStatus]}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <ClassificationUsageBadge
              count={usageById?.get(node.id)}
              loading={usageLoading}
              labels={{ ...(matterCount ? { matters: matterCount } : {}), tooltip: t.usageTooltip }}
            />
            {node.is_system ? <Badge variant="secondary">{labels.systemBadge}</Badge> : null}
            {!node.active ? <Badge variant="outline">{labels.inactiveBadge}</Badge> : null}
          </div>
        </div>

        {canWrite && onToggleActive ? (
          <Switch
            checked={node.active}
            aria-label={t.toggleActive}
            disabled={node.is_system || moving}
            onCheckedChange={(value) => onToggleActive(node, value)}
          />
        ) : null}

        <Button
          variant="ghost"
          size="icon"
          aria-label={labels.treeActions.preview}
          title={labels.treeActions.preview}
          onClick={() => onPreview(node)}
        >
          <Eye className="h-4 w-4" />
        </Button>

        {onHistory ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.history}
            title={t.history}
            onClick={() => onHistory(node)}
          >
            <History className="h-4 w-4" />
          </Button>
        ) : null}

        {canWrite ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={labels.treeActions.moveUp}
              title={labels.treeActions.moveUp}
              disabled={!moveState?.canMoveUp || moving}
              onClick={() => onMove(node, 'up')}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={labels.treeActions.moveDown}
              title={labels.treeActions.moveDown}
              disabled={!moveState?.canMoveDown || moving}
              onClick={() => onMove(node, 'down')}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label={labels.treeActions.addChild} onClick={() => onAddChild(node.id)}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label={labels.treeActions.edit} onClick={() => onEdit(node)}>
              <PencilLine className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={labels.treeActions.delete}
              disabled={node.is_system}
              title={node.is_system ? labels.treeActions.systemLocked : undefined}
              onClick={() => onDelete(node)}
            >
              <Trash2 className={cn('h-4 w-4', !node.is_system && 'text-destructive')} />
            </Button>
          </div>
        ) : null}
      </div>

      {hasChildren && isOpen ? (
        <div role="group" className="mt-2 space-y-2">
          {children.map((child) => (
            <ClassificationTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              labels={labels}
              canWrite={canWrite}
              expanded={expanded}
              moveStates={moveStates}
              moving={moving}
              selectedPreviewId={selectedPreviewId}
              onToggle={onToggle}
              onPreview={onPreview}
              onMove={onMove}
              onEdit={onEdit}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onHistory={onHistory}
              matterCount={matterCount}
              dndEnabled={dndEnabled}
              usageById={usageById}
              usageLoading={usageLoading}
              selectable={selectable}
              selectedIds={selectedIds}
              onSelectChange={onSelectChange}
              onInlineRename={onInlineRename}
              onToggleActive={onToggleActive}
              focusedId={focusedId}
              highlightedId={highlightedId}
              onFocusNode={onFocusNode}
              extraLabels={extraLabels}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
