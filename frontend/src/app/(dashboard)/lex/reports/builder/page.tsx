'use client';

import {
  useDeferredValue,
  useMemo,
  useState,
} from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  BarChart3,
  BriefcaseBusiness,
  FileBarChart,
  FileCheck2,
  FileText,
  FolderKanban,
  Gavel,
  Layers3,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable } from '@/components/shared/data-table/data-table';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { downloadBlob } from '@/lib/format';
import type { AppLocale } from '@/lib/i18n';
import {
  type SavedViewScope,
} from '@/lib/lex/saved-views';
import {
  buildReportCsv,
  createReportDefinition,
  createDefaultReportDefinition,
  deleteReportDefinition,
  exportNativeReportXlsx,
  fetchAllReportBuilderRows,
  fetchReportBuilderPage,
  formatReportField,
  groupReportRows,
  listReportDefinitions,
  mapSavedReportDefinition,
  readReportField,
  reportDefinitionPayload,
  REPORT_BUILDER_EXPORT_MAX_ROWS,
  REPORT_DATA_SOURCE_IDS,
  REPORT_DATA_SOURCES,
  updateReportDefinition,
  type ReportBuilderDefinition,
  type ReportBuilderField,
  type ReportBuilderFilter,
  type ReportBuilderRow,
  type ReportDataSourceDefinition,
  type ReportDataSourceId,
  type ReportVisualization,
  type SavedReportDefinition,
} from '@/lib/lex/report-builder';
import { cn } from '@/lib/utils';
import { buildTabularReportXlsx } from '@/lib/lex/tabular-report-export';
import {
  showApiError,
  showSuccess,
  showWarning,
} from '@/lib/toast';
import { SaveReportDialog } from './_components/save-report-dialog';
import { useReportBuilderLabels } from './_lib/report-builder-labels';
import {
  PrintableReport,
  ReportExportMenu,
  ReportPeriodControl,
} from '@/components/lex/reports';

const SOURCE_ICONS: Record<
  ReportDataSourceId,
  LucideIcon
> = {
  contracts: FileText,
  matters: FolderKanban,
  obligations: FileCheck2,
  requests: BriefcaseBusiness,
  cases: Gavel,
  consultations: Users,
};

type ExportKind = 'csv' | 'xlsx' | null;

export default function LexReportBuilderPage() {
  return (
    <LexRouteGuard route="/lex/reports/builder">
      <ReportBuilderWorkspace />
    </LexRouteGuard>
  );
}

