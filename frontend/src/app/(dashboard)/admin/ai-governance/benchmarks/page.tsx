'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { BarChart3, Plus, Play, FlaskConical } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDataTable } from '@/hooks/use-data-table';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { ColumnDef } from '@tanstack/react-table';
import type {
  AIBenchmarkSuite,
  AIBenchmarkRun,
  AIInferenceServer,
  BenchmarkRunStatus,
} from '@/types/ai-governance';
import { ModelCard } from '../_components/model-card';
import { useAdminT } from '../../_lib/admin-i18n';
import { useT } from '@/components/providers/locale-provider';

const RUN_STATUS_VARIANTS: Record<BenchmarkRunStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'secondary',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'secondary',
};

export default function BenchmarksPage() {
  const labels = useAdminT();
  const b = labels.aiBenchmarks;
  const t = useT('admin');
  const router = useRouter();
  const [suiteFormOpen, setSuiteFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runTarget, setRunTarget] = useState<AIBenchmarkSuite | null>(null);
  const [selectedServer, setSelectedServer] = useState('');
  const [running, setRunning] = useState(false);

  // Suite form state
  const [suiteName, setSuiteName] = useState('');
  const [suiteDesc, setSuiteDesc] = useState('');
  const [modelSlug, setModelSlug] = useState('');
  const [warmupCount, setWarmupCount] = useState('3');
  const [iterationCount, setIterationCount] = useState('50');
  const [concurrency, setConcurrency] = useState('4');
  const [timeoutSeconds, setTimeoutSeconds] = useState('30');

  const serversQuery = useQuery({
    queryKey: ['ai-inference-servers-all'],
    queryFn: () => enterpriseApi.ai.listServers({ page: 1, per_page: 200 }),
  });

  const servers = serversQuery.data?.data ?? [];
  const healthyServers = servers.filter((s) => s.status === 'healthy');

  const { tableProps: suiteTableProps, refetch: refetchSuites } = useDataTable<AIBenchmarkSuite>({
    queryKey: 'ai-benchmark-suites',
    fetchFn: (params) => enterpriseApi.ai.listBenchmarkSuites(params),
    defaultPageSize: 20,
    defaultSort: { column: 'name', direction: 'asc' },
  });

  const { tableProps: runTableProps, refetch: refetchRuns } = useDataTable<AIBenchmarkRun>({
    queryKey: 'ai-benchmark-runs',
    fetchFn: (params) => enterpriseApi.ai.listBenchmarkRuns(params),
    defaultPageSize: 20,
    defaultSort: { column: 'created_at', direction: 'desc' },
  });

  const allRuns = runTableProps.data ?? [];
  const completedRuns = allRuns.filter((r) => r.status === 'completed');
  const avgLatency =
    completedRuns.length > 0
      ? completedRuns.reduce((sum, r) => sum + (r.avg_latency_ms ?? 0), 0) / completedRuns.length
      : 0;

  const resetSuiteForm = () => {
    setSuiteName('');
    setSuiteDesc('');
    setModelSlug('');
    setWarmupCount('3');
    setIterationCount('50');
    setConcurrency('4');
    setTimeoutSeconds('30');
  };

  const handleCreateSuite = async () => {
    try {
      setSaving(true);
      await enterpriseApi.ai.createBenchmarkSuite({
        name: suiteName,
        description: suiteDesc,
        model_slug: modelSlug,
        prompt_dataset: [],
        dataset_size: 0,
        warmup_count: Number(warmupCount),
        iteration_count: Number(iterationCount),
        concurrency: Number(concurrency),
        timeout_seconds: Number(timeoutSeconds),
        stream_enabled: false,
        max_retries: 3,
      });
      showSuccess(b.toastSuiteCreated);
      setSuiteFormOpen(false);
      resetSuiteForm();
      await refetchSuites();
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  const handleRunBenchmark = async () => {
    if (!runTarget || !selectedServer) return;
    try {
      setRunning(true);
      await enterpriseApi.ai.runBenchmark(runTarget.id, { server_id: selectedServer });
      showSuccess(b.toastBenchmarkStarted, `Running ${runTarget.name} against the selected server.`);
      setRunTarget(null);
      setSelectedServer('');
      await refetchRuns();
    } catch (error) {
      showApiError(error);
    } finally {
      setRunning(false);
    }
  };

  const suiteColumns: ColumnDef<AIBenchmarkSuite>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: b.colSuiteName,
        cell: ({ row }) => (
          <button
            className="text-start font-medium text-primary hover:underline"
            onClick={() => router.push(`/admin/ai-governance/benchmarks/${row.original.id}`)}
          >
            {row.original.name}
          </button>
        ),
      },
      {
        accessorKey: 'model_slug',
        header: b.colTargetModel,
        cell: ({ row }) => <Badge variant="outline">{row.original.model_slug}</Badge>,
      },
      {
        id: 'config',
        header: b.colConfiguration,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <span className="text-sm text-muted-foreground">
              {s.iteration_count} {b.iterSuffix} · {s.concurrency} {b.concSuffix} · {s.warmup_count} {b.warmupSuffix}
            </span>
          );
        },
      },
      {
        accessorKey: 'dataset_size',
        header: b.colPrompts,
        cell: ({ row }) => row.original.dataset_size,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => setRunTarget(row.original)}>
            <Play className="me-1 h-3 w-3" />
            {b.run}
          </Button>
        ),
      },
    ],
    [router, b],
  );

  const runColumns: ColumnDef<AIBenchmarkRun>[] = useMemo(
    () => [
      {
        accessorKey: 'model_name',
        header: b.colModel,
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.model_name}</p>
            {row.original.quantization && (
              <p className="text-xs text-muted-foreground">{row.original.quantization}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'backend_type',
        header: b.colBackend,
        cell: ({ row }) => <Badge variant="outline">{row.original.backend_type}</Badge>,
      },
      {
        accessorKey: 'status',
        header: b.colStatus,
        cell: ({ row }) => (
          <Badge variant={RUN_STATUS_VARIANTS[row.original.status]}>{row.original.status}</Badge>
        ),
      },
      {
        id: 'latency',
        header: b.colLatency,
        cell: ({ row }) => {
          const r = row.original;
          if (r.status !== 'completed') return '—';
          return (
            <div className="text-sm">
              <span className="font-medium">p50: {r.p50_latency_ms?.toFixed(0) ?? '—'}</span>
              <span className="ms-2 text-muted-foreground">p95: {r.p95_latency_ms?.toFixed(0) ?? '—'}</span>
            </div>
          );
        },
      },
      {
        id: 'throughput',
        header: b.colThroughput,
        cell: ({ row }) => {
          const r = row.original;
          if (r.status !== 'completed') return '—';
          return (
            <div className="text-sm">
              {r.tokens_per_second?.toFixed(1) ?? '—'} tok/s · {r.requests_per_second?.toFixed(1) ?? '—'} req/s
            </div>
          );
        },
      },
      {
        id: 'cost',
        header: b.colCost,
        cell: ({ row }) => {
          const r = row.original;
          if (!r.estimated_hourly_cost_usd) return '—';
          return <span className="text-sm">${r.estimated_hourly_cost_usd.toFixed(2)}/hr</span>;
        },
      },
      {
        accessorKey: 'created_at',
        header: b.colRunDate,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {new Date(row.original.created_at).toLocaleDateString()}
          </span>
        ),
      },
    ],
    [b],
  );

  return (
    <PermissionRedirect permission="admin:read">
      <div className="space-y-6">
        <PageHeader
          title={labels.aiBenchmarks.title}
          description={labels.aiBenchmarks.description}
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={() => setSuiteFormOpen(true)}>
                <Plus className="me-1.5 h-4 w-4" />
                {labels.aiBenchmarks.newSuite}
              </Button>
              <Button variant="outline" onClick={() => void Promise.all([refetchSuites(), refetchRuns()])}>
                {labels.aiBenchmarks.refresh}
              </Button>
            </div>
          }
        />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ModelCard
            label={labels.aiBenchmarks.cardSuites}
            value={suiteTableProps.totalRows ?? 0}
            tone="sky"
            helper={labels.aiBenchmarks.cardSuitesHelper}
          />
          <ModelCard
            label={labels.aiBenchmarks.cardTotalRuns}
            value={runTableProps.totalRows ?? 0}
            tone="sky"
            helper={labels.aiBenchmarks.cardTotalRunsHelper}
          />
          <ModelCard
            label={labels.aiBenchmarks.cardCompleted}
            value={completedRuns.length}
            tone="emerald"
            helper={labels.aiBenchmarks.cardCompletedHelper}
          />
          <ModelCard
            label={labels.aiBenchmarks.cardAvgLatency}
            value={avgLatency > 0 ? `${avgLatency.toFixed(0)} ms` : '—'}
            tone="gold"
            helper={labels.aiBenchmarks.cardAvgLatencyHelper}
          />
        </section>

        <Tabs defaultValue="suites">
          <TabsList>
            <TabsTrigger value="suites">{labels.aiBenchmarks.tabSuites}</TabsTrigger>
            <TabsTrigger value="runs">{labels.aiBenchmarks.tabRuns}</TabsTrigger>
          </TabsList>

          <TabsContent value="suites" className="mt-4">
            <div className="rounded-3xl border border-border/70 bg-card p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                  <FlaskConical className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-h3 font-semibold">{labels.aiBenchmarks.suitesHeading}</h2>
                  <p className="text-sm text-muted-foreground">
                    {labels.aiBenchmarks.suitesHeadingDesc}
                  </p>
                </div>
              </div>
              <DataTable
                {...suiteTableProps}
                columns={suiteColumns}
                onSortChange={() => undefined}
                emptyState={{
                  icon: FlaskConical,
                  title: b.noSuitesTitle,
                  description: b.noSuitesDesc,
                }}
              />
            </div>
          </TabsContent>

          <TabsContent value="runs" className="mt-4">
            <div className="rounded-3xl border border-border/70 bg-card p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                  <BarChart3 className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-h3 font-semibold">{labels.aiBenchmarks.runsHeading}</h2>
                  <p className="text-sm text-muted-foreground">
                    {labels.aiBenchmarks.runsHeadingDesc}
                  </p>
                </div>
              </div>
              <DataTable
                {...runTableProps}
                columns={runColumns}
                onSortChange={() => undefined}
                emptyState={{
                  icon: BarChart3,
                  title: b.noRunsTitle,
                  description: b.noRunsDesc,
                }}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Suite Dialog */}
      <Dialog open={suiteFormOpen} onOpenChange={(open) => { if (!open) resetSuiteForm(); setSuiteFormOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{labels.aiBenchmarks.createSuiteTitle}</DialogTitle>
            <DialogDescription>
              {labels.aiBenchmarks.createSuiteDesc}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="suite-name">{labels.aiBenchmarks.fieldSuiteName}</Label>
              <Input id="suite-name" placeholder={t('bp.suiteNamePlaceholder')} value={suiteName} onChange={(e) => setSuiteName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="suite-desc">{labels.aiBenchmarks.fieldDescription}</Label>
              <Input id="suite-desc" placeholder={labels.aiBenchmarks.phDescription} value={suiteDesc} onChange={(e) => setSuiteDesc(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="model-slug">{labels.aiBenchmarks.fieldModelSlug}</Label>
              <Input id="model-slug" placeholder="threat-scorer" value={modelSlug} onChange={(e) => setModelSlug(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="warmup">{labels.aiBenchmarks.fieldWarmup}</Label>
                <Input id="warmup" type="number" value={warmupCount} onChange={(e) => setWarmupCount(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="iterations">{labels.aiBenchmarks.fieldIterations}</Label>
                <Input id="iterations" type="number" value={iterationCount} onChange={(e) => setIterationCount(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="concurrency">{labels.aiBenchmarks.fieldConcurrency}</Label>
                <Input id="concurrency" type="number" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="timeout">{labels.aiBenchmarks.fieldTimeout}</Label>
                <Input id="timeout" type="number" value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSuiteFormOpen(false); resetSuiteForm(); }}>{labels.aiBenchmarks.cancel}</Button>
            <Button onClick={handleCreateSuite} disabled={saving || !suiteName || !modelSlug}>
              {saving ? labels.aiBenchmarks.creating : labels.aiBenchmarks.createSuiteBtn}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run Benchmark Dialog */}
      <Dialog open={Boolean(runTarget)} onOpenChange={(open) => { if (!open) { setRunTarget(null); setSelectedServer(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.aiBenchmarks.runBenchmarkTitle}</DialogTitle>
            <DialogDescription>
              {labels.aiBenchmarks.executePrefix} <strong>{runTarget?.name}</strong> {labels.aiBenchmarks.executeSuffix}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{labels.aiBenchmarks.selectServer}</Label>
              <Select value={selectedServer} onValueChange={setSelectedServer}>
                <SelectTrigger><SelectValue placeholder={labels.aiBenchmarks.phChooseServer} /></SelectTrigger>
                <SelectContent>
                  {healthyServers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.backend_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {healthyServers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {labels.aiBenchmarks.noHealthyServers}
                </p>
              )}
            </div>
            {runTarget && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{labels.aiBenchmarks.suiteConfig}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <p>{labels.aiBenchmarks.modelLabel} {runTarget.model_slug}</p>
                  <p>{labels.aiBenchmarks.iterationsLabel} {runTarget.iteration_count} ({labels.aiBenchmarks.warmupInline} {runTarget.warmup_count})</p>
                  <p>{labels.aiBenchmarks.concurrencyLabel} {runTarget.concurrency} · {labels.aiBenchmarks.timeoutInline} {runTarget.timeout_seconds}s</p>
                </CardContent>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRunTarget(null); setSelectedServer(''); }}>{labels.aiBenchmarks.cancel}</Button>
            <Button onClick={handleRunBenchmark} disabled={running || !selectedServer}>
              {running ? labels.aiBenchmarks.starting : labels.aiBenchmarks.startBenchmark}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PermissionRedirect>
  );
}
