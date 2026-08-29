/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Legal-Affairs Admin console (`/lex/admin` + its sub-areas).
 *
 * Follows the canonical lex bilingual contract VERBATIM (see
 * `../../_lib/lex-i18n.ts`): every label group is a `LexBilingual<T> = { en, ar }`
 * bundle with two FULL, same-shaped copies — `en` is the exact English copy, `ar`
 * is professional MSA. Function-valued and nested fields appear on BOTH sides and
 * preserve interpolation + Western digits. JSX only ever touches the resolved `T`
 * returned by the memoized `use*Labels()` hooks.
 *
 * Glossary: calendar = تقويم, holiday = عطلة, working hours = ساعات العمل,
 * Ramadan = رمضان, service = خدمة, catalog = الكتالوج, eligibility = الأهلية,
 * SLA = اتفاقية مستوى الخدمة, attachment = مرفق, policy = سياسة,
 * org entity = جهة تنظيمية, role = دور, escalation = تصعيد,
 * classification = تصنيف, taxonomy = التصنيف الهرمي.
 */
'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ========================================================================= *
 * Admin landing (`/lex/admin`)
 * ========================================================================= */

export interface AdminHomeLabels {
  pageTitle: string;
  pageDescription: string;
  eyebrow: string;
  readOnlyNotice: string;
  cards: {
    calendars: { title: string; description: string };
    services: { title: string; description: string };
    sla: { title: string; description: string };
    attachments: { title: string; description: string };
    orgEntities: { title: string; description: string };
    classifications: { title: string; description: string };
    integrations: { title: string; description: string };
    roleMatrix: { title: string; description: string };
  };
  open: string;
}

const adminHomeBundle: LexBilingual<AdminHomeLabels> = {
  en: {
    pageTitle: 'Legal Affairs Administration',
    pageDescription: 'Configure the master data behind legal-affairs intake, SLAs, and case handling.',
    eyebrow: 'Legal Suite · Administration',
    readOnlyNotice: 'You have read-only access. Editing requires the lex:write permission.',
    cards: {
      calendars: {
        title: 'Working Calendars',
        description: 'Weekly working hours, Ramadan overlay, and official holidays.',
      },
      services: {
        title: 'Service Catalog',
        description: 'Published legal services, eligibility, and intake channels.',
      },
      sla: {
        title: 'SLA Targets',
        description: 'Turnaround and acknowledgement targets per service and priority.',
      },
      attachments: {
        title: 'Attachment Policies',
        description: 'Required documents and upload slots per request type.',
      },
      orgEntities: {
        title: 'Org Registry',
        description: 'Legal-org entities, escalation roles, and master data.',
      },
      classifications: {
        title: 'Case Classifications',
        description: 'The extensible case-classification taxonomy tree.',
      },
      integrations: {
        title: 'Integrations',
        description: 'Connectors, sync runs, and the integration health console.',
      },
      roleMatrix: {
        title: 'Legal Role Matrix',
        description: 'The 14 legal roles mapped to every capability — view-only access model.',
      },
    },
    open: 'Open',
  },
  ar: {
    pageTitle: 'إدارة الشؤون القانونية',
    pageDescription: 'إعداد البيانات الرئيسية التي تقوم عليها استقبال الطلبات القانونية واتفاقيات الخدمة ومعالجة القضايا.',
    eyebrow: 'المجموعة القانونية · الإدارة',
    readOnlyNotice: 'لديك صلاحية الاطّلاع فقط. يتطلّب التعديل صلاحية lex:write.',
    cards: {
      calendars: {
        title: 'تقاويم العمل',
        description: 'ساعات العمل الأسبوعية وتراكب رمضان والعطلات الرسمية.',
      },
      services: {
        title: 'كتالوج الخدمات',
        description: 'الخدمات القانونية المنشورة والأهلية وقنوات الاستقبال.',
      },
      sla: {
        title: 'أهداف اتفاقية مستوى الخدمة',
        description: 'أهداف الإنجاز والإقرار لكل خدمة وأولوية.',
      },
      attachments: {
        title: 'سياسات المرفقات',
        description: 'المستندات المطلوبة وخانات الرفع لكل نوع طلب.',
      },
      orgEntities: {
        title: 'السجل التنظيمي',
        description: 'الجهات التنظيمية القانونية وأدوار التصعيد والبيانات الرئيسية.',
      },
      classifications: {
        title: 'تصنيفات القضايا',
        description: 'شجرة التصنيف الهرمي القابلة للتوسعة للقضايا.',
      },
      integrations: {
        title: 'التكاملات',
        description: 'الموصّلات وعمليات المزامنة ولوحة صحة التكامل.',
      },
      roleMatrix: {
        title: 'مصفوفة الأدوار القانونية',
        description: 'الأدوار القانونية الأربعة عشر مرتبطة بكل قدرة — نموذج وصول للقراءة فقط.',
      },
    },
    open: 'فتح',
  },
};

export function useAdminHomeLabels(): AdminHomeLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(adminHomeBundle, locale), [locale]);
}

/* ========================================================================= *
 * Admin health / configuration linter dashboard
 * ========================================================================= */

export interface AdminHealthLabels {
  kpiIssues: string;
  kpiCritical: string;
  kpiWarnings: string;
  kpiHealthy: string;
  linterTitle: string;
  linterDescription: string;
  healthy: string;
  findings: (n: number) => string;
  noIssues: string;
  open: string;
  severity: Record<'critical' | 'warning' | 'info', string>;
  more: (n: number) => string;
  scanned: (at: string) => string;
}

const adminHealthBundle: LexBilingual<AdminHealthLabels> = {
  en: {
    kpiIssues: 'Configuration issues',
    kpiCritical: 'Critical',
    kpiWarnings: 'Warnings',
    kpiHealthy: 'Healthy areas',
    linterTitle: 'Configuration linter',
    linterDescription: 'Live cross-checks across calendars, services, SLAs, attachments, org, and classifications.',
    healthy: 'Healthy',
    findings: (n) => (n === 1 ? '1 finding' : `${n} findings`),
    noIssues: 'No admin configuration issues found in the sampled records.',
    open: 'Open',
    severity: { critical: 'Critical', warning: 'Warning', info: 'Info' },
    more: (n) => `+${n} more findings`,
    scanned: (at) => `Scanned ${at}`,
  },
  ar: {
    kpiIssues: 'مشكلات الإعداد',
    kpiCritical: 'حرجة',
    kpiWarnings: 'تحذيرات',
    kpiHealthy: 'مناطق سليمة',
    linterTitle: 'مدقّق الإعداد',
    linterDescription: 'فحوصات حيّة عبر التقاويم والخدمات واتفاقيات الخدمة والمرفقات والسجل التنظيمي والتصنيفات.',
    healthy: 'سليم',
    findings: (n) => (n === 1 ? 'نتيجة واحدة' : `${n} نتائج`),
    noIssues: 'لم يُعثر على أي مشكلات في إعدادات الإدارة ضمن السجلات المفحوصة.',
    open: 'فتح',
    severity: { critical: 'حرجة', warning: 'تحذير', info: 'معلومة' },
    more: (n) => `+${n} نتائج إضافية`,
    scanned: (at) => `فُحص ${at}`,
  },
};

export function useAdminHealthLabels(): AdminHealthLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(adminHealthBundle, locale), [locale]);
}

/* ========================================================================= *
 * Shared admin chrome (actions / toasts / confirm)
 * ========================================================================= */

export interface AdminCommonLabels {
  create: string;
  edit: string;
  delete: string;
  cancel: string;
  save: string;
  add: string;
  remove: string;
  active: string;
  inactive: string;
  yes: string;
  no: string;
  searchPlaceholder: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  loadError: string;
  toast: {
    created: string;
    updated: string;
    deleted: string;
  };
  confirm: {
    deleteTitle: string;
    deleteDescription: (label: string) => string;
  };
  timeline: {
    created: string;
    updated: string;
    restored: string;
  };
  datasetActions: {
    saveView: string;
    savedViews: string;
    import: string;
    importTitle: string;
    importDescription: string;
    applyImport: string;
    importApplied: string;
    importFailed: string;
    errorsBadge: (n: number) => string;
    noParseErrors: string;
    rowsBadge: (n: number) => string;
  };
  recordPanel: {
    timeline: string;
    noServerTimestamps: string;
    localVersions: string;
    noLocalVersions: string;
    restore: string;
  };
}

const adminCommonBundle: LexBilingual<AdminCommonLabels> = {
  en: {
    create: 'Create',
    edit: 'Edit',
    delete: 'Delete',
    cancel: 'Cancel',
    save: 'Save changes',
    add: 'Add',
    remove: 'Remove',
    active: 'Active',
    inactive: 'Inactive',
    yes: 'Yes',
    no: 'No',
    searchPlaceholder: 'Search…',
    nameAr: 'Name (Arabic)',
    nameEn: 'Name (English)',
    descriptionAr: 'Description (Arabic)',
    descriptionEn: 'Description (English)',
    loadError: 'Failed to load. Please try again.',
    toast: {
      created: 'Created successfully.',
      updated: 'Saved successfully.',
      deleted: 'Deleted successfully.',
    },
    confirm: {
      deleteTitle: 'Confirm deletion',
      deleteDescription: (label) => `Delete "${label}"? This action cannot be undone.`,
    },
    timeline: {
      created: 'Created',
      updated: 'Updated',
      restored: 'Restored from version',
    },
    datasetActions: {
      saveView: 'Save view',
      savedViews: 'Saved views',
      import: 'Import',
      importTitle: 'Import preview',
      importDescription: 'Review parsed rows before applying the import.',
      applyImport: 'Apply import',
      importApplied: 'Import applied.',
      importFailed: 'Import failed.',
      errorsBadge: (n) => `${n} errors`,
      noParseErrors: 'No parse errors',
      rowsBadge: (n) => `${n} rows`,
    },
    recordPanel: {
      timeline: 'Timeline',
      noServerTimestamps: 'No server timestamps.',
      localVersions: 'Local versions',
      noLocalVersions: 'No local versions.',
      restore: 'Restore',
    },
  },
  ar: {
    create: 'إنشاء',
    edit: 'تعديل',
    delete: 'حذف',
    cancel: 'إلغاء',
    save: 'حفظ التغييرات',
    add: 'إضافة',
    remove: 'إزالة',
    active: 'مُفعّل',
    inactive: 'مُعطّل',
    yes: 'نعم',
    no: 'لا',
    searchPlaceholder: 'بحث…',
    nameAr: 'الاسم (عربي)',
    nameEn: 'الاسم (إنجليزي)',
    descriptionAr: 'الوصف (عربي)',
    descriptionEn: 'الوصف (إنجليزي)',
    loadError: 'تعذّر التحميل. يُرجى المحاولة مرة أخرى.',
    toast: {
      created: 'تم الإنشاء بنجاح.',
      updated: 'تم الحفظ بنجاح.',
      deleted: 'تم الحذف بنجاح.',
    },
    confirm: {
      deleteTitle: 'تأكيد الحذف',
      deleteDescription: (label) => `حذف "${label}"؟ لا يمكن التراجع عن هذا الإجراء.`,
    },
    timeline: {
      created: 'أُنشئ في',
      updated: 'آخر تحديث',
      restored: 'مُستعاد من نسخة',
    },
    datasetActions: {
      saveView: 'حفظ العرض',
      savedViews: 'العروض المحفوظة',
      import: 'استيراد',
      importTitle: 'معاينة الاستيراد',
      importDescription: 'راجع الصفوف المُحلَّلة قبل تطبيق الاستيراد.',
      applyImport: 'تطبيق الاستيراد',
      importApplied: 'تم تطبيق الاستيراد.',
      importFailed: 'فشل الاستيراد.',
      errorsBadge: (n) => `${n} أخطاء`,
      noParseErrors: 'لا توجد أخطاء تحليل',
      rowsBadge: (n) => `${n} صفوف`,
    },
    recordPanel: {
      timeline: 'السجل الزمني',
      noServerTimestamps: 'لا توجد أختام زمنية من الخادم.',
      localVersions: 'النسخ المحلية',
      noLocalVersions: 'لا توجد نسخ محلية.',
      restore: 'استعادة',
    },
  },
};

export function useAdminCommonLabels(): AdminCommonLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(adminCommonBundle, locale), [locale]);
}

/* ========================================================================= *
 * Working Calendars
 * ========================================================================= */

export interface CalendarLabels {
  pageTitle: string;
  pageDescription: string;
  create: string;
  emptyTitle: string;
  emptyDescription: string;
  stats: { total: string; defaultCal: string; holidays: string };
  columns: { name: string; timezone: string; ramadan: string; default: string; updated: string };
  defaultBadge: string;
  noRamadan: string;
  weekdays: string[];
  weekdaysShort: string[];
  profiles: Record<string, string>;
  holidayKinds: Record<string, string>;
  bulk: { makeDefault: string; deleteSelected: string };
  toast: { defaultUpdated: string; duplicated: string; deleted: (n: number) => string };
  confirmBulkDelete: (n: number) => string;
  selectOneError: string;
  importMultipleDefaultError: string;
  savedView: string;
  importTitle: string;
  importDescription: string;
  nonDefault: string;
  rowDuplicate: string;
  rowMakeDefault: string;
  noDefaultWarning: string;
  multipleDefaultWarning: (n: number) => string;
  form: {
    createTitle: string;
    editTitle: string;
    name: string;
    namePlaceholder: string;
    description: string;
    timezone: string;
    timezonePlaceholder: string;
    isDefault: string;
    ramadanStart: string;
    ramadanEnd: string;
    workingHoursTitle: string;
    workingHoursHint: string;
    profile: string;
    day: string;
    startTime: string;
    endTime: string;
    addSegment: string;
    defaultHint: string;
    tzUnknown: string;
    tzPreview: (current: string, jan: string, jul: string) => string;
    tzDstYes: string;
    tzDstNo: string;
    tzInvalid: string;
    slaSimTitle: string;
    slaSimHint: string;
    slaSimStart: string;
    slaSimDays: string;
    slaSimHours: string;
    slaEstimatedDue: string;
    slaAverages: (avg: string, requested: string, timezone: string) => string;
    recordTimeline: string;
    noTimeline: string;
    localSnapshots: string;
    snapshotCount: (n: number) => string;
    weeklyGridPreview: string;
    errors: {
      nameRequired: string;
      timezoneRequired: string;
      timeOrder: string;
    };
  };
  holidays: {
    sectionTitle: string;
    sectionDescription: string;
    empty: string;
    addTitle: string;
    date: string;
    hijriDate: string;
    kind: string;
    add: string;
    toastAdded: string;
    toastRemoved: string;
    records: (n: number) => string;
    ksaSuggested: string;
    ksaMatch: string;
    todayHoliday: (name: string) => string;
    template: string;
    import: string;
    apply: string;
    toastImported: string;
    parseError: string;
    prevMonth: string;
    nextMonth: string;
    previewTitle: string;
    previewDescription: string;
    errorsBadge: (n: number) => string;
    noErrors: string;
    rowsBadge: (n: number) => string;
    colDate: string;
    colKind: string;
    colNameEn: string;
    colNameAr: string;
  };
}

