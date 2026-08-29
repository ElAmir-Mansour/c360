/**
 * GuidedBulkImportDialog — a guided CSV/TSV bulk importer for the Watheeq legal
 * documents repository. It replaces hand-authoring a raw JSON array: legal /
 * records staff upload or paste a CSV, map columns to document fields, review a
 * per-row validation preview, then import only the valid rows. It ends in the
 * SAME backend call as the legacy dialog
 * (`enterpriseApi.lex.bulkImportDocuments`).
 *
 * All visible copy is bilingual (English + MSA) via `useCsvImportLabels`; no
 * hardcoded English appears in the JSX. Layout uses RTL-safe logical props.
 */

'use client';

import { useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Download, FileText, Loader2, Upload, XCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useLocale } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { formatNumber } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import type { LexDocumentBulkImportResult } from '@/types/suites';
import {
  type CsvTargetField,
  useCsvImportLabels,
} from '../_lib/csv-import-labels';
import {
  type CsvDelimiter,
  normalizeHeaderKey,
  parseCsv,
  splitTagsCell,
} from '../_lib/csv-parse';
import { useDocumentsLabels } from '../_lib/documents-labels';

const MAX_ROWS = 250;
const PREVIEW_LIMIT = 10;

const DOCUMENT_TYPES = [
  'policy', 'regulation', 'template', 'memo', 'opinion', 'filing',
  'correspondence', 'resolution', 'power_of_attorney', 'other',
] as const;
const CONFIDENTIALITY = ['public', 'internal', 'confidential', 'privileged'] as const;

type DocumentType = (typeof DOCUMENT_TYPES)[number];
type Confidentiality = (typeof CONFIDENTIALITY)[number];

/** Ordered list of mappable target fields (the `__none` sentinel is added in UI). */
const TARGET_FIELDS: Array<Exclude<CsvTargetField, '__none'>> = [
  'title', 'type', 'description', 'category', 'confidentiality', 'tags',
  'folder_path', 'jurisdiction', 'retention_policy', 'source_record_id',
];

const METADATA_FIELDS: Array<Exclude<CsvTargetField, '__none'>> = [
  'folder_path', 'jurisdiction', 'retention_policy', 'source_record_id',
];

/** Synonyms that feed fuzzy auto-mapping (normalised on both sides). */
const FIELD_SYNONYMS: Record<Exclude<CsvTargetField, '__none'>, string[]> = {
  title: ['title', 'name', 'documenttitle', 'subject'],
  type: ['type', 'documenttype', 'doctype', 'category', 'kind'],
  description: ['description', 'desc', 'summary', 'notes'],
  category: ['category', 'class', 'classification', 'group'],
  confidentiality: ['confidentiality', 'confidential', 'sensitivity', 'classificationlevel'],
  tags: ['tags', 'tag', 'labels', 'keywords'],
  folder_path: ['folderpath', 'folder', 'path', 'directory'],
  jurisdiction: ['jurisdiction', 'region', 'country', 'territory'],
  retention_policy: ['retentionpolicy', 'retention', 'retentionschedule'],
  source_record_id: ['sourcerecordid', 'sourceid', 'recordid', 'externalid', 'legacyid', 'sourcerecord'],
};

interface BulkDocumentPayload {
  title: string;
  type: DocumentType;
  description: string;
  category: string;
  confidentiality: Confidentiality;
  tags: string[];
  metadata: Record<string, string>;
}

interface ValidatedRow {
  rowNumber: number; // 1-based source row index (after header)
  payload: BulkDocumentPayload;
  rawTitle: string;
  rawType: string;
  rawConfidentiality: string;
  issues: string[];
  valid: boolean;
}

type Step = 'input' | 'mapping' | 'preview';

