'use client';

/**
 * Integration detail page. Loads one endpoint (masked config), renders the
 * schema-driven {@link DynamicConnectorForm} (PUT on save, sentinel-preserving),
 * a per-kind banner, the sync-run ledger, and a sticky right-rail
 * {@link ConnectionPanel} (env badge, health, test, enable/disable, sync now).
 */
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, ShieldHalf, ShieldAlert, Activity, Inbox, GitCompareArrows } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { SectionCard } from '@/components/suites/section-card';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showSuccess, showBackendError } from '@/lib/toast';
import {
  deleteIntegration,
  getIntegration,
  proposeChange,
  type ProposeChangeResult,
} from '@/lib/lex/integrations';
import { useIntegrationLabels } from '../_lib/use-integration-labels';
import { kindMeta } from '../_lib/integration-kinds';
import { buildStatusConfig } from '../_lib/integration-status-config';
import { DynamicConnectorForm, type ConnectorSubmit } from '../_components/dynamic-connector-form';
import { ConnectionPanel } from '../_components/connection-panel';
import { KindBanner } from '../_components/kind-banner';
import { SyncRunLedger } from '../_components/sync-run-ledger';
import { ActivityTimeline } from '../_components/activity-timeline';
import { SandboxSimulator, isSandboxKind } from '../_components/sandbox-simulator';
import { BreakerPanel } from '../_components/breaker-panel';
import { DlqConsole } from '../_components/dlq-console';
import { EgressPolicyEditor } from '../_components/egress-policy-editor';
import { EndpointMetricsSection } from '../_components/endpoint-metrics-section';
import { useReliabilityLabels } from '../_lib/reliability-labels';
import { useGovernanceLabels } from '../_lib/governance-labels';
import { useObservabilityLabels } from '../_lib/observability-labels';
import { useExtensibilityLabels } from '../_lib/extensibility-labels';
import { PENDING_CHANGES_KEY } from '../_components/pending-changes-panel';

const LIST_ROUTE = '/lex/admin/integrations';

