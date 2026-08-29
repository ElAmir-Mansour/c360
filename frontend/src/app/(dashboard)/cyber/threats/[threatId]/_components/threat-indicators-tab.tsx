'use client';

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { downloadTextFile, formatDateTime } from '@/lib/utils';
import { getIndicatorTypeLabel, INDICATOR_TYPE_OPTIONS } from '@/lib/cyber-threats';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Plus, Radar } from 'lucide-react';
import { toast } from 'sonner';
import type { ThreatIndicator } from '@/types/cyber';
import { useThreatLabels } from '../../_lib/threats-i18n';

interface ThreatIndicatorsTabProps {
  threatId: string;
}

export function ThreatIndicatorsTab({ threatId }: ThreatIndicatorsTabProps) {
  const t = useThreatLabels();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({
    type: 'ip',
    value: '',
    severity: 'medium',
    confidence: 75,
    description: '',
  });
  const [busyIndicatorId, setBusyIndicatorId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['threat-indicators', threatId],
    queryFn: () => apiGet<{ data: ThreatIndicator[] }>(API_ENDPOINTS.CYBER_THREAT_INDICATORS(threatId)),
  });

  const indicators = data?.data ?? [];

  const handleToggle = useCallback(async (indicatorId: string, active: boolean) => {
    setBusyIndicatorId(indicatorId);
    try {
      await apiPut(API_ENDPOINTS.CYBER_INDICATOR_STATUS(indicatorId), { active });
      await refetch();
      toast.success(active ? t.indicatorsTab.indicatorActivated : t.indicatorsTab.indicatorDeactivated);
    } catch {
      toast.error(t.indicatorsTab.failedToUpdateState);
    } finally {
      setBusyIndicatorId(null);
    }
  }, [refetch, t.indicatorsTab]);

  const columns = useMemo<ColumnDef<ThreatIndicator>[]>(() => [
    {
      id: 'type',
      header: t.indicatorsTab.colType,
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {getIndicatorTypeLabel(row.original.type)}
        </Badge>
      ),
    },
    {
      id: 'value',
      accessorKey: 'value',
      header: t.indicatorsTab.colValue,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.value}</span>,
    },
    {
      id: 'severity',
      accessorKey: 'severity',
      header: t.indicatorsTab.colSeverity,
      cell: ({ row }) => <SeverityIndicator severity={row.original.severity} showLabel />,
    },
    {
      id: 'source',
      accessorKey: 'source',
      header: t.indicatorsTab.colSource,
      cell: ({ row }) => <span className="text-sm capitalize text-muted-foreground">{row.original.source.replace('_', ' ')}</span>,
    },
    {
      id: 'confidence',
      accessorKey: 'confidence',
      header: t.indicatorsTab.colConfidence,
      cell: ({ row }) => (
        <div className="min-w-[140px] space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{Math.round((row.original.confidence ?? 0) * 100)}%</span>
          </div>
          <Progress value={(row.original.confidence ?? 0) * 100} className="h-2" />
        </div>
      ),
    },
    {
      id: 'first_seen_at',
      accessorKey: 'first_seen_at',
      header: t.indicatorsTab.colFirstSeen,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.first_seen_at)}</span>,
    },
    {
      id: 'last_seen_at',
      accessorKey: 'last_seen_at',
      header: t.indicatorsTab.colLastSeen,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.last_seen_at)}</span>,
    },
    {
      id: 'active',
      accessorKey: 'active',
      header: t.indicatorsTab.colActive,
      cell: ({ row }) => (
        <Switch
          checked={row.original.active}
          disabled={busyIndicatorId === row.original.id}
          onCheckedChange={(checked) => void handleToggle(row.original.id, checked)}
          aria-label={t.indicatorsTab.toggleAria(row.original.value)}
        />
      ),
    },
    {
      id: 'expires_at',
      accessorKey: 'expires_at',
      header: t.indicatorsTab.colExpires,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.expires_at)}</span>,
    },
  ], [busyIndicatorId, handleToggle, t.indicatorsTab]);

  async function handleBulkDeactivate(selectedIds: string[]) {
    await Promise.all(selectedIds.map((id) => apiPut(API_ENDPOINTS.CYBER_INDICATOR_STATUS(id), { active: false })));
    await refetch();
    toast.success(t.indicatorsTab.selectedDeactivated);
  }

  async function handleAddIndicator() {
    if (!draft.value.trim()) {
      toast.error(t.indicatorsTab.valueRequired);
      return;
    }
    try {
      const result = await apiPost<{ data: ThreatIndicator; existed?: boolean }>(API_ENDPOINTS.CYBER_THREAT_INDICATORS(threatId), {
        type: draft.type,
        value: draft.value.trim(),
        severity: draft.severity,
        confidence: draft.confidence / 100,
        source: 'manual',
        description: draft.description.trim() || undefined,
      });
      setDraft({
        type: 'ip',
        value: '',
        severity: 'medium',
        confidence: 75,
        description: '',
      });
      setCreateOpen(false);
      await refetch();
      void queryClient.invalidateQueries({ queryKey: [`cyber-threat-${threatId}`] });
      toast.success(result.existed ? t.indicatorsTab.existingUpdated : t.indicatorsTab.indicatorAdded);
    } catch {
      toast.error(t.indicatorsTab.failedToAdd);
    }
  }

  function exportIndicators(selectedIds?: string[]) {
    const items = selectedIds && selectedIds.length > 0
      ? indicators.filter((indicator) => selectedIds.includes(indicator.id))
      : indicators;
    const lines = [
      ['type', 'value', 'severity', 'source', 'confidence', 'active', 'first_seen_at', 'last_seen_at', 'expires_at'].join(','),
      ...items.map((item) => ([
        item.type,
        csvEscape(item.value),
        item.severity,
        item.source,
        String(item.confidence),
        String(item.active),
        item.first_seen_at,
        item.last_seen_at,
        item.expires_at ?? '',
      ].join(','))),
    ];
    downloadTextFile(lines.join('\n'), `threat-${threatId}-indicators.csv`);
  }

  if (isLoading) return <LoadingSkeleton variant="card" />;
  if (error) return <ErrorState message={t.indicatorsTab.failedToLoad} onRetry={() => void refetch()} />;

  if (indicators.length === 0) {
    return (
      <>
        <EmptyState
          icon={Radar}
          title={t.indicatorsTab.emptyTitle}
          description={t.indicatorsTab.emptyDescription}
          action={{ label: t.indicatorsTab.addIndicator, onClick: () => setCreateOpen(true) }}
        />
        <AddIndicatorDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          draft={draft}
          setDraft={setDraft}
          onSubmit={handleAddIndicator}
          labels={t.indicatorsTab}
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t.indicatorsTab.addIndicator}
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={indicators}
          totalRows={indicators.length}
          page={1}
          pageSize={Math.max(indicators.length, 1)}
          onPageChange={() => undefined}
          onPageSizeChange={() => undefined}
          onSortChange={() => undefined}
          enableSelection
          bulkActions={[
            {
              label: t.indicatorsTab.deactivate,
              variant: 'destructive',
              onClick: handleBulkDeactivate,
              confirmMessage: t.indicatorsTab.deactivateConfirm,
            },
            {
              label: t.indicatorsTab.exportCsv,
              onClick: async (selectedIds) => {
                exportIndicators(selectedIds);
              },
            },
          ]}
          enableColumnToggle={false}
        />
      </div>

      <AddIndicatorDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        draft={draft}
        setDraft={setDraft}
        onSubmit={handleAddIndicator}
        labels={t.indicatorsTab}
      />
    </>
  );
}

