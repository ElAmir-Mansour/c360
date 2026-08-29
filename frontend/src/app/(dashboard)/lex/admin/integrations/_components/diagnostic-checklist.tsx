'use client';

/**
 * DiagnosticChecklist (Feature 2).
 *
 * Replaces the single boolean "Test result" in the ConnectionPanel with a
 * layered, per-step checklist driven by {@link TestResult.steps} — the
 * reachable → authenticated → authorized → sample_fetch progression the backend
 * now emits. Each step shows a colored status dot, its bilingual label, the
 * measured latency, and — on warn/fail — the remediation hint inline.
 *
 * RBAC: running the test is a MANAGE action; `canManage === false` hides the
 * trigger and shows a read-only note. The mutation surfaces errors via toast;
 * an unsupported connector (422) renders an explanatory state, distinct from an
 * unreachable probe.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Lightbulb,
  Loader2,
  MinusCircle,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showSuccess, showBackendError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  testConnection,
  type DiagnosticStatus,
  type TestResult,
} from '@/lib/lex/integrations';
import {
  useDetailOpsLabels,
  fillOpsToken,
  type DetailOpsLabels,
} from '../_lib/detail-ops-labels';

interface DiagnosticChecklistProps {
  endpointId: string;
  canManage: boolean;
  /** Bubble a fresh test up so the panel can refresh the health probe. */
  onTested?: (result: TestResult) => void;
}

const STATUS_ICON: Record<DiagnosticStatus, LucideIcon> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  skip: MinusCircle,
};

const STATUS_DOT: Record<DiagnosticStatus, string> = {
  ok: 'text-primary',
  warn: 'text-warning-700 dark:text-warning-300',
  fail: 'text-destructive',
  skip: 'text-muted-foreground',
};

function statusLabel(status: DiagnosticStatus, t: DetailOpsLabels): string {
  switch (status) {
    case 'ok':
      return t.diagnosticStepOk;
    case 'warn':
      return t.diagnosticStepWarn;
    case 'fail':
      return t.diagnosticStepFail;
    case 'skip':
      return t.diagnosticStepSkip;
  }
}

export function DiagnosticChecklist({
  endpointId,
  canManage,
  onTested,
}: DiagnosticChecklistProps) {
  const t = useDetailOpsLabels();
  const { locale, direction } = useLocaleOrDefault();
  const [result, setResult] = useState<TestResult | null>(null);

  const test = useMutation({
    mutationFn: () => testConnection(endpointId),
    onSuccess: (res) => {
      setResult(res);
      showSuccess(t.diagnosticsTitle);
      onTested?.(res);
    },
    onError: (e) => showBackendError(e, t.opsError),
  });

  function runDiagnostics() {
    test.mutate();
  }

  const steps = result?.steps ?? [];

  return (
    <div className="space-y-3" dir={direction} lang={locale}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t.diagnosticsSubtitle}</p>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runDiagnostics}
            disabled={test.isPending}
          >
            {test.isPending ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <ShieldCheck className="me-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            {test.isPending
              ? t.diagnosticsRunning
              : result
                ? t.diagnosticsRerun
                : t.diagnosticsRun}
          </Button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {t.manageOnlyNote}
        </p>
      ) : null}

      {/* Unsupported connector (e.g. 422). */}
      {test.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {t.diagnosticsUnsupported}
        </div>
      ) : null}

      {/* Not run yet. */}
      {!result && !test.isError && !test.isPending ? (
        <p className="rounded-lg border border-dashed bg-muted/10 px-3 py-3 text-center text-xs text-muted-foreground">
          {t.diagnosticsEmpty}
        </p>
      ) : null}

      {/* Overall verdict. */}
      {result ? (
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium',
            result.reachable
              ? 'border-primary/30 bg-primary/5 text-primary'
              : 'border-destructive/40 bg-destructive/5 text-destructive',
          )}
        >
          {result.reachable ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          ) : (
            <XCircle className="h-4 w-4" aria-hidden />
          )}
          <span>{result.reachable ? t.diagnosticsReachable : t.diagnosticsUnreachable}</span>
          <span className="ms-auto inline-flex items-center gap-1 font-normal text-muted-foreground">
            <Gauge className="h-3 w-3" aria-hidden />
            {fillOpsToken(t.diagnosticLatency, 'ms', result.latency_millis)}
          </span>
        </div>
      ) : null}

      {/* Per-step checklist. */}
      {result && steps.length > 0 ? (
        <ol className="space-y-1.5">
          {steps.map((step) => {
            const Icon = STATUS_ICON[step.status];
            const hint = step.hint ? resolveLocalized(step.hint, locale) : '';
            return (
              <li
                key={step.key}
                className="rounded-lg border bg-card/60 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className={cn('h-4 w-4 shrink-0', STATUS_DOT[step.status])}
                    aria-hidden
                  />
                  <span className="font-medium text-foreground">
                    {resolveLocalized(step.label, locale)}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {statusLabel(step.status, t)}
                  </span>
                  {typeof step.latency_ms === 'number' ? (
                    <span className="ms-auto inline-flex items-center gap-1 text-caption tabular-nums text-muted-foreground">
                      <Gauge className="h-3 w-3" aria-hidden />
                      {fillOpsToken(t.diagnosticLatency, 'ms', step.latency_ms)}
                    </span>
                  ) : null}
                </div>
                {step.detail ? (
                  <p className="mt-1 ps-6 text-muted-foreground">{step.detail}</p>
                ) : null}
                {hint && (step.status === 'warn' || step.status === 'fail') ? (
                  <p className="mt-1 inline-flex items-start gap-1.5 ps-6 text-warning-700 dark:text-warning-300">
                    <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span>
                      <span className="font-medium">{t.diagnosticHintLabel}: </span>
                      {hint}
                    </span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {/* Ran but no per-step breakdown (older connector). */}
      {result && steps.length === 0 ? (
        <p className="rounded-lg border bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
          {result.detail || t.diagnosticsNoSteps}
        </p>
      ) : null}
    </div>
  );
}
