'use client';

import { Building2, Boxes, Rocket, EyeOff, AlertTriangle } from 'lucide-react';
import { KpiCard } from '@/components/shared/kpi-card';
import { useT } from '@/components/providers/locale-provider';
import type { FleetAiModels } from '@/types/platform';

interface AiKpiRowProps {
  summary?: FleetAiModels['summary'];
  loading?: boolean;
}

/**
 * G23 KPI row for the AI Governance fleet view (§E.5 #8): total tenants, total
 * models, in-production, shadow, and drift alerts. Values come straight off the
 * `/fleet/models` summary block. While loading, each card renders its own
 * skeleton (KpiCard `loading`), so the row keeps its shape and never flashes 0.
 */
export function AiKpiRow({ summary, loading }: AiKpiRowProps) {
  const t = useT();

  const driftTone: 'rose' | 'slate' =
    summary && summary.drift_alerts > 0 ? 'rose' : 'slate';

  const cards = [
    {
      title: t('platformConsole.ai.totalTenants'),
      value: summary?.total_tenants ?? 0,
      icon: Building2,
      tone: 'sky' as const,
    },
    {
      title: t('platformConsole.ai.totalModels'),
      value: summary?.total_models ?? 0,
      icon: Boxes,
      tone: 'slate' as const,
    },
    {
      title: t('platformConsole.ai.inProduction'),
      value: summary?.in_production ?? 0,
      icon: Rocket,
      tone: 'emerald' as const,
    },
    {
      title: t('platformConsole.ai.shadow'),
      value: summary?.shadow ?? 0,
      icon: EyeOff,
      tone: 'gold' as const,
    },
    {
      title: t('platformConsole.ai.driftAlerts'),
      value: summary?.drift_alerts ?? 0,
      icon: AlertTriangle,
      tone: driftTone,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((c) => (
        <KpiCard
          key={c.title}
          title={c.title}
          value={c.value}
          icon={c.icon}
          tone={c.tone}
          loading={loading}
        />
      ))}
    </div>
  );
}