interface AddIndicatorDialogLabels {
  dialogTitle: string;
  dialogDescription: string;
  type: string;
  severity: string;
  value: string;
  description: string;
  confidence: string;
  valuePlaceholder: string;
  descriptionPlaceholder: string;
  cancel: string;
  addIndicator: string;
  severityCritical: string;
  severityHigh: string;
  severityMedium: string;
  severityLow: string;
}

interface AddIndicatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: {
    type: string;
    value: string;
    severity: string;
    confidence: number;
    description: string;
  };
  setDraft: Dispatch<SetStateAction<{
    type: string;
    value: string;
    severity: string;
    confidence: number;
    description: string;
  }>>;
  onSubmit: () => void;
  labels: AddIndicatorDialogLabels;
}

function AddIndicatorDialog({ open, onOpenChange, draft, setDraft, onSubmit, labels }: AddIndicatorDialogProps) {
  const severityLabels: Record<string, string> = {
    critical: labels.severityCritical,
    high: labels.severityHigh,
    medium: labels.severityMedium,
    low: labels.severityLow,
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{labels.dialogTitle}</DialogTitle>
          <DialogDescription>
            {labels.dialogDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{labels.type}</label>
              <Select value={draft.type} onValueChange={(value) => setDraft((current) => ({ ...current, type: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INDICATOR_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{labels.severity}</label>
              <Select value={draft.severity} onValueChange={(value) => setDraft((current) => ({ ...current, severity: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['critical', 'high', 'medium', 'low'].map((option) => (
                    <SelectItem key={option} value={option}>{severityLabels[option] ?? option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{labels.value}</label>
            <Input
              value={draft.value}
              onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
              placeholder={labels.valuePlaceholder}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{labels.description}</label>
            <Textarea
              rows={3}
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder={labels.descriptionPlaceholder}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>{labels.confidence}</span>
              <span className="text-muted-foreground">{draft.confidence}%</span>
            </div>
            <Slider
              value={[draft.confidence]}
              max={100}
              step={1}
              onValueChange={(value) => setDraft((current) => ({ ...current, confidence: value[0] ?? 0 }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" onClick={onSubmit}>
            {labels.addIndicator}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
