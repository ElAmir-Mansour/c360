'use client';

import { useState } from 'react';
import { format, subDays } from 'date-fns';
import {
  Download,
  FileJson,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useT } from '@/components/providers/locale-provider';
import { showInfo, showApiError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import {
  useStartAuditExport,
  useAuditExportJob,
} from './use-platform-audit';

const EXPORT_COLUMN_IDS = [
  'created_at',
  'tenant_name',
  'actor_email',
  'action',
  'resource_type',
  'resource_id',
  'severity',
  'service',
  'ip_address',
  'entry_hash',
] as const;

const SERVICE_VALUES = [
  '',
  'iam-service',
  'cyber-service',
  'data-service',
  'file-service',
  'notification-service',
  'audit-service',
] as const;

const STATUS_TONE: Record<string, string> = {
  queued: 'border-info-300 text-info-700 dark:text-info-300',
  processing: 'border-warning-300 text-warning-700 dark:text-warning-300',
  completed: 'border-primary/30 text-primary',
  failed: 'border-destructive/30 text-destructive',
};

export function AuditExportTab() {
  const t = useT();
  const today = format(new Date(), 'yyyy-MM-dd');
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  const serviceLabel = (value: string): string =>
    value === ''
      ? t('platformConsole.audit.allServices')
      : t(`platformConsole.audit.svc_${value.replace('-service', '')}` as never);

  const columnLabel = (id: string): string =>
    t(`platformConsole.audit.exportCol_${id}` as never);

  const statusLabel = (s: string): string =>
    t(`platformConsole.audit.jobStatus_${s}` as never);

  const [exportFormat, setExportFormat] = useState<'csv' | 'ndjson'>('csv');
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [service, setService] = useState('');
  const [columns, setColumns] = useState<Set<string>>(
    new Set(EXPORT_COLUMN_IDS),
  );
  const [jobId, setJobId] = useState<string | null>(null);

  const start = useStartAuditExport();
  const job = useAuditExportJob(jobId);

  const jobStatus = job.data?.status;
  const inFlight =
    start.isPending || jobStatus === 'queued' || jobStatus === 'processing';

  const toggleColumn = (id: string) => {
    setColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStart = () => {
    start.mutate(
      {
        format: exportFormat,
        date_from: new Date(dateFrom).toISOString(),
        date_to: new Date(dateTo + 'T23:59:59').toISOString(),
        all_tenants: true,
        service: service || undefined,
        columns: Array.from(columns),
      },
      {
        onSuccess: (res) => {
          setJobId(res.job_id);
          showInfo(t('platformConsole.audit.exportQueuedToast'));
        },
        onError: (err) => showApiError(err),
      },
    );
  };

  const handleDownload = () => {
    const url =
      job.data?.download_url ??
      (jobId ? `/api/v1/audit/exports/${jobId}/download` : null);
    if (url) {
      window.open(url, '_blank', 'noopener');
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            {t('platformConsole.audit.exportCardTitle')}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t('platformConsole.audit.exportCardSubtitle')}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>{t('platformConsole.audit.format')}</Label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setExportFormat('csv')}
                aria-pressed={exportFormat === 'csv'}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors',
                  exportFormat === 'csv'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border hover:bg-muted/50',
                )}
              >
                <FileSpreadsheet className="h-4 w-4" aria-hidden />
                {t('platformConsole.audit.formatCsv')}
              </button>
              <button
                type="button"
                onClick={() => setExportFormat('ndjson')}
                aria-pressed={exportFormat === 'ndjson'}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors',
                  exportFormat === 'ndjson'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border hover:bg-muted/50',
                )}
              >
                <FileJson className="h-4 w-4" aria-hidden />
                {t('platformConsole.audit.formatNdjson')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="export-from">
                {t('platformConsole.audit.from')}
              </Label>
              <Input
                id="export-from"
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-to">{t('platformConsole.audit.to')}</Label>
              <Input
                id="export-to"
                type="date"
                value={dateTo}
                min={dateFrom}
                max={today}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="export-service">
              {t('platformConsole.audit.serviceOptional')}
            </Label>
            <select
              id="export-service"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={service}
              onChange={(e) => setService(e.target.value)}
            >
              {SERVICE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {serviceLabel(v)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            <Label>{t('platformConsole.audit.columns')}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EXPORT_COLUMN_IDS.map((id) => (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={columns.has(id)}
                    onCheckedChange={() => toggleColumn(id)}
                  />
                  {columnLabel(id)}
                </label>
              ))}
            </div>
          </div>

          <Button
            onClick={handleStart}
            disabled={inFlight || columns.size === 0}
            className="w-full"
          >
            {inFlight ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="me-2 h-4 w-4" aria-hidden />
            )}
            {inFlight
              ? t('platformConsole.audit.exportRunning')
              : t('platformConsole.audit.startExport')}
          </Button>
        </CardContent>
      </Card>

      {jobId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                {t('platformConsole.audit.exportJobTitle')}
              </CardTitle>
              <Badge
                variant="outline"
                className={cn('gap-1', STATUS_TONE[jobStatus ?? 'queued'])}
              >
                {jobStatus === 'completed' && (
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                )}
                {jobStatus === 'failed' && (
                  <XCircle className="h-3 w-3" aria-hidden />
                )}
                {(jobStatus === 'queued' || jobStatus === 'processing') && (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                )}
                {statusLabel(jobStatus ?? 'queued')}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4" aria-live="polite">
            <p className="font-mono text-xs text-muted-foreground">
              {t('platformConsole.audit.jobId').replace('{id}', jobId)}
            </p>

            {(jobStatus === 'queued' || jobStatus === 'processing') && (
              <Progress value={undefined} className="h-2 animate-pulse" />
            )}

            {job.error && (
              <p className="text-sm text-destructive">
                {t('platformConsole.audit.jobPollError')}
              </p>
            )}

            {jobStatus === 'failed' && (
              <p className="text-sm text-destructive">
                {job.data?.error ?? t('platformConsole.audit.exportFailed')}
              </p>
            )}

            {jobStatus === 'completed' && (
              <div className="space-y-3">
                {typeof job.data?.record_count === 'number' && (
                  <p className="text-sm text-muted-foreground">
                    {t('platformConsole.audit.recordsExported').replace(
                      '{count}',
                      formatNumber(job.data.record_count),
                    )}
                  </p>
                )}
                <Button onClick={handleDownload} className="w-full">
                  <Download className="me-2 h-4 w-4" aria-hidden />
                  {t('platformConsole.audit.download').replace(
                    '{format}',
                    exportFormat.toUpperCase(),
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