export default function IntegrationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const t = useIntegrationLabels();
  const rel = useReliabilityLabels();
  const g = useGovernanceLabels();
  const obs = useObservabilityLabels();
  const ext = useExtensibilityLabels();
  const { locale, direction } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('lex:write');
  // Reliability replay / breaker-reset are gated on the canonical
  // `lex:integration:manage`; coarse `lex:write` also satisfies it.
  const canManage = hasPermission('lex:integration:manage') || canWrite;
  const id = params?.id ?? '';

  const [deleteOpen, setDeleteOpen] = useState(false);

  const q = useQuery({
    queryKey: ['lex-integration', id],
    queryFn: () => getIntegration(id),
    enabled: Boolean(id),
  });

  // #13 maker-checker: config edits route through POST /integrations/{id}/changes.
  // The backend decides whether to apply immediately (returns the endpoint) or
  // queue a pending change (returns a PendingChange); we branch on `applied`.
  const save = useMutation({
    mutationFn: (config: Record<string, unknown>) => proposeChange(id, config),
    onSuccess: async (res: ProposeChangeResult) => {
      if (res.applied) {
        showSuccess(g.toastApplied);
      } else {
        showSuccess(g.toastQueued);
        await qc.invalidateQueries({ queryKey: PENDING_CHANGES_KEY });
      }
      await qc.invalidateQueries({ queryKey: ['lex-integration', id] });
      await qc.invalidateQueries({ queryKey: ['lex-integrations'] });
    },
    onError: (e) => showBackendError(e, g.toastError),
  });

  const del = useMutation({
    mutationFn: () => deleteIntegration(id),
    onSuccess: async () => {
      showSuccess(t.toastDeleted);
      await qc.invalidateQueries({ queryKey: ['lex-integrations'] });
      router.push(LIST_ROUTE);
    },
    onError: (e) => showBackendError(e, t.toastError),
  });

  function handleSubmit(submit: ConnectorSubmit) {
    // On the detail route the form only emits `update`. We forward the proposed
    // config map to the maker-checker endpoint, which protects active-production
    // / gov-gated connectors by queuing a pending change instead of applying.
    if (submit.mode === 'update') {
      save.mutate(submit.payload.config ?? {});
    }
  }

  if (q.isLoading) {
    return (
      <PermissionRedirect permission="lex:read">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader eyebrow={t.breadcrumb} title={t.detailTitle} />
          <LoadingSkeleton variant="card" count={4} />
        </div>
      </PermissionRedirect>
    );
  }

  if (q.isError || !q.data) {
    return (
      <PermissionRedirect permission="lex:read">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            eyebrow={t.breadcrumb}
            title={t.notFoundTitle}
            actions={
              <Button asChild variant="outline">
                <Link href={LIST_ROUTE}>{t.backToList}</Link>
              </Button>
            }
          />
          <SectionCard title={t.notFoundTitle} description={t.notFoundBody}>
            <ErrorState
              variant="notFound"
              title={t.notFoundTitle}
              message={t.notFoundBody}
              onRetry={() => void q.refetch()}
            />
          </SectionCard>
        </div>
      </PermissionRedirect>
    );
  }

  const endpoint = q.data;
  const meta = kindMeta(endpoint.kind);
  const statusConfig = buildStatusConfig(t);

  // PROTECTED (#13): an active-production OR government-gated connector routes
  // config edits through the maker-checker queue. We surface that on the form so
  // the operator knows Save creates a pending change rather than applying.
  const isProtected = endpoint.status === 'active' || meta.govGated;
  const protectedNotice =
    isProtected && canWrite ? (
      <div className="flex items-start gap-2 rounded-lg border border-warning-300 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:bg-warning-800/20 dark:text-warning-300">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">{g.protectedNoticeTitle}</p>
          <p>{g.protectedNoticeBody}</p>
          <Link
            href={`${LIST_ROUTE}/pending-changes`}
            className="inline-block font-medium text-warning-700 underline underline-offset-2 dark:text-warning-300"
          >
            {g.protectedViewQueue}
          </Link>
        </div>
      </div>
    ) : null;

  return (
    <PermissionRedirect permission="lex:read">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          eyebrow={t.breadcrumb}
          title={endpoint.name || endpoint.code}
          description={resolveLocalized(meta.name, locale)}
          tags={[
            {
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <meta.icon className="h-3.5 w-3.5" aria-hidden />
                  {resolveLocalized(meta.name, locale)}
                </span>
              ),
              tone: 'info',
            },
            ...(meta.govGated
              ? [{ label: t.govGatedBadge, tone: 'warning' as const }]
              : []),
          ]}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={endpoint.status} config={statusConfig} />
              <Button asChild variant="outline">
                <Link href={`${LIST_ROUTE}/${endpoint.id}/events`}>
                  <Inbox className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {obs.eventsTab}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`${LIST_ROUTE}/${endpoint.id}/conflicts`}>
                  <GitCompareArrows className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {ext.conflictsTab}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`${LIST_ROUTE}/${endpoint.id}/dlq`}>
                  <ShieldHalf className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {rel.dlqTab}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={LIST_ROUTE}>{t.backToList}</Link>
              </Button>
              {canWrite ? (
                <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {t.deleteAction}
                </Button>
              ) : null}
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <KindBanner kind={endpoint.kind} />

            {!canWrite ? (
              <div className="rounded-xl border border-warning-300 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:bg-warning-800/20 dark:text-warning-300">
                {t.readOnlyNote}
              </div>
            ) : null}

            <SectionCard title={t.detailTitle} description={endpoint.code}>
              <DynamicConnectorForm
                kind={endpoint.kind}
                endpoint={endpoint}
                submitting={save.isPending}
                readOnly={!canWrite}
                protectedNotice={protectedNotice}
                onSubmit={handleSubmit}
                onCancel={() => router.push(LIST_ROUTE)}
              />
            </SectionCard>

            {/* Sandbox simulator (Feature 9) — gov-gated kinds only (najiz/nafath). */}
            {isSandboxKind(endpoint.kind) ? (
              <SandboxSimulator endpoint={endpoint} canManage={canManage} />
            ) : null}

            {/* Metrics & SLO (#16) — per-connector traffic/latency snapshot. */}
            <SectionCard
              title={obs.endpointMetricsTitle}
              description={obs.endpointMetricsSubtitle}
              actions={
                <Button asChild variant="ghost" size="sm">
                  <Link href={`${LIST_ROUTE}/observability`}>
                    <Activity className="me-1.5 h-3.5 w-3.5" aria-hidden />
                    {obs.obsTab}
                  </Link>
                </Button>
              }
            >
              <EndpointMetricsSection endpointId={endpoint.id} />
            </SectionCard>

            <SyncRunLedger endpointId={endpoint.id} />

            {/* Dead-letter queue (#11) — failed-op replay. */}
            <SectionCard title={rel.dlqTitle} description={rel.dlqSubtitle}>
              <DlqConsole endpointId={endpoint.id} canManage={canManage} />
            </SectionCard>

            {/* Activity timeline (Feature 10). */}
            <ActivityTimeline endpointId={endpoint.id} />
          </div>

          <div className="space-y-6">
            <ConnectionPanel
              endpoint={endpoint}
              readOnly={!canWrite}
              onChanged={() => void q.refetch()}
            />

            {/* Circuit breaker (#12) — live state + manage-gated reset. */}
            <BreakerPanel endpointId={endpoint.id} canManage={canManage} variant="card" />

            {/* Egress policy (#15) — data-residency / DLP guardrail. */}
            <SectionCard title={g.egressTitle} description={g.egressSubtitle}>
              <EgressPolicyEditor endpointId={endpoint.id} canManage={canManage} />
            </SectionCard>
          </div>
        </div>

        {canWrite ? (
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={t.deleteConfirmTitle}
            description={t.deleteConfirmBody}
            confirmLabel={t.deleteAction}
            variant="destructive"
            loading={del.isPending}
            onConfirm={async () => {
              await del.mutateAsync();
            }}
          />
        ) : null}
      </div>
    </PermissionRedirect>
  );
}
