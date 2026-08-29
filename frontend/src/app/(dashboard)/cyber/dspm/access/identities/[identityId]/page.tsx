'use client';

import { useRouter, useParams } from 'next/navigation';
import { format } from 'date-fns';
import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle, ChevronLeft, ChevronRight, Clock, Lightbulb, Network, ShieldOff, XCircle, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { StatusBadge, severityMap } from '@/components/shared/status-badge';
import type { StatTone } from '@/components/shared/stat-card';
import { useMutation } from '@tanstack/react-query';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { useAuth } from '@/hooks/use-auth';
import { apiPost } from '@/lib/api';
import { parseApiError } from '@/lib/format';
import { API_ENDPOINTS } from '@/lib/constants';
import type {
  IdentityProfile,
  AccessMapping,
  AccessAuditEntry,
  BlastRadius,
  AccessRecommendation,
  AccessRemediationResult,
  DataClassification,
} from '@/types/cyber';
import type { PaginationMeta } from '@/types/api';
import { useDspmLabels } from '../../../_lib/dspm-i18n';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Risk-score buckets on the severity token ramp (re-themes in dark mode).
function scoreColor(score: number): string {
  if (score >= 75) return 'bg-severity-critical';
  if (score >= 50) return 'bg-severity-high';
  if (score >= 25) return 'bg-severity-medium';
  return 'bg-primary';
}

function scoreBorderColor(score: number): string {
  if (score >= 75) return 'border-severity-critical/40';
  if (score >= 50) return 'border-severity-high/40';
  if (score >= 25) return 'border-severity-medium/40';
  return 'border-primary/30';
}

function scoreTextColor(score: number): string {
  if (score >= 75) return 'text-severity-critical';
  if (score >= 50) return 'text-severity-high';
  if (score >= 25) return 'text-warning-700 dark:text-warning-300';
  return 'text-primary';
}

// RAG severity → semantic tone for detail summary tiles (higher = worse).
function scoreTone(score: number): StatTone {
  if (score >= 50) return 'rose';
  if (score >= 25) return 'gold';
  return 'emerald';
}

/**
 * Token-scale badge recipes (mirror the ui/badge variants) so lifecycle /
 * classification / recommendation chips ride the semantic ramps and re-theme
 * in dark mode instead of hardcoded palette classes.
 */
const TONE_BADGE = {
  primary: 'bg-primary/15 text-primary border-primary/30',
  neutral: 'bg-secondary text-foreground border-primary/15',
  info: 'bg-info-50 text-info-700 border-info-300/60 dark:bg-info-700/15 dark:text-info-300 dark:border-info-700/60',
  warning:
    'bg-warning-50 text-warning-700 border-warning-300/60 dark:bg-warning-700/15 dark:text-warning-300 dark:border-warning-700/60',
  error:
    'bg-error-50 text-error-700 border-error-300/60 dark:bg-error-700/15 dark:text-error-300 dark:border-error-700/60',
} as const;

const STATUS_VARIANT: Record<string, string> = {
  active: TONE_BADGE.primary,
  inactive: TONE_BADGE.neutral,
  under_review: TONE_BADGE.warning,
  remediated: TONE_BADGE.info,
};

const CLASSIFICATION_COLORS: Record<DataClassification, string> = {
  public: TONE_BADGE.neutral,
  internal: TONE_BADGE.info,
  confidential: TONE_BADGE.warning,
  restricted: TONE_BADGE.error,
};

const RECOMMENDATION_TYPE_COLORS: Record<string, string> = {
  revoke: TONE_BADGE.error,
  downgrade: TONE_BADGE.warning,
  time_bound: TONE_BADGE.info,
  review: TONE_BADGE.neutral,
};

