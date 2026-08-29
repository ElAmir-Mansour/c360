'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { DetailPanel } from '@/components/shared/detail-panel';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { apiGet, apiPut } from '@/lib/api';
import { ALERT_STATUS_CONFIG, getAlertStatusVariant } from '@/lib/cyber-alerts';
import { API_ENDPOINTS } from '@/lib/constants';
import { getRuleTypeColor, getRuleTypeLabel } from '@/lib/cyber-rules';
import { timeAgo } from '@/lib/utils';
import type { MITRETechniqueCoverage, MITRETechniqueDetail } from '@/types/cyber';

import { useMitreLabels } from '../_lib/mitre-i18n';

interface MitreTechniquePanelProps {
  technique: MITRETechniqueCoverage | null;
  onClose: () => void;
}

export function MitreTechniquePanel({ technique, onClose }: MitreTechniquePanelProps) {
  const t = useMitreLabels();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['mitre-technique-detail', technique?.technique_id],
    queryFn: () => apiGet<{ data: MITRETechniqueDetail }>(API_ENDPOINTS.CYBER_MITRE_TECHNIQUE_DETAIL(technique!.technique_id)),
    enabled: Boolean(technique),
  });

  const detail = data?.data;

  return (
    <DetailPanel
      open={Boolean(technique)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={technique?.technique_name ?? t.panel.fallbackTitle}
      description={technique?.technique_id}
      width="xl"
    >
      {isLoading || !detail ? (
        <div className="space-y-4">
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="card" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">{detail.id}</Badge>
            <Badge className={getRuleTypeColor(detail.coverage_state === 'noisy' ? 'anomaly' : detail.coverage_state === 'gap' ? 'correlation' : 'sigma')}>
              {detail.coverage_state}
            </Badge>
            {detail.platforms.map((platform) => (
              <Badge key={platform} variant="secondary">{platform}</Badge>
            ))}
          </div>

          <div>
            <p className="text-sm font-medium">{t.panel.description}</p>
            <p className="mt-2 text-sm leading-7 text-foreground">{detail.description}</p>
            <a
              href={`https://attack.mitre.org/techniques/${detail.id.replace('.', '/')}/`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              {t.panel.viewOnMitre}
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border p-4">
              <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.panel.rules}</p>
              <p className="mt-2 text-xl font-semibold">{detail.rule_count}</p>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.panel.alerts}</p>
              <p className="mt-2 text-xl font-semibold">{detail.alert_count}</p>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.panel.activeThreats}</p>
              <p className="mt-2 text-xl font-semibold">{detail.active_threat_count}</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{t.panel.associatedRules}</p>
              <Button asChild size="sm" variant="outline">
                <Link href={`/cyber/detection-rules?create=1&mitre_technique_id=${detail.id}`}>{t.panel.createRule}</Link>
              </Button>
            </div>
            <div className="space-y-2">
              {(detail.linked_rules ?? []).length > 0 ? (
                (detail.linked_rules ?? []).map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between rounded-2xl border p-4">
                    <div className="space-y-1">
                      <Link href={`/cyber/detection-rules/${rule.id}`} className="font-medium hover:text-primary hover:underline">
                        {rule.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={getRuleTypeColor(rule.rule_type)}>{getRuleTypeLabel(rule.rule_type)}</Badge>
                        <SeverityIndicator severity={rule.severity} />
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await apiPut(API_ENDPOINTS.CYBER_RULE_TOGGLE(rule.id), { enabled: !rule.enabled });
                          toast.success(rule.enabled ? t.panel.ruleDisabledToast : t.panel.ruleEnabledToast);
                          void refetch();
                          void queryClient.invalidateQueries({ queryKey: ['cyber-mitre-coverage'] });
                        } catch {
                          toast.error(t.panel.toggleErrorToast);
                        }
                      }}
                    >
                      {rule.enabled ? t.panel.disable : t.panel.enable}
                    </Button>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  {t.panel.noRulesCover}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">{t.panel.associatedThreats}</p>
            <div className="space-y-2">
              {(detail.linked_threats ?? []).length > 0 ? (
                (detail.linked_threats ?? []).map((threat) => (
                  <Link key={threat.id} href={`/cyber/threats/${threat.id}`} className="block rounded-2xl border p-4 transition hover:bg-muted/20">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{threat.name}</p>
                        <p className="text-sm text-muted-foreground">{threat.type}</p>
                      </div>
                      <div className="text-end">
                        <SeverityIndicator severity={threat.severity} />
                        <p className="mt-2 text-xs text-muted-foreground">{timeAgo(threat.last_seen_at)}</p>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  {t.panel.noThreatContext}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">{t.panel.recentAlerts}</p>
            <div className="space-y-2">
              {(detail.recent_alerts ?? []).length > 0 ? (
                (detail.recent_alerts ?? []).map((alert) => (
                  <Link key={alert.id} href={`/cyber/alerts/${alert.id}`} className="block rounded-2xl border p-4 transition hover:bg-muted/20">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{alert.title}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <SeverityIndicator severity={alert.severity} />
                          <StatusBadge status={alert.status} config={ALERT_STATUS_CONFIG} variant={getAlertStatusVariant(alert.status)} />
                        </div>
                      </div>
                      <div className="text-end text-sm text-muted-foreground">
                        <p>{Math.round(Math.min(1, Math.max(0, alert.confidence_score ?? 0)) * 100)}%</p>
                        <p>{timeAgo(alert.created_at)}</p>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  {t.panel.noRecentAlerts}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </DetailPanel>
  );
}
