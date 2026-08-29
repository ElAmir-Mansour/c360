'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Play,
  Search,
  Calendar,
  Globe,
  MousePointerClick,
  Webhook,
  GitBranch,
  Layers,
  Workflow,
  Tags,
  Repeat,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { StartWorkflowDialog } from '@/app/(dashboard)/admin/workflows/instances/components/start-workflow-dialog';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { workflowDefinitionStatusConfig, type StatusConfig } from '@/lib/status-configs';
import { titleCase } from '@/lib/format';
import { useWorkflowPageLabels, workflowLabel, type WorkflowPageLabels } from '../_lib/workflow-page-i18n';
import type { WorkflowDefinition } from '@/types/models';

const KPI_HOVER = '';

const TRIGGER_ICONS: Record<string, React.ElementType> = {
  manual: MousePointerClick,
  event: Globe,
  schedule: Calendar,
  webhook: Webhook,
};

const CATEGORIES = [
  'all',
  'approval',
  'onboarding',
  'review',
  'escalation',
  'notification',
  'data_pipeline',
  'compliance',
  'custom',
] as const;

export function DefinitionsBrowserClient() {
  const router = useRouter();
  const labels = useWorkflowPageLabels();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [startOpen, setStartOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useWorkflowDefinitions({
    status: 'active',
    per_page: 100,
  });

  const definitions = useMemo(() => data?.data ?? [], [data]);

  const metrics = useMemo(() => {
    const categories = new Set(
      definitions.map((d) => d.category).filter((c) => Boolean(c)),
    );
    const totalRuns = definitions.reduce((sum, d) => sum + (d.instance_count ?? 0), 0);
    return {
      available: definitions.length,
      categories: categories.size,
      totalRuns,
    };
  }, [definitions]);

  const filtered = useMemo(() => {
    return definitions.filter((def) => {
      const matchesSearch =
        !search ||
        def.name.toLowerCase().includes(search.toLowerCase()) ||
        (def.description ?? '').toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        categoryFilter === 'all' || def.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [definitions, search, categoryFilter]);

  const localizedStatusConfig = useMemo<StatusConfig>(() => {
    return Object.fromEntries(
      Object.entries(workflowDefinitionStatusConfig).map(([status, config]) => [
        status,
        { ...config, label: workflowLabel(labels, status, config.label) },
      ]),
    );
  }, [labels]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={labels.common.eyebrow}
          title={labels.definitions.title}
          description={labels.definitions.loadingDescription}
        />
        <LoadingSkeleton variant="card" count={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={labels.common.eyebrow}
          title={labels.definitions.title}
          description={labels.definitions.loadingDescription}
        />
        <ErrorState
          message={labels.definitions.failedToLoad}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={labels.common.eyebrow}
        title={labels.definitions.title}
        description={labels.definitions.description}
        tags={[
          {
            label: labels.definitions.availableTag(metrics.available.toLocaleString()),
            tone: metrics.available > 0 ? 'info' : 'neutral',
            icon: <Workflow className="h-3.5 w-3.5" aria-hidden />,
          },
          {
            label: labels.definitions.categoriesTag(metrics.categories.toLocaleString()),
            tone: 'neutral',
          },
        ]}
        actions={
          <Button size="sm" onClick={() => setStartOpen(true)}>
            <Play className="me-1.5 h-3.5 w-3.5" />
            {labels.common.startWorkflow}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          title={labels.definitions.availableWorkflows}
          value={metrics.available}
          icon={Workflow}
          tone="sky"
          className={KPI_HOVER}
        />
        <KpiCard
          title={labels.definitions.categories}
          value={metrics.categories}
          icon={Tags}
          tone="slate"
          className={KPI_HOVER}
        />
        <KpiCard
          title={labels.definitions.totalRuns}
          value={metrics.totalRuns}
          icon={Repeat}
          tone="sky"
          className={KPI_HOVER}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={labels.common.searchWorkflows}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-8"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder={labels.definitions.allCategories} />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {labels.categories[cat] ?? titleCase(cat)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        {labels.definitions.resultCount(filtered.length)}
      </p>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Layers className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {labels.definitions.noMatches}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((def) => (
            <DefinitionCard
              key={def.id}
              definition={def}
              labels={labels}
              statusConfig={localizedStatusConfig}
              onView={() => router.push(`/admin/workflows/definitions/${def.id}`)}
              onStart={() => setStartOpen(true)}
            />
          ))}
        </div>
      )}

      <StartWorkflowDialog open={startOpen} onOpenChange={setStartOpen} />
    </div>
  );
}

function DefinitionCard({
  definition,
  labels,
  statusConfig,
  onView,
  onStart,
}: {
  definition: WorkflowDefinition;
  labels: WorkflowPageLabels;
  statusConfig: StatusConfig;
  onView: () => void;
  onStart: () => void;
}) {
  const TriggerIcon =
    TRIGGER_ICONS[definition.trigger_config?.type ?? 'manual'] ?? Globe;
  const stepCount = definition.step_count ?? definition.steps?.length ?? 0;
  const instanceCount = definition.instance_count ?? 0;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{definition.name}</CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusBadge
                status={definition.status}
                config={statusConfig}
              />
              {definition.category && (
                <Badge variant="secondary" className="text-xs">
                  {labels.categories[definition.category] ?? titleCase(definition.category)}
                </Badge>
              )}
            </div>
          </div>
          <TriggerIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {definition.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {definition.description}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground">{labels.definitions.noDescription}</p>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {labels.definitions.steps(stepCount)}
          </span>
          <span>{labels.definitions.version(definition.version)}</span>
          <span>{labels.definitions.runs(instanceCount)}</span>
        </div>

        <div className="mt-auto flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={onView}>
            {labels.definitions.viewDetails}
          </Button>
          <Button size="sm" className="flex-1" onClick={onStart}>
            <Play className="me-1 h-3 w-3" />
            {labels.definitions.start}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
