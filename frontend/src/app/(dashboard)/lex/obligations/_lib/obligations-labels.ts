/**
 * Bilingual (English + Modern Standard Arabic) labels for the Watheeq
 * obligations surface. Follows the canonical lex bilingual contract
 * (`../../_lib/lex-i18n.ts`): a `LexBilingual<T>` bundle with two full,
 * same-shaped copies resolved by {@link useObligationsLabels}.
 *
 * The `en` side MUST equal the pre-existing English strings so existing
 * English-asserting tests stay green; the `ar` side is professional MSA using
 * the suite glossary (التزام / عقد / قضية / تجديد / تذكير / تصعيد).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface ObligationsLabels {
  pageTitle: string;
  pageDescription: string;
  eyebrow: string;
  actions: {
    enqueueReminders: string;
    newObligation: string;
    openActions: string;
    edit: string;
    markCompleted: string;
    reopen: string;
    markReminderSent: string;
    delete: string;
  };
  enqueueResult: {
    title: string;
    description: (queued: number, duplicates: number) => string;
  };
  toasts: {
    statusUpdated: string;
    completed: string;
    reminderSent: string;
    deleted: string;
    created: string;
    updated: string;
  };
  columns: {
    obligation: string;
    status: string;
    priority: string;
    source: string;
    owner: string;
    due: string;
    reminders: string;
    escalation: string;
  };
  cells: {
    contractFallback: string;
    notLinked: string;
    unassigned: string;
    noDueDate: string;
    priorityNone: string;
    enabled: string;
    disabled: string;
    noReminders: string;
    noEscalation: string;
    lastReminder: (when: string) => string;
    defaultLeadTime: string;
    leadDays: (days: string, count: number) => string;
    overdue: (days: number) => string;
    daysUntil: (days: number) => string;
  };
  renewals: {
    title: string;
    description: string;
    loading: string;
    error: string;
    empty: string;
    urgent: (count: number) => string;
    warning: (count: number) => string;
    generated: (when: string) => string;
  };
  renewalItem: {
    unassigned: string;
    noCounterparty: string;
    triggerPrefix: string;
    notSet: string;
    expiryPrefix: string;
    autoRenews: string;
    manualRenewal: string;
  };
  reminderCalendar: {
    title: string;
    description: string;
    loading: string;
    error: string;
    empty: string;
    unassigned: string;
    leadSuffix: (channel: string, leadDays: number) => string;
    duePrefix: (when: string) => string;
  };
  kpis: {
    total: string;
    overdue: string;
    dueThisWeek: string;
    completionRate: string;
    atRisk: string;
    completed: string;
  };
  kpiDetails: {
    total: string;
    overdue: string;
    dueThisWeek: string;
    atRisk: string;
    completed: string;
    completionRate: string;
    obligationShare: string;
    activeQueue: string;
  };
  viewToggle: {
    list: string;
    calendar: string;
    board: string;
    aria: string;
  };
  board: {
    title: string;
    description: string;
    emptyColumn: string;
    statusChanged: string;
  };
  calendar: {
    title: string;
    description: string;
    dueKind: string;
    renewalKind: string;
    dueMeta: (owner: string) => string;
    renewalMeta: (counterparty: string) => string;
    month: string;
    agenda: string;
    prev: string;
    next: string;
    noEvents: string;
    more: (count: string) => string;
    weekdays: readonly string[];
    legendHoliday: string;
    legendWeekend: string;
    legendHijri: string;
  };
  table: {
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  filters: {
    status: string;
    priority: string;
    reminders: string;
    escalation: string;
    options: {
      open: string;
      inProgress: string;
      blocked: string;
      completed: string;
      waived: string;
      cancelled: string;
      critical: string;
      high: string;
      medium: string;
      low: string;
      enabled: string;
      disabled: string;
    };
  };
  enums: {
    types: Record<string, string>;
    statuses: Record<string, string>;
    priorities: Record<string, string>;
    eventTypes: Record<string, string>;
  };
  form: {
    editTitle: string;
    newTitle: string;
    description: string;
    title: string;
    titlePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    type: string;
    status: string;
    priority: string;
    dueDate: string;
    ownerName: string;
    ownerUserId: string;
    contractId: string;
    contractIdPlaceholder: string;
    matterId: string;
    matterIdPlaceholder: string;
    reminders: string;
    remindersHint: string;
    remindersToggleAria: string;
    remindersPlaceholder: string;
    escalation: string;
    escalationHint: string;
    escalationToggleAria: string;
    escalationLeadPlaceholder: string;
    escalationTargetPlaceholder: string;
    escalationTargetLabel: string;
    escalationTargetUnassigned: string;
    ownerSelectPlaceholder: string;
    tags: string;
    tagsPlaceholder: string;
    cancel: string;
    save: string;
    create: string;
  };
  deleteDialog: {
    title: string;
    description: (title: string) => string;
    confirm: string;
  };
}

export const obligationsLabels: LexBilingual<ObligationsLabels> = {
  en: {
    pageTitle: 'Obligations',
    pageDescription:
      'Contract and matter obligations with owners, due dates, reminders, and evidence status.',
    eyebrow: 'Legal Suite',
    actions: {
      enqueueReminders: 'Enqueue Reminders',
      newObligation: 'New Obligation',
      openActions: 'Open obligation actions',
      edit: 'Edit',
      markCompleted: 'Mark completed',
      reopen: 'Reopen',
      markReminderSent: 'Mark reminder sent',
      delete: 'Delete',
    },
    enqueueResult: {
      title: 'Reminder outbox queued.',
      description: (queued, duplicates) =>
        `${queued} queued, ${duplicates} duplicates skipped.`,
    },
    toasts: {
      statusUpdated: 'Obligation status updated.',
      completed: 'Obligation completed.',
      reminderSent: 'Reminder marked sent.',
      deleted: 'Obligation deleted.',
      created: 'Obligation created.',
      updated: 'Obligation updated.',
    },
    columns: {
      obligation: 'Obligation',
      status: 'Status',
      priority: 'Priority',
      source: 'Source',
      owner: 'Owner',
      due: 'Due',
      reminders: 'Reminders',
      escalation: 'Escalation',
    },
    cells: {
      contractFallback: 'Contract',
      notLinked: 'Not linked',
      unassigned: 'Unassigned',
      noDueDate: 'No due date',
      priorityNone: 'None',
      enabled: 'Enabled',
      disabled: 'Disabled',
      noReminders: 'No reminders',
      noEscalation: 'No escalation',
      lastReminder: (when) => `Last ${when}`,
      defaultLeadTime: 'default lead time',
      leadDays: (days, count) => `${days} day${count === 1 ? '' : 's'}`,
      overdue: (days) => `${days} overdue`,
      daysUntil: (days) => `${days} days`,
    },
    renewals: {
      title: 'Renewal Early Warnings',
      description:
        'Contracts whose renewal notice date or expiry lead window falls inside the next 60 days.',
      loading: 'Loading renewal warnings...',
      error: 'Failed to load renewal warnings.',
      empty: 'No renewal warnings are active for the current window.',
      urgent: (count) => `${count} urgent`,
      warning: (count) => `${count} warning`,
      generated: (when) => `Generated ${when}`,
    },
    renewalItem: {
      unassigned: 'Unassigned',
      noCounterparty: 'No counterparty',
      triggerPrefix: 'Trigger',
      notSet: 'not set',
      expiryPrefix: 'Expiry',
      autoRenews: 'Auto-renews',
      manualRenewal: 'Manual renewal',
    },
    reminderCalendar: {
      title: 'Reminder Calendar',
      description: 'Upcoming reminder and escalation events from the backend notification plan.',
      loading: 'Loading reminder plan...',
      error: 'Failed to load reminder plan.',
      empty: 'No upcoming obligation deadlines are available.',
      unassigned: 'Unassigned',
      leadSuffix: (channel, leadDays) => `${channel} • ${leadDays} day lead`,
      duePrefix: (when) => `Due ${when}`,
    },
    kpis: {
      total: 'Total Obligations',
      overdue: 'Overdue',
      dueThisWeek: 'Due This Week',
      completionRate: 'Completion Rate',
      atRisk: 'At Risk',
      completed: 'Completed',
    },
    kpiDetails: {
      total: 'Loaded obligation register for the current portfolio.',
      overdue: 'Open obligations already past due.',
      dueThisWeek: 'Open obligations aging or stale this week.',
      atRisk: 'Overdue or stale obligations requiring attention.',
      completed: 'Obligations closed as completed.',
      completionRate: 'Completed share of the loaded register.',
      obligationShare: 'Obligation share',
      activeQueue: 'Active queue',
    },
    viewToggle: {
      list: 'List',
      calendar: 'Calendar',
      board: 'Board',
      aria: 'Obligations view',
    },
    board: {
      title: 'Obligation Board',
      description: 'Drag an obligation between columns to update its status.',
      emptyColumn: 'No obligations',
      statusChanged: 'Obligation status updated.',
    },
    calendar: {
      title: 'Obligation Calendar',
      description: 'Obligation due dates and contract renewal triggers, color-coded by severity, with Hijri dates and KSA holidays.',
      dueKind: 'Due',
      renewalKind: 'Renewal',
      dueMeta: (owner) => `Owner: ${owner}`,
      renewalMeta: (counterparty) => `Counterparty: ${counterparty}`,
      month: 'Month',
      agenda: 'Agenda',
      prev: 'Previous month',
      next: 'Next month',
      noEvents: 'No events scheduled',
      more: (count) => `+${count} more`,
      weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      legendHoliday: 'KSA holiday',
      legendWeekend: 'Weekend (Fri–Sat)',
      legendHijri: 'Hijri (Umm al-Qura)',
    },
    table: {
      searchPlaceholder: 'Search obligations...',
      emptyTitle: 'No obligations found',
      emptyDescription: 'No obligations matched the current filters.',
    },
    filters: {
      status: 'Status',
      priority: 'Priority',
      reminders: 'Reminders',
      escalation: 'Escalation',
      options: {
        open: 'Open',
        inProgress: 'In Progress',
        blocked: 'Blocked',
        completed: 'Completed',
        waived: 'Waived',
        cancelled: 'Cancelled',
        critical: 'Critical',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
        enabled: 'Enabled',
        disabled: 'Disabled',
      },
    },
    enums: {
      types: {
        contractual: 'contractual',
        renewal: 'renewal',
        notice: 'notice',
        payment: 'payment',
        delivery: 'delivery',
        reporting: 'reporting',
        compliance: 'compliance',
        covenant: 'covenant',
        condition_precedent: 'condition precedent',
        regulatory: 'regulatory',
        other: 'other',
      },
      statuses: {
        open: 'open',
        in_progress: 'in progress',
        blocked: 'blocked',
        completed: 'completed',
        waived: 'waived',
        cancelled: 'cancelled',
      },
      priorities: {
        critical: 'critical',
        high: 'high',
        medium: 'medium',
        low: 'low',
      },
      eventTypes: {
        reminder: 'reminder',
        escalation: 'escalation',
      },
    },
    form: {
      editTitle: 'Edit Obligation',
      newTitle: 'New Obligation',
      description: 'Capture owner, source link, due date, reminder, and escalation details.',
      title: 'Title',
      titlePlaceholder: 'Submit updated insurance certificate',
      descriptionLabel: 'Description',
      descriptionPlaceholder: 'Counterparty must provide evidence before renewal.',
      type: 'Type',
      status: 'Status',
      priority: 'Priority',
      dueDate: 'Due date',
      ownerName: 'Owner name',
      ownerUserId: 'Owner user ID',
      contractId: 'Contract',
      contractIdPlaceholder: 'Search contracts (optional)',
      matterId: 'Matter',
      matterIdPlaceholder: 'Search matters (optional)',
      reminders: 'Reminders',
      remindersHint: 'Lead days are comma-separated.',
      remindersToggleAria: 'Toggle reminders',
      remindersPlaceholder: '30, 7, 1',
      escalation: 'Escalation',
      escalationHint: 'Escalates to the configured target.',
      escalationToggleAria: 'Toggle escalation',
      escalationLeadPlaceholder: '7, 1',
      escalationTargetPlaceholder: 'legal-ops@example.com',
      escalationTargetLabel: 'Escalation target',
      escalationTargetUnassigned: 'No escalation target',
      ownerSelectPlaceholder: 'Select owner',
      tags: 'Tags',
      tagsPlaceholder: 'renewal, compliance',
      cancel: 'Cancel',
      save: 'Save changes',
      create: 'Create obligation',
    },
    deleteDialog: {
      title: 'Delete obligation',
      description: (title) =>
        `Delete "${title}"? This removes the obligation from the active register.`,
      confirm: 'Delete',
    },
  },
  ar: {
    pageTitle: 'الالتزامات',
    pageDescription:
      'التزامات العقود والقضايا مع المسؤولين وتواريخ الاستحقاق والتذكيرات وحالة الأدلة.',
    eyebrow: 'المجموعة القانونية',
    actions: {
      enqueueReminders: 'جدولة التذكيرات',
      newObligation: 'التزام جديد',
      openActions: 'فتح إجراءات الالتزام',
      edit: 'تعديل',
      markCompleted: 'وضع علامة مكتمل',
      reopen: 'إعادة فتح',
      markReminderSent: 'وضع علامة تذكير مُرسَل',
      delete: 'حذف',
    },
    enqueueResult: {
      title: 'تمت جدولة صندوق التذكيرات.',
      description: (queued, duplicates) =>
        `${queued} في قائمة الانتظار، وتم تخطي ${duplicates} مكرّر.`,
    },
    toasts: {
      statusUpdated: 'تم تحديث حالة الالتزام.',
      completed: 'اكتمل الالتزام.',
      reminderSent: 'تم وضع علامة إرسال التذكير.',
      deleted: 'تم حذف الالتزام.',
      created: 'تم إنشاء الالتزام.',
      updated: 'تم تحديث الالتزام.',
    },
    columns: {
      obligation: 'الالتزام',
      status: 'الحالة',
      priority: 'الأولوية',
      source: 'المصدر',
      owner: 'المسؤول',
      due: 'الاستحقاق',
      reminders: 'التذكيرات',
      escalation: 'التصعيد',
    },
    cells: {
      contractFallback: 'عقد',
      notLinked: 'غير مرتبط',
      unassigned: 'غير مُسند',
      noDueDate: 'بلا تاريخ استحقاق',
      priorityNone: 'لا شيء',
      enabled: 'مُفعَّل',
      disabled: 'مُعطَّل',
      noReminders: 'لا توجد تذكيرات',
      noEscalation: 'لا يوجد تصعيد',
      lastReminder: (when) => `آخرها ${when}`,
      defaultLeadTime: 'مهلة افتراضية',
      // `_count` matches the en arity; Arabic uses the invariant counted-noun
      // form (تمييز), so the value is intentionally not pluralized.
      leadDays: (days, _count) => `${days} يومًا`,
      overdue: (days) => `${days} متأخر`,
      daysUntil: (days) => `${days} يومًا`,
    },
    renewals: {
      title: 'تنبيهات التجديد المبكرة',
      description:
        'العقود التي يقع تاريخ إشعار تجديدها أو نافذة مهلة انتهائها ضمن الستين يومًا القادمة.',
      loading: 'جارٍ تحميل تنبيهات التجديد...',
      error: 'تعذّر تحميل تنبيهات التجديد.',
      empty: 'لا توجد تنبيهات تجديد نشطة للنافذة الحالية.',
      urgent: (count) => `${count} عاجل`,
      warning: (count) => `${count} تحذير`,
      generated: (when) => `أُنشئت ${when}`,
    },
    renewalItem: {
      unassigned: 'غير مُسند',
      noCounterparty: 'لا يوجد طرف مقابل',
      triggerPrefix: 'المُحفِّز',
      notSet: 'غير محدد',
      expiryPrefix: 'الانتهاء',
      autoRenews: 'تجديد تلقائي',
      manualRenewal: 'تجديد يدوي',
    },
    reminderCalendar: {
      title: 'تقويم التذكيرات',
      description: 'أحداث التذكير والتصعيد القادمة من خطة الإشعارات في الخادم.',
      loading: 'جارٍ تحميل خطة التذكيرات...',
      error: 'تعذّر تحميل خطة التذكيرات.',
      empty: 'لا توجد مواعيد استحقاق التزامات قادمة متاحة.',
      unassigned: 'غير مُسند',
      leadSuffix: (channel, leadDays) => `${channel} • مهلة ${leadDays} يومًا`,
      duePrefix: (when) => `يُستحق ${when}`,
    },
    kpis: {
      total: 'إجمالي الالتزامات',
      overdue: 'متأخرة',
      dueThisWeek: 'مستحقة هذا الأسبوع',
      completionRate: 'معدل الإنجاز',
      atRisk: 'معرّضة للخطر',
      completed: 'مكتملة',
    },
    kpiDetails: {
      total: 'سجل الالتزامات المحمّل للمحفظة الحالية.',
      overdue: 'التزامات مفتوحة تجاوزت تاريخ الاستحقاق.',
      dueThisWeek: 'التزامات مفتوحة بدأت تتقادم أو تأخرت هذا الأسبوع.',
      atRisk: 'التزامات متأخرة أو راكدة تتطلب انتباهًا.',
      completed: 'التزامات أُغلقت كمكتملة.',
      completionRate: 'حصة المكتمل من السجل المحمّل.',
      obligationShare: 'حصة الالتزامات',
      activeQueue: 'القائمة النشطة',
    },
    viewToggle: {
      list: 'قائمة',
      calendar: 'تقويم',
      board: 'لوحة',
      aria: 'عرض الالتزامات',
    },
    board: {
      title: 'لوحة الالتزامات',
      description: 'اسحب الالتزام بين الأعمدة لتحديث حالته.',
      emptyColumn: 'لا توجد التزامات',
      statusChanged: 'تم تحديث حالة الالتزام.',
    },
    calendar: {
      title: 'تقويم الالتزامات',
      description: 'تواريخ استحقاق الالتزامات ومُحفِّزات تجديد العقود، مُرمَّزة بالألوان حسب الخطورة، مع التواريخ الهجرية والعطل الرسمية السعودية.',
      dueKind: 'استحقاق',
      renewalKind: 'تجديد',
      dueMeta: (owner) => `المسؤول: ${owner}`,
      renewalMeta: (counterparty) => `الطرف المقابل: ${counterparty}`,
      month: 'شهر',
      agenda: 'قائمة',
      prev: 'الشهر السابق',
      next: 'الشهر التالي',
      noEvents: 'لا توجد أحداث مجدولة',
      more: (count) => `+${count} المزيد`,
      weekdays: ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'],
      legendHoliday: 'عطلة رسمية سعودية',
      legendWeekend: 'عطلة نهاية الأسبوع (الجمعة–السبت)',
      legendHijri: 'هجري (أم القرى)',
    },
    table: {
      searchPlaceholder: 'البحث في الالتزامات...',
      emptyTitle: 'لا توجد التزامات',
      emptyDescription: 'لا توجد التزامات مطابقة للمرشّحات الحالية.',
    },
    filters: {
      status: 'الحالة',
      priority: 'الأولوية',
      reminders: 'التذكيرات',
      escalation: 'التصعيد',
      options: {
        open: 'مفتوح',
        inProgress: 'قيد التنفيذ',
        blocked: 'مُعطَّل',
        completed: 'مكتمل',
        waived: 'مُتنازَل عنه',
        cancelled: 'ملغى',
        critical: 'حرج',
        high: 'مرتفع',
        medium: 'متوسط',
        low: 'منخفض',
        enabled: 'مُفعَّل',
        disabled: 'مُعطَّل',
      },
    },
    enums: {
      types: {
        contractual: 'تعاقدي',
        renewal: 'تجديد',
        notice: 'إشعار',
        payment: 'دفع',
        delivery: 'تسليم',
        reporting: 'إبلاغ',
        compliance: 'امتثال',
        covenant: 'تعهد',
        condition_precedent: 'شرط مسبق',
        regulatory: 'تنظيمي',
        other: 'أخرى',
      },
      statuses: {
        open: 'مفتوح',
        in_progress: 'قيد التنفيذ',
        blocked: 'مُعطَّل',
        completed: 'مكتمل',
        waived: 'مُتنازَل عنه',
        cancelled: 'ملغى',
      },
      priorities: {
        critical: 'حرج',
        high: 'مرتفع',
        medium: 'متوسط',
        low: 'منخفض',
      },
      eventTypes: {
        reminder: 'تذكير',
        escalation: 'تصعيد',
      },
    },
    form: {
      editTitle: 'تعديل الالتزام',
      newTitle: 'التزام جديد',
      description: 'سجّل المسؤول ورابط المصدر وتاريخ الاستحقاق وتفاصيل التذكير والتصعيد.',
      title: 'العنوان',
      titlePlaceholder: 'تقديم شهادة تأمين محدَّثة',
      descriptionLabel: 'الوصف',
      descriptionPlaceholder: 'يجب أن يقدّم الطرف المقابل الأدلة قبل التجديد.',
      type: 'النوع',
      status: 'الحالة',
      priority: 'الأولوية',
      dueDate: 'تاريخ الاستحقاق',
      ownerName: 'اسم المسؤول',
      ownerUserId: 'معرّف مستخدم المسؤول',
      contractId: 'العقد',
      contractIdPlaceholder: 'ابحث في العقود (اختياري)',
      matterId: 'القضية',
      matterIdPlaceholder: 'ابحث في القضايا (اختياري)',
      reminders: 'التذكيرات',
      remindersHint: 'أيام المهلة مفصولة بفواصل.',
      remindersToggleAria: 'تبديل التذكيرات',
      remindersPlaceholder: '30، 7، 1',
      escalation: 'التصعيد',
      escalationHint: 'يُصعَّد إلى الجهة المُهيّأة.',
      escalationToggleAria: 'تبديل التصعيد',
      escalationLeadPlaceholder: '7، 1',
      escalationTargetPlaceholder: 'legal-ops@example.com',
      escalationTargetLabel: 'جهة التصعيد',
      escalationTargetUnassigned: 'لا توجد جهة تصعيد',
      ownerSelectPlaceholder: 'اختر المسؤول',
      tags: 'الوسوم',
      tagsPlaceholder: 'تجديد، امتثال',
      cancel: 'إلغاء',
      save: 'حفظ التغييرات',
      create: 'إنشاء الالتزام',
    },
    deleteDialog: {
      title: 'حذف الالتزام',
      description: (title) => `حذف "${title}"؟ هذا يزيل الالتزام من السجل النشط.`,
      confirm: 'حذف',
    },
  },
};

/**
 * Calendar-cell label slice consumed by the domain-local
 * {@link ObligationsCalendar} (weekday headers, nav, Hijri/holiday legend, etc.).
 * It is exactly the `calendar` sub-bundle so the calendar imports one shape.
 */
export type ObligationsCalendarLabels = ObligationsLabels['calendar'];

export function useObligationsLabels(): ObligationsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(obligationsLabels, locale), [locale]);
}

/**
 * resolveObligationsLabels is the pure resolver for non-React callers/tests.
 */
export function resolveObligationsLabels(locale: AppLocale = 'en'): ObligationsLabels {
  return resolveLexBilingual(obligationsLabels, locale === 'ar' ? 'ar' : 'en');
}
