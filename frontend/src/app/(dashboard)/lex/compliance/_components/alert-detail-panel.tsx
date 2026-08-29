/**
 * FEATURE 1 — Alert detail slide-over for the Watheeq (Lex) compliance surface.
 *
 * <AlertDetailPanel> renders the FULL context of a single `LexComplianceAlert`
 * inside the shared `DetailPanel` sheet: header (title + severity + status),
 * linked contract / rule references, a pretty-rendered `evidence` object, a
 * resolution timeline, and (when `canWrite`) a compact inline "update status"
 * form that reuses the EXACT mutation shape of the page's `AlertStatusDialog`.
 *
 * Self-contained: it owns its bilingual (English + MSA) labels following the
 * canonical lex i18n contract (`../../_lib/lex-i18n.ts` /
 * `_lib/compliance-labels.ts`). It does NOT import from `page.tsx`.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileText,
  Loader2,
  Scale,
} from 'lucide-react';
import { DetailPanel } from '@/components/shared/detail-panel';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import { Timeline } from '@/components/shared/timeline';
import { formatDualRaw, formatRelativeAt } from '@/lib/lex/ksa';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { AppLocale } from '@/lib/i18n';
import type {
  JsonObject,
  JsonValue,
  LexComplianceAlert,
  LexComplianceAlertStatus,
} from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

// ---------------------------------------------------------------------------
// Bilingual labels (self-contained — see `_lib/compliance-labels.ts` for the
// canonical pattern; the `en` side reads naturally, `ar` uses the suite
// glossary: الامتثال / لائحة / عقد / تنبيه / الحوكمة).
// ---------------------------------------------------------------------------

const ALERT_STATUSES = [
  'open',
  'acknowledged',
  'investigating',
  'resolved',
  'dismissed',
] as const satisfies readonly LexComplianceAlertStatus[];

export interface AlertDetailLabels {
  title: string;
  description: string;
  loading: string;
  sections: {
    overview: string;
    links: string;
    evidence: string;
    timeline: string;
    updateStatus: string;
  };
  links: {
    contract: string;
    contractAction: string;
    rule: string;
    rulePrefix: string;
    none: string;
  };
  evidence: {
    empty: string;
    showRaw: string;
    hideRaw: string;
    emptyValue: string;
    trueValue: string;
    falseValue: string;
  };
  timeline: {
    created: string;
    statusNow: (status: string) => string;
    resolved: string;
    resolvedBy: (actor: string) => string;
    notesLabel: string;
  };
  form: {
    newStatus: string;
    resolutionNotes: string;
    resolutionNotesPlaceholder: string;
    save: string;
    saving: string;
  };
  toasts: {
    updatedTitle: string;
    updatedDescription: string;
  };
  statuses: Record<string, string>;
}

const alertDetailLabels: LexBilingual<AlertDetailLabels> = {
  en: {
    title: 'Alert Detail',
    description: 'Full compliance alert context, evidence, and resolution history.',
    loading: 'Loading the latest alert record…',
    sections: {
      overview: 'Overview',
      links: 'Linked records',
      evidence: 'Evidence',
      timeline: 'Resolution timeline',
      updateStatus: 'Update status',
    },
    links: {
      contract: 'Contract',
      contractAction: 'Open contract',
      rule: 'Compliance rule',
      rulePrefix: 'Rule reference',
      none: 'No linked records.',
    },
    evidence: {
      empty: 'No evidence was captured for this alert.',
      showRaw: 'Show raw value',
      hideRaw: 'Hide raw value',
      emptyValue: '—',
      trueValue: 'Yes',
      falseValue: 'No',
    },
    timeline: {
      created: 'Alert created',
      statusNow: (status) => `Current status: ${status}`,
      resolved: 'Alert resolved',
      resolvedBy: (actor) => `Resolved by ${actor}`,
      notesLabel: 'Resolution notes',
    },
    form: {
      newStatus: 'New status',
      resolutionNotes: 'Resolution notes',
      resolutionNotesPlaceholder: 'Optional resolution or investigation notes.',
      save: 'Save status',
      saving: 'Saving…',
    },
    toasts: {
      updatedTitle: 'Alert updated.',
      updatedDescription: 'The compliance alert status has been saved.',
    },
    statuses: {
      open: 'open',
      acknowledged: 'acknowledged',
      investigating: 'investigating',
      resolved: 'resolved',
      dismissed: 'dismissed',
    },
  },
  ar: {
    title: 'تفاصيل التنبيه',
    description: 'سياق تنبيه الامتثال الكامل والأدلة وسجل الحل.',
    loading: 'جارٍ تحميل أحدث سجل للتنبيه…',
    sections: {
      overview: 'نظرة عامة',
      links: 'السجلات المرتبطة',
      evidence: 'الأدلة',
      timeline: 'الجدول الزمني للحل',
      updateStatus: 'تحديث الحالة',
    },
    links: {
      contract: 'العقد',
      contractAction: 'فتح العقد',
      rule: 'قاعدة الامتثال',
      rulePrefix: 'مرجع القاعدة',
      none: 'لا توجد سجلات مرتبطة.',
    },
    evidence: {
      empty: 'لم تُسجَّل أي أدلة لهذا التنبيه.',
      showRaw: 'عرض القيمة الأصلية',
      hideRaw: 'إخفاء القيمة الأصلية',
      emptyValue: '—',
      trueValue: 'نعم',
      falseValue: 'لا',
    },
    timeline: {
      created: 'تم إنشاء التنبيه',
      statusNow: (status) => `الحالة الحالية: ${status}`,
      resolved: 'تم حل التنبيه',
      resolvedBy: (actor) => `حُلَّ بواسطة ${actor}`,
      notesLabel: 'ملاحظات الحل',
    },
    form: {
      newStatus: 'الحالة الجديدة',
      resolutionNotes: 'ملاحظات الحل',
      resolutionNotesPlaceholder: 'ملاحظات حلّ أو تحقيق اختيارية.',
      save: 'حفظ الحالة',
      saving: 'جارٍ الحفظ…',
    },
    toasts: {
      updatedTitle: 'تم تحديث التنبيه.',
      updatedDescription: 'تم حفظ حالة تنبيه الامتثال.',
    },
    statuses: {
      open: 'مفتوح',
      acknowledged: 'مُقَر به',
      investigating: 'قيد التحقيق',
      resolved: 'محلول',
      dismissed: 'مرفوض',
    },
  },
};

export function useAlertDetailLabels(): AlertDetailLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(alertDetailLabels, locale), [locale]);
}

/** Pure resolver for non-React callers / tests. */
export function resolveAlertDetailLabels(locale: AppLocale = 'en'): AlertDetailLabels {
  return resolveLexBilingual(alertDetailLabels, locale === 'ar' ? 'ar' : 'en');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise the backend severity token to the SeverityIndicator's union. */
function normalizeSeverity(value: string): Severity {
  switch (value) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
      return value;
    default:
      return 'info';
  }
}

