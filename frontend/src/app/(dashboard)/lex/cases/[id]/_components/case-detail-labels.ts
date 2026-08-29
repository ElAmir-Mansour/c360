'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the NEW
 * Litigation Case *detail* surfaces added in the gold-standard revamp: the
 * navigation/shareability toolbar, the hero band, the "what needs you now"
 * action bar, the compact lifecycle stepper, and the persistent right-rail
 * cards (people / related / recent activity / key facts & deadlines).
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): a
 * `LexBilingual<CaseDetailExtraLabels> = { en, ar }` bundle with two FULL,
 * same-shaped copies resolved per locale by {@link useCaseDetailExtraLabels}.
 * Interpolated fields are functions on BOTH sides and preserve their numeric
 * placeholders (callers pass already-locale-formatted digit strings, so the
 * numbers stay Arabic-Indic under `ar`). JSX only ever touches the resolved
 * `CaseDetailExtraLabels`.
 *
 * Enum/status/priority tokens are NOT here — those resolve via the co-located
 * `./case-enums-i18n` helper (which reuses the Litigation Cases label catalog).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface CaseDetailExtraLabels {
  toolbar: {
    copyNumber: string;
    copyNumberAria: (caseNumber: string) => string;
    copyNumberCopiedAria: string;
    copyLink: string;
    copyLinkAria: string;
    copyLinkCopiedAria: string;
    copied: string;
    exportReport: string;
    exportReportAria: string;
    prev: string;
    prevAria: string;
    prevDisabledAria: string;
    next: string;
    nextAria: string;
    nextDisabledAria: string;
  };
  hero: {
    eyebrow: string;
    backToList: string;
    notSet: string;
    facts: {
      caseNumber: string;
      caseType: string;
      court: string;
      opened: string;
    };
  };
  actionBar: {
    heading: string;
    readOnly: string;
    overdueHint: (count: string) => string;
    reviewDeadlines: string;
    intakeHint: string;
    completeIntake: string;
    phase1Hint: string;
    phase1AwaitingManagerHint: string;
    openApprovals: string;
    phase2Hint: string;
    completeHandoff: string;
    assignOwnerHint: string;
    assignLawyer: string;
    assessStrengthHint: string;
    assessStrength: string;
    assessRiskHint: string;
    assessRisk: string;
    upcomingHint: (when: string) => string;
    onHoldHint: string;
    resumeCase: string;
    steadyHint: string;
    changeStatus: string;
    closedHint: string;
    cancelledHint: string;
    reopenCase: string;
  };
  stepper: {
    title: string;
    steps: {
      intake: string;
      phase1: string;
      phase2: string;
      open: string;
      under_procedure: string;
      closed: string;
    };
    terminalOnHold: string;
    terminalCancelled: string;
    hintOnHold: string;
    hintCancelled: string;
    entered: (relative: string) => string;
    enteredOn: (date: string) => string;
    timeInStage: (duration: string) => string;
    units: {
      lessThanMinute: string;
      minute: string;
      minutes: string;
      hour: string;
      hours: string;
      day: string;
      days: string;
    };
  };
  people: {
    title: string;
    responsibleLawyer: string;
    unassigned: string;
    assign: string;
    sectionManager: string;
    supervisor: string;
    handlingOfficer: string;
    copyId: string;
    copied: string;
    partiesHeading: (count: string) => string;
    noParties: string;
    viewAllParties: string;
    createdBy: (id: string) => string;
    noIdentifier: string;
  };
  related: {
    title: string;
    description: string;
    linkedRequestHeading: string;
    linkedRequestTitle: string;
    viewRequest: string;
    itemsHeading: string;
    hearings: string;
    judgments: string;
    pleadings: string;
    defendant: string;
    documents: string;
    counter: (count: string) => string;
    empty: string;
  };
  activity: {
    title: string;
    viewAll: string;
    empty: string;
    loadError: string;
    actorPrefix: (id: string) => string;
    actionLabel: (raw: string) => string;
  };
  keyFacts: {
    title: string;
    riskLow: string;
    riskMedium: string;
    riskHigh: string;
    riskCritical: string;
    overdue: (count: string) => string;
    nextDeadline: string;
    noDeadlines: string;
    strength: string;
    riskRating: string;
    exposure: (amount: string) => string;
    lastUpdated: string;
    notSet: string;
    viewTimeline: string;
    typeTask: string;
    typeHearing: string;
    typeExpert: string;
    typeJudgment: string;
    overdueBadge: string;
    dueToday: string;
    dueIn: (days: string) => string;
  };
}

