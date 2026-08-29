'use client';

import { useMemo, useState } from 'react';
import { BookmarkPlus, FileInput, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useDraftingLabels } from './drafting-shared';

export const DRAFTING_PROMPT_TEMPLATE_STORAGE_KEY = 'lex:drafting:prompt-templates:v1';

export type DraftingPromptTemplatePayload = Record<string, string>;

export interface DraftingPromptTemplate {
  id: string;
  name: string;
  taskKey: string;
  payload: DraftingPromptTemplatePayload;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedPromptTemplatesLabels {
  label: string;
  template: string;
  empty: string;
  namePlaceholder: string;
  save: string;
  apply: string;
  delete: string;
  allTasks: string;
}

export interface SavedPromptTemplatesProps {
  taskKey: string;
  currentPayload: DraftingPromptTemplatePayload;
  onApply: (payload: DraftingPromptTemplatePayload, template: DraftingPromptTemplate) => void;
  storageKey?: string;
  disabled?: boolean;
  className?: string;
  labels?: Partial<SavedPromptTemplatesLabels>;
  initialTemplates?: DraftingPromptTemplate[];
  includeAllTasks?: boolean;
  onTemplatesChange?: (templates: DraftingPromptTemplate[]) => void;
}

const EMPTY_TEMPLATE_VALUE = '__no_template__';
const ALL_TASKS_VALUE = '__all_tasks__';

const DEFAULT_LABELS: SavedPromptTemplatesLabels = {
  label: 'Saved prompt templates',
  template: 'Template',
  empty: 'No saved templates',
  namePlaceholder: 'Template name',
  save: 'Save',
  apply: 'Apply',
  delete: 'Delete',
  allTasks: 'All tasks',
};

export function SavedPromptTemplates({
  taskKey,
  currentPayload,
  onApply,
  storageKey = DRAFTING_PROMPT_TEMPLATE_STORAGE_KEY,
  disabled = false,
  className,
  labels,
  initialTemplates = [],
  includeAllTasks = false,
  onTemplatesChange,
}: SavedPromptTemplatesProps) {
  const resolvedLabels = { ...DEFAULT_LABELS, ...labels };
  const promptTemplateLabels = useDraftingLabels().promptTemplates;
  const [templates, setTemplates] = useLocalPromptTemplates(storageKey, initialTemplates);
  const [selectedId, setSelectedId] = useState(EMPTY_TEMPLATE_VALUE);
  const [templateName, setTemplateName] = useState('');
  const [taskFilter, setTaskFilter] = useState(includeAllTasks ? ALL_TASKS_VALUE : taskKey);

  const visibleTemplates = useMemo(() => {
    if (!includeAllTasks || taskFilter === ALL_TASKS_VALUE) {
      return includeAllTasks ? templates : templates.filter((template) => template.taskKey === taskKey);
    }
    return templates.filter((template) => template.taskKey === taskFilter);
  }, [includeAllTasks, taskFilter, taskKey, templates]);

  const taskOptions = useMemo(
    () => Array.from(new Set([taskKey, ...templates.map((template) => template.taskKey)])).filter(Boolean),
    [taskKey, templates],
  );

  const selectedTemplate = templates.find((template) => template.id === selectedId);
  const hasCurrentPayload = Object.values(currentPayload).some((value) => value.trim().length > 0);

  const updateTemplates = (next: DraftingPromptTemplate[]) => {
    setTemplates(next);
    onTemplatesChange?.(next);
  };

  const handleSave = () => {
    const name = templateName.trim();
    if (!name || !hasCurrentPayload) {
      return;
    }
    const nextTemplate = createDraftingPromptTemplate({
      name,
      taskKey,
      payload: currentPayload,
    });
    updateTemplates(upsertDraftingPromptTemplate(templates, nextTemplate));
    setSelectedId(nextTemplate.id);
    setTemplateName('');
  };

  const handleDelete = () => {
    if (!selectedTemplate) {
      return;
    }
    updateTemplates(templates.filter((template) => template.id !== selectedTemplate.id));
    setSelectedId(EMPTY_TEMPLATE_VALUE);
  };

  const handleApply = () => {
    if (selectedTemplate) {
      onApply(selectedTemplate.payload, selectedTemplate);
    }
  };

  return (
    <div className={cn('space-y-3 rounded-lg border bg-muted/20 p-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookmarkPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Label className="text-sm font-medium">{resolvedLabels.label}</Label>
        </div>
        <Badge variant="outline" className="tracking-normal normal-case">
          {visibleTemplates.length}
        </Badge>
      </div>

      {includeAllTasks ? (
        <Select value={taskFilter} onValueChange={setTaskFilter} disabled={disabled}>
          <SelectTrigger aria-label={promptTemplateLabels.taskFilterAria}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TASKS_VALUE}>{resolvedLabels.allTasks}</SelectItem>
            {taskOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Select value={selectedId} onValueChange={setSelectedId} disabled={disabled || visibleTemplates.length === 0}>
          <SelectTrigger aria-label={resolvedLabels.template}>
            <SelectValue placeholder={resolvedLabels.empty} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EMPTY_TEMPLATE_VALUE} disabled>
              {resolvedLabels.empty}
            </SelectItem>
            {visibleTemplates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          onClick={handleApply}
          disabled={disabled || !selectedTemplate}
        >
          <FileInput className="me-1.5 h-4 w-4" aria-hidden="true" />
          {resolvedLabels.apply}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={resolvedLabels.delete}
          onClick={handleDelete}
          disabled={disabled || !selectedTemplate}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          value={templateName}
          onChange={(event) => setTemplateName(event.target.value)}
          placeholder={resolvedLabels.namePlaceholder}
          disabled={disabled}
        />
        <Button
          type="button"
          onClick={handleSave}
          disabled={disabled || !templateName.trim() || !hasCurrentPayload}
        >
          <Save className="me-1.5 h-4 w-4" aria-hidden="true" />
          {resolvedLabels.save}
        </Button>
      </div>
    </div>
  );
}

export function loadDraftingPromptTemplates(
  storageKey = DRAFTING_PROMPT_TEMPLATE_STORAGE_KEY,
  fallback: DraftingPromptTemplate[] = [],
): DraftingPromptTemplate[] {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isDraftingPromptTemplate) : fallback;
  } catch {
    return fallback;
  }
}

export function saveDraftingPromptTemplates(
  templates: DraftingPromptTemplate[],
  storageKey = DRAFTING_PROMPT_TEMPLATE_STORAGE_KEY,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(templates));
}

export function createDraftingPromptTemplate({
  name,
  taskKey,
  payload,
  description,
}: {
  name: string;
  taskKey: string;
  payload: DraftingPromptTemplatePayload;
  description?: string;
}): DraftingPromptTemplate {
  const now = new Date().toISOString();
  return {
    id: `template-${now}-${Math.random().toString(36).slice(2, 9)}`,
    name,
    taskKey,
    payload: normalizePromptTemplatePayload(payload),
    description,
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertDraftingPromptTemplate(
  templates: DraftingPromptTemplate[],
  template: DraftingPromptTemplate,
): DraftingPromptTemplate[] {
  const existingIndex = templates.findIndex((item) => item.id === template.id);
  if (existingIndex === -1) {
    return [template, ...templates];
  }
  return templates.map((item, index) =>
    index === existingIndex
      ? {
          ...template,
          createdAt: item.createdAt,
          updatedAt: new Date().toISOString(),
        }
      : item,
  );
}

export function normalizePromptTemplatePayload(
  payload: DraftingPromptTemplatePayload,
): DraftingPromptTemplatePayload {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, typeof value === 'string' ? value : String(value ?? '')]),
  );
}

function useLocalPromptTemplates(
  storageKey: string,
  initialTemplates: DraftingPromptTemplate[],
): [DraftingPromptTemplate[], (templates: DraftingPromptTemplate[]) => void] {
  const [templates, setTemplatesState] = useState<DraftingPromptTemplate[]>(() => {
    const stored = loadDraftingPromptTemplates(storageKey, []);
    return stored.length > 0 ? stored : initialTemplates;
  });

  const setTemplates = (next: DraftingPromptTemplate[]) => {
    setTemplatesState(next);
    saveDraftingPromptTemplates(next, storageKey);
  };

  return [templates, setTemplates];
}

function isDraftingPromptTemplate(value: unknown): value is DraftingPromptTemplate {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const template = value as Record<string, unknown>;
  return (
    typeof template.id === 'string' &&
    typeof template.name === 'string' &&
    typeof template.taskKey === 'string' &&
    typeof template.payload === 'object' &&
    template.payload !== null &&
    !Array.isArray(template.payload)
  );
}