/** Humanise an evidence object key, e.g. `days_until_expiry` → `Days until expiry`. */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isPlainObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Format a JSON primitive for display. Returns null for non-primitives. */
function formatPrimitive(value: JsonValue, labels: AlertDetailLabels): string | null {
  if (value === null || value === undefined) return labels.evidence.emptyValue;
  if (typeof value === 'boolean') return value ? labels.evidence.trueValue : labels.evidence.falseValue;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.length > 0 ? value : labels.evidence.emptyValue;
  return null;
}

/**
 * Recursively render a single evidence value. Primitives become text; plain
 * objects and arrays render as indented sub-lists. Anything nested deeper than
 * `maxDepth` collapses to a raw `<pre>` fallback (toggled by the parent).
 */
function EvidenceValue({
  value,
  labels,
  depth,
  maxDepth = 2,
}: {
  value: JsonValue;
  labels: AlertDetailLabels;
  depth: number;
  maxDepth?: number;
}) {
  const primitive = formatPrimitive(value, labels);
  if (primitive !== null) {
    return <span className="break-words text-sm text-foreground/90">{primitive}</span>;
  }

  // Too deep — fall back to a collapsible raw block.
  if (depth >= maxDepth) {
    return <RawValue value={value} labels={labels} />;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-sm text-muted-foreground">{labels.evidence.emptyValue}</span>;
    }
    return (
      <ul className="mt-1 space-y-1 border-s border-border/70 ps-3">
        {value.map((item, idx) => (
          <li key={idx} className="text-sm">
            <EvidenceValue value={item} labels={labels} depth={depth + 1} maxDepth={maxDepth} />
          </li>
        ))}
      </ul>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className="text-sm text-muted-foreground">{labels.evidence.emptyValue}</span>;
    }
    return (
      <ul className="mt-1 space-y-1 border-s border-border/70 ps-3">
        {entries.map(([k, v]) => (
          <li key={k} className="text-sm">
            <span className="font-medium text-muted-foreground">{humanizeKey(k)}: </span>
            <EvidenceValue value={v} labels={labels} depth={depth + 1} maxDepth={maxDepth} />
          </li>
        ))}
      </ul>
    );
  }

  return <RawValue value={value} labels={labels} />;
}

