'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, CheckCircle2, Clock, FilePenLine, History } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { dataSuiteApi, type DataModel, type DataModelStatus } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface ModelSummary {
  total: number;
  byStatus: Record<DataModelStatus, number>;
  recent: number;
}

function summarize(models: DataModel[], total: number): ModelSummary {
  const byStatus: Record<DataModelStatus, number> = {
    draft: 0,
    active: 0,
    deprecated: 0,
    archived: 0,
  };
  const now = Date.now();
  let recent = 0;

  for (const model of models) {
    if (model.status in byStatus) {
      byStatus[model.status] += 1;
    }
    const updated = model.updated_at ? new Date(model.updated_at).getTime() : NaN;
    if (!Number.isNaN(updated) && now - updated <= RECENT_WINDOW_MS) {
      recent += 1;
    }
  }

  return { total: total || models.length, byStatus, recent };
}

/**
 * KPI strip for the Data Models index. Derives counts from a lightweight
 * summary fetch over the existing (frozen) `listModels` API — no new endpoint,
 * no mutation of the table's own query.
 *
 * Tones are strictly semantic: count = sky, health/success = emerald,
 * time/quantity-in-flight = gold, risk/retired = rose.
 */
export function ModelKpiCards() {
  const labels = useDataLabels();
  const summaryQuery = useQuery({
    queryKey: ['data-models-summary'],
    queryFn: () => dataSuiteApi.listModels({ page: 1, per_page: 200 }),
    staleTime: 5 * 60_000,
  });

  const summary = useMemo<ModelSummary | null>(() => {
    if (!summaryQuery.data) {
      return null;
    }
    return summarize(summaryQuery.data.data, summaryQuery.data.meta?.total ?? 0);
  }, [summaryQuery.data]);

  if (summaryQuery.isLoading) {
    return <LoadingSkeleton variant="kpi" count={5} />;
  }

  if (summaryQuery.error || !summary) {
    return null;
  }

  const retired = summary.byStatus.deprecated + summary.byStatus.archived;

  const items: Array<{ label: string; value: string; tone: StatTone; icon: LucideIcon }> = [
    { label: labels.models.kpiTotal, value: summary.total.toLocaleString(), tone: 'sky', icon: Boxes },
    {
      label: labels.models.kpiActive,
      value: summary.byStatus.active.toLocaleString(),
      tone: summary.byStatus.active > 0 ? 'emerald' : 'slate',
      icon: CheckCircle2,
    },
    {
      label: labels.models.kpiDraft,
      value: summary.byStatus.draft.toLocaleString(),
      tone: summary.byStatus.draft > 0 ? 'gold' : 'slate',
      icon: FilePenLine,
    },
    {
      label: labels.models.kpiRetired,
      value: retired.toLocaleString(),
      tone: retired > 0 ? 'rose' : 'emerald',
      icon: History,
    },
    {
      label: labels.models.kpiUpdatedWeek,
      value: summary.recent.toLocaleString(),
      tone: 'gold',
      icon: Clock,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {items.map((item) => (
        <StatCard key={item.label} label={item.label} value={item.value} tone={item.tone} icon={item.icon} />
      ))}
    </div>
  );
}
