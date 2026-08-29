'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { DSPMPolicyViolation } from '@/types/cyber';

interface ComplianceFrameworkCardProps {
  framework: string;
  violations: DSPMPolicyViolation[];
  totalPolicies: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  high: 'bg-severity-high/10 text-severity-high',
  medium: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  low: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  info: 'bg-secondary text-foreground',
};

function countBySeverity(violations: DSPMPolicyViolation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of violations) {
    const sev = v.severity ?? 'info';
    counts[sev] = (counts[sev] ?? 0) + 1;
  }
  return counts;
}

export function ComplianceFrameworkCard({
  framework,
  violations,
  totalPolicies,
}: ComplianceFrameworkCardProps) {
  const t = useDspmLabels().complianceCard;
  const complianceScore =
    totalPolicies === 0
      ? 100
      : Math.round(((totalPolicies - violations.length) / totalPolicies) * 100);

  const severityCounts = countBySeverity(violations);
  const topViolations = violations.slice(0, 5);
  const hasMore = violations.length > 5;

  const borderColor =
    complianceScore >= 90
      ? 'border-s-green-500'
      : complianceScore >= 70
        ? 'border-s-warning-500'
        : 'border-s-error-500';

  const scoreColor =
    complianceScore >= 90
      ? 'text-primary'
      : complianceScore >= 70
        ? 'text-warning-700 dark:text-warning-300'
        : 'text-status-error';

  const progressColor =
    complianceScore >= 90
      ? 'bg-primary'
      : complianceScore >= 70
        ? 'bg-severity-medium'
        : 'bg-severity-critical';

  return (
    <Card className={cn('border-s-4', borderColor)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{framework.toUpperCase()}</CardTitle>
          {violations.length === 0 ? (
            <ShieldCheck className="h-5 w-5 text-primary" />
          ) : (
            <AlertTriangle className={`h-5 w-5 ${complianceScore >= 70 ? 'text-warning-700 dark:text-warning-300' : 'text-status-error'}`} />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Compliance Score */}
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t.complianceScore}</span>
            <span className={cn('text-lg font-bold tabular-nums', scoreColor)}>
              {totalPolicies === 0 ? t.noPolicies : `${complianceScore}%`}
            </span>
          </div>
          {totalPolicies > 0 && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-all', progressColor)}
                style={{ width: `${complianceScore}%` }}
              />
            </div>
          )}
        </div>

        {/* Violation count with severity breakdown */}
        {violations.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">
              {t.violationsCount(violations.length)}
            </p>
            <div className="flex flex-wrap gap-2">
              {['critical', 'high', 'medium', 'low'].map((sev) => {
                const count = severityCounts[sev];
                if (!count) return null;
                return (
                  <span
                    key={sev}
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SEVERITY_COLORS[sev]}`}
                  >
                    {sev}: {count}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Top violations */}
        {topViolations.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t.topViolations}</p>
            {topViolations.map((v, idx) => (
              <div
                key={`${v.asset_id}-${v.policy_id}-${idx}`}
                className="flex items-start gap-2 rounded-md border p-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{v.asset_name}</span>
                    <Badge variant="outline" className="shrink-0 text-xs px-1.5 py-0 capitalize">
                      {v.category.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-muted-foreground">{v.description}</p>
                </div>
                <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SEVERITY_COLORS[v.severity] ?? 'bg-secondary text-foreground'}`}>
                  {v.severity}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* View All */}
        {hasMore && (
          <Button type="button" variant="outline" size="sm" className="w-full text-xs">
            {t.viewAll(violations.length)}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
