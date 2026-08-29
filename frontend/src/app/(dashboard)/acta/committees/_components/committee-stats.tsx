'use client';

import { Calendar, ClipboardList, FileCheck2, Users } from 'lucide-react';
import { KpiCard } from '@/components/shared/kpi-card';
import type { ActaCommitteeStats } from '@/types/suites';

interface CommitteeStatsProps {
  stats?: ActaCommitteeStats | null;
  memberCount: number;
}

export function CommitteeStats({ stats, memberCount }: CommitteeStatsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard title="Members" value={memberCount} icon={Users} tone="sky" />
      <KpiCard
        title="Upcoming Meetings"
        value={stats?.upcoming_meetings ?? 0}
        icon={Calendar}
        tone="sky"
      />
      <KpiCard
        title="Open Actions"
        value={stats?.open_action_items ?? 0}
        icon={ClipboardList}
        tone={stats?.overdue_action_items ? 'rose' : 'sky'}
        description={
          stats?.overdue_action_items
            ? `${stats.overdue_action_items} overdue`
            : 'No overdue items'
        }
      />
      <KpiCard
        title="Pending Minutes"
        value={stats?.pending_minutes_approval ?? 0}
        icon={FileCheck2}
        tone="gold"
      />
    </div>
  );
}