const calendarBundle: LexBilingual<CalendarLabels> = {
  en: {
    pageTitle: 'Working Calendars',
    pageDescription: 'Define weekly working hours, Ramadan overlays, and holidays used for SLA arithmetic.',
    create: 'New Calendar',
    emptyTitle: 'No calendars yet',
    emptyDescription: 'Create a working calendar to drive SLA deadline calculations.',
    stats: { total: 'Calendars', defaultCal: 'Default set', holidays: 'Holidays' },
    columns: { name: 'Calendar', timezone: 'Timezone', ramadan: 'Ramadan window', default: 'Default', updated: 'Updated' },
    defaultBadge: 'Default',
    noRamadan: 'Not configured',
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    profiles: { standard: 'Standard', ramadan: 'Ramadan' },
    holidayKinds: { official: 'Official', religious: 'Religious', weekly: 'Weekly' },
    bulk: { makeDefault: 'Make default', deleteSelected: 'Delete selected' },
    toast: {
      defaultUpdated: 'Default calendar updated.',
      duplicated: 'Calendar duplicated.',
      deleted: (n) => `${n} calendar${n === 1 ? '' : 's'} deleted.`,
    },
    confirmBulkDelete: (n) => `Delete ${n} selected calendar${n === 1 ? '' : 's'}?`,
    selectOneError: 'Select exactly one calendar to make default.',
    importMultipleDefaultError: 'Calendar import may contain at most one default calendar.',
    savedView: 'Save calendar view',
    importTitle: 'Calendar import preview',
    importDescription: 'Review parsed calendars before creating them.',
    nonDefault: 'Non-default',
    rowDuplicate: 'Duplicate',
    rowMakeDefault: 'Make default',
    noDefaultWarning: 'No default working calendar is visible. SLA calculations need exactly one default calendar.',
    multipleDefaultWarning: (n) => `${n} default working calendars are visible. SLA calculations need exactly one default calendar.`,
    form: {
      createTitle: 'Create Calendar',
      editTitle: 'Edit Calendar',
      name: 'Calendar name',
      namePlaceholder: 'Standard Riyadh Calendar',
      description: 'Description',
      timezone: 'Timezone (IANA)',
      timezonePlaceholder: 'Asia/Riyadh',
      isDefault: 'Set as tenant default',
      ramadanStart: 'Ramadan start (Gregorian)',
      ramadanEnd: 'Ramadan end (Gregorian)',
      workingHoursTitle: 'Weekly working hours',
      workingHoursHint: 'Add a segment per working day. Ramadan-profile rows override the standard hours during the Ramadan window.',
      profile: 'Profile',
      day: 'Day',
      startTime: 'Start',
      endTime: 'End',
      addSegment: 'Add working segment',
      defaultHint: 'Saving this calendar as default should leave exactly one tenant default calendar.',
      tzUnknown: 'unknown',
      tzPreview: (current, jan, jul) => `Timezone preview: current offset ${current}; Jan ${jan}, Jul ${jul}.`,
      tzDstYes: 'DST appears to change this calendar offset.',
      tzDstNo: 'No DST offset change detected in this preview.',
      tzInvalid: 'Enter a valid IANA timezone such as Asia/Riyadh or Europe/London.',
      slaSimTitle: 'SLA simulator',
      slaSimHint: 'Estimates due time from the local weekly schedule, Ramadan profile, and saved holidays.',
      slaSimStart: 'Start',
      slaSimDays: 'Working days',
      slaSimHours: 'Working hours',
      slaEstimatedDue: 'Estimated due:',
      slaAverages: (avg, requested, timezone) =>
        `Average working day: ${avg}h. Requested working time: ${requested}h. Timezone preview: ${timezone}.`,
      recordTimeline: 'Record timeline',
      noTimeline: 'No timeline data available.',
      localSnapshots: 'Local snapshots',
      snapshotCount: (n) => `${n} saved version${n === 1 ? '' : 's'} in this browser.`,
      weeklyGridPreview: 'Weekly grid preview',
      errors: {
        nameRequired: 'Calendar name is required.',
        timezoneRequired: 'A timezone is required.',
        timeOrder: 'End time must be after start time.',
      },
    },
    holidays: {
      sectionTitle: 'Holidays',
      sectionDescription: 'Non-working dates excluded from SLA calculations.',
      empty: 'No holidays added.',
      addTitle: 'Add holiday',
      date: 'Date',
      hijriDate: 'Hijri',
      kind: 'Kind',
      add: 'Add holiday',
      toastAdded: 'Holiday added.',
      toastRemoved: 'Holiday removed.',
      records: (n) => (n === 1 ? '1 holiday record' : `${n} holiday records`),
      ksaSuggested: 'Official KSA day',
      ksaMatch: 'This date is an official KSA holiday.',
      todayHoliday: (name) => `Today is ${name} in the Kingdom.`,
      template: 'Template',
      import: 'Import',
      apply: 'Apply import',
      toastImported: 'Holiday import applied.',
      parseError: 'Unable to parse import file.',
      prevMonth: 'Previous month',
      nextMonth: 'Next month',
      previewTitle: 'Holiday import preview',
      previewDescription: 'Review parsed holiday rows before adding them to this calendar.',
      errorsBadge: (n) => `${n} errors`,
      noErrors: 'No validation errors',
      rowsBadge: (n) => `${n} rows`,
      colDate: 'Date',
      colKind: 'Kind',
      colNameEn: 'Name EN',
      colNameAr: 'Name AR',
    },
  },
  ar: {
    pageTitle: 'تقاويم العمل',
    pageDescription: 'حدّد ساعات العمل الأسبوعية وتراكب رمضان والعطلات المستخدمة في حساب اتفاقيات مستوى الخدمة.',
    create: 'تقويم جديد',
    emptyTitle: 'لا توجد تقاويم بعد',
    emptyDescription: 'أنشئ تقويم عمل لتشغيل حسابات مواعيد اتفاقيات الخدمة.',
    stats: { total: 'التقاويم', defaultCal: 'التقويم الافتراضي', holidays: 'العطلات' },
    columns: { name: 'التقويم', timezone: 'المنطقة الزمنية', ramadan: 'نافذة رمضان', default: 'الافتراضي', updated: 'آخر تحديث' },
    defaultBadge: 'افتراضي',
    noRamadan: 'غير مُعدّ',
    weekdays: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
    weekdaysShort: ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'],
    profiles: { standard: 'اعتيادي', ramadan: 'رمضان' },
    holidayKinds: { official: 'رسمية', religious: 'دينية', weekly: 'أسبوعية' },
    bulk: { makeDefault: 'تعيينه افتراضيًا', deleteSelected: 'حذف المحدد' },
    toast: {
      defaultUpdated: 'تم تحديث التقويم الافتراضي.',
      duplicated: 'تم نسخ التقويم.',
      deleted: (n) => `تم حذف ${n} تقويم.`,
    },
    confirmBulkDelete: (n) => `حذف ${n} تقويم محدد؟`,
    selectOneError: 'حدّد تقويمًا واحدًا فقط لتعيينه افتراضيًا.',
    importMultipleDefaultError: 'لا يجوز أن يحتوي استيراد التقاويم على أكثر من تقويم افتراضي واحد.',
    savedView: 'حفظ عرض التقويم',
    importTitle: 'معاينة استيراد التقويم',
    importDescription: 'راجع التقاويم المُحلَّلة قبل إنشائها.',
    nonDefault: 'غير افتراضي',
    rowDuplicate: 'نسخ',
    rowMakeDefault: 'تعيينه افتراضيًا',
    noDefaultWarning: 'لا يوجد تقويم عمل افتراضي ظاهر. تتطلّب حسابات اتفاقية الخدمة تقويمًا افتراضيًا واحدًا بالضبط.',
    multipleDefaultWarning: (n) => `يوجد ${n} تقاويم عمل افتراضية ظاهرة. تتطلّب حسابات اتفاقية الخدمة تقويمًا افتراضيًا واحدًا بالضبط.`,
    form: {
      createTitle: 'إنشاء تقويم',
      editTitle: 'تعديل التقويم',
      name: 'اسم التقويم',
      namePlaceholder: 'تقويم الرياض الاعتيادي',
      description: 'الوصف',
      timezone: 'المنطقة الزمنية (IANA)',
      timezonePlaceholder: 'Asia/Riyadh',
      isDefault: 'تعيينه افتراضيًا للمستأجر',
      ramadanStart: 'بداية رمضان (ميلادي)',
      ramadanEnd: 'نهاية رمضان (ميلادي)',
      workingHoursTitle: 'ساعات العمل الأسبوعية',
      workingHoursHint: 'أضف فترة لكل يوم عمل. تتجاوز صفوف ملف رمضان الساعات الاعتيادية خلال نافذة رمضان.',
      profile: 'الملف',
      day: 'اليوم',
      startTime: 'البداية',
      endTime: 'النهاية',
      addSegment: 'إضافة فترة عمل',
      defaultHint: 'حفظ هذا التقويم كافتراضي يجب أن يُبقي تقويمًا افتراضيًا واحدًا فقط للمستأجر.',
      tzUnknown: 'غير معروف',
      tzPreview: (current, jan, jul) => `معاينة المنطقة الزمنية: الإزاحة الحالية ${current}؛ يناير ${jan}، يوليو ${jul}.`,
      tzDstYes: 'يبدو أن التوقيت الصيفي يغيّر إزاحة هذا التقويم.',
      tzDstNo: 'لم يُكتشف أي تغيّر في إزاحة التوقيت الصيفي في هذه المعاينة.',
      tzInvalid: 'أدخل منطقة زمنية صالحة وفق IANA مثل Asia/Riyadh أو Europe/London.',
      slaSimTitle: 'محاكي اتفاقية الخدمة',
      slaSimHint: 'يقدّر وقت الاستحقاق من الجدول الأسبوعي المحلي وملف رمضان والعطلات المحفوظة.',
      slaSimStart: 'البداية',
      slaSimDays: 'أيام العمل',
      slaSimHours: 'ساعات العمل',
      slaEstimatedDue: 'الاستحقاق المقدّر:',
      slaAverages: (avg, requested, timezone) =>
        `متوسط يوم العمل: ${avg} ساعة. وقت العمل المطلوب: ${requested} ساعة. معاينة المنطقة الزمنية: ${timezone}.`,
      recordTimeline: 'الجدول الزمني للسجل',
      noTimeline: 'لا توجد بيانات جدول زمني متاحة.',
      localSnapshots: 'لقطات محلية',
      snapshotCount: (n) => `${n} نسخة محفوظة في هذا المتصفح.`,
      weeklyGridPreview: 'معاينة الجدول الأسبوعي',
      errors: {
        nameRequired: 'اسم التقويم مطلوب.',
        timezoneRequired: 'المنطقة الزمنية مطلوبة.',
        timeOrder: 'يجب أن يكون وقت النهاية بعد وقت البداية.',
      },
    },
    holidays: {
      sectionTitle: 'العطلات',
      sectionDescription: 'الأيام غير العاملة المستثناة من حسابات اتفاقيات الخدمة.',
      empty: 'لم تُضف أي عطلات.',
      addTitle: 'إضافة عطلة',
      date: 'التاريخ',
      hijriDate: 'هجري',
      kind: 'النوع',
      add: 'إضافة عطلة',
      toastAdded: 'تمت إضافة العطلة.',
      toastRemoved: 'تمت إزالة العطلة.',
      records: (n) => (n === 1 ? 'سجل عطلة واحد' : `${n} سجلات عطلات`),
      ksaSuggested: 'يوم رسمي سعودي',
      ksaMatch: 'هذا التاريخ عطلة رسمية في المملكة.',
      todayHoliday: (name) => `اليوم هو ${name} في المملكة.`,
      template: 'قالب',
      import: 'استيراد',
      apply: 'تطبيق الاستيراد',
      toastImported: 'تم تطبيق استيراد العطلات.',
      parseError: 'تعذّر تحليل ملف الاستيراد.',
      prevMonth: 'الشهر السابق',
      nextMonth: 'الشهر التالي',
      previewTitle: 'معاينة استيراد العطلات',
      previewDescription: 'راجع صفوف العطلات المُحلَّلة قبل إضافتها إلى هذا التقويم.',
      errorsBadge: (n) => `${n} أخطاء`,
      noErrors: 'لا توجد أخطاء تحقق',
      rowsBadge: (n) => `${n} صفوف`,
      colDate: 'التاريخ',
      colKind: 'النوع',
      colNameEn: 'الاسم (إنجليزي)',
      colNameAr: 'الاسم (عربي)',
    },
  },
};

export function useCalendarLabels(): CalendarLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(calendarBundle, locale), [locale]);
}

/* ========================================================================= *
 * Service Catalog
 * ========================================================================= */

