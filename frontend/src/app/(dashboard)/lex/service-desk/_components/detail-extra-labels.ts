'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the Legal
 * Service Desk *request detail* enhancements (tabs + action bar, lifecycle
 * stepper, route + linked-subject, unified activity timeline, revise-in-
 * execution, clone-lineage banner).
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale by {@link useDetailExtraLabels}. JSX only ever touches the
 * resolved `T`. This file holds ONLY the new strings — the pre-existing detail
 * copy stays in `labels.ts` (consumed via `useServiceDeskLabels()`).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface DetailExtraLabels {
  // --- #15 Tabs ---
  tabs: {
    overview: string;
    sla: string;
    approval: string;
    execution: string;
    activity: string;
    flow: string;
  };

  // --- #15 "What needs me now" action bar ---
  actionBar: {
    heading: string;
    submit: string;
    submitHint: string;
    route: string;
    routeHint: string;
    confirmCompleteness: string;
    confirmCompletenessHint: string;
    recordDelivery: string;
    recordDeliveryHint: string;
    delivery: string;
    deliveryHint: string;
    none: string;
    noneHint: string;
    readOnly: string;
  };

  // --- #7 Lifecycle stepper ---
  stepper: {
    title: string;
    steps: {
      draft: string;
      submitted: string;
      approval: string;
      approved: string;
      routed: string;
      in_execution: string;
      delivered: string;
      closed: string;
    };
    terminalReturned: string;
    terminalCancelled: string;
    terminalHint: string;
  };

  // --- #6 Route dialog ---
  route: {
    button: string;
    dialogTitle: string;
    dialogDescription: string;
    confirm: string;
    toast: string;
  };

  // --- #6 Linked-subject card ---
  linkedSubject: {
    title: string;
    description: string;
    caseLink: string;
    consultationLink: string;
    contractLink: string;
    investigationLink: string;
    subjectType: string;
    subjectId: string;
  };

  // --- #8 Activity timeline ---
  activity: {
    title: string;
    description: string;
    empty: string;
    loadError: string;
    actorPrefix: (actor: string) => string;
    // event titles
    priorityChanged: (from: string, to: string) => string;
    reviewRoundOpened: (n: number) => string;
    reviewRoundClosed: (n: number, outcome: string) => string;
    deliveryRequested: string;
    deliveryResponded: (status: string) => string;
    approvalTask: (name: string, status: string) => string;
    auditAction: (action: string) => string;
    statusTransition: (from: string, to: string) => string;
  };

  // --- #9 Revise-in-execution dialog ---
  revise: {
    button: string;
    dialogTitle: string;
    dialogDescription: string;
    titleEn: string;
    titleAr: string;
    requestDescription: string;
    department: string;
    requestType: string;
    requesterApproval: string;
    providerApproval: string;
    cancel: string;
    save: string;
    errors: { titleRequired: string };
    substantialTitle: string;
    substantialBody: string;
    nonSubstantialTitle: string;
    nonSubstantialBody: string;
    reasonsHeading: string;
    reasonLabels: Record<string, string>;
    close: string;
    toast: string;
  };

  // --- #12 Clone-lineage banner ---
  clone: {
    clonedFrom: (ref: string) => string;
    continuedAs: (ref: string) => string;
    bothPrefix: string;
    viewOrigin: string;
    viewContinuation: string;
    refFallback: (id: string) => string;
  };
}

