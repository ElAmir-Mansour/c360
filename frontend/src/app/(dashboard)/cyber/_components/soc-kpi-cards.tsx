'use client';

import { useRouter } from 'next/navigation';
import { AlertTriangle, ShieldAlert, Activity, Clock } from 'lucide-react';
import { KpiCard } from '@/components/shared/kpi-card';
import type { StatTone } from '@/components/shared/stat-card';
import type { KPICards } from '@/types/cyber';
import { useCyberDashboardLabels } from '../_lib/cyber-i18n';

interface SocKpiCardsProps {
  kpis: KPICards;
  loading?: boolean;
}

function formatMTTR(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function mttrTone(hours: number): StatTone {
  if (hours < 4) return 'emerald';
  if (hours <= 8) return 'gold';
  return 'rose';
}

function riskGradeTone(grade: string): StatTone {
  switch (grade) {
    case 'A': return 'emerald';
    case 'B': return 'sky';
    case 'C': return 'gold';
    case 'D': return 'gold';
    default: return 'rose';
  }
}

export function SocKpiCards({ kpis, loading }: SocKpiCardsProps) {
  const router = useRouter();
  const t = useCyberDashboardLabels();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        className="cursor-pointer duration-normal ease-standard"
        onClick={() => router.push('/cyber/alerts?status=new,acknowledged,investigating')}
      >
        <KpiCard
          title={t.kpiOpenAlerts}
          value={kpis.open_alerts}
          change={kpis.alerts_delta !== 0 ? kpis.alerts_delta : undefined}
          changeLabel={t.kpiOpenAlertsChange}
          icon={AlertTriangle}
          tone={kpis.open_alerts > 0 ? 'gold' : 'slate'}
          loading={loading}
        />
      </div>

      <div
        className="cursor-pointer duration-normal ease-standard"
        onClick={() => router.push('/cyber/alerts?severity=critical')}
      >
        <KpiCard
          title={t.kpiCriticalAlerts}
          value={kpis.critical_alerts}
          icon={ShieldAlert}
          tone={kpis.critical_alerts > 0 ? 'rose' : 'slate'}
          loading={loading}
        />
      </div>

      <div
        className="cursor-pointer duration-normal ease-standard"
        onClick={() => router.push('/cyber/vciso')}
      >
        <KpiCard
          title={t.kpiRiskScore}
          value={
            kpis.risk_grade
              ? `${Math.round(kpis.risk_score)} (${kpis.risk_grade})`
              : Math.round(kpis.risk_score)
          }
          icon={Activity}
          tone={riskGradeTone(kpis.risk_grade)}
          loading={loading}
        />
      </div>

      <div className="duration-normal ease-standard">
        <KpiCard
          title={t.kpiMttr}
          value={loading ? '—' : formatMTTR(kpis.mttr_hours)}
          icon={Clock}
          tone={mttrTone(kpis.mttr_hours)}
          description={t.kpiMttrDescription}
          loading={loading}
        />
      </div>
    </div>
  );
}