export interface ServiceCatalogLabels {
  pageTitle: string;
  pageDescription: string;
  create: string;
  emptyTitle: string;
  emptyDescription: string;
  stats: { total: string; active: string; email: string };
  columns: { name: string; code: string; channel: string; requestType: string; status: string };
  channels: Record<string, string>;
  ruleTypes: Record<string, string>;
  toast: { imported: string; published: string; movedToDraft: string };
  rowActions: {
    details: string;
    clone: string;
    publish: string;
    moveToDraft: string;
  };
  importError: string;
  detailTitle: string;
  detailDescription: string;
  back: string;
  unavailable: string;
  kpis: { sla: string; attachments: string; mailboxes: string; eligibility: string };
  panels: { published: string; draft: string; emailServices: string };
  adminPanels: {
    detectorTitle: string;
    detectorHint: string;
    checking: string;
    issuesCount: (n: number) => string;
    noIssues: string;
    noIssuesDetail: string;
    moreHidden: (n: number) => string;
    dupCodeTitle: string;
    dupCodeDetail: (code: string, count: number) => string;
    requestCollisionTitle: string;
    requestCollisionDetail: (count: number, requestType: string) => string;
    missingSlaTitle: string;
    missingSlaDetail: (code: string) => string;
    emailNotWiredTitle: string;
    emailNotWiredDetail: (code: string) => string;
    statusTitle: string;
    statusHint: string;
  };
  mailboxAdmin: {
    title: string;
    description: string;
    addButton: string;
    empty: string;
    columns: { address: string; requestType: string; service: string; status: string };
    noService: string;
    rowRotate: string;
    form: {
      createTitle: string;
      createDescription: string;
      editTitle: string;
      editDescription: string;
      address: string;
      addressPlaceholder: string;
      addressImmutable: string;
      requestType: string;
      requestTypePlaceholder: string;
      service: string;
      serviceNone: string;
      beneficiary: string;
      beneficiaryNone: string;
      active: string;
      ingestSecret: string;
      ingestSecretPlaceholder: string;
      ingestSecretCreateHint: string;
      ingestSecretRotateHint: string;
      generate: string;
      errors: {
        addressRequired: string;
        addressInvalid: string;
        requestTypeRequired: string;
        secretRequired: string;
      };
    };
    secretPanel: {
      title: string;
      warning: string;
      copy: string;
      copied: string;
      copyFailed: string;
      done: string;
    };
    toast: { created: string; rotated: string; deleted: string };
    deleteConfirm: { title: string; description: (address: string) => string };
  };
  detail: {
    slaRequestIdPlaceholder: string;
    slaRequestIdAria: string;
    deptPlaceholder: string;
  };
  detailView: {
    notSet: string;
    loadFailed: string;
    published: string;
    draft: string;
    mailboxMissing: string;
    createdPrefix: string;
    updatedPrefix: string;
    linkedSlaTitle: string;
    linkedSlaHint: string;
    monitor: string;
    noSlaLinked: (code: string) => string;
    colPriority: string;
    colTurnaround: string;
    colAck: string;
    colEscalation: string;
    colStatus: string;
    workingDays: (n: number) => string;
    escalationCell: (l1: number, l2: number, l3: number) => string;
    active: string;
    inactive: string;
    lookupClock: string;
    clockPrefix: (id: string) => string;
    unknown: string;
    breached: string;
    onTrack: string;
    ackPrefix: (date: string) => string;
    duePrefix: (date: string) => string;
    levelPrefix: (n: number) => string;
    eligibilityTitle: string;
    eligibilityHint: string;
    department: string;
    beneficiaryCode: string;
    orgCodePlaceholder: string;
    checkEligibility: string;
    eligible: string;
    notEligible: string;
    intakeChannelTitle: string;
    intakeChannelHint: string;
    noMailbox: string;
    intakePreviewTitle: string;
    intakePreviewHint: string;
    rowTitle: string;
    rowDescription: string;
    rowBeneficiary: string;
    rowPriority: string;
    rowRequesterApproval: string;
    rowProviderApproval: string;
    required: string;
    notRequired: string;
    priorityValue: string;
    any: string;
    approvalPolicyTitle: string;
    approvalPolicyHint: string;
    approverSummary: (mode: string, quorum: string, count: number) => string;
    noPolicyLinked: string;
    attachmentsTitle: string;
    attachmentsHint: string;
    noAttachmentPolicy: string;
    filesSlots: (min: number, max: number, slots: number) => string;
    rulesTitle: string;
    rulesHint: string;
    noExplicitRules: string;
    ruleAny: string;
  };
  form: {
    createTitle: string;
    editTitle: string;
    cloneTitle: string;
    cloneDescription: string;
    cloneSuffix: string;
    code: string;
    codePlaceholder: string;
    requestType: string;
    requestTypePlaceholder: string;
    channel: string;
    intakeEmail: string;
    intakeEmailPlaceholder: string;
    intakeEmailDescription: string;
    requesterApproval: string;
    providerApproval: string;
    approvalPolicy: string;
    approvalPolicyNone: string;
    localApprovalPreview: string;
    localApprovalDescription: string;
    active: string;
    availableTo: string;
    availableToPlaceholder: string;
    availableToHint: string;
    eligibilityTitle: string;
    eligibilityHint: string;
    ruleType: string;
    ruleValue: string;
    ruleValuePlaceholder: string;
    addRule: string;
    errors: {
      codeRequired: string;
      requestTypeRequired: string;
      nameRequired: string;
    };
  };
}

