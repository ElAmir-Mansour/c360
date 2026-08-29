'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Play, GitCompare } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import { useT } from '@/components/providers/locale-provider';
import type {
  AIBenchmarkRun,
  AIBenchmarkComparison,
  BenchmarkRunStatus,
} from '@/types/ai-governance';
import { ModelCard } from '../../_components/model-card';

const RUN_STATUS_VARIANTS: Record<BenchmarkRunStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'secondary',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'secondary',
};

export default function BenchmarkSuiteDetailPage() {
  const router = useRouter();
  const params = useParams();
  const suiteId = params?.suiteId as string;
  const t = useT('admin');

  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [selectedServer, setSelectedServer] = useState('');
  const [running, setRunning] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [comparison, setComparison] = useState<AIBenchmarkComparison | null>(null);
  const [comparing, setComparing] = useState(false);

  const suiteQuery = useQuery({
    queryKey: ['ai-benchmark-suite', suiteId],
    queryFn: () => enterpriseApi.ai.getBenchmarkSuite(suiteId),
    enabled: Boolean(suiteId),
  });

  const runsQuery = useQuery({
    queryKey: ['ai-benchmark-runs', suiteId],
    queryFn: () => enterpriseApi.ai.listBenchmarkRuns({ page: 1, per_page: 100, filters: { suite_id: suiteId } }),
    enabled: Boolean(suiteId),
  });

  const serversQuery = useQuery({
    queryKey: ['ai-inference-servers-all'],
    queryFn: () => enterpriseApi.ai.listServers({ page: 1, per_page: 200 }),
  });

  const suite = suiteQuery.data;
  const runs = runsQuery.data?.data ?? [];
  const servers = serversQuery.data?.data ?? [];
  const healthyServers = servers.filter((s) => s.status === 'healthy');
  const completedRuns = runs.filter((r) => r.status === 'completed');

  const handleRunBenchmark = async () => {
    if (!selectedServer) return;
    try {
      setRunning(true);
      await enterpriseApi.ai.runBenchmark(suiteId, { server_id: selectedServer });
      showSuccess(t('bd.started'));
      setRunDialogOpen(false);
      setSelectedServer('');
      await runsQuery.refetch();
    } catch (error) {
      showApiError(error);
    } finally {
      setRunning(false);
    }
  };

  const toggleCompare = (runId: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const handleCompare = async () => {
    if (compareIds.size < 2) return;
    try {
      setComparing(true);
      const result = await enterpriseApi.ai.compareRuns({ run_ids: Array.from(compareIds) });
      setComparison(result);
    } catch (error) {
      showApiError(error);
    } finally {
      setComparing(false);
    }
  };

  const bestLatency = completedRuns.length > 0
    ? Math.min(...completedRuns.map((r) => r.p50_latency_ms ?? Infinity))
    : null;
  const bestThroughput = completedRuns.length > 0
    ? Math.max(...completedRuns.map((r) => r.tokens_per_second ?? 0))
    : null;

  return (
    <PermissionRedirect permission="admin:read">
      <div className="space-y-6">
        <PageHeader
          title={suite?.name ?? t('bd.pageTitleFallback')}
          description={suite?.description ?? t('bd.pageDescFallback')}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => router.push('/admin/ai-governance/benchmarks')}>
                <ArrowLeft className="me-1.5 h-4 w-4" />
                {t('bd.back')}
              </Button>
              <Button onClick={() => setRunDialogOpen(true)}>
                <Play className="me-1.5 h-4 w-4" />
                {t('bd.run')}
              </Button>
              {compareIds.size >= 2 && (
                <Button variant="secondary" onClick={handleCompare} disabled={comparing}>
                  <GitCompare className="me-1.5 h-4 w-4" />
                  {comparing ? t('bd.comparing') : t('bd.compareN', { n: compareIds.size })}
                </Button>
              )}
            </div>
          }
        />

        {suite && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('bd.suiteConfig')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{t('bd.model')}</span>{' '}
                  <Badge variant="outline">{suite.model_slug}</Badge>
                </div>
                <div><span className="text-muted-foreground">{t('bd.warmup')}</span> {suite.warmup_count}</div>
                <div><span className="text-muted-foreground">{t('bd.iterations')}</span> {suite.iteration_count}</div>
                <div><span className="text-muted-foreground">{t('bd.concurrency')}</span> {suite.concurrency}</div>
                <div><span className="text-muted-foreground">{t('bd.timeout')}</span> {suite.timeout_seconds}s</div>
                <div><span className="text-muted-foreground">{t('bd.prompts')}</span> {suite.dataset_size}</div>
              </div>
            </CardContent>
          </Card>
        )}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ModelCard label={t('bd.cardTotalRuns')} value={runs.length} tone="sky" helper={t('bd.cardTotalRunsHelper')} />
          <ModelCard label={t('bd.cardCompleted')} value={completedRuns.length} tone="emerald" helper={t('bd.cardCompletedHelper')} />
          <ModelCard
            label={t('bd.cardBestLatency')}
            value={bestLatency != null && bestLatency < Infinity ? `${bestLatency.toFixed(0)} ms` : '—'}
            tone="gold"
            helper={t('bd.cardBestLatencyHelper')}
          />
          <ModelCard
            label={t('bd.cardBestThroughput')}
            value={bestThroughput != null && bestThroughput > 0 ? `${bestThroughput.toFixed(1)} tok/s` : '—'}
            tone="sky"
            helper={t('bd.cardBestThroughputHelper')}
          />
        </section>

        {/* Comparison Results */}
        {comparison && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitCompare className="h-5 w-5" />
                {t('bd.comparisonResults')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">{t('bd.monthlyCostDelta')}</p>
                  <p className={`text-2xl font-semibold ${comparison.cost_delta_monthly_usd < 0 ? 'text-primary' : 'text-status-error'}`}>
                    {comparison.cost_delta_monthly_usd < 0 ? '−' : '+'}${Math.abs(comparison.cost_delta_monthly_usd).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('bd.latencyDelta')}</p>
                  <p className="text-2xl font-semibold">
                    {comparison.latency_delta_percent > 0 ? '+' : ''}{comparison.latency_delta_percent.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('bd.recommendation')}</p>
                  <Badge
                    variant={comparison.recommendation === 'cpu_viable' ? 'default' : comparison.recommendation === 'gpu_required' ? 'destructive' : 'secondary'}
                    className="mt-1 text-sm"
                  >
                    {comparison.recommendation.replace(/_/g, ' ')}
                  </Badge>
                  <p className="mt-1 text-sm text-muted-foreground">{comparison.recommendation_reason}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Runs Table */}
        <div className="rounded-3xl border border-border/70 bg-card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-h3 font-semibold">{t('bd.benchmarkRuns')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('bd.selectRunsHint')}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-start text-muted-foreground">
                  <th className="p-2 w-10"></th>
                  <th className="p-2">{t('bd.colBackend')}</th>
                  <th className="p-2">{t('bd.colModel')}</th>
                  <th className="p-2">{t('bd.colStatus')}</th>
                  <th className="p-2">p50</th>
                  <th className="p-2">p95</th>
                  <th className="p-2">p99</th>
                  <th className="p-2">{t('bd.colTokS')}</th>
                  <th className="p-2">{t('bd.colReqS')}</th>
                  <th className="p-2">{t('bd.colCpu')}</th>
                  <th className="p-2">{t('bd.colMem')}</th>
                  <th className="p-2">{t('bd.colCost')}</th>
                  <th className="p-2">{t('bd.colDate')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b hover:bg-muted/30">
                    <td className="p-2">
                      {run.status === 'completed' && (
                        <Checkbox
                          checked={compareIds.has(run.id)}
                          onCheckedChange={() => toggleCompare(run.id)}
                        />
                      )}
                    </td>
                    <td className="p-2"><Badge variant="outline">{run.backend_type}</Badge></td>
                    <td className="p-2">
                      {run.model_name}
                      {run.quantization && <span className="ms-1 text-muted-foreground">({run.quantization})</span>}
                    </td>
                    <td className="p-2"><Badge variant={RUN_STATUS_VARIANTS[run.status]}>{run.status}</Badge></td>
                    <td className="p-2 font-mono">{run.p50_latency_ms?.toFixed(0) ?? '—'}</td>
                    <td className="p-2 font-mono">{run.p95_latency_ms?.toFixed(0) ?? '—'}</td>
                    <td className="p-2 font-mono">{run.p99_latency_ms?.toFixed(0) ?? '—'}</td>
                    <td className="p-2 font-mono">{run.tokens_per_second?.toFixed(1) ?? '—'}</td>
                    <td className="p-2 font-mono">{run.requests_per_second?.toFixed(1) ?? '—'}</td>
                    <td className="p-2 font-mono">{run.peak_cpu_percent?.toFixed(0) ?? '—'}</td>
                    <td className="p-2 font-mono">{run.peak_memory_mb ?? '—'}</td>
                    <td className="p-2 font-mono">{run.estimated_hourly_cost_usd?.toFixed(2) ?? '—'}</td>
                    <td className="p-2 text-muted-foreground">{new Date(run.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={13} className="p-8 text-center text-muted-foreground">
                      {t('bd.noRuns')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Run Benchmark Dialog */}
      <Dialog open={runDialogOpen} onOpenChange={(open) => { if (!open) setSelectedServer(''); setRunDialogOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('bd.run')}</DialogTitle>
            <DialogDescription>
              {t('bd.runDialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t('bd.selectServer')}</Label>
              <Select value={selectedServer} onValueChange={setSelectedServer}>
                <SelectTrigger><SelectValue placeholder={t('bd.chooseServer')} /></SelectTrigger>
                <SelectContent>
                  {healthyServers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.backend_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRunDialogOpen(false); setSelectedServer(''); }}>{t('bd.cancel')}</Button>
            <Button onClick={handleRunBenchmark} disabled={running || !selectedServer}>
              {running ? t('bd.starting') : t('bd.startBenchmark')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PermissionRedirect>
  );
}
