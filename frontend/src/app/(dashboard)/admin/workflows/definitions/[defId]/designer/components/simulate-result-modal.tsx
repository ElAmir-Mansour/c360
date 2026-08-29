'use client';

/**
 * SimulateResultModal — reusable viewer for a workflow definition dry-run
 * (engine WP-6, POST /definitions/{id}/simulate).
 *
 * It renders WHATEVER the engine returns: the executed step sequence, every gate
 * / transition decision that was evaluated, the projected SLA timeline (with
 * escalation tiers), final variables and step outputs. The component is a pure
 * presenter — it takes the SimulationResult (or a loading/error state) as props,
 * so it is trivially reused by the Phase C @xyflow/react canvas (e.g. to drive a
 * simulate overlay) without re-deriving the fetch.
 *
 * Bilingual EN/AR + RTL: copy is selected from inline {ar,en} maps via the active
 * locale (useLocaleOrDefault is non-throwing so the modal also renders inside
 * isolated tests / canvases without a LocaleProvider). The dialog inherits the
 * document direction; numeric / id content stays LTR.
 */

import {
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Pause,
  Clock,
  Loader2,
  PlayCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  formatStepTypeLabel,
  getDefinitionLabels,
} from '../../../definition-i18n';
import type {
  SimulationResult,
  SimulationStatus,
} from '../use-workflow-lifecycle';

type Loc = { ar: string; en: string };
const pick = (l: Loc, locale: string) => (locale === 'ar' ? l.ar : l.en);

const T = {
  title: { ar: 'محاكاة سير العمل', en: 'Workflow Simulation' },
  subtitle: {
    ar: 'تشغيل تجريبي بدون أي آثار جانبية',
    en: 'Side-effect-free dry run',
  },
  running: { ar: 'جارٍ تشغيل المحاكاة…', en: 'Running simulation…' },
  failed: { ar: 'تعذّرت المحاكاة', en: 'Simulation failed' },
  stepsExecuted: { ar: 'الخطوات المنفّذة', en: 'Steps executed' },
  version: { ar: 'الإصدار', en: 'Version' },
  duration: { ar: 'المدة المتوقعة', en: 'Projected duration' },
  path: { ar: 'مسار التنفيذ', en: 'Executed path' },
  decisions: { ar: 'قرارات البوابات', en: 'Gate decisions' },
  sla: { ar: 'مخطط مستوى الخدمة', en: 'SLA projection' },
  variables: { ar: 'المتغيّرات النهائية', en: 'Final variables' },
  noDecisions: { ar: 'لم تُقيَّم أي بوابات.', en: 'No gates evaluated.' },
  noSla: { ar: 'لا توجد مواعيد نهائية متوقعة.', en: 'No projected deadlines.' },
  wouldPause: { ar: 'كان سيتوقّف هنا', en: 'would pause here' },
  due: { ar: 'الاستحقاق', en: 'due' },
  escalation: { ar: 'تصعيد', en: 'escalation' },
};

const STATUS_LABEL: Record<SimulationStatus, Loc> = {
  completed: { ar: 'اكتمل', en: 'Completed' },
  max_steps_exceeded: {
    ar: 'تجاوز الحد الأقصى للخطوات',
    en: 'Max steps exceeded',
  },
  no_transition: { ar: 'لا يوجد انتقال', en: 'No transition' },
  error: { ar: 'خطأ', en: 'Error' },
};

function statusVariant(
  status: SimulationStatus | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'max_steps_exceeded':
    case 'no_transition':
      return 'secondary';
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

export interface SimulateResultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The simulation outcome to render. Undefined while loading or before a run. */
  result?: SimulationResult;
  isLoading?: boolean;
  /** Set when the request failed (non-2xx / transport). */
  error?: unknown;
  /** Optional human label for the definition being simulated. */
  definitionName?: string;
}

