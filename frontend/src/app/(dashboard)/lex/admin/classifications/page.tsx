'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronsDownUp,
  ChevronsUpDown,
  Command as CommandIcon,
  Download,
  Eye,
  GitBranch,
  GitMerge,
  Languages,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { StatTile } from '@/components/shared/stat-tile';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { SearchInput } from '@/components/shared/forms/search-input';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import { LEX_ADMIN_ENDPOINTS, lexAdminApi, lexAdminRawGet, type CaseClassification } from '@/lib/lex/admin';
import { showApiError, showSuccess, toast } from '@/lib/toast';
import { AdminDatasetActions } from '../_components/admin-dataset-actions';
import { downloadText, readSnapshots, toCsv, writeSnapshot } from '../_lib/admin-feature-utils';
import { useCommandPaletteStore } from '@/stores/command-palette-store';
import { useAdminCommonLabels, useClassificationLabels, type ClassificationLabels } from '../_lib/admin-labels';
import {
  buildImportDiff,
  buildTranslationCoverage,
  createPayloadFromSnapshot,
  type ImportDiff,
} from '../_lib/classification-helpers';
import { ClassificationFormDialog } from './_components/classification-form-dialog';
import { ClassificationTreeNode, type MoveDirection } from './_components/classification-tree-node';
import { ClassificationMergeDialog } from './_components/classification-merge-dialog';
import { ClassificationBulkToolbar } from './_components/classification-bulk-toolbar';
import { ClassificationAuditDialog } from './_components/classification-audit-dialog';
import {
  ClassificationSafetyVerdict,
  ClassificationUsageStat,
  useClassificationUsage,
  CLASSIFICATION_USAGE_QUERY_KEY,
} from './_components/classification-usage';
import { ImportDiffDialog } from './_components/import-diff-dialog';
import { ClassificationQuickJump } from './_components/classification-quick-jump';

type StatusFilter = 'all' | 'active' | 'inactive';
type KindFilter = 'all' | 'system' | 'custom';
type I18nFilter = 'all' | 'missing-en' | 'missing-ar';

interface CaseClassificationCascade {
  classification_id: string;
  code: string;
  name: CaseClassification['name'];
  resolved_at: string;
  chain: CaseClassification[];
}

type ExportRow = Record<string, unknown> & {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  parent_id: string;
  parent_code: string;
  path: string;
  sort: number;
  active: boolean;
  is_system: boolean;
  child_count: number;
  created_at: string;
  updated_at: string;
};

interface ImportRow {
  id?: string;
  code: string;
  name_en: string;
  name_ar: string;
  parent_id?: string;
  parent_code?: string;
  parent_specified: boolean;
  sort?: number;
  active?: boolean;
}

interface MoveState {
  canMoveUp: boolean;
  canMoveDown: boolean;
}

const ROOT = '__root__';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const statusValues = new Set<StatusFilter>(['all', 'active', 'inactive']);
const kindValues = new Set<KindFilter>(['all', 'system', 'custom']);
const i18nValues = new Set<I18nFilter>(['all', 'missing-en', 'missing-ar']);

function compareClassifications(a: CaseClassification, b: CaseClassification): number {
  return a.sort - b.sort || a.code.localeCompare(b.code);
}

function sortTree(nodes: CaseClassification[]): CaseClassification[] {
  return [...nodes].sort(compareClassifications).map((node) => ({ ...node, children: sortTree(node.children ?? []) }));
}

function flatten(nodes: CaseClassification[], acc: CaseClassification[] = []): CaseClassification[] {
  for (const n of nodes) {
    acc.push(n);
    if (n.children?.length) flatten(n.children, acc);
  }
  return acc;
}

function countSystem(nodes: CaseClassification[]): number {
  return nodes.reduce((sum, n) => sum + (n.is_system ? 1 : 0) + countSystem(n.children ?? []), 0);
}

function countActive(nodes: CaseClassification[]): number {
  return nodes.reduce((sum, n) => sum + (n.active ? 1 : 0) + countActive(n.children ?? []), 0);
}

function childCount(node: CaseClassification): number {
  return flatten(node.children ?? []).length;
}

