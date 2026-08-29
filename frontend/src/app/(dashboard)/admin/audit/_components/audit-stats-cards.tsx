"use client";

import { Activity, CalendarDays, Users, Server } from "lucide-react";
import { StatTile, type StatTileTone } from "@/components/shared/stat-tile";
import { formatCompactNumber } from "@/lib/format";
import type { AuditLogStats } from "@/types/audit";
import { useAdminT } from "../../_lib/admin-i18n";

interface AuditStatsCardsProps {
  stats: AuditLogStats | undefined;
  loading: boolean;
}

const cardsMeta = [
  {
    key: "total_events",
    labelKey: "statTotalEvents",
    icon: Activity,
    tone: "info",
  },
  {
    key: "events_today",
    labelKey: "statEventsToday",
    icon: CalendarDays,
    tone: "primary",
  },
  {
    key: "unique_users",
    labelKey: "statUniqueUsers",
    icon: Users,
    tone: "success",
  },
  {
    key: "unique_services",
    labelKey: "statUniqueServices",
    icon: Server,
    tone: "warning",
  },
] as const satisfies ReadonlyArray<{
  key: keyof AuditLogStats;
  labelKey: "statTotalEvents" | "statEventsToday" | "statUniqueUsers" | "statUniqueServices";
  icon: typeof Activity;
  tone: StatTileTone;
}>;

export function AuditStatsCards({ stats, loading }: AuditStatsCardsProps) {
  const labels = useAdminT();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cardsMeta.map((card) => (
        <StatTile
          key={card.key}
          label={labels.audit[card.labelKey]}
          value={loading ? undefined : formatCompactNumber(Number(stats?.[card.key] ?? 0))}
          icon={card.icon}
          tone={card.tone}
          loading={loading}
        />
      ))}
    </div>
  );
}
