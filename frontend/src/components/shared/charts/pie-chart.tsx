'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/** Lazy wrapper — see area-chart.tsx. Keeps recharts out of the initial bundle. */
export const PieChart = dynamic(() => import('./pie-chart-impl').then((m) => m.PieChart), {
  ssr: false,
  loading: () => <Skeleton variant="chart" className="w-full" style={{ height: 300 }} aria-hidden />,
});
