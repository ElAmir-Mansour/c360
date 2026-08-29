'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Server, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useDataTable } from '@/hooks/use-data-table';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { ColumnDef } from '@tanstack/react-table';
import type {
  AIInferenceServer,
  ComputeBackendType,
  InferenceServerStatus,
} from '@/types/ai-governance';
import { ModelCard } from '../_components/model-card';
import { computeBackendLabel, inferenceServerStatusLabel } from '../_lib/enum-labels';
import { useAdminT } from '../../_lib/admin-i18n';

const BACKEND_TYPES: ComputeBackendType[] = [
  'inline_go',
  'vllm_gpu',
  'vllm_cpu',
  'llamacpp_cpu',
  'llamacpp_gpu',
  'bitnet_cpu',
  'onnx_cpu',
  'onnx_gpu',
];

const STATUS_VARIANTS: Record<InferenceServerStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  provisioning: 'outline',
  healthy: 'default',
  degraded: 'secondary',
  offline: 'destructive',
  decommissioned: 'secondary',
};

export default function ComputePage() {
  const labels = useAdminT();
  const { locale } = useLocaleOrDefault();
  const c = labels.aiCompute;
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AIInferenceServer | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [backendType, setBackendType] = useState<ComputeBackendType>('llamacpp_cpu');
  const [baseUrl, setBaseUrl] = useState('');
  const [healthEndpoint, setHealthEndpoint] = useState('/health');
  const [modelName, setModelName] = useState('');
  const [quantization, setQuantization] = useState('');
  const [cpuCores, setCpuCores] = useState('');
  const [memoryMb, setMemoryMb] = useState('');
  const [gpuType, setGpuType] = useState('');
  const [gpuCount, setGpuCount] = useState('0');
  const [maxConcurrent, setMaxConcurrent] = useState('4');
  const [streamCapable, setStreamCapable] = useState(false);

  const { tableProps, refetch } = useDataTable<AIInferenceServer>({
    queryKey: 'ai-inference-servers',
    fetchFn: (params) => enterpriseApi.ai.listServers(params),
    defaultPageSize: 20,
    defaultSort: { column: 'name', direction: 'asc' },
  });

  const serversQuery = useQuery({
    queryKey: ['ai-inference-servers-all'],
    queryFn: () => enterpriseApi.ai.listServers({ page: 1, per_page: 200 }),
  });

  const allServers = serversQuery.data?.data ?? [];
  const healthyCount = allServers.filter((s) => s.status === 'healthy').length;
  const cpuCount = allServers.filter((s) =>
    ['llamacpp_cpu', 'bitnet_cpu', 'onnx_cpu', 'vllm_cpu'].includes(s.backend_type),
  ).length;
  const gpuCountTotal = allServers.filter((s) =>
    ['vllm_gpu', 'llamacpp_gpu', 'onnx_gpu'].includes(s.backend_type),
  ).length;

  const resetForm = () => {
    setName('');
    setBackendType('llamacpp_cpu');
    setBaseUrl('');
    setHealthEndpoint('/health');
    setModelName('');
    setQuantization('');
    setCpuCores('');
    setMemoryMb('');
    setGpuType('');
    setGpuCount('0');
    setMaxConcurrent('4');
    setStreamCapable(false);
  };

  const handleCreate = async () => {
    try {
      setSaving(true);
      await enterpriseApi.ai.createServer({
        name,
        backend_type: backendType,
        base_url: baseUrl,
        health_endpoint: healthEndpoint,
        model_name: modelName || null,
        quantization: quantization || null,
        cpu_cores: cpuCores ? Number(cpuCores) : null,
        memory_mb: memoryMb ? Number(memoryMb) : null,
        gpu_type: gpuType || null,
        gpu_count: Number(gpuCount) || 0,
        max_concurrent: Number(maxConcurrent) || 4,
        stream_capable: streamCapable,
        metadata: {},
      });
      showSuccess(c.toastRegistered);
      setFormOpen(false);
      resetForm();
      await Promise.all([refetch(), serversQuery.refetch()]);
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await enterpriseApi.ai.deleteServer(deleteTarget.id);
      showSuccess(c.toastDecommissioned);
      setDeleteTarget(null);
      await Promise.all([refetch(), serversQuery.refetch()]);
    } catch (error) {
      showApiError(error);
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusChange = useCallback(
    async (server: AIInferenceServer, status: InferenceServerStatus) => {
      try {
        await enterpriseApi.ai.updateServerStatus(server.id, { status });
        showSuccess(c.toastStatusUpdated.replace('{status}', inferenceServerStatusLabel(status, locale)));
        await Promise.all([refetch(), serversQuery.refetch()]);
      } catch (error) {
        showApiError(error);
      }
    },
    [refetch, serversQuery, c, locale],
  );

  const columns: ColumnDef<AIInferenceServer>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: c.colName,
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="text-xs text-muted-foreground">{row.original.base_url}</p>
          </div>
        ),
      },
      {
        accessorKey: 'backend_type',
        header: c.colBackend,
        cell: ({ row }) => (
          <Badge variant="outline">{computeBackendLabel(row.original.backend_type, locale)}</Badge>
        ),
      },
      {
        accessorKey: 'model_name',
        header: c.colModel,
        cell: ({ row }) => (
          <div className="text-sm">
            <p>{row.original.model_name ?? '—'}</p>
            {row.original.quantization && (
              <p className="text-xs text-muted-foreground">{row.original.quantization}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: c.colStatus,
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANTS[row.original.status]}>
            {inferenceServerStatusLabel(row.original.status, locale)}
          </Badge>
        ),
      },
      {
        id: 'resources',
        header: c.colResources,
        cell: ({ row }) => {
          const s = row.original;
          const parts: string[] = [];
          if (s.cpu_cores) parts.push(`${s.cpu_cores} CPU`);
          if (s.memory_mb) parts.push(`${s.memory_mb} MB`);
          if (s.gpu_count > 0) parts.push(`${s.gpu_count}× ${s.gpu_type ?? 'GPU'}`);
          return <span className="text-sm text-muted-foreground">{parts.join(' · ') || '—'}</span>;
        },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {row.original.status !== 'healthy' && row.original.status !== 'decommissioned' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleStatusChange(row.original, 'healthy')}
              >
                <RefreshCw className="me-1 h-3 w-3" />
                {c.markHealthy}
              </Button>
            )}
            {row.original.status !== 'decommissioned' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteTarget(row.original)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [handleStatusChange, c, locale],
  );

  return (
    <PermissionRedirect permission="admin:read">
      <div className="space-y-6">
        <PageHeader
          title={labels.aiCompute.title}
          description={labels.aiCompute.description}
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="me-1.5 h-4 w-4" />
                {labels.aiCompute.addServer}
              </Button>
              <Button variant="outline" onClick={() => void Promise.all([refetch(), serversQuery.refetch()])}>
                {labels.aiCompute.refresh}
              </Button>
            </div>
          }
        />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ModelCard label={labels.aiCompute.cardTotalServers} value={allServers.length} tone="sky" helper={labels.aiCompute.cardTotalServersHelper} />
          <ModelCard label={labels.aiCompute.cardHealthy} value={healthyCount} tone="emerald" helper={labels.aiCompute.cardHealthyHelper} />
          <ModelCard label={labels.aiCompute.cardCpu} value={cpuCount} tone="sky" helper={labels.aiCompute.cardCpuHelper} />
          <ModelCard label={labels.aiCompute.cardGpu} value={gpuCountTotal} tone="sky" helper={labels.aiCompute.cardGpuHelper} />
        </section>

        <div className="rounded-3xl border border-border/70 bg-card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <Server className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-h3 font-semibold">{labels.aiCompute.serversHeading}</h2>
              <p className="text-sm text-muted-foreground">
                {labels.aiCompute.serversHeadingDesc}
              </p>
            </div>
          </div>
          <DataTable
            {...tableProps}
            columns={columns}
            onSortChange={() => undefined}
            emptyState={{
              icon: Server,
              title: c.noServersTitle,
              description: c.noServersDesc,
            }}
          />
        </div>
      </div>

      {/* Register Server Dialog */}
      <Dialog open={formOpen} onOpenChange={(open) => { if (!open) resetForm(); setFormOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{labels.aiCompute.registerTitle}</DialogTitle>
            <DialogDescription>
              {labels.aiCompute.registerDesc}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="server-name">{labels.aiCompute.fieldName}</Label>
              <Input id="server-name" placeholder={labels.aiCompute.phServerName} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>{labels.aiCompute.fieldBackendType}</Label>
              <Select value={backendType} onValueChange={(v) => setBackendType(v as ComputeBackendType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BACKEND_TYPES.map((bt) => (
                    <SelectItem key={bt} value={bt}>{computeBackendLabel(bt, locale)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="base-url">{labels.aiCompute.fieldBaseUrl}</Label>
              <Input id="base-url" placeholder="http://localhost:8081/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="health-endpoint">{labels.aiCompute.fieldHealthEndpoint}</Label>
              <Input id="health-endpoint" value={healthEndpoint} onChange={(e) => setHealthEndpoint(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="model-name">{labels.aiCompute.fieldModelName}</Label>
                <Input id="model-name" placeholder="llama-3.1-8b-instruct" value={modelName} onChange={(e) => setModelName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="quantization">{labels.aiCompute.fieldQuantization}</Label>
                <Input id="quantization" placeholder="Q4_0" value={quantization} onChange={(e) => setQuantization(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="cpu-cores">{labels.aiCompute.fieldCpuCores}</Label>
                <Input id="cpu-cores" type="number" value={cpuCores} onChange={(e) => setCpuCores(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="memory-mb">{labels.aiCompute.fieldMemoryMb}</Label>
                <Input id="memory-mb" type="number" value={memoryMb} onChange={(e) => setMemoryMb(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="max-concurrent">{labels.aiCompute.fieldMaxConcurrent}</Label>
                <Input id="max-concurrent" type="number" value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="gpu-type">{labels.aiCompute.fieldGpuType}</Label>
                <Input id="gpu-type" placeholder="A100" value={gpuType} onChange={(e) => setGpuType(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="gpu-count">{labels.aiCompute.fieldGpuCount}</Label>
                <Input id="gpu-count" type="number" value={gpuCount} onChange={(e) => setGpuCount(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="stream-capable"
                checked={streamCapable}
                onCheckedChange={(checked) => setStreamCapable(checked === true)}
              />
              <Label htmlFor="stream-capable" className="cursor-pointer">{labels.aiCompute.fieldStreaming}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFormOpen(false); resetForm(); }}>{labels.aiCompute.cancel}</Button>
            <Button onClick={handleCreate} disabled={saving || !name || !baseUrl}>
              {saving ? labels.aiCompute.registering : labels.aiCompute.registerServer}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.aiCompute.decommissionTitle}</DialogTitle>
            <DialogDescription>
              {labels.aiCompute.decommissionDescPrefix} <strong>{deleteTarget?.name}</strong> {labels.aiCompute.decommissionDescSuffix}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{labels.aiCompute.cancel}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? labels.aiCompute.decommissioning : labels.aiCompute.decommission}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PermissionRedirect>
  );
}
