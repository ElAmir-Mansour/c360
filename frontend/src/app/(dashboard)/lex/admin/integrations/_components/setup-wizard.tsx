'use client';

/**
 * SetupWizard (Feature 1) — guided connector onboarding.
 *
 * After a kind is picked from the CatalogGallery, this stepper walks an operator
 * from prerequisites to a live, synced connector:
 *
 *   1. Prerequisites — render the catalog's `prerequisite_steps` as a checklist
 *      plus the `callback_templates` (copyable URLs to register externally).
 *   2. Credentials  — the existing schema-driven DynamicConnectorForm. Submitting
 *      it CREATES the endpoint; from here on the wizard operates on its id.
 *   3. Test         — an inline DiagnosticChecklist (testConnection → steps[]).
 *   4. Enable       — flip status to `active` (PUT).
 *   5. First sync   — optionally run an initial full/delta sync.
 *
 * Steps after Credentials are gated until the endpoint exists. Test, Enable, and
 * Sync are all skippable (you can finish a planned, untested connector). On
 * finish we route to the endpoint detail page.
 *
 * The catalog feeds prerequisites/callbacks; if the live catalog is unavailable,
 * the prerequisite step warns before falling back to the basic kind metadata.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  Loader2,
  PlayCircle,
  PlugZap,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showSuccess, showWarning, showBackendError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  createIntegration,
  getCatalogResult,
  syncNow,
  testConnection,
  updateIntegration,
  type CatalogEntry,
  type CreateIntegrationPayload,
  type DiagnosticStatus,
  type IntegrationEndpoint,
  type IntegrationKind,
  type SyncMode,
  type TestResult,
} from '@/lib/lex/integrations';
import { kindMeta, isSyncCapableKind } from '../_lib/integration-kinds';
import { useIntegrationLabels, fillToken } from '../_lib/use-integration-labels';
import { DynamicConnectorForm, type ConnectorSubmit } from './dynamic-connector-form';

type Labels = ReturnType<typeof useIntegrationLabels>;

const LIST_ROUTE = '/lex/admin/integrations';

type StepKey = 'prereq' | 'credentials' | 'test' | 'enable' | 'sync';

interface SetupWizardProps {
  kind: IntegrationKind;
  readOnly?: boolean;
  /** Navigate to the created endpoint detail page on finish. */
  onFinish: (endpointId: string) => void;
  /** Return to the catalog gallery (change kind). */
  onChangeKind: () => void;
}