const bundle: LexBilingual<CaseDetailExtraLabels> = {
  en: {
    toolbar: {
      copyNumber: 'Copy case number',
      copyNumberAria: (caseNumber) => `Copy case number ${caseNumber}`,
      copyNumberCopiedAria: 'Case number copied',
      copyLink: 'Copy link',
      copyLinkAria: 'Copy link to this case',
      copyLinkCopiedAria: 'Link copied',
      copied: 'Copied',
      exportReport: 'Export main report',
      exportReportAria: 'Open the browser print dialog for the complete case report',
      prev: 'Previous case',
      prevAria: 'Go to previous case (shortcut: k)',
      prevDisabledAria: 'No previous case on this page',
      next: 'Next case',
      nextAria: 'Go to next case (shortcut: j)',
      nextDisabledAria: 'No next case on this page',
    },
    hero: {
      eyebrow: 'Litigation case',
      backToList: 'Back to cases',
      notSet: 'Not set',
      facts: {
        caseNumber: 'Case number',
        caseType: 'Case type',
        court: 'Competent court',
        opened: 'Opened',
      },
    },
    actionBar: {
      heading: 'What needs you now',
      readOnly: 'You have read-only access to this case.',
      overdueHint: (count) => `${count} deadline(s) are overdue and need attention.`,
      reviewDeadlines: 'Review deadlines',
      intakeHint: 'Complete Phase-1 intake to launch the case.',
      completeIntake: 'Complete intake',
      phase1Hint: 'Manager approval is pending. Review the directive in Awaiting me.',
      phase1AwaitingManagerHint:
        'Awaiting Case Manager approval. This stage is assigned to the Cases Manager to preserve separation of duties; no action is required from you yet.',
      openApprovals: 'Review decision',
      phase2Hint: 'Approval is complete. Allocate the entity team to open the case.',
      completeHandoff: 'Complete handoff',
      assignOwnerHint: 'No responsible lawyer is assigned yet.',
      assignLawyer: 'Assign lawyer',
      assessStrengthHint: 'Case strength has not been assessed yet.',
      assessStrength: 'Assess strength',
      assessRiskHint: 'Case risk has not been rated yet.',
      assessRisk: 'Assess risk',
      upcomingHint: (when) => `Next critical deadline ${when}.`,
      onHoldHint: 'This case is on hold — resume it to continue work.',
      resumeCase: 'Resume case',
      steadyHint: 'Case is progressing. Update its status as it moves forward.',
      changeStatus: 'Change status',
      closedHint: 'This case is closed. Reopen it if further action is required.',
      cancelledHint: 'This case was cancelled. Reopen it to resume work.',
      reopenCase: 'Reopen case',
    },
    stepper: {
      title: 'Case lifecycle',
      steps: {
        intake: 'Intake',
        phase1: 'Phase 1',
        phase2: 'Phase 2',
        open: 'Open',
        under_procedure: 'Under procedure',
        closed: 'Closed',
      },
      terminalOnHold: 'On hold',
      terminalCancelled: 'Cancelled',
      hintOnHold: 'The case is paused. Resume it to continue the lifecycle.',
      hintCancelled: 'The case was cancelled and left the lifecycle.',
      entered: (relative) => `entered ${relative}`,
      enteredOn: (date) => `Entered ${date}`,
      timeInStage: (duration) => `Time in stage: ${duration}`,
      units: {
        lessThanMinute: 'less than a minute',
        minute: 'minute',
        minutes: 'minutes',
        hour: 'hour',
        hours: 'hours',
        day: 'day',
        days: 'days',
      },
    },
    people: {
      title: 'People',
      responsibleLawyer: 'Responsible lawyer',
      unassigned: 'Unassigned',
      assign: 'Assign',
      sectionManager: 'Section manager',
      supervisor: 'Supervisor',
      handlingOfficer: 'Handling officer',
      copyId: 'Copy id',
      copied: 'Copied',
      partiesHeading: (count) => `Parties (${count})`,
      noParties: 'No parties recorded yet.',
      viewAllParties: 'View all parties',
      createdBy: (id) => `Created by ${id}`,
      noIdentifier: 'No identifier',
    },
    related: {
      title: 'Related & documents',
      description: 'What this case connects to.',
      linkedRequestHeading: 'Originating request',
      linkedRequestTitle: 'Legal service request',
      viewRequest: 'Open the originating service-desk request',
      itemsHeading: 'Case records',
      hearings: 'Hearings',
      judgments: 'Judgments',
      pleadings: 'Statement of claim',
      defendant: 'Incoming lawsuit',
      documents: 'Documents',
      counter: (count) => count,
      empty: 'No linked records or documents yet.',
    },
    activity: {
      title: 'Recent activity',
      viewAll: 'View full history',
      empty: 'No activity recorded yet.',
      loadError: 'Activity could not be loaded.',
      actorPrefix: (id) => `by ${id}`,
      actionLabel: (raw) => raw,
    },
    keyFacts: {
      title: 'Key facts & deadlines',
      riskLow: 'Low risk',
      riskMedium: 'Medium risk',
      riskHigh: 'High risk',
      riskCritical: 'Critical risk',
      overdue: (count) => `${count} overdue`,
      nextDeadline: 'Next deadline',
      noDeadlines: 'No upcoming deadlines.',
      strength: 'Strength',
      riskRating: 'Risk rating',
      exposure: (amount) => `Exposure ${amount}`,
      lastUpdated: 'Last updated',
      notSet: 'Not set',
      viewTimeline: 'View full timeline',
      typeTask: 'Task',
      typeHearing: 'Hearing',
      typeExpert: 'Expert',
      typeJudgment: 'Judgment',
      overdueBadge: 'Overdue',
      dueToday: 'Due today',
      dueIn: (days) => `In ${days}d`,
    },
  },
  ar: {
    toolbar: {
      copyNumber: 'نسخ رقم القضية',
      copyNumberAria: (caseNumber) => `نسخ رقم القضية ${caseNumber}`,
      copyNumberCopiedAria: 'تم نسخ رقم القضية',
      copyLink: 'نسخ الرابط',
      copyLinkAria: 'نسخ رابط هذه القضية',
      copyLinkCopiedAria: 'تم نسخ الرابط',
      copied: 'تم النسخ',
      exportReport: 'تصدير التقرير الرئيسي',
      exportReportAria: 'فتح نافذة الطباعة لتصدير تقرير القضية الكامل',
      prev: 'القضية السابقة',
      prevAria: 'الانتقال إلى القضية السابقة (اختصار: k)',
      prevDisabledAria: 'لا توجد قضية سابقة في هذه الصفحة',
      next: 'القضية التالية',
      nextAria: 'الانتقال إلى القضية التالية (اختصار: j)',
      nextDisabledAria: 'لا توجد قضية تالية في هذه الصفحة',
    },
    hero: {
      eyebrow: 'قضية تقاضٍ',
      backToList: 'العودة إلى القضايا',
      notSet: 'غير محدد',
      facts: {
        caseNumber: 'رقم القضية',
        caseType: 'نوع القضية',
        court: 'المحكمة المختصة',
        opened: 'تاريخ الفتح',
      },
    },
    actionBar: {
      heading: 'ما الذي يتطلّب إجراءك الآن',
      readOnly: 'صلاحيتك على هذه القضية للاطّلاع فقط.',
      overdueHint: (count) => `${count} من المواعيد النهائية متأخرة وتتطلّب المتابعة.`,
      reviewDeadlines: 'مراجعة المواعيد',
      intakeHint: 'أكمِل استقبال المرحلة الأولى لإطلاق القضية.',
      completeIntake: 'إكمال الاستقبال',
      phase1Hint: 'موافقة المدير معلّقة. راجع التوجيه في «بانتظار قراري».',
      phase1AwaitingManagerHint:
        'بانتظار موافقة مدير القضايا. أُسندت هذه المرحلة إلى مدير القضايا للحفاظ على فصل الصلاحيات، ولا يلزمك اتخاذ إجراء الآن.',
      openApprovals: 'مراجعة القرار',
      phase2Hint: 'اكتملت الموافقة. خصّص فريق الوحدة لفتح القضية.',
      completeHandoff: 'إكمال التسليم',
      assignOwnerHint: 'لم يُعيَّن محامٍ مسؤول بعد.',
      assignLawyer: 'تعيين محامٍ',
      assessStrengthHint: 'لم يتم تقييم قوة القضية بعد.',
      assessStrength: 'تقييم القوة',
      assessRiskHint: 'لم يتم تقييم مخاطر القضية بعد.',
      assessRisk: 'تقييم المخاطر',
      upcomingHint: (when) => `الموعد النهائي الحرج القادم ${when}.`,
      onHoldHint: 'هذه القضية معلّقة — استأنفها لمواصلة العمل.',
      resumeCase: 'استئناف القضية',
      steadyHint: 'القضية تتقدّم. حدِّث حالتها مع تقدّمها.',
      changeStatus: 'تغيير الحالة',
      closedHint: 'هذه القضية مغلقة. أعِد فتحها إذا لزم اتخاذ إجراء إضافي.',
      cancelledHint: 'أُلغيت هذه القضية. أعِد فتحها لاستئناف العمل.',
      reopenCase: 'إعادة فتح القضية',
    },
    stepper: {
      title: 'دورة حياة القضية',
      steps: {
        intake: 'الاستقبال',
        phase1: 'المرحلة الأولى',
        phase2: 'المرحلة الثانية',
        open: 'مفتوحة',
        under_procedure: 'قيد الإجراء',
        closed: 'مغلقة',
      },
      terminalOnHold: 'معلّقة',
      terminalCancelled: 'ملغاة',
      hintOnHold: 'القضية متوقّفة مؤقتًا. استأنفها لمواصلة دورة الحياة.',
      hintCancelled: 'أُلغيت القضية وخرجت من دورة الحياة.',
      entered: (relative) => `دخلت ${relative}`,
      enteredOn: (date) => `دخلت في ${date}`,
      timeInStage: (duration) => `مدة البقاء في المرحلة: ${duration}`,
      units: {
        lessThanMinute: 'أقل من دقيقة',
        minute: 'دقيقة',
        minutes: 'دقائق',
        hour: 'ساعة',
        hours: 'ساعات',
        day: 'يوم',
        days: 'أيام',
      },
    },
    people: {
      title: 'الأشخاص',
      responsibleLawyer: 'المحامي المسؤول',
      unassigned: 'غير مُعيَّن',
      assign: 'تعيين',
      sectionManager: 'مدير القسم',
      supervisor: 'المشرف',
      handlingOfficer: 'المسؤول المباشر',
      copyId: 'نسخ المعرّف',
      copied: 'تم النسخ',
      partiesHeading: (count) => `الأطراف (${count})`,
      noParties: 'لم تُسجَّل أطراف بعد.',
      viewAllParties: 'عرض جميع الأطراف',
      createdBy: (id) => `أنشأها ${id}`,
      noIdentifier: 'لا يوجد معرّف',
    },
    related: {
      title: 'الروابط والوثائق',
      description: 'ما ترتبط به هذه القضية.',
      linkedRequestHeading: 'الطلب الأصلي',
      linkedRequestTitle: 'طلب خدمة قانونية',
      viewRequest: 'فتح طلب مكتب الخدمة الأصلي',
      itemsHeading: 'سجلات القضية',
      hearings: 'الجلسات',
      judgments: 'الأحكام',
      pleadings: 'صحيفة الدعوى',
      defendant: 'الدعوى الواردة',
      documents: 'الوثائق',
      counter: (count) => count,
      empty: 'لا توجد سجلات أو وثائق مرتبطة بعد.',
    },
    activity: {
      title: 'النشاط الأخير',
      viewAll: 'عرض السجل الكامل',
      empty: 'لم يُسجَّل نشاط بعد.',
      loadError: 'تعذّر تحميل النشاط.',
      actorPrefix: (id) => `بواسطة ${id}`,
      actionLabel: (raw) => raw,
    },
    keyFacts: {
      title: 'الحقائق والمواعيد الأساسية',
      riskLow: 'مخاطر منخفضة',
      riskMedium: 'مخاطر متوسطة',
      riskHigh: 'مخاطر مرتفعة',
      riskCritical: 'مخاطر حرجة',
      overdue: (count) => `${count} متأخرة`,
      nextDeadline: 'الموعد النهائي القادم',
      noDeadlines: 'لا توجد مواعيد نهائية قادمة.',
      strength: 'القوة',
      riskRating: 'تصنيف المخاطر',
      exposure: (amount) => `التعرّض ${amount}`,
      lastUpdated: 'آخر تحديث',
      notSet: 'غير محدد',
      viewTimeline: 'عرض المخطط الزمني الكامل',
      typeTask: 'مهمة',
      typeHearing: 'جلسة',
      typeExpert: 'خبير',
      typeJudgment: 'حكم',
      overdueBadge: 'متأخر',
      dueToday: 'مستحق اليوم',
      dueIn: (days) => `خلال ${days} يوم`,
    },
  },
};

export function resolveCaseDetailExtraLabels(locale: AppLocale = 'en'): CaseDetailExtraLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useCaseDetailExtraLabels(): CaseDetailExtraLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCaseDetailExtraLabels(locale), [locale]);
}
