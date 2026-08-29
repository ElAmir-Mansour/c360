'use client';

import Link from 'next/link';
import { Calendar, CheckSquare, Shield, Users } from 'lucide-react';
import { GaugeChart } from '@/components/shared/charts/gauge-chart';
import { KpiCard } from '@/components/shared/kpi-card';
import { Button } from '@/components/ui/button';
import type { ActaKPIs } from '@/types/suites';
import { useActaDashboardLabels } from '../_lib/acta-i18n';

interface ActaDashboardKpisProps {
  kpis: ActaKPIs;
}

export function ActaDashboardKpis({ kpis }: ActaDashboardKpisProps) {
  const t = useActaDashboardLabels();
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      <Link href="/acta/committees" className="block">
        <KpiCard
          title={t.kpiActiveCommittees}
          value={kpis.active_committees}
          icon={Users}
          tone="sky"
          description={t.kpiActiveCommitteesDescription}
          className="h-full transition hover:shadow-sm"
        />
      </Link>

      <Link href="/acta/meetings" className="block">
        <KpiCard
          title={t.kpiUpcomingMeetings}
          value={kpis.upcoming_meetings_30d}
          icon={Calendar}
          tone="sky"
          description={t.kpiUpcomingMeetingsDescription}
          className="h-full transition hover:shadow-sm"
        />
      </Link>

      <Link href="/acta/action-items" className="block">
        <KpiCard
          title={t.kpiOpenActionItems}
          value={kpis.open_action_items}
          icon={CheckSquare}
          tone={kpis.overdue_action_items > 0 ? 'rose' : 'sky'}
          description={
            kpis.overdue_action_items > 0
              ? t.kpiOverdue(kpis.overdue_action_items)
              : t.kpiNoOverdue
          }
          className="h-full transition hover:shadow-sm"
        />
      </Link>

      <div className="kpi-card-themed kpi-theme-emerald h-full">
        <div className="flex items-center justify-between gap-3">
          <span
            className="text-overline font-semibold uppercase tracking-caps-wide"
            style={{ color: 'var(--kpi-accent)' }}
          >
            {t.kpiComplianceScore}
          </span>
          <div className="kpi-icon-badge shrink-0">
            <Shield className="h-[18px] w-[18px]" aria-hidden />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-2xl font-bold text-foreground">
              {Math.round(kpis.compliance_score)}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.kpiMinutesPending(kpis.minutes_pending_approval)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t.kpiAvgAttendance(Math.round(kpis.attendance_rate_avg))}
            </p>
            <Button variant="link" size="sm" className="mt-2 h-auto px-0" asChild>
              <Link href="/acta/compliance">{t.kpiOpenCompliance}</Link>
            </Button>
          </div>
          <GaugeChart
            value={kpis.compliance_score}
            max={100}
            size={124}
            label={t.kpiGovernanceGauge}
            className="h-[82px] w-[124px]"
          />
        </div>
      </div>
    </div>
  );
}
