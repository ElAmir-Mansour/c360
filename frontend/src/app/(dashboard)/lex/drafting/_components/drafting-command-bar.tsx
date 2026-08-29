'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Download,
  History,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Search,
  Shuffle,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useDraftingLabels } from './drafting-shared';
import {
  type DraftingChainPayload,
  type DraftingChainSource,
  type DraftingChainTarget,
  createDraftingChainPayload,
  filterDraftingChainTargets,
  readDraftingCommandState,
  writeDraftingChainPayload,
  writeDraftingCommandState,
} from './drafting-workspace-utils';

export interface DraftingCommandItem {
  value: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface DraftingCommandBarProps {
  tasks: DraftingCommandItem[];
  activeTask?: string;
  query?: string;
  placeholder?: string;
  runLabel?: string;
  isRunning?: boolean;
  disabled?: boolean;
  resultAvailable?: boolean;
  persistState?: boolean;
  stateStorageKey?: string;
  className?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  chainSource?: DraftingChainSource;
  chainTargets?: DraftingChainTarget[];
  onTaskChange?: (task: string) => void;
  onQueryChange?: (query: string) => void;
  onRun?: () => void;
  onReset?: () => void;
  onClear?: () => void;
  onSaveDraft?: () => void;
  onOpenHistory?: () => void;
  onOpenExports?: () => void;
  onChain?: (target: DraftingChainTarget, payload: DraftingChainPayload) => void;
}

function IconButton({
  label,
  disabled,
  children,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function createAndStoreDraftingChain(
  source: DraftingChainSource,
  target: DraftingChainTarget,
): DraftingChainPayload {
  const payload = createDraftingChainPayload(source, target.task, {
    primaryText: source.primaryText,
    result: source.result,
  });
  writeDraftingChainPayload(payload);
  return payload;
}

export function DraftingChainActions({
  source,
  targets,
  disabled,
  onChain,
}: {
  source?: DraftingChainSource;
  targets?: DraftingChainTarget[];
  disabled?: boolean;
  onChain?: (target: DraftingChainTarget, payload: DraftingChainPayload) => void;
}) {
  const toolbar = useDraftingLabels().toolbar;
  const availableTargets = useMemo(
    () => filterDraftingChainTargets(source?.task, targets),
    [source?.task, targets],
  );

  if (!source || availableTargets.length === 0) {
    return null;
  }

  return (
    <Select
      disabled={disabled}
      onValueChange={(targetTask) => {
        const target = availableTargets.find((item) => item.task === targetTask);
        if (!target || target.disabled) {
          return;
        }
        const payload = createAndStoreDraftingChain(source, target);
        onChain?.(target, payload);
      }}
    >
      <SelectTrigger className="w-full min-w-[11rem] sm:w-[12rem]" aria-label={toolbar.chainTo}>
        <Shuffle className="me-2 h-4 w-4" aria-hidden="true" />
        <SelectValue placeholder={toolbar.chainTo} />
      </SelectTrigger>
      <SelectContent>
        {availableTargets.map((target) => (
          <SelectItem key={target.task} value={target.task} disabled={target.disabled}>
            {target.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DraftingCommandBar({
  tasks,
  activeTask,
  query,
  placeholder,
  runLabel,
  isRunning = false,
  disabled = false,
  resultAvailable = false,
  persistState = true,
  stateStorageKey,
  className,
  leading,
  trailing,
  chainSource,
  chainTargets,
  onTaskChange,
  onQueryChange,
  onRun,
  onReset,
  onClear,
  onSaveDraft,
  onOpenHistory,
  onOpenExports,
  onChain,
}: DraftingCommandBarProps) {
  const toolbar = useDraftingLabels().toolbar;
  const resolvedPlaceholder = placeholder ?? toolbar.findPlaceholder;
  const resolvedRunLabel = runLabel ?? toolbar.run;
  const storedState = persistState ? readDraftingCommandState(stateStorageKey) : null;
  const [internalQuery, setInternalQuery] = useState(query ?? storedState?.query ?? '');
  const selectedTask = activeTask ?? storedState?.activeTask ?? tasks[0]?.value;
  const activeItem = tasks.find((task) => task.value === selectedTask);
  const ActiveIcon = activeItem?.icon;
  const canRun = Boolean(onRun) && !disabled && !isRunning;

  useEffect(() => {
    if (typeof query === 'string') {
      setInternalQuery(query);
    }
  }, [query]);

  useEffect(() => {
    if (persistState) {
      writeDraftingCommandState(
        { activeTask: selectedTask, query: internalQuery },
        stateStorageKey,
      );
    }
  }, [internalQuery, persistState, selectedTask, stateStorageKey]);

  const updateQuery = (nextQuery: string) => {
    setInternalQuery(nextQuery);
    onQueryChange?.(nextQuery);
  };

  const handleTaskChange = (task: string) => {
    onTaskChange?.(task);
    if (persistState) {
      writeDraftingCommandState({ activeTask: task, query: internalQuery }, stateStorageKey);
    }
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={cn(
          'flex flex-col gap-3 rounded-lg border bg-card/80 p-3 shadow-sm',
          'lg:flex-row lg:items-center',
          className,
        )}
      >
        {leading}
        <div className="grid flex-1 gap-3 sm:grid-cols-[minmax(11rem,16rem)_minmax(0,1fr)]">
          <Select value={selectedTask} onValueChange={handleTaskChange} disabled={disabled}>
            <SelectTrigger aria-label={toolbar.taskSelectorAria}>
              {ActiveIcon ? <ActiveIcon className="me-2 h-4 w-4" aria-hidden="true" /> : null}
              <SelectValue placeholder={toolbar.taskPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((task) => (
                <SelectItem key={task.value} value={task.value} disabled={task.disabled}>
                  {task.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={internalQuery}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder={resolvedPlaceholder}
              className="ps-9"
              disabled={disabled}
              aria-label={toolbar.searchAria}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button type="button" onClick={onRun} disabled={!canRun} className="w-full sm:w-auto">
            {isRunning ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="me-2 h-4 w-4" aria-hidden="true" />
            )}
            {resolvedRunLabel}
          </Button>

          <DraftingChainActions
            source={resultAvailable ? chainSource : undefined}
            targets={chainTargets}
            disabled={disabled || !resultAvailable}
            onChain={onChain}
          />

          <IconButton label={toolbar.history} disabled={disabled || !onOpenHistory} onClick={onOpenHistory}>
            <History className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            label={toolbar.export}
            disabled={disabled || !resultAvailable || !onOpenExports}
            onClick={onOpenExports}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label={toolbar.saveDraft} disabled={disabled || !onSaveDraft} onClick={onSaveDraft}>
            <Save className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label={toolbar.reset} disabled={disabled || !onReset} onClick={onReset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label={toolbar.clear} disabled={disabled || !onClear} onClick={onClear}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          {trailing}
          {activeItem?.description ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              {activeItem.description}
            </span>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}
