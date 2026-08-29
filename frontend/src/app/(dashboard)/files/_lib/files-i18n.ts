/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the File Service
 * console (`/files`) — خدمة الملفات.
 *
 * Follows the established notebooks/data i18n contract: every label group is a
 * bilingual bundle `{ en, ar }` (two FULL, same-shaped copies). Components call
 * {@link useFilesLabels}; resolution defaults to English when no LocaleProvider
 * is mounted.
 *
 * Enum-derived surfaces (file status, virus-scan status, suite, lifecycle
 * policy, quarantine action) are translated through the `enums` maps so badges
 * render in the active locale; {@link useFileEnumLabel} resolves one enum value
 * with a Title-Cased English fallback for values the backend adds later.
 *
 * Product names / acronyms stay verbatim in both locales: SHA-256, IP, RBAC,
 * SSO, MB.
 */

'use client';

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages, resolveBilingualBundle } from '@/lib/i18n/registry';
import { titleCase } from '@/lib/format';
import type { AppLocale } from '@/lib/i18n';

export type FilesBilingual<T> = { readonly en: T; readonly ar: T };

export function resolveFilesBilingual<T>(bundle: FilesBilingual<T>, locale: AppLocale): T {
  return resolveBilingualBundle(bundle, locale);
}

export interface FilesLabels {
  page: {
    eyebrow: string;
    title: string;
    description: string;
    filesTag: (count: string) => string;
    quarantinedTag: (count: string) => string;
    refresh: string;
  };
  storage: {
    trackedFiles: string;
    trackedFilesCaption: string;
    storageUsed: string;
    storageUsedCaption: string;
    quarantineBacklog: string;
    quarantineBacklogCaption: string;
    activeSuites: string;
    activeSuitesCaption: string;
  };
  upload: {
    title: string;
    description: string;
    suite: string;
    selectSuite: string;
    lifecyclePolicy: string;
    selectLifecyclePolicy: string;
    entityType: string;
    entityTypePlaceholder: string;
    entityId: string;
    entityIdPlaceholder: string;
    tags: string;
    tagsPlaceholder: string;
    encryptLabel: string;
    encryptDescription: string;
  };
  tabs: {
    library: string;
    quarantine: string;
  };
  library: {
    suiteFilter: string;
    allSuites: string;
    filesReturned: (count: string) => string;
    loadingInventory: string;
    emptyTitle: string;
    emptyDescription: string;
    loadFailed: string;
    colName: string;
    colSuite: string;
    colStatus: string;
    colScan: string;
    colSize: string;
    colCreated: string;
    inspect: string;
    download: string;
  };
  pagination: {
    pageOf: (page: string, total: string) => string;
    previous: string;
    next: string;
  };
  detail: {
    fallbackTitle: string;
    description: string;
    download: string;
    openPresigned: string;
    queueRescan: string;
    delete: string;
    loadFailedTitle: string;
    loadFailedMessage: string;
    scanInProgress: string;
    scanFailed: string;
    metadataTitle: string;
    metadataDescription: string;
    suite: string;
    storedName: string;
    sanitizedName: string;
    contentType: string;
    detectedType: string;
    notDetected: string;
    size: string;
    uploadedBy: string;
    checksum: string;
    entityLink: string;
    notLinked: string;
    expiresAt: string;
    noExpiry: string;
    created: string;
    updated: string;
    tags: string;
    noTags: string;
    versionsTab: string;
    accessLogTab: string;
    versionHistoryTitle: string;
    versionHistoryDescription: string;
    versionsLoadFailedTitle: string;
    versionsLoadFailedMessage: string;
    colVersion: string;
    colStatus: string;
    colScan: string;
    colCreated: string;
    accessLogTitle: string;
    accessLogDescription: string;
    accessLogFailedTitle: string;
    accessLogFailedMessage: string;
    colAction: string;
    colUser: string;
    colIp: string;
    colTime: string;
    unknownIp: string;
    noAccessTitle: string;
    noAccessDescription: string;
    notSet: string;
  };
  quarantine: {
    title: string;
    description: string;
    loadFailedTitle: string;
    loadFailedMessage: string;
    emptyTitle: string;
    emptyDescription: string;
    colFileId: string;
    colVirus: string;
    colQuarantined: string;
    colAction: string;
    unknownVirus: string;
    trackedFileCount: (count: string) => string;
  };
  dialogs: {
    deleteTitle: string;
    deleteDescription: (name: string) => string;
    deleteConfirm: string;
    resolveTitle: string;
    resolveDescription: (action: string) => string;
    resolveFallbackConfirm: string;
  };
  toasts: {
    uploadedOne: string;
    uploadedMany: (count: string) => string;
    scanInProgress: string;
    scanFailed: string;
    rescanQueued: string;
    deleted: string;
    quarantineMarked: (action: string) => string;
  };
  enums: {
    status: Record<string, string>;
    scan: Record<string, string>;
    suite: Record<string, string>;
    lifecycle: Record<string, string>;
    quarantineAction: Record<string, string>;
  };
}

