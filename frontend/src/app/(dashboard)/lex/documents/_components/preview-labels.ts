/**
 * Bilingual (English + Modern Standard Arabic) labels for the Watheeq legal
 * document PREVIEW surface — the composed preview sheet toolbar (download / open
 * in new tab / copy link / find-in-document / integrity), and the version
 * history timeline. Follows the canonical lex bilingual contract
 * (`../../_lib/lex-i18n.ts`): a full `{ en, ar }` bundle resolved through
 * `resolveLexBilingual` and exposed via a thin `usePreviewLabels()` hook.
 *
 * The `en` side reads as natural professional English; the `ar` side is
 * professional MSA using the suite glossary (وثيقة / نسخة / تنزيل / معاينة).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface PreviewLabels {
  fallbackTitle: string;
  versionLabel: (version: number | string) => string;
  toolbar: {
    download: string;
    openInNewTab: string;
    copyLink: string;
    openInEditor: string;
    auditTrail: string;
    checkOutLock: string;
    runPreflight: string;
    createSnapshot: string;
    linkCopiedTitle: string;
    linkCopiedDescription: string;
    copyUnavailableTitle: string;
    copyUnavailableDescription: string;
    findPlaceholder: string;
    findAria: string;
    matchCount: (current: number, total: number) => string;
    noMatches: string;
    loadingPreview: string;
  };
  editor: {
    unavailableTitle: string;
    unavailableMissingFile: string;
    unavailableUnsupportedFormat: string;
    checkedOutTitle: string;
    checkedOutDescription: (title: string) => string;
    preflightPassedTitle: string;
    preflightPassedDescription: (title: string) => string;
    preflightReviewTitle: string;
    preflightReviewDescription: (count: number | string) => string;
    snapshotCreatedTitle: string;
    snapshotCreatedDescription: (title: string) => string;
    snapshotSummary: (title: string) => string;
  };
  maturity: {
    title: string;
    healthScore: string;
    signatureReadiness: string;
    legalIssues: string;
    clauseAI: string;
    privilegedControls: string;
    healthUpdatedTitle: string;
    healthUpdatedDescription: (score: number | string) => string;
    signatureReadyTitle: string;
    signatureReviewTitle: string;
    signatureReviewDescription: (count: number | string) => string;
  };
  integrity: {
    title: string;
    fileSize: string;
    contentHash: string;
    unavailable: string;
    copyHashAria: string;
    hashCopiedTitle: string;
  };
  archive: {
    title: string;
    action: string;
    actionPending: string;
    reference: string;
    wormMode: string;
    wormNone: string;
    wormGovernance: string;
    wormCompliance: string;
    archivedAt: string;
    manifestHash: string;
    retainUntil: string;
    reversibleNote: string;
    notArchived: string;
    copyReferenceAria: string;
    referenceCopiedTitle: string;
    successTitle: string;
    successDescription: (connector: string) => string;
    noConnectorTitle: string;
    noConnectorDescription: string;
    failedTitle: string;
    confirmTitle: string;
    confirmDescription: string;
    confirm: string;
    cancel: string;
  };
  versions: {
    title: string;
    description: string;
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    current: string;
    uploadedBy: (name: string) => string;
    noSummary: string;
    preview: string;
    previewAria: (version: number | string) => string;
    download: string;
    downloadAria: (version: number | string) => string;
    loadingFile: string;
  };
}

export const previewLabels: LexBilingual<PreviewLabels> = {
  en: {
    fallbackTitle: 'Document preview',
    versionLabel: (version) => `v${version}`,
    toolbar: {
      download: 'Download',
      openInNewTab: 'Open in new tab',
      copyLink: 'Copy link',
      openInEditor: 'Open in editor',
      auditTrail: 'Audit trail',
      checkOutLock: 'Check out / lock',
      runPreflight: 'Run preflight',
      createSnapshot: 'Version snapshot',
      linkCopiedTitle: 'Link copied',
      linkCopiedDescription: 'The download link has been copied to your clipboard.',
      copyUnavailableTitle: 'Copy unavailable',
      copyUnavailableDescription: 'Your browser blocked clipboard access.',
      findPlaceholder: 'Find in document…',
      findAria: 'Find in document text',
      matchCount: (current, total) => `${current} of ${total}`,
      noMatches: 'No matches',
      loadingPreview: 'Loading preview…',
    },
    editor: {
      unavailableTitle: 'Editor unavailable',
      unavailableMissingFile: 'Attach a DOCX file before opening the Word editor.',
      unavailableUnsupportedFormat: 'The Word editor supports DOCX files only.',
      checkedOutTitle: 'Document checked out.',
      checkedOutDescription: (title) => `"${title}" is locked for editor changes.`,
      preflightPassedTitle: 'Preflight passed.',
      preflightPassedDescription: (title) => `"${title}" is ready for the Word editor.`,
      preflightReviewTitle: 'Preflight needs review.',
      preflightReviewDescription: (count) => `${count} items need attention before editing.`,
      snapshotCreatedTitle: 'Version snapshot created.',
      snapshotCreatedDescription: (title) => `A point-in-time snapshot was recorded for "${title}".`,
      snapshotSummary: (title) => `Manual editor snapshot for ${title}`,
    },
    maturity: {
      title: 'Editor maturity',
      healthScore: 'Health score',
      signatureReadiness: 'Signature readiness',
      legalIssues: 'Legal issues',
      clauseAI: 'Clause AI',
      privilegedControls: 'Privileged controls',
      healthUpdatedTitle: 'Health score refreshed.',
      healthUpdatedDescription: (score) => `Current score: ${score}.`,
      signatureReadyTitle: 'Signature readiness passed.',
      signatureReviewTitle: 'Signature readiness needs review.',
      signatureReviewDescription: (count) => `${count} checks need attention.`,
    },
    integrity: {
      title: 'Integrity',
      fileSize: 'File size',
      contentHash: 'Content hash',
      unavailable: 'Not available',
      copyHashAria: 'Copy content hash',
      hashCopiedTitle: 'Content hash copied',
    },
    archive: {
      title: 'e-Archive',
      action: 'Archive to e-archive',
      actionPending: 'Archiving…',
      reference: 'Archive reference',
      wormMode: 'WORM mode',
      wormNone: 'None — reversible',
      wormGovernance: 'Governance',
      wormCompliance: 'Compliance',
      archivedAt: 'Archived at',
      manifestHash: 'Manifest hash',
      retainUntil: 'Retain until',
      reversibleNote: 'Reversible demo target (no object-lock).',
      notArchived: 'This document has not been archived yet.',
      copyReferenceAria: 'Copy archive reference',
      referenceCopiedTitle: 'Archive reference copied',
      successTitle: 'Document archived',
      successDescription: (connector) => `Pushed to the e-archive connector (${connector}).`,
      noConnectorTitle: 'No e-archive connector',
      noConnectorDescription:
        'No active e-archive connector is configured for this tenant. Activate an archiving integration first.',
      failedTitle: 'Archiving failed',
      confirmTitle: 'Archive to e-archive?',
      confirmDescription:
        'The latest version of this document will be pushed to the active e-archive connector and stamped with an archive reference.',
      confirm: 'Archive',
      cancel: 'Cancel',
    },
    versions: {
      title: 'Version history',
      description: 'All revisions of this document, newest first.',
      loadError: 'Failed to load version history.',
      emptyTitle: 'No version history',
      emptyDescription: 'No prior versions have been recorded for this document.',
      current: 'Current',
      uploadedBy: (name) => `by ${name}`,
      noSummary: 'No change summary provided.',
      preview: 'Preview',
      previewAria: (version) => `Preview version ${version}`,
      download: 'Download',
      downloadAria: (version) => `Download version ${version}`,
      loadingFile: 'Preparing file…',
    },
  },
  ar: {
    fallbackTitle: 'معاينة الوثيقة',
    versionLabel: (version) => `إصدار ${version}`,
    toolbar: {
      download: 'تنزيل',
      openInNewTab: 'فتح في علامة تبويب جديدة',
      copyLink: 'نسخ الرابط',
      openInEditor: 'فتح في المحرّر',
      auditTrail: 'سجل التدقيق',
      checkOutLock: 'تسجيل خروج / قفل',
      runPreflight: 'تشغيل التحقق المسبق',
      createSnapshot: 'لقطة نسخة',
      linkCopiedTitle: 'تم نسخ الرابط',
      linkCopiedDescription: 'تم نسخ رابط التنزيل إلى الحافظة.',
      copyUnavailableTitle: 'النسخ غير متاح',
      copyUnavailableDescription: 'حظر متصفحك الوصول إلى الحافظة.',
      findPlaceholder: 'البحث في الوثيقة…',
      findAria: 'البحث في نص الوثيقة',
      matchCount: (current, total) => `${current} من ${total}`,
      noMatches: 'لا توجد نتائج',
      loadingPreview: 'جارٍ تحميل المعاينة…',
    },
    editor: {
      unavailableTitle: 'المحرّر غير متاح',
      unavailableMissingFile: 'أرفق ملف DOCX قبل فتح محرّر Word.',
      unavailableUnsupportedFormat: 'يدعم محرّر Word ملفات DOCX فقط.',
      checkedOutTitle: 'تم تسجيل خروج الوثيقة.',
      checkedOutDescription: (title) => `تم قفل "${title}" لتعديلات المحرّر.`,
      preflightPassedTitle: 'نجح التحقق المسبق.',
      preflightPassedDescription: (title) => `"${title}" جاهزة لمحرّر Word.`,
      preflightReviewTitle: 'يتطلب التحقق المسبق مراجعة.',
      preflightReviewDescription: (count) => `${count} عناصر تحتاج إلى انتباه قبل التحرير.`,
      snapshotCreatedTitle: 'تم إنشاء لقطة النسخة.',
      snapshotCreatedDescription: (title) => `تم تسجيل لقطة زمنية للوثيقة "${title}".`,
      snapshotSummary: (title) => `لقطة يدوية من المحرّر للوثيقة ${title}`,
    },
    maturity: {
      title: 'نضج المحرّر',
      healthScore: 'درجة الصحة',
      signatureReadiness: 'جاهزية التوقيع',
      legalIssues: 'المسائل القانونية',
      clauseAI: 'AI البنود',
      privilegedControls: 'ضوابط الامتياز',
      healthUpdatedTitle: 'تم تحديث درجة الصحة.',
      healthUpdatedDescription: (score) => `الدرجة الحالية: ${score}.`,
      signatureReadyTitle: 'نجحت جاهزية التوقيع.',
      signatureReviewTitle: 'تتطلب جاهزية التوقيع مراجعة.',
      signatureReviewDescription: (count) => `${count} فحوص تحتاج إلى انتباه.`,
    },
    integrity: {
      title: 'النزاهة',
      fileSize: 'حجم الملف',
      contentHash: 'بصمة المحتوى',
      unavailable: 'غير متاح',
      copyHashAria: 'نسخ بصمة المحتوى',
      hashCopiedTitle: 'تم نسخ بصمة المحتوى',
    },
    archive: {
      title: 'الأرشفة الإلكترونية',
      action: 'أرشفة إلى الأرشيف الإلكتروني',
      actionPending: 'جارٍ الأرشفة…',
      reference: 'مرجع الأرشفة',
      wormMode: 'نمط WORM',
      wormNone: 'بلا — قابل للعكس',
      wormGovernance: 'حوكمة',
      wormCompliance: 'امتثال',
      archivedAt: 'تاريخ الأرشفة',
      manifestHash: 'بصمة البيان',
      retainUntil: 'الاحتفاظ حتى',
      reversibleNote: 'هدف تجريبي قابل للعكس (بلا قفل كائنات).',
      notArchived: 'لم تتم أرشفة هذه الوثيقة بعد.',
      copyReferenceAria: 'نسخ مرجع الأرشفة',
      referenceCopiedTitle: 'تم نسخ مرجع الأرشفة',
      successTitle: 'تمت أرشفة الوثيقة',
      successDescription: (connector) => `تم الدفع إلى موصّل الأرشيف الإلكتروني (${connector}).`,
      noConnectorTitle: 'لا يوجد موصّل أرشفة',
      noConnectorDescription:
        'لا يوجد موصّل أرشيف إلكتروني نشط مُهيأ لهذا المستأجر. فعّل تكامل أرشفة أولًا.',
      failedTitle: 'فشلت الأرشفة',
      confirmTitle: 'أرشفة إلى الأرشيف الإلكتروني؟',
      confirmDescription:
        'سيتم دفع أحدث إصدار من هذه الوثيقة إلى موصّل الأرشيف الإلكتروني النشط وختمه بمرجع أرشفة.',
      confirm: 'أرشفة',
      cancel: 'إلغاء',
    },
    versions: {
      title: 'سجل النسخ',
      description: 'جميع مراجعات هذه الوثيقة، الأحدث أولًا.',
      loadError: 'تعذّر تحميل سجل النسخ.',
      emptyTitle: 'لا يوجد سجل نسخ',
      emptyDescription: 'لم تُسجَّل أي نسخ سابقة لهذه الوثيقة.',
      current: 'الحالية',
      uploadedBy: (name) => `بواسطة ${name}`,
      noSummary: 'لم يُقدَّم ملخص للتغيير.',
      preview: 'معاينة',
      previewAria: (version) => `معاينة الإصدار ${version}`,
      download: 'تنزيل',
      downloadAria: (version) => `تنزيل الإصدار ${version}`,
      loadingFile: 'جارٍ تجهيز الملف…',
    },
  },
};

/** usePreviewLabels exposes the resolved preview labels for the active locale. */
export function usePreviewLabels(): PreviewLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(previewLabels, locale), [locale]);
}

/** resolvePreviewLabels is the pure resolver for non-React callers/tests. */
export function resolvePreviewLabels(locale: AppLocale = 'en'): PreviewLabels {
  return resolveLexBilingual(previewLabels, locale === 'ar' ? 'ar' : 'en');
}
