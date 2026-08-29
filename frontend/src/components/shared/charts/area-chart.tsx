'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Lazy wrapper: recharts (~150KB) is code-split out of the initial bundle and
 * only loaded when an AreaChart actually renders. Named export preserved so
 * existing `import { AreaChart } from '.../area-chart'` callers are unchanged.
 * The placeholder is the canonical Skeleton chart variant (height matches the
 * chart's default plot height).
 */
export const AreaChart = dynamic(() => import('./area-chart-impl').then((m) => m.AreaChart), {
  ssr: false,
  loading: () => <Skeleton variant="chart" className="w-full" style={{ height: 300 }} aria-hidden />,
});
