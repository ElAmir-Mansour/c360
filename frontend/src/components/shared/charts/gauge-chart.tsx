'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Lazy wrapper for consistency with the other charts (and so any future recharts
 * usage inside the gauge is auto-split). The gauge itself is SVG-only today.
 */
export const GaugeChart = dynamic(() => import('./gauge-chart-impl').then((m) => m.GaugeChart), {
  ssr: false,
  loading: () => <Skeleton variant="chart" className="w-full" style={{ height: 200 }} aria-hidden />,
});