const bundle: LexBilingual<DetailExtraLabels> = {
  en: {
    tabs: {
      overview: 'Overview',
      sla: 'SLA',
      approval: 'Approval',
      execution: 'Execution',
      activity: 'Activity',
      flow: 'Workflow diagram',
    },
    actionBar: {
      heading: 'What needs you now',
      submit: 'Submit request',
      submitHint: 'This draft is ready to submit to the legal department.',
      route: 'Route request',
      routeHint: 'Approved — route it to spawn the matter and start execution.',
      confirmCompleteness: 'Confirm completeness',
      confirmCompletenessHint:
        'All required items are satisfied — confirm completeness to start the execution clock.',
      recordDelivery: 'Record delivery',
      recordDeliveryHint:
        'Execution is in progress — record delivery and ask the requester to confirm receipt.',
      delivery: 'Manage delivery confirmation',
      deliveryHint: 'Delivered — request or await the requester’s delivery confirmation.',
      none: 'No action needed from you',
      noneHint: 'This request is progressing through its workflow.',
      readOnly: 'You have read-only access to this request.',
    },
    stepper: {
      title: 'Lifecycle',
      steps: {
        draft: 'Draft',
        submitted: 'Submitted',
        approval: 'Approval',
        approved: 'Approved',
        routed: 'Routed',
        in_execution: 'In execution',
        delivered: 'Delivered',
        closed: 'Closed',
      },
      terminalReturned: 'Returned',
      terminalCancelled: 'Cancelled',
      terminalHint: 'This request left the main lifecycle.',
    },
    route: {
      button: 'Route request',
      dialogTitle: 'Route this request',
      dialogDescription:
        'Routing the approved request spawns the legal matter and moves it into execution. This cannot be undone.',
      confirm: 'Route request',
      toast: 'Request routed.',
    },
    linkedSubject: {
      title: 'Linked matter',
      description: 'The case or consultation spawned from this request.',
      caseLink: 'Open linked case',
      consultationLink: 'Open linked consultation',
      contractLink: 'Open linked contract',
      investigationLink: 'Open linked investigation',
      subjectType: 'Subject type',
      subjectId: 'Reference',
    },
    activity: {
      title: 'Activity',
      description: 'A unified, reverse-chronological history of everything on this request.',
      empty: 'No activity has been recorded yet.',
      loadError: 'Some activity sources could not be loaded.',
      actorPrefix: (actor) => `by ${actor}`,
      priorityChanged: (from, to) => `Priority changed: ${from} → ${to}`,
      reviewRoundOpened: (n) => `Review round ${n} opened`,
      reviewRoundClosed: (n, outcome) => `Review round ${n} closed (${outcome})`,
      deliveryRequested: 'Delivery confirmation requested',
      deliveryResponded: (status) => `Delivery confirmation ${status}`,
      approvalTask: (name, status) => `Approval task “${name}” — ${status}`,
      auditAction: (action) => action,
      statusTransition: (from, to) => `Status: ${from} → ${to}`,
    },
    revise: {
      button: 'Revise request',
      dialogTitle: 'Revise request in execution',
      dialogDescription:
        'Edit the request while it is in execution. Substantial edits reopen the completeness gate and reset the SLA clock.',
      titleEn: 'Title (English)',
      titleAr: 'Title (Arabic)',
      requestDescription: 'Description',
      department: 'Department',
      requestType: 'Request type',
      requesterApproval: 'Requester approval required',
      providerApproval: 'Provider approval required',
      cancel: 'Cancel',
      save: 'Apply revision',
      errors: { titleRequired: 'A request title is required.' },
      substantialTitle: 'Substantial edit applied',
      substantialBody:
        'This revision is substantial: the completeness gate has reopened and the execution SLA clock has reset.',
      nonSubstantialTitle: 'Revision applied',
      nonSubstantialBody:
        'This was a minor edit — the completeness gate and SLA clock are unaffected.',
      reasonsHeading: 'Why it is substantial',
      reasonLabels: {
        service_changed: 'Service changed',
        request_type_changed: 'Request type changed',
        priority_tier_changed: 'Priority tier changed',
        scope_changed: 'Scope changed',
        required_item_added: 'A required item was added',
        required_item_removed: 'A required item was removed',
        requirement_churn: 'Requirements churned significantly',
      },
      close: 'Close',
      toast: 'Revision applied.',
    },
    clone: {
      clonedFrom: (ref) => `Clone of ${ref}`,
      continuedAs: (ref) => `continued as ${ref}`,
      bothPrefix: 'Lineage',
      viewOrigin: 'View origin request',
      viewContinuation: 'View continuation request',
      refFallback: (id) => `REQ ${id.slice(0, 8)}`,
    },
  },
  ar: {
    tabs: {
      overview: 'نظرة عامة',
      sla: 'مستوى الخدمة',
      approval: 'الموافقة',
      execution: 'التنفيذ',
      activity: 'النشاط',
      flow: 'مخطط سير العمل',
    },
    actionBar: {
      heading: 'ما المطلوب منك الآن',
      submit: 'تقديم الطلب',
      submitHint: 'هذه المسوّدة جاهزة للتقديم إلى الإدارة القانونية.',
      route: 'توجيه الطلب',
      routeHint: 'معتمد — وجّهه لإنشاء الملف القانوني وبدء التنفيذ.',
      confirmCompleteness: 'تأكيد الاكتمال',
      confirmCompletenessHint:
        'تم استيفاء كل العناصر المطلوبة — أكّد الاكتمال لبدء مؤقّت التنفيذ.',
      recordDelivery: 'تسجيل التسليم',
      recordDeliveryHint:
        'التنفيذ جارٍ — سجّل التسليم واطلب من مقدّم الطلب تأكيد الاستلام.',
      delivery: 'إدارة تأكيد التسليم',
      deliveryHint: 'تم التسليم — اطلب تأكيد التسليم من مقدّم الطلب أو انتظره.',
      none: 'لا يلزم منك أي إجراء',
      noneHint: 'يتقدّم هذا الطلب عبر سير عمله.',
      readOnly: 'لديك صلاحية اطّلاع فقط على هذا الطلب.',
    },
    stepper: {
      title: 'دورة الحياة',
      steps: {
        draft: 'مسوّدة',
        submitted: 'مُقدّم',
        approval: 'الموافقة',
        approved: 'معتمد',
        routed: 'مُوجَّه',
        in_execution: 'قيد التنفيذ',
        delivered: 'تم التسليم',
        closed: 'مغلق',
      },
      terminalReturned: 'مُعاد',
      terminalCancelled: 'مُلغى',
      terminalHint: 'خرج هذا الطلب من دورة الحياة الرئيسية.',
    },
    route: {
      button: 'توجيه الطلب',
      dialogTitle: 'توجيه هذا الطلب',
      dialogDescription:
        'توجيه الطلب المعتمد يُنشئ الملف القانوني وينقله إلى التنفيذ. لا يمكن التراجع عن ذلك.',
      confirm: 'توجيه الطلب',
      toast: 'تم توجيه الطلب.',
    },
    linkedSubject: {
      title: 'الملف المرتبط',
      description: 'القضية أو الاستشارة المُنشأة من هذا الطلب.',
      caseLink: 'فتح القضية المرتبطة',
      consultationLink: 'فتح الاستشارة المرتبطة',
      contractLink: 'فتح العقد المرتبط',
      investigationLink: 'فتح التحقيق المرتبط',
      subjectType: 'نوع الموضوع',
      subjectId: 'المرجع',
    },
    activity: {
      title: 'النشاط',
      description: 'سجلّ موحّد بترتيب زمني عكسي لكل ما جرى على هذا الطلب.',
      empty: 'لم يُسجّل أي نشاط بعد.',
      loadError: 'تعذّر تحميل بعض مصادر النشاط.',
      actorPrefix: (actor) => `بواسطة ${actor}`,
      priorityChanged: (from, to) => `تغيّرت الأولوية: ${from} ← ${to}`,
      reviewRoundOpened: (n) => `فُتحت دورة المراجعة ${n}`,
      reviewRoundClosed: (n, outcome) => `أُغلقت دورة المراجعة ${n} (${outcome})`,
      deliveryRequested: 'طُلب تأكيد التسليم',
      deliveryResponded: (status) => `تأكيد التسليم: ${status}`,
      approvalTask: (name, status) => `مهمة الموافقة «${name}» — ${status}`,
      auditAction: (action) => action,
      statusTransition: (from, to) => `الحالة: ${from} ← ${to}`,
    },
    revise: {
      button: 'مراجعة الطلب',
      dialogTitle: 'مراجعة الطلب أثناء التنفيذ',
      dialogDescription:
        'عدّل الطلب أثناء وجوده في التنفيذ. التعديلات الجوهرية تعيد فتح بوّابة الاكتمال وتعيد ضبط مؤقّت مستوى الخدمة.',
      titleEn: 'العنوان (إنجليزي)',
      titleAr: 'العنوان (عربي)',
      requestDescription: 'الوصف',
      department: 'الإدارة',
      requestType: 'نوع الطلب',
      requesterApproval: 'موافقة مقدّم الطلب مطلوبة',
      providerApproval: 'موافقة مقدّم الخدمة مطلوبة',
      cancel: 'إلغاء',
      save: 'تطبيق المراجعة',
      errors: { titleRequired: 'عنوان الطلب مطلوب.' },
      substantialTitle: 'تم تطبيق تعديل جوهري',
      substantialBody:
        'هذه المراجعة جوهرية: أُعيد فتح بوّابة الاكتمال وأُعيد ضبط مؤقّت مستوى خدمة التنفيذ.',
      nonSubstantialTitle: 'تم تطبيق المراجعة',
      nonSubstantialBody:
        'كان هذا تعديلًا طفيفًا — لم تتأثّر بوّابة الاكتمال ولا مؤقّت مستوى الخدمة.',
      reasonsHeading: 'سبب اعتباره جوهريًا',
      reasonLabels: {
        service_changed: 'تغيّرت الخدمة',
        request_type_changed: 'تغيّر نوع الطلب',
        priority_tier_changed: 'تغيّرت فئة الأولوية',
        scope_changed: 'تغيّر النطاق',
        required_item_added: 'أُضيف عنصر مطلوب',
        required_item_removed: 'أُزيل عنصر مطلوب',
        requirement_churn: 'تغيّرت المتطلّبات بشكل كبير',
      },
      close: 'إغلاق',
      toast: 'تم تطبيق المراجعة.',
    },
    clone: {
      clonedFrom: (ref) => `نسخة من ${ref}`,
      continuedAs: (ref) => `استُكمل كـ ${ref}`,
      bothPrefix: 'السلالة',
      viewOrigin: 'عرض الطلب الأصلي',
      viewContinuation: 'عرض طلب الاستكمال',
      refFallback: (id) => `طلب ${id.slice(0, 8)}`,
    },
  },
};

export function resolveDetailExtraLabels(locale: AppLocale = 'en'): DetailExtraLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useDetailExtraLabels(): DetailExtraLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDetailExtraLabels(locale), [locale]);
}
