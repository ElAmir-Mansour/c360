'use client';

/**
 * ConnectionPanel — the sticky right-rail operations surface for one endpoint.
 *
 * Surfaces live operations that act on a persisted endpoint (so it only renders
 * on the detail route, never on /new):
 *   - environment badge (Production / Sandbox), derived from config/metadata
 *   - Health badge (derived grade, refreshed by a single-endpoint probe)
 *   - Enable / Disable toggle → PUT status
 *   - Sync now (full | delta) for sync-capable kinds
 *   - {@link DiagnosticChecklist} (Feature 2) — layered connection test that
 *     replaces the old boolean Test result with a per-step checklist
 *   - {@link HealthHistoryChart} (Feature 6) — reachability sparkline
 *   - {@link WebhookHelper} (Feature 3) — inbound URLs + synthetic event test
 *   - {@link SecretRotationDialog} (Feature 7) — write-only secret rotation
 *
 * MANAGE controls (diagnostics, webhook test, secret rotation, enable/sync) are
 * gated on `canManage` (`!readOnly`); read-only users see disabled/hidden
 * affordances. All mutating helpers surface errors via toast; read helpers are
 * graceful (the health probe may be unavailable and returns null).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  FlaskConical,
  History,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Webhook,
} from 'lucide-react';
import { Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/shared/status-badge';
import { RelativeTime } from '@/components/shared/relative-time';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showSuccess, showWarning, showBackendError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  deriveHealthGrade,
  getIntegrationHealth,
  syncNow,
  updateIntegration,
  type IntegrationEndpoint,
  type SyncMode,
} from '@/lib/lex/integrations';
import { useIntegrationLabels, fillToken } from '../_lib/use-integration-labels';
import { useDetailOpsLabels } from '../_lib/detail-ops-labels';
import { buildHealthGradeConfig, isSyncCapable } from '../_lib/integration-status-config';
import { isGovGated } from '../_lib/integration-kinds';
import { DiagnosticChecklist } from './diagnostic-checklist';
import { WebhookHelper } from './webhook-helper';
import { SecretRotationDialog } from './secret-rotation-dialog';
import { HealthHistoryChart } from './health-history-chart';

interface ConnectionPanelProps {
  endpoint: IntegrationEndpoint;
  readOnly?: boolean;
  /** Notify the parent that the endpoint changed (status toggle), to refetch. */
  onChanged?: () => void;
}

/** Heuristic: is this endpoint pointed at a sandbox / non-prod environment? */
function isSandbox(endpoint: IntegrationEndpoint): boolean {
  const probe = (v: unknown) =>
    typeof v === 'string' && /sandbox|sbx|staging|test|dev|uat|preprod/i.test(v);
  const cfg = endpoint.config ?? {};
  const meta = endpoint.metadata ?? {};
  return (
    probe(cfg.environment) ||
    probe(cfg.env) ||
    probe(cfg.base_url) ||
    probe(cfg.mode) ||
    probe(meta.environment) ||
    cfg.sandbox === true ||
    meta.sandbox === true
  );
}

