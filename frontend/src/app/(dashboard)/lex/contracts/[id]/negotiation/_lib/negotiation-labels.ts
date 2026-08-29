export type NegotiationLabels = {
  breadcrumbHome: string;
  breadcrumbContracts: string;
  breadcrumbCurrent: string;
  loadingContract: string;
  loadError: string;
  summaryTitle: string;
  additions: string;
  deletions: string;
  modifications: string;
  acceptAll: string;
  rejectAll: string;
  accept: string;
  reject: string;
  accepted: string;
  rejected: string;
  allAccepted: string;
  allRejected: string;
  originalDraft: string;
  modifiedProposal: string;
  originalVersion: string;
  modifiedVersion: string;
  proposedChange: string;
  reviewDate: string;
  noPreviousText: string;
  recentlyAdded: string;
  modifiedClause: string;
  oldText: string;
  duplicateClause: string;
  financialTitle: string;
  originalFinancialText: string;
  modifiedFinancialPrefix: string;
  modifiedFinancialAmount: string;
  modifiedFinancialMiddle: string;
  modifiedFinancialInstallments: string;
  modifiedFinancialSuffix: string;
  intellectualPropertyTitle: string;
  originalIntellectualPropertyText: string;
  modifiedIntellectualPropertyText: string;
  newClauseText: string;
  warrantyPrefix: string;
  warrantyDuration: string;
  warrantySuffix: string;
  deletedWarrantyText: string;
};

