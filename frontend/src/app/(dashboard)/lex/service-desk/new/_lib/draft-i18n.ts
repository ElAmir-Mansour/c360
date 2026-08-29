'use client';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';

/**
 * Self-contained EN/AR strings for the draft-autosave feature of the
 * "New Legal Request" wizard. English (MSA-neutral) is the default/fallback
 * branch; Arabic is Modern Standard Arabic.
 *
 * Intentionally local to the wizard so the feature ships without touching the
 * shared message catalog.
 */
export interface DraftStrings {
  /** Banner: leading prefix, used with a relative time, e.g. "...from 5 minutes ago." */
  resumePrefix: string;
  resumeSuffix: string;
  resume: string;
  discard: string;
  dismiss: string;
  /** Indicator: shown while a debounced write is flushing. */
  saving: string;
  /** Indicator: leading prefix, used with a relative time, e.g. "Autosaved 5 minutes ago". */
  autosavedPrefix: string;
  /** Explicit action in the wizard footer. */
  saveAndFinishLater: string;
  /** Toast shown after the explicit save action. */
  savedForLater: string;
  /** Toast shown when the explicit save cannot be persisted locally. */
  saveFailed: string;
}

const EN: DraftStrings = {
  resumePrefix: 'You have an unsaved draft from',
  resumeSuffix: '.',
  resume: 'Resume',
  discard: 'Discard',
  dismiss: 'Dismiss',
  saving: 'Saving…',
  autosavedPrefix: 'Autosaved',
  saveAndFinishLater: 'Save and finish later',
  savedForLater: 'Draft saved. You can finish it later.',
  saveFailed: 'Could not save the draft. Please try again.',
};

const AR: DraftStrings = {
  resumePrefix: 'لديك مسودة غير محفوظة منذ',
  resumeSuffix: '.',
  resume: 'استئناف',
  discard: 'تجاهل',
  dismiss: 'إغلاق',
  saving: 'جارٍ الحفظ…',
  autosavedPrefix: 'تم الحفظ تلقائيًا',
  saveAndFinishLater: 'حفظ والمتابعة لاحقًا',
  savedForLater: 'تم حفظ المسودة. يمكنك إكمالها لاحقًا.',
  saveFailed: 'تعذّر حفظ المسودة. يرجى المحاولة مرة أخرى.',
};

/** Returns the draft-feature strings for the active locale (default EN). */
export function useDraftStrings(): DraftStrings {
  const { locale } = useLocaleOrDefault();
  return locale === 'ar' ? AR : EN;
}
