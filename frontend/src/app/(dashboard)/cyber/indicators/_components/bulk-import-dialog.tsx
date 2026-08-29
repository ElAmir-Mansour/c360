'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileJson, FileSpreadsheet, ListPlus, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { apiPost } from '@/lib/api';
import {
  detectIndicatorType,
  type IndicatorPreview,
  parseCsvText,
  parseStixPreview,
  parseTagsInput,
  validateIndicatorValue,
} from '@/lib/cyber-indicators';
import { API_ENDPOINTS } from '@/lib/constants';
import { INDICATOR_TYPE_OPTIONS } from '@/lib/cyber-threats';
import type { IndicatorSource, IndicatorType, ThreatSeverity } from '@/types/cyber';

import { useIndicatorLabels } from '../_lib/indicators-i18n';

type BulkImportLabels = ReturnType<typeof useIndicatorLabels>['bulkImport'];

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (summary: ImportSummary) => void;
}

interface ImportSummary {
  parsed: number;
  imported: number;
  skipped: number;
  failed: number;
}

type CsvMapping = Partial<Record<'type' | 'value' | 'severity' | 'source' | 'confidence' | 'description' | 'tags' | 'expires_at', string>>;

export function BulkImportDialog({
  open,
  onOpenChange,
  onSuccess,
}: BulkImportDialogProps) {
  const t = useIndicatorLabels();
  const [mode, setMode] = useState<'stix' | 'csv' | 'manual'>('stix');
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const [stixText, setStixText] = useState('');
  const [stixConflictMode, setStixConflictMode] = useState<'skip' | 'update' | 'fail'>('skip');

  const [csvText, setCsvText] = useState('');
  const [csvDefaultSeverity, setCsvDefaultSeverity] = useState<ThreatSeverity>('medium');
  const [csvDefaultSource, setCsvDefaultSource] = useState<IndicatorSource>('vendor');
  const [csvDefaultConfidence, setCsvDefaultConfidence] = useState(70);
  const [csvMapping, setCsvMapping] = useState<CsvMapping>({});

  const [manualText, setManualText] = useState('');
  const [manualSeverity, setManualSeverity] = useState<ThreatSeverity>('medium');
  const [manualSource, setManualSource] = useState<IndicatorSource>('manual');
  const [manualConfidence, setManualConfidence] = useState(80);
  const [manualTags, setManualTags] = useState('');

  useEffect(() => {
    if (!open) {
      setMode('stix');
      setImporting(false);
      setSummary(null);
      setStixText('');
      setCsvText('');
      setCsvMapping({});
      setManualText('');
      setManualTags('');
    }
  }, [open]);

  const stixPreview = useMemo(() => parseStixPreview(stixText), [stixText]);
  const csvPreview = useMemo(() => parseCsvText(csvText), [csvText]);
  const manualPreview = useMemo(() => {
    return manualText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((value) => ({
        value,
        type: detectIndicatorType(value),
      }));
  }, [manualText]);

  useEffect(() => {
    if (csvPreview.headers.length === 0) {
      return;
    }
    setCsvMapping((current) => {
      if (Object.keys(current).length > 0) {
        return current;
      }
      return {
        type: findHeader(csvPreview.headers, ['type', 'indicator_type']),
        value: findHeader(csvPreview.headers, ['value', 'indicator', 'ioc', 'observable']),
        severity: findHeader(csvPreview.headers, ['severity']),
        source: findHeader(csvPreview.headers, ['source', 'feed']),
        confidence: findHeader(csvPreview.headers, ['confidence', 'score']),
        description: findHeader(csvPreview.headers, ['description', 'context']),
        tags: findHeader(csvPreview.headers, ['tags', 'labels']),
        expires_at: findHeader(csvPreview.headers, ['expires_at', 'expiry']),
      };
    });
  }, [csvPreview.headers]);

  const csvRows = useMemo(() => {
    return csvPreview.rows.map((row) => {
      const value = csvMapping.value ? row[csvMapping.value] ?? '' : '';
      const type = normalizeIndicatorType(csvMapping.type ? row[csvMapping.type] : '') ?? detectIndicatorType(value);
      const severity = normalizeSeverity(csvMapping.severity ? row[csvMapping.severity] : '') ?? csvDefaultSeverity;
      const source = normalizeSource(csvMapping.source ? row[csvMapping.source] : '') ?? csvDefaultSource;
      const confidence = normalizeConfidence(csvMapping.confidence ? row[csvMapping.confidence] : '') ?? csvDefaultConfidence;
      const validationError = !type
        ? t.bulkImport.unableToInferType
        : validateIndicatorValue(type, value);
      return {
        row,
        type,
        value,
        severity,
        source,
        confidence,
        description: csvMapping.description ? row[csvMapping.description] ?? '' : '',
        tags: csvMapping.tags ? parseTagsInput(row[csvMapping.tags] ?? '') : [],
        expires_at: csvMapping.expires_at ? row[csvMapping.expires_at] ?? '' : '',
        validationError,
      };
    });
  }, [
    csvDefaultConfidence,
    csvDefaultSeverity,
    csvDefaultSource,
    csvMapping,
    csvPreview.rows,
    t.bulkImport.unableToInferType,
  ]);

  const validManualRows = useMemo(() => {
    return manualPreview.map((item) => ({
      ...item,
      validationError: item.type ? validateIndicatorValue(item.type, item.value) : t.bulkImport.unableToInferType,
    }));
  }, [manualPreview, t.bulkImport.unableToInferType]);

  async function handleImport() {
    try {
      setImporting(true);

      if (mode === 'stix') {
        if (!stixText.trim()) {
          toast.error(t.bulkImport.uploadStixFirst);
          return;
        }
        const payload = JSON.parse(stixText);
        const response = await apiPost<{ data: { count: number } }>(API_ENDPOINTS.CYBER_INDICATORS_BULK, {
          payload,
          source: 'stix_feed',
          conflict_mode: stixConflictMode,
        });
        const nextSummary = {
          parsed: stixPreview.length,
          imported: response.data.count,
          skipped: Math.max(stixPreview.length - response.data.count, 0),
          failed: 0,
        };
        setSummary(nextSummary);
        onSuccess?.(nextSummary);
        return;
      }

      if (mode === 'csv') {
        const rows = csvRows.filter((row) => !row.validationError && row.type);
        const nextSummary = await importStandaloneIndicators(rows.map((row) => ({
          type: row.type!,
          value: row.value.trim(),
          severity: row.severity,
          source: row.source,
          confidence: row.confidence / 100,
          description: row.description.trim() || undefined,
          tags: row.tags,
          expires_at: row.expires_at || undefined,
        })));
        nextSummary.parsed = csvRows.length;
        setSummary(nextSummary);
        onSuccess?.(nextSummary);
        return;
      }

      const rows = validManualRows.filter((row) => !row.validationError && row.type);
      const nextSummary = await importStandaloneIndicators(rows.map((row) => ({
        type: row.type!,
        value: row.value,
        severity: manualSeverity,
        source: manualSource,
        confidence: manualConfidence / 100,
        tags: parseTagsInput(manualTags),
      })));
      nextSummary.parsed = validManualRows.length;
      setSummary(nextSummary);
      onSuccess?.(nextSummary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.bulkImport.importFailed);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t.bulkImport.title}</DialogTitle>
          <DialogDescription>
            {t.bulkImport.description}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as typeof mode)} className="space-y-4">
          <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3">
            <TabsTrigger value="stix">
              <FileJson className="me-2 h-4 w-4" />
              {t.bulkImport.stixTab}
            </TabsTrigger>
            <TabsTrigger value="csv">
              <FileSpreadsheet className="me-2 h-4 w-4" />
              {t.bulkImport.csvTab}
            </TabsTrigger>
            <TabsTrigger value="manual">
              <ListPlus className="me-2 h-4 w-4" />
              {t.bulkImport.manualTab}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="stix" className="space-y-4">
            <FileInput
              accept=".json,application/json"
              label={t.bulkImport.stixBundleLabel}
              onTextLoaded={setStixText}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
              <div className="space-y-2">
                <Label>{t.bulkImport.conflictResolution}</Label>
                <Select value={stixConflictMode} onValueChange={(value) => setStixConflictMode(value as typeof stixConflictMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">{t.bulkImport.skipDuplicates}</SelectItem>
                    <SelectItem value="update">{t.bulkImport.updateExisting}</SelectItem>
                    <SelectItem value="fail">{t.bulkImport.failOnDuplicate}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t.bulkImport.conflictHelp}
                </p>
              </div>

              <PreviewPanel
                title={t.bulkImport.previewCount(stixPreview.length)}
                description={t.bulkImport.stixPreviewDesc}
                items={stixPreview}
                labels={t.bulkImport}
              />
            </div>
          </TabsContent>

          <TabsContent value="csv" className="space-y-4">
            <FileInput
              accept=".csv,text/csv"
              label={t.bulkImport.csvSourceLabel}
              onTextLoaded={setCsvText}
            />

            {csvPreview.headers.length > 0 && (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <SelectField
                    label={t.bulkImport.valueColumn}
                    value={csvMapping.value}
                    onChange={(value) => setCsvMapping((current) => ({ ...current, value: value || undefined }))}
                    options={csvPreview.headers}
                    labels={t.bulkImport}
                  />
                  <SelectField
                    label={t.bulkImport.typeColumn}
                    value={csvMapping.type}
                    onChange={(value) => setCsvMapping((current) => ({ ...current, type: value || undefined }))}
                    options={csvPreview.headers}
                    labels={t.bulkImport}
                  />
                  <SelectField
                    label={t.bulkImport.severityColumn}
                    value={csvMapping.severity}
                    onChange={(value) => setCsvMapping((current) => ({ ...current, severity: value || undefined }))}
                    options={csvPreview.headers}
                    labels={t.bulkImport}
                  />
                  <SelectField
                    label={t.bulkImport.sourceColumn}
                    value={csvMapping.source}
                    onChange={(value) => setCsvMapping((current) => ({ ...current, source: value || undefined }))}
                    options={csvPreview.headers}
                    labels={t.bulkImport}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <DefaultSelect
                    label={t.bulkImport.defaultSeverity}
                    value={csvDefaultSeverity}
                    onChange={(value) => setCsvDefaultSeverity(value as ThreatSeverity)}
                    options={['critical', 'high', 'medium', 'low']}
                  />
                  <DefaultSelect
                    label={t.bulkImport.defaultSource}
                    value={csvDefaultSource}
                    onChange={(value) => setCsvDefaultSource(value as IndicatorSource)}
                    options={['manual', 'stix_feed', 'osint', 'internal', 'vendor']}
                  />
                  <div className="space-y-2">
                    <Label>{t.bulkImport.defaultConfidence(csvDefaultConfidence)}</Label>
                    <Slider
                      value={[csvDefaultConfidence]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(value) => setCsvDefaultConfidence(value[0] ?? 0)}
                    />
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-border/70">
                  <div className="border-b border-border/70 bg-secondary px-4 py-3">
                    <p className="text-sm font-medium">{t.bulkImport.csvPreview}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.bulkImport.csvPreviewDesc}
                    </p>
                  </div>
                  <div className="max-h-72 overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b border-border/70">
                          <th className="px-4 py-2 text-start font-medium">{t.bulkImport.colType}</th>
                          <th className="px-4 py-2 text-start font-medium">{t.bulkImport.colValue}</th>
                          <th className="px-4 py-2 text-start font-medium">{t.bulkImport.colSeverity}</th>
                          <th className="px-4 py-2 text-start font-medium">{t.bulkImport.colSource}</th>
                          <th className="px-4 py-2 text-start font-medium">{t.bulkImport.colStatus}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvRows.slice(0, 10).map((row, index) => (
                          <tr
                            key={index}
                            className={row.validationError ? 'bg-error-50/80' : 'border-b border-border/60'}
                          >
                            <td className="px-4 py-2">{row.type ? getTypeLabel(row.type) : '—'}</td>
                            <td className="px-4 py-2 font-mono text-xs">{row.value || '—'}</td>
                            <td className="px-4 py-2">{row.severity}</td>
                            <td className="px-4 py-2">{row.source}</td>
                            <td className="px-4 py-2 text-xs">
                              {row.validationError ? (
                                <span className="font-medium text-error-500">{row.validationError}</span>
                              ) : (
                                <span className="text-primary">{t.bulkImport.ready}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="manual" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
              <div className="space-y-2">
                <Label htmlFor="manual-indicators">{t.bulkImport.indicatorsLabel}</Label>
                <Textarea
                  id="manual-indicators"
                  rows={14}
                  placeholder={'203.0.113.15\nmalicious-login.example\n8b1a9953c4611296a827abf8c47804d7'}
                  value={manualText}
                  onChange={(event) => setManualText(event.target.value)}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-4 rounded-2xl border border-border/70 p-4">
                <DefaultSelect
                  label={t.bulkImport.severityLabel}
                  value={manualSeverity}
                  onChange={(value) => setManualSeverity(value as ThreatSeverity)}
                  options={['critical', 'high', 'medium', 'low']}
                />
                <DefaultSelect
                  label={t.bulkImport.sourceLabel}
                  value={manualSource}
                  onChange={(value) => setManualSource(value as IndicatorSource)}
                  options={['manual', 'stix_feed', 'osint', 'internal', 'vendor']}
                />
                <div className="space-y-2">
                  <Label>{t.bulkImport.confidenceLabel(manualConfidence)}</Label>
                  <Slider
                    value={[manualConfidence]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(value) => setManualConfidence(value[0] ?? 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-tags">{t.bulkImport.commonTags}</Label>
                  <Input
                    id="manual-tags"
                    value={manualTags}
                    onChange={(event) => setManualTags(event.target.value)}
                    placeholder={t.bulkImport.commonTagsPlaceholder}
                  />
                </div>
              </div>
            </div>

            <PreviewPanel
              title={t.bulkImport.previewCount(manualPreview.length)}
              description={t.bulkImport.manualPreviewDesc}
              items={validManualRows.map((row) => ({
                type: row.type ?? 'user_agent',
                value: row.value,
                description: row.validationError ?? undefined,
              }))}
              showErrors
              labels={t.bulkImport}
            />
          </TabsContent>
        </Tabs>

        {summary && (
          <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
            <p className="text-sm font-semibold text-primary">{t.bulkImport.importSummary}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-sm text-primary">
              <Badge variant="secondary">{t.bulkImport.parsed(summary.parsed)}</Badge>
              <Badge variant="secondary">{t.bulkImport.imported(summary.imported)}</Badge>
              <Badge variant="secondary">{t.bulkImport.skipped(summary.skipped)}</Badge>
              <Badge variant="secondary">{t.bulkImport.failed(summary.failed)}</Badge>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.bulkImport.close}
          </Button>
          <Button type="button" onClick={handleImport} disabled={importing}>
            <Upload className="me-2 h-4 w-4" />
            {importing ? t.bulkImport.importing : t.bulkImport.importIndicators}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileInput({
  accept,
  label,
  onTextLoaded,
}: {
  accept: string;
  label: string;
  onTextLoaded: (text: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="file"
        accept={accept}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }
          const text = await file.text();
          onTextLoaded(text);
        }}
      />
    </div>
  );
}

function PreviewPanel({
  title,
  description,
  items,
  showErrors = false,
  labels,
}: {
  title: string;
  description: string;
  items: Array<IndicatorPreview>;
  showErrors?: boolean;
  labels: BulkImportLabels;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70">
      <div className="border-b border-border/70 bg-secondary px-4 py-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border/70">
              <th className="px-4 py-2 text-start font-medium">{labels.colType}</th>
              <th className="px-4 py-2 text-start font-medium">{labels.colValue}</th>
              {showErrors && <th className="px-4 py-2 text-start font-medium">{labels.colNote}</th>}
            </tr>
          </thead>
          <tbody>
            {items.length > 0 ? (
              items.slice(0, 12).map((item, index) => (
                <tr key={`${item.type}-${item.value}-${index}`} className="border-b border-border/60">
                  <td className="px-4 py-2">{getTypeLabel(item.type)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{item.value}</td>
                  {showErrors && <td className="px-4 py-2 text-xs text-muted-foreground">{item.description ?? labels.ready}</td>}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={showErrors ? 3 : 2} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {labels.nothingToPreview}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  labels,
}: {
  label: string;
  value?: string;
  onChange: (value?: string) => void;
  options: string[];
  labels: BulkImportLabels;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value ?? '__none__'} onValueChange={(next) => onChange(next === '__none__' ? undefined : next)}>
        <SelectTrigger>
          <SelectValue placeholder={labels.optional} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{labels.notMapped}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DefaultSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function findHeader(headers: string[], candidates: string[]): string | undefined {
  return headers.find((header) => candidates.includes(header.toLowerCase()));
}

function normalizeIndicatorType(value?: string): IndicatorType | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (INDICATOR_TYPE_OPTIONS.some((option) => option.value === normalized)) {
    return normalized as IndicatorType;
  }
  return detectIndicatorType(normalized);
}

function normalizeSeverity(value?: string): ThreatSeverity | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return null;
}

function normalizeSource(value?: string): IndicatorSource | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'manual' || normalized === 'stix_feed' || normalized === 'osint' || normalized === 'internal' || normalized === 'vendor') {
    return normalized;
  }
  return null;
}

function normalizeConfidence(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed <= 1 ? Math.round(parsed * 100) : Math.max(0, Math.min(100, parsed));
}

function getTypeLabel(type: IndicatorType): string {
  return INDICATOR_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

async function importStandaloneIndicators(
  items: Array<{
    type: IndicatorType;
    value: string;
    severity: ThreatSeverity;
    source: IndicatorSource;
    confidence: number;
    description?: string;
    tags?: string[];
    expires_at?: string;
  }>,
): Promise<ImportSummary> {
  if (items.length === 0) {
    return { parsed: 0, imported: 0, skipped: 0, failed: 0 };
  }

  const response = await apiPost<{
    data: { imported: number; skipped: number; failed: number };
  }>(API_ENDPOINTS.CYBER_INDICATORS_BATCH, {
    indicators: items,
    conflict_mode: 'update',
  });

  return {
    parsed: items.length,
    imported: response.data.imported,
    skipped: response.data.skipped,
    failed: response.data.failed,
  };
}
