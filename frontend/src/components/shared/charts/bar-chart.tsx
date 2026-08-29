'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/** Lazy wrapper — see area-chart.tsx. Keeps recharts out of the initial bundle. */
export const BarChart = dynamic(() => import('./bar-chart-impl').then((m) => m.BarChart), {
  ssr: false,
  loading: () => <Skeleton variant="chart" className="w-full" style={{ height: 300 }} aria-hidden />,
});
