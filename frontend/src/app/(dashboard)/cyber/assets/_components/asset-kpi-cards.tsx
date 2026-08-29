'use client';

import { useRouter } from 'next/navigation';
import { Server, ShieldAlert, Bug, Compass } from 'lucide-react';
import { KpiCard } from '@/components/shared/kpi-card';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { API_ENDPOINTS } from '@/lib/constants';
import type { AssetStats } from '@/types/cyber';
import { useAssetLabels } from '../_lib/assets-i18n';

export function AssetKpiCards() {
  const router = useRouter();
  const t = useAssetLabels();
  const { data: envelope, isLoading } = useRealtimeData<{ data: AssetStats }>(
    API_ENDPOINTS.CYBER_ASSETS_STATS,
    { pollInterval: 120000 },
  );
  const stats = envelope?.data;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        className="cursor-pointer"
        onClick={() => router.push('/cyber/assets')}
      >
        <KpiCard
          title={t.kpi.totalAssets}
          value={stats?.total ?? 0}
          icon={Server}
          tone="sky"
          loading={isLoading}
        />
      </div>
      <div
        className="cursor-pointer"
        onClick={() => router.push('/cyber/assets?criticality=critical')}
      >
        <KpiCard
          title={t.kpi.criticalAssets}
          value={stats?.by_criticality?.['critical'] ?? 0}
          icon={ShieldAlert}
          tone="rose"
          loading={isLoading}
        />
      </div>
      <div
        className="cursor-pointer"
        onClick={() => router.push('/cyber/assets?has_vulnerabilities=true')}
      >
        <KpiCard
          title={t.kpi.withOpenVulns}
          value={stats?.assets_with_vulns ?? 0}
          icon={Bug}
          tone="gold"
          loading={isLoading}
        />
      </div>
      <div
        className="cursor-pointer"
        onClick={() => router.push('/cyber/assets?discovery_source=network_scan')}
      >
        <KpiCard
          title={t.kpi.discoveredThisWeek}
          value={stats?.assets_discovered_this_week ?? 0}
          icon={Compass}
          tone="emerald"
          loading={isLoading}
        />
      </div>
    </div>
  );
}
