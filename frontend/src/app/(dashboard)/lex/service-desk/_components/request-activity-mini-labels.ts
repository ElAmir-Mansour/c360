'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the
 * request-detail right-rail widgets added by item #9:
 *   - `RequestActivityMini`   — compact "Recent activity" mini-feed
 *   - `RequestNoteComposer`   — working "Internal note" thread + composer
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale by {@link useRequestActivityMiniLabels}. JSX only ever
 * touches the resolved `T`. Status/action/actor phrasing itself is reused
 * from `useDetailExtraLabels().activity` (see `detail-extra-labels.ts`) — this
 * file holds ONLY the strings that are new to the two rail widgets.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface RequestActivityMiniLabels {
  // --- #9 "Recent activity" mini-feed (right rail) ---
  mini: {
    title: string;
    empty: string;
    loadError: string;
    viewAll: string;
  };

  // --- #9 "Internal note" thread + composer (persisted via /notes) ---
  composer: {
    title: string;
    placeholder: string;
    mentionHint: string;
    postButton: string;
    posting: string;
    postSuccess: string;
    emptyBody: string;
    empty: string;
    loadError: string;
    mentionsLabel: string;
  };
}

const bundle: LexBilingual<RequestActivityMiniLabels> = {
  en: {
    mini: {
      title: 'Recent activity',
      empty: 'No activity has been recorded yet.',
      loadError: 'Could not load recent activity.',
      viewAll: 'View all',
    },
    composer: {
      title: 'Internal notes',
      placeholder: 'Add an internal note… type @ to mention a colleague',
      mentionHint: 'Type @name in the note to tag a colleague — tags are captured with the note.',
      postButton: 'Post note',
      posting: 'Posting…',
      postSuccess: 'Note posted.',
      emptyBody: 'Enter a note before posting.',
      empty: 'No internal notes yet.',
      loadError: 'Could not load internal notes.',
      mentionsLabel: 'Tagged',
    },
  },
  ar: {
    mini: {
      title: 'أحدث الأنشطة',
      empty: 'لم يُسجّل أي نشاط بعد.',
      loadError: 'تعذّر تحميل أحدث الأنشطة.',
      viewAll: 'عرض الكل',
    },
    composer: {
      title: 'ملاحظات داخلية',
      placeholder: 'أضِف ملاحظة داخلية… اكتب @ للإشارة إلى أحد الزملاء',
      mentionHint: 'اكتب @الاسم داخل الملاحظة للإشارة إلى زميل — تُحفظ الإشارات مع الملاحظة.',
      postButton: 'نشر الملاحظة',
      posting: 'جارٍ النشر…',
      postSuccess: 'تم نشر الملاحظة.',
      emptyBody: 'أدخِل نص الملاحظة قبل النشر.',
      empty: 'لا توجد ملاحظات داخلية بعد.',
      loadError: 'تعذّر تحميل الملاحظات الداخلية.',
      mentionsLabel: 'مُشار إليهم',
    },
  },
};

export function resolveRequestActivityMiniLabels(
  locale: AppLocale = 'en',
): RequestActivityMiniLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useRequestActivityMiniLabels(): RequestActivityMiniLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveRequestActivityMiniLabels(locale), [locale]);
}
