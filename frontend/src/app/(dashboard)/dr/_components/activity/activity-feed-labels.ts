'use client';

/**
 * Feature-local copy for the war-room activity feed + immutable decision record.
 *
 * Per the route contract these strings live HERE, not in the shared
 * `_lib/dr-i18n.ts`: they belong only to the activity-feed surface. The bundle
 * adopts the foundation's `DRBilingual<T>` shape (two full, identically-shaped
 * copies — English + professional MSA) and is resolved against the active locale
 * by {@link useActivityFeedLabels}. Resolution defaults to English when no
 * LocaleProvider is mounted (and under the `renderWithQuery` `en` default), so
 * existing English-asserting tests stay green.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface ActivityFeedCopy {
  /** Panel heading + framing. */
  heading: string;
  description: string;
  /** Count badge (rendered alongside the integer, never as bare copy). */
  eventsBadge: string;
  /** Source-plane chips on each event row. */
  sourceLedger: string;
  sourceStep: string;
  /** Accessible label for the ordered feed list. */
  listLabel: string;
  /** "<actor> <verb>" is assembled per row; this names the system actor's a11y. */
  systemActorLabel: string;
  /** Per-event link into the immutable ledger explorer. */
  ledgerLinkLabel: string;
  /** Accessible target description for the subject id token. */
  subjectLabel: string;
  /** Empty + error states. */
  emptyTitle: string;
  emptyDescription: string;
  loadError: string;
  /** Section-level link to the full ledger explorer. */
  openLedger: string;
}

export const activityFeedLabels: DRBilingual<ActivityFeedCopy> = {
  en: {
    heading: 'Decision & action record',
    description:
      'The immutable who-did-what-when for this run, merged from the attestation ledger and the failover driver steps.',
    eventsBadge: 'events',
    sourceLedger: 'Ledger',
    sourceStep: 'Step',
    listLabel: 'Run activity, newest first',
    systemActorLabel: 'System',
    ledgerLinkLabel: 'View in ledger',
    subjectLabel: 'Subject',
    emptyTitle: 'No activity recorded yet',
    emptyDescription:
      'Attestation entries and driver steps for this run will appear here as the recovery progresses.',
    loadError: 'Failed to load the activity record for this run.',
    openLedger: 'Open attestation ledger',
  },
  ar: {
    heading: 'سجل القرارات والإجراءات',
    description:
      'سجل غير قابل للتغيير يوثّق من فعل ماذا ومتى لهذه العملية، مدموجًا من سجل الإثبات وخطوات محرّك تجاوز الفشل.',
    eventsBadge: 'حدثًا',
    sourceLedger: 'السجل',
    sourceStep: 'خطوة',
    listLabel: 'نشاط العملية، الأحدث أولًا',
    systemActorLabel: 'النظام',
    ledgerLinkLabel: 'عرض في السجل',
    subjectLabel: 'الموضوع',
    emptyTitle: 'لم يُسجَّل أي نشاط بعد',
    emptyDescription:
      'ستظهر هنا قيود الإثبات وخطوات المحرّك لهذه العملية مع تقدّم الاسترداد.',
    loadError: 'تعذّر تحميل سجل النشاط لهذه العملية.',
    openLedger: 'فتح سجل الإثبات',
  },
};

/**
 * useActivityFeedLabels resolves the bilingual activity-feed copy against the
 * active locale (English fallback), mirroring the shared `useDRLabels` hook.
 */
export function useActivityFeedLabels(): ActivityFeedCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(activityFeedLabels, locale), [locale]);
}
