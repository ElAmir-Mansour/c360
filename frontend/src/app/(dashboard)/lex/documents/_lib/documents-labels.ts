/**
 * Bilingual (English + Modern Standard Arabic) labels for the Watheeq legal
 * documents surface (list page, create/edit form dialog, upload-version dialog,
 * and bulk-import dialog). Follows the canonical lex bilingual contract
 * (`../../_lib/lex-i18n.ts`).
 *
 * The `en` side MUST equal the pre-existing English strings so existing
 * English-asserting tests stay green; the `ar` side is professional MSA using
 * the suite glossary (وثيقة / عقد / لائحة / امتثال / استيراد).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import type { DocumentEditorMaturityPanel } from './documents-helpers';

export interface DocumentsLabels {
  pageTitle: string;
  pageDescription: string;
  eyebrow: string;
  kpis: {
    total: string;
    privileged: string;
    confidential: string;
    active: string;
    retentionDue: string;
    missingPolicy: string;
  };
  savedViews: {
    save: string;
    saved: string;
    empty: string;
  };
  emptyCta: string;
  actions: {
    bulkImport: string;
    bulkImportGuided: string;
    bulkImportAdvanced: string;
    createDocument: string;
    edit: string;
    openInEditor: string;
    checkOutLock: string;
    runPreflight: string;
    createSnapshot: string;
    auditTrail: string;
    uploadVersion: string;
    preview: string;
    delete: string;
  };
  search: {
    modeLabel: string;
    metadataMode: string;
    contentsMode: string;
    contentsHint: string;
    relevanceLabel: string;
  };
  view: {
    label: string;
    table: string;
    board: string;
  };
  privilegeGuard: {
    title: string;
    description: string;
    confirm: string;
    cancel: string;
  };
  chips: {
    heading: string;
    clear: string;
    activeFolder: (path: string) => string;
    activeView: (name: string) => string;
    clearFolder: string;
    clearView: string;
    dispositionDue: string;
    missingRetention: string;
    confidentialityGroup: string;
    categoryGroup: string;
    typeGroup: string;
    statusGroup: string;
  };
  retention: {
    noPolicyBadge: string;
  };
  editor: {
    unavailableMissingFile: string;
    unavailableUnsupportedFormat: string;
    snapshotSummary: (title: string) => string;
    workspace: string;
    featureLabels: Record<DocumentEditorMaturityPanel, string>;
  };
  bulkActions: {
    archive: string;
    changeConfidentiality: string;
    addTags: string;
    exportSelected: string;
    delete: string;
    summaryTitle: string;
    summaryDescription: (updated: string, failed: string) => string;
    deleteConfirmTitle: string;
    deleteConfirmDescription: (count: string) => string;
    deleteConfirm: string;
    changeConfidentialityTitle: string;
    changeConfidentialityDescription: string;
    changeConfidentialityField: string;
    addTagsTitle: string;
    addTagsDescription: string;
    addTagsField: string;
    addTagsPlaceholder: string;
    apply: string;
    cancel: string;
  };
  filtersExtra: {
    confidentiality: string;
    category: string;
    categoryAll: string;
  };
  preview: {
    title: string;
    versionLabel: (version: number | string) => string;
    versionsCount: (count: number | string) => string;
  };
  columns: {
    document: string;
    status: string;
    confidentiality: string;
    version: string;
    tags: string;
    updated: string;
  };
  cells: {
    versionPrefix: (version: number | string) => string;
    noTags: string;
  };
  table: {
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  filters: {
    type: string;
    status: string;
    typeOptions: Record<string, string>;
    statusOptions: Record<string, string>;
  };
  enums: {
    types: Record<string, string>;
    statuses: Record<string, string>;
    confidentiality: Record<string, string>;
  };
  summary: {
    documents: string;
    folders: string;
    retentionDue: string;
    privileged: string;
    topFolders: string;
    savedViews: string;
    noMetadata: string;
  };
  deleteDialog: {
    title: string;
    description: (title: string) => string;
    confirm: string;
  };
  toasts: {
    deletedTitle: string;
    deletedDescription: string;
    createdTitle: string;
    updatedTitle: string;
    createdDescription: string;
    updatedDescription: string;
    versionUploadedTitle: string;
    versionUploadedDescription: string;
    checkedOutTitle: string;
    checkedOutDescription: (title: string) => string;
    preflightPassedTitle: string;
    preflightPassedDescription: (title: string) => string;
    preflightReviewTitle: string;
    preflightReviewDescription: (count: string) => string;
    snapshotCreatedTitle: string;
    snapshotCreatedDescription: (title: string) => string;
    bulkImportTitle: string;
    bulkImportDescription: (imported: string, failed: string, requested: string) => string;
  };
  form: {
    editTitle: string;
    createTitle: string;
    editDescription: string;
    createDescription: string;
    title: string;
    titlePlaceholder: string;
    status: string;
    documentType: string;
    confidentiality: string;
    description: string;
    descriptionPlaceholder: string;
    category: string;
    categoryPlaceholder: string;
    tags: string;
    tagsPlaceholder: string;
    initialFileTitle: string;
    initialFileHint: string;
    documentFile: string;
    selectedPrefix: (name: string) => string;
    extractedText: string;
    extractedTextPlaceholder: string;
    changeSummary: string;
    changeSummaryPlaceholder: string;
    uploadProgress: (percent: number) => string;
    cancel: string;
    save: string;
    create: string;
  };
  uploadVersion: {
    title: string;
    descriptionWith: (title: string) => string;
    descriptionFallback: string;
    documentFile: string;
    selectedPrefix: (name: string) => string;
    changeSummary: string;
    changeSummaryPlaceholder: string;
    extractedText: string;
    extractedTextPlaceholder: string;
    uploadProgress: (percent: number) => string;
    cancel: string;
    submit: string;
  };
  bulkImport: {
    title: string;
    description: string;
    batchId: string;
    batchIdPlaceholder: string;
    sourceSystem: string;
    sourceSystemPlaceholder: string;
    indexLabel: string;
    indexHint: string;
    indexAria: string;
    documentsJson: string;
    documentsHint: string;
    close: string;
    cancel: string;
    validatePreview: string;
    importButton: (count: string) => string;
    previewReady: (count: string) => string;
    editJson: string;
    typeUnknown: string;
    confidentialityFallback: string;
    documentFallback: (index: number) => string;
    andMore: (count: string) => string;
    resultTitle: string;
    resultSummary: (batchId: string, imported: string, failed: string, requested: string) => string;
    itemError: (index: number, error: string) => string;
    itemErrorFallback: string;
    errors: {
      mustBeArray: string;
      addAtLeastOne: string;
      tooMany: string;
      itemMustBeObject: (index: number) => string;
      invalidJson: (message: string) => string;
    };
  };
  folderTree: {
    allDocuments: string;
    expandAll: string;
    collapseAll: string;
    breadcrumbHome: string;
  };
  dropzone: {
    overlayTitle: string;
    overlayHint: string;
    uploading: string;
    unsupported: string;
  };
  emptyStates: {
    noDocsTitle: string;
    noDocsDescription: string;
    noResultsTitle: string;
    noResultsDescription: string;
    noFoldersHint: string;
    createCta: string;
    importCta: string;
    clearFiltersCta: string;
  };
  rowActions: {
    preview: string;
    edit: string;
    download: string;
    newVersion: string;
    history: string;
    changeConfidentiality: string;
    archive: string;
    delete: string;
  };
  kpiHints: {
    total: string;
    privileged: string;
    confidential: string;
    active: string;
    retentionDue: string;
    missingPolicy: string;
  };
  bulkDownload: {
    label: string;
    preparing: string;
    done: string;
  };
}

export const documentsLabels: LexBilingual<DocumentsLabels> = {
  en: {
    pageTitle: 'Documents',
    pageDescription:
      'The shared store for legal files. A document saved here can be linked to cases, matters and settlements instead of being uploaded again.',
    eyebrow: 'Legal Suite',
    kpis: {
      total: 'Documents',
      privileged: 'Privileged',
      confidential: 'Confidential',
      active: 'Active',
      retentionDue: 'Retention due',
      missingPolicy: 'Missing policy',
    },
    savedViews: {
      save: 'Save current view',
      saved: 'Saved views',
      empty: 'No saved views yet',
    },
    emptyCta: 'Create your first document',
    actions: {
      bulkImport: 'Bulk Import',
      bulkImportGuided: 'Guided import (CSV)',
      bulkImportAdvanced: 'Advanced (JSON)',
      createDocument: 'Create Document',
      edit: 'Edit',
      openInEditor: 'Open in editor',
      checkOutLock: 'Check out / lock',
      runPreflight: 'Run preflight',
      createSnapshot: 'Version snapshot',
      auditTrail: 'Audit trail',
      uploadVersion: 'Upload version',
      preview: 'Preview',
      delete: 'Delete',
    },
    search: {
      modeLabel: 'Search mode',
      metadataMode: 'Metadata',
      contentsMode: 'Contents',
      contentsHint: 'Type a query to search full document contents.',
      relevanceLabel: 'Relevance',
    },
    view: {
      label: 'View',
      table: 'List',
      board: 'Board',
    },
    privilegeGuard: {
      title: 'Privileged document',
      description:
        'This document is privileged — confirm you are authorized to view it before opening the preview.',
      confirm: 'I am authorized',
      cancel: 'Cancel',
    },
    chips: {
      heading: 'Quick filters',
      clear: 'Clear',
      activeFolder: (path) => `Folder: ${path}`,
      activeView: (name) => `View: ${name}`,
      clearFolder: 'Clear folder',
      clearView: 'Clear view',
      dispositionDue: 'Disposition due',
      missingRetention: 'Missing retention policy',
      confidentialityGroup: 'Confidentiality',
      categoryGroup: 'Category',
      typeGroup: 'Type',
      statusGroup: 'Status',
    },
    retention: {
      noPolicyBadge: 'No retention policy',
    },
    editor: {
      unavailableMissingFile: 'Attach a DOCX file before opening the Word editor.',
      unavailableUnsupportedFormat: 'The Word editor supports DOCX files only.',
      snapshotSummary: (title) => `Manual editor snapshot for ${title}`,
      workspace: 'Review workspace',
      featureLabels: {
        'negotiation-room': 'Negotiation room',
        'playbook-enforcement': 'Playbook enforcement',
        'terms-cross-references': 'Terms & references',
        'section-assignments': 'Section assignments',
        'guest-review-links': 'Guest review links',
        'legal-issues': 'Legal issues',
        'signature-readiness': 'Signature readiness',
        'clause-ai-actions': 'Clause AI actions',
        'health-score': 'Health score',
        'privileged-controls': 'Privileged controls',
      },
    },
    bulkActions: {
      archive: 'Archive',
      changeConfidentiality: 'Change confidentiality',
      addTags: 'Add tags',
      exportSelected: 'Export selected',
      delete: 'Delete',
      summaryTitle: 'Bulk action complete.',
      summaryDescription: (updated, failed) => `${updated} updated, ${failed} failed.`,
      deleteConfirmTitle: 'Delete selected documents',
      deleteConfirmDescription: (count) =>
        `Are you sure you want to delete ${count} documents? This action cannot be undone.`,
      deleteConfirm: 'Delete',
      changeConfidentialityTitle: 'Change confidentiality',
      changeConfidentialityDescription: 'Apply a new confidentiality level to the selected documents.',
      changeConfidentialityField: 'Confidentiality',
      addTagsTitle: 'Add tags',
      addTagsDescription: 'Add tags to the selected documents (existing tags are preserved).',
      addTagsField: 'Tags',
      addTagsPlaceholder: 'gdpr, policy, internal',
      apply: 'Apply',
      cancel: 'Cancel',
    },
    filtersExtra: {
      confidentiality: 'Confidentiality',
      category: 'Category',
      categoryAll: 'All categories',
    },
    preview: {
      title: 'Document preview',
      versionLabel: (version) => `v${version}`,
      versionsCount: (count) => `${count} versions`,
    },
    columns: {
      document: 'Document',
      status: 'Status',
      confidentiality: 'Confidentiality',
      version: 'Version',
      tags: 'Tags',
      updated: 'Updated',
    },
    cells: {
      versionPrefix: (version) => `v${version}`,
      noTags: '—',
    },
    table: {
      searchPlaceholder: 'Search legal documents...',
      emptyTitle: 'No documents found',
      emptyDescription: 'No legal documents matched the current filters.',
    },
    filters: {
      type: 'Type',
      status: 'Status',
      typeOptions: {
        policy: 'Policy',
        regulation: 'Regulation',
        template: 'Template',
        memo: 'Memo',
        opinion: 'Opinion',
        filing: 'Filing',
        correspondence: 'Correspondence',
        resolution: 'Resolution',
        power_of_attorney: 'Power of Attorney',
        other: 'Other',
      },
      statusOptions: {
        draft: 'Draft',
        active: 'Active',
        archived: 'Archived',
        superseded: 'Superseded',
      },
    },
    enums: {
      types: {
        policy: 'policy',
        regulation: 'regulation',
        template: 'template',
        memo: 'memo',
        opinion: 'opinion',
        filing: 'filing',
        correspondence: 'correspondence',
        resolution: 'resolution',
        power_of_attorney: 'power of attorney',
        other: 'other',
      },
      statuses: {
        draft: 'Draft',
        active: 'Active',
        archived: 'Archived',
        superseded: 'Superseded',
      },
      confidentiality: {
        public: 'Public',
        internal: 'Internal',
        confidential: 'Confidential',
        privileged: 'Privileged',
      },
    },
    summary: {
      documents: 'Documents',
      folders: 'Folders',
      retentionDue: 'Retention due',
      privileged: 'Privileged',
      topFolders: 'Top folders',
      savedViews: 'Saved views',
      noMetadata: 'No metadata yet.',
    },
    deleteDialog: {
      title: 'Delete document',
      description: (title) =>
        `Are you sure you want to delete "${title}"? This action cannot be undone.`,
      confirm: 'Delete',
    },
    toasts: {
      deletedTitle: 'Document deleted.',
      deletedDescription: 'The legal document has been removed.',
      createdTitle: 'Document created.',
      updatedTitle: 'Document updated.',
      createdDescription: 'The legal document is now available in the repository.',
      updatedDescription: 'The document metadata has been saved.',
      versionUploadedTitle: 'Version uploaded.',
      versionUploadedDescription: 'A new document version has been added.',
      checkedOutTitle: 'Document checked out.',
      checkedOutDescription: (title) => `"${title}" is locked for editor changes.`,
      preflightPassedTitle: 'Preflight passed.',
      preflightPassedDescription: (title) => `"${title}" is ready for the Word editor.`,
      preflightReviewTitle: 'Preflight needs review.',
      preflightReviewDescription: (count) => `${count} items need attention before editing.`,
      snapshotCreatedTitle: 'Version snapshot created.',
      snapshotCreatedDescription: (title) => `A point-in-time snapshot was recorded for "${title}".`,
      bulkImportTitle: 'Bulk import complete.',
      bulkImportDescription: (imported, failed, requested) =>
        `${imported} imported, ${failed} failed from ${requested} submitted.`,
    },
    form: {
      editTitle: 'Edit Document',
      createTitle: 'Create Document',
      editDescription: 'Update legal document metadata and classification.',
      createDescription: 'Register a new legal document and optionally attach the initial file.',
      title: 'Title',
      titlePlaceholder: 'Data Protection Policy',
      status: 'Status',
      documentType: 'Document type',
      confidentiality: 'Confidentiality',
      description: 'Description',
      descriptionPlaceholder: 'Scope, purpose, and applicability of this legal document.',
      category: 'Category',
      categoryPlaceholder: 'Compliance',
      tags: 'Tags',
      tagsPlaceholder: 'gdpr, policy, internal',
      initialFileTitle: 'Initial document file',
      initialFileHint: 'Optional. Upload the source file to enable version tracking from the start.',
      documentFile: 'Document file',
      selectedPrefix: (name) => `Selected: ${name}`,
      extractedText: 'Extracted text',
      extractedTextPlaceholder: 'Paste document text for indexing.',
      changeSummary: 'Change summary',
      changeSummaryPlaceholder: 'Initial published version',
      uploadProgress: (percent) => `Upload progress: ${percent}%`,
      cancel: 'Cancel',
      save: 'Save changes',
      create: 'Create document',
    },
    uploadVersion: {
      title: 'Upload New Version',
      descriptionWith: (title) => `Attach a new version of "${title}".`,
      descriptionFallback: 'Upload a new document version.',
      documentFile: 'Document file',
      selectedPrefix: (name) => `Selected: ${name}`,
      changeSummary: 'Change summary',
      changeSummaryPlaceholder: 'What changed in this version?',
      extractedText: 'Extracted text',
      extractedTextPlaceholder: 'Paste document text for indexing.',
      uploadProgress: (percent) => `Upload progress: ${percent}%`,
      cancel: 'Cancel',
      submit: 'Upload version',
    },
    bulkImport: {
      title: 'Bulk Import Documents',
      description:
        'Paste a JSON array of legal documents for the Watheeq repository bulk import route.',
      batchId: 'Batch ID',
      batchIdPlaceholder: 'legacy-ksa-2026',
      sourceSystem: 'Source system',
      sourceSystemPlaceholder: 'legacy-dms',
      indexLabel: 'Index imported content',
      indexHint: 'Attach migration, OCR, and repository-index metadata during import.',
      indexAria: 'Index imported content',
      documentsJson: 'Documents JSON',
      documentsHint:
        'Submit up to 250 document objects. The service returns item-level failures without blocking the full batch.',
      close: 'Close',
      cancel: 'Cancel',
      validatePreview: 'Validate & Preview',
      importButton: (count) => `Import ${count} Documents`,
      previewReady: (count) => `Preview ready: ${count} documents`,
      editJson: 'Edit JSON',
      typeUnknown: 'type unknown',
      confidentialityFallback: 'internal',
      documentFallback: (index) => `Document ${index}`,
      andMore: (count) => `And ${count} more documents.`,
      resultTitle: 'Import result',
      resultSummary: (batchId, imported, failed, requested) =>
        `Batch ${batchId}: ${imported} imported, ${failed} failed from ${requested} submitted.`,
      itemError: (index, error) => `Item ${index}: ${error}`,
      itemErrorFallback: 'Import failed.',
      errors: {
        mustBeArray: 'Input must be a JSON array of document objects.',
        addAtLeastOne: 'Add at least one document before importing.',
        tooMany: 'Bulk import supports at most 250 documents per request.',
        itemMustBeObject: (index) => `Item ${index} must be a JSON object.`,
        invalidJson: (message) => `Invalid JSON: ${message}`,
      },
    },
    folderTree: {
      allDocuments: 'All documents',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
      breadcrumbHome: 'Repository root',
    },
    dropzone: {
      overlayTitle: 'Drop files to upload',
      overlayHint: 'Release to add documents to this repository.',
      uploading: 'Uploading…',
      unsupported: 'Unsupported file type.',
    },
    emptyStates: {
      noDocsTitle: 'No documents yet',
      noDocsDescription: 'Create your first legal document or import an existing batch to get started.',
      noResultsTitle: 'No matching documents',
      noResultsDescription: 'No legal documents matched the current filters or search query.',
      noFoldersHint: 'Folders appear here as documents are filed into them.',
      createCta: 'Create document',
      importCta: 'Bulk import',
      clearFiltersCta: 'Clear filters',
    },
    rowActions: {
      preview: 'Preview',
      edit: 'Edit',
      download: 'Download',
      newVersion: 'Upload version',
      history: 'Version history',
      changeConfidentiality: 'Change confidentiality',
      archive: 'Archive',
      delete: 'Delete',
    },
    kpiHints: {
      total: 'Show all documents',
      privileged: 'Filter to privileged documents',
      confidential: 'Filter to confidential documents',
      active: 'Filter to active documents',
      retentionDue: 'Filter to documents with retention due',
      missingPolicy: 'Filter to documents missing a retention policy',
    },
    bulkDownload: {
      label: 'Download selected',
      preparing: 'Preparing download…',
      done: 'Download ready.',
    },
  },
  ar: {
    pageTitle: 'الوثائق',
    pageDescription:
      'المخزن المشترك للوثائق القانونية. يمكن ربط الوثيقة المحفوظة هنا بالقضايا والمسائل القانونية والتسويات بدلًا من رفعها مرة أخرى.',
    eyebrow: 'المجموعة القانونية',
    kpis: {
      total: 'الوثائق',
      privileged: 'محمي بالامتياز',
      confidential: 'سرّي',
      active: 'ساري',
      retentionDue: 'استحقاق الاحتفاظ',
      missingPolicy: 'بلا سياسة',
    },
    savedViews: {
      save: 'حفظ العرض الحالي',
      saved: 'العروض المحفوظة',
      empty: 'لا توجد عروض محفوظة بعد',
    },
    emptyCta: 'أنشئ أول وثيقة',
    actions: {
      bulkImport: 'استيراد جماعي',
      bulkImportGuided: 'استيراد موجَّه (CSV)',
      bulkImportAdvanced: 'متقدّم (JSON)',
      createDocument: 'إنشاء وثيقة',
      edit: 'تعديل',
      openInEditor: 'فتح في المحرّر',
      checkOutLock: 'تسجيل خروج / قفل',
      runPreflight: 'تشغيل التحقق المسبق',
      createSnapshot: 'لقطة نسخة',
      auditTrail: 'سجل التدقيق',
      uploadVersion: 'رفع نسخة',
      preview: 'معاينة',
      delete: 'حذف',
    },
    search: {
      modeLabel: 'وضع البحث',
      metadataMode: 'البيانات الوصفية',
      contentsMode: 'المحتوى',
      contentsHint: 'اكتب عبارة بحث للبحث في كامل محتوى الوثائق.',
      relevanceLabel: 'الصلة',
    },
    view: {
      label: 'العرض',
      table: 'قائمة',
      board: 'لوحة',
    },
    privilegeGuard: {
      title: 'وثيقة محمية بالامتياز',
      description: 'هذه الوثيقة محمية بالامتياز — أكِّد أنك مخوَّل بالاطلاع عليها قبل فتح المعاينة.',
      confirm: 'أنا مخوَّل',
      cancel: 'إلغاء',
    },
    chips: {
      heading: 'مرشّحات سريعة',
      clear: 'مسح',
      activeFolder: (path) => `المجلد: ${path}`,
      activeView: (name) => `العرض: ${name}`,
      clearFolder: 'مسح المجلد',
      clearView: 'مسح العرض',
      dispositionDue: 'استحقاق التصرّف',
      missingRetention: 'سياسة احتفاظ مفقودة',
      confidentialityGroup: 'السرّية',
      categoryGroup: 'الفئة',
      typeGroup: 'النوع',
      statusGroup: 'الحالة',
    },
    retention: {
      noPolicyBadge: 'لا توجد سياسة احتفاظ',
    },
    editor: {
      unavailableMissingFile: 'أرفق ملف DOCX قبل فتح محرّر Word.',
      unavailableUnsupportedFormat: 'يدعم محرّر Word ملفات DOCX فقط.',
      snapshotSummary: (title) => `لقطة يدوية من المحرّر للوثيقة ${title}`,
      workspace: 'مساحة المراجعة',
      featureLabels: {
        'negotiation-room': 'غرفة التفاوض',
        'playbook-enforcement': 'تطبيق الدليل',
        'terms-cross-references': 'المصطلحات والإحالات',
        'section-assignments': 'تكليفات الأقسام',
        'guest-review-links': 'روابط مراجعة الضيوف',
        'legal-issues': 'المسائل القانونية',
        'signature-readiness': 'جاهزية التوقيع',
        'clause-ai-actions': 'إجراءات AI للبنود',
        'health-score': 'درجة الصحة',
        'privileged-controls': 'ضوابط الامتياز',
      },
    },
    bulkActions: {
      archive: 'أرشفة',
      changeConfidentiality: 'تغيير السرّية',
      addTags: 'إضافة وسوم',
      exportSelected: 'تصدير المحدد',
      delete: 'حذف',
      summaryTitle: 'اكتمل الإجراء الجماعي.',
      summaryDescription: (updated, failed) => `تم تحديث ${updated}، وفشل ${failed}.`,
      deleteConfirmTitle: 'حذف الوثائق المحددة',
      deleteConfirmDescription: (count) =>
        `هل أنت متأكد من حذف ${count} وثيقة؟ لا يمكن التراجع عن هذا الإجراء.`,
      deleteConfirm: 'حذف',
      changeConfidentialityTitle: 'تغيير السرّية',
      changeConfidentialityDescription: 'طبّق مستوى سرّية جديدًا على الوثائق المحددة.',
      changeConfidentialityField: 'السرّية',
      addTagsTitle: 'إضافة وسوم',
      addTagsDescription: 'أضف وسومًا إلى الوثائق المحددة (تُحفظ الوسوم الحالية).',
      addTagsField: 'الوسوم',
      addTagsPlaceholder: 'حماية البيانات، سياسة، داخلي',
      apply: 'تطبيق',
      cancel: 'إلغاء',
    },
    filtersExtra: {
      confidentiality: 'السرّية',
      category: 'الفئة',
      categoryAll: 'كل الفئات',
    },
    preview: {
      title: 'معاينة الوثيقة',
      versionLabel: (version) => `إصدار ${version}`,
      versionsCount: (count) => `${count} نسخة`,
    },
    columns: {
      document: 'الوثيقة',
      status: 'الحالة',
      confidentiality: 'السرّية',
      version: 'النسخة',
      tags: 'الوسوم',
      updated: 'آخر تحديث',
    },
    cells: {
      versionPrefix: (version) => `إصدار ${version}`,
      noTags: '—',
    },
    table: {
      searchPlaceholder: 'البحث في الوثائق القانونية...',
      emptyTitle: 'لا توجد وثائق',
      emptyDescription: 'لا توجد وثائق قانونية مطابقة للمرشّحات الحالية.',
    },
    filters: {
      type: 'النوع',
      status: 'الحالة',
      typeOptions: {
        policy: 'سياسة',
        regulation: 'لائحة',
        template: 'نموذج',
        memo: 'مذكّرة',
        opinion: 'رأي قانوني',
        filing: 'إيداع',
        correspondence: 'مراسلة',
        resolution: 'قرار',
        power_of_attorney: 'وكالة',
        other: 'أخرى',
      },
      statusOptions: {
        draft: 'مسودة',
        active: 'ساري',
        archived: 'مؤرشف',
        superseded: 'مُستبدَل',
      },
    },
    enums: {
      types: {
        policy: 'سياسة',
        regulation: 'لائحة',
        template: 'نموذج',
        memo: 'مذكّرة',
        opinion: 'رأي قانوني',
        filing: 'إيداع',
        correspondence: 'مراسلة',
        resolution: 'قرار',
        power_of_attorney: 'وكالة',
        other: 'أخرى',
      },
      statuses: {
        draft: 'مسودة',
        active: 'ساري',
        archived: 'مؤرشف',
        superseded: 'مُستبدَل',
      },
      confidentiality: {
        public: 'عام',
        internal: 'داخلي',
        confidential: 'سرّي',
        privileged: 'محمي بالامتياز',
      },
    },
    summary: {
      documents: 'الوثائق',
      folders: 'المجلدات',
      retentionDue: 'استحقاق الاحتفاظ',
      privileged: 'محمي بالامتياز',
      topFolders: 'أبرز المجلدات',
      savedViews: 'العروض المحفوظة',
      noMetadata: 'لا توجد بيانات وصفية بعد.',
    },
    deleteDialog: {
      title: 'حذف الوثيقة',
      description: (title) => `هل أنت متأكد من حذف "${title}"؟ لا يمكن التراجع عن هذا الإجراء.`,
      confirm: 'حذف',
    },
    toasts: {
      deletedTitle: 'تم حذف الوثيقة.',
      deletedDescription: 'تمت إزالة الوثيقة القانونية.',
      createdTitle: 'تم إنشاء الوثيقة.',
      updatedTitle: 'تم تحديث الوثيقة.',
      createdDescription: 'الوثيقة القانونية متاحة الآن في المستودع.',
      updatedDescription: 'تم حفظ البيانات الوصفية للوثيقة.',
      versionUploadedTitle: 'تم رفع النسخة.',
      versionUploadedDescription: 'تمت إضافة نسخة جديدة من الوثيقة.',
      checkedOutTitle: 'تم تسجيل خروج الوثيقة.',
      checkedOutDescription: (title) => `تم قفل "${title}" لتعديلات المحرّر.`,
      preflightPassedTitle: 'نجح التحقق المسبق.',
      preflightPassedDescription: (title) => `"${title}" جاهزة لمحرّر Word.`,
      preflightReviewTitle: 'يتطلب التحقق المسبق مراجعة.',
      preflightReviewDescription: (count) => `${count} عناصر تحتاج إلى انتباه قبل التحرير.`,
      snapshotCreatedTitle: 'تم إنشاء لقطة النسخة.',
      snapshotCreatedDescription: (title) => `تم تسجيل لقطة زمنية للوثيقة "${title}".`,
      bulkImportTitle: 'اكتمل الاستيراد الجماعي.',
      bulkImportDescription: (imported, failed, requested) =>
        `تم استيراد ${imported}، وفشل ${failed} من أصل ${requested} مُقدَّم.`,
    },
    form: {
      editTitle: 'تعديل الوثيقة',
      createTitle: 'إنشاء وثيقة',
      editDescription: 'تحديث البيانات الوصفية للوثيقة القانونية وتصنيفها.',
      createDescription: 'تسجيل وثيقة قانونية جديدة وإرفاق الملف الأولي اختياريًا.',
      title: 'العنوان',
      titlePlaceholder: 'سياسة حماية البيانات',
      status: 'الحالة',
      documentType: 'نوع الوثيقة',
      confidentiality: 'السرّية',
      description: 'الوصف',
      descriptionPlaceholder: 'نطاق هذه الوثيقة القانونية وغرضها ومجال انطباقها.',
      category: 'الفئة',
      categoryPlaceholder: 'الامتثال',
      tags: 'الوسوم',
      tagsPlaceholder: 'حماية البيانات، سياسة، داخلي',
      initialFileTitle: 'ملف الوثيقة الأولي',
      initialFileHint: 'اختياري. ارفع الملف المصدري لتفعيل تتبع النسخ من البداية.',
      documentFile: 'ملف الوثيقة',
      selectedPrefix: (name) => `المحدد: ${name}`,
      extractedText: 'النص المستخرَج',
      extractedTextPlaceholder: 'الصق نص الوثيقة لأغراض الفهرسة.',
      changeSummary: 'ملخص التغيير',
      changeSummaryPlaceholder: 'النسخة المنشورة الأولى',
      uploadProgress: (percent) => `تقدّم الرفع: ${percent}%`,
      cancel: 'إلغاء',
      save: 'حفظ التغييرات',
      create: 'إنشاء الوثيقة',
    },
    uploadVersion: {
      title: 'رفع نسخة جديدة',
      descriptionWith: (title) => `إرفاق نسخة جديدة من "${title}".`,
      descriptionFallback: 'رفع نسخة جديدة من الوثيقة.',
      documentFile: 'ملف الوثيقة',
      selectedPrefix: (name) => `المحدد: ${name}`,
      changeSummary: 'ملخص التغيير',
      changeSummaryPlaceholder: 'ما الذي تغيّر في هذه النسخة؟',
      extractedText: 'النص المستخرَج',
      extractedTextPlaceholder: 'الصق نص الوثيقة لأغراض الفهرسة.',
      uploadProgress: (percent) => `تقدّم الرفع: ${percent}%`,
      cancel: 'إلغاء',
      submit: 'رفع النسخة',
    },
    bulkImport: {
      title: 'استيراد جماعي للوثائق',
      description: 'الصق مصفوفة JSON من الوثائق القانونية لمسار الاستيراد الجماعي لمستودع وثيق.',
      batchId: 'معرّف الدفعة',
      batchIdPlaceholder: 'legacy-ksa-2026',
      sourceSystem: 'النظام المصدر',
      sourceSystemPlaceholder: 'legacy-dms',
      indexLabel: 'فهرسة المحتوى المستورد',
      indexHint: 'إرفاق بيانات الترحيل والتعرّف الضوئي وفهرسة المستودع أثناء الاستيراد.',
      indexAria: 'فهرسة المحتوى المستورد',
      documentsJson: 'وثائق JSON',
      documentsHint:
        'قدّم ما يصل إلى 250 كائن وثيقة. تُرجِع الخدمة حالات الفشل لكل عنصر دون حجب الدفعة كاملة.',
      close: 'إغلاق',
      cancel: 'إلغاء',
      validatePreview: 'تحقّق ومعاينة',
      importButton: (count) => `استيراد ${count} وثيقة`,
      previewReady: (count) => `المعاينة جاهزة: ${count} وثيقة`,
      editJson: 'تعديل JSON',
      typeUnknown: 'نوع غير معروف',
      confidentialityFallback: 'داخلي',
      documentFallback: (index) => `وثيقة ${index}`,
      andMore: (count) => `و${count} وثيقة أخرى.`,
      resultTitle: 'نتيجة الاستيراد',
      resultSummary: (batchId, imported, failed, requested) =>
        `الدفعة ${batchId}: تم استيراد ${imported}، وفشل ${failed} من أصل ${requested} مُقدَّم.`,
      itemError: (index, error) => `العنصر ${index}: ${error}`,
      itemErrorFallback: 'فشل الاستيراد.',
      errors: {
        mustBeArray: 'يجب أن يكون المُدخَل مصفوفة JSON من كائنات الوثائق.',
        addAtLeastOne: 'أضف وثيقة واحدة على الأقل قبل الاستيراد.',
        tooMany: 'يدعم الاستيراد الجماعي 250 وثيقة كحدّ أقصى لكل طلب.',
        itemMustBeObject: (index) => `يجب أن يكون العنصر ${index} كائن JSON.`,
        invalidJson: (message) => `JSON غير صالح: ${message}`,
      },
    },
    folderTree: {
      allDocuments: 'كل الوثائق',
      expandAll: 'توسيع الكل',
      collapseAll: 'طيّ الكل',
      breadcrumbHome: 'جذر المستودع',
    },
    dropzone: {
      overlayTitle: 'أفلت الملفات للرفع',
      overlayHint: 'حرِّر الزر لإضافة الوثائق إلى هذا المستودع.',
      uploading: 'جارٍ الرفع…',
      unsupported: 'نوع ملف غير مدعوم.',
    },
    emptyStates: {
      noDocsTitle: 'لا توجد وثائق بعد',
      noDocsDescription: 'أنشئ أول وثيقة قانونية أو استورد دفعة موجودة للبدء.',
      noResultsTitle: 'لا توجد وثائق مطابقة',
      noResultsDescription: 'لا توجد وثائق قانونية مطابقة للمرشّحات أو عبارة البحث الحالية.',
      noFoldersHint: 'تظهر المجلدات هنا عند حفظ الوثائق ضمنها.',
      createCta: 'إنشاء وثيقة',
      importCta: 'استيراد جماعي',
      clearFiltersCta: 'مسح المرشّحات',
    },
    rowActions: {
      preview: 'معاينة',
      edit: 'تعديل',
      download: 'تنزيل',
      newVersion: 'رفع نسخة',
      history: 'سجل النسخ',
      changeConfidentiality: 'تغيير السرّية',
      archive: 'أرشفة',
      delete: 'حذف',
    },
    kpiHints: {
      total: 'عرض كل الوثائق',
      privileged: 'تصفية الوثائق المحمية بالامتياز',
      confidential: 'تصفية الوثائق السرّية',
      active: 'تصفية الوثائق السارية',
      retentionDue: 'تصفية الوثائق المستحقة للاحتفاظ',
      missingPolicy: 'تصفية الوثائق بلا سياسة احتفاظ',
    },
    bulkDownload: {
      label: 'تنزيل المحدد',
      preparing: 'جارٍ تجهيز التنزيل…',
      done: 'التنزيل جاهز.',
    },
  },
};

export function useDocumentsLabels(): DocumentsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(documentsLabels, locale), [locale]);
}

/**
 * resolveDocumentsLabels is the pure resolver for non-React callers/tests.
 */
export function resolveDocumentsLabels(locale: AppLocale = 'en'): DocumentsLabels {
  return resolveLexBilingual(documentsLabels, locale === 'ar' ? 'ar' : 'en');
}
