'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/** Lazy wrapper — see area-chart.tsx. Keeps recharts out of the initial bundle. */
export const LineChart = dynamic(() => import('./line-chart-impl').then((m) => m.LineChart), {
  ssr: false,
  loading: () => <Skeleton variant="chart" className="w-full" style={{ height: 300 }} aria-hidden />,
});
