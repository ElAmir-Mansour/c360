'use client';

import { useMemo } from 'react';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type LexBilingual, resolveLexBilingual } from '../../../../_lib/lex-i18n';

export interface SignatureWorkspaceLabels {
  breadcrumbs: {
    home: string;
    contracts: string;
    signature: string;
  };
  workflow: {
    title: string;
    signed: string;
    awaiting: string;
    notSent: string;
    unsuccessful: string;
    signedAt: (date: string) => string;
    sentAt: (date: string) => string;
    pending: string;
  };
  management: {
    title: string;
    reminder: string;
    reminderReadyTitle: string;
    reminderReadyDetail: (count: number) => string;
    noReminderTitle: string;
    noReminderDetail: string;
    cancel: string;
    cancelTitle: string;
    cancelDescription: string;
    cancelConfirm: string;
    cancelBack: string;
    cancelledTitle: string;
    cancelledDetail: string;
  };
  document: {
    finalDraft: string;
    locked: string;
    witness: string;
    witnessBody: string;
    firstParty: string;
    secondParty: string;
    awaitingSigner: (name: string) => string;
    representative: string;
    authority: string;
    preparedPreview: string;
    firstPartySigned: string;
    secondPartySignHere: string;
  };
  empty: {
    title: string;
    description: string;
    create: string;
  };
  errors: {
    contract: string;
    signatures: string;
  };
  retry: string;
}

export const signatureWorkspaceLabels: LexBilingual<SignatureWorkspaceLabels> = {
  en: {
    breadcrumbs: {
      home: 'WatheeqTech',
      contracts: 'Contracts',
      signature: 'Signature',
    },
    workflow: {
      title: 'Signatories & Workflow Status',
      signed: 'Signed',
      awaiting: 'Awaiting Signature',
      notSent: 'Not Yet Sent',
      unsuccessful: 'Action Required',
      signedAt: (date) => `Signed on ${date}`,
      sentAt: (date) => `Delivered ${date}`,
      pending: 'Pending preceding signee',
    },
    management: {
      title: 'Signing Management',
      reminder: 'Send Urgent Reminder',
      reminderReadyTitle: 'Reminder recipients identified',
      reminderReadyDetail: (count) =>
        `${count} pending signer${count === 1 ? '' : 's'} can be reminded from the signature operations queue.`,
      noReminderTitle: 'No reminder needed',
      noReminderDetail: 'There are no pending recipients on this signature request.',
      cancel: 'Cancel Signature Request',
      cancelTitle: 'Cancel this signature request?',
      cancelDescription:
        'The active envelope will be cancelled and pending recipients will no longer be able to sign it.',
      cancelConfirm: 'Cancel request',
      cancelBack: 'Keep request',
      cancelledTitle: 'Signature request cancelled',
      cancelledDetail: 'The envelope and recipient timeline have been refreshed.',
    },
    document: {
      finalDraft: 'Final Draft',
      locked:
        'This document is locked for editing. It represents the final terms approved by both legal parties.',
      witness: 'IN WITNESS WHEREOF',
      witnessBody:
        'The parties hereto have executed this agreement as of the date first written above. Each signee represents they have full authority to bind their respective legal entities.',
      firstParty: 'FIRST PARTY SIGNATURE',
      secondParty: 'SECOND PARTY SIGNATURE',
      awaitingSigner: (name) => `Awaiting ${name || 'signer'}...`,
      representative: 'Legal Representative',
      authority: 'Contracting Authority',
      preparedPreview: 'Prepared document preview',
      firstPartySigned: 'First party signature completed',
      secondPartySignHere: 'Second party signs here',
    },
    empty: {
      title: 'No signature request yet',
      description: 'Create a signature envelope for this contract to begin the signing workflow.',
      create: 'Create signature request',
    },
    errors: {
      contract: 'The contract could not be loaded.',
      signatures: 'The signature workflow could not be loaded.',
    },
    retry: 'Try again',
  },
  ar: {
    breadcrumbs: {
      home: 'وثيقتك',
      contracts: 'العقود',
      signature: 'التوقيع',
    },
    workflow: {
      title: 'حالة الموقعين على المستند',
      signed: 'تم التوقيع',
      awaiting: 'في انتظار التوقيع',
      notSent: 'لم يتم الإرسال',
      unsuccessful: 'يتطلب إجراءً',
      signedAt: (date) => `توقيع معتمد: ${date}`,
      sentAt: (date) => `تم الإرسال: ${date}`,
      pending: 'بانتظار الموقّع السابق',
    },
    management: {
      title: 'إجراءات المتابعة والتذكير',
      reminder: 'إرسال تذكير للموقعين',
      reminderReadyTitle: 'تم تحديد مستلمي التذكير',
      reminderReadyDetail: (count) =>
        `يمكن تذكير ${count} من الموقعين المنتظرين من خلال قائمة عمليات التوقيع.`,
      noReminderTitle: 'لا حاجة إلى تذكير',
      noReminderDetail: 'لا يوجد مستلمون بانتظار التوقيع في هذا الطلب.',
      cancel: 'إلغاء طلب التوقيع',
      cancelTitle: 'هل تريد إلغاء طلب التوقيع؟',
      cancelDescription:
        'سيتم إلغاء المظروف النشط ولن يتمكن المستلمون المنتظرون من التوقيع عليه.',
      cancelConfirm: 'إلغاء الطلب',
      cancelBack: 'الاحتفاظ بالطلب',
      cancelledTitle: 'تم إلغاء طلب التوقيع',
      cancelledDetail: 'تم تحديث المظروف ومسار المستلمين.',
    },
    document: {
      finalDraft: 'المسودة النهائية',
      locked:
        'هذا المستند مقفل للتحرير ويمثل الشروط النهائية المعتمدة من الطرفين القانونيين.',
      witness: 'إقرار الطرفين',
      witnessBody:
        'أبرم الطرفان هذه الاتفاقية في التاريخ الموضح أعلاه، ويقر كل موقّع بامتلاكه الصلاحية الكاملة لإلزام الجهة القانونية التي يمثلها.',
      firstParty: 'توقيع الطرف الأول',
      secondParty: 'توقيع الطرف الثاني',
      awaitingSigner: (name) => `بانتظار توقيع ${name || 'الموقّع'}...`,
      representative: 'الممثل القانوني',
      authority: 'صاحب صلاحية التعاقد',
      preparedPreview: 'معاينة المستند المجهز للتوقيع',
      firstPartySigned: 'تم توقيع الطرف الأول',
      secondPartySignHere: 'توقيع الطرف الثاني هنا',
    },
    empty: {
      title: 'لا يوجد طلب توقيع بعد',
      description: 'أنشئ مظروف توقيع لهذا العقد لبدء مسار التوقيع.',
      create: 'إنشاء طلب توقيع',
    },
    errors: {
      contract: 'تعذّر تحميل العقد.',
      signatures: 'تعذّر تحميل مسار التوقيع.',
    },
    retry: 'إعادة المحاولة',
  },
};

export function useSignatureWorkspaceLabels() {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => resolveLexBilingual(signatureWorkspaceLabels, locale),
    [locale],
  );
}
