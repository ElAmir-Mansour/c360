'use client';

/**
 * Bilingual (English + MSA) label bundle for the WatheeqTech Reference Library
 * (`/lex/library`). Follows the canonical lex i18n contract
 * ({@link LexBilingual}) — two full same-shaped copies, resolved against the
 * active locale via {@link useLibraryLabels}.
 *
 * The enum maps (`category` / `doc_type`) are keyed by the RAW backend token so
 * a component resolves a chip label with `labels.category[token] ?? token`.
 * BOTH locales carry the SAME key set — no raw English tokens surface in Arabic.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  type LexBilingual,
  resolveLexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';
import type { PdfViewerLabels } from '../_components/pdf/pdf-viewer-types';

export interface LibraryLabels {
  eyebrow: string;
  pageTitle: string;
  pageDescription: string;

  /** Corpus buckets, keyed by the raw `category` token. */
  category: Record<string, string>;
  /** Finer document types, keyed by the raw `doc_type` token. */
  docType: Record<string, string>;

  kpis: {
    total: string;
    totalDescription: string;
    systemsRegulations: string;
    judicialJournal: string;
    research: string;
  };

  facets: {
    title: string;
    all: string;
    categories: string;
    docTypes: string;
    topics: string;
    clear: string;
  };

  search: {
    placeholder: string;
    metadataMode: string;
    contentsMode: string;
    modeAria: string;
    contentsHint: string;
    contentsEmptyTitle: string;
    contentsEmptyDescription: string;
    contentsResults: (count: number) => string;
    relevance: string;
    searching: string;
    openAtPageAria: (title: string) => string;
    matchLabel: string;
  };

  columns: {
    document: string;
    classification: string;
    authority: string;
    topics: string;
    actions: string;
  };

  cells: {
    noTopics: string;
    noAuthority: string;
  };

  actions: {
    preview: string;
    download: string;
    clauseLibrary: string;
    askLibrary: string;
  };

  table: {
    emptyTitle: string;
    emptyDescription: string;
    searchPlaceholder: string;
  };

  savedViews: {
    save: string;
    saved: string;
    empty: string;
  };

  error: {
    title: string;
    description: string;
    retry: string;
  };

  preview: {
    fallbackTitle: string;
    close: string;
    download: string;
    openInNewTab: string;
    copySource: string;
    sourceCopied: string;
    sourceUnavailable: string;
    copyFailed: string;
    loading: string;
    unavailableTitle: string;
    unavailableDescription: string;
    integrityTitle: string;
    fileSize: string;
    contentHash: string;
    copyHashAria: string;
    hashCopied: string;
    unavailable: string;
    authority: string;
    jurisdiction: string;
    issued: string;
    description: string;
    viewFullPage: string;
    copyLink: string;
    linkCopied: string;
  };

  ask: {
    title: string;
    description: string;
    inputLabel: string;
    inputPlaceholder: string;
    submit: string;
    stop: string;
    thinking: string;
    answerTitle: string;
    citationsTitle: string;
    openCitation: (title: string) => string;
    emptyTitle: string;
    emptyDescription: string;
    notConfiguredTitle: string;
    notConfiguredDescription: string;
    errorTitle: string;
    errorDescription: string;
    modelLine: (model: string, ms: number) => string;
    disclaimer: string;
    suggestedTitle: string;
    starters: string[];
    newConversation: string;
    followUpPlaceholder: string;
    youLabel: string;
    scopedTitle: (title: string) => string;
    scopedDescription: string;
    onThisPage: (page: string) => string;
    sourcesCount: (count: number) => string;
    // Trust + verifiability
    trustDisclaimer: string;
    unverifiedWarning: string;
    // Copy / export
    copy: string;
    copied: string;
    copyFailed: string;
    export: string;
    exported: string;
    exportFileName: string;
    exportQuestionLabel: string;
    exportAnswerLabel: string;
    exportSourcesLabel: string;
    exportPageLabel: (page: string) => string;
    exportGeneratedBy: (model: string) => string;
    // Feedback
    feedbackPrompt: string;
    feedbackHelpful: string;
    feedbackNotHelpful: string;
    feedbackThanks: string;
    feedbackCommentPlaceholder: string;
    feedbackCommentSubmit: string;
    feedbackCommentSkip: string;
  };

  /** Article/مادة table-of-contents navigation panel in the detail viewer. */
  articles: {
    title: string;
    description: string;
    show: string;
    hide: string;
    empty: string;
    count: (n: number) => string;
    jumpToAria: (label: string) => string;
    pageLabel: (page: string) => string;
  };

  /** Rich PDF viewer chrome — the exact {@link PdfViewerLabels} shape. */
  viewer: PdfViewerLabels;

  analytics: {
    recentlyAdded: string;
    recentlyAddedDescription: string;
    recentlyViewed: string;
    recentlyViewedDescription: string;
    recentlyViewedEmpty: string;
    clearRecent: string;
    addedPrefix: string;
    authoritiesKpi: string;
    topicsKpi: string;
  };

  drilldown: {
    contributingDocuments: string;
    documentCount: (count: number) => string;
    groupCount: (count: number) => string;
    selectGroup: string;
    allGroups: string;
    empty: string;
    openDocument: (title: string) => string;
  };

  detail: {
    back: string;
    backToLibrary: string;
    copyLink: string;
    linkCopied: string;
    copyLinkFailed: string;
    overview: string;
    metadata: string;
    relatedTitle: string;
    relatedDescription: string;
    relatedEmpty: string;
    aboutDoc: string;
    notFoundTitle: string;
    notFoundDescription: string;
    download: string;
    openNewTab: string;
    loadingTitle: string;
    source: string;
    issued: string;
    fileSize: string;
    contentHash: string;
    authority: string;
    jurisdiction: string;
    unavailable: string;
    topics: string;
    // "As-of" / version-currency trust affordance
    asOf: string;
    effectiveDate: string;
    confirmCurrencyTitle: string;
    confirmCurrencyNote: string;
    confirmCurrencyLink: string;
  };
}

