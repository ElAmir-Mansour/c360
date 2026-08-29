'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, FileSearch } from 'lucide-react';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { DSPMPolicyImpact } from '@/types/cyber';

interface PolicyImpactPreviewProps {
  impact: DSPMPolicyImpact | null;
  isLoading: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  high: 'bg-severity-high/10 text-severity-high',
  medium: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  low: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  info: 'bg-secondary text-foreground',
};

function SkeletonRow() {
  return (
    <tr className="border-b">
      <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-muted" /></td>
      <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-muted" /></td>
      <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-muted" /></td>
      <td className="px-4 py-3"><div className="h-4 w-12 animate-pulse rounded bg-muted" /></td>
      <td className="px-4 py-3"><div className="h-4 w-32 animate-pulse rounded bg-muted" /></td>
      <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-muted" /></td>
    </tr>
  );
}

export function PolicyImpactPreview({ impact, isLoading }: PolicyImpactPreviewProps) {
  const t = useDspmLabels().policyImpact;
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colAsset}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colType}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colClassification}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colSeverity}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colDescription}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colEnforcement}</th>
                  </tr>
                </thead>
                <tbody>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!impact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FileSearch className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t.runDryRunHint}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const severityBreakdown: Record<string, number> = {};
  for (const v of impact.affected_assets) {
    const sev = v.severity ?? 'info';
    severityBreakdown[sev] = (severityBreakdown[sev] ?? 0) + 1;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          {t.summary(impact.total_assets_evaluated, impact.violations_found)}
        </p>

        {impact.violations_found === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 p-4 dark:border-primary dark:bg-brand-primary-800/20">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <p className="text-sm font-medium text-primary dark:text-primary">{t.noViolations}</p>
          </div>
        ) : (
          <>
            {/* Severity breakdown */}
            <div className="flex flex-wrap gap-2">
              {Object.entries(severityBreakdown)
                .sort(([a], [b]) => {
                  const order = ['critical', 'high', 'medium', 'low', 'info'];
                  return order.indexOf(a) - order.indexOf(b);
                })
                .map(([sev, count]) => (
                  <div key={sev} className="flex items-center gap-1.5">
                    <AlertTriangle className={`h-3.5 w-3.5 ${sev === 'critical' ? 'text-status-error' : sev === 'high' ? 'text-severity-high' : sev === 'medium' ? 'text-warning-700 dark:text-warning-300' : sev === 'low' ? 'text-status-info' : 'text-foreground/55'}`} />
                    <span className="text-sm capitalize">{sev}:</span>
                    <span className="text-sm font-semibold">{count}</span>
                  </div>
                ))}
            </div>

            {/* Affected assets table */}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colAsset}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colType}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colClassification}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colSeverity}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colDescription}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colEnforcement}</th>
                  </tr>
                </thead>
                <tbody>
                  {impact.affected_assets.map((violation) => (
                    <tr key={`${violation.policy_id}-${violation.asset_id}`} className="border-b">
                      <td className="px-4 py-3 font-medium">{violation.asset_name}</td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">
                        {violation.asset_type.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 capitalize">{violation.classification}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${SEVERITY_COLORS[violation.severity] ?? 'bg-secondary text-foreground'}`}>
                          {violation.severity}
                        </span>
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                        {violation.description}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs capitalize">
                          {violation.enforcement.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
