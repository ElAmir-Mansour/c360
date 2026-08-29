'use client';

/**
 * Feature-local bilingual copy for the guided failover wizard.
 *
 * Per the console contract the copy is held in a `DRBilingual<FailoverWizardLabels>`
 * bundle — two full, same-shaped copies of the label object (English +
 * professional MSA Arabic), with function-valued and nested-object fields present
 * on BOTH sides and identical interpolation params — and resolved against the
 * active locale by the {@link useFailoverWizardLabels} hook. Resolution defaults
 * to English (the `resolveDRBilingual` cross-locale fallback) so the
 * `renderWithQuery` `en` default keeps existing English assertions green; an
 * Arabic user sees the full MSA surface. NEW strings live beside the feature (do
 * NOT add these to `dr-i18n.ts`).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../../_lib/dr-i18n';

export interface FailoverWizardLabels {
  /** Command-bar trigger. */
  trigger: string;
  triggerTooltipNoWrite: string;
  triggerTooltipNoGroup: string;

  dialogTitle: string;
  dialogDescription: string;

  /** Wizard chrome. */
  stepProgress: (current: number, total: number) => string;
  back: string;
  next: string;
  cancel: string;
  groupLabel: string;
  noGroup: string;

  steps: {
    preflight: string;
    plan: string;
    impact: string;
    confirm: string;
  };

  preflight: {
    heading: string;
    description: string;
    loading: string;
    unavailable: string;
    readyTitle: string;
    readyBody: string;
    blockingTitle: string;
    blockingBody: string;
    cannotFailover: string;
    warningsTitle: string;
    warningsBody: string;
    ackAll: string;
    activeRunTitle: string;
    activeRunBody: (runId: string, status: string) => string;
    statusLabel: string;
  };

  plan: {
    heading: string;
    description: string;
    recoveryPointLabel: string;
    recoveryPointHelp: string;
    recoveryPointLatest: string;
    recoveryPointEmpty: string;
    recoveryPointPlaceholder: string;
    recoveryPointValidated: string;
    recoveryPointUnvalidated: string;
    recoveryPointLegalHold: string;
    recoveryPointRpo: (label: string) => string;
    targetLabel: string;
    targetHelp: string;
    targetLoading: string;
    targetNone: string;
    targetSelected: (siteName: string) => string;
    targetEligible: string;
    targetIneligible: string;
    targetReason: (reason: string) => string;
    modeLabel: string;
    modeHelp: string;
    modeDrill: string;
    modeDrillHint: string;
    modeReal: string;
    modeRealHint: string;
  };

  impact: {
    heading: string;
    description: string;
    rowMode: string;
    rowGroup: string;
    rowRecoveryPoint: string;
    rowRecoveryPointLatest: string;
    rowTarget: string;
    rowRtoObjective: string;
    rowRpoObjective: string;
    modeDrillValue: string;
    modeRealValue: string;
    realCutoverWarningTitle: string;
    realCutoverWarningBody: string;
    gatesNote: string;
  };

  confirm: {
    heading: string;
    description: string;
    phraseLabelDrill: string;
    phraseLabelReal: string;
    phraseDrill: string;
    phraseReal: string;
    inputLabel: string;
    inputPlaceholder: string;
    mismatch: string;
    submitDrill: string;
    submitReal: string;
    /**
     * Shown on the confirm step when the operator holds `dr:write` (so the wizard
     * opened and pre-flighted) but lacks the `dr:failover` step-up permission, so
     * the final declaration is disabled.
     */
    stepUpRequired: string;
  };
}

