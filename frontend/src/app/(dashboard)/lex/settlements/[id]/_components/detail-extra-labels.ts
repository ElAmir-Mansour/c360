'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) copy for the REVAMPED
 * Settlements / ADR detail page — the strings that the shared settlement label
 * catalog (`../_components/labels`) does not already carry: the hero fact-tile
 * labels, the two-column tab bar, the "what needs you now" action bar, the
 * right-rail cards (key facts / people / related / recent activity) and the
 * navigation & shareability toolbar.
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): one
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale by {@link useSettlementDetailExtraLabels}. Each revamp
 * component reads only its own slice. Stage / status / method names still come
 * from the shared catalog + `./settlement-enums-i18n` — never duplicated here.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface SettlementDetailExtraLabels {
  hero: {
    facts: {
      reference: string;
      method: string;
      counterparty: string;
      amount: string;
      opened: string;
    };
    noReference: string;
    noCounterparty: string;
    noValue: string;
  };
  tabs: {
    overview: string;
    rounds: string;
    documents: string;
    timeline: string;
    activity: string;
  };
  overview: {
    matterHeading: string;
    addValue: string;
    addReference: string;
    addCounterparty: string;
    workflowHeading: string;
  };
  keyFacts: {
    title: string;
    description: string;
    amount: string;
    method: string;
    status: string;
    rounds: string;
    latestOffer: string;
    approvedAt: string;
    executedAt: string;
    noValue: string;
    none: string;
  };
  actionBar: {
    heading: string;
    readOnly: string;
    recordTermsHint: string;
    recordTerms: string;
    submitHint: string;
    submit: string;
    reopenHint: string;
    addRound: string;
    awaitingApprovalHint: string;
    decide: string;
    awaitingOthersHint: string;
    openApproval: string;
    executeHint: string;
    execute: string;
    awaitingExecutionHint: string;
    executedHint: string;
    abandonedHint: string;
    noneHint: string;
  };
  people: {
    title: string;
    counterparty: string;
    counterpartyUnknown: string;
    contact: string;
    idNumber: string;
    negotiators: string;
    noNegotiators: string;
    roundsBy: (n: number) => string;
    approvedBy: string;
    createdBy: (id: string) => string;
    copyId: string;
    copied: string;
  };
  related: {
    title: string;
    description: string;
    matterHeading: string;
    viewMatter: string;
    matterRef: (id: string) => string;
    documentsHeading: string;
    documentsCounter: (n: number) => string;
    documentUntitled: string;
    noDocuments: string;
    viewAllDocuments: string;
    emptyAll: string;
  };
  activity: {
    title: string;
    empty: string;
    loadError: string;
    viewAll: string;
    actorPrefix: (id: string) => string;
  };
  toolbar: {
    copyReference: string;
    copyReferenceAria: (ref: string) => string;
    copyReferenceCopied: string;
    copyLink: string;
    copyLinkAria: string;
    copyLinkCopied: string;
    copied: string;
    prev: string;
    prevAria: string;
    prevDisabled: string;
    next: string;
    nextAria: string;
    nextDisabled: string;
  };
}

