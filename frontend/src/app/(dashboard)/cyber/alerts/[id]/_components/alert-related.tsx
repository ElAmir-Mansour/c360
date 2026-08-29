'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { RelativeTime } from '@/components/shared/relative-time';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { StatusBadge } from '@/components/shared/status-badge';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { ALERT_STATUS_CONFIG, getAlertStatusVariant } from '@/lib/cyber-alerts';
import type { CyberAlert } from '@/types/cyber';

import { useAlertLabels } from '../../_lib/alerts-i18n';

type AlertRelatedLabels = ReturnType<typeof useAlertLabels>['related'];

interface AlertRelatedProps {
  alert: CyberAlert;
}

export function AlertRelated({ alert }: AlertRelatedProps) {
  const t = useAlertLabels();
  const relatedQuery = useQuery({
    queryKey: ['alert-related', alert.id],
    queryFn: () => apiGet<{ data: CyberAlert[] }>(API_ENDPOINTS.CYBER_ALERT_RELATED(alert.id)),
  });

  const relatedAlerts = relatedQuery.data?.data ?? [];

  if (relatedQuery.isLoading) {
    return <LoadingSkeleton variant="list-item" count={4} />;
  }

  if (relatedQuery.error) {
    return <ErrorState message={t.related.loadError} onRetry={() => void relatedQuery.refetch()} />;
  }

  if (relatedAlerts.length === 0) {
    return (
      <div className="rounded-softer border border-dashed bg-card p-8 text-center text-muted-foreground">
        {t.related.empty}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {relatedAlerts.map((item) => {
        const relations = inferRelations(alert, item, t.related);

        return (
          <Link
            key={item.id}
            href={`${ROUTES.CYBER_ALERTS}/${item.id}`}
            className="block rounded-softer border bg-card p-5 shadow-sm"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityIndicator severity={item.severity} showLabel />
                  <StatusBadge
                    status={item.status}
                    config={ALERT_STATUS_CONFIG}
                    variant={getAlertStatusVariant(item.status)}
                  />
                  {relations.map((relation) => (
                    <Badge key={relation} variant="secondary">
                      {relation}
                    </Badge>
                  ))}
                </div>
                <div>
                  <h3 className="text-h4 font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {item.description || t.related.noDescription}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>{t.related.rule(item.rule_name ?? t.related.detectionPipeline)}</span>
                  <span>{t.related.asset(item.asset_name ?? item.asset_hostname ?? item.asset_ip_address ?? t.related.unknown)}</span>
                  <span>{t.related.technique(item.mitre_technique_id ?? t.related.unmapped)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <RelativeTime date={item.created_at} />
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function inferRelations(source: CyberAlert, candidate: CyberAlert, labels: AlertRelatedLabels): string[] {
  const relations: string[] = [];

  if (source.rule_id && source.rule_id === candidate.rule_id) {
    relations.push(labels.relSameRule);
  }
  if (source.asset_id && source.asset_id === candidate.asset_id) {
    relations.push(labels.relSameAsset);
  }
  if (source.mitre_technique_id && source.mitre_technique_id === candidate.mitre_technique_id) {
    relations.push(labels.relSameTechnique);
  }
  if (source.source === candidate.source) {
    relations.push(labels.relSameSource);
  }

  return relations.length > 0 ? relations : [labels.relCorrelated];
}
