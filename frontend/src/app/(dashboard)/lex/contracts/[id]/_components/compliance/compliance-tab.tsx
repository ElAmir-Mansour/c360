'use client';

/**
 * CAP-109 — Regulatory compliance check tab.
 *
 * Renders the contract's matched compliance violations (the latest analysis'
 * compliance flags joined, server-side, to the tenant's compliance rules:
 * rule text, severity, remediation, source clause) as a per-issue list with a
 * resolve / re-open toggle, above an open/resolved KPI strip.
 *
 * Reuse: `lex/kpi-strip` (the canonical Lex KPI header), `shared/severity-
 * indicator` (the severity ramp), `shared/confirm-dialog` (resolve confirmation).
 * Bilingual (EN/AR) + RTL-safe via `useLexFormat`.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ListChecks, ShieldCheck } from 'lucide-react';

import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import {
  SeverityIndicator,
  type Severity,
} from '@/components/shared/severity-indicator';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import { showError, showSuccess } from '@/lib/toast';

import {
  useComplianceCheck,
  useRecordComplianceReview,
  type ComplianceItem,
  type ComplianceSeverity,
} from './use-compliance';

interface ComplianceTabProps {
  contractId: string;
  canWrite: boolean;
}

/* EN/AR label bundle — each Lex domain owns its own bundle per the i18n contract. */
const LABELS = {
  en: {
    title: 'Regulatory compliance check',
    subtitle:
      'Matched regulatory issues from the latest contract analysis, joined to your compliance rules.',
    kpiTotal: 'Issues',
    kpiOpen: 'Open',
    kpiResolved: 'Resolved',
    sourceClause: 'Source clause',
    rule: 'Rule',
    remediation: 'Remediation',
    resolve: 'Mark resolved',
    reopen: 'Re-open',
    resolvedBadge: 'Resolved',
    openBadge: 'Open',
    emptyClean: 'No regulatory compliance issues found.',
    emptyCleanSub:
      'The latest analysis surfaced no compliance flags for this contract.',
    noAnalysis: 'Run a contract analysis to check regulatory compliance.',
    noAnalysisSub:
      'Compliance issues are derived from the contract analysis. Analyze the contract to populate this check.',
    confirmTitle: 'Mark issue resolved?',
    confirmBody:
      'This records the regulatory issue as resolved for this contract. You can re-open it later.',
    confirm: 'Resolve',
    cancel: 'Cancel',
    resolvedToast: 'Compliance issue resolved',
    reopenedToast: 'Compliance issue re-opened',
    errorToast: 'Could not update the compliance issue',
  },
  ar: {
    title: 'فحص الامتثال التنظيمي',
    subtitle:
      'القضايا التنظيمية المطابقة من أحدث تحليل للعقد، مرتبطة بقواعد الامتثال لديك.',
    kpiTotal: 'القضايا',
    kpiOpen: 'مفتوحة',
    kpiResolved: 'محلولة',
    sourceClause: 'البند المصدر',
    rule: 'القاعدة',
    remediation: 'المعالجة',
    resolve: 'وضع علامة كمحلول',
    reopen: 'إعادة الفتح',
    resolvedBadge: 'محلولة',
    openBadge: 'مفتوحة',
    emptyClean: 'لم يتم العثور على قضايا امتثال تنظيمي.',
    emptyCleanSub: 'لم يُظهر أحدث تحليل أي علامات امتثال لهذا العقد.',
    noAnalysis: 'قم بتشغيل تحليل العقد للتحقق من الامتثال التنظيمي.',
    noAnalysisSub:
      'تُشتق قضايا الامتثال من تحليل العقد. قم بتحليل العقد لتعبئة هذا الفحص.',
    confirmTitle: 'وضع علامة على القضية كمحلولة؟',
    confirmBody:
      'يسجل هذا القضية التنظيمية كمحلولة لهذا العقد. يمكنك إعادة فتحها لاحقًا.',
    confirm: 'حل',
    cancel: 'إلغاء',
    resolvedToast: 'تم حل قضية الامتثال',
    reopenedToast: 'تمت إعادة فتح قضية الامتثال',
    errorToast: 'تعذر تحديث قضية الامتثال',
  },
} as const;

/** Map a backend compliance severity onto the shared SeverityIndicator ramp. */
function toSeverity(sev: ComplianceSeverity): Severity {
  switch (sev) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'info';
  }
}

