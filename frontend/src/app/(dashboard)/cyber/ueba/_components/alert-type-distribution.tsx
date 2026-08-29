'use client';

import { useUebaLabels } from '../_lib/ueba-i18n';
import type { UebaChartDatum } from './types';

export function AlertTypeDistribution({ items }: { items: UebaChartDatum[] }) {
  const t = useUebaLabels();
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="capitalize">{item.label.replaceAll('_', ' ')}</span>
            <span className="font-medium">{item.value.toFixed(0)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(item.value / total) * 100}%` }}
            />
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="text-sm text-muted-foreground">{t.distributionEmpty}</p>}
    </div>
  );
}
