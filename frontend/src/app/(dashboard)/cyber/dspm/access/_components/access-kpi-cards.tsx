'use client';

import { Users, ShieldAlert, AlertTriangle, Clock, Zap, ShieldX } from 'lucide-react';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import type { AccessDashboard } from '@/types/cyber';
import { useDspmLabels } from '../../_lib/dspm-i18n';

interface AccessKpiCardsProps {
  dashboard: AccessDashboard;
}

export function AccessKpiCards({ dashboard }: AccessKpiCardsProps) {
  const t = useDspmLabels().accessKpi;
  const cards: Array<{
    key: string;
    label: string;
    value: string | number;
    icon: typeof Users;
    tone: StatTone;
  }> = [
    {
      key: 'total_identities',
      label: t.totalIdentities,
      value: dashboard.total_identities,
      icon: Users,
      tone: 'sky',
    },
    {
      key: 'high_risk_identities',
      label: t.highRiskIdentities,
      value: dashboard.high_risk_identities,
      icon: ShieldAlert,
      tone: dashboard.high_risk_identities > 0 ? 'rose' : 'emerald',
    },
    {
      key: 'overprivileged',
      label: t.overprivileged,
      value: dashboard.overprivileged_mappings,
      icon: AlertTriangle,
      tone: dashboard.overprivileged_mappings > 0 ? 'rose' : 'emerald',
    },
    {
      key: 'stale_permissions',
      label: t.stalePermissions,
      value: dashboard.stale_permissions,
      icon: Clock,
      tone: dashboard.stale_permissions > 0 ? 'gold' : 'emerald',
    },
    {
      key: 'avg_blast_radius',
      label: t.avgBlastRadius,
      value: `${Math.round(dashboard.avg_blast_radius)}/100`,
      icon: Zap,
      tone: dashboard.avg_blast_radius >= 50 ? 'rose' : 'emerald',
    },
    {
      key: 'policy_violations',
      label: t.policyViolations,
      value: dashboard.policy_violations,
      icon: ShieldX,
      tone: dashboard.policy_violations > 0 ? 'rose' : 'emerald',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
      {cards.map(({ key, label, value, icon, tone }) => (
        <StatCard key={key} label={label} value={value} icon={icon} tone={tone} />
      ))}
    </div>
  );
}
