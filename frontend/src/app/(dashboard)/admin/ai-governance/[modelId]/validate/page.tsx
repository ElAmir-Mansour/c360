'use client';

import { ChangeEvent, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Play, RefreshCw, ShieldCheck, SplitSquareVertical } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { enterpriseApi } from '@/lib/enterprise';
import {
  downloadBlob,
  formatDateTime,
  formatNumber,
  formatPercentage,
  parseApiError,
  titleCase,
} from '@/lib/format';
import { showApiError, showSuccess, showWarning } from '@/lib/toast';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import type {
  AIModelVersion,
  AIRegisteredModel,
  AIValidationLabel,
  AIValidationMetricsSummary,
  AIValidationPreview,
  AIValidationResult,
} from '@/types/ai-governance';
import { ComparisonIndicator } from './_components/comparison-indicator';
import { ConfusionMatrix } from './_components/confusion-matrix';
import { DatasetSelector } from './_components/dataset-selector';
import { FNSampleTable } from './_components/fn-sample-table';
import { FPSampleTable } from './_components/fp-sample-table';
import { MetricsCards } from './_components/metrics-cards';
import { RecommendationBanner } from './_components/recommendation-banner';
import { ROCCurveChart } from './_components/roc-curve-chart';
import { SeverityBreakdownTable } from './_components/severity-breakdown-table';
import {
  artifactTypeLabel,
  validationCopy,
  validationMetricLabel,
  versionStatusLabel,
} from '../../_lib/enum-labels';
import { useAdminT } from '../../../_lib/admin-i18n';

type CustomValidationRow = {
  input_hash: string;
  expected_label: AIValidationLabel;
};

type ExportFormat = 'json' | 'markdown';