function statusLabel(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function identityTypeLabel(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DspmAccessIdentityDetailPage() {
  const router = useRouter();
  const t = useDspmLabels().identityDetail;
  const params = useParams<{ identityId: string }>();
  const identityId = params?.identityId ?? '';

  const {
    data: profileEnvelope,
    isLoading: profileLoading,
    error: profileError,
    mutate: refetchProfile,
  } = useRealtimeData<{ data: IdentityProfile }>(
    `${API_ENDPOINTS.CYBER_DSPM_ACCESS_IDENTITIES}/${identityId}`,
    { pollInterval: 60000 },
  );

  const {
    data: mappingsEnvelope,
    isLoading: mappingsLoading,
    error: mappingsError,
    mutate: refetchMappings,
  } = useRealtimeData<{ data: AccessMapping[] }>(
    `${API_ENDPOINTS.CYBER_DSPM_ACCESS_IDENTITIES}/${identityId}/mappings`,
    { pollInterval: 60000 },
  );

  const {
    data: blastEnvelope,
    isLoading: blastLoading,
    error: blastError,
    mutate: refetchBlast,
  } = useRealtimeData<{ data: BlastRadius }>(
    `${API_ENDPOINTS.CYBER_DSPM_ACCESS_IDENTITIES}/${identityId}/blast-radius`,
    { pollInterval: 60000 },
  );

  const {
    data: recsEnvelope,
    isLoading: recsLoading,
    error: recsError,
    mutate: refetchRecs,
  } = useRealtimeData<{ data: AccessRecommendation[] }>(
    `${API_ENDPOINTS.CYBER_DSPM_ACCESS_IDENTITIES}/${identityId}/recommendations`,
    { pollInterval: 60000 },
  );

  const [auditPage, setAuditPage] = useState(1);
  const {
    data: auditEnvelope,
    isLoading: auditLoading,
    error: auditError,
    mutate: refetchAudit,
  } = useRealtimeData<{ data: AccessAuditEntry[]; meta: PaginationMeta }>(
    `${API_ENDPOINTS.CYBER_DSPM_ACCESS_IDENTITIES}/${identityId}/audit?page=${auditPage}&per_page=25`,
    { pollInterval: 60000 },
  );

  const auditEntries = auditEnvelope?.data ?? [];
  const auditMeta = auditEnvelope?.meta;

  const profile = profileEnvelope?.data;
  const mappings = mappingsEnvelope?.data ?? [];
  const blast = blastEnvelope?.data;
  const recommendations = recsEnvelope?.data ?? [];

  // Per-recommendation remediation. Recommendations are computed per access
  // mapping, so rec.mapping_id IS the {recommendationId} path segment. Acting on
  // one records a real persisted state transition + audit ledger row via
  // POST .../recommendations/{recommendationId}; on success we refetch the
  // recommendations (which recompute from the transitioned mapping) plus the
  // mappings + profile so the new status is reflected. Gated on cyber:write.
  const { hasPermission } = useAuth();
  const canRemediate = hasPermission('cyber:write');

  interface RemediateVars {
    recId: string;
    action: 'apply' | 'revoke' | 'dismiss';
    note?: string;
  }
  const remediate = useMutation({
    mutationFn: ({ recId, action, note }: RemediateVars) =>
      apiPost<{ data: AccessRemediationResult }>(
        `${API_ENDPOINTS.CYBER_DSPM_ACCESS_IDENTITIES}/${identityId}/recommendations/${recId}`,
        { action, note },
      ),
    onSuccess: (result) => {
      const status = result.data.remediation_status;
      const message =
        status === 'revoked'
          ? t.remediationRevoked
          : status === 'dismissed'
            ? t.remediationDismissed
            : t.remediationApplied;
      toast.success(message);
      setPendingRec(null);
      void refetchRecs();
      void refetchMappings();
      void refetchProfile();
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const [pendingRec, setPendingRec] = useState<AccessRecommendation | null>(null);
  const submitRemediation = (rec: AccessRecommendation, action: 'apply' | 'revoke' | 'dismiss') => {
    if (!canRemediate) return;
    remediate.mutate({ recId: rec.mapping_id, action });
  };
  const confirmRemediation = () => {
    if (!pendingRec) return;
    submitRemediation(pendingRec, pendingRec.type === 'revoke' ? 'revoke' : 'apply');
  };

  if (profileLoading) {
    return (
      <PermissionRedirect permission="cyber:read">
        <div className="space-y-6">
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="card" />
        </div>
      </PermissionRedirect>
    );
  }

  if (profileError || !profile) {
    return (
      <PermissionRedirect permission="cyber:read">
        <ErrorState
          message={t.loadProfileError}
          onRetry={() => void refetchProfile()}
        />
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          title={profile.identity_name}
          description={`${identityTypeLabel(profile.identity_type)} \u00b7 ${profile.identity_source}`}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/cyber/dspm/access/identities')}
            >
              <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
              {t.back}
            </Button>
          }
        />

        {/* Score Cards + Status */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className={`border-2 ${scoreBorderColor(profile.access_risk_score)}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t.riskScore}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3">
                <span className={`text-4xl font-bold ${scoreTextColor(profile.access_risk_score)}`}>
                  {profile.access_risk_score}
                </span>
                <span className="mb-1 text-sm text-muted-foreground">/ 100</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${scoreColor(profile.access_risk_score)}`}
                  style={{ width: `${Math.min(profile.access_risk_score, 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className={`border-2 ${scoreBorderColor(profile.blast_radius_score)}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t.blastRadiusScore}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3">
                <span className={`text-4xl font-bold ${scoreTextColor(profile.blast_radius_score)}`}>
                  {profile.blast_radius_score}
                </span>
                <span className="mb-1 text-sm text-muted-foreground">/ 100</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${scoreColor(profile.blast_radius_score)}`}
                  style={{ width: `${Math.min(profile.blast_radius_score, 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t.status}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <Badge
                  variant="outline"
                  className={`w-fit text-sm ${STATUS_VARIANT[profile.status] ?? 'bg-secondary text-foreground'}`}
                >
                  {statusLabel(profile.status)}
                </Badge>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    {t.assetsAccessible(profile.total_assets_accessible)}
                  </p>
                  <p>
                    {t.overprivStaleSummary(profile.overprivileged_count, profile.stale_permission_count)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="access-map" className="space-y-4">
          <TabsList>
            <TabsTrigger value="access-map">{t.tabAccessMap}</TabsTrigger>
            <TabsTrigger value="blast-radius">{t.tabBlastRadius}</TabsTrigger>
            <TabsTrigger value="recommendations">{t.tabRecommendations}</TabsTrigger>
            <TabsTrigger value="audit-trail">{t.tabAuditTrail}</TabsTrigger>
          </TabsList>

          {/* ── Access Map Tab ──────────────────────────────────────────────── */}
          <TabsContent value="access-map" className="space-y-4">
            {mappingsLoading ? (
              <LoadingSkeleton variant="table-row" />
            ) : mappingsError ? (
              <ErrorState
                message={t.loadMappingsError}
                onRetry={() => void refetchMappings()}
              />
            ) : mappings.length === 0 ? (
              <Card>
                <CardContent className="p-0">
                  <EmptyState
                    size="compact"
                    icon={Network}
                    title={t.noMappingsTitle}
                    description={t.noMappingsDescription}
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-start font-medium">{t.colDataAsset}</th>
                      <th className="px-4 py-3 text-start font-medium">{t.colClassification}</th>
                      <th className="px-4 py-3 text-start font-medium">{t.colPermission}</th>
                      <th className="px-4 py-3 text-start font-medium">{t.colSource}</th>
                      <th className="px-4 py-3 text-start font-medium">{t.colStale}</th>
                      <th className="px-4 py-3 text-end font-medium">{t.colUsage90d}</th>
                      <th className="px-4 py-3 text-start font-medium">{t.colLastUsed}</th>
                      <th className="px-4 py-3 text-end font-medium">{t.colRiskScore}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr key={m.id} className="border-b last:border-b-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{m.data_asset_name}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={CLASSIFICATION_COLORS[m.data_classification] ?? ''}
                          >
                            {statusLabel(m.data_classification)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
                            {m.permission_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {statusLabel(m.permission_source)}
                        </td>
                        <td className="px-4 py-3">
                          {m.is_stale ? (
                            <Badge variant="destructive" className="px-1.5 py-0 text-xs">
                              {t.stale}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="px-1.5 py-0 text-xs">
                              {t.active}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-end tabular-nums">
                          {m.usage_count_90d}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {m.last_used_at
                            ? format(new Date(m.last_used_at), 'MMM d, yyyy')
                            : t.never}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <span className={`text-xs font-semibold ${scoreTextColor(m.access_risk_score)}`}>
                            {m.access_risk_score}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ── Blast Radius Tab ────────────────────────────────────────────── */}
          <TabsContent value="blast-radius" className="space-y-4">
            {blastLoading ? (
              <LoadingSkeleton variant="card" />
            ) : blastError ? (
              <ErrorState
                message={t.loadBlastError}
                onRetry={() => void refetchBlast()}
              />
            ) : !blast ? (
              <Card>
                <CardContent className="p-0">
                  <EmptyState
                    size="compact"
                    icon={Zap}
                    title={t.noBlastTitle}
                    description={t.noBlastDescription}
                  />
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <DetailStatCard
                    label={t.totalAssetsExposed}
                    tone="sky"
                    value={<span className="tabular-nums">{blast.total_assets_exposed}</span>}
                    className=""
                  />
                  <DetailStatCard
                    label={t.sensitiveAssets}
                    tone={blast.sensitive_assets > 0 ? 'rose' : 'emerald'}
                    value={<span className="tabular-nums">{blast.sensitive_assets}</span>}
                    className=""
                  />
                  <DetailStatCard
                    label={t.weightedScore}
                    tone={scoreTone(blast.weighted_score)}
                    value={<span className="tabular-nums">{blast.weighted_score.toFixed(1)}</span>}
                    className=""
                  />
                </div>

                {/* Top Risky Assets */}
                {blast.top_risky_assets.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-semibold">
                        {t.topRiskyAssets}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {blast.top_risky_assets.map((asset) => (
                          <div
                            key={`${asset.data_asset_id}-${asset.permission_type}`}
                            className="flex items-center justify-between rounded-lg border p-3"
                          >
                            <div className="space-y-1">
                              <p className="text-sm font-medium">{asset.data_asset_name}</p>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={CLASSIFICATION_COLORS[asset.data_classification] ?? ''}
                                >
                                  {statusLabel(asset.data_classification)}
                                </Badge>
                                <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
                                  {asset.permission_type}
                                </span>
                              </div>
                            </div>
                            <div className="text-end">
                              <p className={`text-lg font-bold ${scoreTextColor(asset.weighted_score)}`}>
                                {asset.weighted_score.toFixed(1)}
                              </p>
                              <p className="text-xs text-muted-foreground">{t.weightedScoreLabel}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Escalation Paths */}
                {blast.escalation_paths.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-semibold">
                        {t.escalationPaths}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {blast.escalation_paths.map((path, idx) => (
                          <div
                            key={`${path.asset_id}-${path.pattern}-${idx}`}
                            className="rounded-lg border p-3"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="space-y-1">
                                <p className="text-sm font-medium">{path.pattern}</p>
                                <p className="text-xs text-muted-foreground">
                                  {t.escalationOn(path.from_permission, path.to_permission, path.asset_name)}
                                </p>
                                {path.mitre_technique && (
                                  <p className="text-xs text-muted-foreground">
                                    {t.mitreLabel(path.mitre_technique)}
                                  </p>
                                )}
                              </div>
                              <StatusBadge
                                status={path.severity}
                                map={severityMap}
                                size="sm"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Recommendations Tab ─────────────────────────────────────────── */}
          <TabsContent value="recommendations" className="space-y-4">
            {recsLoading ? (
              <LoadingSkeleton variant="card" />
            ) : recsError ? (
              <ErrorState
                message={t.loadRecsError}
                onRetry={() => void refetchRecs()}
              />
            ) : recommendations.length === 0 ? (
              <Card>
                <CardContent className="p-0">
                  <EmptyState
                    size="compact"
                    icon={Lightbulb}
                    title={t.noRecsTitle}
                    description={t.noRecsDescription}
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {recommendations.map((rec, idx) => (
                  <Card key={`${rec.mapping_id}-${rec.type}-${idx}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <Badge
                          variant="outline"
                          className={RECOMMENDATION_TYPE_COLORS[rec.type] ?? 'bg-secondary text-foreground'}
                        >
                          {statusLabel(rec.type)}
                        </Badge>
                        <span className={`text-xs font-semibold ${scoreTextColor(rec.risk_reduction)}`}>
                          {t.riskReductionTag(rec.risk_reduction)}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{rec.data_asset_name}</p>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
                            {rec.permission_type}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{rec.reason}</p>
                      <p className="text-xs">
                        <span className="font-medium">{t.impact}</span>{' '}
                        <span className="text-muted-foreground">{rec.impact}</span>
                      </p>
                      {canRemediate && (
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            variant={rec.type === 'revoke' ? 'destructive' : 'default'}
                            size="sm"
                            className="flex-1"
                            disabled={remediate.isPending}
                            onClick={() => setPendingRec(rec)}
                          >
                            <ShieldOff className="me-1.5 h-3.5 w-3.5" />
                            {rec.type === 'revoke' ? t.revokeAccess : t.applyRecommendation}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={remediate.isPending}
                            onClick={() => submitRemediation(rec, 'dismiss')}
                          >
                            {t.dismissRecommendation}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Audit Trail Tab ─────────────────────────────────────────────── */}
          <TabsContent value="audit-trail" className="space-y-4">
            {auditLoading ? (
              <LoadingSkeleton variant="table-row" count={5} />
            ) : auditError ? (
              <ErrorState
                message={t.loadAuditError}
                onRetry={() => void refetchAudit()}
              />
            ) : auditEntries.length === 0 ? (
              <Card>
                <CardContent className="p-0">
                  <EmptyState
                    size="compact"
                    icon={Clock}
                    title={t.noAuditTitle}
                    description={t.noAuditDescription}
                  />
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-4 py-3 text-start font-medium">{t.colAction}</th>
                        <th className="px-4 py-3 text-start font-medium">{t.colTable}</th>
                        <th className="px-4 py-3 text-start font-medium">{t.colDatabase}</th>
                        <th className="px-4 py-3 text-start font-medium">{t.colSourceIp}</th>
                        <th className="px-4 py-3 text-end font-medium">{t.colRows}</th>
                        <th className="px-4 py-3 text-end font-medium">{t.colDuration}</th>
                        <th className="px-4 py-3 text-center font-medium">{t.colStatus}</th>
                        <th className="px-4 py-3 text-start font-medium">{t.colTime}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEntries.map((entry) => (
                        <tr key={entry.id} className="border-b last:border-b-0 hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono uppercase">
                              {entry.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {entry.table_name || '--'}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {entry.database_name || '--'}
                          </td>
                          <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                            {entry.source_ip || '--'}
                          </td>
                          <td className="px-4 py-3 text-end text-xs tabular-nums text-muted-foreground">
                            {entry.rows_affected ?? '--'}
                          </td>
                          <td className="px-4 py-3 text-end text-xs tabular-nums text-muted-foreground">
                            {entry.duration_ms != null ? `${entry.duration_ms}ms` : '--'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {entry.success ? (
                              <CheckCircle className="mx-auto h-4 w-4 text-primary" />
                            ) : (
                              <XCircle className="mx-auto h-4 w-4 text-status-error" />
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {format(new Date(entry.event_timestamp), 'MMM d, yyyy HH:mm')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {auditMeta && auditMeta.total_pages > 1 && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {t.paginationSummary(auditMeta.page, auditMeta.total_pages, auditMeta.total)}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={auditPage <= 1}
                        onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={auditPage >= auditMeta.total_pages}
                        onClick={() => setAuditPage((p) => p + 1)}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Remediation confirmation. Opened by the per-recommendation primary
            action; on confirm it POSTs a real persisted apply/revoke transition. */}
        <Dialog open={pendingRec !== null} onOpenChange={(open) => { if (!open) setPendingRec(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t.confirmRemediationTitle}</DialogTitle>
              {pendingRec && (
                <DialogDescription>
                  {t.confirmRemediationDescription(
                    statusLabel(pendingRec.permission_type),
                    pendingRec.data_asset_name,
                  )}
                </DialogDescription>
              )}
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingRec(null)} disabled={remediate.isPending}>
                {t.confirmRemediationCancel}
              </Button>
              <Button
                variant={pendingRec?.type === 'revoke' ? 'destructive' : 'default'}
                onClick={confirmRemediation}
                disabled={remediate.isPending}
              >
                {t.confirmRemediationConfirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionRedirect>
  );
}
