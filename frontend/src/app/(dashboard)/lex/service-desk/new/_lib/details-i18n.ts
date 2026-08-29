'use client';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';

/**
 * Self-contained EN/AR strings for the Details step of the "New Legal Request"
 * wizard (improvement #7: polished bilingual title + description fields).
 *
 * English (MSA-neutral) is the default/fallback branch; Arabic is professional
 * Modern Standard Arabic. Intentionally local to the wizard so the feature ships
 * without touching the shared message catalog.
 */
export interface DetailsStrings {
  // --- Bilingual title fields ---
  /** Label for the Arabic title input. */
  titleArLabel: string;
  /** Label for the English title input. */
  titleEnLabel: string;
  /** Placeholder for the Arabic title input. */
  titleArPlaceholder: string;
  /** Placeholder for the English title input. */
  titleEnPlaceholder: string;
  /** Hint clarifying that only one of the two titles is required. */
  atLeastOneHint: string;
  /** Summary hint shown above the bilingual title pair before either title is entered. */
  titleLanguageRequiredHint: string;
  /** Summary hint shown above the bilingual title pair after one title exists. */
  titleLanguageOptionalHint: string;
  /** Accessible/visible marker for required fields. */
  requiredMark: string;
  /** Accessible label for the required marker. */
  requiredA11y: string;
  /** More explicit helper label for copying English text into the Arabic field. */
  copyEnglishToArabic: string;
  /** More explicit helper label for copying Arabic text into the English field. */
  copyArabicToEnglish: string;
  /** Note that the copy helper mirrors text without translating it. */
  copyNotTranslation: string;
  /** Status label for a populated Arabic title. */
  titleArReady: string;
  /** Status label for a missing Arabic title. */
  titleArMissing: string;
  /** Status label for a populated English title. */
  titleEnReady: string;
  /** Status label for a missing English title. */
  titleEnMissing: string;
  /** Default error message (key 'titleRequired'): at least one title is required. */
  titleRequired: string;

  // --- Description field ---
  /** Label for the description textarea. */
  descriptionLabel: string;
  /** Placeholder for the description textarea. */
  descriptionPlaceholder: string;
  /** "Insert template" button label. */
  insertTemplate: string;
  /** Confirm prompt shown before overwriting an existing description. */
  insertTemplateConfirm: string;
  /** "Draft with AI" button label. */
  draftWithAi: string;
  /** Short helper text shown above the description quality hints. */
  descriptionQualityIntro: string;
  /** Inline checklist hints for a complete request description. */
  descriptionQualityHints: string[];
  /** Supporting copy beside the template action. */
  insertTemplateHelp: string;

  // --- Description template skeleton ---
  /** Heading for the background/context section. */
  tplBackground: string;
  /** Heading for the "what I need" section. */
  tplWhatINeed: string;
  /** Heading for the desired-outcome section. */
  tplDesiredOutcome: string;
  /** Heading for the deadline section. */
  tplDeadline: string;
  /** Heading for the related contract/case section. */
  tplRelatedMatter: string;
  /** Inline placeholder line written under each heading. */
  tplPlaceholderLine: string;

  // --- Requested due date + additional notes (persisted via request metadata) ---
  /** Label for the requested due-date input. */
  dueDateLabel: string;
  /** Helper text under the requested due-date input. */
  dueDateHint: string;
  /** Accessible marker appended to required field labels. */
  dueDateRequired: string;
  /** Label for the additional-notes textarea. */
  notesLabel: string;
  /** Placeholder for the additional-notes textarea. */
  notesPlaceholder: string;

  // --- Shared ---
  /** Accessible suffix announcing the live character counter, e.g. "120 of 160 characters used". */
  counterA11y: (used: number, max: number) => string;
}

const EN: DetailsStrings = {
  titleArLabel: 'Title (Arabic)',
  titleEnLabel: 'Title (English)',
  titleArPlaceholder: 'Enter a short, descriptive title in Arabic',
  titleEnPlaceholder: 'Enter a short, descriptive title in English',
  atLeastOneHint: 'at least one',
  titleLanguageRequiredHint: 'Add a title in Arabic or English to continue.',
  titleLanguageOptionalHint: 'One title is enough; add the other language to improve search.',
  requiredMark: '*',
  requiredA11y: 'required',
  copyEnglishToArabic: 'Copy English into Arabic',
  copyArabicToEnglish: 'Copy Arabic into English',
  copyNotTranslation: 'Copies text only; review the wording before submitting.',
  titleArReady: 'Arabic title added',
  titleArMissing: 'Arabic title missing',
  titleEnReady: 'English title added',
  titleEnMissing: 'English title missing',
  titleRequired: 'Provide a title in at least one language.',

  descriptionLabel: 'Description',
  descriptionPlaceholder: 'Describe your request: context, what you need, and any deadline.',
  insertTemplate: 'Insert template',
  insertTemplateConfirm:
    'This will replace your current description with a structured template. Continue?',
  draftWithAi: 'Draft with AI',
  descriptionQualityIntro: 'A strong description usually includes:',
  descriptionQualityHints: ['Context', 'Requested outcome', 'Deadline', 'Related contract/case'],
  insertTemplateHelp: 'Start with a guided structure for faster review.',

  tplBackground: 'Background',
  tplWhatINeed: 'What I need',
  tplDesiredOutcome: 'Desired outcome',
  tplDeadline: 'Deadline',
  tplRelatedMatter: 'Related contract/case',
  tplPlaceholderLine: '…',
  dueDateLabel: 'Requested due date & time',
  dueDateHint: 'Required — choose a date and time from now onwards. The SLA target remains authoritative.',
  dueDateRequired: 'required',
  notesLabel: 'Additional notes / instructions (optional)',
  notesPlaceholder: 'Any other specific requests or context for the legal advisor…',

  counterA11y: (used, max) => `${used} of ${max} characters used`,
};

