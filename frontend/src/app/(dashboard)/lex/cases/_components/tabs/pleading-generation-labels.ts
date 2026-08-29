'use client';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export interface PleadingGenerationLabels {
  draftSaved: string;
  draftSavedDescription: string;
  savingDraft: string;
  queued: string;
  running: string;
  completed: string;
  failed: string;
  cancelled: string;
  disconnected: string;
  currentSection: string;
  streamedDraft: string;
  backgroundHint: string;
  progress: (value: number) => string;
  retry: string;
  cancel: string;
  resume: string;
  cancelling: string;
  retrying: string;
  dismiss: string;
  unknownError: string;
}

const COPY: Record<'en' | 'ar', PleadingGenerationLabels> = {
  en: {
    draftSaved: 'Draft saved',
    draftSavedDescription:
      'AI generation is continuing in the background. You can leave this page safely.',
    savingDraft: 'Saving draft…',
    queued: 'Queued for generation',
    running: 'Generating pleading',
    completed: 'Draft generation completed',
    failed: 'Draft generation failed',
    cancelled: 'Draft generation cancelled',
    disconnected: 'Generation continues in the background',
    currentSection: 'Current section',
    streamedDraft: 'Live draft',
    backgroundHint:
      'Closing this page detaches the live view but does not stop the generation job.',
    progress: (value) => `${Math.round(value)}% complete`,
    retry: 'Retry generation',
    cancel: 'Cancel generation',
    resume: 'Resume updates',
    cancelling: 'Cancelling…',
    retrying: 'Retrying…',
    dismiss: 'Dismiss',
    unknownError: 'The generation service could not complete this draft.',
  },
  ar: {
    draftSaved: 'تم حفظ المسودة',
    draftSavedDescription:
      'تستمر الصياغة بالذكاء الاصطناعي في الخلفية، ويمكنك مغادرة الصفحة بأمان.',
    savingDraft: 'جارٍ حفظ المسودة…',
    queued: 'في قائمة انتظار الصياغة',
    running: 'جارٍ إعداد المذكرة',
    completed: 'اكتملت صياغة المسودة',
    failed: 'تعذرت صياغة المسودة',
    cancelled: 'أُلغيت صياغة المسودة',
    disconnected: 'تستمر الصياغة في الخلفية',
    currentSection: 'القسم الحالي',
    streamedDraft: 'المسودة المباشرة',
    backgroundHint:
      'يؤدي إغلاق الصفحة إلى فصل العرض المباشر فقط ولا يوقف مهمة الصياغة.',
    progress: (value) => `اكتمل ${Math.round(value)}٪`,
    retry: 'إعادة محاولة الصياغة',
    cancel: 'إلغاء الصياغة',
    resume: 'استئناف التحديثات',
    cancelling: 'جارٍ الإلغاء…',
    retrying: 'جارٍ إعادة المحاولة…',
    dismiss: 'إخفاء',
    unknownError: 'تعذر على خدمة الصياغة إكمال هذه المسودة.',
  },
};

export function usePleadingGenerationLabels(): PleadingGenerationLabels {
  const { locale } = useLocaleOrDefault();
  return COPY[locale === 'ar' ? 'ar' : 'en'];
}