const serviceCatalogBundle: LexBilingual<ServiceCatalogLabels> = {
  en: {
    pageTitle: 'Service Catalog',
    pageDescription: 'Publish the legal services available for intake and configure their eligibility and channels.',
    create: 'New Service',
    emptyTitle: 'No services published',
    emptyDescription: 'Add a service so requesters can submit legal requests against it.',
    stats: { total: 'Services', active: 'Active', email: 'Email-enabled' },
    columns: { name: 'Service', code: 'Code', channel: 'Channel', requestType: 'Request type', status: 'Status' },
    channels: { platform: 'In-app', email: 'Email', both: 'In-app & Email' },
    ruleTypes: { all: 'Anyone', department: 'Department', role: 'Org role', doa_matrix: 'DoA matrix' },
    toast: {
      imported: 'Services imported.',
      published: 'Service published.',
      movedToDraft: 'Service moved to draft.',
    },
    rowActions: {
      details: 'Details',
      clone: 'Clone',
      publish: 'Publish',
      moveToDraft: 'Move to draft',
    },
    importError: 'Each service row must include code, request_type, and name/name_en/name_ar.',
    detailTitle: 'Service detail',
    detailDescription: 'Linked SLA, attachments, eligibility, approval, and intake routing.',
    back: 'Back',
    unavailable: 'Service unavailable',
    kpis: { sla: 'SLA targets', attachments: 'Attachment policies', mailboxes: 'Mailboxes', eligibility: 'Eligibility rules' },
    panels: { published: 'Published', draft: 'Draft', emailServices: 'Email services' },
    adminPanels: {
      detectorTitle: 'Duplicate and conflict detector',
      detectorHint: 'Checks visible catalog rows against SLA and mailbox routing.',
      checking: 'Checking',
      issuesCount: (n) => `${n} issues`,
      noIssues: 'No issues',
      noIssuesDetail:
        'No duplicate codes, request-type collisions, missing active SLA targets, or email mailbox gaps were detected in the loaded set.',
      moreHidden: (n) => `${n} more issues hidden.`,
      dupCodeTitle: 'Duplicate service code',
      dupCodeDetail: (code, count) => `${code} appears ${count} times.`,
      requestCollisionTitle: 'Request type collision',
      requestCollisionDetail: (count, requestType) => `${count} active services share ${requestType}.`,
      missingSlaTitle: 'Missing active SLA',
      missingSlaDetail: (code) => `${code} has no active SLA target.`,
      emailNotWiredTitle: 'Email intake not wired',
      emailNotWiredDetail: (code) => `${code} accepts email but has no active matching mailbox.`,
      statusTitle: 'Publishing and intake status',
      statusHint: 'Draft/published distribution and email readiness.',
    },
    mailboxAdmin: {
      title: 'Intake mailboxes',
      description: 'Inbound email addresses routed into legal intake, each with its own HMAC ingest secret.',
      addButton: 'Add mailbox',
      empty: 'No intake mailboxes configured. Add one to accept email-based requests.',
      columns: { address: 'Address', requestType: 'Request type', service: 'Mapped service', status: 'Status' },
      noService: 'Not mapped',
      rowRotate: 'Rotate secret',
      form: {
        createTitle: 'Add intake mailbox',
        createDescription: 'Register an inbound address and generate its HMAC ingest secret.',
        editTitle: 'Edit intake mailbox',
        editDescription: 'Update routing or rotate the ingest secret. The address cannot be changed.',
        address: 'Mailbox address',
        addressPlaceholder: 'legal-intake@org.sa',
        addressImmutable: 'The address is fixed after creation. Delete and recreate to change it.',
        requestType: 'Default request type',
        requestTypePlaceholder: 'contract_review',
        service: 'Mapped service',
        serviceNone: 'No specific service',
        beneficiary: 'Default beneficiary entity',
        beneficiaryNone: 'None',
        active: 'Active',
        ingestSecret: 'Ingest secret (HMAC)',
        ingestSecretPlaceholder: 'Generate or paste a shared secret',
        ingestSecretCreateHint: 'Shared secret the email relay signs the webhook with. Stored encrypted and shown only once.',
        ingestSecretRotateHint: 'Leave blank to keep the current secret. Enter a new value to rotate it.',
        generate: 'Generate',
        errors: {
          addressRequired: 'A mailbox address is required.',
          addressInvalid: 'Enter a valid email address.',
          requestTypeRequired: 'A default request type is required.',
          secretRequired: 'An ingest secret is required.',
        },
      },
      secretPanel: {
        title: 'Copy the ingest secret now',
        warning: 'This secret is shown only once and cannot be retrieved later. Store it in the email relay before closing. If lost, rotate the mailbox to issue a new one.',
        copy: 'Copy secret',
        copied: 'Secret copied to clipboard.',
        copyFailed: 'Copy failed. Select the value and copy it manually.',
        done: 'Done',
      },
      toast: { created: 'Mailbox created.', rotated: 'Ingest secret rotated.', deleted: 'Mailbox deleted.' },
      deleteConfirm: {
        title: 'Delete intake mailbox',
        description: (address) =>
          `Delete "${address}"? Any email relay still signing against this address will start bouncing. This cannot be undone.`,
      },
    },
    detail: {
      slaRequestIdPlaceholder: 'Select a legal request',
      slaRequestIdAria: 'Legal request',
      deptPlaceholder: 'DEPT-LEGAL',
    },
    detailView: {
      notSet: 'Not set',
      loadFailed: 'The service could not be loaded.',
      published: 'Published',
      draft: 'Draft',
      mailboxMissing: 'Mailbox missing',
      createdPrefix: 'Created',
      updatedPrefix: 'Updated',
      linkedSlaTitle: 'Linked SLA',
      linkedSlaHint: 'Targets published for this service code.',
      monitor: 'Monitor',
      noSlaLinked: (code) => `No SLA target is linked to ${code}.`,
      colPriority: 'Priority',
      colTurnaround: 'Turnaround',
      colAck: 'Ack',
      colEscalation: 'Escalation',
      colStatus: 'Status',
      workingDays: (n) => `${n} working days`,
      escalationCell: (l1, l2, l3) => `L1 ${l1} · L2 ${l2} · L3 ${l3}`,
      active: 'Active',
      inactive: 'Inactive',
      lookupClock: 'Lookup clock',
      clockPrefix: (id) => `Clock ${id}`,
      unknown: 'unknown',
      breached: 'Breached',
      onTrack: 'On track',
      ackPrefix: (date) => `Ack ${date}`,
      duePrefix: (date) => `Due ${date}`,
      levelPrefix: (n) => `L${n}`,
      eligibilityTitle: 'Eligibility tester',
      eligibilityHint: 'Runs the live eligibility-check endpoint.',
      department: 'Department',
      beneficiaryCode: 'Beneficiary code',
      orgCodePlaceholder: 'ORG-CODE',
      checkEligibility: 'Check eligibility',
      eligible: 'Eligible',
      notEligible: 'Not eligible',
      intakeChannelTitle: 'Intake channel',
      intakeChannelHint: 'Platform/email routing and mailbox state.',
      noMailbox: 'No mailbox row matched this service.',
      intakePreviewTitle: 'Request intake preview',
      intakePreviewHint: 'Fields a requester sees for this service.',
      rowTitle: 'Title',
      rowDescription: 'Description',
      rowBeneficiary: 'Beneficiary',
      rowPriority: 'Priority',
      rowRequesterApproval: 'Requester approval',
      rowProviderApproval: 'Provider approval',
      required: 'Required',
      notRequired: 'Not required',
      priorityValue: 'Normal or urgent',
      any: 'Any',
      approvalPolicyTitle: 'Approval policy',
      approvalPolicyHint: 'Persisted policy if one is linked.',
      approverSummary: (mode, quorum, count) => `${mode} · ${quorum} · ${count} approvers`,
      noPolicyLinked: 'No policy is linked. This service uses the requester/provider approval toggles.',
      attachmentsTitle: 'Attachments',
      attachmentsHint: 'Policies linked by service code, request type, or global default.',
      noAttachmentPolicy: 'No attachment policy matched this service.',
      filesSlots: (min, max, slots) => `${min}-${max} files · ${slots} slots`,
      rulesTitle: 'Eligibility rules',
      rulesHint: 'Rules evaluated before intake is accepted.',
      noExplicitRules: 'No explicit rules. Eligibility defaults to service availability.',
      ruleAny: 'any',
    },
    form: {
      createTitle: 'Create Service',
      editTitle: 'Edit Service',
      cloneTitle: 'Clone service',
      cloneDescription: 'Create an unpublished copy with the same routing and eligibility rules.',
      cloneSuffix: 'copy',
      code: 'Service code',
      codePlaceholder: 'CONTRACT_REVIEW',
      requestType: 'Request type',
      requestTypePlaceholder: 'contract_review',
      channel: 'Intake channel',
      intakeEmail: 'Intake email',
      intakeEmailPlaceholder: 'legal-contracts@org.sa',
      intakeEmailDescription:
        'Services may share one intake address (e.g. case-legal@…) — inbound mail is routed by classification.',
      requesterApproval: 'Requester approval required',
      providerApproval: 'Provider approval required',
      approvalPolicy: 'Approval policy',
      approvalPolicyNone: 'Use service approval toggles',
      localApprovalPreview: 'Local approval preview',
      localApprovalDescription:
        'Requester and provider approval switches below control the default two-step request approval route.',
      active: 'Active',
      availableTo: 'Available to',
      availableToPlaceholder: 'department codes, comma-separated',
      availableToHint: 'Optional list of beneficiary/department codes this service is offered to.',
      eligibilityTitle: 'Eligibility rules',
      eligibilityHint: 'Each rule constrains who may request this service. Leave empty to allow anyone.',
      ruleType: 'Rule type',
      ruleValue: 'Value',
      ruleValuePlaceholder: 'department code / role key',
      addRule: 'Add rule',
      errors: {
        codeRequired: 'Service code is required.',
        requestTypeRequired: 'Request type is required.',
        nameRequired: 'An English or Arabic name is required.',
      },
    },
  },
  ar: {
    pageTitle: 'كتالوج الخدمات',
    pageDescription: 'انشر الخدمات القانونية المتاحة للاستقبال واضبط أهليتها وقنواتها.',
    create: 'خدمة جديدة',
    emptyTitle: 'لا توجد خدمات منشورة',
    emptyDescription: 'أضف خدمة ليتمكّن مقدّمو الطلبات من تقديم طلبات قانونية عليها.',
    stats: { total: 'الخدمات', active: 'مُفعّلة', email: 'تدعم البريد' },
    columns: { name: 'الخدمة', code: 'الرمز', channel: 'القناة', requestType: 'نوع الطلب', status: 'الحالة' },
    channels: { platform: 'داخل النظام', email: 'البريد', both: 'النظام والبريد' },
    ruleTypes: { all: 'الجميع', department: 'إدارة', role: 'دور تنظيمي', doa_matrix: 'مصفوفة الصلاحيات' },
    toast: {
      imported: 'تم استيراد الخدمات.',
      published: 'تم نشر الخدمة.',
      movedToDraft: 'نُقلت الخدمة إلى المسودة.',
    },
    rowActions: {
      details: 'التفاصيل',
      clone: 'استنساخ',
      publish: 'نشر',
      moveToDraft: 'نقل إلى المسودة',
    },
    importError: 'يجب أن يتضمّن كل صف خدمة: الرمز ونوع الطلب والاسم/name_en/name_ar.',
    detailTitle: 'تفاصيل الخدمة',
    detailDescription: 'اتفاقيات مستوى الخدمة المرتبطة والمرفقات والأهلية والموافقات وتوجيه الاستقبال.',
    back: 'رجوع',
    unavailable: 'الخدمة غير متاحة',
    kpis: { sla: 'أهداف اتفاقية الخدمة', attachments: 'سياسات المرفقات', mailboxes: 'صناديق البريد', eligibility: 'قواعد الأهلية' },
    panels: { published: 'منشورة', draft: 'مسودة', emailServices: 'خدمات البريد' },
    adminPanels: {
      detectorTitle: 'كاشف التكرارات والتعارضات',
      detectorHint: 'يفحص صفوف الكتالوج الظاهرة مقابل اتفاقيات مستوى الخدمة وتوجيه صناديق البريد.',
      checking: 'جارٍ الفحص',
      issuesCount: (n) => `${n} مشكلات`,
      noIssues: 'لا توجد مشكلات',
      noIssuesDetail:
        'لم يُكتشف في المجموعة المُحمَّلة أي رموز مكررة أو تعارضات في أنواع الطلبات أو أهداف اتفاقية خدمة نشطة مفقودة أو فجوات في صناديق البريد.',
      moreHidden: (n) => `${n} مشكلات أخرى مخفية.`,
      dupCodeTitle: 'رمز خدمة مكرر',
      dupCodeDetail: (code, count) => `يظهر ${code} ${count} مرات.`,
      requestCollisionTitle: 'تعارض في نوع الطلب',
      requestCollisionDetail: (count, requestType) => `يشترك ${count} من الخدمات النشطة في ${requestType}.`,
      missingSlaTitle: 'اتفاقية خدمة نشطة مفقودة',
      missingSlaDetail: (code) => `لا يوجد هدف اتفاقية خدمة نشط لـ ${code}.`,
      emailNotWiredTitle: 'استقبال البريد غير مُهيّأ',
      emailNotWiredDetail: (code) => `يقبل ${code} البريد لكن لا يوجد صندوق بريد نشط مطابق.`,
      statusTitle: 'حالة النشر والاستقبال',
      statusHint: 'توزيع المسودات/المنشورة وجاهزية البريد.',
    },
    mailboxAdmin: {
      title: 'صناديق بريد الاستقبال',
      description: 'عناوين البريد الواردة المُوجّهة إلى استقبال الطلبات القانونية، لكل منها مفتاح توقيع HMAC خاص.',
      addButton: 'إضافة صندوق بريد',
      empty: 'لا توجد صناديق بريد استقبال مُعدّة. أضف صندوقًا لقبول الطلبات عبر البريد.',
      columns: { address: 'العنوان', requestType: 'نوع الطلب', service: 'الخدمة المرتبطة', status: 'الحالة' },
      noService: 'غير مرتبط',
      rowRotate: 'تدوير المفتاح',
      form: {
        createTitle: 'إضافة صندوق بريد استقبال',
        createDescription: 'سجّل عنوانًا واردًا وأنشئ مفتاح توقيع HMAC الخاص به.',
        editTitle: 'تعديل صندوق بريد الاستقبال',
        editDescription: 'حدّث التوجيه أو دوّر مفتاح التوقيع. لا يمكن تغيير العنوان.',
        address: 'عنوان صندوق البريد',
        addressPlaceholder: 'legal-intake@org.sa',
        addressImmutable: 'العنوان ثابت بعد الإنشاء. احذف الصندوق وأعد إنشاءه لتغييره.',
        requestType: 'نوع الطلب الافتراضي',
        requestTypePlaceholder: 'contract_review',
        service: 'الخدمة المرتبطة',
        serviceNone: 'دون خدمة محددة',
        beneficiary: 'الجهة المستفيدة الافتراضية',
        beneficiaryNone: 'لا شيء',
        active: 'مُفعّل',
        ingestSecret: 'مفتاح التوقيع (HMAC)',
        ingestSecretPlaceholder: 'أنشئ أو الصق مفتاحًا مشتركًا',
        ingestSecretCreateHint: 'المفتاح المشترك الذي يوقّع به مُرحّل البريد طلب الويب هوك. يُخزَّن مُشفّرًا ويُعرض مرة واحدة فقط.',
        ingestSecretRotateHint: 'اتركه فارغًا للإبقاء على المفتاح الحالي. أدخل قيمة جديدة لتدويره.',
        generate: 'إنشاء',
        errors: {
          addressRequired: 'عنوان صندوق البريد مطلوب.',
          addressInvalid: 'أدخل عنوان بريد إلكتروني صالحًا.',
          requestTypeRequired: 'نوع الطلب الافتراضي مطلوب.',
          secretRequired: 'مفتاح التوقيع مطلوب.',
        },
      },
      secretPanel: {
        title: 'انسخ مفتاح التوقيع الآن',
        warning: 'يُعرض هذا المفتاح مرة واحدة فقط ولا يمكن استرجاعه لاحقًا. احفظه في مُرحّل البريد قبل الإغلاق. إن فُقد، فدوّر الصندوق لإصدار مفتاح جديد.',
        copy: 'نسخ المفتاح',
        copied: 'تم نسخ المفتاح إلى الحافظة.',
        copyFailed: 'تعذّر النسخ. حدّد القيمة وانسخها يدويًا.',
        done: 'تم',
      },
      toast: { created: 'تم إنشاء صندوق البريد.', rotated: 'تم تدوير مفتاح التوقيع.', deleted: 'تم حذف صندوق البريد.' },
      deleteConfirm: {
        title: 'حذف صندوق بريد الاستقبال',
        description: (address) =>
          `حذف "${address}"؟ أي مُرحّل بريد لا يزال يوقّع على هذا العنوان سيبدأ برفض الرسائل. لا يمكن التراجع عن هذا الإجراء.`,
      },
    },
    detail: {
      slaRequestIdPlaceholder: 'اختر طلبًا قانونيًا',
      slaRequestIdAria: 'الطلب القانوني',
      deptPlaceholder: 'DEPT-LEGAL',
    },
    detailView: {
      notSet: 'غير محدد',
      loadFailed: 'تعذّر تحميل الخدمة.',
      published: 'منشورة',
      draft: 'مسودة',
      mailboxMissing: 'صندوق بريد مفقود',
      createdPrefix: 'أُنشئ في',
      updatedPrefix: 'آخر تحديث',
      linkedSlaTitle: 'اتفاقية مستوى الخدمة المرتبطة',
      linkedSlaHint: 'الأهداف المنشورة لرمز هذه الخدمة.',
      monitor: 'مراقبة',
      noSlaLinked: (code) => `لا يوجد هدف اتفاقية خدمة مرتبط بـ ${code}.`,
      colPriority: 'الأولوية',
      colTurnaround: 'الإنجاز',
      colAck: 'الإقرار',
      colEscalation: 'التصعيد',
      colStatus: 'الحالة',
      workingDays: (n) => `${n} أيام عمل`,
      escalationCell: (l1, l2, l3) => `م1 ${l1} · م2 ${l2} · م3 ${l3}`,
      active: 'مُفعّل',
      inactive: 'مُعطّل',
      lookupClock: 'بحث عن الساعة',
      clockPrefix: (id) => `الساعة ${id}`,
      unknown: 'غير معروف',
      breached: 'مُتجاوَز',
      onTrack: 'ضمن المسار',
      ackPrefix: (date) => `الإقرار ${date}`,
      duePrefix: (date) => `الاستحقاق ${date}`,
      levelPrefix: (n) => `م${n}`,
      eligibilityTitle: 'مُختبِر الأهلية',
      eligibilityHint: 'يُشغّل نقطة فحص الأهلية المباشرة.',
      department: 'الإدارة',
      beneficiaryCode: 'رمز الجهة المستفيدة',
      orgCodePlaceholder: 'ORG-CODE',
      checkEligibility: 'فحص الأهلية',
      eligible: 'مؤهّل',
      notEligible: 'غير مؤهّل',
      intakeChannelTitle: 'قناة الاستقبال',
      intakeChannelHint: 'توجيه النظام/البريد وحالة صندوق البريد.',
      noMailbox: 'لا يوجد صندوق بريد مطابق لهذه الخدمة.',
      intakePreviewTitle: 'معاينة استقبال الطلب',
      intakePreviewHint: 'الحقول التي يراها مقدّم الطلب لهذه الخدمة.',
      rowTitle: 'العنوان',
      rowDescription: 'الوصف',
      rowBeneficiary: 'الجهة المستفيدة',
      rowPriority: 'الأولوية',
      rowRequesterApproval: 'موافقة مقدّم الطلب',
      rowProviderApproval: 'موافقة مزوّد الخدمة',
      required: 'مطلوب',
      notRequired: 'غير مطلوب',
      priorityValue: 'اعتيادي أو عاجل',
      any: 'أي',
      approvalPolicyTitle: 'سياسة الموافقة',
      approvalPolicyHint: 'السياسة المحفوظة إن وُجدت سياسة مرتبطة.',
      approverSummary: (mode, quorum, count) => `${mode} · ${quorum} · ${count} مُوافِق`,
      noPolicyLinked: 'لا توجد سياسة مرتبطة. تستخدم هذه الخدمة مفاتيح موافقة مقدّم/مزوّد الطلب.',
      attachmentsTitle: 'المرفقات',
      attachmentsHint: 'السياسات المرتبطة برمز الخدمة أو نوع الطلب أو الافتراضي العام.',
      noAttachmentPolicy: 'لا توجد سياسة مرفقات مطابقة لهذه الخدمة.',
      filesSlots: (min, max, slots) => `${min}-${max} ملفات · ${slots} خانات`,
      rulesTitle: 'قواعد الأهلية',
      rulesHint: 'القواعد المُقيَّمة قبل قبول الاستقبال.',
      noExplicitRules: 'لا توجد قواعد صريحة. تعتمد الأهلية افتراضيًا على توفّر الخدمة.',
      ruleAny: 'أي',
    },
    form: {
      createTitle: 'إنشاء خدمة',
      editTitle: 'تعديل الخدمة',
      cloneTitle: 'استنساخ الخدمة',
      cloneDescription: 'إنشاء نسخة غير منشورة لها قواعد التوجيه والأهلية نفسها.',
      cloneSuffix: 'نسخة',
      code: 'رمز الخدمة',
      codePlaceholder: 'CONTRACT_REVIEW',
      requestType: 'نوع الطلب',
      requestTypePlaceholder: 'contract_review',
      channel: 'قناة الاستقبال',
      intakeEmail: 'بريد الاستقبال',
      intakeEmailPlaceholder: 'legal-contracts@org.sa',
      intakeEmailDescription:
        'يمكن أن تتشارك عدة خدمات عنوان استقبال واحدًا (مثل case-legal@…) — يُوجَّه البريد الوارد حسب التصنيف.',
      requesterApproval: 'يتطلّب موافقة مقدّم الطلب',
      providerApproval: 'يتطلّب موافقة مزوّد الخدمة',
      approvalPolicy: 'سياسة الموافقة',
      approvalPolicyNone: 'استخدام مفاتيح موافقة الخدمة',
      localApprovalPreview: 'معاينة الاعتماد المحلية',
      localApprovalDescription:
        'تتحكّم مفاتيح موافقة مقدّم الطلب ومزوّد الخدمة أدناه في مسار اعتماد الطلب الافتراضي ذي الخطوتين.',
      active: 'مُفعّل',
      availableTo: 'متاح لـ',
      availableToPlaceholder: 'رموز الإدارات، مفصولة بفواصل',
      availableToHint: 'قائمة اختيارية برموز الجهات/الإدارات المستفيدة المتاحة لها هذه الخدمة.',
      eligibilityTitle: 'قواعد الأهلية',
      eligibilityHint: 'تحدّ كل قاعدة من يحقّ له طلب هذه الخدمة. اتركها فارغة للسماح للجميع.',
      ruleType: 'نوع القاعدة',
      ruleValue: 'القيمة',
      ruleValuePlaceholder: 'رمز الإدارة / مفتاح الدور',
      addRule: 'إضافة قاعدة',
      errors: {
        codeRequired: 'رمز الخدمة مطلوب.',
        requestTypeRequired: 'نوع الطلب مطلوب.',
        nameRequired: 'الاسم بالإنجليزية أو العربية مطلوب.',
      },
    },
  },
};

export function useServiceCatalogLabels(): ServiceCatalogLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(serviceCatalogBundle, locale), [locale]);
}

/* ========================================================================= *
 * SLA Targets
 * ========================================================================= */

export interface SLALabels {
  pageTitle: string;
  pageDescription: string;
  create: string;
  emptyTitle: string;
  emptyDescription: string;
  stats: { total: string; active: string; urgent: string };
  columns: {
    service: string;
    priority: string;
    turnaround: string;
    ack: string;
    escalation: string;
    status: string;
  };
  priorities: Record<string, string>;
  ackUnits: Record<string, string>;
  daysSuffix: (n: number) => string;
  ackValue: (value: number, unit: string) => string;
  escalationValue: (l1: number, l2: number, l3: number) => string;
  bulk: { activate: string; deactivate: string; delete: string };
  duplicate: string;
  savedView: string;
  importTitle: string;
  dispatchOutbox: string;
  toast: { activated: string; deactivated: string; deleted: string; dispatched: string };
  importError: string;
  matrixPanel: {
    title: string;
    description: string;
    normal: (n: string | number) => string;
    urgent: (n: string | number) => string;
    missing: string;
  };
  simulatorPanel: {
    title: string;
    description: string;
    filterPlaceholder: string;
    due: (date: string) => string;
    ack: (value: number, unit: string, date: string) => string;
    escalation: (l1: string, l2: string, l3: string) => string;
  };
  readinessPanel: {
    title: string;
    description: string;
    covered: string;
    missing: string;
  };
  clockMonitor: {
    title: string;
    description: string;
    requestIdPlaceholder: string;
    clockIdPlaceholder: string;
    byRequest: string;
    byClock: string;
    requestLookup: string;
    clockLookup: string;
    notSet: string;
    fallbackClock: string;
    unknown: string;
    clockMeta: (clockId: string, requestId: string) => string;
    acknowledged: string;
    acknowledgedAt: (date: string) => string;
    pendingAck: string;
    breached: string;
    breachedAt: (date: string) => string;
    onTrack: string;
    level: (n: number) => string;
    escalated: string;
    noEscalation: string;
    started: string;
    ackDue: string;
    turnaround: string;
    l1: string;
    l2: string;
    l3: string;
    acknowledge: string;
    escalate: string;
    emptyPrompt: string;
    toastLoaded: string;
    toastAcknowledged: string;
    toastEscalated: string;
  };
  form: {
    createTitle: string;
    editTitle: string;
    serviceCode: string;
    serviceCodePlaceholder: string;
    priority: string;
    turnaround: string;
    ackValue: string;
    ackUnit: string;
    escalationL1: string;
    escalationL2: string;
    escalationL3: string;
    active: string;
    identityLocked: string;
    errors: {
      serviceCodeRequired: string;
      turnaroundPositive: string;
      ackPositive: string;
    };
  };
}

