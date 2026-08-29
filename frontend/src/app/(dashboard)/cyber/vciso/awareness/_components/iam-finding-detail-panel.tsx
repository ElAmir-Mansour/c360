'use client';

import {
  Users,
  Calendar,
  Clock,
  Shield,
  AlertTriangle,
  CheckCircle,
  Wrench,
} from 'lucide-react';
import { DetailPanel } from '@/components/shared/detail-panel';
import { StatusBadge } from '@/components/shared/status-badge';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { iamFindingStatusConfig } from '@/lib/status-configs';
import { formatDate } from '@/lib/format';
import type { VCISOIAMFinding } from '@/types/cyber';
import { useVcisoPanelLabels } from '../../_lib/vciso-i18n';

interface IAMFindingDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finding: VCISOIAMFinding;
}

export function IAMFindingDetailPanel({
  open,
  onOpenChange,
  finding,
}: IAMFindingDetailPanelProps) {
  const t = useVcisoPanelLabels().awareness.iam;
  const typeLabels = t.types as Record<string, string>;
  const typeLabel = typeLabels[finding.type] ?? finding.type;

  return (
    <DetailPanel
      open={open}
      onOpenChange={onOpenChange}
      title={finding.title}
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
            <StatusBadge status={finding.status} config={iamFindingStatusConfig} />
            <SeverityIndicator severity={finding.severity as Severity} />
            <Badge variant="outline" className="text-xs">
              {typeLabel}
            </Badge>
          </div>
          <p className="text-sm text-foreground leading-relaxed">
            {finding.description}
          </p>
        </div>

        <Separator />

        {/* Affected Users */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.impact}
          </h3>
          <div className="rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-100 dark:bg-warning-800/30">
                <Users className="h-5 w-5 text-warning-700 dark:text-warning-300" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {finding.affected_users.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.affectedUsersLabel}
                </p>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Remediation */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.remediation}
          </h3>
          {finding.remediation ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-900/10 p-4">
              <div className="flex items-start gap-2">
                <Wrench className="h-4 w-4 text-status-info mt-0.5 shrink-0" />
                <p className="text-sm text-blue-800 dark:text-blue-300 leading-relaxed">
                  {finding.remediation}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              {t.noRemediation}
            </p>
          )}
        </div>

        <Separator />

        {/* Timeline */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.timeline}
          </h3>
          <div className="relative space-y-0">
            {/* Discovered */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-warning-300 bg-warning-50 dark:bg-warning-800/20">
                  <AlertTriangle className="h-4 w-4 text-warning-700 dark:text-warning-300" />
                </div>
                <div className="w-0.5 flex-1 bg-border" />
              </div>
              <div className="pb-6">
                <p className="text-sm font-medium">{t.discovered}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(finding.discovered_at, 'MMM d, yyyy HH:mm')}
                </p>
              </div>
            </div>

            {/* Current Status */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-blue-300 bg-blue-50 dark:bg-blue-900/20">
                  <Shield className="h-4 w-4 text-status-info" />
                </div>
                {finding.resolved_at && (
                  <div className="w-0.5 flex-1 bg-border" />
                )}
              </div>
              <div className="pb-6">
                <p className="text-sm font-medium">
                  {t.statusPrefix} <StatusBadge status={finding.status} config={iamFindingStatusConfig} size="sm" />
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.lastUpdatedPrefix(formatDate(finding.updated_at, 'MMM d, yyyy HH:mm'))}
                </p>
              </div>
            </div>

            {/* Resolved (if applicable) */}
            {finding.resolved_at && (
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary/30 bg-primary/10 dark:bg-primary/20">
                    <CheckCircle className="h-4 w-4 text-primary" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium">{t.resolved}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(finding.resolved_at, 'MMM d, yyyy HH:mm')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* Metadata */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.details}
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.createdLabel}</span>
              <span className="font-medium">{formatDate(finding.created_at)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.discoveredLabel}</span>
              <span className="font-medium">{formatDate(finding.discovered_at)}</span>
            </div>
            {finding.resolved_at && (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-primary" />
                <span className="text-muted-foreground">{t.resolvedLabel}</span>
                <span className="font-medium">{formatDate(finding.resolved_at)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}
