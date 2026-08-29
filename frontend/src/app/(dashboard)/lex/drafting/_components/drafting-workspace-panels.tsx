'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSignature,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { useLexFormat } from '@/lib/lex/ksa';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { riskBadgeVariant, useDraftingLabels } from './drafting-shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { enterpriseApi } from '@/lib/enterprise';
import { reviewDeskApi } from '../../contracts/[id]/_components/review-desk/review-desk-api';
import { parseApiError, titleCase } from '@/lib/format';
import { showApiError, showBackendError, showSuccess } from '@/lib/toast';
import type {
  JsonObject,
  LexClauseLibraryEntry,
  LexClauseLibrarySearchParams,
  LexClauseLibrarySearchResult,
} from '@/types/suites';
import type { FetchParams } from '@/types/table';
import {
  DraftingSourcePicker,
  type DraftingSourcePickerLabels,
  type DraftingSourceSelection,
} from './drafting-source-picker';
import {
  preferredClauseText,
  preferredClauseTitle,
  type DraftingClauseLanguagePreference,
} from './drafting-clause-picker';
import {
  DRAFTING_HISTORY_EVENT,
  type DraftingRunRecord,
  type DraftingTaskKey,
  type DraftingTemplate,
  clearDraftingHistory,
  createPromptLibraryTemplate,
  deleteDraftingTemplate,
  deletePromptLibraryTemplate,
  downloadDraftingDocx,
  downloadDraftingText,
  listPromptLibraryTemplates,
  printDraftingPdf,
  readDraftingHistory,
  readDraftingTemplates,
  saveDraftingTemplate,
  scorePercent,
  toMarkdown,
  writeDraftingHandoff,
} from './drafting-workspace';

export interface DraftingTaskOption {
  value: DraftingTaskKey;
  label: string;
}

const NONE_VALUE = '__none__';