export default function AIModelValidationPage() {
  const labels = useAdminT();
  const { locale } = useLocaleOrDefault();
  const v = labels.aiValidate;
  const copy = validationCopy(locale);
  const params = useParams<{ modelId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const modelId = params?.modelId ?? '';

  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [datasetType, setDatasetType] = useState<'historical' | 'custom' | 'live_replay'>('historical');
  const [timeRange, setTimeRange] = useState('30d');
  const [customText, setCustomText] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showPreviousDiff, setShowPreviousDiff] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');

  const modelQuery = useQuery({
    queryKey: ['ai-model', modelId],
    enabled: Boolean(modelId),
    queryFn: () => enterpriseApi.ai.getModel(modelId),
  });

  const versionsQuery = useQuery({
    queryKey: ['ai-model-versions', modelId],
    enabled: Boolean(modelId),
    queryFn: () => enterpriseApi.ai.listVersions(modelId),
  });

  useEffect(() => {
    if (selectedVersionId || !versionsQuery.data?.length) {
      return;
    }
    const requestedVersionId = searchParams?.get('versionId');
    const fallbackVersion =
      versionsQuery.data.find((item) => item.id === requestedVersionId) ?? versionsQuery.data[0];
    setSelectedVersionId(fallbackVersion.id);
  }, [selectedVersionId, searchParams, versionsQuery.data]);

  useEffect(() => {
    setShowPreviousDiff(false);
    setRejectOpen(false);
    setRejectReason('');
    setExportOpen(false);
    setExportFormat('json');
  }, [selectedVersionId]);

  const selectedVersion = versionsQuery.data?.find((item) => item.id === selectedVersionId) ?? null;
  const customParse = parseCustomData(customText, locale);
  const customRowCount = customParse.data?.length ?? 0;

  const previewQuery = useQuery({
    queryKey: ['ai-validation-preview', modelId, selectedVersionId, datasetType, timeRange, customText],
    enabled:
      Boolean(selectedVersionId) &&
      datasetType !== 'live_replay' &&
      (datasetType !== 'custom' || (customParse.data !== null && customRowCount > 0)),
    queryFn: () =>
      enterpriseApi.ai.previewValidation(modelId, selectedVersionId, {
        dataset_type: datasetType,
        time_range: datasetType === 'historical' ? timeRange : undefined,
        custom_data: datasetType === 'custom' ? customParse.data : undefined,
      }),
    retry: false,
  });

  const latestValidationQuery = useQuery({
    queryKey: ['ai-validation-latest', modelId, selectedVersionId],
    enabled: Boolean(selectedVersionId),
    queryFn: async () => {
      try {
        return await enterpriseApi.ai.latestValidation(modelId, selectedVersionId);
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },
  });

  const historyQuery = useQuery({
    queryKey: ['ai-validation-history', modelId, selectedVersionId],
    enabled: Boolean(selectedVersionId),
    queryFn: async () => {
      try {
        return await enterpriseApi.ai.validationHistory(modelId, selectedVersionId, 8);
      } catch (error) {
        if (isNotFound(error)) {
          return [];
        }
        throw error;
      }
    },
  });

  const runValidationMutation = useMutation({
    mutationFn: () =>
      enterpriseApi.ai.validate(modelId, selectedVersionId, {
        dataset_type: datasetType,
        time_range: datasetType === 'historical' ? timeRange : undefined,
        custom_data: datasetType === 'custom' ? customParse.data : undefined,
      }),
    onSuccess: (nextResult) => {
      queryClient.setQueryData(['ai-validation-latest', modelId, selectedVersionId], nextResult);
      void queryClient.invalidateQueries({ queryKey: ['ai-validation-history', modelId, selectedVersionId] });
      void queryClient.invalidateQueries({ queryKey: ['ai-model', modelId] });
      void queryClient.invalidateQueries({ queryKey: ['ai-model-versions', modelId] });
      showSuccess(
        v.toastValidationCompleted,
        copy.validationCompletedDetail(
          selectedVersion?.model_slug ?? copy.fallbackModel,
          selectedVersion?.version_number ?? '',
        ),
      );
    },
    onError: showApiError,
  });

  const promoteShadowMutation = useMutation({
    mutationFn: () => enterpriseApi.ai.startShadow(modelId, { version_id: selectedVersionId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-model', modelId] });
      void queryClient.invalidateQueries({ queryKey: ['ai-model-versions', modelId] });
      showSuccess(v.toastShadowStarted, copy.shadowStartedDetail);
    },
    onError: showApiError,
  });

  const failVersionMutation = useMutation({
    mutationFn: (reason: string) => enterpriseApi.ai.failVersion(modelId, selectedVersionId, { reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-model', modelId] });
      void queryClient.invalidateQueries({ queryKey: ['ai-model-versions', modelId] });
      setRejectOpen(false);
      setRejectReason('');
      showSuccess(v.toastVersionFailed, copy.versionFailedDetail);
    },
    onError: showApiError,
  });

  const model = modelQuery.data?.model ?? null;
  const result = latestValidationQuery.data ?? null;
  const preview = previewQuery.data ?? null;
  const previewError = previewQuery.isError ? parseApiError(previewQuery.error) : null;
  const validationHistory = historyQuery.data ?? [];
  const previousValidation = result
    ? validationHistory.find((item) => item.id !== result.id) ?? null
    : validationHistory[0] ?? null;
  const hasRuleTypeBreakdown = Boolean(result?.by_rule_type && Object.keys(result.by_rule_type).length > 0);

  const runBlockedReason = validationBlockReason({
    selectedVersionId,
    datasetType,
    customParseError: customParse.error,
    customRowCount,
    preview,
    previewLoading: previewQuery.isFetching,
    previewError,
    locale,
  });
  const rejectBlockedReason = failureBlockReason(selectedVersion, locale);
  const shadowBlockedReason = shadowPromotionBlockReason(selectedVersion, result, locale);

  const refreshPage = async () => {
    await Promise.all([
      modelQuery.refetch(),
      versionsQuery.refetch(),
      latestValidationQuery.refetch(),
      historyQuery.refetch(),
      previewQuery.refetch(),
    ]);
  };

  return (
    <PermissionRedirect permission="admin:read">
      <div className="space-y-6">
        <PageHeader
          title={model?.name ?? labels.aiValidate.pageTitle}
          description={labels.aiValidate.description}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedVersionId} onValueChange={setSelectedVersionId}>
                <SelectTrigger className="min-w-[220px]">
                  <SelectValue placeholder={labels.aiValidate.selectVersion} />
                </SelectTrigger>
                <SelectContent>
                  {(versionsQuery.data ?? []).map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      v{version.version_number} · {versionStatusLabel(version.status, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => void refreshPage()}>
                <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                {labels.aiValidate.refresh}
              </Button>
              <Button
                onClick={() => {
                  if (runBlockedReason) {
                    showWarning(v.toastValidationBlocked, runBlockedReason);
                    return;
                  }
                  runValidationMutation.mutate();
                }}
                disabled={!selectedVersionId || runValidationMutation.isPending || Boolean(runBlockedReason)}
              >
                <Play className="me-1.5 h-3.5 w-3.5" />
                {labels.aiValidate.runValidation}
              </Button>
            </div>
          }
        />

        {selectedVersion ? (
          <Card className="overflow-hidden border-border/70">
            <CardContent className="grid grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-4">
              <div>
                <div className="text-xs uppercase tracking-caps-xwide text-muted-foreground">{labels.aiValidate.version}</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-foreground">
                  v{selectedVersion.version_number}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-caps-xwide text-muted-foreground">{labels.aiValidate.status}</div>
                <div className="mt-2">
                  <Badge variant={versionBadgeVariant(selectedVersion.status)}>
                    {versionStatusLabel(selectedVersion.status, locale)}
                  </Badge>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-caps-xwide text-muted-foreground">{labels.aiValidate.artifact}</div>
                <div className="mt-2 text-sm font-medium">{artifactTypeLabel(selectedVersion.artifact_type, locale)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-caps-xwide text-muted-foreground">{labels.aiValidate.lastValidation}</div>
                <div className="mt-2 text-sm font-medium">
                  {result ? formatDateTime(result.validated_at) : labels.aiValidate.noValidationRecorded}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <DatasetSelector
          datasetType={datasetType}
          timeRange={timeRange}
          customText={customText}
          customParseError={customParse.error}
          preview={preview}
          previewError={previewError}
          previewLoading={previewQuery.isFetching}
          onDatasetTypeChange={setDatasetType}
          onTimeRangeChange={setTimeRange}
          onCustomTextChange={setCustomText}
          onCustomFileLoad={(event) => handleCustomFile(event, setCustomText)}
        />

        {runBlockedReason ? (
          <Alert variant="warning">
            <AlertTitle>{labels.aiValidate.validationBlocked}</AlertTitle>
            <AlertDescription>{runBlockedReason}</AlertDescription>
          </Alert>
        ) : null}

        {result ? (
          <div className="space-y-6">
            {result.warnings.map((warning) => (
              <Alert key={warning} variant="warning">
                <AlertTitle>{labels.aiValidate.validationWarning}</AlertTitle>
                <AlertDescription>{warning}</AlertDescription>
              </Alert>
            ))}

            <MetricsCards result={result} />

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <ConfusionMatrix result={result} />
              <ROCCurveChart result={result} />
            </div>

            <div className={`grid gap-4 ${hasRuleTypeBreakdown ? 'xl:grid-cols-2' : ''}`}>
              <SeverityBreakdownTable breakdown={result.by_severity} />
              {hasRuleTypeBreakdown ? (
                <SeverityBreakdownTable
                  title={labels.aiValidate.ruleTypeBreakdown}
                  label={labels.aiValidate.ruleType}
                  breakdown={result.by_rule_type ?? {}}
                />
              ) : null}
            </div>

            <FPSampleTable samples={result.false_positive_samples} />
            <FNSampleTable samples={result.false_negative_samples} />

            <RecommendationBanner result={result} />

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>{labels.aiValidate.actions}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => {
                      if (shadowBlockedReason) {
                        showWarning(v.toastPromotionBlocked, shadowBlockedReason);
                        return;
                      }
                      promoteShadowMutation.mutate();
                    }}
                    disabled={Boolean(shadowBlockedReason) || promoteShadowMutation.isPending}
                  >
                    <ShieldCheck className="me-1.5 h-3.5 w-3.5" />
                    {labels.aiValidate.promoteToShadow}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setRejectOpen(true)}
                    disabled={Boolean(rejectBlockedReason)}
                  >
                    <SplitSquareVertical className="me-1.5 h-3.5 w-3.5" />
                    {labels.aiValidate.rejectNeedsImprovement}
                  </Button>
                  <Button variant="outline" onClick={() => setExportOpen(true)}>
                    <Download className="me-1.5 h-3.5 w-3.5" />
                    {labels.aiValidate.exportReport}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!previousValidation}
                    onClick={() => setShowPreviousDiff((current) => !current)}
                  >
                    {labels.aiValidate.compareWithPrevious}
                  </Button>
                </div>
                {(shadowBlockedReason || rejectBlockedReason) ? (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {shadowBlockedReason ? <div>{copy.shadowPromotionPrefix} {shadowBlockedReason}</div> : null}
                    {rejectBlockedReason ? <div>{copy.rejectionFlowPrefix} {rejectBlockedReason}</div> : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {showPreviousDiff && previousValidation ? (
              <Card className="border-border/70">
                <CardHeader>
                  <CardTitle>{labels.aiValidate.previousDiffTitle}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    {copy.previousComparison(formatDateTime(previousValidation.validated_at))}
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      [validationMetricLabel('precision', locale), result.precision - previousValidation.precision, false],
                      [validationMetricLabel('recall', locale), result.recall - previousValidation.recall, false],
                      [validationMetricLabel('f1Score', locale), result.f1_score - previousValidation.f1_score, false],
                      [
                        validationMetricLabel('falsePositiveRate', locale),
                        result.false_positive_rate - previousValidation.false_positive_rate,
                        true,
                      ],
                    ].map(([label, delta, inverse]) => (
                      <div key={label as string} className="rounded-2xl border border-border/70 bg-secondary/70 p-4">
                        <div className="text-sm font-medium text-foreground">{label as string}</div>
                        <div className="mt-3">
                          <ComparisonIndicator
                            delta={delta as number}
                            inverse={inverse as boolean}
                            label={labels.aiValidate.vsPreviousValidation}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : (
          <Card className="border-border/70">
            <CardContent className="p-4 text-sm text-muted-foreground sm:p-6">
              {labels.aiValidate.noResultYet}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.aiValidate.rejectTitle}</DialogTitle>
            <DialogDescription>
              {labels.aiValidate.rejectDesc}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">{labels.aiValidate.improvementNotes}</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={5}
              placeholder={labels.aiValidate.phImprovement}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              {labels.aiValidate.cancel}
            </Button>
            <Button
              onClick={() => failVersionMutation.mutate(rejectReason.trim())}
              disabled={Boolean(rejectBlockedReason) || !rejectReason.trim() || failVersionMutation.isPending}
            >
              {labels.aiValidate.saveMarkFailed}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.aiValidate.exportTitle}</DialogTitle>
            <DialogDescription>
              {labels.aiValidate.exportDesc}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{labels.aiValidate.format}</Label>
            <Select value={exportFormat} onValueChange={(value) => setExportFormat(value as ExportFormat)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="markdown">{labels.aiValidate.structuredReport}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              {labels.aiValidate.cancel}
            </Button>
            <Button
              onClick={() => {
                if (!result) {
                  showWarning(v.toastExportUnavailable, v.toastRunFirst);
                  return;
                }
                exportValidationReport(model, selectedVersion, result, previousValidation, exportFormat);
                setExportOpen(false);
              }}
            >
              {labels.aiValidate.download}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PermissionRedirect>
  );
}

function parseCustomData(raw: string, locale: AppLocale): { data: CustomValidationRow[] | null; error: string | null } {
  const copy = validationCopy(locale);
  if (!raw.trim()) {
    return { data: [], error: null };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return { data: null, error: copy.customDataArray };
    }
    const data = parsed.map((item, index) => {
      const record = item as Record<string, unknown>;
      const inputHash = String(record.input_hash ?? '').trim();
      const expectedLabel = String(record.expected_label ?? '').trim();
      if (!inputHash) {
        throw new Error(copy.rowInputHash(index + 1));
      }
      if (expectedLabel !== 'threat' && expectedLabel !== 'benign') {
        throw new Error(copy.rowExpectedLabel(index + 1));
      }
      return {
        input_hash: inputHash,
        expected_label: expectedLabel,
      } satisfies CustomValidationRow;
    });
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : copy.invalidJson };
  }
}

function validationBlockReason(args: {
  selectedVersionId: string;
  datasetType: 'historical' | 'custom' | 'live_replay';
  customParseError: string | null;
  customRowCount: number;
  preview: AIValidationPreview | null;
  previewLoading: boolean;
  previewError: string | null;
  locale: AppLocale;
}) {
  const copy = validationCopy(args.locale);
  if (!args.selectedVersionId) {
    return copy.selectVersionForValidation;
  }
  if (args.datasetType === 'live_replay') {
    return copy.liveReplayUnavailable;
  }
  if (args.customParseError) {
    return args.customParseError;
  }
  if (args.datasetType === 'custom' && args.customRowCount === 0) {
    return copy.provideCustomData;
  }
  if (args.previewLoading) {
    return copy.previewLoading;
  }
  if (args.previewError) {
    return args.previewError;
  }
  if (!args.preview) {
    return copy.previewUnavailable;
  }
  if (args.preview.dataset_size < 50) {
    return copy.insufficientData;
  }
  return null;
}

function failureBlockReason(version: AIModelVersion | null, locale: AppLocale) {
  const copy = validationCopy(locale);
  if (!version) {
    return copy.selectVersionForRejection;
  }
  switch (version.status) {
    case 'production':
      return copy.productionRejectBlocked;
    case 'failed':
      return copy.alreadyFailed;
    case 'retired':
    case 'rolled_back':
      return copy.alreadyStatus(versionStatusLabel(version.status, locale));
    default:
      return null;
  }
}

function shadowPromotionBlockReason(
  version: AIModelVersion | null,
  result: AIValidationResult | null,
  locale: AppLocale,
) {
  const copy = validationCopy(locale);
  if (!version) {
    return copy.selectVersionForPromotion;
  }
  if (!result) {
    return copy.runValidationBeforePromotion;
  }
  if (result.recommendation !== 'promote') {
    return copy.promoteRecommendationRequired;
  }
  switch (version.status) {
    case 'shadow':
      return copy.alreadyShadow;
    case 'production':
      return copy.alreadyProduction;
    case 'failed':
    case 'retired':
    case 'rolled_back':
      return copy.statusCannotEnterShadow(versionStatusLabel(version.status, locale));
    default:
      return null;
  }
}

function versionBadgeVariant(status: AIModelVersion['status']) {
  switch (status) {
    case 'production':
      return 'success';
    case 'shadow':
    case 'staging':
      return 'warning';
    case 'failed':
    case 'retired':
      return 'destructive';
    default:
      return 'outline';
  }
}

function handleCustomFile(event: ChangeEvent<HTMLInputElement>, setCustomText: (value: string) => void) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : '';
    setCustomText(text);
  };
  reader.readAsText(file);
}

function exportValidationReport(
  model: AIRegisteredModel | null,
  version: AIModelVersion | null,
  result: AIValidationResult,
  previousValidation: AIValidationResult | null,
  format: ExportFormat,
) {
  if (format === 'json') {
    const filename = `model-validation-${model?.slug ?? 'model'}-v${version?.version_number ?? 'latest'}.json`;
    downloadBlob(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }), filename);
    return;
  }

  const filename = `model-validation-${model?.slug ?? 'model'}-v${version?.version_number ?? 'latest'}.md`;
  const report = buildStructuredValidationReport(model, version, result, previousValidation);
  downloadBlob(new Blob([report], { type: 'text/markdown;charset=utf-8' }), filename);
}

function buildStructuredValidationReport(
  model: AIRegisteredModel | null,
  version: AIModelVersion | null,
  result: AIValidationResult,
  previousValidation: AIValidationResult | null,
) {
  const lines = [
    '# Model Validation Report',
    '',
    `- Model: ${model?.name ?? 'Unknown model'} (${model?.slug ?? 'unknown'})`,
    `- Version: v${version?.version_number ?? 'unknown'}`,
    `- Status: ${titleCase(version?.status ?? 'unknown')}`,
    `- Dataset Type: ${titleCase(result.dataset_type)}`,
    `- Validated At: ${formatDateTime(result.validated_at)}`,
    `- Duration: ${formatNumber(result.duration_ms)} ms`,
    `- Recommendation: ${titleCase(result.recommendation)}`,
    `- Recommendation Reason: ${result.recommendation_reason}`,
    '',
    '## Dataset Summary',
    '',
    `- Total Samples: ${formatNumber(result.dataset_size)}`,
    `- Positive Samples: ${formatNumber(result.positive_count)}`,
    `- Negative Samples: ${formatNumber(result.negative_count)}`,
    '',
    '## Metrics',
    '',
    '| Metric | Value | Delta vs Production | Delta vs Previous |',
    '| --- | --- | --- | --- |',
    `| Precision | ${formatPercentage(result.precision, 1)} | ${formatDelta(result.deltas?.precision)} | ${formatDelta(previousValidation ? result.precision - previousValidation.precision : null)} |`,
    `| Recall | ${formatPercentage(result.recall, 1)} | ${formatDelta(result.deltas?.recall)} | ${formatDelta(previousValidation ? result.recall - previousValidation.recall : null)} |`,
    `| F1 Score | ${formatPercentage(result.f1_score, 1)} | ${formatDelta(result.deltas?.f1_score)} | ${formatDelta(previousValidation ? result.f1_score - previousValidation.f1_score : null)} |`,
    `| False Positive Rate | ${formatPercentage(result.false_positive_rate, 1)} | ${formatDelta(result.deltas?.false_positive_rate)} | ${formatDelta(previousValidation ? result.false_positive_rate - previousValidation.false_positive_rate : null)} |`,
    `| Accuracy | ${formatPercentage(result.accuracy, 1)} | ${result.production_metrics ? formatPercentage(result.accuracy - result.production_metrics.accuracy, 1) : 'N/A'} | ${formatDelta(previousValidation ? result.accuracy - previousValidation.accuracy : null)} |`,
    `| AUC | ${formatPercentage(result.auc, 1)} | ${result.production_metrics?.auc !== undefined ? formatPercentage(result.auc - (result.production_metrics.auc ?? 0), 1) : 'N/A'} | ${formatDelta(previousValidation ? result.auc - previousValidation.auc : null)} |`,
    '',
    '## Confusion Matrix',
    '',
    '| TP | FP | FN | TN |',
    '| --- | --- | --- | --- |',
    `| ${formatNumber(result.true_positives)} | ${formatNumber(result.false_positives)} | ${formatNumber(result.false_negatives)} | ${formatNumber(result.true_negatives)} |`,
    '',
    '## Warnings',
    '',
  ];

  if (result.warnings.length === 0) {
    lines.push('- None');
  } else {
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push('', '## Severity Breakdown', '');
  lines.push(...renderBreakdownTable(result.by_severity));

  if (result.by_rule_type && Object.keys(result.by_rule_type).length > 0) {
    lines.push('', '## Rule Type Breakdown', '');
    lines.push(...renderBreakdownTable(result.by_rule_type));
  }

  lines.push('', '## Sample False Positives', '');
  lines.push(...renderSampleList(result.false_positive_samples));
  lines.push('', '## Sample False Negatives', '');
  lines.push(...renderSampleList(result.false_negative_samples));

  return `${lines.join('\n')}\n`;
}

function renderBreakdownTable(breakdown: Record<string, AIValidationMetricsSummary>) {
  const entries = Object.entries(breakdown);
  if (entries.length === 0) {
    return ['No breakdown data recorded.'];
  }
  return [
    '| Group | Precision | Recall | F1 | Count |',
    '| --- | --- | --- | --- | --- |',
    ...entries.map(
      ([key, metrics]) =>
        `| ${titleCase(key)} | ${formatPercentage(metrics.precision, 1)} | ${formatPercentage(metrics.recall, 1)} | ${formatPercentage(metrics.f1_score, 1)} | ${formatNumber(metrics.dataset_size)} |`,
    ),
  ];
}

function renderSampleList(samples: AIValidationResult['false_positive_samples']) {
  if (samples.length === 0) {
    return ['No samples recorded.'];
  }
  return samples.slice(0, 10).map((sample) => {
    const ruleType = sample.rule_type || 'Unknown';
    const severity = sample.severity || 'unclassified';
    return `- ${sample.input_hash} | ${titleCase(sample.predicted_label)} vs ${titleCase(sample.expected_label)} | ${formatPercentage(sample.confidence, 1)} | ${titleCase(ruleType)} | ${titleCase(severity)} | ${sample.explanation || 'No explanation available.'}`;
  });
}

function formatDelta(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatPercentage(value, 1)}`;
}

function isNotFound(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status?: number }).status === 404;
}
