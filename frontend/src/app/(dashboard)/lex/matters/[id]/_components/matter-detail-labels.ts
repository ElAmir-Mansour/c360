'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) label bundles for the
 * revamped Matters *detail* surface (hero toolbar, "what needs you now" action
 * bar, lifecycle stepper, and the sticky right-rail cards: people, key facts,
 * related, recent activity, SLA ribbon).
 *
 * Follows the canonical lex i18n contract (`../../../_lib/lex-i18n`): every label
 * group is a `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped
 * copies, and each is exposed through a thin `use<Group>Labels()` hook resolving
 * to the active locale. Components only ever touch the resolved `T`. Western
 * digits + interpolation placeholders are preserved across both locales. Legal
 * glossary: قضية (matter) / التزام (obligation) / عقد (contract) / مستند
 * (document) / المهلة (SLA) / سجل النشاط (activity log).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

/* ========================================================================= *
 * Detail tabs.
 * ========================================================================= */

export interface MatterDetailTabLabels {
  overview: string;
  obligations: string;
  timeline: string;
  documents: string;
  related: string;
  activity: string;
  discussion: string;
}

const tabsBundle: LexBilingual<MatterDetailTabLabels> = {
  en: {
    overview: 'Overview',
    obligations: 'Obligations',
    timeline: 'Timeline',
    documents: 'Documents',
    related: 'Related',
    activity: 'Activity',
    discussion: 'Discussion',
  },
  ar: {
    overview: 'نظرة عامة',
    obligations: 'الالتزامات',
    timeline: 'الجدول الزمني',
    documents: 'المستندات',
    related: 'العناصر المرتبطة',
    activity: 'النشاط',
    discussion: 'النقاش',
  },
};

export function useMatterDetailTabLabels(): MatterDetailTabLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(tabsBundle, locale), [locale]);
}

/* ========================================================================= *
 * Navigation & shareability toolbar (copy #, copy link, prev/next).
 * ========================================================================= */

export interface MatterToolbarNavLabels {
  copyNumber: string;
  copyNumberAria: (matterNumber: string) => string;
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
}

const toolbarNavBundle: LexBilingual<MatterToolbarNavLabels> = {
  en: {
    copyNumber: 'Copy matter number',
    copyNumberAria: (matterNumber) => `Copy matter number ${matterNumber}`,
    copyNumberCopiedAria: 'Matter number copied',
    copyLink: 'Copy link',
    copyLinkAria: 'Copy link to this matter',
    copyLinkCopiedAria: 'Link copied',
    copied: 'Copied',
    prev: 'Previous matter',
    prevAria: 'Go to previous matter (shortcut: k)',
    prevDisabledAria: 'No previous matter on this page',
    next: 'Next matter',
    nextAria: 'Go to next matter (shortcut: j)',
    nextDisabledAria: 'No next matter on this page',
  },
  ar: {
    copyNumber: 'نسخ رقم القضية',
    copyNumberAria: (matterNumber) => `نسخ رقم القضية ${matterNumber}`,
    copyNumberCopiedAria: 'تم نسخ رقم القضية',
    copyLink: 'نسخ الرابط',
    copyLinkAria: 'نسخ رابط هذه القضية',
    copyLinkCopiedAria: 'تم نسخ الرابط',
    copied: 'تم النسخ',
    prev: 'القضية السابقة',
    prevAria: 'الانتقال إلى القضية السابقة (اختصار: k)',
    prevDisabledAria: 'لا توجد قضية سابقة في هذه الصفحة',
    next: 'القضية التالية',
    nextAria: 'الانتقال إلى القضية التالية (اختصار: j)',
    nextDisabledAria: 'لا توجد قضية تالية في هذه الصفحة',
  },
};

export function useMatterToolbarNavLabels(): MatterToolbarNavLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(toolbarNavBundle, locale), [locale]);
}

/* ========================================================================= *
 * "What needs you now" action bar.
 * ========================================================================= */

export interface MatterActionBarLabels {
  heading: string;
  readOnly: string;
  triage: string;
  changeStatus: string;
  resume: string;
  intakeHint: string;
  openHint: string;
  inReviewHint: string;
  waitingHint: string;
  onHoldHint: string;
  closedHint: string;
  cancelledHint: string;
  genericHint: string;
  /** Urgent line for an at-risk matter, e.g. "Breached · 3d overdue". */
  riskHint: (tier: string, timing: string) => string;
  riskAction: string;
}

const actionBarBundle: LexBilingual<MatterActionBarLabels> = {
  en: {
    heading: 'What needs you now',
    readOnly: 'You have read-only access to this matter.',
    triage: 'Triage',
    changeStatus: 'Change status',
    resume: 'Resume',
    intakeHint: 'Triage this matter to assign an owner, set priority, and start work.',
    openHint: 'Move the matter into review once substantive work begins.',
    inReviewHint: 'Record the review outcome and advance the matter when it completes.',
    waitingHint: 'Awaiting a response from the business — update the status once it lands.',
    onHoldHint: 'This matter is on hold. Resume it when work can continue.',
    closedHint: 'This matter is closed. Reopen it from Change status if it needs more work.',
    cancelledHint: 'This matter was cancelled.',
    genericHint: 'This matter advances through its lifecycle as work progresses.',
    riskHint: (tier, timing) => `${tier} · ${timing} — triage now to recover the deadline.`,
    riskAction: 'Triage now',
  },
  ar: {
    heading: 'ما الذي يتطلّب انتباهك الآن',
    readOnly: 'لديك صلاحية اطّلاع فقط على هذه القضية.',
    triage: 'فرز',
    changeStatus: 'تغيير الحالة',
    resume: 'استئناف',
    intakeHint: 'افرز هذه القضية لإسناد مسؤول وتحديد الأولوية وبدء العمل.',
    openHint: 'انقل القضية إلى المراجعة عند بدء العمل الفعلي.',
    inReviewHint: 'سجّل نتيجة المراجعة وانقل القضية إلى المرحلة التالية عند اكتمالها.',
    waitingHint: 'بانتظار رد من جهة العمل — حدّث الحالة فور وروده.',
    onHoldHint: 'هذه القضية معلّقة. استأنفها عندما يمكن متابعة العمل.',
    closedHint: 'هذه القضية مغلقة. أعد فتحها من "تغيير الحالة" إذا لزم مزيد من العمل.',
    cancelledHint: 'تم إلغاء هذه القضية.',
    genericHint: 'تتقدّم هذه القضية عبر دورة حياتها مع تقدّم العمل.',
    riskHint: (tier, timing) => `${tier} · ${timing} — افرزها الآن لاستدراك الموعد.`,
    riskAction: 'افرز الآن',
  },
};

export function useMatterActionBarLabels(): MatterActionBarLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(actionBarBundle, locale), [locale]);
}

/* ========================================================================= *
 * Lifecycle stepper.
 * ========================================================================= */

export interface MatterStepperTimingUnits {
  day: string;
  days: string;
  hour: string;
  hours: string;
  minute: string;
  minutes: string;
  lessThanMinute: string;
}

export interface MatterStepperLabels {
  title: string;
  steps: { intake: string; open: string; in_review: string; closed: string };
  terminalOnHold: string;
  terminalCancelled: string;
  terminalHint: string;
  entered: (relative: string) => string;
  enteredOn: (date: string) => string;
  timeInStage: (duration: string) => string;
  units: MatterStepperTimingUnits;
}

const stepperBundle: LexBilingual<MatterStepperLabels> = {
  en: {
    title: 'Lifecycle',
    steps: { intake: 'Intake', open: 'Open', in_review: 'In review', closed: 'Closed' },
    terminalOnHold: 'On hold',
    terminalCancelled: 'Cancelled',
    terminalHint: 'This matter is off the standard lifecycle path.',
    entered: (relative) => `entered ${relative}`,
    enteredOn: (date) => `Entered ${date}`,
    timeInStage: (duration) => `Time in stage: ${duration}`,
    units: {
      day: 'day',
      days: 'days',
      hour: 'hour',
      hours: 'hours',
      minute: 'minute',
      minutes: 'minutes',
      lessThanMinute: 'less than a minute',
    },
  },
  ar: {
    title: 'دورة الحياة',
    steps: { intake: 'استقبال', open: 'مفتوحة', in_review: 'قيد المراجعة', closed: 'مغلقة' },
    terminalOnHold: 'معلّقة',
    terminalCancelled: 'ملغاة',
    terminalHint: 'هذه القضية خارج المسار المعتاد لدورة الحياة.',
    entered: (relative) => `دخلت ${relative}`,
    enteredOn: (date) => `دخلت في ${date}`,
    timeInStage: (duration) => `المدة في المرحلة: ${duration}`,
    units: {
      day: 'يوم',
      days: 'أيام',
      hour: 'ساعة',
      hours: 'ساعات',
      minute: 'دقيقة',
      minutes: 'دقائق',
      lessThanMinute: 'أقل من دقيقة',
    },
  },
};

export function useMatterStepperLabels(): MatterStepperLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(stepperBundle, locale), [locale]);
}

/* ========================================================================= *
 * Right rail — People card.
 * ========================================================================= */

export interface MatterPeopleCardLabels {
  title: string;
  owner: string;
  requester: string;
  ownerUnassigned: string;
  requesterUnknown: string;
  department: string;
  copyId: string;
  copied: string;
  createdBy: (name: string) => string;
}

const peopleCardBundle: LexBilingual<MatterPeopleCardLabels> = {
  en: {
    title: 'People',
    owner: 'Owner',
    requester: 'Requester',
    ownerUnassigned: 'Unassigned',
    requesterUnknown: 'No requester captured',
    department: 'Department',
    copyId: 'Copy ID',
    copied: 'ID copied',
    createdBy: (name) => `Created by ${name}`,
  },
  ar: {
    title: 'الأشخاص',
    owner: 'المسؤول',
    requester: 'مقدّم الطلب',
    ownerUnassigned: 'غير مُسنَد',
    requesterUnknown: 'لم يُسجَّل مقدّم طلب',
    department: 'الإدارة',
    copyId: 'نسخ المعرّف',
    copied: 'تم نسخ المعرّف',
    createdBy: (name) => `أُنشئ بواسطة ${name}`,
  },
};

export function useMatterPeopleCardLabels(): MatterPeopleCardLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(peopleCardBundle, locale), [locale]);
}

/* ========================================================================= *
 * Right rail — Key facts card.
 * ========================================================================= */

export interface MatterKeyFactsLabels {
  title: string;
  opened: string;
  due: string;
  closed: string;
  department: string;
  tags: string;
  noDueDate: string;
  notSet: string;
  noTags: string;
}

const keyFactsBundle: LexBilingual<MatterKeyFactsLabels> = {
  en: {
    title: 'Key facts',
    opened: 'Opened',
    due: 'Due date',
    closed: 'Closed',
    department: 'Department',
    tags: 'Tags',
    noDueDate: 'No due date',
    notSet: 'Not set',
    noTags: 'No tags',
  },
  ar: {
    title: 'حقائق أساسية',
    opened: 'تاريخ الفتح',
    due: 'تاريخ الاستحقاق',
    closed: 'تاريخ الإغلاق',
    department: 'الإدارة',
    tags: 'الوسوم',
    noDueDate: 'بلا تاريخ استحقاق',
    notSet: 'غير محدد',
    noTags: 'لا توجد وسوم',
  },
};

export function useMatterKeyFactsLabels(): MatterKeyFactsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(keyFactsBundle, locale), [locale]);
}

/* ========================================================================= *
 * Right rail — SLA ribbon (chrome only; tier names + timing come from the
 * shared matter-sla `useMatterSlaLabels`).
 * ========================================================================= */

export interface MatterSlaRibbonLabels {
  eyebrow: string;
  duePrefix: string;
  overduePrefix: string;
  noWindowTitle: string;
  noWindowBody: string;
}

const slaRibbonBundle: LexBilingual<MatterSlaRibbonLabels> = {
  en: {
    eyebrow: 'SLA',
    duePrefix: 'Due',
    overduePrefix: 'Overdue',
    noWindowTitle: 'No SLA window',
    noWindowBody: 'This matter has no due date, so no SLA clock is running.',
  },
  ar: {
    eyebrow: 'المهلة',
    duePrefix: 'يستحق',
    overduePrefix: 'متأخر',
    noWindowTitle: 'لا توجد مهلة',
    noWindowBody: 'لا يوجد تاريخ استحقاق لهذه القضية، لذا لا تعمل ساعة المهلة.',
  },
};

export function useMatterSlaRibbonLabels(): MatterSlaRibbonLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(slaRibbonBundle, locale), [locale]);
}

/* ========================================================================= *
 * Right rail — Related records card.
 * ========================================================================= */

export interface MatterRelatedCardLabels {
  title: string;
  description: string;
  contractsHeading: string;
  contractsCounter: (count: number) => string;
  relatedHeading: string;
  documentsHeading: string;
  documentsLoading: string;
  emptyAll: string;
  openAria: string;
  targetTypeLabels: Record<string, string>;
}

const relatedCardBundle: LexBilingual<MatterRelatedCardLabels> = {
  en: {
    title: 'Related records',
    description: 'Everything this matter connects to across the legal suite.',
    contractsHeading: 'Linked contracts',
    contractsCounter: (count) => `${count} linked`,
    relatedHeading: 'Related items',
    documentsHeading: 'Documents',
    documentsLoading: 'Loading documents',
    emptyAll: 'Nothing is linked to this matter yet.',
    openAria: 'Open linked record',
    targetTypeLabels: {
      consultation: 'Consultation',
      investigation: 'Investigation',
      legal_case: 'Case',
      settlement: 'Settlement',
      litigation: 'Case',
      contract: 'Contract',
    },
  },
  ar: {
    title: 'السجلات المرتبطة',
    description: 'كل ما ترتبط به هذه القضية عبر المجموعة القانونية.',
    contractsHeading: 'العقود المرتبطة',
    contractsCounter: (count) => `${count} مرتبط`,
    relatedHeading: 'العناصر المرتبطة',
    documentsHeading: 'المستندات',
    documentsLoading: 'جارٍ تحميل المستندات',
    emptyAll: 'لا يوجد أي عنصر مرتبط بهذه القضية بعد.',
    openAria: 'فتح السجل المرتبط',
    targetTypeLabels: {
      consultation: 'استشارة',
      investigation: 'تحقيق',
      legal_case: 'قضية',
      settlement: 'تسوية',
      litigation: 'قضية',
      contract: 'عقد',
    },
  },
};

export function useMatterRelatedCardLabels(): MatterRelatedCardLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(relatedCardBundle, locale), [locale]);
}

/* ========================================================================= *
 * Right rail — Recent activity mini-feed.
 * ========================================================================= */

export interface MatterActivityMiniLabels {
  title: string;
  viewAll: string;
  empty: string;
  loadError: string;
  actorPrefix: (actor: string) => string;
  statusSet: (to: string) => string;
}

const activityMiniBundle: LexBilingual<MatterActivityMiniLabels> = {
  en: {
    title: 'Recent activity',
    viewAll: 'View all activity',
    empty: 'No recorded activity yet',
    loadError: 'Activity could not be loaded',
    actorPrefix: (actor) => `by ${actor}`,
    statusSet: (to) => `Status set to ${to}`,
  },
  ar: {
    title: 'أحدث النشاط',
    viewAll: 'عرض كل النشاط',
    empty: 'لا يوجد نشاط مُسجَّل بعد',
    loadError: 'تعذّر تحميل النشاط',
    actorPrefix: (actor) => `بواسطة ${actor}`,
    statusSet: (to) => `تعيين الحالة إلى ${to}`,
  },
};

export function useMatterActivityMiniLabels(): MatterActivityMiniLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(activityMiniBundle, locale), [locale]);
}