const slaBundle: LexBilingual<SLALabels> = {
  en: {
    pageTitle: 'SLA Targets',
    pageDescription: 'Maintain turnaround, acknowledgement, and escalation budgets per service and priority.',
    create: 'New Target',
    emptyTitle: 'No SLA targets',
    emptyDescription: 'Define SLA targets so request clocks materialize on intake.',
    stats: { total: 'Targets', active: 'Active', urgent: 'Urgent tier' },
    columns: {
      service: 'Service code',
      priority: 'Priority',
      turnaround: 'Turnaround',
      ack: 'Acknowledge within',
      escalation: 'Escalation (L1/L2/L3)',
      status: 'Status',
    },
    priorities: { urgent: 'Urgent', normal: 'Normal' },
    ackUnits: { working_days: 'working days', working_hours: 'working hours' },
    daysSuffix: (n) => `${n} working days`,
    ackValue: (value, unit) => `${value} ${unit}`,
    escalationValue: (l1, l2, l3) => `${l1} / ${l2} / ${l3} days`,
    bulk: { activate: 'Activate', deactivate: 'Deactivate', delete: 'Delete' },
    duplicate: 'Duplicate',
    savedView: 'Save SLA view',
    importTitle: 'SLA target import preview',
    dispatchOutbox: 'Dispatch outbox',
    toast: {
      activated: 'SLA targets activated.',
      deactivated: 'SLA targets deactivated.',
      deleted: 'SLA targets deleted.',
      dispatched: 'SLA outbox dispatch requested.',
    },
    importError: 'Each service row must include code, request_type, and name/name_en/name_ar.',
    matrixPanel: {
      title: 'SLA matrix',
      description: 'Normal and urgent targets by service.',
      normal: (n) => `Normal ${n}`,
      urgent: (n) => `Urgent ${n}`,
      missing: 'missing',
    },
    simulatorPanel: {
      title: 'SLA simulator',
      description: 'Approximate due dates from the loaded target set.',
      filterPlaceholder: 'Filter service code',
      due: (date) => `Due ${date}`,
      ack: (value, unit, date) => `Ack ${value} ${unit} · ${date}`,
      escalation: (l1, l2, l3) => `L1 ${l1} · L2 ${l2} · L3 ${l3}`,
    },
    readinessPanel: {
      title: 'Escalation readiness',
      description: 'Role coverage for L1/L2/L3 escalation.',
      covered: 'Covered',
      missing: 'Missing',
    },
    clockMonitor: {
      title: 'SLA clock monitor',
      description: 'Choose a legal request or active SLA clock, then acknowledge or escalate it.',
      requestIdPlaceholder: 'Select a legal request',
      clockIdPlaceholder: 'Select an active SLA clock',
      byRequest: 'By request',
      byClock: 'By clock',
      requestLookup: 'Request lookup',
      clockLookup: 'Clock lookup',
      notSet: 'Not set',
      fallbackClock: 'SLA clock',
      unknown: 'unknown',
      clockMeta: (clockId, requestId) => `Clock ${clockId} · Request ${requestId}`,
      acknowledged: 'Acknowledged',
      acknowledgedAt: (date) => `Acknowledged · ${date}`,
      pendingAck: 'Pending ack',
      breached: 'Breached',
      breachedAt: (date) => `Breached · ${date}`,
      onTrack: 'On track',
      level: (n) => `Level ${n}`,
      escalated: 'Escalated',
      noEscalation: 'No escalation',
      started: 'Started',
      ackDue: 'Ack due',
      turnaround: 'Turnaround',
      l1: 'L1',
      l2: 'L2',
      l3: 'L3',
      acknowledge: 'Acknowledge',
      escalate: 'Escalate',
      emptyPrompt: 'Enter a request ID or clock ID to inspect the current SLA state.',
      toastLoaded: 'SLA clock loaded.',
      toastAcknowledged: 'SLA clock acknowledged.',
      toastEscalated: 'SLA clock escalated.',
    },
    form: {
      createTitle: 'Create SLA Target',
      editTitle: 'Edit SLA Target',
      serviceCode: 'Service code',
      serviceCodePlaceholder: 'CONTRACT_REVIEW',
      priority: 'Priority',
      turnaround: 'Turnaround (working days)',
      ackValue: 'Acknowledge window',
      ackUnit: 'Acknowledge unit',
      escalationL1: 'Escalation L1 (days after breach)',
      escalationL2: 'Escalation L2 (days after breach)',
      escalationL3: 'Escalation L3 (days after breach)',
      active: 'Active',
      identityLocked: 'Service code and priority are fixed once created.',
      errors: {
        serviceCodeRequired: 'Service code is required.',
        turnaroundPositive: 'Turnaround must be at least 1 day.',
        ackPositive: 'Acknowledgement window must be at least 1.',
      },
    },
  },
  ar: {
    pageTitle: 'أهداف اتفاقية مستوى الخدمة',
    pageDescription: 'إدارة ميزانيات الإنجاز والإقرار والتصعيد لكل خدمة وأولوية.',
    create: 'هدف جديد',
    emptyTitle: 'لا توجد أهداف',
    emptyDescription: 'حدّد أهداف اتفاقية الخدمة لتتكوّن ساعات الطلبات عند الاستقبال.',
    stats: { total: 'الأهداف', active: 'مُفعّلة', urgent: 'الفئة العاجلة' },
    columns: {
      service: 'رمز الخدمة',
      priority: 'الأولوية',
      turnaround: 'الإنجاز',
      ack: 'الإقرار خلال',
      escalation: 'التصعيد (م1/م2/م3)',
      status: 'الحالة',
    },
    priorities: { urgent: 'عاجل', normal: 'اعتيادي' },
    ackUnits: { working_days: 'أيام عمل', working_hours: 'ساعات عمل' },
    daysSuffix: (n) => `${n} أيام عمل`,
    ackValue: (value, unit) => `${value} ${unit}`,
    escalationValue: (l1, l2, l3) => `${l1} / ${l2} / ${l3} أيام`,
    bulk: { activate: 'تفعيل', deactivate: 'تعطيل', delete: 'حذف' },
    duplicate: 'مكرر',
    savedView: 'حفظ عرض اتفاقيات الخدمة',
    importTitle: 'معاينة استيراد أهداف اتفاقية الخدمة',
    dispatchOutbox: 'إرسال صندوق الصادر',
    toast: {
      activated: 'تم تفعيل أهداف اتفاقية الخدمة.',
      deactivated: 'تم تعطيل أهداف اتفاقية الخدمة.',
      deleted: 'تم حذف أهداف اتفاقية الخدمة.',
      dispatched: 'تم طلب إرسال صندوق صادر اتفاقية الخدمة.',
    },
    importError: 'يجب أن يتضمّن كل صف خدمة: الرمز ونوع الطلب والاسم/name_en/name_ar.',
    matrixPanel: {
      title: 'مصفوفة اتفاقية الخدمة',
      description: 'الأهداف الاعتيادية والعاجلة حسب الخدمة.',
      normal: (n) => `اعتيادي ${n}`,
      urgent: (n) => `عاجل ${n}`,
      missing: 'مفقود',
    },
    simulatorPanel: {
      title: 'محاكي اتفاقية الخدمة',
      description: 'تواريخ استحقاق تقريبية من مجموعة الأهداف المُحمَّلة.',
      filterPlaceholder: 'تصفية رمز الخدمة',
      due: (date) => `الاستحقاق ${date}`,
      ack: (value, unit, date) => `الإقرار ${value} ${unit} · ${date}`,
      escalation: (l1, l2, l3) => `م1 ${l1} · م2 ${l2} · م3 ${l3}`,
    },
    readinessPanel: {
      title: 'جاهزية التصعيد',
      description: 'تغطية الأدوار لتصعيد م1/م2/م3.',
      covered: 'مُغطّى',
      missing: 'مفقود',
    },
    clockMonitor: {
      title: 'مراقب ساعة اتفاقية الخدمة',
      description: 'اختر طلبًا قانونيًا أو ساعة اتفاقية خدمة نشطة، ثم أقرّها أو صعّدها.',
      requestIdPlaceholder: 'اختر طلبًا قانونيًا',
      clockIdPlaceholder: 'اختر ساعة اتفاقية خدمة نشطة',
      byRequest: 'حسب الطلب',
      byClock: 'حسب الساعة',
      requestLookup: 'بحث بالطلب',
      clockLookup: 'بحث بالساعة',
      notSet: 'غير محدد',
      fallbackClock: 'ساعة اتفاقية الخدمة',
      unknown: 'غير معروف',
      clockMeta: (clockId, requestId) => `الساعة ${clockId} · الطلب ${requestId}`,
      acknowledged: 'مُقَرّ',
      acknowledgedAt: (date) => `مُقَرّ · ${date}`,
      pendingAck: 'بانتظار الإقرار',
      breached: 'مُتجاوَز',
      breachedAt: (date) => `مُتجاوَز · ${date}`,
      onTrack: 'ضمن المسار',
      level: (n) => `المستوى ${n}`,
      escalated: 'مُصعَّد',
      noEscalation: 'لا يوجد تصعيد',
      started: 'بدأت',
      ackDue: 'استحقاق الإقرار',
      turnaround: 'الإنجاز',
      l1: 'م1',
      l2: 'م2',
      l3: 'م3',
      acknowledge: 'إقرار',
      escalate: 'تصعيد',
      emptyPrompt: 'أدخل رقم الطلب أو رقم الساعة لفحص حالة اتفاقية الخدمة الحالية.',
      toastLoaded: 'تم تحميل ساعة اتفاقية الخدمة.',
      toastAcknowledged: 'تم إقرار ساعة اتفاقية الخدمة.',
      toastEscalated: 'تم تصعيد ساعة اتفاقية الخدمة.',
    },
    form: {
      createTitle: 'إنشاء هدف خدمة',
      editTitle: 'تعديل هدف الخدمة',
      serviceCode: 'رمز الخدمة',
      serviceCodePlaceholder: 'CONTRACT_REVIEW',
      priority: 'الأولوية',
      turnaround: 'الإنجاز (أيام عمل)',
      ackValue: 'نافذة الإقرار',
      ackUnit: 'وحدة الإقرار',
      escalationL1: 'التصعيد م1 (أيام بعد التجاوز)',
      escalationL2: 'التصعيد م2 (أيام بعد التجاوز)',
      escalationL3: 'التصعيد م3 (أيام بعد التجاوز)',
      active: 'مُفعّل',
      identityLocked: 'رمز الخدمة والأولوية ثابتان بعد الإنشاء.',
      errors: {
        serviceCodeRequired: 'رمز الخدمة مطلوب.',
        turnaroundPositive: 'يجب أن يكون الإنجاز يومًا واحدًا على الأقل.',
        ackPositive: 'يجب أن تكون نافذة الإقرار 1 على الأقل.',
      },
    },
  },
};

export function useSLALabels(): SLALabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(slaBundle, locale), [locale]);
}

/* ========================================================================= *
 * Attachment Policies
 * ========================================================================= */

export interface AttachmentLabels {
  pageTitle: string;
  pageDescription: string;
  create: string;
  emptyTitle: string;
  emptyDescription: string;
  stats: { total: string; active: string; slots: string };
  columns: { name: string; appliesTo: string; minCount: string; slots: string; status: string };
  appliesToRequestType: (t: string) => string;
  appliesToService: (c: string) => string;
  appliesToAny: string;
  slotCount: (n: number) => string;
  evaluator: {
    title: string;
    description: string;
    evaluate: string;
    requestTypePlaceholder: string;
    serviceCodePlaceholder: string;
    providedCountPlaceholder: string;
    providedSlotsPlaceholder: string;
    complete: string;
    incomplete: string;
    count: (provided: number, required: number) => string;
    max: (n: number) => string;
    missingSlots: (slots: string) => string;
    allSatisfied: string;
  };
  checklist: {
    title: string;
    description: string;
    noFileCap: string;
    anyMime: string;
    provided: string;
    required: string;
    optional: string;
    emptyHint: string;
  };
  precedence: {
    title: string;
    description: string;
    empty: string;
    requiredSlots: (n: number) => string;
    min: (n: number) => string;
    max: (n: string | number) => string;
    unbounded: string;
  };
  inconsistencyWarning: (n: number) => string;
  savedView: string;
  importTitle: string;
  importDescription: string;
  bulk: { activate: string; deactivate: string; delete: string };
  toast: { activated: string; deactivated: string; deleted: (n: number) => string };
  filters: { requestType: string; serviceCode: string; status: string; activeOnly: string };
  form: {
    createTitle: string;
    editTitle: string;
    requestType: string;
    requestTypePlaceholder: string;
    serviceCode: string;
    serviceCodePlaceholder: string;
    appliesHint: string;
    minCount: string;
    maxCount: string;
    maxFileSize: string;
    maxFileSizePlaceholder: string;
    allowedTypes: string;
    allowedTypesPlaceholder: string;
    active: string;
    slotsTitle: string;
    slotsHint: string;
    slotKey: string;
    slotKeyPlaceholder: string;
    slotLabelAr: string;
    slotLabelEn: string;
    slotRequired: string;
    slotReorder: string;
    slotMoveUp: string;
    slotMoveDown: string;
    slotMimeTypes: string;
    slotMimePlaceholder: string;
    addSlot: string;
    consistency: {
      title: string;
      summary: (slots: number, min: number | string, max: string) => string;
      unbounded: string;
      maxFileSize: (size: string) => string;
    };
    errors: {
      nameRequired: string;
      scopeRequired: string;
      slotKeyRequired: string;
    };
  };
}