/** Collapsible raw-JSON fallback for deeply nested / unrenderable values. */
function RawValue({ value, labels }: { value: JsonValue; labels: AlertDetailLabels }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        {open ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3 rtl:-scale-x-100" aria-hidden />}
        {open ? labels.evidence.hideRaw : labels.evidence.showRaw}
      </button>
      {open ? (
        <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-border/70 bg-muted/40 p-2 text-start text-xs">
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function EvidenceList({ evidence, labels }: { evidence: JsonObject; labels: AlertDetailLabels }) {
  const entries = Object.entries(evidence);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{labels.evidence.empty}</p>;
  }
  return (
    <dl className="space-y-2.5">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-lg border border-border/70 bg-card/60 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {humanizeKey(key)}
          </dt>
          <dd className="mt-0.5">
            <EvidenceValue value={value} labels={labels} depth={0} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface AlertDetailPanelProps {
  /** Controls the slide-over open state. */
  open: boolean;
  /** The alert to display. The panel re-fetches the full record by `id`. */
  alert: LexComplianceAlert | null;
  /** Standard sheet open/close callback. */
  onOpenChange: (open: boolean) => void;
  /** When true, renders the inline status-update form (or the escape hatch). */
  canWrite?: boolean;
  /** Optional override for the bilingual labels (defaults to the locale hook). */
  labels?: AlertDetailLabels;
  /**
   * Optional escape hatch. When provided AND `canWrite`, the panel renders a
   * single button that calls this instead of the embedded form — useful if the
   * integrator prefers to reuse the page's existing `AlertStatusDialog`. When
   * omitted, the panel embeds its own compact status form.
   */
  onRequestStatusEdit?: (alert: LexComplianceAlert) => void;
}

export function AlertDetailPanel({
  open,
  alert,
  onOpenChange,
  canWrite = false,
  labels: labelsProp,
  onRequestStatusEdit,
}: AlertDetailPanelProps) {
  const hookLabels = useAlertDetailLabels();
  const labels = labelsProp ?? hookLabels;
  const { locale } = useLocaleOrDefault();
  const queryClient = useQueryClient();

  const alertId = alert?.id;

  // Fetch the full record when open; fall back to the passed-in alert while
  // loading / before the network resolves.
  const detailQuery = useQuery({
    queryKey: ['lex-compliance-alert', alertId],
    queryFn: () => enterpriseApi.lex.getComplianceAlert(alertId as string),
    enabled: open && Boolean(alertId),
  });

  const current: LexComplianceAlert | null = detailQuery.data ?? alert;

  // Inline status form state — reset whenever the active alert changes.
  const [nextStatus, setNextStatus] = useState<string>(alert?.status ?? 'open');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setNextStatus(current?.status ?? 'open');
    setNotes('');
  }, [current?.id, current?.status]);

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!current) throw new Error('no alert selected');
      return enterpriseApi.lex.updateComplianceAlertStatus(current.id, {
        status: nextStatus,
        resolution_notes: notes.trim() || '',
      });
    },
    onSuccess: async () => {
      showSuccess(labels.toasts.updatedTitle, labels.toasts.updatedDescription);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-command'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-alert', alertId] }),
      ]);
    },
    onError: showApiError,
  });

  const statusLabel = (status: string): string =>
    labels.statuses[status] ?? status.replace(/_/g, ' ');

  // Build the resolution timeline: created → current status → resolved.
  const timelineItems = useMemo(() => {
    if (!current) return [];
    const items: Parameters<typeof Timeline>[0]['items'] = [
      {
        id: 'created',
        icon: CircleDot,
        title: labels.timeline.created,
        timestamp: current.created_at,
        variant: 'default',
      },
      {
        id: 'status',
        icon: current.status === 'resolved' ? CheckCircle2 : AlertCircle,
        title: labels.timeline.statusNow(statusLabel(current.status)),
        timestamp: current.updated_at !== current.created_at ? current.updated_at : undefined,
        variant: current.status === 'resolved' ? 'success' : 'warning',
      },
    ];
    if (current.resolved_at) {
      items.push({
        id: 'resolved',
        icon: CheckCircle2,
        title: labels.timeline.resolved,
        description: current.resolved_by ? labels.timeline.resolvedBy(current.resolved_by) : undefined,
        timestamp: current.resolved_at,
        variant: 'success',
      });
    }
    return items;
    // statusLabel + labels are stable per render; depend on the alert fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, labels]);

  return (
    <DetailPanel
      open={open}
      onOpenChange={onOpenChange}
      title={current?.title ?? labels.title}
      description={labels.description}
      width="xl"
    >
      {!current ? (
        <p className="text-sm text-muted-foreground">{labels.loading}</p>
      ) : (
        <div className="space-y-6">
          {/* Header badges */}
          <div className="flex flex-wrap items-center gap-2">
            <SeverityIndicator severity={normalizeSeverity(current.severity)} size="md" />
            <Badge variant="outline">{statusLabel(current.status)}</Badge>
            {detailQuery.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
          </div>

          {/* Overview / description */}
          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {labels.sections.overview}
            </h3>
            <p className="text-sm leading-relaxed text-foreground/90">{current.description}</p>
            {/* KSA: localized relative time + Hijri-aware full date tooltip. */}
            <p
              className="text-xs text-muted-foreground tabular-nums"
              title={formatDualRaw(current.created_at, locale)}
            >
              {formatRelativeAt(current.created_at, locale, new Date())}
            </p>
          </section>

          {/* Linked records */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {labels.sections.links}
            </h3>
            {current.contract_id || current.rule_id ? (
              <div className="space-y-2">
                {current.contract_id ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/60 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate text-sm">{labels.links.contract}</span>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/lex/contracts/${current.contract_id}`}>
                        <ExternalLink className="me-1.5 h-3.5 w-3.5" aria-hidden />
                        {labels.links.contractAction}
                      </Link>
                    </Button>
                  </div>
                ) : null}
                {current.rule_id ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-3 py-2">
                    <Scale className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="text-sm">
                      <span className="text-muted-foreground">{labels.links.rulePrefix}: </span>
                      <code className="rounded bg-muted/60 px-1 py-0.5 text-xs">{current.rule_id}</code>
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{labels.links.none}</p>
            )}
          </section>

          {/* Evidence */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {labels.sections.evidence}
            </h3>
            <EvidenceList evidence={current.evidence ?? {}} labels={labels} />
          </section>

          {/* Resolution timeline */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {labels.sections.timeline}
            </h3>
            <Timeline items={timelineItems} />
            {current.resolution_notes ? (
              <div className="rounded-lg border border-border/70 bg-card/60 px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">{labels.timeline.notesLabel}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground/90">
                  {current.resolution_notes}
                </p>
              </div>
            ) : null}
          </section>

          {/* Inline status update (or escape hatch) */}
          {canWrite ? (
            <section className="space-y-3 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {labels.sections.updateStatus}
              </h3>
              {onRequestStatusEdit ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRequestStatusEdit(current)}
                  className="w-full sm:w-auto"
                >
                  {labels.sections.updateStatus}
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{labels.form.newStatus}</label>
                    <Select value={nextStatus} onValueChange={setNextStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALERT_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {statusLabel(s)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{labels.form.resolutionNotes}</label>
                    <Textarea
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={labels.form.resolutionNotesPlaceholder}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => updateMutation.mutate()}
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending ? (
                        <>
                          <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                          {labels.form.saving}
                        </>
                      ) : (
                        labels.form.save
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </div>
      )}
    </DetailPanel>
  );
}
