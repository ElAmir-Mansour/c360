'use client';

/**
 * recover-labels.ts — feature-local bilingual copy for the ClarioDR Recover
 * surface's first-class empty / onboarding states.
 *
 * Per the console's i18n convention, feature-local user-facing strings live
 * beside the feature (NOT the shared `_lib/dr-i18n.ts`). The copy is held in a
 * `DRBilingual<RecoverStateLabels>` bundle — two full, same-shaped copies of the
 * label object (English + professional MSA Arabic) — and resolved against the
 * active locale by the {@link useRecoverStateLabels} hook. Resolution defaults
 * to English (the `resolveDRBilingual` cross-locale fallback) so the
 * `renderWithQuery` `en` default keeps the existing English assertions green; an
 * Arabic user sees the full MSA surface.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface RecoverStateLabels {
  /** No failover/drill runs exist yet. */
  noRunsTitle: string;
  noRunsDescription: string;
  noRunsAction: string;
  /** No active run is in flight (the detail card). */
  noActiveRunTitle: string;
  noActiveRunDescription: string;
  /** Chrome copy for the FailoverOperations table + four-gate visual. */
  failoverOps: {
    loadError: string;
    fourGateTitle: string;
    fourGateDescription: string;
    noActiveRun: string;
    gateActive: string;
    gateDone: string;
    gateQueued: string;
    gates: { validate: string; approve: string; execute: string; attest: string };
    gateDescriptions: { validate: string; approve: string; execute: string; attest: string };
    activeRunTitle: string;
    activeRunDescription: string;
    colMode: string;
    colStatus: string;
    rtoTarget: string;
    rtoActual: string;
    runLogPreview: string;
    openLiveExecution: string;
    runsTitle: string;
    runsDescription: string;
    runsBadge: (count: number) => string;
    colRun: string;
    colGroup: string;
    colRto: string;
    colStarted: string;
    noRecoveryPointPinned: string;
    rtoTargetPrefix: string;
    unknown: string;
    /** Display labels for run/health status tokens shown in the status badge. */
    statusLabels: Record<string, string>;
  };
}