function taskLabel(task: DraftingTaskKey): string {
  return task.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

export function DraftingCommandBar({
  tasks,
  activeTask,
  onTaskChange,
}: {
  tasks: DraftingTaskOption[];
  activeTask: DraftingTaskKey;
  onTaskChange: (task: DraftingTaskKey) => void;
}) {
  const labels = useDraftingLabels().workspace;
  const [target, setTarget] = useState<DraftingTaskKey>(activeTask);
  const [text, setText] = useState('');

  useEffect(() => {
    setTarget(activeTask);
  }, [activeTask]);

  const send = () => {
    const trimmed = text.trim();
    if (trimmed) {
      writeDraftingHandoff({ target, text: trimmed, title: 'Command bar input', sourceTask: activeTask });
    }
    onTaskChange(target);
  };

  return (
    <SectionCard title={labels.commandTitle} description={labels.commandDescription}>
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
        <Select value={target} onValueChange={(value) => setTarget(value as DraftingTaskKey)}>
          <SelectTrigger id="drafting-command-target" aria-label={labels.commandTargetLabel}>
            <Sparkles className="me-2 h-4 w-4 text-primary" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tasks.map((task) => (
              <SelectItem key={task.value} value={task.value}>
                {task.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              send();
            }
          }}
          placeholder={labels.commandPlaceholder}
        />
        <Button
          type="button"
          onClick={send}
          className="gap-1.5 motion-safe:duration-fast motion-safe:ease-emphasized"
        >
          <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          {labels.commandSubmit}
        </Button>
      </div>
    </SectionCard>
  );
}

export function DraftingHistoryPanel({
  onOpen,
}: {
  onOpen: (record: DraftingRunRecord) => void;
}) {
  const labels = useDraftingLabels().workspace;
  const f = useLexFormat();
  const [history, setHistory] = useState<DraftingRunRecord[]>([]);

  useEffect(() => {
    const refresh = () => setHistory(readDraftingHistory());
    refresh();
    window.addEventListener(DRAFTING_HISTORY_EVENT, refresh);
    return () => window.removeEventListener(DRAFTING_HISTORY_EVENT, refresh);
  }, []);

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          {labels.historyTitle}
          {history.length ? (
            <Badge variant="outline" className="tracking-normal normal-case">
              {labels.historyCount(history.length)}
            </Badge>
          ) : null}
        </span>
      }
      description={labels.historyDescription}
      actions={
        history.length ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              clearDraftingHistory();
              setHistory([]);
            }}
          >
            <Trash2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {labels.historyClear}
          </Button>
        ) : undefined
      }
    >
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.historyEmpty}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {history.slice(0, 6).map((record, index) => (
            <button
              key={record.id}
              type="button"
              className={cn(
                'card-interactive group flex flex-col gap-2 p-4 text-start',
                'motion-safe:animate-fade-up',
              )}
              style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
              onClick={() => onOpen(record)}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-6">{record.title}</p>
                <Badge variant="outline" className="shrink-0 tracking-normal normal-case">
                  {taskLabel(record.task)}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {record.riskLevel ? (
                  <Badge variant={riskBadgeVariant(record.riskLevel)} className="tracking-normal normal-case">
                    {titleCase(String(record.riskLevel))}
                  </Badge>
                ) : null}
                {typeof record.confidence === 'number' && Number.isFinite(record.confidence) ? (
                  <Badge variant="outline" className="tracking-normal normal-case">
                    {f.formatPercent(record.confidence, { maximumFractionDigits: 0 })}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{f.formatRelative(record.createdAt)}</span>
                <span className="inline-flex items-center gap-1 text-primary opacity-0 transition-opacity duration-fast group-hover:opacity-100">
                  {labels.historyOpenHint}
                  <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function SourcePicker({
  onUseText,
}: {
  onUseText: (text: string, label: string) => void;
}) {
  const copy = useWorkspacePickerCopy();
  const [selection, setSelection] = useState<DraftingSourceSelection | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const applySource = async (nextSelection: DraftingSourceSelection) => {
    setSelection(nextSelection);
    setIsResolving(true);
    try {
      const resolved = await resolveDraftingSource(nextSelection);
      setSelection({ ...nextSelection, label: resolved.label, text: resolved.text });
      onUseText(resolved.text, resolved.label);
    } catch (error) {
      showApiError(error);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <DraftingSourcePicker
        value={selection}
        onChange={(nextSelection) => {
          if (!nextSelection) {
            setSelection(null);
            return;
          }
          void applySource(nextSelection);
        }}
        labels={copy.source}
        pageSize={8}
      />
      {isResolving ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {copy.sourceLoadingText}
        </p>
      ) : null}
    </div>
  );
}

export function ClauseLibraryPicker({
  onUseClause,
  context,
  clauseType,
  category,
  jurisdiction,
  riskLevel,
  languagePreference,
  pageSize = 8,
}: {
  onUseClause: (entry: LexClauseLibraryEntry) => void;
  context?: string;
  clauseType?: string;
  category?: string;
  jurisdiction?: string;
  riskLevel?: string;
  languagePreference?: DraftingClauseLanguagePreference;
  pageSize?: number;
}) {
  const copy = useWorkspacePickerCopy();
  const { locale } = useLocaleOrDefault();
  const resolvedLanguagePreference = languagePreference ?? (locale === 'ar' ? 'ar' : 'en');
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim();
  const trimmedContext = context?.trim() ?? '';
  const recommendationQuery = trimmedQuery || trimmedContext;

  const searchParams = useMemo<LexClauseLibrarySearchParams>(
    () => ({
      page: 1,
      per_page: pageSize,
      q: recommendationQuery || undefined,
      status: 'active',
      governance_status: 'approved',
      semantic: Boolean(recommendationQuery),
      clause_type: clauseType || undefined,
      category: category || undefined,
      jurisdiction: jurisdiction || undefined,
      risk_level: riskLevel || undefined,
      language: resolvedLanguagePreference === 'bilingual' ? undefined : resolvedLanguagePreference,
    }),
    [
      category,
      clauseType,
      jurisdiction,
      pageSize,
      recommendationQuery,
      resolvedLanguagePreference,
      riskLevel,
    ],
  );

  const listParams = useMemo<FetchParams>(
    () => ({
      page: 1,
      per_page: pageSize,
      sort: 'updated_at',
      order: 'desc',
      filters: {
        status: 'active',
        governance_status: 'approved',
      },
    }),
    [pageSize],
  );

  const clauses = useQuery({
    queryKey: ['lex-drafting-clause-library-recommendations', searchParams, listParams],
    queryFn: async () => {
      if (recommendationQuery) {
        return enterpriseApi.lex.searchClauseLibrary(searchParams);
      }
      const response = await enterpriseApi.lex.listClauseLibrary(listParams);
      return {
        data: response.data
          .filter(isApprovedActiveClause)
          .map(clauseEntryToRecommendation),
        meta: response.meta,
      };
    },
  });
  const results = clauses.data?.data ?? [];

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <BookMarked className="h-4 w-4 text-muted-foreground" aria-hidden />
        {copy.clause.title}
      </div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.clause.searchPlaceholder}
          className="ps-9"
        />
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {recommendationQuery ? copy.clause.recommendationHint : copy.clause.recentHint}
      </p>
      <div className="max-h-72 space-y-2 overflow-auto">
        {clauses.isLoading || clauses.isFetching ? (
          <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {copy.clause.loading}
          </div>
        ) : clauses.isError ? (
          <div className="space-y-3 rounded-md border border-destructive/30 bg-card px-3 py-4 text-sm">
            <p className="text-destructive">
              {copy.clause.errorPrefix} {parseApiError(clauses.error)}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void clauses.refetch()}>
              <RefreshCw className="me-1.5 h-4 w-4" aria-hidden />
              {copy.clause.retry}
            </Button>
          </div>
        ) : results.length === 0 ? (
          <p className="rounded-md border bg-card px-3 py-4 text-sm text-muted-foreground">
            {copy.clause.noResults}
          </p>
        ) : (
          results.map((result) => (
            <ClauseRecommendationButton
              key={result.item.id}
              result={result}
              copy={copy.clause}
              languagePreference={resolvedLanguagePreference}
              onPick={() => onUseClause(result.item)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface WorkspacePickerCopy {
  source: DraftingSourcePickerLabels;
  sourceLoadingText: string;
  clause: {
    title: string;
    searchPlaceholder: string;
    recommendationHint: string;
    recentHint: string;
    loading: string;
    noResults: string;
    errorPrefix: string;
    retry: string;
    useClause: string;
    score: string;
    risk: string;
    posture: string;
    fallback: string;
    governance: string;
  };
}

const WORKSPACE_PICKER_COPY: Record<'en' | 'ar', WorkspacePickerCopy> = {
  en: {
    source: {
      label: 'Source document',
      placeholder: 'Select contract or document',
      searchPlaceholder: 'Search contracts and documents...',
      contractTab: 'Contracts',
      documentTab: 'Documents',
      selectedLabel: 'Selected',
      clear: 'Clear',
      retry: 'Retry',
      loading: 'Loading sources...',
      noResults: 'No sources found.',
      errorPrefix: 'Unable to load sources:',
      updatedPrefix: 'Updated',
    },
    sourceLoadingText: 'Loading source text...',
    clause: {
      title: 'Clause recommendations',
      searchPlaceholder: 'Search approved clauses...',
      recommendationHint: 'Recommended from the current drafting context where available.',
      recentHint: 'Recent approved clauses.',
      loading: 'Loading clauses...',
      noResults: 'No approved clauses found.',
      errorPrefix: 'Unable to load clauses:',
      retry: 'Retry',
      useClause: 'Use clause',
      score: 'Score',
      risk: 'Risk',
      posture: 'Posture',
      fallback: 'Fallback',
      governance: 'Governance',
    },
  },
  ar: {
    source: {
      label: 'المصدر',
      placeholder: 'اختر عقدًا أو مستندًا',
      searchPlaceholder: 'ابحث في العقود والمستندات...',
      contractTab: 'العقود',
      documentTab: 'المستندات',
      selectedLabel: 'المحدد',
      clear: 'مسح',
      retry: 'إعادة المحاولة',
      loading: 'جارٍ تحميل المصادر...',
      noResults: 'لم يُعثر على مصادر.',
      errorPrefix: 'تعذر تحميل المصادر:',
      updatedPrefix: 'آخر تحديث',
    },
    sourceLoadingText: 'جارٍ تحميل نص المصدر...',
    clause: {
      title: 'توصيات البنود',
      searchPlaceholder: 'ابحث في البنود المعتمدة...',
      recommendationHint: 'توصيات حسب سياق الصياغة الحالي عند توفره.',
      recentHint: 'أحدث البنود المعتمدة.',
      loading: 'جارٍ تحميل البنود...',
      noResults: 'لم يُعثر على بنود معتمدة.',
      errorPrefix: 'تعذر تحميل البنود:',
      retry: 'إعادة المحاولة',
      useClause: 'استخدام البند',
      score: 'الدرجة',
      risk: 'المخاطر',
      posture: 'الموقف',
      fallback: 'البديل',
      governance: 'الحوكمة',
    },
  },
};

function useWorkspacePickerCopy(): WorkspacePickerCopy {
  const { locale } = useLocaleOrDefault();
  return locale === 'ar' ? WORKSPACE_PICKER_COPY.ar : WORKSPACE_PICKER_COPY.en;
}

async function resolveDraftingSource(selection: DraftingSourceSelection): Promise<{ label: string; text: string }> {
  if (selection.kind === 'contract') {
    const detail = await enterpriseApi.lex.getContract(selection.id);
    return {
      label: detail.contract.title,
      text: detail.contract.document_text || detail.contract.description || detail.contract.title,
    };
  }

  const detail = await enterpriseApi.lex.getDocument(selection.id);
  return {
    label: detail.title,
    text: documentDraftingText(detail.metadata) || detail.description || detail.title,
  };
}

function documentDraftingText(metadata: JsonObject): string | undefined {
  return metadataString(metadata, ['text', 'content', 'body', 'extracted_text', 'summary']);
}

function isApprovedActiveClause(entry: LexClauseLibraryEntry): boolean {
  return String(entry.status).toLowerCase() === 'active' && String(entry.governance_status).toLowerCase() === 'approved';
}

function clauseEntryToRecommendation(entry: LexClauseLibraryEntry): LexClauseLibrarySearchResult {
  return {
    item: entry,
    score: Number.NaN,
    matched_fields: [],
    snippets: undefined,
    metadata: entry.metadata,
  };
}

function ClauseRecommendationButton({
  result,
  copy,
  languagePreference,
  onPick,
}: {
  result: LexClauseLibrarySearchResult;
  copy: WorkspacePickerCopy['clause'];
  languagePreference: DraftingClauseLanguagePreference;
  onPick: () => void;
}) {
  const entry = result.item;
  const title = preferredClauseTitle(entry, languagePreference);
  const snippet = clauseRecommendationSnippet(result, languagePreference);
  const metadataBadges = clauseRecommendationMetadata(result, copy);

  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto w-full justify-start px-3 py-3 text-start"
      onClick={onPick}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          <Badge variant="outline" className="shrink-0 tracking-normal normal-case">
            {entry.code}
          </Badge>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="tracking-normal normal-case">
            {titleCase(String(entry.clause_type))}
          </Badge>
          {entry.category ? (
            <Badge variant="outline" className="tracking-normal normal-case">
              {entry.category}
            </Badge>
          ) : null}
          {entry.jurisdiction ? (
            <Badge variant="outline" className="tracking-normal normal-case">
              {entry.jurisdiction}
            </Badge>
          ) : null}
          {metadataBadges.map((badge) => (
            <Badge key={`${badge.label}:${badge.value}`} variant="outline" className="max-w-full tracking-normal normal-case">
              <span className="truncate">
                {badge.label}: {badge.value}
              </span>
            </Badge>
          ))}
          {Number.isFinite(result.score) ? (
            <Badge variant="outline" className="tracking-normal normal-case">
              {copy.score}: {Math.round(result.score * 100)}%
            </Badge>
          ) : null}
        </span>
        <span className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
          {snippet}
        </span>
      </span>
      <span className="ms-3 shrink-0 text-xs text-muted-foreground">{copy.useClause}</span>
    </Button>
  );
}

function clauseRecommendationMetadata(
  result: LexClauseLibrarySearchResult,
  copy: WorkspacePickerCopy['clause'],
): Array<{ label: string; value: string }> {
  const entry = result.item;
  const mergedMetadata = { ...entry.metadata, ...(result.metadata ?? {}) };
  const badges = [
    entry.risk_level ? { label: copy.risk, value: titleCase(String(entry.risk_level)) } : null,
    entry.governance_status ? { label: copy.governance, value: titleCase(String(entry.governance_status)) } : null,
    metadataString(mergedMetadata, ['risk_posture', 'posture', 'preferred_posture', 'negotiation_posture'])
      ? {
          label: copy.posture,
          value: metadataString(mergedMetadata, ['risk_posture', 'posture', 'preferred_posture', 'negotiation_posture'])!,
        }
      : null,
    metadataString(mergedMetadata, ['fallback', 'fallback_position', 'fallback_strategy', 'fallback_clause', 'concession_level'])
      ? {
          label: copy.fallback,
          value: metadataString(mergedMetadata, ['fallback', 'fallback_position', 'fallback_strategy', 'fallback_clause', 'concession_level'])!,
        }
      : null,
  ].filter((badge): badge is { label: string; value: string } => Boolean(badge));

  return badges.map((badge) => ({
    ...badge,
    value: compactText(badge.value, 64),
  }));
}

function clauseRecommendationSnippet(
  result: LexClauseLibrarySearchResult,
  languagePreference: DraftingClauseLanguagePreference,
): string {
  const snippets = result.snippets ?? {};
  const keys =
    languagePreference === 'ar'
      ? ['text_ar', 'title_ar', 'text_en', 'title_en']
      : ['text_en', 'title_en', 'text_ar', 'title_ar'];
  for (const key of keys) {
    const snippet = snippets[key];
    if (typeof snippet === 'string' && snippet.trim()) {
      return compactText(stripInlineMarkup(snippet), 220);
    }
  }
  return compactText(preferredClauseText(result.item, languagePreference), 220);
}

function metadataString(metadata: JsonObject | null | undefined, keys: string[]): string | undefined {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      const text = value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .join(', ');
      if (text) return text;
    }
  }
  return undefined;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function stripInlineMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function PromptTemplateBar({
  task,
  currentValue,
  onApply,
}: {
  task: DraftingTaskKey;
  currentValue: string;
  onApply: (value: string) => void;
}) {
  const panels = useDraftingLabels().panels;
  // Prefer the persisted, tenant-scoped prompt library (AID-09); fall back to
  // the local shadow store when the endpoint is unavailable (e.g. the prompt
  // library is unprovisioned and returns 503).
  const [templates, setTemplates] = useState<DraftingTemplate[]>(() => readDraftingTemplates(task));
  const [source, setSource] = useState<'api' | 'local'>('local');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    listPromptLibraryTemplates(task)
      .then((rows) => {
        if (!active) return;
        setTemplates(rows);
        setSource('api');
      })
      .catch(() => {
        if (!active) return;
        setTemplates(readDraftingTemplates(task));
        setSource('local');
      });
    return () => {
      active = false;
    };
  }, [task]);

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedValue = currentValue.trim();
    if (!trimmedName || !trimmedValue || busy) return;
    if (source === 'api') {
      setBusy(true);
      try {
        const created = await createPromptLibraryTemplate({ task, name: trimmedName, value: trimmedValue });
        setTemplates((prev) => [created, ...prev.filter((item) => item.name !== created.name)].slice(0, 50));
        setName('');
        showSuccess(panels.promptTemplateSaved, trimmedName);
        return;
      } catch {
        // Endpoint went away mid-session — degrade to the local shadow store.
        setSource('local');
      } finally {
        setBusy(false);
      }
    }
    setTemplates(saveDraftingTemplate({ task, name: trimmedName, value: trimmedValue }).filter((item) => item.task === task));
    setName('');
    showSuccess(panels.promptTemplateSaved, trimmedName);
  };

  const remove = async (template: DraftingTemplate) => {
    if (source === 'api') {
      try {
        await deletePromptLibraryTemplate(template.id);
        setTemplates((prev) => prev.filter((item) => item.id !== template.id));
        return;
      } catch {
        setSource('local');
      }
    }
    setTemplates(deleteDraftingTemplate(template.id).filter((item) => item.task === task));
  };

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={panels.templateNamePlaceholder} />
        <Button type="button" variant="outline" onClick={() => void save()} disabled={busy}>
          <Save className="me-1.5 h-4 w-4" aria-hidden />
          {panels.saveTemplate}
        </Button>
      </div>
      {templates.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {templates.map((template) => (
            <span key={template.id} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-1">
              <button type="button" className="text-xs" onClick={() => onApply(template.value)}>
                {template.name}
              </button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-destructive"
                onClick={() => void remove(template)}
                aria-label={panels.deleteTemplate(template.name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function QualityChecklist({ items }: { items: Array<{ id: string; label: string; ok: boolean }> }) {
  const f = useLexFormat();
  const panels = useDraftingLabels().panels;
  if (items.length === 0) return null;
  const passed = items.filter((item) => item.ok).length;
  const percent = Math.round((passed / items.length) * 100);
  const missingItems = items.filter((item) => !item.ok);
  const missingLabels = missingItems.map((item) => qualityItemLabel(item.label, f.locale)).join('، ');
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden />
          {panels.qualityGates}
        </p>
        <Badge variant={missingItems.length === 0 ? 'success' : 'warning'}>
          {missingItems.length === 0
            ? panels.ready
            : panels.qualityMissing(f.formatNumber(missingItems.length))}
        </Badge>
      </div>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="flex min-h-10 items-center gap-2 rounded-md border bg-card/70 px-3 py-2 text-sm">
            {item.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            ) : (
              <XCircle className="h-4 w-4 shrink-0 text-warning-700 dark:text-warning-300" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">{qualityItemLabel(item.label, f.locale)}</span>
            <Badge variant={item.ok ? 'success' : 'warning'} className="tracking-normal normal-case">
              {item.ok ? panels.qualityOk : panels.qualityGate}
            </Badge>
          </div>
        ))}
      </div>
      {missingItems.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {panels.resolveBeforePublishing(missingLabels)}
        </p>
      ) : null}
    </div>
  );
}

function qualityItemLabel(label: string, locale: string): string {
  if (locale !== 'ar') return label;
  const map: Record<string, string> = {
    Parties: 'الأطراف',
    Value: 'القيمة',
    'Governing law': 'القانون الحاكم',
    'Template hint': 'تلميح القالب',
    'Clause text': 'نص البند',
    'Target tone': 'النبرة المستهدفة',
    'Risk posture': 'وضع المخاطر',
    'Source text': 'النص المصدر',
    'Language direction': 'اتجاه اللغة',
    'Batch items optional': 'العناصر الدفعية اختيارية',
    Requirements: 'المتطلبات',
    'Template sections': 'أقسام القالب',
    'Contract text': 'نص العقد',
    'Output language': 'لغة الناتج',
  };
  return map[label] ?? (/[A-Za-z]{3,}/.test(label) ? 'عنصر جودة' : label);
}

export function EditableResultPanel({
  title,
  value,
  onChange,
  dir,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  dir?: 'ltr' | 'rtl';
}) {
  const f = useLexFormat();
  const panels = useDraftingLabels().panels;
  const [isEditing, setIsEditing] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [annotation, setAnnotation] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [baseline, setBaseline] = useState(value);
  const [comments, setComments] = useState<Array<{ id: string; text: string; reviewer?: string; createdAt: string }>>([]);
  const id = `editable-${title.replace(/\s+/g, '-').toLowerCase()}`;
  const hasComparison = baseline.trim() && baseline !== value;

  const addComment = () => {
    const text = annotation.trim();
    if (!text) return;
    setComments((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        reviewer: reviewer.trim() || undefined,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setAnnotation('');
  };

  const acceptSuggestion = () => {
    const next = suggestion.trim();
    if (!next) return;
    setBaseline(value);
    onChange(next);
    setSuggestion('');
  };

  return (
    <div className="space-y-4 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <UserCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
          {title}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setBaseline(value)}>
            <CheckCircle2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {panels.markBaseline}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing((open) => !open)}>
            {isEditing ? panels.preview : panels.edit}
          </Button>
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <Label htmlFor={id}>{panels.draftText}</Label>
          <Textarea
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={10}
            dir={dir}
            className="leading-7"
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{panels.previewMode}</p>
      )}

      {hasComparison ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border bg-card p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-caps-wide text-muted-foreground">{panels.baseline}</p>
            <div dir={dir} className="max-h-56 overflow-auto whitespace-pre-wrap text-sm leading-7">
              {baseline}
            </div>
          </div>
          <div className="rounded-md border bg-card p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-caps-wide text-muted-foreground">{panels.current}</p>
            <div dir={dir} className="max-h-56 overflow-auto whitespace-pre-wrap text-sm leading-7">
              {value}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-2">
          <Label htmlFor={`${id}-reviewer`}>{panels.reviewer}</Label>
          <Input
            id={`${id}-reviewer`}
            value={reviewer}
            onChange={(event) => setReviewer(event.target.value)}
            placeholder={panels.reviewerPlaceholder}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-comment`}>{panels.comment}</Label>
          <div className="flex gap-2">
            <Input
              id={`${id}-comment`}
              value={annotation}
              onChange={(event) => setAnnotation(event.target.value)}
              placeholder={panels.commentPlaceholder}
            />
            <Button type="button" variant="outline" onClick={addComment} disabled={!annotation.trim()}>
              {panels.add}
            </Button>
          </div>
        </div>
      </div>

      {comments.length ? (
        <div className="space-y-2">
          {comments.map((comment) => (
            <div key={comment.id} className="rounded-md border bg-card px-3 py-2 text-sm">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{comment.reviewer ?? panels.reviewerFallback}</span>
                <span>{f.formatRelative(comment.createdAt)}</span>
              </div>
              <p>{comment.text}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={`${id}-suggestion`}>{panels.suggestedReplacement}</Label>
        <Textarea
          id={`${id}-suggestion`}
          value={suggestion}
          onChange={(event) => setSuggestion(event.target.value)}
          rows={4}
          dir={dir}
          placeholder={panels.suggestedReplacementPlaceholder}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={acceptSuggestion} disabled={!suggestion.trim()}>
            <CheckCircle2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {panels.accept}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setSuggestion('')} disabled={!suggestion.trim()}>
            <XCircle className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {panels.reject}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(baseline)} disabled={!hasComparison}>
            <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {panels.restoreBaseline}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DraftingExportActions({
  title,
  text,
  json,
}: {
  title: string;
  text: string;
  json?: unknown;
}) {
  const fileBase = title.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'draft';

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => downloadDraftingText(`${fileBase}.txt`, text)}>
        <Download className="me-1.5 h-3.5 w-3.5" aria-hidden />
        TXT
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => downloadDraftingText(`${fileBase}.md`, toMarkdown(title, text), 'text/markdown;charset=utf-8')}>
        Markdown
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => downloadDraftingText(`${fileBase}.json`, JSON.stringify(json ?? { title, text }, null, 2), 'application/json;charset=utf-8')}
      >
        JSON
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => downloadDraftingDocx(`${fileBase}.docx`, title, text)}>
        DOCX
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => printDraftingPdf(title, text)}>
        PDF
      </Button>
    </div>
  );
}

export function DraftingRiskDashboard({
  confidence,
  riskScore,
  riskLevel,
  equivalence,
  issues = [],
}: {
  confidence?: number | null;
  riskScore?: number | null;
  riskLevel?: string | null;
  equivalence?: string | null;
  issues?: string[];
}) {
  const labels = useDraftingLabels();
  const panels = labels.panels;
  const rd = labels.riskDashboard;
  const detailsId = useId();
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const openDetails = (metric: string) => {
    setSelectedMetric(metric);
    requestAnimationFrame(() => {
      document.getElementById(detailsId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const equivalenceLabel =
    equivalence?.toLowerCase() === 'equivalent'
      ? panels.matched
      : equivalence
        ? equivalence
        : null;
  const rows = [
    { label: rd.confidence, value: scorePercent(confidence) },
    { label: rd.riskScore, value: scorePercent(riskScore) },
    { label: panels.riskLevel, value: riskLevel ?? null },
    { label: panels.equivalence, value: equivalenceLabel },
    { label: panels.openIssues, value: issues.length ? String(issues.length) : null },
  ].filter((row) => row.value);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {rows.map((row) => (
          <button
            type="button"
            key={row.label}
            onClick={() => openDetails(row.label)}
            aria-expanded={selectedMetric === row.label}
            aria-controls={detailsId}
            className="rounded-md border bg-muted/20 p-3 text-start transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="block text-xs text-muted-foreground">{row.label}</span>
            <span className="block text-sm font-semibold">{row.value}</span>
          </button>
        ))}
      </div>
      {selectedMetric ? (
        <div id={detailsId} className="scroll-mt-24" aria-live="polite">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {selectedMetric}
          </p>
          {issues.length > 0 ? (
            <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
              {issues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{rd.description}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function CrossTaskActions({ sourceTask, text }: { sourceTask: DraftingTaskKey; text: string }) {
  const labels = useDraftingLabels();
  const actions: Array<{ label: string; target: DraftingTaskKey; icon: typeof Sparkles }> = [
    { label: labels.tabs.translate, target: 'translate', icon: Send },
    { label: labels.tabs.rewrite, target: 'rewrite', icon: Send },
    { label: labels.tabs.summarize, target: 'summarize', icon: Send },
    { label: labels.tabs.fallbacks, target: 'fallbacks', icon: Send },
    { label: labels.tabs.obligationQa, target: 'obligationQa', icon: Send },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {actions
        .filter((action) => action.target !== sourceTask)
        .map((action) => (
          <Button
            key={action.target}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => writeDraftingHandoff({ target: action.target, text, sourceTask })}
          >
            <action.icon className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {action.label}
          </Button>
        ))}
    </div>
  );
}

export function SaveDraftTargetActions({
  title,
  text,
  payload,
}: {
  title: string;
  text: string;
  payload?: JsonObject;
}) {
  const panels = useDraftingLabels().panels;
  const { user } = useAuth();
  const ownerUserId = user?.id?.trim() ?? '';
  const ownerName =
    user?.full_name?.trim() ||
    [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
    user?.email?.trim() ||
    '';

  const requireCurrentOwner = () => {
    if (!ownerUserId || !ownerName) {
      throw new Error('Your user profile must include an ID and name before this draft can be saved.');
    }
    return { owner_user_id: ownerUserId, owner_name: ownerName };
  };

  const saveContract = useMutation({
    mutationFn: async () => {
      const owner = requireCurrentOwner();
      const created = await enterpriseApi.lex.createContract({
        title,
        description: text.slice(0, 500),
        type: 'service_agreement',
        party_a_name: 'Internal legal team',
        party_b_name: 'Counterparty',
        currency: 'SAR',
        ...owner,
        metadata: { ...payload, draft_text: text, source_surface: 'lex_drafting' },
      });
      // Register the produced draft into the review desk's named-slot registry so
      // the review workflow sees the drafting output linked to the new contract —
      // matching the contract-form-dialog and version-upload paths (slot 'draft').
      // The drafting output is inline text (no uploaded file), so the attachment
      // carries the draft title as its file name and no file_id.
      await reviewDeskApi.uploadAttachment(created.id, {
        slot: 'draft',
        file_name: `${title || 'Contract draft'}.txt`,
        file_size_bytes: new TextEncoder().encode(text).length,
        notes: 'Draft produced in the Lex drafting workspace',
        metadata: { source_surface: 'lex_drafting' },
      });
      return created;
    },
    onSuccess: () => showSuccess(panels.draftSavedAsContract),
    onError: (error) => showBackendError(error),
  });
  const saveDocument = useMutation({
    mutationFn: () =>
      enterpriseApi.lex.createDocument({
        title,
        description: text.slice(0, 500),
        type: 'other',
        confidentiality: 'internal',
        metadata: { ...payload, text, document_kind: 'contract_draft', source_surface: 'lex_drafting' },
      }),
    onSuccess: () => showSuccess(panels.draftSavedAsDocument),
    onError: (error) => showBackendError(error),
  });
  const saveMatter = useMutation({
    mutationFn: () => {
      const owner = requireCurrentOwner();
      return enterpriseApi.lex.createMatter({
        title,
        description: text.slice(0, 500),
        type: 'contract',
        status: 'open',
        priority: 'medium',
        ...owner,
        metadata: { ...payload, draft_text: text, source_surface: 'lex_drafting' },
      });
    },
    onSuccess: () => showSuccess(panels.draftSavedAsMatter),
    onError: (error) => showBackendError(error),
  });

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => saveContract.mutate()} disabled={saveContract.isPending}>
        <FileSignature className="me-1.5 h-3.5 w-3.5" aria-hidden />
        {panels.saveContract}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => saveDocument.mutate()} disabled={saveDocument.isPending}>
        <FileText className="me-1.5 h-3.5 w-3.5" aria-hidden />
        {panels.saveDocument}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => saveMatter.mutate()} disabled={saveMatter.isPending}>
        <ClipboardList className="me-1.5 h-3.5 w-3.5" aria-hidden />
        {panels.saveMatter}
      </Button>
    </div>
  );
}

export function copyToClipboard(value: string, label = 'Copied'): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(value);
  }
  showSuccess(label);
}