function normalizeParent(parentId?: string | null): string {
  return parentId || ROOT;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function readStatus(searchParams: URLSearchParams | null): StatusFilter {
  const raw = searchParams?.get('status') as StatusFilter | null;
  return raw && statusValues.has(raw) ? raw : 'all';
}

function readKind(searchParams: URLSearchParams | null): KindFilter {
  const raw = searchParams?.get('kind') as KindFilter | null;
  return raw && kindValues.has(raw) ? raw : 'all';
}

function readI18n(searchParams: URLSearchParams | null): I18nFilter {
  const raw = searchParams?.get('i18n') as I18nFilter | null;
  return raw && i18nValues.has(raw) ? raw : 'all';
}

function filterTree(
  nodes: CaseClassification[],
  predicate: (node: CaseClassification) => boolean,
  expandedMatches: Set<string>,
): CaseClassification[] {
  const out: CaseClassification[] = [];
  for (const node of nodes) {
    const children = filterTree(node.children ?? [], predicate, expandedMatches);
    if (predicate(node) || children.length > 0) {
      if (children.length > 0) expandedMatches.add(node.id);
      out.push({ ...node, children });
    }
  }
  return out;
}

function buildMoveState(nodes: CaseClassification[], out = new Map<string, MoveState>()): Map<string, MoveState> {
  const ordered = [...nodes].sort(compareClassifications);
  ordered.forEach((node, index) => {
    out.set(node.id, { canMoveUp: index > 0, canMoveDown: index < ordered.length - 1 });
    if (node.children?.length) buildMoveState(node.children, out);
  });
  return out;
}

// #3 Structured, actionable warnings. Each carries the id of the offending node
// so the page can reveal + highlight + offer a "fix" affordance.
interface TaxonomyWarning {
  key: string;
  message: string;
  nodeId: string;
}

interface WarningLabels {
  duplicateCode: (code: string, count: number) => string;
  sharedSort: (sort: number, count: number, parentClause: string) => string;
  sharedSortUnderParent: (parentId: string) => string;
  sharedSortRoot: string;
}

function buildWarnings(nodes: CaseClassification[], labels: WarningLabels): TaxonomyWarning[] {
  const warnings: TaxonomyWarning[] = [];
  const byCode = new Map<string, CaseClassification[]>();
  const bySiblingSort = new Map<string, CaseClassification[]>();

  for (const node of nodes) {
    const code = node.code.trim().toUpperCase();
    byCode.set(code, [...(byCode.get(code) ?? []), node]);
    const sortKey = `${normalizeParent(node.parent_id)}:${node.sort}`;
    bySiblingSort.set(sortKey, [...(bySiblingSort.get(sortKey) ?? []), node]);
  }

  for (const [code, matches] of byCode.entries()) {
    if (matches.length > 1) {
      warnings.push({
        key: `code:${code}`,
        message: labels.duplicateCode(code, matches.length),
        nodeId: matches[0].id,
      });
    }
  }

  for (const [sortKey, matches] of bySiblingSort.entries()) {
    if (matches.length > 1) {
      const parentClause = matches[0].parent_id
        ? labels.sharedSortUnderParent(matches[0].parent_id)
        : labels.sharedSortRoot;
      warnings.push({
        key: `sort:${sortKey}`,
        message: labels.sharedSort(matches[0].sort, matches.length, parentClause),
        nodeId: matches[0].id,
      });
    }
  }

  return warnings;
}

function stringField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function localizedField(row: Record<string, unknown>, localeKey: 'en' | 'ar'): string {
  const name = row.name;
  if (name && typeof name === 'object' && localeKey in name) {
    const value = (name as Record<string, unknown>)[localeKey];
    return value == null ? '' : String(value).trim();
  }
  return stringField(row, [`name_${localeKey}`, `name.${localeKey}`]);
}

function parseBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'active'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'inactive'].includes(normalized)) return false;
  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
  }
  return undefined;
}

interface ImportRowLabels {
  rowMissingCode: (row: number) => string;
  rowMissingName: (row: number) => string;
}

function normalizeImportRow(row: Record<string, unknown>, index: number, labels: ImportRowLabels): ImportRow {
  const code = stringField(row, ['code']).toUpperCase();
  const nameEn = localizedField(row, 'en');
  const nameAr = localizedField(row, 'ar');
  if (!code) throw new Error(labels.rowMissingCode(index + 1));
  if (!nameEn && !nameAr) throw new Error(labels.rowMissingName(index + 1));

  return {
    id: stringField(row, ['id']),
    code,
    name_en: nameEn,
    name_ar: nameAr,
    parent_id: stringField(row, ['parent_id']),
    parent_code: stringField(row, ['parent_code']).toUpperCase(),
    parent_specified:
      Object.prototype.hasOwnProperty.call(row, 'parent_id') ||
      Object.prototype.hasOwnProperty.call(row, 'parent_code'),
    sort: parseNumber(row.sort),
    active: parseBool(row.active),
  };
}

async function fetchCascade(id: string): Promise<CaseClassificationCascade> {
  const response = await lexAdminRawGet<{ data: CaseClassificationCascade }>(
    `${LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS}/${id}/cascade`,
  );
  return response.data;
}