export const libraryLabels: LexBilingual<LibraryLabels> = {
  en: {
    eyebrow: 'Legal Library',
    pageTitle: 'Reference Library',
    pageDescription:
      'The Watheeq Saudi legal reference corpus — systems & regulations, the Judicial Journal, and research & studies. Read-only, available to every user.',
    category: {
      'systems-regulations': 'Systems & Regulations',
      'judicial-journal': 'Judicial Journal',
      research: 'Research & Studies',
    },
    docType: {
      system: 'Law',
      regulation: 'Regulation',
      'judicial-journal': 'Judicial Journal',
      research: 'Research',
    },
    kpis: {
      total: 'Total Documents',
      totalDescription: 'Across the reference corpus',
      systemsRegulations: 'Systems & Regulations',
      judicialJournal: 'Judicial Journal',
      research: 'Research & Studies',
    },
    facets: {
      title: 'Browse the corpus',
      all: 'All documents',
      categories: 'Corpus',
      docTypes: 'Document type',
      topics: 'Topics',
      clear: 'Clear filters',
    },
    search: {
      placeholder: 'Search titles, authorities, topics…',
      metadataMode: 'Metadata',
      contentsMode: 'Contents',
      modeAria: 'Search mode',
      contentsHint: 'Search inside the documents to find relevant passages.',
      contentsEmptyTitle: 'No matching passages',
      contentsEmptyDescription: 'No document contents matched your query. Try different wording.',
      contentsResults: (count) => `${count} matching passage${count === 1 ? '' : 's'}`,
      relevance: 'Relevance',
      searching: 'Searching contents…',
      openAtPageAria: (title) => `Open “${title}” at the matching passage`,
      matchLabel: 'match',
    },
    columns: {
      document: 'Document',
      classification: 'Classification',
      authority: 'Authority',
      topics: 'Topics',
      actions: 'Actions',
    },
    cells: {
      noTopics: 'No topics',
      noAuthority: '—',
    },
    actions: {
      preview: 'Preview',
      download: 'Download',
      clauseLibrary: 'Clause Library',
      askLibrary: 'Ask the Library',
    },
    table: {
      emptyTitle: 'No documents found',
      emptyDescription: 'No reference documents match the current filters.',
      searchPlaceholder: 'Search the library…',
    },
    savedViews: {
      save: 'Save view',
      saved: 'Saved views',
      empty: 'No saved views yet',
    },
    error: {
      title: 'Could not load the library',
      description: 'The reference library could not be loaded. Please try again.',
      retry: 'Retry',
    },
    preview: {
      fallbackTitle: 'Document preview',
      close: 'Close',
      download: 'Download',
      openInNewTab: 'Open in new tab',
      copySource: 'Copy source link',
      sourceCopied: 'Source link copied to clipboard.',
      sourceUnavailable: 'No official source link is available for this document.',
      copyFailed: 'Could not copy to the clipboard.',
      loading: 'Loading document…',
      unavailableTitle: 'Preview unavailable',
      unavailableDescription: 'This document has no attached file to preview.',
      integrityTitle: 'Integrity',
      fileSize: 'File size',
      contentHash: 'Content hash',
      copyHashAria: 'Copy content hash',
      hashCopied: 'Content hash copied.',
      unavailable: 'Unavailable',
      authority: 'Authority',
      jurisdiction: 'Jurisdiction',
      issued: 'Issued',
      description: 'About this document',
      viewFullPage: 'Open full page',
      copyLink: 'Copy link',
      linkCopied: 'Link copied to clipboard.',
    },
    ask: {
      title: 'Ask the Library',
      description: 'Ask a question and get an answer grounded in the reference corpus, with citations.',
      inputLabel: 'Your question',
      inputPlaceholder: 'e.g. What are the guarantor’s recourse rights against the debtor?',
      submit: 'Ask',
      stop: 'Stop',
      thinking: 'Consulting the library…',
      answerTitle: 'Answer',
      citationsTitle: 'Sources',
      openCitation: (title) => `Open ${title}`,
      emptyTitle: 'Ask a legal question',
      emptyDescription: 'Answers are drawn only from the Watheeq reference corpus and cite their sources.',
      notConfiguredTitle: 'Not yet enabled',
      notConfiguredDescription:
        'Ask the Library is coming soon. The corpus intelligence service is not enabled in this environment yet.',
      errorTitle: 'Could not get an answer',
      errorDescription: 'Something went wrong answering your question. Please try again.',
      modelLine: (model, ms) => `${model} · ${ms} ms`,
      disclaimer: 'AI-generated summary — always verify against the cited source documents.',
      suggestedTitle: 'Try asking',
      starters: [
        'What are the guarantor’s recourse rights against the debtor?',
        'When may a resignation be withdrawn under a labour contract?',
        'What are the standards for trademark protection and registration?',
        'How are real-estate units partitioned and managed?',
      ],
      newConversation: 'New conversation',
      followUpPlaceholder: 'Ask a follow-up question…',
      youLabel: 'You',
      scopedTitle: (title) => `Ask about “${title}”`,
      scopedDescription: 'Answers are scoped to this document, with citations you can open in the viewer.',
      onThisPage: (page) => `Page ${page}`,
      sourcesCount: (count) => `${count} source${count === 1 ? '' : 's'}`,
      trustDisclaimer:
        'AI-generated from the reference texts; verify against the official source. Not legal advice.',
      unverifiedWarning:
        'This answer cites no sources — treat it as unverified and confirm against the reference texts.',
      copy: 'Copy',
      copied: 'Answer and sources copied to the clipboard.',
      copyFailed: 'Could not copy to the clipboard.',
      export: 'Export',
      exported: 'Answer exported.',
      exportFileName: 'library-answer',
      exportQuestionLabel: 'Question',
      exportAnswerLabel: 'Answer',
      exportSourcesLabel: 'Sources',
      exportPageLabel: (page) => `page ${page}`,
      exportGeneratedBy: (model) => `Generated by ${model} — AI-generated, not legal advice.`,
      feedbackPrompt: 'Was this answer helpful?',
      feedbackHelpful: 'Helpful',
      feedbackNotHelpful: 'Not helpful',
      feedbackThanks: 'Thanks — your feedback was recorded.',
      feedbackCommentPlaceholder: 'What was missing or wrong? (optional)',
      feedbackCommentSubmit: 'Send feedback',
      feedbackCommentSkip: 'Skip',
    },
    articles: {
      title: 'Articles',
      description: 'Jump to an article in the document.',
      show: 'Show articles',
      hide: 'Hide articles',
      empty: 'No article index is available for this document.',
      count: (n) => `${n} article${n === 1 ? '' : 's'}`,
      jumpToAria: (label) => `Go to ${label}`,
      pageLabel: (page) => `p. ${page}`,
    },
    viewer: {
      frameTitle: 'PDF document',
      nativeBadge: 'Basic viewer',
      richBadge: 'Enhanced viewer',
      useRich: 'Enhanced viewer',
      useNative: 'Basic viewer',
      download: 'Download',
      openNewTab: 'Open in new tab',
      loading: 'Loading document…',
      rendering: 'Rendering…',
      unavailable: 'No document to preview.',
      engineError: 'The enhanced viewer could not load — showing the basic viewer.',
      prevPage: 'Previous page',
      nextPage: 'Next page',
      pageOf: (current, total) => `${current} / ${total}`,
      jumpToPage: 'Go to page',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      fitWidth: 'Fit width',
      fitPage: 'Fit page',
      zoomLevel: 'Zoom level',
      thumbnails: 'Page thumbnails',
      showThumbnails: 'Show thumbnails',
      hideThumbnails: 'Hide thumbnails',
      thumbnailPage: (n) => `Page ${n}`,
      searchInDoc: 'Search in document',
      searchPlaceholder: 'Search this document…',
      nextMatch: 'Next match',
      prevMatch: 'Previous match',
      matchOf: (current, total) => `${current} of ${total}`,
      noMatches: 'No matches',
      searching: 'Searching…',
      closeSearch: 'Close search',
    },
    analytics: {
      recentlyAdded: 'Recently added',
      recentlyAddedDescription: 'The newest additions to the reference corpus.',
      recentlyViewed: 'Recently viewed',
      recentlyViewedDescription: 'Documents you opened recently on this device.',
      recentlyViewedEmpty: 'Documents you open will appear here for quick access.',
      clearRecent: 'Clear',
      addedPrefix: 'Added',
      authoritiesKpi: 'Issuing bodies',
      topicsKpi: 'Topics',
    },
    drilldown: {
      contributingDocuments: 'Contributing documents',
      documentCount: (count) => `${count} document${count === 1 ? '' : 's'}`,
      groupCount: (count) => `${count} contributing group${count === 1 ? '' : 's'}`,
      selectGroup: 'Select a group to inspect its documents.',
      allGroups: 'All groups',
      empty: 'No contributing documents are available.',
      openDocument: (title) => `Open ${title}`,
    },
    detail: {
      back: 'Back',
      backToLibrary: 'Back to the library',
      copyLink: 'Copy link',
      linkCopied: 'Link copied to clipboard.',
      copyLinkFailed: 'Could not copy the link.',
      overview: 'Document',
      metadata: 'Details',
      relatedTitle: 'Related documents',
      relatedDescription: 'Other documents in the same part of the corpus.',
      relatedEmpty: 'No related documents found.',
      aboutDoc: 'About this document',
      notFoundTitle: 'Document not found',
      notFoundDescription: 'This reference document could not be found. It may have been moved.',
      download: 'Download',
      openNewTab: 'Open in new tab',
      loadingTitle: 'Loading document…',
      source: 'Official source',
      issued: 'Issued',
      fileSize: 'File size',
      contentHash: 'Content hash',
      authority: 'Authority',
      jurisdiction: 'Jurisdiction',
      unavailable: 'Unavailable',
      topics: 'Topics',
      asOf: 'In force as of',
      effectiveDate: 'Effective date',
      confirmCurrencyTitle: 'Confirm you are viewing the current version',
      confirmCurrencyNote:
        'No effective date is recorded for this document. Verify the latest version is in force before relying on it.',
      confirmCurrencyLink: 'Check the official source',
    },
  },
  ar: {
    eyebrow: 'المكتبة القانونية',
    pageTitle: 'المكتبة المرجعية',
    pageDescription:
      'مجموعة وثيق للمراجع القانونية السعودية — الأنظمة واللوائح، ومجلة قضاء، والبحوث والدراسات. للقراءة فقط، ومتاحة لكل المستخدمين.',
    category: {
      'systems-regulations': 'الأنظمة واللوائح',
      'judicial-journal': 'مجلة قضاء',
      research: 'بحوث ودراسات',
    },
    docType: {
      system: 'نظام',
      regulation: 'لائحة',
      'judicial-journal': 'مجلة قضاء',
      research: 'بحث',
    },
    kpis: {
      total: 'إجمالي الوثائق',
      totalDescription: 'عبر المجموعة المرجعية',
      systemsRegulations: 'الأنظمة واللوائح',
      judicialJournal: 'مجلة قضاء',
      research: 'بحوث ودراسات',
    },
    facets: {
      title: 'تصفّح المجموعة',
      all: 'كل الوثائق',
      categories: 'المجموعة',
      docTypes: 'نوع الوثيقة',
      topics: 'المواضيع',
      clear: 'مسح عوامل التصفية',
    },
    search: {
      placeholder: 'ابحث في العناوين والجهات والمواضيع…',
      metadataMode: 'البيانات الوصفية',
      contentsMode: 'المحتوى',
      modeAria: 'وضع البحث',
      contentsHint: 'ابحث داخل الوثائق للعثور على المقاطع ذات الصلة.',
      contentsEmptyTitle: 'لا توجد مقاطع مطابقة',
      contentsEmptyDescription: 'لم يطابق محتوى أي وثيقة استعلامك. جرّب صياغة مختلفة.',
      contentsResults: (count) => `${count} مقطع مطابق`,
      relevance: 'مدى الصلة',
      searching: 'جارٍ البحث في المحتوى…',
      openAtPageAria: (title) => `فتح «${title}» عند المقطع المطابق`,
      matchLabel: 'تطابق',
    },
    columns: {
      document: 'الوثيقة',
      classification: 'التصنيف',
      authority: 'الجهة',
      topics: 'المواضيع',
      actions: 'الإجراءات',
    },
    cells: {
      noTopics: 'بلا مواضيع',
      noAuthority: '—',
    },
    actions: {
      preview: 'معاينة',
      download: 'تنزيل',
      clauseLibrary: 'مكتبة البنود',
      askLibrary: 'اسأل المكتبة',
    },
    table: {
      emptyTitle: 'لا توجد وثائق',
      emptyDescription: 'لا توجد وثائق مرجعية تطابق عوامل التصفية الحالية.',
      searchPlaceholder: 'ابحث في المكتبة…',
    },
    savedViews: {
      save: 'حفظ العرض',
      saved: 'العروض المحفوظة',
      empty: 'لا توجد عروض محفوظة بعد',
    },
    error: {
      title: 'تعذّر تحميل المكتبة',
      description: 'تعذّر تحميل المكتبة المرجعية. يرجى المحاولة مرة أخرى.',
      retry: 'إعادة المحاولة',
    },
    preview: {
      fallbackTitle: 'معاينة الوثيقة',
      close: 'إغلاق',
      download: 'تنزيل',
      openInNewTab: 'فتح في تبويب جديد',
      copySource: 'نسخ رابط المصدر',
      sourceCopied: 'تم نسخ رابط المصدر.',
      sourceUnavailable: 'لا يتوفّر رابط مصدر رسمي لهذه الوثيقة.',
      copyFailed: 'تعذّر النسخ إلى الحافظة.',
      loading: 'جارٍ تحميل الوثيقة…',
      unavailableTitle: 'المعاينة غير متاحة',
      unavailableDescription: 'لا يوجد ملف مرفق بهذه الوثيقة للمعاينة.',
      integrityTitle: 'السلامة',
      fileSize: 'حجم الملف',
      contentHash: 'بصمة المحتوى',
      copyHashAria: 'نسخ بصمة المحتوى',
      hashCopied: 'تم نسخ بصمة المحتوى.',
      unavailable: 'غير متاح',
      authority: 'الجهة',
      jurisdiction: 'الاختصاص',
      issued: 'تاريخ الإصدار',
      description: 'حول هذه الوثيقة',
      viewFullPage: 'فتح الصفحة الكاملة',
      copyLink: 'نسخ الرابط',
      linkCopied: 'تم نسخ الرابط إلى الحافظة.',
    },
    ask: {
      title: 'اسأل المكتبة',
      description: 'اطرح سؤالًا واحصل على إجابة مستندة إلى المجموعة المرجعية مع الاستشهادات.',
      inputLabel: 'سؤالك',
      inputPlaceholder: 'مثال: ما هي أحكام رجوع الكفيل على المدين؟',
      submit: 'اسأل',
      stop: 'إيقاف',
      thinking: 'جارٍ استشارة المكتبة…',
      answerTitle: 'الإجابة',
      citationsTitle: 'المصادر',
      openCitation: (title) => `فتح ${title}`,
      emptyTitle: 'اطرح سؤالًا قانونيًا',
      emptyDescription: 'تُستمَد الإجابات من مجموعة وثيق المرجعية فقط، وتذكر مصادرها.',
      notConfiguredTitle: 'غير مُفعّل بعد',
      notConfiguredDescription:
        'ميزة «اسأل المكتبة» قادمة قريبًا. لم تُفعّل خدمة ذكاء المجموعة في هذه البيئة بعد.',
      errorTitle: 'تعذّر الحصول على إجابة',
      errorDescription: 'حدث خطأ أثناء الإجابة عن سؤالك. يرجى المحاولة مرة أخرى.',
      modelLine: (model, ms) => `${model} · ${ms} مللي ثانية`,
      disclaimer: 'ملخّص مُولّد بالذكاء الاصطناعي — تحقّق دائمًا من وثائق المصدر المُستشهد بها.',
      suggestedTitle: 'جرّب أن تسأل',
      starters: [
        'ما هي أحكام رجوع الكفيل على المدين؟',
        'متى يجوز التراجع عن الاستقالة في عقد العمل؟',
        'ما معايير حماية العلامة التجارية وإجراءات تسجيلها؟',
        'كيف تُفرز الوحدات العقارية وتُدار؟',
      ],
      newConversation: 'محادثة جديدة',
      followUpPlaceholder: 'اطرح سؤالًا متابعًا…',
      youLabel: 'أنت',
      scopedTitle: (title) => `اسأل عن «${title}»`,
      scopedDescription: 'الإجابات محصورة في هذه الوثيقة، مع استشهادات يمكن فتحها في العارض.',
      onThisPage: (page) => `صفحة ${page}`,
      sourcesCount: (count) => `${count} مصدر`,
      trustDisclaimer:
        'الإجابات مولّدة بالذكاء الاصطناعي من نصوص المراجع؛ تحقّق من المصدر الرسمي. ليست استشارة قانونية.',
      unverifiedWarning:
        'لا تستند هذه الإجابة إلى أي مصدر — اعتبرها غير مُوثّقة وتحقّق منها في نصوص المراجع.',
      copy: 'نسخ',
      copied: 'تم نسخ الإجابة والمصادر إلى الحافظة.',
      copyFailed: 'تعذّر النسخ إلى الحافظة.',
      export: 'تصدير',
      exported: 'تم تصدير الإجابة.',
      exportFileName: 'إجابة-المكتبة',
      exportQuestionLabel: 'السؤال',
      exportAnswerLabel: 'الإجابة',
      exportSourcesLabel: 'المصادر',
      exportPageLabel: (page) => `صفحة ${page}`,
      exportGeneratedBy: (model) => `مُولّدة بواسطة ${model} — إجابة بالذكاء الاصطناعي وليست استشارة قانونية.`,
      feedbackPrompt: 'هل كانت هذه الإجابة مفيدة؟',
      feedbackHelpful: 'مفيدة',
      feedbackNotHelpful: 'غير مفيدة',
      feedbackThanks: 'شكرًا — تم تسجيل ملاحظتك.',
      feedbackCommentPlaceholder: 'ما الذي كان ناقصًا أو خاطئًا؟ (اختياري)',
      feedbackCommentSubmit: 'إرسال الملاحظة',
      feedbackCommentSkip: 'تخطٍّ',
    },
    articles: {
      title: 'المواد',
      description: 'انتقل إلى مادة داخل الوثيقة.',
      show: 'إظهار المواد',
      hide: 'إخفاء المواد',
      empty: 'لا يتوفّر فهرس مواد لهذه الوثيقة.',
      count: (n) => `${n} مادة`,
      jumpToAria: (label) => `الانتقال إلى ${label}`,
      pageLabel: (page) => `ص ${page}`,
    },
    viewer: {
      frameTitle: 'وثيقة PDF',
      nativeBadge: 'العارض الأساسي',
      richBadge: 'العارض المتقدّم',
      useRich: 'العارض المتقدّم',
      useNative: 'العارض الأساسي',
      download: 'تنزيل',
      openNewTab: 'فتح في تبويب جديد',
      loading: 'جارٍ تحميل الوثيقة…',
      rendering: 'جارٍ العرض…',
      unavailable: 'لا توجد وثيقة للمعاينة.',
      engineError: 'تعذّر تحميل العارض المتقدّم — يتم عرض العارض الأساسي.',
      prevPage: 'الصفحة السابقة',
      nextPage: 'الصفحة التالية',
      pageOf: (current, total) => `${current} / ${total}`,
      jumpToPage: 'انتقل إلى الصفحة',
      zoomIn: 'تكبير',
      zoomOut: 'تصغير',
      fitWidth: 'ملء العرض',
      fitPage: 'ملء الصفحة',
      zoomLevel: 'مستوى التكبير',
      thumbnails: 'مصغّرات الصفحات',
      showThumbnails: 'إظهار المصغّرات',
      hideThumbnails: 'إخفاء المصغّرات',
      thumbnailPage: (n) => `صفحة ${n}`,
      searchInDoc: 'ابحث في الوثيقة',
      searchPlaceholder: 'ابحث في هذه الوثيقة…',
      nextMatch: 'التطابق التالي',
      prevMatch: 'التطابق السابق',
      matchOf: (current, total) => `${current} من ${total}`,
      noMatches: 'لا توجد نتائج',
      searching: 'جارٍ البحث…',
      closeSearch: 'إغلاق البحث',
    },
    analytics: {
      recentlyAdded: 'أُضيفت حديثًا',
      recentlyAddedDescription: 'أحدث الإضافات إلى المجموعة المرجعية.',
      recentlyViewed: 'شُوهدت مؤخرًا',
      recentlyViewedDescription: 'الوثائق التي فتحتها مؤخرًا على هذا الجهاز.',
      recentlyViewedEmpty: 'ستظهر هنا الوثائق التي تفتحها للوصول السريع.',
      clearRecent: 'مسح',
      addedPrefix: 'أُضيفت',
      authoritiesKpi: 'الجهات المُصدِرة',
      topicsKpi: 'المواضيع',
    },
    drilldown: {
      contributingDocuments: 'الوثائق المساهمة',
      documentCount: (count) => `${count} وثيقة`,
      groupCount: (count) => `${count} مجموعة مساهمة`,
      selectGroup: 'اختر مجموعة لعرض وثائقها.',
      allGroups: 'كل المجموعات',
      empty: 'لا توجد وثائق مساهمة متاحة.',
      openDocument: (title) => `فتح ${title}`,
    },
    detail: {
      back: 'رجوع',
      backToLibrary: 'العودة إلى المكتبة',
      copyLink: 'نسخ الرابط',
      linkCopied: 'تم نسخ الرابط إلى الحافظة.',
      copyLinkFailed: 'تعذّر نسخ الرابط.',
      overview: 'الوثيقة',
      metadata: 'التفاصيل',
      relatedTitle: 'وثائق ذات صلة',
      relatedDescription: 'وثائق أخرى في القسم نفسه من المجموعة.',
      relatedEmpty: 'لا توجد وثائق ذات صلة.',
      aboutDoc: 'حول هذه الوثيقة',
      notFoundTitle: 'الوثيقة غير موجودة',
      notFoundDescription: 'تعذّر العثور على هذه الوثيقة المرجعية. ربما تم نقلها.',
      download: 'تنزيل',
      openNewTab: 'فتح في تبويب جديد',
      loadingTitle: 'جارٍ تحميل الوثيقة…',
      source: 'المصدر الرسمي',
      issued: 'تاريخ الإصدار',
      fileSize: 'حجم الملف',
      contentHash: 'بصمة المحتوى',
      authority: 'الجهة',
      jurisdiction: 'الاختصاص',
      unavailable: 'غير متاح',
      topics: 'المواضيع',
      asOf: 'ساري اعتبارًا من',
      effectiveDate: 'تاريخ السريان',
      confirmCurrencyTitle: 'تأكّد من سريان أحدث نسخة من النظام',
      confirmCurrencyNote:
        'لا يوجد تاريخ سريان مُسجّل لهذه الوثيقة. تحقّق من سريان أحدث نسخة قبل الاعتماد عليها.',
      confirmCurrencyLink: 'راجِع المصدر الرسمي',
    },
  },
};

export function useLibraryLabels(): LibraryLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(libraryLabels, locale), [locale]);
}
