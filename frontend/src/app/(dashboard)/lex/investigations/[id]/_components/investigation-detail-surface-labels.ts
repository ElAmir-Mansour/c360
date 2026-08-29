'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface InvestigationDetailSurfaceLabels {
  brand: string;
  casesAndInvestigations: string;
  editFile: string;
  shareAccess: string;
  changeStatus: string;
  overview: string;
  investigationType: string;
  targetDivision: string;
  openedDate: string;
  leadInvestigator: string;
  estimatedCompletion: string;
  currentPhase: string;
  internalInvestigation: string;
  personsOfInterest: string;
  addPerson: string;
  editPerson: string;
  removePerson: string;
  restrictedAccess: string;
  limitedAccess: string;
  noInternalAccess: string;
  evidenceChain: string;
  viewAllLogbook: string;
  removeEvidence: string;
  custodian: string;
  sha256: string;
  confidentialityTitle: string;
  confidentialityLevel: string;
  confidentialityText: string;
  quickActions: string;
  addEvidence: string;
  scheduleWitness: string;
  generateProgressReport: string;
  timeline: string;
  currentStatus: string;
  openedEvent: string;
  partyAdded: (name: string) => string;
  evidenceAdded: (title: string) => string;
  statementAdded: (name: string) => string;
  updatedEvent: string;
  noPeople: string;
  noEvidence: string;
  notSet: string;
}

const bundle: LexBilingual<InvestigationDetailSurfaceLabels> = {
  en: {
    brand: 'Clario360',
    casesAndInvestigations: 'Cases & Investigations',
    editFile: 'Edit File',
    shareAccess: 'Share Access',
    changeStatus: 'Change investigation status',
    overview: 'Investigation Overview',
    investigationType: 'Investigation Type',
    targetDivision: 'Target Division',
    openedDate: 'Opened Date',
    leadInvestigator: 'Lead Investigator',
    estimatedCompletion: 'Estimated Completion',
    currentPhase: 'Current Phase',
    internalInvestigation: 'Internal Investigation',
    personsOfInterest: 'Persons of Interest (POIs)',
    addPerson: 'Add person',
    editPerson: 'Edit person',
    removePerson: 'Remove person',
    restrictedAccess: 'Restricted Access',
    limitedAccess: 'Limited Access',
    noInternalAccess: 'No Internal Access',
    evidenceChain: 'Evidence Chain of Custody',
    viewAllLogbook: 'View All Logbook',
    removeEvidence: 'Remove evidence',
    custodian: 'Custodian',
    sha256: 'SHA256',
    confidentialityTitle: 'CONFIDENTIALITY CLASSIFICATION',
    confidentialityLevel: 'Restricted — Need-to-Know Basis',
    confidentialityText:
      'All access is logged automatically for audit and compliance purposes.',
    quickActions: 'Quick Actions',
    addEvidence: 'Add Evidence Item',
    scheduleWitness: 'Schedule Witness Interview',
    generateProgressReport: 'Generate Progress Report',
    timeline: 'Investigation Timeline',
    currentStatus: 'CURRENT STATUS',
    openedEvent: 'Investigation Officially Opened',
    partyAdded: (name) => `${name} added as a person of interest`,
    evidenceAdded: (title) => `${title} added to the evidence ledger`,
    statementAdded: (name) => `Witness statement recorded for ${name}`,
    updatedEvent: 'Investigation record updated',
    noPeople: 'No persons of interest have been registered.',
    noEvidence: 'No evidence has been catalogued.',
    notSet: 'Not set',
  },
  ar: {
    brand: 'Clario360',
    casesAndInvestigations: 'القضايا والتحقيقات',
    editFile: 'تعديل الملف',
    shareAccess: 'مشاركة الوصول',
    changeStatus: 'تغيير حالة التحقيق',
    overview: 'نظرة عامة على التحقيق',
    investigationType: 'نوع التحقيق',
    targetDivision: 'الإدارة المعنية',
    openedDate: 'تاريخ الفتح',
    leadInvestigator: 'المحقق الرئيس',
    estimatedCompletion: 'الإنجاز المتوقع',
    currentPhase: 'المرحلة الحالية',
    internalInvestigation: 'تحقيق داخلي',
    personsOfInterest: 'الأشخاص محل الاهتمام',
    addPerson: 'إضافة شخص',
    editPerson: 'تعديل الشخص',
    removePerson: 'إزالة الشخص',
    restrictedAccess: 'وصول مقيّد',
    limitedAccess: 'وصول محدود',
    noInternalAccess: 'لا يوجد وصول داخلي',
    evidenceChain: 'سلسلة حيازة الأدلة',
    viewAllLogbook: 'عرض سجل الأحداث كاملاً',
    removeEvidence: 'إزالة الدليل',
    custodian: 'أمين الدليل',
    sha256: 'SHA256',
    confidentialityTitle: 'تصنيف السرية',
    confidentialityLevel: 'مقيّد — على أساس الحاجة إلى المعرفة',
    confidentialityText:
      'يُسجَّل كل وصول تلقائياً لأغراض التدقيق والامتثال.',
    quickActions: 'إجراءات سريعة',
    addEvidence: 'إضافة عنصر دليل',
    scheduleWitness: 'جدولة مقابلة شاهد',
    generateProgressReport: 'إنشاء تقرير تقدم',
    timeline: 'الخط الزمني للتحقيق',
    currentStatus: 'الحالة الحالية',
    openedEvent: 'فُتح التحقيق رسمياً',
    partyAdded: (name) => `أُضيف ${name} كشخص محل اهتمام`,
    evidenceAdded: (title) => `أُضيف ${title} إلى سجل الأدلة`,
    statementAdded: (name) => `سُجّلت إفادة الشاهد ${name}`,
    updatedEvent: 'تم تحديث سجل التحقيق',
    noPeople: 'لم يُسجَّل أي شخص محل اهتمام.',
    noEvidence: 'لم تُفهرس أي أدلة.',
    notSet: 'غير محدد',
  },
};

export function resolveInvestigationDetailSurfaceLabels(
  locale: AppLocale = 'en',
): InvestigationDetailSurfaceLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useInvestigationDetailSurfaceLabels(): InvestigationDetailSurfaceLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveInvestigationDetailSurfaceLabels(locale), [locale]);
}