export const negotiationLabels: Record<'en' | 'ar', NegotiationLabels> = {
  en: {
    breadcrumbHome: 'WatheeqTech',
    breadcrumbContracts: 'Contracts',
    breadcrumbCurrent: 'Compare Versions',
    loadingContract: 'Loading contract comparison…',
    loadError: 'The contract could not be loaded. Try again to open its version comparison.',
    summaryTitle: 'Version Comparison Summary',
    additions: '5 Additions',
    deletions: '3 Deletions',
    modifications: '8 Modifications',
    acceptAll: 'Accept All Changes',
    rejectAll: 'Reject All Changes',
    accept: 'Accept',
    reject: 'Reject',
    accepted: 'Change accepted',
    rejected: 'Change rejected',
    allAccepted: 'All proposed changes accepted',
    allRejected: 'All proposed changes rejected',
    originalDraft: 'ORIGINAL DRAFT (V1.2)',
    modifiedProposal: 'MODIFIED PROPOSAL (V1.3 BY CLIENT)',
    originalVersion: 'Original version (legal draft)',
    modifiedVersion: 'Modified version (Second Party)',
    proposedChange: 'Proposed change',
    reviewDate: 'Review date: 15 March 2024',
    noPreviousText: 'No text was previously included in this area',
    recentlyAdded: 'Recently added clause',
    modifiedClause: 'Modified clause',
    oldText: 'Old text (deleted or replaced)',
    duplicateClause: 'Clause three is duplicated',
    financialTitle: 'Clause 2: Financial Considerations & Payments',
    originalFinancialText:
      'The Second Party shall pay the First Party a total sum of 120,000 Saudi Riyals (SAR) to be disbursed in two installments based on milestones.',
    modifiedFinancialPrefix: 'The Second Party shall pay the First Party ',
    modifiedFinancialAmount: 'a total sum of 150,000 Saudi Riyals (SAR)',
    modifiedFinancialMiddle: ' to be disbursed in ',
    modifiedFinancialInstallments: 'three equal installments',
    modifiedFinancialSuffix: ' based on successfully verified milestones.',
    intellectualPropertyTitle: 'Clause 5: Intellectual Property',
    originalIntellectualPropertyText:
      'All background technology provided by the First Party shall remain the exclusive property of the First Party without any licenses granted.',
    modifiedIntellectualPropertyText:
      'Each party grants the other a non-exclusive, non-transferable, royalty-free license to use their background technology solely for the execution and fulfillment of this agreement.',
    newClauseText:
      'The Second Party shall provide a quarterly technical report showing the efficiency of the system and the stability of the servers shared with the First Party.',
    warrantyPrefix: 'The technical and software warranty period shall be ',
    warrantyDuration: '24 months',
    warrantySuffix: ' beginning on the date the final service-level agreement is signed.',
    deletedWarrantyText:
      'The technical and software warranty period shall be only 12 months beginning on the approved initial delivery date.',
  },
  ar: {
    breadcrumbHome: 'وثيقتك',
    breadcrumbContracts: 'العقود',
    breadcrumbCurrent: 'مقارنة النسخ',
    loadingContract: 'جارٍ تحميل مقارنة العقد…',
    loadError: 'تعذّر تحميل العقد. حاول مرة أخرى لفتح مقارنة نسخه.',
    summaryTitle: 'ملخص الفروقات بين النسخ',
    additions: '5 إضافات',
    deletions: '3 حذف',
    modifications: '8 تعديلات',
    acceptAll: 'قبول جميع التعديلات',
    rejectAll: 'رفض جميع التعديلات',
    accept: 'قبول التعديل',
    reject: 'رفض التعديل',
    accepted: 'تم قبول التعديل',
    rejected: 'تم رفض التعديل',
    allAccepted: 'تم قبول جميع التعديلات المقترحة',
    allRejected: 'تم رفض جميع التعديلات المقترحة',
    originalDraft: 'المسودة الأصلية (الإصدار 1.2)',
    modifiedProposal: 'المقترح المعدّل (الإصدار 1.3 من العميل)',
    originalVersion: 'النسخة الأصلية (مسودة نظامية)',
    modifiedVersion: 'النسخة المعدلة (الطرف الثاني)',
    proposedChange: 'التغيير المقترح',
    reviewDate: 'تاريخ المراجعة: 15 مارس 2024',
    noPreviousText: 'لم يكن هناك نص مدرج في هذه المساحة سابقاً',
    recentlyAdded: 'بند مضاف حديثاً',
    modifiedClause: 'بند معدّل',
    oldText: 'النص القديم (تم حذفه أو استبداله)',
    duplicateClause: 'البند الثالث مكرر',
    financialTitle: 'البند الثاني: المقابل المالي والدفعات',
    originalFinancialText:
      'يلتزم الطرف الثاني بسداد مبلغ إجمالي قدره 120,000 ريال سعودي للطرف الأول على دفعتين وفقاً لمراحل الإنجاز.',
    modifiedFinancialPrefix: 'يلتزم الطرف الثاني بسداد ',
    modifiedFinancialAmount: 'مبلغ إجمالي قدره 150,000 ريال سعودي',
    modifiedFinancialMiddle: ' للطرف الأول على ',
    modifiedFinancialInstallments: 'ثلاث دفعات متساوية',
    modifiedFinancialSuffix: ' بعد التحقق من إنجاز كل مرحلة.',
    intellectualPropertyTitle: 'البند الخامس: الملكية الفكرية',
    originalIntellectualPropertyText:
      'تظل جميع التقنيات السابقة التي يقدمها الطرف الأول ملكاً حصرياً له دون منح أي تراخيص.',
    modifiedIntellectualPropertyText:
      'يمنح كل طرف الطرف الآخر ترخيصاً غير حصري وغير قابل للتحويل ودون رسوم لاستخدام تقنياته السابقة حصراً لتنفيذ هذه الاتفاقية والوفاء بها.',
    newClauseText:
      'يلتزم الطرف الثاني بتقديم تقرير فني ربع سنوي يوضح مدى كفاءة النظام واستقرار الخوادم المشتركة مع الطرف الأول.',
    warrantyPrefix: 'تكون فترة الضمان الفني والبرمجي ',
    warrantyDuration: '24 شهراً',
    warrantySuffix: ' تبدأ من تاريخ توقيع اتفاقية مستوى الخدمة النهائية.',
    deletedWarrantyText:
      'تكون فترة الضمان الفني والبرمجي 12 شهراً فقط تبدأ من تاريخ التسليم الابتدائي المعتمد.',
  },
};