export function SimulateResultModal({
  open,
  onOpenChange,
  result,
  isLoading,
  error,
  definitionName,
}: SimulateResultModalProps) {
  const { locale } = useLocaleOrDefault();
  const localLabels = getDefinitionLabels(locale);
  const tr = (l: Loc) => pick(l, locale);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-primary" aria-hidden />
            {tr(T.title)}
            {result && (
              <Badge variant={statusVariant(result.status)} className="ms-1">
                {pick(STATUS_LABEL[result.status] ?? STATUS_LABEL.error, locale)}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {definitionName ? `${definitionName} — ` : ''}
            {tr(T.subtitle)}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {tr(T.running)}
          </div>
        )}

        {!isLoading && error != null && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <XCircle className="h-8 w-8 text-destructive" aria-hidden />
            <p className="text-sm font-medium">{tr(T.failed)}</p>
            <p className="max-w-md text-xs text-muted-foreground">
              {extractErrorMessage(error, localLabels.simulation.unexpectedError)}
            </p>
          </div>
        )}

        {!isLoading && error == null && result && (
          <ScrollArea className="flex-1 -mx-1 px-1">
            <div className="space-y-5 py-1">
              {/* Summary tiles */}
              <div className="grid grid-cols-3 gap-3">
                <SummaryTile
                  label={tr(T.stepsExecuted)}
                  value={String(result.steps_executed)}
                />
                <SummaryTile
                  label={tr(T.version)}
                  value={`v${result.definition_version}`}
                />
                <SummaryTile
                  label={tr(T.duration)}
                  value={formatDuration(
                    result.started_at,
                    result.projected_end_at,
                    locale,
                  )}
                />
              </div>

              {result.message && (
                <div className="flex items-start gap-2 rounded-md border border-warning-300/50 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-700/15 dark:text-warning-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{result.message}</span>
                </div>
              )}

              {/* Executed path */}
              <Section title={tr(T.path)}>
                <ol className="space-y-2">
                  {result.path.map((step) => (
                    <li
                      key={`${step.order}-${step.step_id}`}
                      className="flex items-start gap-3 rounded-md border bg-card px-3 py-2"
                    >
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">
                        {step.order + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {step.step_name || step.step_id}
                          </span>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-overline text-muted-foreground">
                            {formatStepTypeLabel(step.step_type, locale)}
                          </code>
                          {step.would_have_paused && (
                            <span className="inline-flex items-center gap-1 text-overline text-warning-600 dark:text-warning-300">
                              <Pause className="h-3 w-3" aria-hidden />
                              {tr(T.wouldPause)}
                            </span>
                          )}
                        </div>
                        {step.side_effect_note && (
                          <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
                            {step.side_effect_note}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </Section>

              {/* Gate decisions */}
              <Section title={tr(T.decisions)}>
                {result.evaluations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{tr(T.noDecisions)}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {result.evaluations.map((ev, i) => (
                      <li
                        key={`${ev.step_id}-${i}`}
                        className="flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-xs"
                      >
                        {ev.error ? (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                        ) : ev.result ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-500" aria-hidden />
                        ) : (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                        <div className="min-w-0 flex-1" dir="ltr">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{ev.step_id}</span>
                            <span className="text-muted-foreground">[{ev.kind}]</span>
                            {ev.target && (
                              <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                                <ArrowRight className="h-3 w-3" aria-hidden />
                                {ev.target}
                              </span>
                            )}
                          </div>
                          {ev.expression && (
                            <code className="mt-0.5 block break-all rounded bg-muted px-1.5 py-0.5 text-overline text-muted-foreground">
                              {ev.expression}
                            </code>
                          )}
                          {ev.error && (
                            <p className="mt-0.5 text-overline text-destructive">{ev.error}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* SLA projection */}
              <Section title={tr(T.sla)}>
                {result.sla_timeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{tr(T.noSla)}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {result.sla_timeline.map((entry, i) => (
                      <li
                        key={`${entry.step_id}-${i}`}
                        className="rounded-md border bg-card px-3 py-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="font-medium" dir="ltr">{entry.step_id}</span>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-overline text-muted-foreground">
                            {entry.kind}
                          </code>
                          <span className="text-muted-foreground">
                            {tr(T.due)}: {formatSeconds(entry.duration_seconds, locale)}
                          </span>
                        </div>
                        {entry.escalations && entry.escalations.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5 ps-5">
                            {entry.escalations.map((esc, j) => (
                              <li
                                key={j}
                                className="flex items-center gap-1.5 text-overline text-warning-600 dark:text-warning-300"
                              >
                                <AlertTriangle className="h-3 w-3" aria-hidden />
                                {tr(T.escalation)} +{formatSeconds(esc.after_seconds, locale)}
                                {esc.notify ? ` → ${esc.notify}` : ''}
                                {esc.action ? ` (${esc.action})` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* Final variables */}
              {result.final_variables &&
                Object.keys(result.final_variables).length > 0 && (
                  <Section title={tr(T.variables)}>
                    <pre
                      dir="ltr"
                      className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed"
                    >
                      {JSON.stringify(result.final_variables, null, 2)}
                    </pre>
                  </Section>
                )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <p className="text-overline uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function formatDuration(start: string, end: string, locale: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) {
    return locale === 'ar' ? 'فوري' : 'instant';
  }
  return formatSeconds(ms / 1000, locale);
}

function formatSeconds(totalSeconds: number, locale: string): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return locale === 'ar' ? 'فوري' : 'instant';
  }
  const units: Array<[number, string, string]> = [
    [86400, 'd', 'ي'],
    [3600, 'h', 'س'],
    [60, 'm', 'د'],
    [1, 's', 'ث'],
  ];
  const parts: string[] = [];
  let remaining = Math.round(totalSeconds);
  for (const [size, en, ar] of units) {
    if (remaining >= size) {
      const n = Math.floor(remaining / size);
      remaining -= n * size;
      parts.push(`${n}${locale === 'ar' ? ar : en}`);
    }
    if (parts.length >= 2) break;
  }
  return parts.join(' ') || (locale === 'ar' ? 'فوري' : 'instant');
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const maybe = error as { message?: unknown; response?: { data?: { message?: unknown } } };
  const apiMsg = maybe.response?.data?.message;
  if (typeof apiMsg === 'string') return apiMsg;
  if (typeof maybe.message === 'string') return maybe.message;
  return fallback;
}