const attachmentBundle: LexBilingual<AttachmentLabels> = {
  en: {
    pageTitle: 'Attachment Policies',
    pageDescription: 'Declare the required documents and upload slots for each legal-request type or service.',
    create: 'New Policy',
    emptyTitle: 'No attachment policies',
    emptyDescription: 'Add a policy to enforce required documents at intake completeness.',
    stats: { total: 'Policies', active: 'Active', slots: 'Defined slots' },
    columns: { name: 'Policy', appliesTo: 'Applies to', minCount: 'Min count', slots: 'Slots', status: 'Status' },
    appliesToRequestType: (t) => `Request type: ${t}`,
    appliesToService: (c) => `Service: ${c}`,
    appliesToAny: 'Any request',
    slotCount: (n) => `${n} slots`,
    evaluator: {
      title: 'Policy evaluator',
      description: 'Test the resolved attachment policy for a request type or service code.',
      evaluate: 'Evaluate',
      requestTypePlaceholder: 'Request type',
      serviceCodePlaceholder: 'Service code',
      providedCountPlaceholder: 'Provided count',
      providedSlotsPlaceholder: 'Provided slot keys, comma or newline separated',
      complete: 'Complete',
      incomplete: 'Incomplete',
      count: (provided, required) => `Count ${provided}/${required}`,
      max: (n) => `Max ${n}`,
      missingSlots: (slots) => `Missing slots: ${slots}`,
      allSatisfied: 'All required slots are satisfied.',
    },
    checklist: {
      title: 'Intake upload checklist',
      description: 'Preview what request intake should ask for after policy precedence is applied.',
      noFileCap: 'No file cap',
      anyMime: 'Any MIME type',
      provided: 'Provided',
      required: 'Required',
      optional: 'Optional',
      emptyHint: 'Enter a request type or service code that matches a visible active policy.',
    },
    precedence: {
      title: 'Policy precedence',
      description: 'Service-code policies win over request-type policies; newest wins within the same scope.',
      empty: 'No active policies in the current view.',
      requiredSlots: (n) => `${n} required slots`,
      min: (n) => `Min ${n}`,
      max: (n) => `Max ${n}`,
      unbounded: 'unbounded',
    },
    inconsistencyWarning: (n) =>
      `${n} visible policies have min/max/required-slot inconsistencies. Edit them before enabling intake enforcement.`,
    savedView: 'Save policy view',
    importTitle: 'Attachment policy import preview',
    importDescription: 'JSON exports can be re-imported directly; CSV rows support simple scalar fields.',
    bulk: { activate: 'Activate', deactivate: 'Deactivate', delete: 'Delete' },
    toast: {
      activated: 'Policies activated.',
      deactivated: 'Policies deactivated.',
      deleted: (n) => `${n} policies deleted.`,
    },
    filters: { requestType: 'Request type', serviceCode: 'Service code', status: 'Status', activeOnly: 'Active only' },
    form: {
      createTitle: 'Create Policy',
      editTitle: 'Edit Policy',
      requestType: 'Request type',
      requestTypePlaceholder: 'contract_review',
      serviceCode: 'Service code',
      serviceCodePlaceholder: 'CONTRACT_REVIEW',
      appliesHint: 'Key the policy by request type OR service code (one is required).',
      minCount: 'Minimum attachments',
      maxCount: 'Maximum attachments (0 = unlimited)',
      maxFileSize: 'Max file size (bytes, 0 = default)',
      maxFileSizePlaceholder: '10 MB',
      allowedTypes: 'Allowed content types',
      allowedTypesPlaceholder: 'application/pdf, application/vnd…',
      active: 'Active',
      slotsTitle: 'Upload slots',
      slotsHint: 'Named, optionally-required upload positions shown at intake.',
      slotKey: 'Slot key',
      slotKeyPlaceholder: 'signed_power_of_attorney',
      slotLabelAr: 'Slot label (Arabic)',
      slotLabelEn: 'Slot label (English)',
      slotRequired: 'Required',
      slotReorder: 'Reorder slot',
      slotMoveUp: 'Move slot up',
      slotMoveDown: 'Move slot down',
      slotMimeTypes: 'Slot MIME types',
      slotMimePlaceholder: 'Defaults to policy MIME types',
      addSlot: 'Add slot',
      consistency: {
        title: 'Policy consistency',
        summary: (slots, min, max) => `${slots} required slots, min ${min}, max ${max}`,
        unbounded: 'unbounded',
        maxFileSize: (size) => `Max file size ${size}`,
      },
      errors: {
        nameRequired: 'An English or Arabic name is required.',
        scopeRequired: 'Provide a request type or a service code.',
        slotKeyRequired: 'Slot key is required.',
      },
    },
  },
  ar: {
    pageTitle: 'سياسات المرفقات',
    pageDescription: 'حدّد المستندات المطلوبة وخانات الرفع لكل نوع طلب قانوني أو خدمة.',
    create: 'سياسة جديدة',
    emptyTitle: 'لا توجد سياسات مرفقات',
    emptyDescription: 'أضف سياسة لفرض المستندات المطلوبة عند اكتمال الاستقبال.',
    stats: { total: 'السياسات', active: 'مُفعّلة', slots: 'الخانات المعرّفة' },
    columns: { name: 'السياسة', appliesTo: 'تنطبق على', minCount: 'الحد الأدنى', slots: 'الخانات', status: 'الحالة' },
    appliesToRequestType: (t) => `نوع الطلب: ${t}`,
    appliesToService: (c) => `الخدمة: ${c}`,
    appliesToAny: 'أي طلب',
    slotCount: (n) => `${n} خانات`,
    evaluator: {
      title: 'مُقيّم السياسة',
      description: 'اختبر سياسة المرفقات المُستنتَجة لنوع طلب أو رمز خدمة.',
      evaluate: 'تقييم',
      requestTypePlaceholder: 'نوع الطلب',
      serviceCodePlaceholder: 'رمز الخدمة',
      providedCountPlaceholder: 'العدد المقدَّم',
      providedSlotsPlaceholder: 'مفاتيح الخانات المقدَّمة، مفصولة بفواصل أو أسطر',
      complete: 'مكتمل',
      incomplete: 'غير مكتمل',
      count: (provided, required) => `العدد ${provided}/${required}`,
      max: (n) => `الحد الأقصى ${n}`,
      missingSlots: (slots) => `الخانات المفقودة: ${slots}`,
      allSatisfied: 'جميع الخانات المطلوبة مُستوفاة.',
    },
    checklist: {
      title: 'قائمة تحقّق رفع المرفقات',
      description: 'معاينة ما يجب أن يطلبه استقبال الطلب بعد تطبيق أسبقية السياسات.',
      noFileCap: 'لا حد لحجم الملف',
      anyMime: 'أي نوع MIME',
      provided: 'مقدَّم',
      required: 'مطلوب',
      optional: 'اختياري',
      emptyHint: 'أدخل نوع طلب أو رمز خدمة يطابق سياسة نشطة ظاهرة.',
    },
    precedence: {
      title: 'أسبقية السياسات',
      description: 'سياسات رمز الخدمة تتقدّم على سياسات نوع الطلب؛ والأحدث يفوز ضمن النطاق نفسه.',
      empty: 'لا توجد سياسات نشطة في العرض الحالي.',
      requiredSlots: (n) => `${n} خانات مطلوبة`,
      min: (n) => `الحد الأدنى ${n}`,
      max: (n) => `الحد الأقصى ${n}`,
      unbounded: 'بلا حد',
    },
    inconsistencyWarning: (n) =>
      `يوجد ${n} سياسات ظاهرة بها تعارضات في الحد الأدنى/الأقصى/الخانات المطلوبة. عدّلها قبل تفعيل إلزام الاستقبال.`,
    savedView: 'حفظ عرض السياسة',
    importTitle: 'معاينة استيراد سياسات المرفقات',
    importDescription: 'يمكن إعادة استيراد ملفات JSON المصدَّرة مباشرة؛ وتدعم صفوف CSV الحقول البسيطة.',
    bulk: { activate: 'تفعيل', deactivate: 'تعطيل', delete: 'حذف' },
    toast: {
      activated: 'تم تفعيل السياسات.',
      deactivated: 'تم تعطيل السياسات.',
      deleted: (n) => `تم حذف ${n} سياسات.`,
    },
    filters: { requestType: 'نوع الطلب', serviceCode: 'رمز الخدمة', status: 'الحالة', activeOnly: 'النشطة فقط' },
    form: {
      createTitle: 'إنشاء سياسة',
      editTitle: 'تعديل السياسة',
      requestType: 'نوع الطلب',
      requestTypePlaceholder: 'contract_review',
      serviceCode: 'رمز الخدمة',
      serviceCodePlaceholder: 'CONTRACT_REVIEW',
      appliesHint: 'اربط السياسة بنوع الطلب أو برمز الخدمة (أحدهما مطلوب).',
      minCount: 'الحد الأدنى للمرفقات',
      maxCount: 'الحد الأقصى للمرفقات (0 = غير محدود)',
      maxFileSize: 'الحجم الأقصى للملف (بايت، 0 = افتراضي)',
      maxFileSizePlaceholder: '10 MB',
      allowedTypes: 'أنواع المحتوى المسموحة',
      allowedTypesPlaceholder: 'application/pdf, application/vnd…',
      active: 'مُفعّل',
      slotsTitle: 'خانات الرفع',
      slotsHint: 'مواضع رفع مسمّاة، مطلوبة اختياريًا، تُعرض عند الاستقبال.',
      slotKey: 'مفتاح الخانة',
      slotKeyPlaceholder: 'signed_power_of_attorney',
      slotLabelAr: 'تسمية الخانة (عربي)',
      slotLabelEn: 'تسمية الخانة (إنجليزي)',
      slotRequired: 'مطلوبة',
      slotReorder: 'إعادة ترتيب الخانة',
      slotMoveUp: 'تحريك الخانة لأعلى',
      slotMoveDown: 'تحريك الخانة لأسفل',
      slotMimeTypes: 'أنواع MIME للخانة',
      slotMimePlaceholder: 'الافتراضي: أنواع MIME للسياسة',
      addSlot: 'إضافة خانة',
      consistency: {
        title: 'اتساق السياسة',
        summary: (slots, min, max) => `${slots} خانات مطلوبة، الحد الأدنى ${min}، الحد الأقصى ${max}`,
        unbounded: 'بلا حد',
        maxFileSize: (size) => `الحجم الأقصى للملف ${size}`,
      },
      errors: {
        nameRequired: 'الاسم بالإنجليزية أو العربية مطلوب.',
        scopeRequired: 'أدخل نوع طلب أو رمز خدمة.',
        slotKeyRequired: 'مفتاح الخانة مطلوب.',
      },
    },
  },
};

export function useAttachmentLabels(): AttachmentLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(attachmentBundle, locale), [locale]);
}

/* ========================================================================= *
 * Org Registry
 * ========================================================================= */

export interface OrgLabels {
  pageTitle: string;
  pageDescription: string;
  create: string;
  emptyTitle: string;
  emptyDescription: string;
  stats: { total: string; active: string; departments: string };
  columns: { name: string; code: string; type: string; roles: string; status: string };
  entityTypes: Record<string, string>;
  filters: {
    status: string;
    active: string;
    inactive: string;
    entityType: string;
    parent: string;
  };
  roleKeys: Record<string, string>;
  rolesCount: (n: number) => string;
  escalationMissing: (n: number) => string;
  escalationReady: string;
  escalationHint: {
    chipTooltip: (roles: string) => string;
    title: string;
    description: string;
    assign: (role: string) => string;
  };
  noParent: string;
  bulk: { activate: string; deactivate: string; delete: string };
  toast: { deleted: string; activated: string; deactivated: string };
  form: {
    createTitle: string;
    editTitle: string;
    code: string;
    codePlaceholder: string;
    entityType: string;
    parent: string;
    parentNone: string;
    active: string;
    platformLink: string;
    platformLinkPlaceholder: string;
    platformSyncTitle: string;
    platformSyncDescription: string;
    errors: {
      codeRequired: string;
      nameRequired: string;
      platformUnitInvalid: string;
    };
  };
  detail: {
    loadingTitle: string;
    errorMessage: string;
    overviewTitle: string;
    overviewDescription: string;
    metricType: string;
    metricStatus: string;
    metricRoles: string;
    metricCode: string;
    rolesTitle: string;
    rolesDescription: string;
    rolesEmpty: string;
    addRole: string;
    escalationTitle: string;
    escalationDescription: string;
    escalationEmpty: string;
    level: (n: number) => string;
  };
  roleDialog: {
    title: string;
    roleKey: string;
    user: string;
    selectUser: string;
    searchUsers: string;
    loadingUsers: string;
    noUsers: string;
    usersLoadError: string;
    retryUsers: string;
    labelAr: string;
    labelEn: string;
    add: string;
    toastAdded: string;
    toastRemoved: string;
    errors: { userRequired: string };
  };
  deleteImpact: {
    title: string;
    description: (label: string) => string;
    descriptionFallback: string;
    children: string;
    descendants: string;
    roles: string;
    escalation: string;
    impactFoundTitle: string;
    impactFoundBody: string;
    noDepsTitle: string;
    noDepsBody: string;
    currentLadder: string;
    ladderItem: (level: number, roleKey: string) => string;
    bulkTitle: string;
    bulkDescription: (count: number) => string;
    selected: string;
    bulkImpactTitle: string;
    bulkImpactBody: string;
    bulkNoDepsTitle: string;
    bulkNoDepsBody: string;
  };
}

