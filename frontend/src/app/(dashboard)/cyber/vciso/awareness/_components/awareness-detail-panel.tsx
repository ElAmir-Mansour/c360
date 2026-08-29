'use client';

import {
  Users,
  CheckCircle,
  XCircle,
  Calendar,
  Clock,
  BarChart3,
} from 'lucide-react';
import { DetailPanel } from '@/components/shared/detail-panel';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { awarenessStatusConfig } from '@/lib/status-configs';
import { formatDate } from '@/lib/format';
import type { VCISOAwarenessProgram } from '@/types/cyber';
import { useVcisoPanelLabels } from '../../_lib/vciso-i18n';

interface AwarenessDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  program: VCISOAwarenessProgram;
}

function rateColor(rate: number): string {
  if (rate >= 80) return 'text-primary';
  if (rate >= 60) return 'text-warning-700 dark:text-warning-300';
  return 'text-status-error';
}

function progressColor(rate: number): string {
  if (rate >= 80) return 'bg-primary';
  if (rate >= 60) return 'bg-severity-medium';
  return 'bg-severity-critical';
}

export function AwarenessDetailPanel({
  open,
  onOpenChange,
  program,
}: AwarenessDetailPanelProps) {
  const labels = useVcisoPanelLabels().awareness;
  const t = labels.detail;
  const typeLabels = labels.types as Record<string, string>;
  const typeLabel = typeLabels[program.type] ?? program.type;

  const completionPct = Math.round(program.completion_rate * 100);
  const passPct = Math.round(program.pass_rate * 100);
  const pendingUsers = program.total_users - program.completed_users;

  return (
    <DetailPanel
      open={open}
      onOpenChange={onOpenChange}
      title={program.name}
      description={typeLabel}
      width="xl"
    >
      <div className="space-y-6">
        {/* Overview */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.overview}
          </h3>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={program.status} config={awarenessStatusConfig} />
            <Badge variant="secondary" className="text-xs">
              {typeLabel}
            </Badge>
          </div>
        </div>

        <Separator />

        {/* User Stats */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.userBreakdown}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Users className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{t.totalUsers}</p>
              </div>
              <p className="text-2xl font-bold text-foreground">
                {program.total_users.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <CheckCircle className="h-4 w-4 text-primary" />
                <p className="text-xs text-muted-foreground">{t.completed}</p>
              </div>
              <p className="text-2xl font-bold text-primary">
                {program.completed_users.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <CheckCircle className="h-4 w-4 text-status-info" />
                <p className="text-xs text-muted-foreground">{t.passed}</p>
              </div>
              <p className="text-2xl font-bold text-status-info">
                {program.passed_users.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <XCircle className="h-4 w-4 text-status-error" />
                <p className="text-xs text-muted-foreground">{t.failed}</p>
              </div>
              <p className="text-2xl font-bold text-status-error">
                {program.failed_users.toLocaleString()}
              </p>
            </div>
          </div>

          {pendingUsers > 0 && (
            <div className="rounded-lg border border-warning-300 bg-warning-50 dark:bg-warning-800/10 p-3">
              <p className="text-sm text-warning-700 dark:text-warning-300">
                {t.pendingNote(pendingUsers)}
              </p>
            </div>
          )}
        </div>

        <Separator />

        {/* Rates */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.ratesTitle}
          </h3>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.completionRate}</span>
                </div>
                <span className={`font-semibold ${rateColor(completionPct)}`}>
                  {completionPct}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${progressColor(completionPct)}`}
                  style={{ width: `${completionPct}%` }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.passRate}</span>
                </div>
                <span className={`font-semibold ${rateColor(passPct)}`}>
                  {passPct}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${progressColor(passPct)}`}
                  style={{ width: `${passPct}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Timeline */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.timeline}
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.startDate}</span>
              <span className="font-medium">{formatDate(program.start_date)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.endDate}</span>
              <span className="font-medium">{formatDate(program.end_date)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.created}</span>
              <span className="font-medium">{formatDate(program.created_at)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.lastUpdated}</span>
              <span className="font-medium">{formatDate(program.updated_at)}</span>
            </div>
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}
