'use client';

import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import type { StatTone } from '@/components/shared/stat-card';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { getRuleTypeLabel } from '@/lib/cyber-rules';
import type { DetectionRule } from '@/types/cyber';

import { useRulesLabels } from '../../_lib/rules-i18n';

interface UserMinimal {
  full_name: string;
  email: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a creator field to a human-readable display label.
 * - null / undefined / empty → "System"
 * - UUID string → fetches the user from IAM and returns full_name or email
 * - Any other string → returned as-is (already human-readable)
 */
function useCreatorLabel(createdBy: string | null | undefined): string {
  const t = useRulesLabels();
  const isUUID = Boolean(createdBy && UUID_PATTERN.test(createdBy));

  const { data } = useQuery<UserMinimal>({
    queryKey: ['user-mini', createdBy],
    queryFn: () => apiGet<UserMinimal>(API_ENDPOINTS.USER_DETAIL(createdBy!)),
    enabled: isUUID,
    staleTime: 10 * 60_000, // user profiles rarely change
    retry: false,
  });

  if (!createdBy) return t.overview.system;
  if (!isUUID) return createdBy;
  return data?.full_name || data?.email || t.overview.system;
}

function MetricCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: StatTone }) {
  if (tone === 'neutral') {
    return (
      <div className="rounded-soft surface-card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">{label}</p>
        <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
      </div>
    );
  }

  return <DetailStatCard tone={tone} label={label} value={value} />;
}

export function RuleOverview({ rule }: { rule: DetectionRule }) {
  const t = useRulesLabels();
  const creatorLabel = useCreatorLabel(rule.created_by ?? null);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t.overview.ruleType} value={getRuleTypeLabel(rule.rule_type)} tone="slate" />
        <MetricCard label={t.overview.triggerCount} value={rule.trigger_count.toLocaleString()} tone="sky" />
        <MetricCard label={t.overview.mappedTechniques} value={String(rule.mitre_technique_ids.length)} tone="sky" />
        <MetricCard label={t.overview.confidence} value={`${Math.round(rule.base_confidence * 100)}%`} tone="emerald" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-softer surface-card p-5">
          <p className="text-sm font-medium">{t.overview.description}</p>
          <p className="mt-3 text-sm leading-7 text-foreground">
            {rule.description || t.overview.noDescription}
          </p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.overview.created}</p>
              <p className="mt-2 text-sm text-foreground">{rule.created_at ? format(new Date(rule.created_at), 'PPP p') : t.overview.unknown}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.overview.lastUpdated}</p>
              <p className="mt-2 text-sm text-foreground">{rule.updated_at ? format(new Date(rule.updated_at), 'PPP p') : t.overview.unknown}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.overview.createdBy}</p>
              <p className="mt-2 text-sm text-foreground">{creatorLabel}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.overview.lastTriggered}</p>
              <p className="mt-2 text-sm text-foreground">{rule.last_triggered_at ? format(new Date(rule.last_triggered_at), 'PPP p') : t.overview.never}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-softer surface-card p-5">
            <p className="text-sm font-medium">{t.overview.mitreMapping}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {rule.mitre_tactic_ids.length > 0 ? (
                rule.mitre_tactic_ids.map((tacticId) => (
                  <Badge key={tacticId} variant="outline" className="font-mono">
                    {tacticId}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">{t.overview.noTactics}</span>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {rule.mitre_technique_ids.length > 0 ? (
                rule.mitre_technique_ids.map((techniqueId) => (
                  <Badge key={techniqueId} variant="secondary" className="font-mono">
                    {techniqueId}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">{t.overview.noTechniques}</span>
              )}
            </div>
          </div>

          <div className="rounded-softer surface-card p-5">
            <p className="text-sm font-medium">{t.overview.tags}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {rule.tags.length > 0 ? (
                rule.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)
              ) : (
                <span className="text-sm text-muted-foreground">{t.overview.noTags}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