const AR: DetailsStrings = {
  titleArLabel: 'العنوان (بالعربية)',
  titleEnLabel: 'العنوان (بالإنجليزية)',
  titleArPlaceholder: 'أدخل عنوانًا موجزًا ووصفيًا بالعربية',
  titleEnPlaceholder: 'أدخل عنوانًا موجزًا ووصفيًا بالإنجليزية',
  atLeastOneHint: 'واحد على الأقل',
  titleLanguageRequiredHint: 'أضف عنوانًا بالعربية أو الإنجليزية للمتابعة.',
  titleLanguageOptionalHint: 'عنوان واحد يكفي؛ أضف اللغة الأخرى لتحسين البحث.',
  requiredMark: '*',
  requiredA11y: 'مطلوب',
  copyEnglishToArabic: 'نسخ الإنجليزية إلى العربية',
  copyArabicToEnglish: 'نسخ العربية إلى الإنجليزية',
  copyNotTranslation: 'ينسخ النص فقط؛ راجع الصياغة قبل الإرسال.',
  titleArReady: 'تمت إضافة العنوان العربي',
  titleArMissing: 'العنوان العربي غير موجود',
  titleEnReady: 'تمت إضافة العنوان الإنجليزي',
  titleEnMissing: 'العنوان الإنجليزي غير موجود',
  titleRequired: 'يرجى إدخال عنوان بلغة واحدة على الأقل.',

  descriptionLabel: 'الوصف',
  descriptionPlaceholder: 'صِف طلبك: السياق، وما تحتاج إليه، وأي موعد نهائي.',
  insertTemplate: 'إدراج قالب',
  insertTemplateConfirm: 'سيؤدي هذا إلى استبدال الوصف الحالي بقالب منظَّم. هل تريد المتابعة؟',
  draftWithAi: 'صياغة بالذكاء الاصطناعي',
  descriptionQualityIntro: 'عادةً ما يتضمن الوصف الجيد:',
  descriptionQualityHints: ['السياق', 'النتيجة المطلوبة', 'الموعد النهائي', 'العقد/القضية ذات الصلة'],
  insertTemplateHelp: 'ابدأ بهيكل إرشادي لتسريع المراجعة.',

  tplBackground: 'الخلفية',
  tplWhatINeed: 'ما أحتاج إليه',
  tplDesiredOutcome: 'النتيجة المرجوة',
  tplDeadline: 'الموعد النهائي',
  tplRelatedMatter: 'العقد/القضية ذات الصلة',
  tplPlaceholderLine: '…',
  dueDateLabel: 'تاريخ ووقت الاستحقاق المطلوب',
  dueDateHint: 'مطلوب — اختر تاريخًا ووقتًا من الآن فصاعدًا. ويبقى هدف مستوى الخدمة هو المعتمد.',
  dueDateRequired: 'مطلوب',
  notesLabel: 'ملاحظات / تعليمات إضافية (اختياري)',
  notesPlaceholder: 'أي طلبات أو سياق إضافي تود إحاطة المستشار القانوني به…',

  counterA11y: (used, max) => `تم استخدام ${used} من ${max} حرفًا`,
};

/** Returns the Details-step strings for the active locale (default EN). */
export function useDetailsStrings(): DetailsStrings {
  const { locale } = useLocaleOrDefault();
  return locale === 'ar' ? AR : EN;
}

/**
 * Build a structured description skeleton (Background / What I need / Desired
 * outcome / Deadline / Related contract/case). When `serviceLabel` is provided,
 * the Background heading is lightly tailored to the service so the scaffold
 * feels request-aware; otherwise a generic skeleton is returned. Pure — no side
 * effects.
 */
export function buildDescriptionTemplate(t: DetailsStrings, serviceLabel?: string): string {
  const background = serviceLabel
    ? `${t.tplBackground} (${serviceLabel})`
    : t.tplBackground;
  const sections = [
    background,
    t.tplWhatINeed,
    t.tplDesiredOutcome,
    t.tplDeadline,
    t.tplRelatedMatter,
  ];
  return sections.map((heading) => `${heading}:\n${t.tplPlaceholderLine}`).join('\n\n');
}
