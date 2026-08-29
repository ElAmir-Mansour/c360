'use client';

import { ChangeEvent } from 'react';
import { AlertCircle, Database, History, Upload } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatNumber } from '@/lib/format';
import type { AIValidationDatasetType, AIValidationPreview } from '@/types/ai-governance';
import { useAdminT } from '../../../../_lib/admin-i18n';

interface DatasetSelectorProps {
  datasetType: AIValidationDatasetType;
  timeRange: string;
  customText: string;
  customParseError: string | null;
  preview: AIValidationPreview | null;
  previewError: string | null;
  previewLoading: boolean;
  onDatasetTypeChange: (value: AIValidationDatasetType) => void;
  onTimeRangeChange: (value: string) => void;
  onCustomTextChange: (value: string) => void;
  onCustomFileLoad: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function DatasetSelector({
  datasetType,
  timeRange,
  customText,
  customParseError,
  preview,
  previewError,
  previewLoading,
  onDatasetTypeChange,
  onTimeRangeChange,
  onCustomTextChange,
  onCustomFileLoad,
}: DatasetSelectorProps) {
  const labels = useAdminT();
  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{labels.aiExtra.datasetSelection}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-2">
            <Label>{labels.aiExtra.source}</Label>
            <Select value={datasetType} onValueChange={(value) => onDatasetTypeChange(value as AIValidationDatasetType)}>
              <SelectTrigger>
                <SelectValue placeholder={labels.aiExtra.phSelectDataset} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="historical">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4" />
                    {labels.aiExtra.histAlerts}
                  </div>
                </SelectItem>
                <SelectItem value="custom">
                  <div className="flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    {labels.aiExtra.customUpload}
                  </div>
                </SelectItem>
                <SelectItem value="live_replay" disabled>
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    {labels.aiExtra.liveReplay}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {datasetType === 'historical' ? (
            <div className="space-y-2">
              <Label>{labels.aiExtra.timeRange}</Label>
              <Select value={timeRange} onValueChange={onTimeRangeChange}>
                <SelectTrigger>
                  <SelectValue placeholder={labels.aiExtra.phSelectTimeRange} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30d">{labels.aiExtra.last30}</SelectItem>
                  <SelectItem value="90d">{labels.aiExtra.last90}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        {datasetType === 'custom' ? (
          <div className="space-y-4 rounded-2xl border border-dashed border-border/80 bg-secondary/70 p-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.45fr_0.55fr]">
              <div className="space-y-2">
                <Label htmlFor="validation-file">{labels.aiExtra.uploadJson}</Label>
                <Input id="validation-file" type="file" accept=".json,application/json" onChange={onCustomFileLoad} />
                <p className="text-sm text-muted-foreground">
                  {labels.aiExtra.expectedFormat} <code>[{'{'}&quot;input_hash&quot;: &quot;...&quot;, &quot;expected_label&quot;: &quot;threat&quot;{'}'}]</code>
                </p>
              </div>
              <div className="space-y-2">
                <Label>{labels.aiExtra.pasteJson}</Label>
                <Textarea
                  value={customText}
                  onChange={(event) => onCustomTextChange(event.target.value)}
                  rows={8}
                  className="font-mono text-xs"
                  placeholder='[{"input_hash":"...","expected_label":"threat"}]'
                />
              </div>
            </div>
            {customParseError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{labels.aiExtra.customInvalid}</AlertTitle>
                <AlertDescription>{customParseError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        {preview ? (
          <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
            <div className="text-sm text-foreground/70">
              {formatNumber(preview.dataset_size)} samples ({formatNumber(preview.positive_count)} positive, {formatNumber(preview.negative_count)} negative)
            </div>
            {preview.dataset_size < 50 ? (
              <div className="mt-2 text-sm font-medium text-status-error">
                {labels.aiExtra.validationDisabled}
              </div>
            ) : null}
            {preview.warnings.map((warning) => (
              <div key={warning} className="mt-2 text-sm text-warning-700 dark:text-warning-300">
                {warning}
              </div>
            ))}
          </div>
        ) : null}

        {previewLoading ? <div className="text-sm text-muted-foreground">{labels.aiExtra.checkingSamples}</div> : null}
        {previewError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{labels.aiExtra.previewFailed}</AlertTitle>
            <AlertDescription>{previewError}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