export const recoverStateLabelBundle: DRBilingual<RecoverStateLabels> = {
  en: {
    noRunsTitle: 'No recovery runs yet',
    noRunsDescription:
      'Declare a failover for a real cutover, or start a non-disruptive drill to rehearse recovery. Every run is gated through Validate, Approve, Execute, and Attest.',
    noRunsAction: 'Declare a failover or start a drill',

    noActiveRunTitle: 'Nothing in flight',
    noActiveRunDescription:
      'When a failover or drill run is declared, its live gate progress and run log appear here.',
    failoverOps: {
      loadError: 'Failed to load failover runs.',
      fourGateTitle: 'Four-gate failover',
      fourGateDescription: 'Validate, approve, execute, and attest. No gate is skippable.',
      noActiveRun: 'No active run',
      gateActive: 'Active',
      gateDone: 'Done',
      gateQueued: 'Queued',
      gates: { validate: 'Validate', approve: 'Approve', execute: 'Execute', attest: 'Attest' },
      gateDescriptions: {
        validate: 'Replication, clean point, RPO',
        approve: 'Human sign-off required',
        execute: 'Boot order and routing',
        attest: 'Immutable evidence emitted',
      },
      activeRunTitle: 'Active run details',
      activeRunDescription: 'Current gated failover or latest completed run.',
      colMode: 'Mode',
      colStatus: 'Status',
      rtoTarget: 'RTO target',
      rtoActual: 'RTO actual',
      runLogPreview: 'Run log preview',
      openLiveExecution: 'Open live execution',
      runsTitle: 'Failover runs',
      runsDescription: 'Live and drill runs through Validate, Approve, Execute, and Attest gates.',
      runsBadge: (count) => `${count} runs`,
      colRun: 'Run',
      colGroup: 'Group',
      colRto: 'RTO',
      colStarted: 'Started',
      noRecoveryPointPinned: 'no recovery point pinned',
      rtoTargetPrefix: 'target',
      unknown: 'unknown',
      statusLabels: {
        healthy: 'Healthy',
        warning: 'Watch',
        critical: 'Critical',
        paused: 'Paused',
        seeding: 'Seeding',
        empty: 'Empty',
        streaming: 'Streaming',
        degraded: 'Degraded',
        error: 'Error',
        completed: 'Completed',
        passed: 'Passed',
        failed: 'Failed',
        attested: 'Attested',
        awaiting_approval: 'Awaiting approval',
      },
    },
  },
  ar: {
    noRunsTitle: 'لا توجد عمليات استرداد بعد',
    noRunsDescription:
      'أعلن عن تجاوز فشل لإجراء تحويل فعلي للإنتاج، أو ابدأ تمرينًا غير معطِّل لمحاكاة الاسترداد. تمرّ كل عملية عبر بوابات التحقق ثم الموافقة ثم التنفيذ ثم الإثبات.',
    noRunsAction: 'إعلان تجاوز فشل أو بدء تمرين',

    noActiveRunTitle: 'لا توجد عملية جارية',
    noActiveRunDescription:
      'عند إعلان عملية تجاوز فشل أو تمرين، يظهر هنا تقدّمها المباشر عبر البوابات وسجلّ تنفيذها.',
    failoverOps: {
      loadError: 'فشل تحميل عمليات تجاوز الفشل.',
      fourGateTitle: 'تجاوز الفشل عبر البوابات الأربع',
      fourGateDescription: 'تحقق ثم موافقة ثم تنفيذ ثم إثبات. لا يمكن تخطّي أي بوابة.',
      noActiveRun: 'لا توجد عملية نشطة',
      gateActive: 'نشطة',
      gateDone: 'مكتملة',
      gateQueued: 'في قائمة الانتظار',
      gates: { validate: 'تحقق', approve: 'موافقة', execute: 'تنفيذ', attest: 'إثبات' },
      gateDescriptions: {
        validate: 'النسخ المتماثل ونقطة نظيفة وهدف نقطة الاسترداد (RPO)',
        approve: 'يلزم اعتماد بشري',
        execute: 'ترتيب الإقلاع والتوجيه',
        attest: 'إصدار أدلة غير قابلة للتعديل',
      },
      activeRunTitle: 'تفاصيل العملية النشطة',
      activeRunDescription: 'عملية تجاوز الفشل المُحكَمة الحالية أو آخر عملية مكتملة.',
      colMode: 'النمط',
      colStatus: 'الحالة',
      rtoTarget: 'هدف زمن الاسترداد (RTO)',
      rtoActual: 'زمن الاسترداد الفعلي',
      runLogPreview: 'معاينة سجلّ العملية',
      openLiveExecution: 'فتح التنفيذ المباشر',
      runsTitle: 'عمليات تجاوز الفشل',
      runsDescription: 'عمليات فعلية وتمارين تمرّ عبر بوابات التحقق والموافقة والتنفيذ والإثبات.',
      runsBadge: (count) => `${count} عملية`,
      colRun: 'العملية',
      colGroup: 'المجموعة',
      colRto: 'هدف زمن الاسترداد (RTO)',
      colStarted: 'بدأت في',
      noRecoveryPointPinned: 'لم تُثبَّت نقطة استرداد',
      rtoTargetPrefix: 'الهدف',
      unknown: 'غير معروف',
      statusLabels: {
        healthy: 'سليم',
        warning: 'تحت المراقبة',
        critical: 'حرج',
        paused: 'متوقف مؤقتًا',
        seeding: 'قيد التهيئة الأولية',
        empty: 'فارغ',
        streaming: 'قيد البث',
        degraded: 'متدهور',
        error: 'خطأ',
        completed: 'مكتمل',
        passed: 'ناجح',
        failed: 'فشل',
        attested: 'تم الإثبات',
        awaiting_approval: 'بانتظار الموافقة',
      },
    },
  },
};

/**
 * The active (English) label set, kept as a stable named export for non-React
 * callers and existing direct-import unit tests. React components resolve the
 * locale-aware copy via {@link useRecoverStateLabels} instead.
 */
export const recoverStateLabels: RecoverStateLabels = recoverStateLabelBundle.en;

/**
 * useRecoverStateLabels resolves the Recover empty-state copy against the active
 * locale (English fallback), mirroring {@link useDRLabels}. Memoised by locale so
 * the returned object is stable across renders.
 */
export function useRecoverStateLabels(): RecoverStateLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(recoverStateLabelBundle, locale), [locale]);
}