const bundle: LexBilingual<SettlementDetailExtraLabels> = {
  en: {
    hero: {
      facts: {
        reference: 'Reference',
        method: 'Method',
        counterparty: 'Counterparty',
        amount: 'Settlement amount',
        opened: 'Opened',
      },
      noReference: 'No reference',
      noCounterparty: 'Not identified',
      noValue: 'No amount set',
    },
    tabs: {
      overview: 'Overview',
      rounds: 'Negotiation',
      documents: 'Documents',
      timeline: 'Case timeline',
      activity: 'Activity',
    },
    overview: {
      matterHeading: 'Owning matter',
      addValue: 'Add amount',
      addReference: 'Add reference',
      addCounterparty: 'Add counterparty',
      workflowHeading: 'Approval workflow',
    },
    keyFacts: {
      title: 'Key facts',
      description: 'Amount, method and approval milestones at a glance.',
      amount: 'Settlement amount',
      method: 'Method',
      status: 'Status',
      rounds: 'Negotiation rounds',
      latestOffer: 'Latest offer',
      approvedAt: 'Approved',
      executedAt: 'Executed',
      noValue: 'Not set',
      none: '—',
    },
    actionBar: {
      heading: 'What needs you now',
      readOnly: 'You have read-only access to this settlement.',
      recordTermsHint: 'Record the negotiated settlement terms to move this forward.',
      recordTerms: 'Record terms',
      submitHint: 'Terms are ready — submit this settlement for approval.',
      submit: 'Submit for approval',
      reopenHint: 'This settlement was rejected. Revise the terms or add a round to re-open negotiation.',
      addRound: 'Add round',
      awaitingApprovalHint: 'This settlement is awaiting your approval decision.',
      decide: 'Approval decision',
      awaitingOthersHint: 'This settlement is awaiting an approval decision.',
      openApproval: 'View approval',
      executeHint: 'Approved — execute the settlement and close the owning matter.',
      execute: 'Close by reconciliation',
      awaitingExecutionHint: 'Approved and awaiting execution by an authorized closer.',
      executedHint: 'This settlement has been executed. The lifecycle is complete.',
      abandonedHint: 'This settlement was abandoned and will not proceed.',
      noneHint: 'No action is required from you right now.',
    },
    people: {
      title: 'Parties & people',
      counterparty: 'Counterparty',
      counterpartyUnknown: 'Not identified',
      contact: 'Contact',
      idNumber: 'Identifier',
      negotiators: 'Negotiators',
      noNegotiators: 'No negotiation rounds recorded yet.',
      roundsBy: (n) => `${n} round${n === 1 ? '' : 's'}`,
      approvedBy: 'Approved by',
      createdBy: (id) => `Opened by ${id}`,
      copyId: 'Copy identifier',
      copied: 'Copied',
    },
    related: {
      title: 'Related & linked',
      description: 'The matter this settlement resolves and its linked documents.',
      matterHeading: 'Owning matter',
      viewMatter: 'View matter',
      matterRef: (id) => `Matter ${id}`,
      documentsHeading: 'Linked documents',
      documentsCounter: (n) => `${n} linked`,
      documentUntitled: 'Untitled document',
      noDocuments: 'No documents linked yet.',
      viewAllDocuments: 'Manage documents',
      emptyAll: 'Nothing linked to this settlement yet.',
    },
    activity: {
      title: 'Recent activity',
      empty: 'No activity recorded yet.',
      loadError: 'Activity is unavailable right now.',
      viewAll: 'View full audit',
      actorPrefix: (id) => `by ${id}`,
    },
    toolbar: {
      copyReference: 'Copy reference',
      copyReferenceAria: (ref) => `Copy settlement reference ${ref}`,
      copyReferenceCopied: 'Reference copied',
      copyLink: 'Copy link',
      copyLinkAria: 'Copy link to this settlement',
      copyLinkCopied: 'Link copied',
      copied: 'Copied',
      prev: 'Previous settlement',
      prevAria: 'Go to previous settlement (shortcut: k)',
      prevDisabled: 'No previous settlement on this page',
      next: 'Next settlement',
      nextAria: 'Go to next settlement (shortcut: j)',
      nextDisabled: 'No next settlement on this page',
    },
  },
  ar: {
    hero: {
      facts: {
        reference: 'المرجع',
        method: 'الأسلوب',
        counterparty: 'الطرف الآخر',
        amount: 'قيمة التسوية',
        opened: 'تاريخ الفتح',
      },
      noReference: 'لا يوجد مرجع',
      noCounterparty: 'غير محدد',
      noValue: 'لم تُحدَّد قيمة',
    },
    tabs: {
      overview: 'نظرة عامة',
      rounds: 'التفاوض',
      documents: 'المستندات',
      timeline: 'الجدول الزمني',
      activity: 'النشاط',
    },
    overview: {
      matterHeading: 'القضية المالكة',
      addValue: 'إضافة قيمة',
      addReference: 'إضافة مرجع',
      addCounterparty: 'إضافة الطرف الآخر',
      workflowHeading: 'سير الاعتماد',
    },
    keyFacts: {
      title: 'حقائق أساسية',
      description: 'القيمة والأسلوب ومحطات الاعتماد في لمحة.',
      amount: 'قيمة التسوية',
      method: 'الأسلوب',
      status: 'الحالة',
      rounds: 'جولات التفاوض',
      latestOffer: 'أحدث عرض',
      approvedAt: 'الاعتماد',
      executedAt: 'التنفيذ',
      noValue: 'غير محدد',
      none: '—',
    },
    actionBar: {
      heading: 'ما يتطلّب إجراءك الآن',
      readOnly: 'لديك صلاحية اطّلاع فقط على هذه التسوية.',
      recordTermsHint: 'سجّل بنود التسوية المتفاوض عليها للمضي قدمًا.',
      recordTerms: 'تسجيل البنود',
      submitHint: 'البنود جاهزة — أرسل هذه التسوية للاعتماد.',
      submit: 'إرسال للاعتماد',
      reopenHint: 'رُفضت هذه التسوية. عدّل البنود أو أضِف جولة لإعادة فتح التفاوض.',
      addRound: 'إضافة جولة',
      awaitingApprovalHint: 'هذه التسوية بانتظار قرار اعتمادك.',
      decide: 'قرار الاعتماد',
      awaitingOthersHint: 'هذه التسوية بانتظار قرار الاعتماد.',
      openApproval: 'عرض الاعتماد',
      executeHint: 'معتمدة — نفّذ التسوية وأغلق القضية المالكة.',
      execute: 'الإغلاق بالصلح',
      awaitingExecutionHint: 'معتمدة وبانتظار التنفيذ من جهة مخوّلة.',
      executedHint: 'تم تنفيذ هذه التسوية. اكتملت دورة الحياة.',
      abandonedHint: 'تُركت هذه التسوية ولن تستمر.',
      noneHint: 'لا يلزم منك أي إجراء الآن.',
    },
    people: {
      title: 'الأطراف والأشخاص',
      counterparty: 'الطرف الآخر',
      counterpartyUnknown: 'غير محدد',
      contact: 'وسيلة التواصل',
      idNumber: 'المعرّف',
      negotiators: 'المفاوضون',
      noNegotiators: 'لم تُسجَّل جولات تفاوض بعد.',
      roundsBy: (n) => `${n} جولة`,
      approvedBy: 'اعتمدها',
      createdBy: (id) => `فتحها ${id}`,
      copyId: 'نسخ المعرّف',
      copied: 'تم النسخ',
    },
    related: {
      title: 'المرتبط والمُرفَق',
      description: 'القضية التي تحلّها هذه التسوية والمستندات المرتبطة بها.',
      matterHeading: 'القضية المالكة',
      viewMatter: 'عرض القضية',
      matterRef: (id) => `القضية ${id}`,
      documentsHeading: 'المستندات المرتبطة',
      documentsCounter: (n) => `${n} مرتبط`,
      documentUntitled: 'مستند بلا عنوان',
      noDocuments: 'لا توجد مستندات مرتبطة بعد.',
      viewAllDocuments: 'إدارة المستندات',
      emptyAll: 'لا شيء مرتبط بهذه التسوية بعد.',
    },
    activity: {
      title: 'النشاط الأخير',
      empty: 'لم يُسجَّل أي نشاط بعد.',
      loadError: 'النشاط غير متاح حاليًا.',
      viewAll: 'عرض سجل التدقيق الكامل',
      actorPrefix: (id) => `بواسطة ${id}`,
    },
    toolbar: {
      copyReference: 'نسخ المرجع',
      copyReferenceAria: (ref) => `نسخ مرجع التسوية ${ref}`,
      copyReferenceCopied: 'تم نسخ المرجع',
      copyLink: 'نسخ الرابط',
      copyLinkAria: 'نسخ رابط هذه التسوية',
      copyLinkCopied: 'تم نسخ الرابط',
      copied: 'تم النسخ',
      prev: 'التسوية السابقة',
      prevAria: 'الانتقال إلى التسوية السابقة (اختصار: k)',
      prevDisabled: 'لا توجد تسوية سابقة في هذه الصفحة',
      next: 'التسوية التالية',
      nextAria: 'الانتقال إلى التسوية التالية (اختصار: j)',
      nextDisabled: 'لا توجد تسوية تالية في هذه الصفحة',
    },
  },
};

/** Pure resolver for non-React callers / tests; English default. */
export function resolveSettlementDetailExtraLabels(
  locale: AppLocale = 'en',
): SettlementDetailExtraLabels {
  return resolveLexBilingual(bundle, locale);
}

/** Thin memoized hook returning the resolved {@link SettlementDetailExtraLabels}. */
export function useSettlementDetailExtraLabels(): SettlementDetailExtraLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveSettlementDetailExtraLabels(locale), [locale]);
}
