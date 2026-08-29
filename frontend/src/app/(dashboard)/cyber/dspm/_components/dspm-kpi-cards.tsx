'use client';

import { Database, ShieldAlert, Globe, Lock, Wifi, type LucideIcon } from 'lucide-react';
import { KpiCard } from '@/components/shared/kpi-card';
import type { StatTone } from '@/components/shared/stat-card';
import type { DSPMDashboard } from '@/types/cyber';
import { useDspmLabels } from '../_lib/dspm-i18n';

interface DSPMKpiCardsProps {
  dashboard: DSPMDashboard;
}

interface DspmCard {
  key: string;
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: StatTone;
}

export function DSPMKpiCards({ dashboard }: DSPMKpiCardsProps) {
  const t = useDspmLabels().kpi;
  // Backend AVG() columns can be null for a zero-asset tenant; numeric counts
  // may also arrive null. Coerce defensively so the render never throws.
  const totalDataAssets = dashboard.total_data_assets ?? 0;
  const unencryptedCount = dashboard.unencrypted_count ?? 0;
  const noAccessControlCount = dashboard.no_access_control_count ?? 0;
  const internetFacingCount = dashboard.internet_facing_count ?? 0;
  const avgPostureScore = dashboard.avg_posture_score ?? 0;
  const avgRiskScore = dashboard.avg_risk_score ?? 0;

  const cards: DspmCard[] = [
    {
      key: 'data_assets',
      label: t.dataAssets,
      value: totalDataAssets,
      icon: Database,
      tone: 'sky',
    },
    {
      key: 'unencrypted',
      label: t.unencrypted,
      value: unencryptedCount,
      icon: Lock,
      tone: unencryptedCount > 0 ? 'rose' : 'emerald',
    },
    {
      key: 'no_access_control',
      label: t.noAccessControl,
      value: noAccessControlCount,
      icon: ShieldAlert,
      tone: noAccessControlCount > 0 ? 'gold' : 'emerald',
    },
    {
      key: 'internet_facing',
      label: t.internetFacing,
      value: internetFacingCount,
      icon: Globe,
      tone: internetFacingCount > 0 ? 'gold' : 'emerald',
    },
    {
      key: 'posture_score',
      label: t.postureScore,
      value: `${avgPostureScore.toFixed(0)}/100`,
      icon: Wifi,
      tone: avgPostureScore >= 80 ? 'emerald' : avgPostureScore >= 60 ? 'gold' : 'rose',
    },
    {
      key: 'risk_score',
      label: t.riskScore,
      value: `${avgRiskScore.toFixed(0)}/100`,
      icon: ShieldAlert,
      tone: avgRiskScore <= 30 ? 'emerald' : avgRiskScore <= 60 ? 'gold' : 'rose',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
      {cards.map(({ key, label, value, icon, tone }) => (
        <KpiCard
          key={key}
          title={label}
          value={value}
          icon={icon}
          tone={tone}
          className=""
        />
      ))}
    </div>
  );
}