function ClassificationCascadePreview({
  node,
  cascade,
  loading,
  canWrite,
  usageCount,
  usageLoading,
  onClear,
  onMerge,
  locale,
  labels,
}: {
  node: CaseClassification | null;
  cascade?: CaseClassificationCascade;
  loading: boolean;
  canWrite: boolean;
  usageCount: number;
  usageLoading: boolean;
  onClear: () => void;
  onMerge: (node: CaseClassification) => void;
  locale: AppLocale;
  labels: ClassificationLabels;
}) {
  const [metricScope, setMetricScope] = useState<'chain' | 'descendants' | 'active' | null>(null);
  if (!node) return null;
  const descendants = flatten(node.children ?? []);
  const scopedNodes = metricScope === 'active' ? descendants.filter((child) => child.active) : descendants;
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold">{labels.cascade.title}</h2>
            <Badge variant="outline">{node.code}</Badge>
            <Badge variant={usageCount > 0 ? 'secondary' : 'outline'}>{labels.matterCount(usageCount)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{resolveLocalized(node.name, locale) || node.code}</p>
          <div className="mt-2">
            <ClassificationSafetyVerdict
              count={usageCount}
              isSystem={node.is_system}
              hasChildren={hasChildren}
              size="sm"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && !node.is_system ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onMerge(node)}>
              <GitMerge className="me-1.5 h-3.5 w-3.5" />
              {labels.cascade.merge}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            {labels.cascade.clear}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <ClassificationMetric label={labels.cascade.chainDepth} value={cascade?.chain.length ?? (loading ? '…' : 0)} onAction={() => setMetricScope((scope) => scope === 'chain' ? null : 'chain')} pressed={metricScope === 'chain'} />
        <ClassificationMetric label={labels.cascade.descendants} value={descendants.length} onAction={() => setMetricScope((scope) => scope === 'descendants' ? null : 'descendants')} pressed={metricScope === 'descendants'} />
        <ClassificationMetric label={labels.cascade.activeDescendants} value={descendants.filter((child) => child.active).length} onAction={() => setMetricScope((scope) => scope === 'active' ? null : 'active')} pressed={metricScope === 'active'} />
        <ClassificationUsageStat
          count={usageCount}
          loading={usageLoading}
          href={`/lex/cases?classification_id=${encodeURIComponent(node.id)}`}
        />
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">{labels.cascade.loading}</p>
      ) : cascade ? (
        <ol className="mt-4 flex flex-wrap items-center gap-2">
          {cascade.chain.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2">
              <Badge variant={item.id === node.id ? 'default' : 'secondary'}>{item.code}</Badge>
              {index < cascade.chain.length - 1 ? <span className="text-xs text-muted-foreground">/</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{labels.cascade.noData}</p>
      )}

      {metricScope === 'descendants' || metricScope === 'active' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
          {scopedNodes.map((item) => (
            <Badge key={item.id} variant={item.active ? 'secondary' : 'outline'}>{item.code}</Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ClassificationMetric({
  label,
  value,
  onAction,
  pressed,
}: {
  label: string;
  value: number | string;
  onAction: () => void;
  pressed: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onAction}
      aria-pressed={pressed}
      data-pressed={pressed}
      className="rounded-md border bg-muted/30 p-3 text-start transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[pressed=true]:border-primary data-[pressed=true]:bg-primary/10"
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </button>
  );
}

function DeleteImpactDialog({
  node,
  open,
  cascade,
  cascadeLoading,
  usageCount,
  usageLoading,
  loading,
  locale,
  cancelLabel,
  deleteLabel,
  labels,
  onOpenChange,
  onConfirm,
}: {
  node: CaseClassification | null;
  open: boolean;
  cascade?: CaseClassificationCascade;
  cascadeLoading: boolean;
  usageCount: number;
  usageLoading: boolean;
  loading: boolean;
  locale: AppLocale;
  cancelLabel: string;
  deleteLabel: string;
  labels: ClassificationLabels;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [metricScope, setMetricScope] = useState<'children' | 'descendants' | 'chain' | null>(null);
  const descendants = node ? flatten(node.children ?? []) : [];
  const hasChildren = (node?.children?.length ?? 0) > 0;
  const inUse = usageCount > 0;
  const blocked = Boolean(node?.is_system || descendants.length > 0 || inUse);
  const label = node ? resolveLocalized(node.name, locale) || node.code : '';
  const d = labels.deleteDialog;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{d.title}</AlertDialogTitle>
          <AlertDialogDescription>{label ? d.description(label) : d.descriptionGeneric}</AlertDialogDescription>
        </AlertDialogHeader>

        {node ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <ClassificationMetric label={d.children} value={node.children?.length ?? 0} onAction={() => setMetricScope((scope) => scope === 'children' ? null : 'children')} pressed={metricScope === 'children'} />
              <ClassificationMetric label={d.descendants} value={descendants.length} onAction={() => setMetricScope((scope) => scope === 'descendants' ? null : 'descendants')} pressed={metricScope === 'descendants'} />
              <ClassificationUsageStat
                count={usageCount}
                loading={usageLoading}
                href={`/lex/cases?classification_id=${encodeURIComponent(node.id)}`}
              />
              <ClassificationMetric label={d.cascadeDepth} value={cascade?.chain.length ?? (cascadeLoading ? '…' : 0)} onAction={() => setMetricScope((scope) => scope === 'chain' ? null : 'chain')} pressed={metricScope === 'chain'} />
              <div className="sm:col-span-2 flex items-center rounded-md border bg-muted/30 p-3">
                <ClassificationSafetyVerdict
                  count={usageCount}
                  isSystem={node.is_system}
                  hasChildren={hasChildren}
                  size="sm"
                />
              </div>
            </div>

            {metricScope ? (
              <div className="flex flex-wrap items-center gap-2" aria-live="polite">
                {(metricScope === 'chain'
                  ? cascade?.chain ?? []
                  : metricScope === 'children'
                    ? node.children ?? []
                    : descendants
                ).map((item) => (
                  <Badge key={item.id} variant={item.id === node.id ? 'default' : 'secondary'}>{item.code}</Badge>
                ))}
              </div>
            ) : null}

            {blocked ? (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <AlertTitle>{d.blockedTitle}</AlertTitle>
                <AlertDescription>
                  {node.is_system ? d.blockedSystem : inUse ? d.blockedInUse(usageCount) : d.blockedChildren}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertTitle>{d.noDepsTitle}</AlertTitle>
                <AlertDescription>{d.enforceNote}</AlertDescription>
              </Alert>
            )}

            {cascade?.chain.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{d.cascadeLabel}</span>
                {cascade.chain.map((item) => (
                  <Badge key={item.id} variant={item.id === node.id ? 'default' : 'secondary'}>
                    {item.code}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={blocked || loading || !node}>
            {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {deleteLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function CaseClassificationsPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const t = useClassificationLabels();
  const common = useAdminCommonLabels();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const searchParamsString = searchParams?.toString() ?? '';
  const canWrite = hasPermission('lex:catalog:manage');

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CaseClassification | null>(null);
  const [addChildParent, setAddChildParent] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CaseClassification | null>(null);
  const [cascadeId, setCascadeId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState<CaseClassification | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importDiff, setImportDiff] = useState<ImportDiff | null>(null);
  const [pendingImportRows, setPendingImportRows] = useState<Record<string, unknown>[]>([]);
  const [quickJumpOpen, setQuickJumpOpen] = useState(false);
  const [quickJumpMode, setQuickJumpMode] = useState<'jump' | 'add-child' | 'preview'>('jump');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [auditNode, setAuditNode] = useState<CaseClassification | null>(null);
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands);

  const search = searchParams?.get('search') ?? '';
  const statusFilter = readStatus(searchParams);
  const kindFilter = readKind(searchParams);
  const i18nFilter = readI18n(searchParams);

  const q = useQuery({
    queryKey: ['lex-admin-classifications', 'tree'],
    queryFn: () => lexAdminApi.getCaseClassificationTree(),
  });

  // #2 Usage map (cases referencing each classification) — shared hook.
  const usageQuery = useClassificationUsage();
  const usage = usageQuery.usage;

  const tree = useMemo(() => sortTree(q.data ?? []), [q.data]);
  const flat = useMemo(() => flatten(tree), [tree]);
  const byId = useMemo(() => new Map(flat.map((node) => [node.id, node])), [flat]);
  const byCode = useMemo(() => new Map(flat.map((node) => [node.code.trim().toUpperCase(), node])), [flat]);
  const usageById = useMemo(() => {
    const map = new Map<string, number>();
    for (const [id, count] of Object.entries(usage)) map.set(id, count);
    return map;
  }, [usage]);
  const totalReferences = useMemo(
    () => Array.from(usageById.values()).reduce((sum, count) => sum + count, 0),
    [usageById],
  );
  const coverage = useMemo(() => buildTranslationCoverage(flat), [flat]);
  const moveStates = useMemo(() => buildMoveState(tree), [tree]);
  // #3 Re-runs on every tree mutation (memoized on `flat`, which the query
  // invalidation refreshes) so warnings stay current after edits.
  const warnings = useMemo(
    () =>
      buildWarnings(flat, {
        duplicateCode: t.warnings.duplicateCode,
        sharedSort: t.warnings.sharedSort,
        sharedSortUnderParent: t.warnings.sharedSortUnderParent,
        sharedSortRoot: t.warnings.sharedSortRoot,
      }),
    [flat, t.warnings],
  );
  const stats = useMemo(
    () => ({ total: flat.length, roots: tree.length, system: countSystem(tree), active: countActive(tree) }),
    [flat.length, tree],
  );
  const systemShare = percent(stats.system, stats.total);
  const referenceShare = percent(totalReferences, Math.max(totalReferences, stats.total));
  const kpiCopy =
    locale === 'ar'
      ? {
          currentTree: 'الشجرة الحالية',
          shareOfTree: 'النسبة من الشجرة',
          usageShare: 'إشارات الاستخدام',
          categories: 'تصنيفات',
        }
      : {
          currentTree: 'Current tree',
          shareOfTree: 'Share of tree',
          usageShare: 'Usage signal',
          categories: 'Categories',
        };

  const cascadeNode = cascadeId ? (byId.get(cascadeId) ?? null) : null;
  const deletingNode = deleting ? (byId.get(deleting.id) ?? deleting) : null;
  const deletingUsage = deletingNode ? (usageById.get(deletingNode.id) ?? 0) : 0;

  const cascadeQuery = useQuery({
    queryKey: ['lex-admin-classifications', 'cascade', cascadeId],
    queryFn: () => fetchCascade(cascadeId as string),
    enabled: Boolean(cascadeId),
  });

  const deleteCascadeQuery = useQuery({
    queryKey: ['lex-admin-classifications', 'cascade', deletingNode?.id],
    queryFn: () => fetchCascade(deletingNode?.id as string),
    enabled: Boolean(deletingNode),
  });

  const updateUrlFilter = useCallback(
    (key: 'search' | 'status' | 'kind' | 'i18n', value: string) => {
      const next = new URLSearchParams(searchParamsString);
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
    },
    [pathname, router, searchParamsString],
  );

  const clearFilters = useCallback(() => {
    const next = new URLSearchParams(searchParamsString);
    next.delete('search');
    next.delete('status');
    next.delete('kind');
    next.delete('i18n');
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
  }, [pathname, router, searchParamsString]);

  const filtered = useMemo(() => {
    const normalized = normalizeSearch(search);
    const hasFilter = Boolean(normalized) || statusFilter !== 'all' || kindFilter !== 'all' || i18nFilter !== 'all';
    const expandedMatches = new Set<string>();
    if (!hasFilter) return { tree, expandedMatches, active: false };

    const nextTree = filterTree(
      tree,
      (node) => {
        const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? node.active : !node.active);
        const matchesKind = kindFilter === 'all' || (kindFilter === 'system' ? node.is_system : !node.is_system);
        const matchesI18n =
          i18nFilter === 'all' ||
          (i18nFilter === 'missing-en' ? !(node.name.en ?? '').trim() : !(node.name.ar ?? '').trim());
        if (!matchesStatus || !matchesKind || !matchesI18n) return false;
        if (!normalized) return true;
        const name = resolveLocalized(node.name, locale) || '';
        return [node.code, node.name.en, node.name.ar, name].some((value) => value.toLowerCase().includes(normalized));
      },
      expandedMatches,
    );
    return { tree: nextTree, expandedMatches, active: true };
  }, [i18nFilter, kindFilter, locale, search, statusFilter, tree]);

  const visibleFlat = useMemo(() => flatten(filtered.tree), [filtered.tree]);
  const effectiveExpanded = useMemo(() => {
    const next = new Set(expanded);
    if (filtered.active) filtered.expandedMatches.forEach((id) => next.add(id));
    return next;
  }, [expanded, filtered.active, filtered.expandedMatches]);

  const exportRows = useMemo<ExportRow[]>(
    () =>
      flat.map((node) => ({
        id: node.id,
        code: node.code,
        name_en: node.name.en ?? '',
        name_ar: node.name.ar ?? '',
        parent_id: node.parent_id ?? '',
        parent_code: node.parent_id ? (byId.get(node.parent_id)?.code ?? '') : '',
        path: node.path.join('/'),
        sort: node.sort,
        active: node.active,
        is_system: node.is_system,
        child_count: childCount(node),
        created_at: node.created_at,
        updated_at: node.updated_at,
      })),
    [byId, flat],
  );

  const activeFilters = useMemo(
    () => ({
      search,
      status: statusFilter === 'all' ? '' : statusFilter,
      kind: kindFilter === 'all' ? '' : kindFilter,
      i18n: i18nFilter === 'all' ? '' : i18nFilter,
    }),
    [i18nFilter, kindFilter, search, statusFilter],
  );

  const snapshotBeforeDelete = useCallback((target: CaseClassification) => {
    try {
      writeSnapshot('case-classifications', target.id, {
        ...target,
        snapshot_at: new Date().toISOString(),
        snapshot_reason: 'before_delete',
      });
    } catch {
      // Local snapshot storage is best-effort; deletion should still reach the API.
    }
  }, []);

  const restoreFromSnapshot = useCallback(
    async (id: string) => {
      const [snapshot] = readSnapshots<CaseClassification>('case-classifications', id);
      if (!snapshot) {
        showApiError(new Error(t.toast.noSnapshot));
        return;
      }
      try {
        await lexAdminApi.createCaseClassification(createPayloadFromSnapshot({ ...snapshot }));
        await qc.invalidateQueries({ queryKey: ['lex-admin-classifications'] });
        showSuccess(common.toast.created);
      } catch (error) {
        showApiError(error);
      }
    },
    [common.toast.created, qc, t.toast],
  );

  const del = useMutation({
    mutationFn: async (id: string) => {
      const target = byId.get(id) ?? deleting;
      if (target) snapshotBeforeDelete(target);
      await lexAdminApi.deleteCaseClassification(id);
      return target;
    },
    onSuccess: async (target) => {
      await qc.invalidateQueries({ queryKey: ['lex-admin-classifications'] });
      setDeleting(null);
      if (target) {
        const label = resolveLocalized(target.name, locale) || target.code;
        toast.success(t.toast.deleted(label), {
          action: { label: t.toast.undo, onClick: () => void restoreFromSnapshot(target.id) },
        });
      }
    },
    onError: showApiError,
  });

  const invalidateTree = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['lex-admin-classifications'] });
    await qc.invalidateQueries({ queryKey: CLASSIFICATION_USAGE_QUERY_KEY });
  }, [qc]);

  // Build the atomic reorder payload: the dragged node lands at `targetIndex`
  // within its sibling list; sort = index is applied server-side in one tx.
  const buildReorderPayload = useCallback(
    (node: CaseClassification, targetIndex: number) => {
      const siblings = node.parent_id ? (byId.get(node.parent_id)?.children ?? []) : tree;
      const ordered = [...siblings].sort(compareClassifications);
      const from = ordered.findIndex((item) => item.id === node.id);
      if (from < 0) return null;
      const clamped = Math.max(0, Math.min(targetIndex, ordered.length - 1));
      if (from === clamped) return null;
      const next = [...ordered];
      const [moved] = next.splice(from, 1);
      next.splice(clamped, 0, moved);
      return { parent_id: node.parent_id ?? null, ordered_ids: next.map((item) => item.id) };
    },
    [byId, tree],
  );

  // #5 Up/down reorder (a11y fallback) — atomic single-tx reorder.
  const reorder = useMutation({
    mutationFn: async ({ nodeId, direction }: { nodeId: string; direction: MoveDirection }) => {
      const node = byId.get(nodeId);
      if (!node) return;
      const siblings = node.parent_id ? (byId.get(node.parent_id)?.children ?? []) : tree;
      const ordered = [...siblings].sort(compareClassifications);
      const index = ordered.findIndex((item) => item.id === node.id);
      const payload = buildReorderPayload(node, direction === 'up' ? index - 1 : index + 1);
      if (!payload) return;
      await lexAdminApi.reorderCaseClassifications(payload);
    },
    onSuccess: invalidateTree,
    onError: showApiError,
  });

  // #5 Drag-and-drop reorder (drop onto sibling) / reparent (drop onto another node).
  const reorderTo = useMutation({
    mutationFn: async ({ activeId, overId }: { activeId: string; overId: string }) => {
      const node = byId.get(activeId);
      const over = byId.get(overId);
      if (!node || !over || node.id === over.id) return;
      // Block illegal drops: into own descendant, or onto/within a system node.
      if (over.path.includes(node.id)) return;
      if (node.is_system) return;

      if ((node.parent_id ?? null) === (over.parent_id ?? null)) {
        // Same parent → atomic reorder so the dragged node lands at the target slot.
        const siblings = node.parent_id ? (byId.get(node.parent_id)?.children ?? []) : tree;
        const ordered = [...siblings].sort(compareClassifications);
        const to = ordered.findIndex((item) => item.id === over.id);
        const payload = buildReorderPayload(node, to);
        if (!payload) return;
        await lexAdminApi.reorderCaseClassifications(payload);
        return;
      }

      // Different parent → reparent under the drop target (never into a system node).
      if (over.is_system) return;
      await lexAdminApi.updateCaseClassification(node.id, { parent_id: over.id });
    },
    onSuccess: invalidateTree,
    onError: showApiError,
  });

  // #4 Inline edit handlers.
  const inlineUpdate = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Parameters<typeof lexAdminApi.updateCaseClassification>[1];
    }) => lexAdminApi.updateCaseClassification(id, payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['lex-admin-classifications'] });
    },
    onError: showApiError,
  });

  const importRows = useMutation({
    mutationFn: async (rows: Record<string, unknown>[]) => {
      const pending = rows.map((row, index) =>
        normalizeImportRow(row, index, {
          rowMissingCode: t.toast.rowMissingCode,
          rowMissingName: t.toast.rowMissingName,
        }),
      );
      const knownByCode = new Map(byCode);
      const knownById = new Map(byId);
      let applied = 0;

      while (pending.length > 0) {
        let progressed = false;

        for (let index = 0; index < pending.length; index += 1) {
          const row = pending[index];
          const existing = (row.id ? knownById.get(row.id) : undefined) ?? knownByCode.get(row.code);
          let parentId: string | null = existing?.parent_id ?? null;

          if (!existing || row.parent_specified) {
            parentId = null;
            if (row.parent_id) {
              if (!knownById.has(row.parent_id)) continue;
              parentId = row.parent_id;
            } else if (row.parent_code) {
              const parent = knownByCode.get(row.parent_code);
              if (!parent) continue;
              parentId = parent.id;
            }
          }

          if (existing && parentId === existing.id) {
            throw new Error(t.toast.rowSelfParent(row.code));
          }

          const payload: {
            name: { en: string; ar: string };
            parent_id?: string | null;
            sort: number;
            active: boolean;
          } = {
            name: {
              en: row.name_en || existing?.name.en || '',
              ar: row.name_ar || existing?.name.ar || '',
            },
            sort: row.sort ?? existing?.sort ?? 0,
            active: row.active ?? existing?.active ?? true,
          };

          const saved = existing
            ? await lexAdminApi.updateCaseClassification(existing.id, {
                ...payload,
                ...((existing.parent_id ?? null) !== parentId && row.parent_specified
                  ? { parent_id: parentId ?? ZERO_UUID }
                  : {}),
              })
            : await lexAdminApi.createCaseClassification({ code: row.code, parent_id: parentId, ...payload });

          knownByCode.set(saved.code.trim().toUpperCase(), saved);
          knownById.set(saved.id, saved);
          pending.splice(index, 1);
          index -= 1;
          progressed = true;
          applied += 1;
        }

        if (!progressed) {
          throw new Error(t.toast.importBlockedCycle);
        }
      }

      return applied;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['lex-admin-classifications'] });
    },
  });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expandAll = () => setExpanded(new Set(flat.map((n) => n.id)));
  const collapseAll = () => setExpanded(new Set());

  const onSelectChange = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // #9 Reveal a node: expand its ancestry path, focus it, and scroll it into view.
  const revealNode = useCallback((node: CaseClassification) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      node.path.forEach((id) => next.add(id));
      return next;
    });
    setFocusedId(node.id);
    requestAnimationFrame(() => {
      document.getElementById(`cls-node-${node.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, []);

  // #3 Reveal + briefly highlight the offending node (used by actionable warnings).
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealAndHighlight = useCallback(
    (node: CaseClassification) => {
      revealNode(node);
      setHighlightedId(node.id);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightedId(null), 2200);
    },
    [revealNode],
  );

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  // #9 Cmd/Ctrl+K opens the quick-jump palette.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuickJumpOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // #9 ?focus=<id> deep-link: reveal the target once the tree has loaded.
  const focusParam = searchParams?.get('focus') ?? '';
  const deepLinkHandled = useRef('');
  useEffect(() => {
    if (!focusParam || deepLinkHandled.current === focusParam) return;
    const node = byId.get(focusParam);
    if (!node) return;
    deepLinkHandled.current = focusParam;
    revealNode(node);
  }, [byId, focusParam, revealNode]);

  // #9 Arrow-key navigation across the visible flat order.
  const visibleIds = useMemo(() => visibleFlat.map((node) => node.id), [visibleFlat]);

  // #9 Seed roving focus on the first visible node so the tree is keyboard
  // reachable, and keep focus valid if the focused node leaves the visible set.
  useEffect(() => {
    if (visibleIds.length === 0) return;
    if (!focusedId || !visibleIds.includes(focusedId)) {
      setFocusedId(visibleIds[0]);
    }
  }, [focusedId, visibleIds]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      // Only roam the tree when focus is actually on a tree-node row, so the
      // arrow keys don't hijack scrolling elsewhere on the page.
      if (!target || !target.hasAttribute('data-node-id')) return;
      if (!focusedId || visibleIds.length === 0) return;
      const node = byId.get(focusedId);
      if (!node) return;
      const index = visibleIds.indexOf(focusedId);

      if (event.key === 'ArrowDown' && index >= 0 && index < visibleIds.length - 1) {
        event.preventDefault();
        const nextNode = byId.get(visibleIds[index + 1]);
        if (nextNode) revealNode(nextNode);
      } else if (event.key === 'ArrowUp' && index > 0) {
        event.preventDefault();
        const prevNode = byId.get(visibleIds[index - 1]);
        if (prevNode) revealNode(prevNode);
      } else if (event.key === 'ArrowRight' && (node.children?.length ?? 0) > 0) {
        event.preventDefault();
        setExpanded((prev) => new Set(prev).add(node.id));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(node.id);
          return next;
        });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        setEditing(node);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [byId, focusedId, revealNode, visibleIds]);

  // #9 Command palette: register classification jump / add-child / preview commands.
  const paletteCopy = useMemo(
    () =>
      locale === 'ar'
        ? {
            section: 'تصنيفات القضايا',
            jump: 'الانتقال إلى تصنيف…',
            addChild: 'إضافة فرع إلى…',
            preview: 'معاينة التسلسل لـ…',
          }
        : {
            section: 'Case classifications',
            jump: 'Jump to classification…',
            addChild: 'Add child to…',
            preview: 'Preview cascade for…',
          },
    [locale],
  );

  useEffect(() => {
    const close = useCommandPaletteStore.getState().close;
    const unregister = registerCommands([
      {
        id: 'lex-classifications-jump',
        label: paletteCopy.jump,
        section: paletteCopy.section,
        icon: Search,
        keywords: ['classification', 'taxonomy', 'تصنيف'],
        run: () => {
          close();
          setQuickJumpOpen(true);
        },
      },
      ...(canWrite
        ? [
            {
              id: 'lex-classifications-add-child',
              label: paletteCopy.addChild,
              section: paletteCopy.section,
              icon: Plus,
              run: () => {
                close();
                setQuickJumpMode('add-child');
                setQuickJumpOpen(true);
              },
            },
          ]
        : []),
      {
        id: 'lex-classifications-preview',
        label: paletteCopy.preview,
        section: paletteCopy.section,
        icon: Eye,
        run: () => {
          close();
          setQuickJumpMode('preview');
          setQuickJumpOpen(true);
        },
      },
    ]);
    return unregister;
  }, [canWrite, paletteCopy, registerCommands]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : '';
      if (!overId || activeId === overId) return;
      reorderTo.mutate({ activeId, overId });
    },
    [reorderTo],
  );

  const mergeTarget = merging ? (byId.get(merging.id) ?? merging) : null;

  const downloadTemplate = () => {
    downloadText(
      'case-classifications-template.csv',
      toCsv([
        {
          code: 'EXAMPLE',
          name_en: 'Example classification',
          name_ar: '',
          parent_code: '',
          parent_id: '',
          sort: 0,
          active: true,
        },
      ]),
      'text/csv;charset=utf-8',
    );
  };

  // #8 Import diff: stash rows + open the dry-run preview instead of applying.
  const handleImportRows = useCallback(
    (rows: Record<string, unknown>[]) => {
      setPendingImportRows(rows);
      setImportDiff(buildImportDiff(rows, byCode, byId));
    },
    [byCode, byId],
  );

  const treeNodes = filtered.tree;

  const treeList = (
    <div role="tree" aria-label={t.pageTitle} className="space-y-2">
      {filtered.active ? (
        <p className="text-sm text-muted-foreground">{t.results.showingXofY(visibleFlat.length, flat.length)}</p>
      ) : null}
      {treeNodes.map((node) => (
        <ClassificationTreeNode
          key={node.id}
          node={node}
          depth={0}
          labels={t}
          canWrite={canWrite}
          expanded={effectiveExpanded}
          moveStates={moveStates}
          moving={reorder.isPending || reorderTo.isPending}
          selectedPreviewId={cascadeId}
          onToggle={toggle}
          onPreview={(n) => setCascadeId(n.id)}
          onMove={(n, dir) => reorder.mutate({ nodeId: n.id, direction: dir })}
          onEdit={(n) => setEditing(n)}
          onAddChild={(parentId) => {
            setAddChildParent(parentId);
            setCreateOpen(true);
          }}
          onDelete={(n) => setDeleting(n)}
          onHistory={(n) => setAuditNode(n)}
          matterCount={t.matterCount}
          dndEnabled={canWrite && !filtered.active}
          usageById={usageById}
          usageLoading={usageQuery.isLoading}
          selectable={canWrite}
          selectedIds={selectedIds}
          onSelectChange={onSelectChange}
          onInlineRename={(n, name) => inlineUpdate.mutate({ id: n.id, payload: { name: { ...n.name, ...name } } })}
          onToggleActive={(n, active) => inlineUpdate.mutate({ id: n.id, payload: { active } })}
          focusedId={focusedId}
          highlightedId={highlightedId}
          onFocusNode={(n) => setFocusedId(n.id)}
        />
      ))}
    </div>
  );

  return (
    <LexAccessGuard routeKey="/lex/admin/classifications" resourceName={t.pageTitle}>
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          title={t.pageTitle}
          description={t.pageDescription}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setQuickJumpMode('jump');
                  setQuickJumpOpen(true);
                }}
              >
                <CommandIcon className="me-1.5 h-4 w-4" />
                {t.jumpTo}
              </Button>
              {canWrite ? (
                <Button
                  onClick={() => {
                    setAddChildParent(null);
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="me-1.5 h-4 w-4" />
                  {t.create}
                </Button>
              ) : null}
            </div>
          }
        />

        <div className="classification-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t.stats.total}
            value={stats.total}
            themeClass="kpi-theme-primary"
            icon={GitBranch}
            loading={q.isLoading}
            detail={kpiCopy.currentTree}
            detailValue={kpiCopy.categories}
            size="md"
            appearance="operational"
            className="classification-kpi-card"
            href="#classification-tree"
          />
          <StatTile
            label={t.stats.system}
            value={stats.system}
            themeClass="kpi-theme-amber"
            icon={ShieldCheck}
            loading={q.isLoading}
            progress={systemShare}
            progressLabel={kpiCopy.shareOfTree}
            detail={kpiCopy.currentTree}
            detailValue={`${systemShare}%`}
            size="md"
            appearance="operational"
            className="classification-kpi-card"
            href="#classification-tree"
          />
          <StatTile
            label={t.matterReferences}
            value={totalReferences}
            themeClass="kpi-theme-emerald"
            icon={GitMerge}
            loading={usageQuery.isLoading}
            progress={referenceShare}
            progressLabel={kpiCopy.usageShare}
            detail={kpiCopy.currentTree}
            detailValue={`${referenceShare}%`}
            size="md"
            appearance="operational"
            className="classification-kpi-card"
            href="#classification-tree"
          />
          <StatTile
            label={t.translationCoverage}
            value={`${coverage.pct}%`}
            themeClass="kpi-theme-primary"
            icon={Languages}
            loading={q.isLoading}
            progress={coverage.pct}
            progressLabel={kpiCopy.shareOfTree}
            detail={kpiCopy.currentTree}
            detailValue={`${coverage.pct}%`}
            size="md"
            appearance="operational"
            className="classification-kpi-card"
            href="#classification-tree"
          />
        </div>

        <AdminDatasetActions
          namespace="lex-admin-classifications"
          filename="case-classifications"
          rows={exportRows}
          activeFilters={activeFilters}
          labels={{
            savedView: t.datasetActions.saveView,
            importTitle: t.datasetActions.importTitle,
            importDescription: t.datasetActions.importDescription,
          }}
          onImportRows={canWrite ? handleImportRows : undefined}
          extraActions={
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="me-1.5 h-3.5 w-3.5" />
              {t.datasetActions.template}
            </Button>
          }
        />

        <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 md:flex-row md:items-center md:justify-between">
          <SearchInput
            value={search}
            onChange={(value) => updateUrlFilter('search', value)}
            placeholder={common.searchPlaceholder}
            loading={q.isFetching}
            className="md:min-w-80"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={(value) => updateUrlFilter('status', value)}>
              <SelectTrigger className="h-9 w-[132px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.filters.allStatus}</SelectItem>
                <SelectItem value="active">{t.filters.active}</SelectItem>
                <SelectItem value="inactive">{t.filters.inactive}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={kindFilter} onValueChange={(value) => updateUrlFilter('kind', value)}>
              <SelectTrigger className="h-9 w-[132px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.filters.allTypes}</SelectItem>
                <SelectItem value="system">{t.filters.system}</SelectItem>
                <SelectItem value="custom">{t.filters.custom}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={i18nFilter} onValueChange={(value) => updateUrlFilter('i18n', value)}>
              <SelectTrigger className="h-9 w-[148px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.filters.allTranslations}</SelectItem>
                <SelectItem value="missing-en">{t.filters.missingEn}</SelectItem>
                <SelectItem value="missing-ar">{t.filters.missingAr}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={clearFilters}>
              <RotateCcw className="me-1.5 h-3.5 w-3.5" />
              {t.filters.reset}
            </Button>
            <Button variant="outline" size="sm" onClick={expandAll}>
              <ChevronsUpDown className="me-1.5 h-3.5 w-3.5" />
              {t.expandAll}
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>
              <ChevronsDownUp className="me-1.5 h-3.5 w-3.5" />
              {t.collapseAll}
            </Button>
          </div>
        </div>

        {warnings.length > 0 ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <AlertTitle>{t.warnings.title}</AlertTitle>
            <AlertDescription>
              {/* #3 Each warning is a clickable row: reveal + highlight the
                  offending node, with a "fix" affordance opening the edit form. */}
              <ul className="space-y-1">
                {warnings.slice(0, 4).map((warning) => {
                  const target = byId.get(warning.nodeId);
                  return (
                    <li key={warning.key} className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="text-start underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline"
                        onClick={() => {
                          if (target) revealAndHighlight(target);
                        }}
                      >
                        {warning.message}
                      </button>
                      {canWrite && target ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2"
                          onClick={() => setEditing(target)}
                        >
                          <Wrench className="me-1 h-3 w-3" />
                          {common.edit}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {warnings.length > 4 ? (
                <p className="mt-1 text-xs text-muted-foreground">{t.warnings.moreHidden(warnings.length - 4)}</p>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <ClassificationCascadePreview
          node={cascadeNode}
          cascade={cascadeQuery.data}
          loading={cascadeQuery.isLoading}
          canWrite={canWrite}
          usageCount={cascadeNode ? (usageById.get(cascadeNode.id) ?? 0) : 0}
          usageLoading={usageQuery.isLoading}
          onClear={() => setCascadeId(null)}
          onMerge={(n) => setMerging(n)}
          locale={locale}
          labels={t}
        />

        <div id="classification-tree" className="scroll-mt-24">
          {q.isLoading ? (
            <LoadingSkeleton variant="list-item" count={6} />
          ) : q.isError ? (
            <ErrorState message={common.loadError} onRetry={() => void q.refetch()} />
          ) : tree.length === 0 ? (
            <EmptyState icon={GitBranch} title={t.emptyTitle} description={t.emptyDescription} />
          ) : filtered.tree.length === 0 ? (
            <EmptyState icon={GitBranch} title={t.emptyState.noMatchesTitle} description={t.emptyState.noMatchesDesc} />
          ) : canWrite && !filtered.active ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              {treeList}
            </DndContext>
          ) : (
            treeList
          )}
        </div>

        {/* #10 Merge (self-contained mutation + bilingual labels). */}
        <ClassificationMergeDialog
          source={mergeTarget}
          flatList={flat}
          usage={usage}
          open={merging !== null}
          onOpenChange={(o) => !o && setMerging(null)}
          onMerged={() => setMerging(null)}
        />

        {/* #4 Audit history. */}
        <ClassificationAuditDialog
          node={auditNode}
          open={auditNode !== null}
          onOpenChange={(o) => !o && setAuditNode(null)}
        />

        {/* #7 Bulk activate / deactivate (self-hides when nothing is selected). */}
        <ClassificationBulkToolbar
          selectedIds={Array.from(selectedIds)}
          nodesById={byId}
          usage={usage}
          onClear={() => setSelectedIds(new Set())}
          onDone={() => {
            void invalidateTree();
            setSelectedIds(new Set());
          }}
        />

        <ImportDiffDialog
          open={importDiff !== null}
          diff={importDiff}
          applying={importRows.isPending}
          onOpenChange={(o) => {
            if (!o) {
              setImportDiff(null);
              setPendingImportRows([]);
            }
          }}
          onConfirm={async () => {
            await importRows.mutateAsync(pendingImportRows);
            showSuccess(common.toast.updated);
            setImportDiff(null);
            setPendingImportRows([]);
          }}
        />

        <ClassificationQuickJump
          open={quickJumpOpen}
          items={flat}
          onOpenChange={(o) => {
            setQuickJumpOpen(o);
            if (!o) setQuickJumpMode('jump');
          }}
          onSelect={(node) => {
            if (quickJumpMode === 'add-child' && canWrite) {
              setAddChildParent(node.id);
              setCreateOpen(true);
            } else if (quickJumpMode === 'preview') {
              setCascadeId(node.id);
              revealNode(node);
            } else {
              revealNode(node);
            }
            setQuickJumpMode('jump');
          }}
        />

        {canWrite ? (
          <>
            <ClassificationFormDialog
              open={createOpen}
              flatList={flat}
              defaultParentId={addChildParent}
              onOpenChange={(o) => {
                setCreateOpen(o);
                if (!o) setAddChildParent(null);
              }}
            />
            <ClassificationFormDialog
              classification={editing}
              flatList={flat}
              open={editing !== null}
              onOpenChange={(o) => !o && setEditing(null)}
            />
            <DeleteImpactDialog
              node={deletingNode}
              open={deleting !== null}
              cascade={deleteCascadeQuery.data}
              cascadeLoading={deleteCascadeQuery.isLoading}
              usageCount={deletingUsage}
              usageLoading={usageQuery.isLoading}
              loading={del.isPending}
              locale={locale}
              cancelLabel={common.cancel}
              deleteLabel={common.delete}
              labels={t}
              onOpenChange={(o) => !o && setDeleting(null)}
              onConfirm={async () => {
                if (deletingNode) await del.mutateAsync(deletingNode.id);
              }}
            />
          </>
        ) : null}
      </div>
    </LexAccessGuard>
  );
}