function ReportBuilderWorkspace() {
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  const { labels, locale, fieldLabel, optionLabel } = useReportBuilderLabels();
  const [definition, setDefinition] = useState<ReportBuilderDefinition>(() =>
    createDefaultReportDefinition(),
  );
  const deferredDefinition = useDeferredValue(definition);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(25);
  const [filterToAdd, setFilterToAdd] = useState('');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveAsCopy, setSaveAsCopy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportKind>(null);

  const source = REPORT_DATA_SOURCES[definition.source];
  const sourceAllowed = !source.permission || hasPermission(source.permission);

  const savedReportsQuery = useQuery({
    queryKey: ['lex-report-builder-definitions'],
    queryFn: listReportDefinitions,
  });

  const savedReports = useMemo(
    () =>
      (savedReportsQuery.data ?? [])
        .map(mapSavedReportDefinition)
        .filter((report): report is SavedReportDefinition => report !== null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [savedReportsQuery.data],
  );
  const selectedSaved =
    savedReports.find((report) => report.id === selectedSavedId) ?? null;
  const selectedCanEdit = Boolean(
    selectedSaved &&
      (selectedSaved.ownerUserId === user?.id ||
        ((selectedSaved.scope === 'team' || selectedSaved.scope === 'org') &&
          hasPermission('lex:catalog:manage'))),
  );

  const previewQuery = useQuery({
    queryKey: [
      'lex-report-builder-preview',
      deferredDefinition.source,
      deferredDefinition.filters,
      deferredDefinition.search,
      deferredDefinition.sortBy,
      deferredDefinition.sortDirection,
      previewPage,
      previewPageSize,
    ],
    queryFn: () =>
      fetchReportBuilderPage(
        deferredDefinition,
        previewPage,
        previewPageSize,
    ),
    enabled: sourceAllowed && deferredDefinition.columns.length > 0,
  });

  const groupedRows = useMemo(
    () =>
      groupReportRows(
        previewQuery.data?.rows ?? [],
        definition.groupBy,
        locale,
        labels.notSet,
      ),
    [
      definition.groupBy,
      labels.notSet,
      locale,
      previewQuery.data?.rows,
    ],
  );
  const localizedGroupedRows = useMemo(
    () =>
      groupedRows.map((group) => ({
        ...group,
        key: group.name,
        name: group.name === labels.notSet ? group.name : optionLabel(group.name),
      })),
    [groupedRows, labels.notSet, optionLabel],
  );

  const tableColumns = useMemo<ColumnDef<ReportBuilderRow>[]>(
    () =>
      definition.columns
        .map((column) => source.fields.find((field) => field.key === column))
        .filter((field) => Boolean(field))
        .map((field) => ({
          id: field!.key,
          accessorFn: (row: ReportBuilderRow) =>
            readReportField(row, field!.key, locale),
          header: fieldLabel(field!.key),
          enableSorting: Boolean(field!.sortable),
          cell: ({ row }: { row: { original: ReportBuilderRow } }) => (
            <span
              className={cn(
                'text-sm',
                field!.kind === 'number' && 'tabular-nums',
              )}
              dir="auto"
            >
              {formatPreviewField(
                row.original,
                field!.key,
                field!.kind,
                source,
                locale,
                optionLabel,
              )}
            </span>
          ),
        })),
    [definition.columns, fieldLabel, locale, optionLabel, source],
  );

  const createMutation = useMutation({
    mutationFn: async ({
      name,
      description,
      scope,
    }: {
      name: string;
      description: string;
      scope: SavedViewScope;
    }) => {
      const nextDefinition = { ...definition, name, description };
      return createReportDefinition({
        name,
        scope,
        payload: reportDefinitionPayload(nextDefinition),
      });
    },
    onSuccess: async (view, variables) => {
      setDefinition((current) => ({
        ...current,
        name: view.name,
        description: variables.description,
      }));
      setSelectedSavedId(view.id);
      setSaveDialogOpen(false);
      setSaveAsCopy(false);
      showSuccess(labels.savedToast);
      await queryClient.invalidateQueries({
        queryKey: ['lex-report-builder-definitions'],
      });
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSaved) throw new Error('No saved report is selected.');
      const name = definition.name.trim() || selectedSaved.name;
      return updateReportDefinition(selectedSaved.id, {
        name,
        payload: reportDefinitionPayload({
          ...definition,
          name,
        }),
      });
    },
    onSuccess: async (view) => {
      setDefinition((current) => ({ ...current, name: view.name }));
      showSuccess(labels.updatedToast);
      await queryClient.invalidateQueries({
        queryKey: ['lex-report-builder-definitions'],
      });
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSaved) return;
      await deleteReportDefinition(selectedSaved.id);
    },
    onSuccess: async () => {
      setDeleteOpen(false);
      setSelectedSavedId(null);
      setDefinition(createDefaultReportDefinition());
      setPreviewPage(1);
      showSuccess(labels.deletedToast);
      await queryClient.invalidateQueries({
        queryKey: ['lex-report-builder-definitions'],
      });
    },
    onError: showApiError,
  });

  const resetPreview = () => setPreviewPage(1);

  const patchDefinition = (patch: Partial<ReportBuilderDefinition>) => {
    setDefinition((current) => ({ ...current, ...patch }));
    resetPreview();
  };

  const drillIntoGroup = (rawValue: string) => {
    if (!definition.groupBy || rawValue === labels.notSet) return;
    patchDefinition({
      filters: [
        ...definition.filters.filter((filter) => filter.field !== definition.groupBy),
        { field: definition.groupBy, value: rawValue },
      ],
      visualization: 'table',
    });
    requestAnimationFrame(() =>
      document.getElementById('report-preview-title')?.scrollIntoView({ behavior: 'smooth' }),
    );
  };

  const selectSource = (nextSource: ReportDataSourceId) => {
    const next = REPORT_DATA_SOURCES[nextSource];
    if (next.permission && !hasPermission(next.permission)) return;
    setDefinition((current) => ({
      ...createDefaultReportDefinition(nextSource),
      name: current.name,
      description: current.description,
    }));
    setSelectedSavedId(null);
    setFilterToAdd('');
    resetPreview();
  };

  const loadSavedReport = (id: string) => {
    const report = savedReports.find((candidate) => candidate.id === id);
    if (!report) return;
    const requiredPermission =
      REPORT_DATA_SOURCES[report.definition.source].permission;
    if (requiredPermission && !hasPermission(requiredPermission)) return;
    setSelectedSavedId(report.id);
    setDefinition(report.definition);
    setFilterToAdd('');
    resetPreview();
  };

  const startNewReport = () => {
    setSelectedSavedId(null);
    setDefinition(createDefaultReportDefinition());
    setFilterToAdd('');
    resetPreview();
  };

  const toggleColumn = (column: string, checked: boolean) => {
    const columns = checked
      ? [...definition.columns, column]
      : definition.columns.filter((candidate) => candidate !== column);
    patchDefinition({ columns });
  };

  const addFilter = (field: string) => {
    if (!field || definition.filters.some((filter) => filter.field === field)) {
      return;
    }
    const filterDefinition = source.filters.find(
      (candidate) => candidate.key === field,
    );
    const value = filterDefinition?.options?.[0] ?? '';
    patchDefinition({
      filters: [...definition.filters, { field, value }],
    });
    setFilterToAdd('');
  };

  const updateFilter = (field: string, value: string) => {
    patchDefinition({
      filters: definition.filters.map((filter) =>
        filter.field === field ? { ...filter, value } : filter,
      ),
    });
  };

  const removeFilter = (field: string) => {
    patchDefinition({
      filters: definition.filters.filter(
        (filter) => filter.field !== field,
      ),
    });
  };

  const startSave = (asCopy: boolean) => {
    if (definition.columns.length === 0) {
      showWarning(labels.validationColumns);
      return;
    }
    setSaveAsCopy(asCopy);
    setSaveDialogOpen(true);
  };

  const saveExisting = async () => {
    if (!selectedSaved || !selectedCanEdit) {
      startSave(true);
      return;
    }
    if (definition.columns.length === 0) {
      showWarning(labels.validationColumns);
      return;
    }
    if (!definition.name.trim()) {
      showWarning(labels.validationName);
      return;
    }
    await updateMutation.mutateAsync();
  };

  const exportCsv = async () => {
    try {
      setExporting('csv');
      const result = await fetchAllReportBuilderRows(definition);
      const csv = buildReportCsv(definition, result.rows, locale, fieldLabel);
      const filename = `${slugify(
        definition.name || labels.untitled,
      )}-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadBlob(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        filename,
      );
      showSuccess(labels.exportToast(result.rows.length));
      if (result.total > result.rows.length) {
        showWarning(labels.maxRowsToast(result.rows.length));
      }
    } catch (error) {
      showApiError(error);
    } finally {
      setExporting(null);
    }
  };

  const exportXlsx = async () => {
    try {
      setExporting('xlsx');
      const blob = source.supportsNativeXlsx
        ? await exportNativeReportXlsx(definition)
        : await (async () => {
            const result = await fetchAllReportBuilderRows(definition);
            const fields = definition.columns.flatMap((column) => {
              const field = source.fields.find((candidate) => candidate.key === column);
              return field ? [field] : [];
            });
            return buildTabularReportXlsx({
              name: definition.name || labels.untitled,
              rtl: locale === 'ar',
              headers: fields.map((field) => fieldLabel(field.key)),
              rows: result.rows.map((row) =>
                fields.map((field) =>
                  formatReportField(
                    readReportField(row, field.key, locale),
                    field.kind,
                    locale,
                  ),
                ),
              ),
            });
          })();
      downloadBlob(
        blob,
        `${slugify(definition.name || labels.untitled)}-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`,
      );
      showSuccess(labels.exportToast(previewQuery.data?.total ?? 0));
    } catch (error) {
      showApiError(error);
    } finally {
      setExporting(null);
    }
  };

  const availableFilters = source.filters.filter(
    (filter) =>
      !definition.filters.some((active) => active.field === filter.key),
  );
  const sortableFields = source.fields.filter((field) => field.sortable);
  const groupableFields = source.fields.filter((field) => field.groupable);
  const currentScope = selectedSaved?.scope ?? 'personal';

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow={labels.eyebrow}
          title={labels.title}
          description={labels.description}
          tags={[
            {
              label: labels.sources[definition.source].name,
              icon: <Layers3 className="h-3.5 w-3.5" aria-hidden />,
              tone: 'primary',
            },
            {
              label: selectedSaved
                ? labels.scopes[selectedSaved.scope]
                : labels.unsavedReport,
              tone: selectedSaved ? 'success' : 'neutral',
            },
          ]}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={startNewReport}>
                <Plus className="me-2 h-4 w-4" aria-hidden />
                {labels.newReport}
              </Button>
              {selectedSaved ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startSave(true)}
                >
                  {labels.saveAs}
                </Button>
              ) : null}
              {selectedSaved && selectedCanEdit ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="me-2 h-4 w-4" aria-hidden />
                  {labels.delete}
                </Button>
              ) : null}
              <Button
                size="sm"
                onClick={() =>
                  selectedSaved
                    ? void saveExisting()
                    : startSave(saveAsCopy)
                }
                disabled={
                  createMutation.isPending || updateMutation.isPending
                }
              >
                <Save className="me-2 h-4 w-4" aria-hidden />
                {createMutation.isPending || updateMutation.isPending
                  ? labels.saving
                  : selectedSaved && !selectedCanEdit
                    ? labels.saveAs
                    : labels.save}
              </Button>
            </>
          }
        />

        <Card>
          <CardContent density="compact" className="pt-4 sm:pt-5">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="report-builder-saved">
                  {labels.savedReports}
                </Label>
                <Select
                  value={selectedSavedId ?? ''}
                  onValueChange={loadSavedReport}
                  disabled={
                    savedReportsQuery.isLoading || savedReports.length === 0
                  }
                >
                  <SelectTrigger id="report-builder-saved">
                    <SelectValue
                      placeholder={
                        savedReports.length === 0
                          ? labels.noSavedReports
                          : labels.loadReport
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {savedReports.map((report) => {
                      const reportSource =
                        REPORT_DATA_SOURCES[report.definition.source];
                      const unavailable = Boolean(
                        reportSource.permission &&
                          !hasPermission(reportSource.permission),
                      );
                      return (
                        <SelectItem
                          key={report.id}
                          value={report.id}
                          disabled={unavailable}
                        >
                          {report.name} · {labels.scopes[report.scope]}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {labels.exportLimit(REPORT_BUILDER_EXPORT_MAX_ROWS)}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <Card>
              <CardHeader density="compact">
                <CardTitle>{labels.dataSource}</CardTitle>
                <CardDescription>{labels.dataSourceHint}</CardDescription>
              </CardHeader>
              <CardContent density="compact" className="space-y-2">
                {REPORT_DATA_SOURCE_IDS.map((sourceId) => {
                  const item = REPORT_DATA_SOURCES[sourceId];
                  const Icon = SOURCE_ICONS[sourceId];
                  const allowed =
                    !item.permission || hasPermission(item.permission);
                  const active = definition.source === sourceId;
                  return (
                    <Button
                      key={sourceId}
                      type="button"
                      variant="ghost"
                      disabled={!allowed}
                      onClick={() => selectSource(sourceId)}
                      className={cn(
                        'h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-card border p-3 text-start transition-colors',
                        active
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/50',
                        !allowed && 'cursor-not-allowed opacity-55',
                      )}
                      title={!allowed ? labels.sourceUnavailable : undefined}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
                          active && 'bg-primary/10 text-primary',
                        )}
                      >
                        {allowed ? (
                          <Icon className="h-4 w-4" aria-hidden />
                        ) : (
                          <LockKeyhole className="h-4 w-4" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-foreground">
                          {labels.sources[sourceId].name}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          {labels.sources[sourceId].description}
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </CardContent>
            </Card>

            <Card id="report-builder-fields" className="scroll-mt-24">
              <CardHeader density="compact">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{labels.fields}</CardTitle>
                    <CardDescription>{labels.fieldsHint}</CardDescription>
                  </div>
                  <Badge variant="secondary">
                    {definition.columns.length}/{source.fields.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent density="compact" className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      patchDefinition({
                        columns: source.fields.map((field) => field.key),
                      })
                    }
                  >
                    {labels.selectAll}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => patchDefinition({ columns: [] })}
                  >
                    {labels.clear}
                  </Button>
                </div>
                <div className="max-h-[360px] space-y-1 overflow-y-auto pe-1">
                  {source.fields.map((field) => {
                    const checked = definition.columns.includes(field.key);
                    return (
                      <label
                        key={field.key}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) =>
                            toggleColumn(field.key, value === true)
                          }
                        />
                        <span>{fieldLabel(field.key)}</span>
                      </label>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </aside>

          <main className="min-w-0 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{labels.reportSetup}</CardTitle>
                <CardDescription>
                  {labels.sources[definition.source].description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="report-builder-name">
                      {labels.reportName}
                    </Label>
                    <Input
                      id="report-builder-name"
                      value={definition.name}
                      maxLength={120}
                      onChange={(event) =>
                        patchDefinition({ name: event.target.value })
                      }
                      placeholder={labels.reportNamePlaceholder}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="report-builder-search">
                      {labels.search}
                    </Label>
                    <div className="relative">
                      <Search
                        className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <Input
                        id="report-builder-search"
                        value={definition.search}
                        onChange={(event) =>
                          patchDefinition({ search: event.target.value })
                        }
                        placeholder={labels.searchPlaceholder}
                        className="ps-9"
                      />
                    </div>
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <Label htmlFor="report-builder-description">
                      {labels.descriptionLabel}
                    </Label>
                    <Textarea
                      id="report-builder-description"
                      value={definition.description}
                      maxLength={500}
                      rows={2}
                      onChange={(event) =>
                        patchDefinition({ description: event.target.value })
                      }
                      placeholder={labels.descriptionPlaceholder}
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">{labels.filters}</h3>
                      <p className="text-xs text-muted-foreground">
                        {labels.filtersHint}
                      </p>
                    </div>
                    <Select
                      value={filterToAdd}
                      onValueChange={(value) => {
                        setFilterToAdd(value);
                        addFilter(value);
                      }}
                      disabled={availableFilters.length === 0}
                    >
                      <SelectTrigger className="w-[190px]">
                        <Plus className="me-2 h-4 w-4" aria-hidden />
                        <SelectValue placeholder={labels.addFilter} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableFilters.map((filter) => (
                          <SelectItem key={filter.key} value={filter.key}>
                            {fieldLabel(filter.key)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {definition.filters.length === 0 ? (
                    <div className="rounded-card border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                      {labels.chooseFilter}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {definition.filters.map((filter) => (
                        <FilterRow
                          key={filter.field}
                          filter={filter}
                          source={source}
                          labels={labels}
                          fieldLabel={fieldLabel}
                          optionLabel={optionLabel}
                          onChange={updateFilter}
                          onRemove={removeFilter}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2">
                    <Label>{labels.sortBy}</Label>
                    <Select
                      value={definition.sortBy}
                      onValueChange={(value) =>
                        patchDefinition({ sortBy: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sortableFields.map((field) => (
                          <SelectItem key={field.key} value={field.key}>
                            {fieldLabel(field.key)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{labels.direction}</Label>
                    <Select
                      value={definition.sortDirection}
                      onValueChange={(value) =>
                        patchDefinition({
                          sortDirection: value === 'asc' ? 'asc' : 'desc',
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">{labels.ascending}</SelectItem>
                        <SelectItem value="desc">{labels.descending}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{labels.visualization}</Label>
                    <Select
                      value={definition.visualization}
                      onValueChange={(value) =>
                        patchDefinition({
                          visualization: value as ReportVisualization,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="table">{labels.table}</SelectItem>
                        <SelectItem value="bar">{labels.bar}</SelectItem>
                        <SelectItem value="donut">{labels.donut}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{labels.groupBy}</Label>
                    <Select
                      value={definition.groupBy}
                      onValueChange={(value) =>
                        patchDefinition({ groupBy: value })
                      }
                      disabled={definition.visualization === 'table'}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {groupableFields.map((field) => (
                          <SelectItem key={field.key} value={field.key}>
                            {fieldLabel(field.key)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <section className="space-y-4" aria-labelledby="report-preview-title">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2
                    id="report-preview-title"
                    className="text-h3 font-semibold text-foreground"
                  >
                    {labels.preview}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {labels.previewHint}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void previewQuery.refetch()}
                    disabled={previewQuery.isFetching}
                  >
                    <RefreshCw
                      className={cn(
                        'me-2 h-4 w-4',
                        previewQuery.isFetching && 'animate-spin',
                      )}
                      aria-hidden
                    />
                    {labels.refresh}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <Link href={source.detailHref}>
                      <FileBarChart className="me-2 h-4 w-4" aria-hidden />
                      {labels.openSource}
                    </Link>
                  </Button>
                  <ReportPeriodControl
                    value={{ from: undefined, to: undefined }}
                    onChange={() => undefined}
                    allTime
                    className="min-w-56"
                  />
                  <ReportExportMenu
                    onCsv={exportCsv}
                    onXlsx={exportXlsx}
                    exporting={exporting}
                    disabled={definition.columns.length === 0}
                  />
                </div>
              </div>

              <PrintableReport
                title={definition.name.trim() || labels.title}
                period={{ label: locale === 'ar' ? 'كل الفترات' : 'All time' }}
                contentClassName="space-y-4"
              >
              <div className="grid gap-3 sm:grid-cols-3">
                <PreviewMetric
                  icon={FileBarChart}
                  label={labels.totalRecords}
                  value={previewQuery.data?.total ?? 0}
                  onAction={() => patchDefinition({ visualization: 'table' })}
                />
                <PreviewMetric
                  icon={SlidersHorizontal}
                  label={labels.selectedFields}
                  value={definition.columns.length}
                  onAction={() =>
                    document.getElementById('report-builder-fields')?.scrollIntoView({ behavior: 'smooth' })
                  }
                />
                <PreviewMetric
                  icon={BarChart3}
                  label={labels.groups}
                  value={groupedRows.length}
                  onAction={() =>
                    document.getElementById('report-preview-title')?.scrollIntoView({ behavior: 'smooth' })
                  }
                />
              </div>

              <section data-report-section="true">
              {definition.columns.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-sm text-muted-foreground">
                    {labels.validationColumns}
                  </CardContent>
                </Card>
              ) : previewQuery.isError ? (
                <Card>
                  <CardContent className="py-8">
                    <ErrorState
                      message={labels.errorTitle}
                      onRetry={() => void previewQuery.refetch()}
                    />
                  </CardContent>
                </Card>
              ) : definition.visualization === 'bar' ? (
                <Card>
                  <CardHeader density="compact">
                    <CardTitle>
                      {fieldLabel(definition.groupBy)}
                    </CardTitle>
                    <CardDescription>
                      {labels.previewRows(
                        previewQuery.data?.rows.length ?? 0,
                        previewQuery.data?.total ?? 0,
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent density="compact">
                    <BarChart
                      data={localizedGroupedRows}
                      xKey="name"
                      yKeys={[{ key: 'value', label: labels.totalRecords }]}
                      height={340}
                      loading={previewQuery.isLoading}
                      emptyMessage={labels.chartEmpty}
                      showLegend={false}
                      onItemSelect={(datum) => drillIntoGroup(String(datum.key ?? ''))}
                    />
                  </CardContent>
                </Card>
              ) : definition.visualization === 'donut' ? (
                <Card>
                  <CardHeader density="compact">
                    <CardTitle>
                      {fieldLabel(definition.groupBy)}
                    </CardTitle>
                    <CardDescription>
                      {labels.previewRows(
                        previewQuery.data?.rows.length ?? 0,
                        previewQuery.data?.total ?? 0,
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent density="compact">
                    <PieChart
                      data={localizedGroupedRows}
                      height={340}
                      centerValue={String(previewQuery.data?.rows.length ?? 0)}
                      centerLabel={labels.preview}
                      loading={previewQuery.isLoading}
                      emptyMessage={labels.chartEmpty}
                      onItemSelect={(name) => {
                        const group = localizedGroupedRows.find((row) => row.name === name);
                        if (group) drillIntoGroup(String(group.key));
                      }}
                    />
                  </CardContent>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <CardContent className="p-0 sm:p-0">
                    <DataTable
                      columns={tableColumns}
                      data={previewQuery.data?.rows ?? []}
                      totalRows={previewQuery.data?.total ?? 0}
                      page={previewPage}
                      pageSize={previewPageSize}
                      pageSizeOptions={[10, 25, 50, 100]}
                      onPageChange={setPreviewPage}
                      onPageSizeChange={(size) => {
                        setPreviewPageSize(size);
                        setPreviewPage(1);
                      }}
                      sortColumn={definition.sortBy}
                      sortDirection={definition.sortDirection}
                      onSortChange={(column, direction) =>
                        patchDefinition({
                          sortBy: column,
                          sortDirection: direction,
                        })
                      }
                      enableColumnToggle={false}
                      isLoading={previewQuery.isLoading}
                      error={
                        previewQuery.isError ? labels.errorTitle : null
                      }
                      onRetry={() => void previewQuery.refetch()}
                      getRowId={(row) => row.id}
                      emptyState={{
                        icon: FileBarChart,
                        title: labels.emptyTitle,
                        description: labels.emptyDescription,
                      }}
                      tableId="lex-report-builder-preview"
                      stickyHeader
                      striped
                      compact
                    />
                  </CardContent>
                </Card>
              )}
              </section>
              </PrintableReport>
            </section>
          </main>
        </div>
      </div>

      <SaveReportDialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          setSaveDialogOpen(open);
          if (!open) setSaveAsCopy(false);
        }}
        labels={labels}
        initialName={
          saveAsCopy && selectedSaved
            ? `${definition.name || selectedSaved.name} — ${labels.saveAs}`
            : definition.name
        }
        initialDescription={definition.description}
        initialScope={saveAsCopy ? 'personal' : currentScope}
        pending={createMutation.isPending}
        onSave={async (values) => {
          await createMutation.mutateAsync(values);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={labels.deleteTitle}
        description={labels.deleteDescription(selectedSaved?.name ?? '')}
        confirmLabel={labels.deleteConfirm}
        cancelLabel={labels.cancel}
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={async () => {
          await deleteMutation.mutateAsync();
        }}
      />
    </>
  );
}

interface FilterRowProps {
  filter: ReportBuilderFilter;
  source: (typeof REPORT_DATA_SOURCES)[ReportDataSourceId];
  labels: ReturnType<typeof useReportBuilderLabels>['labels'];
  fieldLabel: (field: string) => string;
  optionLabel: (value: string) => string;
  onChange: (field: string, value: string) => void;
  onRemove: (field: string) => void;
}

function FilterRow({
  filter,
  source,
  labels,
  fieldLabel,
  optionLabel,
  onChange,
  onRemove,
}: FilterRowProps) {
  const definition = source.filters.find(
    (candidate) => candidate.key === filter.field,
  );
  return (
    <div className="grid gap-2 rounded-card border border-border p-3 sm:grid-cols-[minmax(140px,0.7fr)_minmax(180px,1fr)_auto] sm:items-end">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          {labels.filters}
        </Label>
        <div className="flex h-10 items-center rounded-md bg-muted px-3 text-sm font-medium">
          {fieldLabel(filter.field)}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`report-filter-${filter.field}`} className="text-xs">
          {labels.filterValue}
        </Label>
        {definition?.options ? (
          <Select
            value={filter.value}
            onValueChange={(value) => onChange(filter.field, value)}
          >
            <SelectTrigger id={`report-filter-${filter.field}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {definition.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {optionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={`report-filter-${filter.field}`}
            type={definition?.control === 'date' ? 'date' : 'text'}
            value={filter.value}
            onChange={(event) => onChange(filter.field, event.target.value)}
            placeholder={labels.filterValuePlaceholder}
          />
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onRemove(filter.field)}
        aria-label={labels.removeFilter}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}

interface PreviewMetricProps {
  icon: LucideIcon;
  label: string;
  value: number;
  onAction: () => void;
}

function PreviewMetric({ icon: Icon, label, value, onAction }: PreviewMetricProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onAction}
      className="h-auto items-stretch justify-start rounded-xl p-0 text-start font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
    <Card>
      <CardContent density="compact" className="flex items-center gap-3 pt-4 sm:pt-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span>
          <span className="block text-xs font-medium text-muted-foreground">
            {label}
          </span>
          <span className="block text-h3 font-semibold tabular-nums text-foreground">
            {value.toLocaleString()}
          </span>
        </span>
      </CardContent>
    </Card>
    </Button>
  );
}

function formatPreviewField(
  row: ReportBuilderRow,
  field: string,
  kind: ReportBuilderField['kind'],
  source: ReportDataSourceDefinition,
  locale: AppLocale,
  optionLabel: (value: string) => string,
): string {
  const value = readReportField(row, field, locale);
  const categorical = source.filters.find(
    (filter) => filter.key === field && Boolean(filter.options),
  );
  if (categorical && typeof value === 'string' && value) {
    return optionLabel(value);
  }
  return formatReportField(value, kind, locale);
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'report'
  );
}
