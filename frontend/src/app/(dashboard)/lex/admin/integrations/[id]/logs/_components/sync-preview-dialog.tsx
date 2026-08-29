'use client';

/**
 * SyncPreviewDialog — a guarded "preview then commit" flow for an integration
 * sync (feature 5).
 *
 * Before a real sync, the operator opens this dialog which calls
 * `previewSync(id)` (POST /integrations/{id}/sync?mode=preview, a DRY RUN that
 * commits nothing). It renders what a real run *would* do — "would create N /
 * update N / deactivate N" — behind a prominent "Dry run" badge, then offers a
 * single Confirm-and-run action that fires the REAL sync (`syncNow(id, mode)`)
 * and invalidates the ledger so the new run appears.
 *
 * The wire {@link SyncReport} carries processed / created / updated / skipped /
 * failed plus a free `metadata` bag and a top-level `dry_run` flag the preview
 * mode adds; "deactivate" has no dedicated field, so we read it defensively from
 * metadata (`deactivated` / `disabled` / `deactivate`) and fall back to `skipped`
 * only when the connector does not report it. Everything degrades gracefully and
 * every string flows through the bilingual logs label module. RTL-safe (logical
 * properties; tabular-nums for figures).
 */
import { useEffect, useRef, useState } from 'react';
import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import {
  Loader2,
  PlayCircle,
  RefreshCw,
  AlertTriangle,
  PlusCircle,
  PencilLine,
  PowerOff,
  SkipForward,
  ScanSearch,
  XCircle,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/empty-state';
import { cn } from '@/lib/utils';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  lexIntegrationsApi,
  type MassChangeGuard,
  type SyncReport,
  type SyncMode,
} from '@/lib/lex/integrations';
import type { IntegrationLogsLabels } from './logs-labels';
import { interpolate } from './logs-labels';
import {
  fillExtToken,
  useExtensibilityLabels,
} from '../../../_lib/extensibility-labels';

/**
 * The preview SyncReport carries a top-level `dry_run` flag the backend adds for
 * mode=preview (not in the shared {@link SyncReport} type yet). Read it defensively.
 */
type PreviewReport = SyncReport & { dry_run?: boolean };

export interface SyncPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpointId: string;
  /** Real sync mode the Confirm-and-run action will execute. */
  mode: SyncMode;
  /** Query key of the sync-run ledger to invalidate after a real sync. */
  ledgerQueryKey: QueryKey;
  dir: 'ltr' | 'rtl';
  lang: 'ar' | 'en';
  local: IntegrationLogsLabels;
  /** Localized human name of the real mode (e.g. "Delta" / "تفاضلي"). */
  modeLabel: string;
}

/** Pull a "would deactivate" count out of the report metadata, defensively. */
function readDeactivate(report: PreviewReport): number {
  const meta = report.metadata ?? {};
  for (const key of ['deactivated', 'deactivate', 'disabled', 'would_deactivate']) {
    const raw = meta[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  }
  return report.skipped;
}

function isDryRun(report: PreviewReport): boolean {
  if (typeof report.dry_run === 'boolean') return report.dry_run;
  const flag = report.metadata?.dry_run;
  return typeof flag === 'boolean' ? flag : true;
}

interface StatProps {
  icon: typeof PlusCircle;
  label: string;
  value: number;
  tone: 'create' | 'update' | 'deactivate' | 'skip' | 'processed' | 'fail';
  detail: string;
}

const TONE: Record<StatProps['tone'], string> = {
  create: 'text-success-700 dark:text-success-300',
  update: 'text-sky-700 dark:text-sky-400',
  deactivate: 'text-warning-700 dark:text-warning-300',
  skip: 'text-muted-foreground',
  processed: 'text-foreground',
  fail: 'text-error-600 dark:text-error-300',
};

function SyncPreviewStat({ icon: Icon, label, value, tone, detail }: StatProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => setExpanded((current) => !current)}
      aria-expanded={expanded}
      className="card h-auto items-start justify-start gap-3 p-3 text-start font-normal transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={cn('shrink-0', TONE[tone])} aria-hidden>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className={cn('text-xl font-bold tabular-nums leading-none', TONE[tone])}>
          {Number.isFinite(value) ? value.toLocaleString() : '—'}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{label}</div>
        {expanded ? <p className="mt-2 text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </Button>
  );
}