const orgBundle: LexBilingual<OrgLabels> = {
  en: {
    pageTitle: 'Org Registry',
    pageDescription: 'Maintain the legal-org master-data tree and the escalation-role bindings it drives.',
    create: 'New Entity',
    emptyTitle: 'No org entities',
    emptyDescription: 'Register legal-org entities to power eligibility and SLA escalation.',
    stats: { total: 'Entities', active: 'Active', departments: 'Departments' },
    columns: { name: 'Entity', code: 'Code', type: 'Type', roles: 'Roles', status: 'Status' },
    entityTypes: {
      company: 'Company',
      business_unit: 'Business unit',
      department: 'Department',
      section: 'Section',
      shared_services_unit: 'Shared services unit',
    },
    filters: {
      status: 'Status',
      active: 'Active',
      inactive: 'Inactive',
      entityType: 'Type',
      parent: 'Parent entity',
    },
    roleKeys: {
      section_supervisor: 'Section supervisor',
      department_manager: 'Department manager',
      shared_services_manager: 'Shared-services manager',
      legal_director: 'Legal director',
      contracts_manager: 'Contracts manager',
      compliance_officer: 'Compliance officer',
      general_counsel: 'General counsel',
    },
    rolesCount: (n) => `${n} roles`,
    escalationMissing: (n) => `Missing ${n}`,
    escalationReady: 'Escalation ready',
    escalationHint: {
      chipTooltip: (roles) => `Escalation roles not yet assigned: ${roles}. Click to configure.`,
      title: 'Escalation coverage incomplete',
      description:
        'Assign the missing roles below so SLA escalations can resolve recipients for this entity.',
      assign: (role) => `Assign ${role}`,
    },
    noParent: 'Root entity',
    bulk: { activate: 'Activate', deactivate: 'Deactivate', delete: 'Delete' },
    toast: {
      deleted: 'Org entities deleted.',
      activated: 'Org entities activated.',
      deactivated: 'Org entities deactivated.',
    },
    form: {
      createTitle: 'Create Entity',
      editTitle: 'Edit Entity',
      code: 'Code',
      codePlaceholder: 'LEGAL_DEPT',
      entityType: 'Entity type',
      parent: 'Parent entity',
      parentNone: 'None (root)',
      active: 'Active',
      platformLink: 'Platform org-unit link',
      platformLinkPlaceholder: 'Select a platform org unit (optional)',
      platformSyncTitle: 'Platform sync surface',
      platformSyncDescription:
        'Link this legal entity to the matching platform org-unit when the platform directory already owns the source hierarchy.',
      errors: {
        codeRequired: 'Code is required.',
        nameRequired: 'An English or Arabic name is required.',
        platformUnitInvalid: 'Select a valid platform org unit or leave it blank.',
      },
    },
    detail: {
      loadingTitle: 'Entity',
      errorMessage: 'Failed to load entity details.',
      overviewTitle: 'Entity Overview',
      overviewDescription: 'Master-data attributes and hierarchy placement.',
      metricType: 'Type',
      metricStatus: 'Status',
      metricRoles: 'Roles',
      metricCode: 'Code',
      rolesTitle: 'Responsibility roles',
      rolesDescription: 'Role bindings that supply escalation recipients and addressable targets.',
      rolesEmpty: 'No roles assigned.',
      addRole: 'Assign role',
      escalationTitle: 'Escalation ladder',
      escalationDescription: 'The resolved L1/L2/L3 recipients walking up the ancestry path.',
      escalationEmpty: 'No escalation recipients could be resolved for this entity.',
      level: (n) => `Level ${n}`,
    },
    roleDialog: {
      title: 'Assign role',
      roleKey: 'Role',
      user: 'User',
      selectUser: 'Select a user',
      searchUsers: 'Search by name or email…',
      loadingUsers: 'Loading users…',
      noUsers: 'No active users found.',
      usersLoadError: 'Could not load the user directory.',
      retryUsers: 'Retry',
      labelAr: 'Label (Arabic)',
      labelEn: 'Label (English)',
      add: 'Assign',
      toastAdded: 'Role assigned.',
      toastRemoved: 'Role removed.',
      errors: { userRequired: 'Select a user.' },
    },
    deleteImpact: {
      title: 'Delete org entity',
      description: (label) => `Review loaded dependency impact before deleting "${label}".`,
      descriptionFallback: 'Review loaded dependency impact before deleting this org entity.',
      children: 'Children',
      descendants: 'Descendants',
      roles: 'Roles',
      escalation: 'Escalation',
      impactFoundTitle: 'Impact found',
      impactFoundBody:
        'Deleting this entity removes its local roles and may affect escalation for the loaded branch. The backend still enforces referential checks when submitted.',
      noDepsTitle: 'No loaded dependencies found',
      noDepsBody: 'No child entities or local role bindings were found in the loaded org data.',
      currentLadder: 'Current ladder',
      ladderItem: (level, roleKey) => `L${level} ${roleKey}`,
      bulkTitle: 'Delete selected org entities',
      bulkDescription: (count) => `Review loaded dependency impact before deleting ${count} selected entities.`,
      selected: 'Selected',
      bulkImpactTitle: 'Bulk impact found',
      bulkImpactBody:
        'Some selected entities have loaded children or role bindings. The backend remains authoritative for referential checks.',
      bulkNoDepsTitle: 'No loaded dependencies found',
      bulkNoDepsBody: 'No child entities or local role bindings were found for the selection.',
    },
  },
  ar: {
    pageTitle: 'السجل التنظيمي',
    pageDescription: 'إدارة شجرة البيانات الرئيسية للجهات القانونية وروابط أدوار التصعيد التي تشغّلها.',
    create: 'جهة جديدة',
    emptyTitle: 'لا توجد جهات تنظيمية',
    emptyDescription: 'سجّل الجهات التنظيمية القانونية لتشغيل الأهلية وتصعيد اتفاقيات الخدمة.',
    stats: { total: 'الجهات', active: 'مُفعّلة', departments: 'الإدارات' },
    columns: { name: 'الجهة', code: 'الرمز', type: 'النوع', roles: 'الأدوار', status: 'الحالة' },
    entityTypes: {
      company: 'شركة',
      business_unit: 'وحدة أعمال',
      department: 'إدارة',
      section: 'قسم',
      shared_services_unit: 'وحدة خدمات مشتركة',
    },
    filters: {
      status: 'الحالة',
      active: 'نشط',
      inactive: 'غير نشط',
      entityType: 'النوع',
      parent: 'الكيان الأصل',
    },
    roleKeys: {
      section_supervisor: 'مشرف القسم',
      department_manager: 'مدير الإدارة',
      shared_services_manager: 'مدير الخدمات المشتركة',
      legal_director: 'المدير القانوني',
      contracts_manager: 'مدير العقود',
      compliance_officer: 'مسؤول الامتثال',
      general_counsel: 'المستشار العام',
    },
    rolesCount: (n) => `${n} أدوار`,
    escalationMissing: (n) => `ناقص ${n}`,
    escalationReady: 'جاهز للتصعيد',
    escalationHint: {
      chipTooltip: (roles) => `أدوار تصعيد غير مُسندة بعد: ${roles}. انقر للإعداد.`,
      title: 'تغطية التصعيد غير مكتملة',
      description: 'أسنِد الأدوار الناقصة أدناه ليتمكّن تصعيد اتفاقيات مستوى الخدمة من حلّ المستلمين لهذه الجهة.',
      assign: (role) => `إسناد ${role}`,
    },
    noParent: 'جهة جذرية',
    bulk: { activate: 'تفعيل', deactivate: 'تعطيل', delete: 'حذف' },
    toast: {
      deleted: 'تم حذف الجهات التنظيمية.',
      activated: 'تم تفعيل الجهات التنظيمية.',
      deactivated: 'تم تعطيل الجهات التنظيمية.',
    },
    form: {
      createTitle: 'إنشاء جهة',
      editTitle: 'تعديل الجهة',
      code: 'الرمز',
      codePlaceholder: 'LEGAL_DEPT',
      entityType: 'نوع الجهة',
      parent: 'الجهة الأم',
      parentNone: 'لا شيء (جذر)',
      active: 'مُفعّل',
      platformLink: 'ربط وحدة تنظيمية بالمنصة',
      platformLinkPlaceholder: 'اختر وحدة تنظيمية بالمنصة (اختياري)',
      platformSyncTitle: 'سطح المزامنة مع المنصة',
      platformSyncDescription:
        'اربط هذه الجهة القانونية بالوحدة التنظيمية المقابلة في المنصة عندما يمتلك دليل المنصة التسلسل الهرمي المصدر بالفعل.',
      errors: {
        codeRequired: 'الرمز مطلوب.',
        nameRequired: 'الاسم بالإنجليزية أو العربية مطلوب.',
        platformUnitInvalid: 'اختر وحدة تنظيمية صالحة بالمنصة أو اترك الحقل فارغًا.',
      },
    },
    detail: {
      loadingTitle: 'الجهة',
      errorMessage: 'تعذّر تحميل تفاصيل الجهة.',
      overviewTitle: 'نظرة عامة على الجهة',
      overviewDescription: 'سمات البيانات الرئيسية وموضعها في التسلسل الهرمي.',
      metricType: 'النوع',
      metricStatus: 'الحالة',
      metricRoles: 'الأدوار',
      metricCode: 'الرمز',
      rolesTitle: 'أدوار المسؤولية',
      rolesDescription: 'روابط الأدوار التي توفّر مستلمي التصعيد والأهداف القابلة للمخاطبة.',
      rolesEmpty: 'لا توجد أدوار مُسندة.',
      addRole: 'إسناد دور',
      escalationTitle: 'سلّم التصعيد',
      escalationDescription: 'المستلمون المحلولون م1/م2/م3 صعودًا في مسار التسلسل.',
      escalationEmpty: 'تعذّر حل أي مستلمي تصعيد لهذه الجهة.',
      level: (n) => `المستوى ${n}`,
    },
    roleDialog: {
      title: 'إسناد دور',
      roleKey: 'الدور',
      user: 'المستخدم',
      selectUser: 'اختر مستخدمًا',
      searchUsers: 'ابحث بالاسم أو البريد الإلكتروني…',
      loadingUsers: 'جارٍ تحميل المستخدمين…',
      noUsers: 'لم يتم العثور على مستخدمين نشطين.',
      usersLoadError: 'تعذّر تحميل دليل المستخدمين.',
      retryUsers: 'إعادة المحاولة',
      labelAr: 'التسمية (عربي)',
      labelEn: 'التسمية (إنجليزي)',
      add: 'إسناد',
      toastAdded: 'تم إسناد الدور.',
      toastRemoved: 'تمت إزالة الدور.',
      errors: { userRequired: 'اختر مستخدمًا.' },
    },
    deleteImpact: {
      title: 'حذف جهة تنظيمية',
      description: (label) => `راجع أثر الاعتماديات المُحمَّلة قبل حذف "${label}".`,
      descriptionFallback: 'راجع أثر الاعتماديات المُحمَّلة قبل حذف هذه الجهة التنظيمية.',
      children: 'الجهات الفرعية',
      descendants: 'الجهات المتفرّعة',
      roles: 'الأدوار',
      escalation: 'التصعيد',
      impactFoundTitle: 'تم العثور على أثر',
      impactFoundBody:
        'حذف هذه الجهة يُزيل أدوارها المحلية وقد يؤثّر على التصعيد للفرع المُحمَّل. ولا تزال الخدمة الخلفية تُطبّق فحوص الإسناد عند الإرسال.',
      noDepsTitle: 'لم يُعثر على اعتماديات مُحمَّلة',
      noDepsBody: 'لم يُعثر على جهات فرعية أو ارتباطات أدوار محلية في بيانات الهيكل المُحمَّلة.',
      currentLadder: 'السلّم الحالي',
      ladderItem: (level, roleKey) => `م${level} ${roleKey}`,
      bulkTitle: 'حذف الجهات التنظيمية المحددة',
      bulkDescription: (count) => `راجع أثر الاعتماديات المُحمَّلة قبل حذف ${count} جهات محددة.`,
      selected: 'المحدد',
      bulkImpactTitle: 'تم العثور على أثر جماعي',
      bulkImpactBody:
        'بعض الجهات المحددة لديها جهات فرعية أو ارتباطات أدوار مُحمَّلة. وتبقى الخدمة الخلفية المرجع لفحوص الإسناد.',
      bulkNoDepsTitle: 'لم يُعثر على اعتماديات مُحمَّلة',
      bulkNoDepsBody: 'لم يُعثر على جهات فرعية أو ارتباطات أدوار محلية للمجموعة المحددة.',
    },
  },
};

export function useOrgLabels(): OrgLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(orgBundle, locale), [locale]);
}

/* ========================================================================= *
 * Case Classifications (taxonomy tree)
 * ========================================================================= */

export interface ClassificationLabels {
  pageTitle: string;
  pageDescription: string;
  create: string;
  addChild: string;
  emptyTitle: string;
  emptyDescription: string;
  stats: { total: string; roots: string; system: string };
  systemBadge: string;
  inactiveBadge: string;
  systemProtected: string;
  expandAll: string;
  collapseAll: string;
  jumpTo: string;
  matterReferences: string;
  translationCoverage: string;
  matterCount: (n: number) => string;
  kpi: {
    active: string;
  };
  cascade: {
    title: string;
    chainDepth: string;
    descendants: string;
    activeDescendants: string;
    merge: string;
    clear: string;
    noData: string;
    loading: string;
  };
  deleteDialog: {
    title: string;
    description: (label: string) => string;
    descriptionGeneric: string;
    children: string;
    descendants: string;
    matters: string;
    cascadeDepth: string;
    cascadeLabel: string;
    blockedTitle: string;
    blockedSystem: string;
    blockedChildren: string;
    blockedInUse: (n: number) => string;
    noDepsTitle: string;
    noDeps: string;
    enforceNote: string;
  };
  filters: {
    allStatus: string;
    active: string;
    inactive: string;
    allTypes: string;
    system: string;
    custom: string;
    allTranslations: string;
    missingEn: string;
    missingAr: string;
    reset: string;
  };
  emptyState: {
    noMatchesTitle: string;
    noMatchesDesc: string;
  };
  results: {
    showingXofY: (shown: number, total: number) => string;
  };
  treeActions: {
    moveUp: string;
    moveDown: string;
    addChild: string;
    edit: string;
    delete: string;
    preview: string;
    systemLocked: string;
  };
  warnings: {
    title: string;
    duplicateCode: (code: string, count: number) => string;
    sharedSort: (sort: number, count: number, parentClause: string) => string;
    sharedSortUnderParent: (parentId: string) => string;
    sharedSortRoot: string;
    moreHidden: (n: number) => string;
  };
  datasetActions: {
    saveView: string;
    importTitle: string;
    importDescription: string;
    template: string;
  };
  appearancePicker: {
    color: string;
    icon: string;
    clearColor: string;
    clearIcon: string;
    colorLabel: (label: string) => string;
    iconLabel: (label: string) => string;
  };
  toast: {
    deleted: (label: string) => string;
    undo: string;
    bulkDeleted: (n: number) => string;
    bulkSkipped: (base: string, skipped: number) => string;
    reassigned: (n: number) => string;
    noSnapshot: string;
    importBlockedCycle: string;
    rowMissingCode: (row: number) => string;
    rowMissingName: (row: number) => string;
    rowSelfParent: (code: string) => string;
  };
  form: {
    createTitle: string;
    editTitle: string;
    code: string;
    codePlaceholder: string;
    parent: string;
    parentNone: string;
    sort: string;
    active: string;
    appearance: string;
    systemParentLockedTitle: string;
    systemParentLocked: string;
    duplicateCodeTitle: string;
    duplicateCode: string;
    sortConflictTitle: string;
    sortConflict: (sort: number, codes: string) => string;
    moveImpactTitle: string;
    moveImpact: (descendants: number) => string;
    moveImpactInactiveParent: string;
    inactiveSuffix: (label: string) => string;
    timelineTitle: string;
    noTimeline: string;
    noSnapshots: string;
    restore: string;
    unknownDate: string;
    errors: {
      codeRequired: string;
      nameRequired: string;
    };
  };
}