export function ConnectionPanel({ endpoint, readOnly = false, onChanged }: ConnectionPanelProps) {
  const t = useIntegrationLabels();
  const ops = useDetailOpsLabels();
  const { locale, direction } = useLocaleOrDefault();
  const qc = useQueryClient();
  const gradeConfig = buildHealthGradeConfig(t);

  const [syncMode, setSyncMode] = useState<SyncMode>('delta');
  const [enableConfirmOpen, setEnableConfirmOpen] = useState(false);
  const canManage = !readOnly;

  const sandbox = isSandbox(endpoint);
  const enabled = endpoint.status === 'active';
  const syncable = isSyncCapable(endpoint.kind);
  // HONESTY (#7): gov-gated connectors (najiz / nafath / emdha) are NOT live
  // until Saudi government / TSP onboarding completes. We never imply a live
  // "Production" connection for them, and enabling one requires an explicit
  // acknowledgement that activation does not bypass onboarding.
  const govGated = isGovGated(endpoint.kind);

  // Single-endpoint health probe (graceful: null when unavailable).
  const healthQuery = useQuery({
    queryKey: ['lex-integration-health', endpoint.id],
    queryFn: () => getIntegrationHealth(endpoint.id),
    staleTime: 30_000,
  });
  const grade = deriveHealthGrade(endpoint, healthQuery.data ?? undefined);

  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      updateIntegration(endpoint.id, { status: next ? 'active' : 'disabled' }),
    onSuccess: async (_data, next) => {
      showSuccess(next ? t.toastEnabled : t.toastDisabled);
      await qc.invalidateQueries({ queryKey: ['lex-integration', endpoint.id] });
      await qc.invalidateQueries({ queryKey: ['lex-integrations'] });
      onChanged?.();
    },
    onError: (e) => showBackendError(e, t.toastError),
  });

  // Gov-gated enable is gated behind a confirm; disable + non-gov-gated toggle
  // straight through. (Disabling is always allowed without the onboarding gate.)
  function requestToggle(next: boolean) {
    if (next && govGated) {
      setEnableConfirmOpen(true);
      return;
    }
    toggle.mutate(next);
  }

  const sync = useMutation({
    mutationFn: (mode: SyncMode) => syncNow(endpoint.id, mode),
    onSuccess: async (result) => {
      // Mass-change guard (#20): a runaway-deactivation sync is blocked here. The
      // force/confirm flow lives in the logs page's SyncPreviewDialog; from the
      // panel we just warn and point the operator there.
      if (result.guarded) {
        showWarning(
          t.guardBlockedTitle,
          fillToken(t.guardBlockedBody, 'pct', Math.round(result.guard.pct)),
        );
        return;
      }
      showSuccess(t.toastSyncDone);
      await qc.invalidateQueries({ queryKey: ['lex-integration-sync-runs', endpoint.id] });
    },
    onError: (e) => showBackendError(e, t.toastError),
  });

  return (
    <aside
      className="card sticky top-20 space-y-5 p-5"
      dir={direction}
      lang={locale}
      aria-label={t.connectionPanelTitle}
    >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <PlugZap className="h-4 w-4 text-primary" aria-hidden />
          {t.connectionPanelTitle}
        </h2>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium',
            govGated
              ? 'border-warning-300 bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300'
              : sandbox
                ? 'border-warning-300 bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300'
                : 'border-primary/30 bg-primary/10 text-primary',
          )}
        >
          {govGated ? (
            <Landmark className="h-3 w-3" aria-hidden />
          ) : sandbox ? (
            <FlaskConical className="h-3 w-3" aria-hidden />
          ) : null}
          {govGated ? t.govGatedBadge : sandbox ? t.envBadgeSandbox : t.envBadgeProd}
        </span>
      </div>

      {/* HONESTY (#7): never imply a live connection for an un-onboarded gov-gated
          connector — surface the onboarding prerequisite up front. */}
      {govGated ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-caption leading-5 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300">
          <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t.govGatedHint}</span>
        </div>
      ) : null}

      {/* Health. */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Activity className="h-3.5 w-3.5" aria-hidden />
          {t.healthLabel}
        </span>
        {healthQuery.isLoading ? (
          <span className="text-xs text-muted-foreground">{t.healthUnknown}</span>
        ) : (
          <StatusBadge status={grade} config={gradeConfig} variant="dot" size="sm" />
        )}
      </div>

      {/* Enable / Disable. */}
      <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
        <Label htmlFor="integration-enabled" className="text-sm">
          {enabled ? t.disable : t.enable}
        </Label>
        <div className="flex items-center gap-2">
          {toggle.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
          <Switch
            id="integration-enabled"
            checked={enabled}
            onCheckedChange={requestToggle}
            disabled={readOnly || toggle.isPending}
          />
        </div>
      </div>

      {/* Connection diagnostics (Feature 2) — layered per-step checklist. */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {ops.diagnosticsTitle}
        </h3>
        <DiagnosticChecklist
          endpointId={endpoint.id}
          canManage={canManage}
          onTested={() => void healthQuery.refetch()}
        />
      </div>

      {/* Sync now. */}
      {syncable ? (
        <div className="space-y-2 rounded-lg border bg-muted/10 p-3">
          <Label className="text-xs font-medium text-muted-foreground">{t.syncNow}</Label>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => setSyncMode('delta')}
                className={cn(
                  'flex-1 px-2 py-1.5 text-xs font-medium transition-colors',
                  syncMode === 'delta'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground hover:bg-muted',
                )}
              >
                {t.syncDelta}
              </button>
              <button
                type="button"
                onClick={() => setSyncMode('full')}
                className={cn(
                  'flex-1 border-s px-2 py-1.5 text-xs font-medium transition-colors',
                  syncMode === 'full'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground hover:bg-muted',
                )}
              >
                {t.syncFull}
              </button>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => sync.mutate(syncMode)}
            disabled={readOnly || sync.isPending || !enabled}
          >
            {sync.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="me-1.5 h-4 w-4" aria-hidden />
            )}
            {sync.isPending ? t.syncing : t.syncNow}
          </Button>
        </div>
      ) : null}

      {/* Health history (Feature 6 — detail sparkline). */}
      <div className="space-y-2 border-t pt-4">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <History className="h-3.5 w-3.5" aria-hidden />
          {ops.healthHistoryTitle}
        </h3>
        <HealthHistoryChart endpointId={endpoint.id} />
      </div>

      {/* Inbound endpoints + webhook test (Feature 3). */}
      <div className="space-y-2 border-t pt-4">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Webhook className="h-3.5 w-3.5" aria-hidden />
          {ops.webhookTitle}
        </h3>
        <WebhookHelper endpoint={endpoint} canManage={canManage} />
      </div>

      {/* Secret rotation (Feature 7). */}
      <div className="space-y-2 border-t pt-4">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {ops.rotateTitle}
        </h3>
        <p className="text-caption text-muted-foreground">{ops.rotateSubtitle}</p>
        <SecretRotationDialog
          endpoint={endpoint}
          canManage={canManage}
          onRotated={() => onChanged?.()}
        />
      </div>

      {endpoint.last_checked_at ? (
        <p className="border-t pt-4 text-caption text-muted-foreground">
          {t.testLastChecked}: <RelativeTime date={endpoint.last_checked_at} />
        </p>
      ) : null}

      {/* Gov-gated enable confirm (#7) — activation does not bypass onboarding. */}
      {govGated ? (
        <ConfirmDialog
          open={enableConfirmOpen}
          onOpenChange={setEnableConfirmOpen}
          title={t.govGatedBadge}
          description={t.govGatedHint}
          confirmLabel={t.enable}
          cancelLabel={t.cancel}
          loading={toggle.isPending}
          onConfirm={async () => {
            await toggle.mutateAsync(true);
          }}
        />
      ) : null}
    </aside>
  );
}
