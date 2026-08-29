'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Power, ShieldCheck, Trash2 } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { normalizeRule } from '@/lib/cyber-rules';
import { API_ENDPOINTS } from '@/lib/constants';
import { useRealtimeStore } from '@/stores/realtime-store';
import type { DetectionRule, DetectionRulePerformance } from '@/types/cyber';

import { RuleAlertsTab } from './_components/rule-alerts-tab';
import { RuleLogic } from './_components/rule-logic';
import { RuleOverview } from './_components/rule-overview';
import { RulePerformance } from './_components/rule-performance';
import { RuleTestDialog } from '../_components/rule-test-dialog';
import { RuleWizard } from '../_components/rule-wizard';
import { useRulesLabels } from '../_lib/rules-i18n';

export default function DetectionRuleDetailPage() {
  const t = useRulesLabels();
  const params = useParams<{ ruleId: string }>();
  const ruleId = params?.ruleId ?? '';
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: ruleEnvelope, isLoading, error, refetch } = useQuery({
    queryKey: ['cyber-rule-detail', ruleId],
    queryFn: () => apiGet<{ data: DetectionRule }>(API_ENDPOINTS.CYBER_RULE_DETAIL(ruleId)),
    enabled: Boolean(ruleId),
  });

  const { data: performanceEnvelope, isLoading: performanceLoading } = useQuery({
    queryKey: ['cyber-rule-performance', ruleId],
    queryFn: () => apiGet<{ data: DetectionRulePerformance }>(API_ENDPOINTS.CYBER_RULE_PERFORMANCE(ruleId)),
    enabled: Boolean(ruleId),
  });

  const rule = ruleEnvelope?.data ? normalizeRule(ruleEnvelope.data) : null;

  // WebSocket-driven cache invalidation
  const WS_TOPICS = useMemo(
    () => ['cyber.rule.updated', 'cyber.rule.toggled', 'cyber.rule.deleted'],
    [],
  );
  const realtimeKey = `cyber-rule-detail:${ruleId}`;
  const { register, unregister } = useRealtimeStore();
  const queryEvent = useRealtimeStore((s) => s.queryEvents[realtimeKey]);

  useEffect(() => {
    for (const topic of WS_TOPICS) {
      register(topic, realtimeKey);
    }
    return () => {
      for (const topic of WS_TOPICS) {
        unregister(topic, realtimeKey);
      }
    };
  }, [register, unregister, realtimeKey, WS_TOPICS]);

  useEffect(() => {
    if (queryEvent) {
      refetch();
    }
  }, [queryEvent, refetch]);

  const toggleMutation = useApiMutation<DetectionRule, Record<string, unknown>>(
    'put',
    () => API_ENDPOINTS.CYBER_RULE_TOGGLE(ruleId),
    {
      successMessage: t.detail.toastStatusUpdated,
      invalidateKeys: ['cyber-rule-detail', 'cyber-rules', 'cyber-rules-stats', 'cyber-mitre-coverage'],
      onSuccess: () => refetch(),
    },
  );

  const deleteMutation = useApiMutation<void, { id: string }>('delete', () => API_ENDPOINTS.CYBER_RULE_DETAIL(ruleId), {
    successMessage: t.detail.toastDeleted,
    invalidateKeys: ['cyber-rules', 'cyber-rules-stats', 'cyber-mitre-coverage'],
    onSuccess: () => router.push('/cyber/detection-rules'),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton variant="kpi" count={4} />
        <LoadingSkeleton variant="detail" />
      </div>
    );
  }

  if (error || !rule) {
    return (
      <ErrorState
        message={t.detail.loadError}
        error={error ?? undefined}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.detail.eyebrow}
          title={
            <div className="flex flex-wrap items-center gap-3">
              <span>{rule.name}</span>
              <SeverityIndicator severity={rule.severity} showLabel />
            </div>
          }
          tags={[
            { label: rule.rule_type, tone: 'neutral' },
            {
              label: rule.enabled ? t.detail.enabled : t.detail.disabled,
              tone: rule.enabled ? 'success' : 'neutral',
              icon: <Power className="h-3.5 w-3.5" aria-hidden />,
            },
            {
              label: t.detail.techniquesTag(rule.mitre_technique_ids.length),
              tone: 'info',
            },
          ]}
          description={t.detail.description}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="me-2 h-4 w-4" />
                {t.detail.editRule}
              </Button>
              <Button variant="outline" onClick={() => setTesting(true)}>
                <ShieldCheck className="me-2 h-4 w-4" />
                {t.detail.testRule}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  toggleMutation.mutate({
                    enabled: !rule.enabled,
                  })
                }
              >
                <Power className="me-2 h-4 w-4" />
                {rule.enabled ? t.detail.disable : t.detail.enable}
              </Button>
              <Button variant="outline" className="text-error-500" onClick={() => setDeleteConfirmOpen(true)}>
                <Trash2 className="me-2 h-4 w-4" />
                {t.detail.delete}
              </Button>
            </div>
          }
        />

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{t.detail.tabOverview}</TabsTrigger>
            <TabsTrigger value="logic">{t.detail.tabLogic}</TabsTrigger>
            <TabsTrigger value="performance">{t.detail.tabPerformance}</TabsTrigger>
            <TabsTrigger value="alerts">{t.detail.tabAlerts}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <RuleOverview rule={rule} />
          </TabsContent>

          <TabsContent value="logic">
            <RuleLogic rule={rule} />
          </TabsContent>

          <TabsContent value="performance">
            <RulePerformance rule={rule} performance={performanceEnvelope?.data} loading={performanceLoading} />
          </TabsContent>

          <TabsContent value="alerts">
            <RuleAlertsTab ruleId={rule.id} />
          </TabsContent>
        </Tabs>
      </div>

      <RuleWizard
        open={editing}
        onOpenChange={setEditing}
        rule={rule}
        onSuccess={() => {
          setEditing(false);
          refetch();
        }}
      />

      <RuleTestDialog open={testing} onOpenChange={setTesting} rule={rule} />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t.detail.deleteTitle}
        description={t.detail.deleteDescription(rule.name)}
        confirmLabel={t.detail.deleteConfirm}
        variant="destructive"
        onConfirm={() => deleteMutation.mutate({ id: rule.id })}
      />
    </PermissionRedirect>
  );
}