const classificationBundle: LexBilingual<ClassificationLabels> = {
  en: {
    pageTitle: 'Case Classifications',
    pageDescription: 'Manage the extensible case-classification taxonomy that drives cascade chains.',
    create: 'New Classification',
    addChild: 'Add child',
    emptyTitle: 'No classifications',
    emptyDescription: 'Add classifications to organize legal cases into a taxonomy.',
    stats: { total: 'Classifications', roots: 'Root nodes', system: 'System nodes' },
    systemBadge: 'System',
    inactiveBadge: 'Inactive',
    systemProtected: 'System classifications cannot be deleted.',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    jumpTo: 'Jump to',
    matterReferences: 'Matter references',
    translationCoverage: 'Translation coverage',
    matterCount: (n) => (n === 1 ? '1 matter' : `${n} matters`),
    kpi: {
      active: 'Active',
    },
    cascade: {
      title: 'Cascade preview',
      chainDepth: 'Chain depth',
      descendants: 'Descendants',
      activeDescendants: 'Active descendants',
      merge: 'Merge',
      clear: 'Clear',
      noData: 'No cascade data returned.',
      loading: 'Loading cascade…',
    },
    deleteDialog: {
      title: 'Delete classification',
      description: (label) => `Review dependency impact before deleting "${label}".`,
      descriptionGeneric: 'Review dependency impact before deleting this classification.',
      children: 'Children',
      descendants: 'Descendants',
      matters: 'Matters',
      cascadeDepth: 'Cascade depth',
      cascadeLabel: 'Cascade',
      blockedTitle: 'Delete blocked',
      blockedSystem: 'System classifications are protected.',
      blockedChildren: 'Move or delete child classifications before deleting this node.',
      blockedInUse: (n) =>
        `${n === 1 ? '1 matter references' : `${n} matters reference`} this classification. Merge it into another classification before deleting.`,
      noDepsTitle: 'No child dependencies found',
      noDeps: 'The backend still enforces referential checks when the delete is submitted.',
      enforceNote: 'The backend still enforces referential checks when the delete is submitted.',
    },
    filters: {
      allStatus: 'All status',
      active: 'Active',
      inactive: 'Inactive',
      allTypes: 'All types',
      system: 'System',
      custom: 'Custom',
      allTranslations: 'All translations',
      missingEn: 'Missing English',
      missingAr: 'Missing Arabic',
      reset: 'Reset',
    },
    emptyState: {
      noMatchesTitle: 'No matches',
      noMatchesDesc: 'No classifications match the current filters.',
    },
    results: {
      showingXofY: (shown, total) => `Showing ${shown} of ${total} classifications.`,
    },
    treeActions: {
      moveUp: 'Move up',
      moveDown: 'Move down',
      addChild: 'Add child',
      edit: 'Edit classification',
      delete: 'Delete classification',
      preview: 'Preview cascade',
      systemLocked: 'System classifications cannot be deleted.',
    },
    warnings: {
      title: 'Taxonomy warnings',
      duplicateCode: (code, count) => `Duplicate code "${code}" appears ${count} times.`,
      sharedSort: (sort, count, parentClause) =>
        `Sort order ${sort} is shared by ${count} classifications ${parentClause}.`,
      sharedSortUnderParent: (parentId) => `under parent ${parentId}`,
      sharedSortRoot: 'at root level',
      moreHidden: (n) => `${n} more warnings hidden.`,
    },
    datasetActions: {
      saveView: 'Save view',
      importTitle: 'Import classifications',
      importDescription:
        'Upload CSV or JSON with code, name_en/name_ar, parent_code or parent_id, sort, and active.',
      template: 'Template',
    },
    appearancePicker: {
      color: 'Color',
      icon: 'Icon',
      clearColor: 'Clear color',
      clearIcon: 'Clear icon',
      colorLabel: (label) => `Color ${label}`,
      iconLabel: (label) => `Icon ${label}`,
    },
    toast: {
      deleted: (label) => `Deleted "${label}".`,
      undo: 'Undo',
      bulkDeleted: (n) => (n === 1 ? 'Deleted 1 classification.' : `Deleted ${n} classifications.`),
      bulkSkipped: (base, skipped) => `${base} ${skipped} skipped (system, in-use, or has children).`,
      reassigned: (n) =>
        n === 1
          ? '1 matter reassigned to the target classification.'
          : `${n} matters reassigned to the target classification.`,
      noSnapshot: 'No local snapshot is available to restore this classification.',
      importBlockedCycle: 'Import blocked by missing or cyclic parent references.',
      rowMissingCode: (row) => `Row ${row} is missing code.`,
      rowMissingName: (row) => `Row ${row} is missing an English or Arabic name.`,
      rowSelfParent: (code) => `Row for ${code} cannot use itself as parent.`,
    },
    form: {
      createTitle: 'Create Classification',
      editTitle: 'Edit Classification',
      code: 'Code',
      codePlaceholder: 'EVICTION',
      parent: 'Parent classification',
      parentNone: 'None (root)',
      sort: 'Sort order',
      active: 'Active',
      appearance: 'Appearance',
      systemParentLockedTitle: 'System parent locked',
      systemParentLocked: 'System classifications can be renamed or reordered, but cannot be reparented.',
      duplicateCodeTitle: 'Duplicate code',
      duplicateCode: 'A classification with this code already exists.',
      sortConflictTitle: 'Sort conflict',
      sortConflict: (sort, codes) =>
        `Sort order ${sort} is already used by ${codes} in this parent branch.`,
      moveImpactTitle: 'Move impact',
      moveImpact: (descendants) =>
        `Saving will move this classification${descendants ? ` and re-path ${descendants} descendants` : ''}.`,
      moveImpactInactiveParent: 'The selected parent is inactive.',
      inactiveSuffix: (label) => `${label} (Inactive)`,
      timelineTitle: 'Timeline & snapshots',
      noTimeline: 'No timeline dates available.',
      noSnapshots: 'No local snapshots captured yet.',
      restore: 'Restore',
      unknownDate: 'Unknown',
      errors: {
        codeRequired: 'Code is required.',
        nameRequired: 'An English or Arabic name is required.',
      },
    },
  },
  ar: {
    pageTitle: 'تصنيفات القضايا',
    pageDescription: 'إدارة التصنيف الهرمي القابل للتوسعة للقضايا الذي يشغّل سلاسل التتالي.',
    create: 'تصنيف جديد',
    addChild: 'إضافة فرع',
    emptyTitle: 'لا توجد تصنيفات',
    emptyDescription: 'أضف تصنيفات لتنظيم القضايا القانونية في بنية هرمية.',
    stats: { total: 'التصنيفات', roots: 'العقد الجذرية', system: 'عقد النظام' },
    systemBadge: 'نظام',
    inactiveBadge: 'مُعطّل',
    systemProtected: 'لا يمكن حذف تصنيفات النظام.',
    expandAll: 'توسيع الكل',
    collapseAll: 'طيّ الكل',
    jumpTo: 'الانتقال إلى',
    matterReferences: 'إحالات القضايا',
    translationCoverage: 'نسبة اكتمال الترجمة',
    matterCount: (n) => (n === 1 ? 'قضية واحدة' : `${n} قضايا`),
    kpi: {
      active: 'مُفعّلة',
    },
    cascade: {
      title: 'معاينة التتالي',
      chainDepth: 'عمق السلسلة',
      descendants: 'العناصر التابعة',
      activeDescendants: 'العناصر التابعة المُفعّلة',
      merge: 'دمج',
      clear: 'مسح',
      noData: 'لا توجد بيانات تتالٍ.',
      loading: 'جارٍ تحميل التتالي…',
    },
    deleteDialog: {
      title: 'حذف التصنيف',
      description: (label) => `راجِع أثر التبعية قبل حذف "${label}".`,
      descriptionGeneric: 'راجِع أثر التبعية قبل حذف هذا التصنيف.',
      children: 'الفروع المباشرة',
      descendants: 'العناصر التابعة',
      matters: 'القضايا',
      cascadeDepth: 'عمق التتالي',
      cascadeLabel: 'التتالي',
      blockedTitle: 'تعذّر الحذف',
      blockedSystem: 'تصنيفات النظام محمية.',
      blockedChildren: 'انقل أو احذف التصنيفات الفرعية قبل حذف هذه العقدة.',
      blockedInUse: (n) =>
        `${n === 1 ? 'تُحيل قضية واحدة' : `تُحيل ${n} قضايا`} إلى هذا التصنيف. ادمجه في تصنيف آخر قبل الحذف.`,
      noDepsTitle: 'لا توجد تبعيات فرعية',
      noDeps: 'لا يزال الخادم يفرض فحوصات الإحالة عند تنفيذ الحذف.',
      enforceNote: 'لا يزال الخادم يفرض فحوصات الإحالة عند تنفيذ الحذف.',
    },
    filters: {
      allStatus: 'جميع الحالات',
      active: 'مُفعّل',
      inactive: 'مُعطّل',
      allTypes: 'جميع الأنواع',
      system: 'نظام',
      custom: 'مخصّص',
      allTranslations: 'جميع الترجمات',
      missingEn: 'الإنجليزية ناقصة',
      missingAr: 'العربية ناقصة',
      reset: 'إعادة تعيين',
    },
    emptyState: {
      noMatchesTitle: 'لا توجد نتائج',
      noMatchesDesc: 'لا توجد تصنيفات تطابق عوامل التصفية الحالية.',
    },
    results: {
      showingXofY: (shown, total) => `عرض ${shown} من ${total} تصنيفًا.`,
    },
    treeActions: {
      moveUp: 'تحريك لأعلى',
      moveDown: 'تحريك لأسفل',
      addChild: 'إضافة فرع',
      edit: 'تعديل التصنيف',
      delete: 'حذف التصنيف',
      preview: 'معاينة التتالي',
      systemLocked: 'لا يمكن حذف تصنيفات النظام.',
    },
    warnings: {
      title: 'تنبيهات التصنيف الهرمي',
      duplicateCode: (code, count) => `الرمز المكرّر "${code}" يظهر ${count} مرات.`,
      sharedSort: (sort, count, parentClause) =>
        `ترتيب العرض ${sort} مشترك بين ${count} تصنيفات ${parentClause}.`,
      sharedSortUnderParent: (parentId) => `تحت الأب ${parentId}`,
      sharedSortRoot: 'على المستوى الجذري',
      moreHidden: (n) => `${n} تنبيهات إضافية مخفية.`,
    },
    datasetActions: {
      saveView: 'حفظ العرض',
      importTitle: 'استيراد التصنيفات',
      importDescription:
        'ارفع ملف CSV أو JSON يحتوي على code وname_en/name_ar وparent_code أو parent_id وsort وactive.',
      template: 'القالب',
    },
    appearancePicker: {
      color: 'اللون',
      icon: 'الأيقونة',
      clearColor: 'مسح اللون',
      clearIcon: 'مسح الأيقونة',
      colorLabel: (label) => `اللون ${label}`,
      iconLabel: (label) => `الأيقونة ${label}`,
    },
    toast: {
      deleted: (label) => `تم حذف "${label}".`,
      undo: 'تراجع',
      bulkDeleted: (n) => (n === 1 ? 'تم حذف تصنيف واحد.' : `تم حذف ${n} تصنيفات.`),
      bulkSkipped: (base, skipped) => `${base} تم تخطّي ${skipped} (نظام أو قيد الاستخدام أو يحتوي على فروع).`,
      reassigned: (n) =>
        n === 1 ? 'تمت إعادة إسناد قضية واحدة إلى التصنيف الهدف.' : `تمت إعادة إسناد ${n} قضايا إلى التصنيف الهدف.`,
      noSnapshot: 'لا توجد نسخة محلية متاحة لاستعادة هذا التصنيف.',
      importBlockedCycle: 'تعذّر الاستيراد بسبب إحالات أب مفقودة أو دائرية.',
      rowMissingCode: (row) => `الصف ${row} ينقصه الرمز.`,
      rowMissingName: (row) => `الصف ${row} ينقصه الاسم بالإنجليزية أو العربية.`,
      rowSelfParent: (code) => `لا يمكن للصف ذي الرمز ${code} أن يكون أبًا لنفسه.`,
    },
    form: {
      createTitle: 'إنشاء تصنيف',
      editTitle: 'تعديل التصنيف',
      code: 'الرمز',
      codePlaceholder: 'EVICTION',
      parent: 'التصنيف الأب',
      parentNone: 'لا شيء (جذر)',
      sort: 'ترتيب العرض',
      active: 'مُفعّل',
      appearance: 'المظهر',
      systemParentLockedTitle: 'الأب من النظام مقفل',
      systemParentLocked: 'يمكن إعادة تسمية تصنيفات النظام أو إعادة ترتيبها، لكن لا يمكن تغيير أبها.',
      duplicateCodeTitle: 'رمز مكرّر',
      duplicateCode: 'يوجد تصنيف بهذا الرمز مسبقًا.',
      sortConflictTitle: 'تعارض في الترتيب',
      sortConflict: (sort, codes) =>
        `ترتيب العرض ${sort} مستخدم بالفعل من قبل ${codes} في فرع هذا الأب.`,
      moveImpactTitle: 'أثر النقل',
      moveImpact: (descendants) =>
        `سيؤدي الحفظ إلى نقل هذا التصنيف${descendants ? ` وإعادة تحديد مسار ${descendants} عنصرًا تابعًا` : ''}.`,
      moveImpactInactiveParent: 'الأب المحدّد غير مُفعّل.',
      inactiveSuffix: (label) => `${label} (مُعطّل)`,
      timelineTitle: 'المخطط الزمني والنسخ',
      noTimeline: 'لا توجد تواريخ في المخطط الزمني.',
      noSnapshots: 'لم تُلتقط أي نسخ محلية بعد.',
      restore: 'استعادة',
      unknownDate: 'غير معروف',
      errors: {
        codeRequired: 'الرمز مطلوب.',
        nameRequired: 'الاسم بالإنجليزية أو العربية مطلوب.',
      },
    },
  },
};

export function useClassificationLabels(): ClassificationLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(classificationBundle, locale), [locale]);
}

/* ========================================================================= *
 * Pure resolvers (non-React contexts / tests)
 * ========================================================================= */

export function resolveAdminHomeLabels(locale: AppLocale = 'en'): AdminHomeLabels {
  return resolveLexBilingual(adminHomeBundle, locale);
}
export function resolveAdminCommonLabels(locale: AppLocale = 'en'): AdminCommonLabels {
  return resolveLexBilingual(adminCommonBundle, locale);
}