export function SetupWizard({ kind, readOnly = false, onFinish, onChangeKind }: SetupWizardProps) {
  const t = useIntegrationLabels();
  const { locale, direction } = useLocaleOrDefault();
  const qc = useQueryClient();
  const meta = kindMeta(kind);

  const [stepIndex, setStepIndex] = useState(0);
  const [created, setCreated] = useState<IntegrationEndpoint | null>(null);
  const [prereqAck, setPrereqAck] = useState(false);

  const steps: { key: StepKey; label: string; desc: string }[] = [
    { key: 'prereq', label: t.wizardStepPrereq, desc: t.wizardStepPrereqDesc },
    { key: 'credentials', label: t.wizardStepCredentials, desc: t.wizardStepCredentialsDesc },
    { key: 'test', label: t.wizardStepTest, desc: t.wizardStepTestDesc },
    { key: 'enable', label: t.wizardStepEnable, desc: t.wizardStepEnableDesc },
    { key: 'sync', label: t.wizardStepSync, desc: t.wizardStepSyncDesc },
  ];
  const current = steps[stepIndex];

  // Catalog entry for prerequisites + callbacks; degraded means live metadata is unavailable.
  const catalogQuery = useQuery({
    queryKey: ['lex-integration-catalog'],
    queryFn: () => getCatalogResult(),
    staleTime: 5 * 60_000,
  });
  const catalogEntries = catalogQuery.data?.entries ?? [];
  const catalogDegraded = catalogQuery.isError || (catalogQuery.data?.degraded ?? false);
  const entry: CatalogEntry | undefined = useMemo(
    () => catalogEntries.find((c) => c.kind === kind),
    [catalogEntries, kind],
  );

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const createMut = useMutation({
    mutationFn: (payload: CreateIntegrationPayload) => createIntegration(payload),
    onSuccess: async (endpoint) => {
      setCreated(endpoint);
      showSuccess(t.toastCreated);
      await qc.invalidateQueries({ queryKey: ['lex-integrations'] });
      goNext();
    },
    onError: (e) => showBackendError(e, t.toastError),
  });

  function handleCredentialsSubmit(submit: ConnectorSubmit) {
    if (submit.mode === 'create') createMut.mutate(submit.payload);
  }

  return (
    <div
      className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]"
      dir={direction}
      lang={locale}
    >
      {/* Stepper rail. */}
      <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-0" aria-label={meta.kind}>
        {steps.map((s, i) => {
          const state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo';
          const reachable = i <= stepIndex;
          return (
            <li key={s.key} className="flex-1 lg:flex-none">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => reachable && setStepIndex(i)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start transition-colors',
                  state === 'current' && 'bg-primary/10',
                  reachable ? 'hover:bg-muted' : 'cursor-default opacity-60',
                )}
              >
                <span
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                    state === 'done' && 'border-primary bg-primary text-primary-foreground',
                    state === 'current' && 'border-primary text-primary',
                    state === 'todo' && 'border-muted-foreground/30 text-muted-foreground',
                  )}
                >
                  {state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block truncate text-sm font-medium',
                      state === 'current' ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {s.label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Active step panel. */}
      <div className="card space-y-5 p-5">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {fillToken(
              fillToken(t.wizardStepLabel, 'n', stepIndex + 1),
              'total',
              steps.length,
            )}
          </p>
          <h2 className="text-h4 font-semibold">{current.label}</h2>
          <p className="text-sm text-muted-foreground">{current.desc}</p>
        </div>

        {current.key === 'prereq' ? (
          <PrereqStep
            entry={entry}
            loading={catalogQuery.isLoading}
            degraded={catalogDegraded}
            ack={prereqAck}
            onAck={setPrereqAck}
            onNext={goNext}
            onChangeKind={onChangeKind}
            t={t}
          />
        ) : null}

        {current.key === 'credentials' ? (
          <div className="space-y-3">
            {created ? (
              <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {t.wizardCreatedNotice}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t.wizardCreateFirst}</p>
            )}
            <DynamicConnectorForm
              kind={kind}
              endpoint={created}
              submitting={createMut.isPending}
              readOnly={readOnly || Boolean(created)}
              onSubmit={handleCredentialsSubmit}
              onCancel={goBack}
            />
            {created ? (
              <div className="flex justify-end">
                <Button type="button" onClick={goNext}>
                  {t.wizardNext}
                  <ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden />
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {current.key === 'test' && created ? (
          <TestStep endpoint={created} onNext={goNext} onBack={goBack} t={t} />
        ) : null}

        {current.key === 'enable' && created ? (
          <EnableStep
            endpoint={created}
            readOnly={readOnly}
            onEnabled={(updated) => setCreated(updated)}
            onNext={goNext}
            onBack={goBack}
            t={t}
          />
        ) : null}

        {current.key === 'sync' && created ? (
          <SyncStep
            endpoint={created}
            readOnly={readOnly}
            onFinish={() => onFinish(created.id)}
            onBack={goBack}
            t={t}
          />
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- *
 * Step 1 — Prerequisites + callbacks.
 * --------------------------------------------------------------------------- */

interface PrereqStepProps {
  entry?: CatalogEntry;
  loading: boolean;
  degraded: boolean;
  ack: boolean;
  onAck: (v: boolean) => void;
  onNext: () => void;
  onChangeKind: () => void;
  t: Labels;
}

function PrereqStep({
  entry,
  loading,
  degraded,
  ack,
  onAck,
  onNext,
  onChangeKind,
  t,
}: PrereqStepProps) {
  const { locale } = useLocaleOrDefault();
  const steps = entry?.prerequisite_steps ?? [];
  const callbacks = entry?.callback_templates ?? {};
  const hasSteps = steps.length > 0;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t.wizardPrereqIntro}</p>

      {degraded ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning-300/60 bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:bg-warning-800/15 dark:text-warning-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-0.5">
            <p className="font-medium">{t.catalogErrorTitle}</p>
            <p className="text-xs">{t.catalogErrorBody}</p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
      ) : hasSteps ? (
        <ol className="space-y-2">
          {steps.map((step, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 rounded-lg border bg-muted/10 px-3 py-2.5 text-sm"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-caption font-semibold text-primary">
                {i + 1}
              </span>
              <span dir={locale === 'ar' ? 'rtl' : undefined}>
                {resolveLocalized(step, locale)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border bg-muted/10 px-3 py-2.5 text-sm text-muted-foreground">
          {t.wizardPrereqNone}
        </p>
      )}

      {Object.keys(callbacks).length > 0 ? (
        <div className="space-y-2">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold">{t.wizardCallbacksTitle}</h3>
            <p className="text-xs text-muted-foreground">{t.wizardCallbacksHint}</p>
          </div>
          <div className="space-y-2">
            {Object.entries(callbacks).map(([label, url]) => (
              <CallbackRow key={label} label={label} url={url} t={t} />
            ))}
          </div>
        </div>
      ) : null}

      {hasSteps ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={ack} onCheckedChange={(c) => onAck(c === true)} />
          <span>{t.wizardPrereqAck}</span>
        </label>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onChangeKind}>
          {t.wizardChangeKind}
        </Button>
        <Button type="button" onClick={onNext} disabled={hasSteps && !ack}>
          {t.wizardNext}
          <ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function CallbackRow({ label, url, t }: { label: string; url: string; t: Labels }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable; the field is selectable as a fallback */
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/10 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-xs" dir="ltr" title={url}>
          {url}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={copy}
      >
        {copied ? (
          <>
            <Check className="me-1 h-3.5 w-3.5" aria-hidden />
            {t.wizardCopied}
          </>
        ) : (
          <>
            <Copy className="me-1 h-3.5 w-3.5" aria-hidden />
            {t.wizardCopy}
          </>
        )}
      </Button>
    </div>
  );
}

/* --------------------------------------------------------------------------- *
 * Step 3 — Inline diagnostic checklist (testConnection → steps[]).
 * Minimal local checklist since the detail unit's component is not available.
 * --------------------------------------------------------------------------- */

interface TestStepProps {
  endpoint: IntegrationEndpoint;
  onNext: () => void;
  onBack: () => void;
  t: Labels;
}

function TestStep({ endpoint, onNext, onBack, t }: TestStepProps) {
  const [result, setResult] = useState<TestResult | null>(null);

  const test = useMutation({
    mutationFn: () => testConnection(endpoint.id),
    onSuccess: (res) => {
      setResult(res);
      showSuccess(t.toastTestDone);
    },
    onError: (e) => showBackendError(e, t.toastError),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t.wizardTestIntro}</p>

      <Button
        type="button"
        variant="outline"
        onClick={() => test.mutate()}
        disabled={test.isPending}
      >
        {test.isPending ? (
          <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <ShieldCheck className="me-1.5 h-4 w-4" aria-hidden />
        )}
        {test.isPending ? t.diagRunning : result ? t.diagRerun : t.diagRun}
      </Button>

      {test.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {t.testUnsupported}
        </div>
      ) : result ? (
        <DiagnosticChecklist result={result} t={t} />
      ) : null}

      <p className="text-xs text-muted-foreground">{t.wizardTestSkipNote}</p>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          {t.wizardBack}
        </Button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onNext}>
            {t.wizardSkip}
          </Button>
          <Button type="button" onClick={onNext}>
            {t.wizardNext}
            <ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Inline diagnostic checklist rendering TestResult.steps[] (or a summary). */
function DiagnosticChecklist({ result, t }: { result: TestResult; t: Labels }) {
  const { locale } = useLocaleOrDefault();
  const steps = result.steps ?? [];

  return (
    <div
      className={cn(
        'space-y-3 rounded-lg border px-3 py-3 text-sm',
        result.reachable ? 'border-primary/30 bg-primary/5' : 'border-destructive/40 bg-destructive/5',
      )}
    >
      <div className="flex items-center gap-1.5 font-medium">
        {result.reachable ? (
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" aria-hidden />
        )}
        {result.reachable ? t.diagReachable : t.diagUnreachable}
        <span className="ms-auto text-xs font-normal text-muted-foreground">
          {fillToken(t.testLatency, 'ms', result.latency_millis)}
        </span>
      </div>

      {steps.length > 0 ? (
        <ul className="space-y-1.5">
          {steps.map((step) => (
            <li key={step.key} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <StepDot status={step.status} />
                <span className="text-sm" dir={locale === 'ar' ? 'rtl' : undefined}>
                  {resolveLocalized(step.label, locale) || step.key}
                </span>
                <span className="ms-auto text-caption font-medium text-muted-foreground">
                  {statusLabel(step.status, t)}
                  {typeof step.latency_ms === 'number'
                    ? ` · ${fillToken(t.testLatency, 'ms', step.latency_ms)}`
                    : ''}
                </span>
              </div>
              {step.detail ? (
                <p className="ps-6 text-xs text-muted-foreground">{step.detail}</p>
              ) : null}
              {step.hint && (step.status === 'warn' || step.status === 'fail') ? (
                <p className="ps-6 text-xs text-warning-700 dark:text-warning-300">
                  {t.diagHint}: {resolveLocalized(step.hint, locale)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {result.detail || t.diagNoSteps}
        </p>
      )}
    </div>
  );
}

function StepDot({ status }: { status: DiagnosticStatus }) {
  const cls: Record<DiagnosticStatus, string> = {
    ok: 'text-primary',
    warn: 'text-warning-700 dark:text-warning-300',
    fail: 'text-destructive',
    skip: 'text-muted-foreground',
  };
  if (status === 'ok') return <CheckCircle2 className={cn('h-4 w-4', cls.ok)} aria-hidden />;
  if (status === 'fail') return <XCircle className={cn('h-4 w-4', cls.fail)} aria-hidden />;
  if (status === 'skip') return <Circle className={cn('h-4 w-4', cls.skip)} aria-hidden />;
  return <Circle className={cn('h-4 w-4 fill-current', cls.warn)} aria-hidden />;
}

function statusLabel(status: DiagnosticStatus, t: Labels): string {
  switch (status) {
    case 'ok':
      return t.diagStatusOk;
    case 'warn':
      return t.diagStatusWarn;
    case 'fail':
      return t.diagStatusFail;
    case 'skip':
      return t.diagStatusSkip;
  }
}

/* --------------------------------------------------------------------------- *
 * Step 4 — Enable.
 * --------------------------------------------------------------------------- */

interface EnableStepProps {
  endpoint: IntegrationEndpoint;
  readOnly: boolean;
  onEnabled: (updated: IntegrationEndpoint) => void;
  onNext: () => void;
  onBack: () => void;
  t: Labels;
}

function EnableStep({ endpoint, readOnly, onEnabled, onNext, onBack, t }: EnableStepProps) {
  const qc = useQueryClient();
  const active = endpoint.status === 'active';

  const enable = useMutation({
    mutationFn: () => updateIntegration(endpoint.id, { status: 'active' }),
    onSuccess: async (updated) => {
      onEnabled(updated);
      showSuccess(t.toastEnabled);
      await qc.invalidateQueries({ queryKey: ['lex-integrations'] });
      await qc.invalidateQueries({ queryKey: ['lex-integration', endpoint.id] });
    },
    onError: (e) => showBackendError(e, t.toastError),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t.wizardEnableIntro}</p>

      {active ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm text-primary">
          <PlugZap className="h-4 w-4" aria-hidden />
          {t.wizardEnabledNotice}
        </div>
      ) : (
        <Button type="button" onClick={() => enable.mutate()} disabled={readOnly || enable.isPending}>
          {enable.isPending ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <PlugZap className="me-1.5 h-4 w-4" aria-hidden />
          )}
          {enable.isPending ? t.enabling : t.wizardEnableAction}
        </Button>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          {t.wizardBack}
        </Button>
        <div className="flex items-center gap-2">
          {!active ? (
            <Button type="button" variant="ghost" onClick={onNext}>
              {t.wizardSkip}
            </Button>
          ) : null}
          <Button type="button" onClick={onNext}>
            {t.wizardNext}
            <ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- *
 * Step 5 — First sync + finish.
 * --------------------------------------------------------------------------- */

interface SyncStepProps {
  endpoint: IntegrationEndpoint;
  readOnly: boolean;
  onFinish: () => void;
  onBack: () => void;
  t: Labels;
}

function SyncStep({ endpoint, readOnly, onFinish, onBack, t }: SyncStepProps) {
  const qc = useQueryClient();
  const syncable = isSyncCapableKind(endpoint.kind);
  const active = endpoint.status === 'active';

  const sync = useMutation({
    mutationFn: (mode: SyncMode) => syncNow(endpoint.id, mode),
    onSuccess: async (result) => {
      // Mass-change guard (#20): a runaway-deactivation first sync is blocked; the
      // wizard just warns (the force/confirm flow lives on the detail logs page).
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
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-primary">{t.wizardDoneTitle}</p>
          <p className="text-xs text-muted-foreground">
            {active ? t.wizardDoneBody : t.wizardStillPlannedNotice}
          </p>
        </div>
      </div>

      {syncable ? (
        <>
          <p className="text-sm text-muted-foreground">{t.wizardSyncIntro}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => sync.mutate('delta')}
              disabled={readOnly || !active || sync.isPending}
            >
              {sync.isPending ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <PlayCircle className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {t.wizardSyncRunDelta}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => sync.mutate('full')}
              disabled={readOnly || !active || sync.isPending}
            >
              <PlayCircle className="me-1.5 h-4 w-4" aria-hidden />
              {t.wizardSyncRunFull}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t.wizardSyncSkipNote}</p>
        </>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onBack}>
          {t.wizardBack}
        </Button>
        <Button type="button" onClick={onFinish}>
          <Check className="me-1.5 h-4 w-4" aria-hidden />
          {t.wizardGoToDetail}
        </Button>
      </div>
    </div>
  );
}

export default SetupWizard;
export { LIST_ROUTE };