export function SyncPreviewDialog({
  open,
  onOpenChange,
  endpointId,
  mode,
  ledgerQueryKey,
  dir,
  lang,
  local,
  modeLabel,
}: SyncPreviewDialogProps) {
  const qc = useQueryClient();
  const ext = useExtensibilityLabels();
  const [report, setReport] = useState<PreviewReport | null>(null);
  // Mass-change guard (#20): set when a preview or sync trips the deactivation
  // ceiling; the operator must explicitly confirm to FORCE the run past it.
  const [guard, setGuard] = useState<MassChangeGuard | null>(null);

  const previewMutation = useMutation({
    mutationFn: () => lexIntegrationsApi.previewSync(endpointId),
    onSuccess: (result) => {
      if (result.guarded) {
        setGuard(result.guard);
        setReport(null);
      } else {
        setGuard(null);
        setReport(result.report as PreviewReport);
      }
    },
    onError: showApiError,
  });

  const syncMutation = useMutation({
    // `force` is only set after the operator confirms the guard.
    mutationFn: (force: boolean) => lexIntegrationsApi.syncNow(endpointId, mode, force),
    onSuccess: (result) => {
      if (result.guarded) {
        // The guard tripped on the real run (e.g. data shifted since preview).
        setGuard(result.guard);
        return;
      }
      setGuard(null);
      showSuccess(local.toastSyncDone);
      void qc.invalidateQueries({ queryKey: ledgerQueryKey });
      handleOpenChange(false);
    },
    onError: showApiError,
  });

  const previewMutate = previewMutation.mutate;
  const previewReset = previewMutation.reset;

  // Kick off the preview whenever the dialog transitions closed → open. Radix
  // only fires `onOpenChange` for *user-driven* open/close, never for a parent
  // setting `open={true}` programmatically (the button that mounts this dialog),
  // so we cannot rely on the change handler to start the dry-run. An effect keyed
  // on `open` covers both entry paths and resets state on exit so the next open
  // re-previews fresh.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      previewMutate();
    } else if (!open && wasOpen.current) {
      setReport(null);
      setGuard(null);
      previewReset();
    }
    wasOpen.current = open;
  }, [open, previewMutate, previewReset]);

  // Radix close affordances (overlay / ESC / close button) + our own buttons
  // route through here; opening is handled by the effect above.
  function handleOpenChange(next: boolean) {
    onOpenChange(next);
  }

  const loading = previewMutation.isPending;
  const errored = previewMutation.isError && !report;
  const running = syncMutation.isPending;

  const created = report?.created ?? 0;
  const updated = report?.updated ?? 0;
  const deactivated = report ? readDeactivate(report) : 0;
  const skipped = report?.skipped ?? 0;
  const processed = report?.processed ?? 0;
  const failed = report?.failed ?? 0;
  const noChanges =
    Boolean(report) && created === 0 && updated === 0 && deactivated === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        dir={dir}
        lang={lang}
        className="max-w-xl"
      >
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch className="h-5 w-5 text-primary" aria-hidden />
            {local.previewTitle}
            {report ? (
              <Badge
                variant={isDryRun(report) ? 'warning' : 'outline'}
                className="ms-1"
              >
                {local.previewDryRunBadge}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>{local.previewSubtitle}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">{local.previewLoading}</p>
          </div>
        ) : errored ? (
          <EmptyState
            icon={XCircle}
            size="compact"
            title={local.previewErrorTitle}
            description={local.previewErrorBody}
            action={{
              label: local.previewRerun,
              onClick: () => previewMutation.mutate(),
            }}
          />
        ) : guard ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-md border border-error-300 bg-error-50 p-4 text-sm text-error-700 dark:border-error-700/40 dark:bg-error-700/20 dark:text-error-300">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div className="space-y-1">
                <p className="font-semibold">{ext.guardTitle}</p>
                <p>
                  {fillExtToken(ext.guardBody, {
                    n: guard.would_deactivate.toLocaleString(),
                    total: guard.mapped_total.toLocaleString(),
                    pct: Math.round(guard.pct),
                    threshold: Math.round(guard.threshold_pct),
                  })}
                </p>
                {guard.detail ? <p className="text-xs opacity-80">{guard.detail}</p> : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <SyncPreviewStat
                icon={PowerOff}
                label={local.previewWouldDeactivate}
                value={guard.would_deactivate}
                tone="deactivate"
                detail={guard.detail ?? fillExtToken(ext.guardWouldDeactivate, { n: guard.would_deactivate.toLocaleString() })}
              />
              <div className="card flex items-center gap-3 p-3">
                <span className="shrink-0 text-warning-700 dark:text-warning-300" aria-hidden>
                  <ShieldAlert className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-xl font-bold tabular-nums leading-none text-warning-700 dark:text-warning-300">
                    {Math.round(guard.threshold_pct)}%
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {fillExtToken(ext.guardThreshold, {
                      threshold: Math.round(guard.threshold_pct),
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : report ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-warning-100 bg-warning-50 p-3 text-xs text-warning-700 dark:border-warning-800/40 dark:bg-warning-800/20 dark:text-warning-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{local.previewDryRunNote}</span>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {local.previewSummaryHeading}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <SyncPreviewStat
                  icon={PlusCircle}
                  label={local.previewWouldCreate}
                  value={created}
                  tone="create"
                  detail={report.detail}
                />
                <SyncPreviewStat
                  icon={PencilLine}
                  label={local.previewWouldUpdate}
                  value={updated}
                  tone="update"
                  detail={report.detail}
                />
                <SyncPreviewStat
                  icon={PowerOff}
                  label={local.previewWouldDeactivate}
                  value={deactivated}
                  tone="deactivate"
                  detail={report.detail}
                />
                <SyncPreviewStat
                  icon={SkipForward}
                  label={local.previewWouldSkip}
                  value={skipped}
                  tone="skip"
                  detail={report.detail}
                />
                <SyncPreviewStat
                  icon={ScanSearch}
                  label={local.previewProcessed}
                  value={processed}
                  tone="processed"
                  detail={report.detail}
                />
                {failed > 0 ? (
                  <SyncPreviewStat
                    icon={AlertTriangle}
                    label={local.previewWouldFail}
                    value={failed}
                    tone="fail"
                    detail={report.detail}
                  />
                ) : null}
              </div>
            </div>

            {noChanges ? (
              <div className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/30 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="font-medium">{local.previewNoChangesTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {local.previewNoChangesBody}
                  </p>
                </div>
              </div>
            ) : null}

            {report.detail ? (
              <p className="text-xs text-muted-foreground">{report.detail}</p>
            ) : null}

            <p className="text-xs text-muted-foreground">
              {interpolate(local.previewModeLabel, { mode: modeLabel })}
            </p>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={running}
          >
            {local.previewClose}
          </Button>
          {report || guard ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => previewMutation.mutate()}
              disabled={loading || running}
            >
              <RefreshCw
                className={cn('me-1.5 h-4 w-4', loading && 'animate-spin')}
                aria-hidden
              />
              {local.previewRerun}
            </Button>
          ) : null}
          {guard ? (
            // Mass-change guard tripped: the only way forward is an explicit force.
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => syncMutation.mutate(true)}
              disabled={loading || running}
            >
              {running ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ShieldAlert className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {running ? ext.guardForcing : ext.guardForceConfirm}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => syncMutation.mutate(false)}
              disabled={!report || loading || running}
            >
              {running ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <PlayCircle className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {running ? local.previewConfirmRunning : local.previewConfirmRun}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SyncPreviewDialog;
