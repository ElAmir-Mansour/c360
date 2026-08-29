'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, ExternalLink, Globe2, MapPin, ShieldAlert, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DetailPanel } from '@/components/shared/detail-panel';
import { RelativeTime } from '@/components/shared/relative-time';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { Timeline } from '@/components/shared/timeline';
import { apiGet } from '@/lib/api';
import { getIndicatorSourceLabel } from '@/lib/cyber-indicators';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { formatDateTime } from '@/lib/utils';
import { getIndicatorTypeLabel, getThreatTypeLabel } from '@/lib/cyber-threats';
import type {
  IndicatorDetectionMatch,
  IndicatorEnrichment,
  ThreatIndicator,
} from '@/types/cyber';

import { useIndicatorLabels } from '../_lib/indicators-i18n';

interface IndicatorDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  indicator: ThreatIndicator | null;
  onEdit?: (indicator: ThreatIndicator) => void;
}

export function IndicatorDetailPanel({
  open,
  onOpenChange,
  indicator,
  onEdit,
}: IndicatorDetailPanelProps) {
  const router = useRouter();
  const t = useIndicatorLabels();
  const indicatorId = indicator?.id;

  const detailQuery = useQuery({
    queryKey: ['cyber-indicator-detail', indicatorId],
    queryFn: () => apiGet<{ data: ThreatIndicator }>(API_ENDPOINTS.CYBER_INDICATOR_DETAIL(indicatorId!)),
    enabled: open && Boolean(indicatorId),
  });

  const enrichmentQuery = useQuery({
    queryKey: ['cyber-indicator-enrichment', indicatorId],
    queryFn: () => apiGet<{ data: IndicatorEnrichment }>(API_ENDPOINTS.CYBER_INDICATOR_ENRICHMENT(indicatorId!)),
    enabled: open && Boolean(indicatorId),
    staleTime: 300_000,
  });

  const matchesQuery = useQuery({
    queryKey: ['cyber-indicator-matches', indicatorId],
    queryFn: () => apiGet<{ data: IndicatorDetectionMatch[] }>(API_ENDPOINTS.CYBER_INDICATOR_MATCHES(indicatorId!)),
    enabled: open && Boolean(indicatorId),
  });

  const item = detailQuery.data?.data ?? indicator;
  const enrichment = enrichmentQuery.data?.data;
  const matchTimeline = useMemo(() => (
    (matchesQuery.data?.data ?? []).map((match) => ({
      id: match.id,
      title: match.title,
      description: [
        match.kind,
        match.asset_name ? t.detail.asset(match.asset_name) : null,
        match.match_field ? `${match.match_field}=${match.match_value}` : null,
      ].filter(Boolean).join(' · '),
      timestamp: formatDateTime(match.timestamp),
      variant: mapSeverityVariant(match.severity),
    }))
  ), [matchesQuery.data?.data, t.detail]);

  return (
    <DetailPanel
      open={open}
      onOpenChange={onOpenChange}
      title={item ? item.value : t.detail.fallbackTitle}
      description={item ? t.detail.typeIndicator(getIndicatorTypeLabel(item.type)) : t.detail.fallbackDescription}
      width="xl"
    >
      {!item ? (
        <p className="text-sm text-muted-foreground">{t.detail.selectPrompt}</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/70 p-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{getIndicatorTypeLabel(item.type)}</Badge>
                <SeverityIndicator severity={item.severity} />
                <Badge variant={item.active ? 'default' : 'secondary'}>
                  {item.active ? t.detail.active : t.detail.inactive}
                </Badge>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-caps-xwide text-muted-foreground">
                  {t.detail.source}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {getIndicatorSourceLabel(item.source)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {onEdit && (
                <Button variant="outline" size="sm" onClick={() => onEdit(item)}>
                  {t.detail.editIndicator}
                </Button>
              )}
              {item.threat_id && (
                <Button
                  size="sm"
                  onClick={() => router.push(`${ROUTES.CYBER_THREATS}/${item.threat_id}`)}
                >
                  {t.detail.openThreat}
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InfoCard title={t.detail.lifecycle}>
              <dl className="space-y-2 text-sm">
                <InfoRow label={t.detail.firstSeen}>
                  <RelativeTime date={item.first_seen_at} />
                </InfoRow>
                <InfoRow label={t.detail.lastSeen}>
                  <RelativeTime date={item.last_seen_at} />
                </InfoRow>
                <InfoRow label={t.detail.expiresAt}>
                  <span>{item.expires_at ? formatDateTime(item.expires_at) : t.detail.noExpiration}</span>
                </InfoRow>
                <InfoRow label={t.detail.confidence}>
                  <span>{Math.round(item.confidence * 100)}%</span>
                </InfoRow>
              </dl>
            </InfoCard>

            <InfoCard title={t.detail.linkedThreat}>
              {item.threat_id && item.threat_name ? (
                <button
                  type="button"
                  className="w-full rounded-2xl border border-primary/30 bg-primary/10 p-4 text-start"
                  onClick={() => router.push(`${ROUTES.CYBER_THREATS}/${item.threat_id}`)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-primary">{item.threat_name}</p>
                      <p className="mt-1 text-sm text-primary">
                        {item.threat_type ? getThreatTypeLabel(item.threat_type) : t.detail.threat} · {item.threat_status ?? 'active'}
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-primary" />
                  </div>
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">{t.detail.notLinked}</p>
              )}
            </InfoCard>
          </div>

          <InfoCard title={t.detail.enrichment}>
            {enrichmentQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{t.detail.loadingEnrichment}</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <EnrichmentBlock
                  title={t.detail.dns}
                  icon={Globe2}
                  content={enrichment?.dns}
                  emptyLabel={t.detail.noDns}
                />
                <EnrichmentBlock
                  title={t.detail.geolocation}
                  icon={MapPin}
                  content={enrichment?.geolocation}
                  emptyLabel={t.detail.noGeo}
                />
                <div className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-warning-700 dark:text-warning-300" />
                    <p className="font-medium">{t.detail.cveAssociations}</p>
                  </div>
                  {enrichment?.cves?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {enrichment.cves.map((cve) => (
                        <Badge key={cve} variant="outline">{cve}</Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t.detail.noCves}</p>
                  )}
                </div>
                <div className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-600" />
                    <p className="font-medium">{t.detail.reputationWhois}</p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p>
                      {t.detail.reputationScore}{' '}
                      <span className="font-medium">
                        {typeof enrichment?.reputation_score === 'number'
                          ? `${Math.round(enrichment.reputation_score * 100)}%`
                          : t.detail.unavailable}
                      </span>
                    </p>
                    {enrichment?.whois ? (
                      <pre className="overflow-x-auto rounded-xl bg-auth-dark p-3 text-xs text-foreground/10">
                        {JSON.stringify(enrichment.whois, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-muted-foreground">{t.detail.noWhois}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </InfoCard>

          <InfoCard title={t.detail.detectionHistory}>
            {matchesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{t.detail.loadingMatches}</p>
            ) : matchTimeline.length > 0 ? (
              <Timeline items={matchTimeline} />
            ) : (
              <p className="text-sm text-muted-foreground">{t.detail.noDetections}</p>
            )}
          </InfoCard>

          <InfoCard title={t.detail.tagsMetadata}>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(item.tags ?? []).length > 0 ? (
                  item.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">{t.detail.noTags}</p>
                )}
              </div>
              {enrichment?.metadata && (
                <pre className="overflow-x-auto rounded-xl bg-auth-dark p-3 text-xs text-foreground/10">
                  {JSON.stringify(enrichment.metadata, null, 2)}
                </pre>
              )}
            </div>
          </InfoCard>
        </div>
      )}
    </DetailPanel>
  );
}

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-border/70 bg-background p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium text-foreground">{children}</dd>
    </div>
  );
}

function EnrichmentBlock({
  title,
  icon: Icon,
  content,
  emptyLabel,
}: {
  title: string;
  icon: typeof Activity;
  content?: Record<string, unknown>;
  emptyLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-indigo-600" />
        <p className="font-medium">{title}</p>
      </div>
      {content ? (
        <pre className="overflow-x-auto rounded-xl bg-auth-dark p-3 text-xs text-foreground/10">
          {JSON.stringify(content, null, 2)}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  );
}

function mapSeverityVariant(severity?: string) {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error' as const;
    case 'medium':
      return 'warning' as const;
    case 'low':
      return 'success' as const;
    default:
      return 'default' as const;
  }
}