export const failoverWizardLabelBundle: DRBilingual<FailoverWizardLabels> = {
  en: {
    trigger: 'Declare failover',
    triggerTooltipNoWrite: 'Requires the dr:write permission',
    triggerTooltipNoGroup: 'Select a protection group first',

    dialogTitle: 'Guided failover',
    dialogDescription:
      'A pre-flighted, four-step path to declaring a recovery run for the selected protection group. Nothing cuts over without passing readiness and a typed confirmation.',

    stepProgress: (current: number, total: number) => `Step ${current} of ${total}`,
    back: 'Back',
    next: 'Continue',
    cancel: 'Cancel',
    groupLabel: 'Protection group',
    noGroup: 'No protection group selected',

    steps: {
      preflight: 'Pre-flight',
      plan: 'Recovery plan',
      impact: 'Impact',
      confirm: 'Confirm',
    },

    preflight: {
      heading: 'Readiness pre-flight',
      description:
        'Live failover readiness for this group. Blocking issues must clear before a run can be declared; warnings must be explicitly acknowledged.',
      loading: 'Evaluating failover readiness…',
      unavailable:
        'Failover readiness is unavailable for this group. A run cannot be declared until readiness reports.',
      readyTitle: 'Ready to fail over',
      readyBody: 'No blocking issues or warnings were found for this protection group.',
      blockingTitle: 'Blocking issues',
      blockingBody: 'Resolve these before a failover can be declared.',
      cannotFailover: 'This group cannot fail over right now.',
      warningsTitle: 'Warnings',
      warningsBody: 'Acknowledge each warning to continue.',
      ackAll: 'I acknowledge all warnings above and accept the risk.',
      activeRunTitle: 'A run is already in flight',
      activeRunBody: (runId: string, status: string) =>
        `Run ${runId} is currently ${status}. Declaring another run may conflict with it.`,
      statusLabel: 'Readiness status',
    },

    plan: {
      heading: 'Choose the recovery plan',
      description:
        'Select where to recover from, where to recover to, and whether this is a non-disruptive drill or a real cutover.',

      recoveryPointLabel: 'Recovery point',
      recoveryPointHelp:
        'The sealed point-in-time to recover from. Validated points are preferred.',
      recoveryPointLatest: 'Latest available (let the orchestrator choose)',
      recoveryPointEmpty:
        'No sealed recovery points found for this group. The orchestrator will recover from the latest available point.',
      recoveryPointPlaceholder: 'Select a recovery point',
      recoveryPointValidated: 'Validated',
      recoveryPointUnvalidated: 'Not validated',
      recoveryPointLegalHold: 'Legal hold',
      recoveryPointRpo: (label: string) => `RPO ${label}`,

      targetLabel: 'Recovery target',
      targetHelp: 'The failover target selected from the group topology.',
      targetLoading: 'Resolving failover target…',
      targetNone:
        'No eligible failover target is selected in the topology. Configure topology before declaring a run.',
      targetSelected: (siteName: string) => `${siteName}`,
      targetEligible: 'Eligible',
      targetIneligible: 'Not eligible',
      targetReason: (reason: string) => reason,

      modeLabel: 'Mode',
      modeHelp:
        'Drills rehearse the recovery path without disrupting production. A real cutover redirects production to the recovery target.',
      modeDrill: 'Drill — non-disruptive rehearsal',
      modeDrillHint: 'Safe to run anytime; production routing is never touched.',
      modeReal: 'Real cutover — redirect production',
      modeRealHint: 'Production traffic moves to the recovery target once approved.',
    },

    impact: {
      heading: 'Impact summary',
      description: 'Review the run that will be declared before you confirm.',
      rowMode: 'Mode',
      rowGroup: 'Protection group',
      rowRecoveryPoint: 'Recovery point',
      rowRecoveryPointLatest: 'Latest available',
      rowTarget: 'Recovery target',
      rowRtoObjective: 'RTO objective',
      rowRpoObjective: 'RPO objective',
      modeDrillValue: 'Drill (non-disruptive)',
      modeRealValue: 'Real cutover',
      realCutoverWarningTitle: 'Real cutover declared',
      realCutoverWarningBody:
        'This run redirects production traffic to the recovery target once it passes the approval gate. It is not a rehearsal.',
      gatesNote:
        'The run advances through Validate → Approve → Execute → Attest gates. Execution still requires human approval inside the war room.',
    },

    confirm: {
      heading: 'Confirm declaration',
      description: 'Type the confirmation phrase to declare this failover run.',
      phraseLabelDrill: 'To declare this drill, type',
      phraseLabelReal: 'To declare this real cutover, type',
      phraseDrill: 'DECLARE DRILL',
      phraseReal: 'DECLARE FAILOVER',
      inputLabel: 'Confirmation phrase',
      inputPlaceholder: 'Type the phrase exactly',
      mismatch: 'The phrase does not match yet.',
      submitDrill: 'Declare drill',
      submitReal: 'Declare failover',
      stepUpRequired: 'Declaring a run requires the dr:failover step-up permission.',
    },
  },
  ar: {
    trigger: 'إعلان تجاوز الفشل',
    triggerTooltipNoWrite: 'يتطلّب صلاحية الكتابة (dr:write)',
    triggerTooltipNoGroup: 'اختر مجموعة حماية أولًا',

    dialogTitle: 'تجاوز الفشل الموجَّه',
    dialogDescription:
      'مسار من أربع خطوات مع فحص مسبق لإعلان عملية استرداد لمجموعة الحماية المحددة. لا يحدث أي تحويل دون اجتياز الجاهزية وتأكيد مكتوب.',

    stepProgress: (current: number, total: number) => `الخطوة ${current} من ${total}`,
    back: 'رجوع',
    next: 'متابعة',
    cancel: 'إلغاء',
    groupLabel: 'مجموعة الحماية',
    noGroup: 'لم يتم اختيار مجموعة حماية',

    steps: {
      preflight: 'الفحص المسبق',
      plan: 'خطة الاسترداد',
      impact: 'الأثر',
      confirm: 'التأكيد',
    },

    preflight: {
      heading: 'الفحص المسبق للجاهزية',
      description:
        'جاهزية تجاوز الفشل المباشرة لهذه المجموعة. يجب معالجة المشكلات المانعة قبل إمكان إعلان أي عملية، ويجب الإقرار صراحةً بالتحذيرات.',
      loading: 'جارٍ تقييم جاهزية تجاوز الفشل…',
      unavailable:
        'جاهزية تجاوز الفشل غير متاحة لهذه المجموعة. لا يمكن إعلان عملية حتى ترد بيانات الجاهزية.',
      readyTitle: 'جاهز لتجاوز الفشل',
      readyBody: 'لم يتم العثور على أي مشكلات مانعة أو تحذيرات لمجموعة الحماية هذه.',
      blockingTitle: 'مشكلات مانعة',
      blockingBody: 'عالِج هذه المشكلات قبل التمكّن من إعلان تجاوز الفشل.',
      cannotFailover: 'لا يمكن لهذه المجموعة تجاوز الفشل في الوقت الحالي.',
      warningsTitle: 'تحذيرات',
      warningsBody: 'أقرّ بكل تحذير للمتابعة.',
      ackAll: 'أقرّ بجميع التحذيرات أعلاه وأقبل المخاطر.',
      activeRunTitle: 'هناك عملية جارية بالفعل',
      activeRunBody: (runId: string, status: string) =>
        `العملية ${runId} حالتها الآن ${status}. قد يتعارض إعلان عملية أخرى معها.`,
      statusLabel: 'حالة الجاهزية',
    },

    plan: {
      heading: 'اختر خطة الاسترداد',
      description:
        'حدّد مصدر الاسترداد، ووجهته، وما إذا كان هذا تمرينًا غير معطِّل أم تحويلًا فعليًا للإنتاج.',

      recoveryPointLabel: 'نقطة الاسترداد',
      recoveryPointHelp:
        'نقطة زمنية مختومة يُسترَدّ منها. يُفضَّل اختيار النقاط التي جرى التحقق منها.',
      recoveryPointLatest: 'أحدث نقطة متاحة (دع المنسّق يختار)',
      recoveryPointEmpty:
        'لم يتم العثور على نقاط استرداد مختومة لهذه المجموعة. سيسترِدّ المنسّق من أحدث نقطة متاحة.',
      recoveryPointPlaceholder: 'اختر نقطة استرداد',
      recoveryPointValidated: 'تم التحقق منها',
      recoveryPointUnvalidated: 'لم يتم التحقق منها',
      recoveryPointLegalHold: 'حجز قانوني',
      recoveryPointRpo: (label: string) => `RPO ${label}`,

      targetLabel: 'وجهة الاسترداد',
      targetHelp: 'وجهة تجاوز الفشل المختارة من هيكل المجموعة.',
      targetLoading: 'جارٍ تحديد وجهة تجاوز الفشل…',
      targetNone:
        'لم يتم اختيار وجهة مؤهَّلة لتجاوز الفشل في الهيكل. هيّئ الهيكل قبل إعلان أي عملية.',
      targetSelected: (siteName: string) => `${siteName}`,
      targetEligible: 'مؤهَّلة',
      targetIneligible: 'غير مؤهَّلة',
      targetReason: (reason: string) => reason,

      modeLabel: 'الوضع',
      modeHelp:
        'تحاكي التمارين مسار الاسترداد دون تعطيل الإنتاج. أما التحويل الفعلي فيعيد توجيه الإنتاج إلى وجهة الاسترداد.',
      modeDrill: 'تمرين — محاكاة غير معطِّلة',
      modeDrillHint: 'آمن في أي وقت؛ لا يُمَسّ توجيه الإنتاج إطلاقًا.',
      modeReal: 'تحويل فعلي — إعادة توجيه الإنتاج',
      modeRealHint: 'تنتقل حركة الإنتاج إلى وجهة الاسترداد بمجرد الموافقة.',
    },

    impact: {
      heading: 'ملخّص الأثر',
      description: 'راجِع العملية التي ستُعلَن قبل التأكيد.',
      rowMode: 'الوضع',
      rowGroup: 'مجموعة الحماية',
      rowRecoveryPoint: 'نقطة الاسترداد',
      rowRecoveryPointLatest: 'أحدث نقطة متاحة',
      rowTarget: 'وجهة الاسترداد',
      rowRtoObjective: 'هدف زمن الاسترداد (RTO)',
      rowRpoObjective: 'هدف نقطة الاسترداد (RPO)',
      modeDrillValue: 'تمرين (غير معطِّل)',
      modeRealValue: 'تحويل فعلي',
      realCutoverWarningTitle: 'تم إعلان تحويل فعلي',
      realCutoverWarningBody:
        'تعيد هذه العملية توجيه حركة الإنتاج إلى وجهة الاسترداد بمجرد اجتيازها بوابة الموافقة. وهي ليست محاكاة.',
      gatesNote:
        'تتقدّم العملية عبر بوابات التحقق ثم الموافقة ثم التنفيذ ثم الإثبات. ويظلّ التنفيذ مرهونًا بموافقة بشرية داخل غرفة الطوارئ.',
    },

    confirm: {
      heading: 'تأكيد الإعلان',
      description: 'اكتب عبارة التأكيد لإعلان عملية تجاوز الفشل هذه.',
      phraseLabelDrill: 'لإعلان هذا التمرين، اكتب',
      phraseLabelReal: 'لإعلان هذا التحويل الفعلي، اكتب',
      phraseDrill: 'DECLARE DRILL',
      phraseReal: 'DECLARE FAILOVER',
      inputLabel: 'عبارة التأكيد',
      inputPlaceholder: 'اكتب العبارة تمامًا',
      mismatch: 'العبارة لا تتطابق بعد.',
      submitDrill: 'إعلان التمرين',
      submitReal: 'إعلان تجاوز الفشل',
      stepUpRequired: 'يتطلّب إعلان أي عملية صلاحية التصعيد لتجاوز الفشل (dr:failover).',
    },
  },
};

/**
 * useFailoverWizardLabels resolves the wizard copy against the active locale
 * (English fallback), mirroring {@link useDRLabels}. Memoised by locale so the
 * returned object is stable across renders.
 */
export function useFailoverWizardLabels(): FailoverWizardLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(failoverWizardLabelBundle, locale), [locale]);
}

/** Mode discriminator for the wizard's plan/impact/confirm steps. */
export type FailoverWizardMode = 'drill' | 'real';
