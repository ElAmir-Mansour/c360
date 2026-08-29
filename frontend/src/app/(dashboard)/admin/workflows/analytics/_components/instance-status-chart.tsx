'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { statusVar } from '@/lib/design-tokens';
import { useT } from '@/components/providers/locale-provider';
import type { PaginatedResponse } from '@/types/api';

interface CountResponse extends PaginatedResponse<unknown> {
  total: number;
}

const STATUSES = [
  { key: 'running', color: statusVar('info') },
  { key: 'completed', color: statusVar('success') },
  { key: 'failed', color: statusVar('error') },
  { key: 'cancelled', color: statusVar('neutral') },
  { key: 'suspended', color: statusVar('warning') },
];

export function InstanceStatusChart() {
  const t = useT('admin');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['workflow-analytics-status-breakdown'],
    queryFn: async () => {
      const results = await Promise.all(
        STATUSES.map((s) =>
          apiGet<CountResponse>('/api/v1/workflows/instances', {
            per_page: 1,
            page: 1,
            status: s.key,
          }),
        ),
      );
      return STATUSES.map((s, i) => ({
        name: t(`isc.st.${s.key}`),
        value: results[i].total ?? 0,
        color: s.color,
      }));
    },
    staleTime: 60_000,
  });

  const chartData = (data ?? []).filter((d) => d.value > 0);
  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <PieChart
      title={t('isc.title')}
      data={chartData}
      loading={isLoading}
      error={isError ? t('isc.failedToLoad') : undefined}
      height={280}
      showLegend
      centerLabel={t('isc.total')}
      centerValue={String(total)}
    />
  );
}