const filesLabels: FilesBilingual<FilesLabels> = {
  en: {
    page: {
      eyebrow: 'File Service',
      title: 'Files',
      description:
        'Operate the full file-service surface from the frontend: upload, inspect, download, rescan, and manage quarantine activity.',
      filesTag: (count) => `${count} files`,
      quarantinedTag: (count) => `${count} quarantined`,
      refresh: 'Refresh',
    },
    storage: {
      trackedFiles: 'Tracked files',
      trackedFilesCaption: 'Current tenant-visible file count across suites.',
      storageUsed: 'Storage used',
      storageUsedCaption: 'Aggregated storage consumed by tracked file records.',
      quarantineBacklog: 'Quarantine backlog',
      quarantineBacklogCaption: 'Unresolved quarantine entries requiring admin action.',
      activeSuites: 'Active suites',
      activeSuitesCaption: 'Suites currently storing file records for this tenant.',
    },
    upload: {
      title: 'Upload files',
      description:
        'Direct upload is already supported by file-service. Configure the suite metadata here so uploaded files land in the correct backend scope.',
      suite: 'Suite',
      selectSuite: 'Select suite',
      lifecyclePolicy: 'Lifecycle policy',
      selectLifecyclePolicy: 'Select lifecycle policy',
      entityType: 'Entity type',
      entityTypePlaceholder: 'contract, meeting, alert...',
      entityId: 'Entity ID',
      entityIdPlaceholder: 'Optional linked record ID',
      tags: 'Tags',
      tagsPlaceholder: 'Comma separated tags',
      encryptLabel: 'Encrypt uploaded content at rest',
      encryptDescription: 'Enable backend-managed file encryption before the object is stored.',
    },
    tabs: {
      library: 'Library',
      quarantine: 'Quarantine',
    },
    library: {
      suiteFilter: 'Suite filter',
      allSuites: 'All suites',
      filesReturned: (count) => `${count} files returned from file-service.`,
      loadingInventory: 'Loading file inventory...',
      emptyTitle: 'No files found',
      emptyDescription: 'No file records matched the current filter. Upload a file or switch suites.',
      loadFailed: 'Failed to load files',
      colName: 'Name',
      colSuite: 'Suite',
      colStatus: 'Status',
      colScan: 'Scan',
      colSize: 'Size',
      colCreated: 'Created',
      inspect: 'Inspect',
      download: 'Download',
    },
    pagination: {
      pageOf: (page, total) => `Page ${page} of ${total}`,
      previous: 'Previous',
      next: 'Next',
    },
    detail: {
      fallbackTitle: 'File details',
      description: 'Inspect file metadata, version history, download activity, and admin controls.',
      download: 'Download',
      openPresigned: 'Open Presigned URL',
      queueRescan: 'Queue Rescan',
      delete: 'Delete',
      loadFailedTitle: 'Unable to load file details',
      loadFailedMessage: 'The selected file could not be loaded.',
      scanInProgress: 'Virus scan in progress',
      scanFailed: 'Virus scan failed',
      metadataTitle: 'Metadata',
      metadataDescription: 'Live metadata returned by file-service for this record.',
      suite: 'Suite',
      storedName: 'Stored name',
      sanitizedName: 'Sanitized name',
      contentType: 'Content type',
      detectedType: 'Detected type',
      notDetected: 'Not detected',
      size: 'Size',
      uploadedBy: 'Uploaded by',
      checksum: 'Checksum',
      entityLink: 'Entity link',
      notLinked: 'Not linked',
      expiresAt: 'Expires at',
      noExpiry: 'No expiry',
      created: 'Created',
      updated: 'Updated',
      tags: 'Tags',
      noTags: 'No tags',
      versionsTab: 'Versions',
      accessLogTab: 'Access Log',
      versionHistoryTitle: 'Version History',
      versionHistoryDescription: 'All versions returned by the file-service version lookup.',
      versionsLoadFailedTitle: 'Unable to load versions',
      versionsLoadFailedMessage: 'Version history could not be loaded.',
      colVersion: 'Version',
      colStatus: 'Status',
      colScan: 'Scan',
      colCreated: 'Created',
      accessLogTitle: 'Access Log',
      accessLogDescription: 'Download, view, and presigned operations recorded for this file.',
      accessLogFailedTitle: 'Unable to load access log',
      accessLogFailedMessage: 'The file access history could not be loaded.',
      colAction: 'Action',
      colUser: 'User',
      colIp: 'IP Address',
      colTime: 'Time',
      unknownIp: 'Unknown',
      noAccessTitle: 'No access log entries',
      noAccessDescription: 'This file does not have any recorded access operations yet.',
      notSet: 'Not set',
    },
    quarantine: {
      title: 'Quarantine queue',
      description: 'Resolve infected-file events and clear the backend quarantine backlog.',
      loadFailedTitle: 'Unable to load quarantine queue',
      loadFailedMessage: 'The admin quarantine list could not be loaded.',
      emptyTitle: 'No quarantined files',
      emptyDescription: 'The unresolved quarantine queue is empty.',
      colFileId: 'File ID',
      colVirus: 'Virus',
      colQuarantined: 'Quarantined',
      colAction: 'Action',
      unknownVirus: 'Unknown',
      trackedFileCount: (count) => `${count} tracked files`,
    },
    dialogs: {
      deleteTitle: 'Delete file',
      deleteDescription: (name) =>
        `Delete "${name}" from the file-service inventory? This cannot be undone.`,
      deleteConfirm: 'Delete file',
      resolveTitle: 'Resolve quarantine entry',
      resolveDescription: (action) => `Mark this quarantine entry as ${action}?`,
      resolveFallbackConfirm: 'Resolve',
    },
    toasts: {
      uploadedOne: 'File uploaded successfully',
      uploadedMany: (count) => `${count} files uploaded successfully`,
      scanInProgress: 'Virus scan in progress — file has not been cleared yet',
      scanFailed: 'Virus scan failed — download at your own risk',
      rescanQueued: 'File rescan queued',
      deleted: 'File deleted',
      quarantineMarked: (action) => `Quarantine entry marked ${action}`,
    },
    enums: {
      status: {
        available: 'Available',
        pending: 'Pending',
        quarantined: 'Quarantined',
        processing: 'Processing',
      },
      scan: {
        clean: 'Clean',
        skipped: 'Skipped',
        infected: 'Infected',
        pending: 'Pending',
        scanning: 'Scanning',
        error: 'Error',
      },
      suite: {
        platform: 'Platform',
        cyber: 'Cyber',
        data: 'Data',
        acta: 'Acta',
        lex: 'Lex',
        visus: 'Visus',
        models: 'Models',
      },
      lifecycle: {
        standard: 'Standard',
        temporary: 'Temporary',
        archive: 'Archive',
        audit_retention: 'Audit Retention',
      },
      quarantineAction: {
        restored: 'Restored',
        deleted: 'Deleted',
        false_positive: 'False Positive',
      },
    },
  },
  ar: {
    page: {
      eyebrow: 'خدمة الملفات',
      title: 'الملفات',
      description:
        'شغّل واجهة خدمة الملفات كاملةً من الواجهة الأمامية: الرفع والفحص والتنزيل وإعادة الفحص وإدارة نشاط الحجر.',
      filesTag: (count) => `${count} ملفًا`,
      quarantinedTag: (count) => `${count} محجورًا`,
      refresh: 'تحديث',
    },
    storage: {
      trackedFiles: 'الملفات المتتبَّعة',
      trackedFilesCaption: 'عدد الملفات المرئية للمستأجر حاليًا عبر الأجنحة.',
      storageUsed: 'التخزين المستخدم',
      storageUsedCaption: 'إجمالي التخزين المستهلَك بواسطة سجلات الملفات المتتبَّعة.',
      quarantineBacklog: 'قائمة الحجر المتراكمة',
      quarantineBacklogCaption: 'إدخالات الحجر غير المحلولة التي تتطلب إجراءً من المسؤول.',
      activeSuites: 'الأجنحة النشطة',
      activeSuitesCaption: 'الأجنحة التي تخزّن حاليًا سجلات ملفات لهذا المستأجر.',
    },
    upload: {
      title: 'رفع الملفات',
      description:
        'الرفع المباشر مدعوم بالفعل من خدمة الملفات. هيّئ بيانات الجناح هنا كي تصل الملفات المرفوعة إلى النطاق الخلفي الصحيح.',
      suite: 'الجناح',
      selectSuite: 'اختر الجناح',
      lifecyclePolicy: 'سياسة دورة الحياة',
      selectLifecyclePolicy: 'اختر سياسة دورة الحياة',
      entityType: 'نوع الكيان',
      entityTypePlaceholder: 'عقد، اجتماع، تنبيه...',
      entityId: 'معرّف الكيان',
      entityIdPlaceholder: 'معرّف سجل مرتبط اختياري',
      tags: 'الوسوم',
      tagsPlaceholder: 'وسوم مفصولة بفواصل',
      encryptLabel: 'تشفير المحتوى المرفوع أثناء التخزين',
      encryptDescription: 'فعّل تشفير الملفات المُدار من الخادم قبل تخزين الكائن.',
    },
    tabs: {
      library: 'المكتبة',
      quarantine: 'الحجر',
    },
    library: {
      suiteFilter: 'تصفية حسب الجناح',
      allSuites: 'جميع الأجنحة',
      filesReturned: (count) => `تم إرجاع ${count} ملفًا من خدمة الملفات.`,
      loadingInventory: 'جارٍ تحميل مخزون الملفات...',
      emptyTitle: 'لم يُعثر على ملفات',
      emptyDescription: 'لم تطابق أي سجلات ملفات التصفية الحالية. ارفع ملفًا أو بدّل الأجنحة.',
      loadFailed: 'تعذّر تحميل الملفات',
      colName: 'الاسم',
      colSuite: 'الجناح',
      colStatus: 'الحالة',
      colScan: 'الفحص',
      colSize: 'الحجم',
      colCreated: 'تاريخ الإنشاء',
      inspect: 'فحص',
      download: 'تنزيل',
    },
    pagination: {
      pageOf: (page, total) => `الصفحة ${page} من ${total}`,
      previous: 'السابق',
      next: 'التالي',
    },
    detail: {
      fallbackTitle: 'تفاصيل الملف',
      description: 'افحص بيانات الملف الوصفية وسجل الإصدارات ونشاط التنزيل وضوابط المسؤول.',
      download: 'تنزيل',
      openPresigned: 'فتح رابط موقّع مسبقًا',
      queueRescan: 'جدولة إعادة فحص',
      delete: 'حذف',
      loadFailedTitle: 'تعذّر تحميل تفاصيل الملف',
      loadFailedMessage: 'تعذّر تحميل الملف المحدد.',
      scanInProgress: 'فحص الفيروسات قيد التنفيذ',
      scanFailed: 'فشل فحص الفيروسات',
      metadataTitle: 'البيانات الوصفية',
      metadataDescription: 'بيانات وصفية مباشرة أرجعتها خدمة الملفات لهذا السجل.',
      suite: 'الجناح',
      storedName: 'الاسم المخزَّن',
      sanitizedName: 'الاسم المنقّى',
      contentType: 'نوع المحتوى',
      detectedType: 'النوع المكتشَف',
      notDetected: 'غير مكتشَف',
      size: 'الحجم',
      uploadedBy: 'رفعه',
      checksum: 'المجموع الاختباري',
      entityLink: 'ارتباط الكيان',
      notLinked: 'غير مرتبط',
      expiresAt: 'ينتهي في',
      noExpiry: 'لا انتهاء',
      created: 'أُنشئ',
      updated: 'حُدّث',
      tags: 'الوسوم',
      noTags: 'لا وسوم',
      versionsTab: 'الإصدارات',
      accessLogTab: 'سجل الوصول',
      versionHistoryTitle: 'سجل الإصدارات',
      versionHistoryDescription: 'جميع الإصدارات التي أرجعها البحث عن إصدارات خدمة الملفات.',
      versionsLoadFailedTitle: 'تعذّر تحميل الإصدارات',
      versionsLoadFailedMessage: 'تعذّر تحميل سجل الإصدارات.',
      colVersion: 'الإصدار',
      colStatus: 'الحالة',
      colScan: 'الفحص',
      colCreated: 'أُنشئ',
      accessLogTitle: 'سجل الوصول',
      accessLogDescription: 'عمليات التنزيل والعرض والروابط الموقّعة المسجّلة لهذا الملف.',
      accessLogFailedTitle: 'تعذّر تحميل سجل الوصول',
      accessLogFailedMessage: 'تعذّر تحميل سجل الوصول إلى الملف.',
      colAction: 'الإجراء',
      colUser: 'المستخدم',
      colIp: 'عنوان IP',
      colTime: 'الوقت',
      unknownIp: 'غير معروف',
      noAccessTitle: 'لا توجد إدخالات في سجل الوصول',
      noAccessDescription: 'لا يحتوي هذا الملف على أي عمليات وصول مسجّلة بعد.',
      notSet: 'غير محدد',
    },
    quarantine: {
      title: 'قائمة الحجر',
      description: 'عالج أحداث الملفات المصابة وصفّ قائمة الحجر المتراكمة في الخادم.',
      loadFailedTitle: 'تعذّر تحميل قائمة الحجر',
      loadFailedMessage: 'تعذّر تحميل قائمة الحجر الخاصة بالمسؤول.',
      emptyTitle: 'لا توجد ملفات محجورة',
      emptyDescription: 'قائمة الحجر غير المحلولة فارغة.',
      colFileId: 'معرّف الملف',
      colVirus: 'الفيروس',
      colQuarantined: 'حُجر في',
      colAction: 'الإجراء',
      unknownVirus: 'غير معروف',
      trackedFileCount: (count) => `${count} ملفًا متتبَّعًا`,
    },
    dialogs: {
      deleteTitle: 'حذف الملف',
      deleteDescription: (name) => `حذف "${name}" من مخزون خدمة الملفات؟ لا يمكن التراجع عن هذا.`,
      deleteConfirm: 'حذف الملف',
      resolveTitle: 'معالجة إدخال الحجر',
      resolveDescription: (action) => `وضع علامة على إدخال الحجر هذا بأنه ${action}؟`,
      resolveFallbackConfirm: 'معالجة',
    },
    toasts: {
      uploadedOne: 'تم رفع الملف بنجاح',
      uploadedMany: (count) => `تم رفع ${count} ملفات بنجاح`,
      scanInProgress: 'فحص الفيروسات قيد التنفيذ — لم يُعتمد الملف بعد',
      scanFailed: 'فشل فحص الفيروسات — التنزيل على مسؤوليتك',
      rescanQueued: 'تمت جدولة إعادة فحص الملف',
      deleted: 'تم حذف الملف',
      quarantineMarked: (action) => `تم وضع علامة على إدخال الحجر بأنه ${action}`,
    },
    enums: {
      status: {
        available: 'متاح',
        pending: 'قيد الانتظار',
        quarantined: 'محجور',
        processing: 'قيد المعالجة',
      },
      scan: {
        clean: 'نظيف',
        skipped: 'مُتخطّى',
        infected: 'مصاب',
        pending: 'قيد الانتظار',
        scanning: 'قيد الفحص',
        error: 'خطأ',
      },
      suite: {
        platform: 'المنصة',
        cyber: 'الأمن السيبراني',
        data: 'البيانات',
        acta: 'أكتا',
        lex: 'ليكس',
        visus: 'فيزوس',
        models: 'النماذج',
      },
      lifecycle: {
        standard: 'قياسي',
        temporary: 'مؤقت',
        archive: 'أرشيف',
        audit_retention: 'الاحتفاظ للتدقيق',
      },
      quarantineAction: {
        restored: 'مُستعاد',
        deleted: 'محذوف',
        false_positive: 'إنذار كاذب',
      },
    },
  },
};

export function useFilesLabels(): FilesLabels {
  return useBilingual(filesLabels);
}

/**
 * Resolve one enum value from a translation map, falling back to Title-Cased
 * English for values the backend adds after this bundle was written (mirrors the
 * page's original `titleCase` behaviour). `null`/empty resolves to `notSet`.
 */
export function useFileEnumLabel(): (
  group: keyof FilesLabels['enums'],
  value: string | null | undefined,
) => string {
  const labels = useFilesLabels();
  return (group, value) => {
    if (!value) return labels.detail.notSet;
    return labels.enums[group][value] ?? titleCase(value);
  };
}

registerMessages('files', filesLabels);