export function ComplianceTab({ contractId, canWrite }: ComplianceTabProps) {
  const f = useLexFormat();
  const t = LABELS[f.locale === 'ar' ? 'ar' : 'en'];

  const { check, isLoading, isError } = useComplianceCheck(contractId);
  const recordReview = useRecordComplianceReview(contractId);

  const [confirmFlag, setConfirmFlag] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'open' | 'resolved'>('all');

  const kpis: LexKpiItem[] = useMemo(
    () => [
      {
        id: 'total',
        label: t.kpiTotal,
        value: check.total,
        theme: 'primary',
        icon: ListChecks,
        onAction: () => setScope('all'),
        pressed: scope === 'all',
      },
      {
        id: 'open',
        label: t.kpiOpen,
        value: check.open,
        theme: check.open > 0 ? 'red' : 'green',
        icon: AlertTriangle,
        onAction: () => setScope('open'),
        pressed: scope === 'open',
      },
      {
        id: 'resolved',
        label: t.kpiResolved,
        value: check.resolved,
        theme: 'emerald',
        icon: CheckCircle2,
        onAction: () => setScope('resolved'),
        pressed: scope === 'resolved',
      },
    ],
    [check.total, check.open, check.resolved, scope, t],
  );
  const visibleItems =
    scope === 'all' ? check.items : check.items.filter((item) => item.status === scope);

  const runResolve = async (item: ComplianceItem, nextStatus: 'open' | 'resolved') => {
    try {
      await recordReview.mutateAsync({ flag_ref: item.flag_ref, status: nextStatus });
      showSuccess(nextStatus === 'resolved' ? t.resolvedToast : t.reopenedToast);
    } catch {
      showError(t.errorToast);
    }
  };

  return (
    <div className="space-y-4" dir={f.direction}>
      <div>
        <h3 className="text-base font-semibold">{t.title}</h3>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      <LexKpiStrip items={kpis} columns={3} />

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <EmptyPanel
          icon={AlertTriangle}
          title={t.errorToast}
          subtitle={t.subtitle}
          tone="danger"
        />
      ) : !check.has_analysis ? (
        <EmptyPanel icon={ShieldCheck} title={t.noAnalysis} subtitle={t.noAnalysisSub} />
      ) : visibleItems.length === 0 ? (
        <EmptyPanel icon={ShieldCheck} title={t.emptyClean} subtitle={t.emptyCleanSub} tone="good" />
      ) : (
        <ul className="space-y-3">
          {visibleItems.map((item) => {
            const resolved = item.status === 'resolved';
            return (
              <li key={item.flag_ref}>
                <Card
                  className={cn(
                    'p-4 transition-colors',
                    resolved && 'border-success-500/30 bg-success-500/[0.04]',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityIndicator severity={toSeverity(item.severity)} size="sm" />
                        <span className="text-sm font-semibold">{item.title}</span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            resolved
                              ? 'bg-success-500/12 text-success-700 dark:text-success-300'
                              : 'bg-warning-500/12 text-warning-700 dark:text-warning-300',
                          )}
                        >
                          {resolved ? t.resolvedBadge : t.openBadge}
                        </span>
                      </div>
                      {item.description ? (
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      ) : null}
                      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 pt-1 text-xs sm:grid-cols-2">
                        {item.rule ? (
                          <MetaRow label={t.rule} value={item.rule} />
                        ) : null}
                        {item.clause_reference ? (
                          <MetaRow label={t.sourceClause} value={item.clause_reference} />
                        ) : null}
                        {item.remediation ? (
                          <MetaRow label={t.remediation} value={item.remediation} wide />
                        ) : null}
                      </dl>
                    </div>
                    {canWrite ? (
                      <Button
                        size="sm"
                        variant={resolved ? 'outline' : 'default'}
                        disabled={recordReview.isPending}
                        onClick={() =>
                          resolved
                            ? runResolve(item, 'open')
                            : setConfirmFlag(item.flag_ref)
                        }
                      >
                        {resolved ? t.reopen : t.resolve}
                      </Button>
                    ) : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirmFlag !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmFlag(null);
        }}
        title={t.confirmTitle}
        description={t.confirmBody}
        confirmLabel={t.confirm}
        cancelLabel={t.cancel}
        loading={recordReview.isPending}
        onConfirm={async () => {
          const target = check.items.find((i) => i.flag_ref === confirmFlag);
          if (target) {
            await runResolve(target, 'resolved');
          }
          setConfirmFlag(null);
        }}
      />
    </div>
  );
}

function MetaRow({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn('flex gap-1.5', wide && 'sm:col-span-2')}>
      <dt className="shrink-0 font-medium text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 text-foreground">{value}</dd>
    </div>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  subtitle,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  tone?: 'neutral' | 'good' | 'danger';
}) {
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center">
      <div
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full',
          tone === 'good' && 'bg-success-500/10 text-success-600',
          tone === 'danger' && 'bg-destructive/10 text-destructive',
          tone === 'neutral' && 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{subtitle}</p>
    </Card>
  );
}