export function GuidedBulkImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const { direction } = useLocale();
  const t = useCsvImportLabels();
  const docLabels = useDocumentsLabels();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('input');
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<Array<Record<string, string>>>([]);
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',');
  const [mapping, setMapping] = useState<Record<string, CsvTargetField>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);

  const [batchId, setBatchId] = useState('');
  const [sourceSystem, setSourceSystem] = useState('');
  const [shouldIndex, setShouldIndex] = useState(true);
  const [result, setResult] = useState<LexDocumentBulkImportResult | null>(null);

  const bulkImportMutation = useMutation({
    mutationFn: (documents: BulkDocumentPayload[]) =>
      enterpriseApi.lex.bulkImportDocuments({
        ...(batchId.trim() ? { batch_id: batchId.trim() } : {}),
        ...(sourceSystem.trim() ? { source_system: sourceSystem.trim() } : {}),
        index: shouldIndex,
        documents,
      }),
    onSuccess: async (importResult) => {
      setResult(importResult);
      showSuccess(
        t.toasts.importTitle,
        t.toasts.importDescription(
          formatNumber(importResult.succeeded),
          formatNumber(importResult.failed),
          formatNumber(importResult.requested),
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-documents'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-document-repository-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
      ]);
    },
    onError: showApiError,
  });

  // Validate every parsed row against the current mapping (memoised).
  const validatedRows = useMemo(
    () => validateRows(dataRows, mapping, t),
    [dataRows, mapping, t],
  );
  const validRows = useMemo(() => validatedRows.filter((row) => row.valid), [validatedRows]);
  const importableRows = useMemo(() => validRows.slice(0, MAX_ROWS), [validRows]);
  const overCap = validRows.length > MAX_ROWS;
  const hasTitleMapping = Object.values(mapping).includes('title');

  function resetAll() {
    setStep('input');
    setRawText('');
    setFileName('');
    setHeaders([]);
    setDataRows([]);
    setDelimiter(',');
    setMapping({});
    setParseError(null);
    setMappingError(null);
    setBatchId('');
    setSourceSystem('');
    setShouldIndex(true);
    setResult(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetAll();
    onOpenChange(nextOpen);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setRawText(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsText(file);
  }

  function handleParse() {
    setParseError(null);
    const text = rawText.trim();
    if (!text) {
      setParseError(t.preview.noValidRows);
      return;
    }
    const parsed = parseCsv(rawText);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setParseError(t.preview.noValidRows);
      return;
    }
    setHeaders(parsed.headers);
    setDataRows(parsed.rows);
    setDelimiter(parsed.delimiter);
    setMapping(autoMap(parsed.headers));
    setMappingError(null);
    setStep('mapping');
  }

  function handleContinueToPreview() {
    if (!hasTitleMapping) {
      setMappingError(t.mapping.requiredMissing);
      return;
    }
    setMappingError(null);
    setStep('preview');
  }

  function handleImport() {
    if (importableRows.length === 0) return;
    bulkImportMutation.mutate(importableRows.map((row) => row.payload));
  }

  function handleDownloadTemplate() {
    downloadCsvTemplate(t.template.filename);
  }

  const delimiterLabel = delimiter === '\t' ? t.input.delimiterTab : t.input.delimiterComma;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" dir={direction}>
        <DialogHeader>
          <DialogTitle className="text-start">{t.title}</DialogTitle>
          <DialogDescription className="text-start">{t.description}</DialogDescription>
        </DialogHeader>

        <LexCreationGuidance workflow="document" />

        <StepIndicator step={step} labels={t} />

        <div className="space-y-4">
          {step === 'input' ? (
            <InputStep
              labels={t}
              rawText={rawText}
              fileName={fileName}
              fileInputRef={fileInputRef}
              onFileChange={handleFileChange}
              onRawTextChange={(value) => setRawText(value)}
              onDownloadTemplate={handleDownloadTemplate}
            />
          ) : null}

          {step === 'mapping' ? (
            <MappingStep
              labels={t}
              docLabels={docLabels}
              headers={headers}
              dataRows={dataRows}
              mapping={mapping}
              delimiterLabel={delimiterLabel}
              parsedSummary={t.input.parsedSummary(
                formatNumber(dataRows.length),
                formatNumber(headers.length),
              )}
              onMappingChange={(header, target) =>
                setMapping((prev) => ({ ...prev, [header]: target }))
              }
            />
          ) : null}

          {step === 'preview' ? (
            <PreviewStep
              labels={t}
              docLabels={docLabels}
              rows={validatedRows}
              validCount={validRows.length}
              overCap={overCap}
              batchId={batchId}
              sourceSystem={sourceSystem}
              shouldIndex={shouldIndex}
              result={result}
              onBatchIdChange={setBatchId}
              onSourceSystemChange={setSourceSystem}
              onShouldIndexChange={setShouldIndex}
            />
          ) : null}

          {parseError ? <InlineError message={parseError} /> : null}
          {mappingError ? <InlineError message={mappingError} /> : null}
        </div>

        <DialogFooter className="gap-2">
          {step !== 'input' && !result ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep(step === 'preview' ? 'mapping' : 'input')}
            >
              {direction === 'rtl' ? (
                <ArrowRight className="me-1.5 h-4 w-4" />
              ) : (
                <ArrowLeft className="me-1.5 h-4 w-4" />
              )}
              {t.actions.back}
            </Button>
          ) : null}

          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {result ? t.actions.close : t.actions.cancel}
          </Button>

          {step === 'input' ? (
            <Button type="button" onClick={handleParse} disabled={!rawText.trim()}>
              {t.input.parse}
              {direction === 'rtl' ? (
                <ArrowLeft className="ms-1.5 h-4 w-4" />
              ) : (
                <ArrowRight className="ms-1.5 h-4 w-4" />
              )}
            </Button>
          ) : null}

          {step === 'mapping' ? (
            <Button type="button" onClick={handleContinueToPreview}>
              {t.actions.continue}
              {direction === 'rtl' ? (
                <ArrowLeft className="ms-1.5 h-4 w-4" />
              ) : (
                <ArrowRight className="ms-1.5 h-4 w-4" />
              )}
            </Button>
          ) : null}

          {step === 'preview' && !result ? (
            <Button
              type="button"
              onClick={handleImport}
              disabled={importableRows.length === 0 || bulkImportMutation.isPending}
            >
              {bulkImportMutation.isPending ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="me-1.5 h-4 w-4" />
              )}
              {t.actions.import(formatNumber(importableRows.length))}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------------- *
 * Step indicator
 * ----------------------------------------------------------------------- */

function StepIndicator({ step, labels }: { step: Step; labels: ReturnType<typeof useCsvImportLabels> }) {
  const order: Step[] = ['input', 'mapping', 'preview'];
  const names: Record<Step, string> = {
    input: labels.steps.input,
    mapping: labels.steps.mapping,
    preview: labels.steps.preview,
  };
  const activeIndex = order.indexOf(step);
  return (
    <div className="flex items-center gap-2 text-xs">
      {order.map((s, index) => {
        const active = index === activeIndex;
        const done = index < activeIndex;
        return (
          <div key={s} className="flex items-center gap-2">
            <span
              className={[
                'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium',
                active
                  ? 'bg-primary text-primary-foreground'
                  : done
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground',
              ].join(' ')}
            >
              {formatNumber(index + 1)}
            </span>
            <span className={active ? 'font-medium' : 'text-muted-foreground'}>{names[s]}</span>
            {index < order.length - 1 ? <span className="text-muted-foreground">·</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------- *
 * Step 1 — input
 * ----------------------------------------------------------------------- */

function InputStep({
  labels,
  rawText,
  fileName,
  fileInputRef,
  onFileChange,
  onRawTextChange,
  onDownloadTemplate,
}: {
  labels: ReturnType<typeof useCsvImportLabels>;
  rawText: string;
  fileName: string;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRawTextChange: (value: string) => void;
  onDownloadTemplate: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="csv-import-file">{labels.input.fileLabel}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            id="csv-import-file"
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={onFileChange}
            className="hidden"
          />
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <FileText className="me-1.5 h-4 w-4" />
            {labels.input.chooseFile}
          </Button>
          <span className="text-sm text-muted-foreground">{fileName || labels.input.noFile}</span>
        </div>
        <p className="text-xs text-muted-foreground">{labels.input.fileHint}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="csv-import-paste">{labels.input.orPaste}</Label>
        <Textarea
          id="csv-import-paste"
          value={rawText}
          onChange={(event) => onRawTextChange(event.target.value)}
          placeholder={labels.input.pastePlaceholder}
          className="min-h-48 font-mono text-xs"
        />
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={onDownloadTemplate}>
        <Download className="me-1.5 h-4 w-4" />
        {labels.input.downloadTemplate}
      </Button>
    </div>
  );
}

/* ----------------------------------------------------------------------- *
 * Step 2 — column mapping
 * ----------------------------------------------------------------------- */

function MappingStep({
  labels,
  docLabels,
  headers,
  dataRows,
  mapping,
  delimiterLabel,
  parsedSummary,
  onMappingChange,
}: {
  labels: ReturnType<typeof useCsvImportLabels>;
  docLabels: ReturnType<typeof useDocumentsLabels>;
  headers: string[];
  dataRows: Array<Record<string, string>>;
  mapping: Record<string, CsvTargetField>;
  delimiterLabel: string;
  parsedSummary: string;
  onMappingChange: (header: string, target: CsvTargetField) => void;
}) {
  const firstRow = dataRows[0] ?? {};
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-start">{labels.mapping.heading}</p>
        <p className="text-xs text-muted-foreground text-start">{labels.mapping.hint}</p>
        <p className="mt-1 text-xs text-muted-foreground text-start">
          {parsedSummary} {labels.input.delimiterDetected(delimiterLabel)}
        </p>
      </div>

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{labels.mapping.columnHeader}</th>
              <th className="px-3 py-2 text-start font-medium">{labels.mapping.targetHeader}</th>
              <th className="px-3 py-2 text-start font-medium">{labels.mapping.sampleHeader}</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((header, index) => {
              const sample = (firstRow[header] ?? '').slice(0, 60);
              return (
                <tr key={`${header}-${index}`} className="border-t">
                  <td className="px-3 py-2 align-top font-medium">{header || '—'}</td>
                  <td className="px-3 py-2 align-top">
                    <Select
                      value={mapping[header] ?? '__none'}
                      onValueChange={(value) => onMappingChange(header, value as CsvTargetField)}
                    >
                      <SelectTrigger className="h-8 w-full min-w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{labels.mapping.none}</SelectItem>
                        {TARGET_FIELDS.map((field) => (
                          <SelectItem key={field} value={field}>
                            {labels.mapping.targets[field]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2 align-top text-muted-foreground">
                    {renderSample(header, sample, mapping[header], docLabels)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderSample(
  _header: string,
  sample: string,
  target: CsvTargetField | undefined,
  docLabels: ReturnType<typeof useDocumentsLabels>,
): string {
  if (!sample) return '—';
  if (target === 'type') {
    return docLabels.enums.types[sample.trim().toLowerCase()] ?? sample;
  }
  if (target === 'confidentiality') {
    return docLabels.enums.confidentiality[sample.trim().toLowerCase()] ?? sample;
  }
  return sample;
}

/* ----------------------------------------------------------------------- *
 * Step 3 — validation preview + options + result
 * ----------------------------------------------------------------------- */

function PreviewStep({
  labels,
  docLabels,
  rows,
  validCount,
  overCap,
  batchId,
  sourceSystem,
  shouldIndex,
  result,
  onBatchIdChange,
  onSourceSystemChange,
  onShouldIndexChange,
}: {
  labels: ReturnType<typeof useCsvImportLabels>;
  docLabels: ReturnType<typeof useDocumentsLabels>;
  rows: ValidatedRow[];
  validCount: number;
  overCap: boolean;
  batchId: string;
  sourceSystem: string;
  shouldIndex: boolean;
  result: LexDocumentBulkImportResult | null;
  onBatchIdChange: (value: string) => void;
  onSourceSystemChange: (value: string) => void;
  onShouldIndexChange: (value: boolean) => void;
}) {
  const invalidCount = rows.length - validCount;
  const visibleRows = rows.slice(0, PREVIEW_LIMIT);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="csv-batch-id">{labels.options.batchId}</Label>
          <Input
            id="csv-batch-id"
            value={batchId}
            onChange={(event) => onBatchIdChange(event.target.value)}
            placeholder={labels.options.batchIdPlaceholder}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="csv-source-system">{labels.options.sourceSystem}</Label>
          <Input
            id="csv-source-system"
            value={sourceSystem}
            onChange={(event) => onSourceSystemChange(event.target.value)}
            placeholder={labels.options.sourceSystemPlaceholder}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
        <div>
          <Label htmlFor="csv-index">{labels.options.indexLabel}</Label>
          <p className="text-xs text-muted-foreground">{labels.options.indexHint}</p>
        </div>
        <Switch
          id="csv-index"
          checked={shouldIndex}
          onCheckedChange={onShouldIndexChange}
          aria-label={labels.options.indexAria}
        />
      </div>

      <div className="rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{labels.preview.heading}</p>
          <p className="text-sm text-muted-foreground">
            {labels.preview.validCount(formatNumber(validCount), formatNumber(rows.length))}
            {invalidCount > 0 ? ` · ${labels.preview.invalidCount(formatNumber(invalidCount))}` : ''}
          </p>
        </div>

        {overCap ? (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-warning-500/10 p-2 text-xs text-warning-700 dark:text-warning-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{labels.preview.capWarning(formatNumber(MAX_ROWS), formatNumber(validCount))}</span>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{labels.preview.noValidRows}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-start font-medium">{labels.preview.rowColumn}</th>
                  <th className="px-2 py-1 text-start font-medium">{labels.preview.titleColumn}</th>
                  <th className="px-2 py-1 text-start font-medium">{labels.preview.typeColumn}</th>
                  <th className="px-2 py-1 text-start font-medium">{labels.preview.confidentialityColumn}</th>
                  <th className="px-2 py-1 text-start font-medium">{labels.preview.issuesColumn}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.rowNumber} className="border-t align-top">
                    <td className="px-2 py-1.5">
                      {row.valid ? (
                        <span className="inline-flex items-center gap-1 text-success-600 dark:text-success-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {formatNumber(row.rowNumber)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <XCircle className="h-3.5 w-3.5" />
                          {formatNumber(row.rowNumber)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.rawTitle || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {docLabels.enums.types[row.payload.type] ?? row.payload.type}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {docLabels.enums.confidentiality[row.payload.confidentiality] ?? row.payload.confidentiality}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.issues.length > 0 ? (
                        <span className="text-xs text-destructive">{row.issues.join('; ')}</span>
                      ) : (
                        <span className="text-xs text-success-600 dark:text-success-300">{labels.preview.valid}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hiddenCount > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {labels.preview.moreRows(formatNumber(hiddenCount))}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {result ? <ResultSummary result={result} labels={labels} /> : null}
    </div>
  );
}

function ResultSummary({
  result,
  labels,
}: {
  result: LexDocumentBulkImportResult;
  labels: ReturnType<typeof useCsvImportLabels>;
}) {
  const failedItems = result.items.filter((item) => item.status !== 'imported').slice(0, 5);
  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="font-medium">{labels.result.title}</p>
      <p className="mt-1 text-muted-foreground">
        {labels.result.summary(
          result.batch_id,
          formatNumber(result.succeeded),
          formatNumber(result.failed),
          formatNumber(result.requested),
        )}
      </p>
      {failedItems.length > 0 ? (
        <div className="mt-3 space-y-1 text-xs text-destructive">
          {failedItems.map((item) => (
            <p key={`${item.index}-${item.title ?? 'item'}`}>
              {labels.result.itemError(item.index + 1, item.error || labels.result.itemErrorFallback)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/* ----------------------------------------------------------------------- *
 * Pure helpers (mapping / validation / template)
 * ----------------------------------------------------------------------- */

/**
 * autoMap fuzzy-matches each detected header to a target field by normalised
 * name / synonym. A target is claimed by at most one header (first match wins),
 * so duplicate-ish headers don't all grab `title`.
 */
function autoMap(headers: string[]): Record<string, CsvTargetField> {
  const mapping: Record<string, CsvTargetField> = {};
  const claimed = new Set<Exclude<CsvTargetField, '__none'>>();

  for (const header of headers) {
    const norm = normalizeHeaderKey(header);
    let match: Exclude<CsvTargetField, '__none'> | undefined;
    for (const field of TARGET_FIELDS) {
      if (claimed.has(field)) continue;
      if (FIELD_SYNONYMS[field].some((syn) => syn === norm)) {
        match = field;
        break;
      }
    }
    if (match) {
      mapping[header] = match;
      claimed.add(match);
    } else {
      mapping[header] = '__none';
    }
  }
  return mapping;
}

function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

function isConfidentiality(value: string): value is Confidentiality {
  return (CONFIDENTIALITY as readonly string[]).includes(value);
}

/**
 * validateRows transforms each parsed CSV record into a candidate document
 * payload using the column mapping, and validates it. `type` defaults to
 * `other` and `confidentiality` to `internal` when blank; non-blank invalid
 * enum values flag the row as invalid.
 */
function validateRows(
  dataRows: Array<Record<string, string>>,
  mapping: Record<string, CsvTargetField>,
  labels: ReturnType<typeof useCsvImportLabels>,
): ValidatedRow[] {
  // Invert the mapping: target field -> source header (last wins).
  const fieldToHeader = new Map<Exclude<CsvTargetField, '__none'>, string>();
  for (const [header, target] of Object.entries(mapping)) {
    if (target !== '__none') fieldToHeader.set(target, header);
  }

  const valueFor = (record: Record<string, string>, field: Exclude<CsvTargetField, '__none'>): string => {
    const header = fieldToHeader.get(field);
    return header ? (record[header] ?? '').trim() : '';
  };

  return dataRows.map((record, index) => {
    const issues: string[] = [];

    const rawTitle = valueFor(record, 'title');
    if (!rawTitle) issues.push(labels.issues.titleRequired);

    const rawType = valueFor(record, 'type').toLowerCase();
    let type: DocumentType = 'other';
    if (rawType) {
      if (isDocumentType(rawType)) type = rawType;
      else issues.push(labels.issues.typeInvalid(rawType));
    }

    const rawConfidentiality = valueFor(record, 'confidentiality').toLowerCase();
    let confidentiality: Confidentiality = 'internal';
    if (rawConfidentiality) {
      if (isConfidentiality(rawConfidentiality)) confidentiality = rawConfidentiality;
      else issues.push(labels.issues.confidentialityInvalid(rawConfidentiality));
    }

    const metadata: Record<string, string> = {};
    for (const field of METADATA_FIELDS) {
      const value = valueFor(record, field);
      if (value) metadata[field] = value;
    }

    const tagsCell = fieldToHeader.has('tags') ? valueFor(record, 'tags') : '';
    const payload: BulkDocumentPayload = {
      title: rawTitle,
      type,
      description: valueFor(record, 'description'),
      category: valueFor(record, 'category'),
      confidentiality,
      tags: tagsCell ? splitTagsCell(tagsCell) : [],
      metadata,
    };

    return {
      rowNumber: index + 1,
      payload,
      rawTitle,
      rawType,
      rawConfidentiality,
      issues,
      valid: issues.length === 0,
    };
  });
}

const TEMPLATE_HEADERS = [
  'title', 'type', 'description', 'category', 'confidentiality', 'tags',
  'folder_path', 'jurisdiction', 'retention_policy', 'source_record_id',
];
const TEMPLATE_EXAMPLE = [
  'Legacy Board Policy',
  'policy',
  'Migrated policy with OCR text.',
  'Governance',
  'privileged',
  'board;ksa',
  'Legacy/Governance',
  'KSA',
  'board-records-10y',
  'LEG-001',
];

/**
 * downloadCsvTemplate builds a CSV string (header + one example row) and
 * triggers a browser download via a Blob object URL. Cells are quoted and
 * `"`-escaped per RFC-4180.
 */
function downloadCsvTemplate(filename: string) {
  const toLine = (cells: string[]) => cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
  const csv = `${toLine(TEMPLATE_HEADERS)}\r\n${toLine(TEMPLATE_EXAMPLE)}\r\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
