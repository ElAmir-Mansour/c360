'use client';

import { Database, HardDrive, ShieldAlert, ShieldCheck } from 'lucide-react';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import type { LucideIcon } from 'lucide-react';
import { type DarkDataStatsSummary } from '@/lib/data-suite';
import { formatMaybeBytes } from '@/lib/data-suite/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface DarkDataKpiCardsProps {
  stats: DarkDataStatsSummary;
}

export function DarkDataKpiCards({
  stats,
}: DarkDataKpiCardsProps) {
  const labels = useDataLabels();
  const items: Array<{ label: string; value: string; tone: StatTone; icon: LucideIcon }> = [
    { label: labels.darkData.kpiTotal, value: stats.total_assets.toLocaleString(), tone: 'slate', icon: Database },
    {
      label: labels.darkData.kpiHighRisk,
      value: stats.high_risk_assets.toLocaleString(),
      tone: stats.high_risk_assets > 0 ? 'rose' : 'emerald',
      icon: ShieldAlert,
    },
    {
      label: labels.darkData.kpiWithPii,
      value: stats.pii_assets.toLocaleString(),
      tone: stats.pii_assets > 0 ? 'gold' : 'emerald',
      icon: ShieldCheck,
    },
    { label: labels.darkData.kpiTotalSize, value: formatMaybeBytes(stats.total_size_bytes), tone: 'sky', icon: HardDrive },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <StatCard key={item.label} label={item.label} value={item.value} tone={item.tone} icon={item.icon} />
      ))}
    </div>
  );
}
