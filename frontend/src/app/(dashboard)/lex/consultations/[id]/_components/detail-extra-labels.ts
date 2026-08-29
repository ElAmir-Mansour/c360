'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the Legal
 * Consultation *detail* revamp: the nav/shareability toolbar, the "what needs
 * me now" action bar, the compact lifecycle stepper, the right-rail People /
 * Related / Recent-activity cards, and the compact SLA ribbon.
 *
 * Follows the canonical lex i18n contract (`../../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale by {@link useConsultationDetailLabels}. JSX only ever
 * touches the resolved `T`. This file holds ONLY the NEW strings — the
 * pre-existing consultation copy stays in `../../_components/labels.ts`
 * (consumed via `useConsultationLabels()`).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface ConsultationDetailExtraLabels {
  // --- Left-column tabs ---
  tabs: {
    overview: string;
    documents: string;
    approval: string;
    activity: string;
  };

  // --- Nav & shareability toolbar ---
  toolbar: {
    copyNumber: string;
    copyNumberAria: (consultationNumber: string) => string;
    copyNumberCopiedAria: string;
    copyLink: string;
    copyLinkAria: string;
    copyLinkCopiedAria: string;
    copied: string;
    prev: string;
    prevAria: string;
    prevDisabledAria: string;
    next: string;
    nextAria: string;
    nextDisabledAria: string;
  };

  // --- "What needs me now" action bar ---
  actionBar: {
    heading: string;
    classify: string;
    classifyHint: string;
    route: string;
    routeHint: string;
    respond: string;
    respondHint: string;
    startApproval: string;
    startApprovalHint: string;
    archive: string;
    archiveHint: string;
    archiveBlockedHint: string;
    archivedHint: string;
    readOnly: string;
    openApproval: string;
    awaitingApprovalHint: string;
    pendingApprovalHint: string;
    loadingTasks: string;
    openTaskCount: (n: number) => string;
    decisionNotesLabel: string;
    decisionNotesPlaceholder: string;
    approve: string;
    reject: string;
    deciding: string;
    decisionSuccess: string;
    rejectConfirm: { title: string; description: string; confirm: string };
  };

  // --- Compact lifecycle stepper ---
  stepper: {
    title: string;
    steps: {
      submitted: string;
      classified: string;
      routed: string;
      responded: string;
      approved: string;
      archived: string;
    };
    entered: (relative: string) => string;
    enteredOn: (date: string) => string;
    timeInStage: (duration: string) => string;
    units: {
      day: string;
      days: string;
      hour: string;
      hours: string;
      minute: string;
      minutes: string;
      lessThanMinute: string;
    };
  };

  // --- Right-rail People card ---
  people: {
    title: string;
    requester: string;
    requesterUnknown: string;
    advisor: string;
    advisorUnassigned: string;
    department: string;
    copyId: string;
    copied: string;
    createdBy: (actor: string) => string;
  };

  // --- Right-rail Related card ---
  related: {
    title: string;
    description: string;
    linkedRequestHeading: string;
    openLinkedRequest: string;
    documentsHeading: string;
    documentsCounter: (n: number) => string;
    documentsEmpty: string;
    tagsHeading: string;
    tagsEmpty: string;
    emptyAll: string;
  };

  // --- Right-rail Recent-activity mini feed ---
  activityMini: {
    title: string;
    viewAll: string;
    empty: string;
    loadError: string;
    actorPrefix: (actor: string) => string;
    performed: (action: string) => string;
  };

  // --- Right-rail compact SLA ribbon ---
  sla: {
    eyebrow: string;
    ariaLabel: string;
    notStartedTitle: string;
    notStartedBody: string;
    duePrefix: string;
    overduePrefix: string;
    elapsedSuffix: string;
  };
}

const bundle: LexBilingual<ConsultationDetailExtraLabels> = {
  en: {
    tabs: {
      overview: 'Overview',
      documents: 'Documents',
      approval: 'Approval',
      activity: 'Activity',
    },
    toolbar: {
      copyNumber: 'Copy consultation number',
      copyNumberAria: (n) => `Copy consultation number ${n}`,
      copyNumberCopiedAria: 'Consultation number copied',
      copyLink: 'Copy link',
      copyLinkAria: 'Copy link to this consultation',
      copyLinkCopiedAria: 'Link copied',
      copied: 'Copied',
      prev: 'Previous consultation',
      prevAria: 'Go to previous consultation (shortcut: k)',
      prevDisabledAria: 'No previous consultation on this page',
      next: 'Next consultation',
      nextAria: 'Go to next consultation (shortcut: j)',
      nextDisabledAria: 'No next consultation on this page',
    },
    actionBar: {
      heading: 'What needs you now',
      classify: 'Classify',
      classifyHint: 'Triage the subject-matter type and priority to start routing.',
      route: 'Route to advisor',
      routeHint: 'Classified — assign it to a legal advisor to answer.',
      respond: 'Record response',
      respondHint: 'Routed to you — record the legal response (or draft it with AI).',
      startApproval: 'Start approval',
      startApprovalHint: 'Answered — route the response for sign-off before closure.',
      archive: 'Archive',
      archiveHint: 'Approved — archive it to complete the consultation.',
      archiveBlockedHint: 'A legal hold blocks archiving until it is released.',
      archivedHint: 'This consultation is archived — no further action is needed.',
      readOnly: 'You have read-only access to this consultation.',
      openApproval: 'Open approval',
      awaitingApprovalHint: 'Awaiting a sign-off decision on the response.',
      pendingApprovalHint: 'A response is waiting for your approval decision.',
      loadingTasks: 'Checking approval tasks…',
      openTaskCount: (n) => `${n} open task${n === 1 ? '' : 's'}`,
      decisionNotesLabel: 'Decision notes (optional)',
      decisionNotesPlaceholder: 'Add a note for the record…',
      approve: 'Approve',
      reject: 'Reject',
      deciding: 'Applying…',
      decisionSuccess: 'Decision applied.',
      rejectConfirm: {
        title: 'Reject this response',
        description:
          'Rejecting sends the response back for revision. This is recorded on the governance log.',
        confirm: 'Reject',
      },
    },
    stepper: {
      title: 'Lifecycle',
      steps: {
        submitted: 'Submitted',
        classified: 'Classified',
        routed: 'Routed',
        responded: 'Responded',
        approved: 'Approved',
        archived: 'Archived',
      },
      entered: (relative) => `entered ${relative}`,
      enteredOn: (date) => `Entered ${date}`,
      timeInStage: (duration) => `Time in stage: ${duration}`,
      units: {
        day: 'day',
        days: 'days',
        hour: 'hour',
        hours: 'hours',
        minute: 'min',
        minutes: 'min',
        lessThanMinute: 'less than a minute',
      },
    },
    people: {
      title: 'People',
      requester: 'Requester',
      requesterUnknown: 'Unknown requester',
      advisor: 'Assigned advisor',
      advisorUnassigned: 'Unassigned',
      department: 'Department',
      copyId: 'Copy ID',
      copied: 'Copied',
      createdBy: (actor) => `Created by ${actor}`,
    },
    related: {
      title: 'Related & attachments',
      description: 'What this consultation connects to.',
      linkedRequestHeading: 'Linked legal request',
      openLinkedRequest: 'Open linked legal request',
      documentsHeading: 'Documents',
      documentsCounter: (n) => `${n}`,
      documentsEmpty: 'No documents attached.',
      tagsHeading: 'Tags',
      tagsEmpty: 'No tags.',
      emptyAll: 'Nothing linked yet.',
    },
    activityMini: {
      title: 'Recent activity',
      viewAll: 'View all activity',
      empty: 'No activity recorded yet.',
      loadError: 'Could not load recent activity.',
      actorPrefix: (actor) => `by ${actor}`,
      performed: (action) => action,
    },
    sla: {
      eyebrow: 'Response SLA',
      ariaLabel: 'Consultation response SLA status',
      notStartedTitle: 'SLA clock not started',
      notStartedBody: 'The response clock starts once the consultation is being worked.',
      duePrefix: 'Due',
      overduePrefix: 'Overdue',
      elapsedSuffix: 'elapsed',
    },
  },
  ar: {
    tabs: {
      overview: 'نظرة عامة',
      documents: 'المستندات',
      approval: 'الاعتماد',
      activity: 'النشاط',
    },
    toolbar: {
      copyNumber: 'نسخ رقم الاستشارة',
      copyNumberAria: (n) => `نسخ رقم الاستشارة ${n}`,
      copyNumberCopiedAria: 'تم نسخ رقم الاستشارة',
      copyLink: 'نسخ الرابط',
      copyLinkAria: 'نسخ رابط هذه الاستشارة',
      copyLinkCopiedAria: 'تم نسخ الرابط',
      copied: 'تم النسخ',
      prev: 'الاستشارة السابقة',
      prevAria: 'الانتقال إلى الاستشارة السابقة (اختصار: k)',
      prevDisabledAria: 'لا توجد استشارة سابقة في هذه الصفحة',
      next: 'الاستشارة التالية',
      nextAria: 'الانتقال إلى الاستشارة التالية (اختصار: j)',
      nextDisabledAria: 'لا توجد استشارة تالية في هذه الصفحة',
    },
    actionBar: {
      heading: 'ما المطلوب منك الآن',
      classify: 'تصنيف',
      classifyHint: 'حدّد نوع الموضوع والأولوية لبدء التوجيه.',
      route: 'التوجيه إلى مستشار',
      routeHint: 'تم التصنيف — أسندها إلى مستشار قانوني للرد عليها.',
      respond: 'تسجيل الرد',
      respondHint: 'وُجّهت إليك — سجّل الرد القانوني (أو صُغه بالذكاء الاصطناعي).',
      startApproval: 'بدء الاعتماد',
      startApprovalHint: 'تمت الإجابة — وجّه الرد للاعتماد قبل الإغلاق.',
      archive: 'أرشفة',
      archiveHint: 'معتمدة — أرشفها لإكمال الاستشارة.',
      archiveBlockedHint: 'يمنع الحجز القانوني الأرشفة حتى يُرفع.',
      archivedHint: 'هذه الاستشارة مؤرشفة — لا يلزم أي إجراء إضافي.',
      readOnly: 'لديك صلاحية اطّلاع فقط على هذه الاستشارة.',
      openApproval: 'فتح الاعتماد',
      awaitingApprovalHint: 'بانتظار قرار الاعتماد على الرد.',
      pendingApprovalHint: 'هناك رد بانتظار قرار اعتمادك.',
      loadingTasks: 'جارٍ فحص مهام الاعتماد…',
      openTaskCount: (n) => `${n} مهمة مفتوحة`,
      decisionNotesLabel: 'ملاحظات القرار (اختياري)',
      decisionNotesPlaceholder: 'أضف ملاحظة للسجل…',
      approve: 'اعتماد',
      reject: 'رفض',
      deciding: 'جارٍ التطبيق…',
      decisionSuccess: 'تم تطبيق القرار.',
      rejectConfirm: {
        title: 'رفض هذا الرد',
        description: 'الرفض يُعيد الرد للمراجعة. يُسجَّل ذلك في سجل الحوكمة.',
        confirm: 'رفض',
      },
    },
    stepper: {
      title: 'دورة الحياة',
      steps: {
        submitted: 'مُقدَّمة',
        classified: 'مُصنَّفة',
        routed: 'مُوجَّهة',
        responded: 'تم الرد',
        approved: 'معتمدة',
        archived: 'مؤرشفة',
      },
      entered: (relative) => `دخلت ${relative}`,
      enteredOn: (date) => `دخلت في ${date}`,
      timeInStage: (duration) => `الزمن في المرحلة: ${duration}`,
      units: {
        day: 'يوم',
        days: 'أيام',
        hour: 'ساعة',
        hours: 'ساعات',
        minute: 'دقيقة',
        minutes: 'دقيقة',
        lessThanMinute: 'أقل من دقيقة',
      },
    },
    people: {
      title: 'الأشخاص',
      requester: 'مُقدِّم الطلب',
      requesterUnknown: 'مُقدِّم غير معروف',
      advisor: 'المستشار المُسنَد',
      advisorUnassigned: 'غير مُسند',
      department: 'الإدارة',
      copyId: 'نسخ المعرّف',
      copied: 'تم النسخ',
      createdBy: (actor) => `أنشأها ${actor}`,
    },
    related: {
      title: 'المرتبطات والمرفقات',
      description: 'ما ترتبط به هذه الاستشارة.',
      linkedRequestHeading: 'الطلب القانوني المرتبط',
      openLinkedRequest: 'فتح الطلب القانوني المرتبط',
      documentsHeading: 'المستندات',
      documentsCounter: (n) => `${n}`,
      documentsEmpty: 'لا توجد مستندات مرفقة.',
      tagsHeading: 'الوسوم',
      tagsEmpty: 'لا توجد وسوم.',
      emptyAll: 'لا توجد ارتباطات بعد.',
    },
    activityMini: {
      title: 'أحدث النشاط',
      viewAll: 'عرض كل النشاط',
      empty: 'لم يُسجَّل أي نشاط بعد.',
      loadError: 'تعذّر تحميل أحدث النشاط.',
      actorPrefix: (actor) => `بواسطة ${actor}`,
      performed: (action) => action,
    },
    sla: {
      eyebrow: 'مستوى خدمة الرد',
      ariaLabel: 'حالة مستوى خدمة الرد على الاستشارة',
      notStartedTitle: 'لم يبدأ مؤقّت مستوى الخدمة',
      notStartedBody: 'يبدأ مؤقّت الرد بمجرد بدء العمل على الاستشارة.',
      duePrefix: 'الاستحقاق',
      overduePrefix: 'متأخرة',
      elapsedSuffix: 'منقضٍ',
    },
  },
};

export function resolveConsultationDetailLabels(
  locale: AppLocale = 'en',
): ConsultationDetailExtraLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useConsultationDetailLabels(): ConsultationDetailExtraLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveConsultationDetailLabels(locale), [locale]);
}
