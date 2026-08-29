/**
 * Bilingual (English + Modern Standard Arabic) labels + criteria definitions for
 * the Case Qualification & Evidence tab (تأهيل القضية والأدلة).
 *
 * Follows the canonical lex i18n contract (`_lib/lex-i18n.ts`): one
 * `LexBilingual<T>` bundle resolved against the active locale by
 * {@link useQualificationLabels}. The qualification checklist is a fixed set of
 * legal-fitness criteria persisted under `legalCase.metadata.qualification`.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  resolveLexBilingual,
  type LexBilingual,
} from '../../../../_lib/lex-i18n';

/** The fixed legal-fitness (الملاءمة القانونية) criteria, in display order. */
export const QUALIFICATION_CRITERIA = [
  'standing',
  'jurisdiction',
  'limitation',
  'documents',
  'risk_analysis',
] as const;

export type QualificationCriterion = (typeof QUALIFICATION_CRITERIA)[number];

/** Position-strength band derived from the assessed risk matrix (0–100%). */
export type PositionBand = 'very_strong' | 'strong' | 'moderate' | 'weak';

export interface QualificationLabels {
  tab: string;
  heading: string;
  subheading: string;
  checklist: {
    title: string;
    description: string;
    criteria: Record<QualificationCriterion, string>;
    savingHint: string;
  };
  evidence: {
    title: string;
    description: string;
    empty: string;
    manage: string;
    onFile: (count: string) => string;
    uncategorized: string;
    sizeUnknown: string;
  };
  strength: {
    title: string;
    description: string;
    overall: string;
    notAssessed: string;
    assessHint: string;
    bands: Record<PositionBand, string>;
    strengthCall: string;
    strong: string;
    weak: string;
    strengthUnset: string;
    riskRating: string;
    riskUnset: string;
    exposure: string;
    companyStatus: string;
    plaintiff: string;
    defendant: string;
    strongPoints: string;
    weakPoints: string;
    addPoint: string;
    removePoint: string;
    pointPlaceholder: string;
    noStrongPoints: string;
    noWeakPoints: string;
    rationale: string;
  };
  readiness: {
    title: string;
    criteriaMet: (met: string, total: string) => string;
    criteriaLabel: string;
    evidenceLabel: string;
    evidenceValue: (count: string) => string;
    readinessLabel: string;
    completeCta: string;
    completing: string;
    requestDocsCta: string;
    requesting: string;
    completedBadge: string;
    completedBy: (name: string, date: string) => string;
    pendingBadge: string;
    completeBlocked: string;
  };
  witnesses: {
    title: string;
    description: string;
    empty: string;
    manage: string;
    roleWitness: string;
    noContact: string;
  };
  experts: {
    title: string;
    description: string;
    empty: string;
    manage: string;
    statuses: Record<string, string>;
    dueOn: (date: string) => string;
    receivedOn: (date: string) => string;
  };
  confirmComplete: {
    title: string;
    description: string;
    confirm: string;
    cancel: string;
  };
  toast: {
    checklistSaved: string;
    pointsSaved: string;
    completed: string;
    reopened: string;
    docsRequested: string;
  };
  reopenCta: string;
  requestDocsTaskTitle: string;
}

const qualificationLabels: LexBilingual<QualificationLabels> = {
  en: {
    tab: 'Qualification',
    heading: 'Case qualification & evidence',
    subheading: 'Legal-fitness assessment, evidence readiness, and the case posture.',
    checklist: {
      title: 'Case assessment & qualification (legal fitness)',
      description: 'Confirm each fitness criterion before the case is qualified and approved.',
      criteria: {
        standing: "The claimant's legal standing and interest are established and legally proven",
        jurisdiction: 'Judicial and subject-matter jurisdiction — local and international — is confirmed and established',
        limitation: 'The case is not time-barred and the formal conditions are complete',
        documents: 'Sufficient supporting documents are available to file the case immediately',
        risk_analysis: 'The analysis of potential legal and financial risks is satisfactory and acceptable',
      },
      savingHint: 'Saving…',
    },
    evidence: {
      title: 'Evidence files & attached documents',
      description: 'Supporting documents linked to this case.',
      empty: 'No documents have been linked to this case yet.',
      manage: 'Manage documents',
      onFile: (count) => `${count} on file`,
      uncategorized: 'Document',
      sizeUnknown: '—',
    },
    strength: {
      title: 'Company judicial position & case strength',
      description: 'Overall posture derived from the assessed risk matrix, with the recorded strong and weak points.',
      overall: 'Overall position strength',
      notAssessed: 'Not yet assessed',
      assessHint: 'Set the risk likelihood and impact (risk rating) to compute the position strength.',
      bands: {
        very_strong: 'Very strong',
        strong: 'Strong',
        moderate: 'Moderate',
        weak: 'Weak',
      },
      strengthCall: 'Strength call',
      strong: 'Strong',
      weak: 'Weak',
      strengthUnset: 'Not set',
      riskRating: 'Risk rating',
      riskUnset: 'Not rated',
      exposure: 'Exposure',
      companyStatus: 'Company position',
      plaintiff: 'Plaintiff',
      defendant: 'Defendant',
      strongPoints: 'Strong points',
      weakPoints: 'Weak points',
      addPoint: 'Add',
      removePoint: 'Remove',
      pointPlaceholder: 'Describe a point…',
      noStrongPoints: 'No strong points recorded.',
      noWeakPoints: 'No weak points recorded.',
      rationale: 'Risk rationale',
    },
    readiness: {
      title: 'Case file status',
      criteriaMet: (met, total) => `${met} of ${total}`,
      criteriaLabel: 'Fitness criteria met',
      evidenceLabel: 'Evidence documents',
      evidenceValue: (count) => count,
      readinessLabel: 'Qualification readiness',
      completeCta: 'Complete qualification & approval',
      completing: 'Completing…',
      requestDocsCta: 'Request additional documents',
      requesting: 'Requesting…',
      completedBadge: 'Qualified',
      completedBy: (name, date) => `Completed by ${name} · ${date}`,
      pendingBadge: 'In qualification',
      completeBlocked: 'Meet all fitness criteria to complete qualification.',
    },
    witnesses: {
      title: 'Approved witnesses',
      description: 'Witnesses registered on this case.',
      empty: 'No witnesses have been registered yet.',
      manage: 'Manage parties',
      roleWitness: 'Witness',
      noContact: 'No contact on file',
    },
    experts: {
      title: 'Technical expert reports',
      description: 'Expert assignments and their reports.',
      empty: 'No expert assignments on this case.',
      manage: 'Manage experts',
      statuses: {
        requested: 'Requested',
        appointed: 'Appointed',
        report_received: 'Report received',
        closed: 'Closed',
        cancelled: 'Cancelled',
      },
      dueOn: (date) => `Due ${date}`,
      receivedOn: (date) => `Received ${date}`,
    },
    confirmComplete: {
      title: 'Complete case qualification?',
      description: 'This marks the case as qualified and approved for filing. You can reopen it later.',
      confirm: 'Complete & approve',
      cancel: 'Cancel',
    },
    toast: {
      checklistSaved: 'Assessment updated.',
      pointsSaved: 'Points updated.',
      completed: 'Case qualification completed.',
      reopened: 'Qualification reopened.',
      docsRequested: 'A task to provide additional documents was created.',
    },
    reopenCta: 'Reopen qualification',
    requestDocsTaskTitle: 'Provide additional supporting documents for qualification',
  },
  ar: {
    tab: 'التأهيل',
    heading: 'تأهيل القضية والأدلة',
    subheading: 'تقييم الملاءمة القانونية وجاهزية الأدلة وقوة موقف القضية.',
    checklist: {
      title: 'نموذج تقييم وتأهيل القضية (الملاءمة القانونية)',
      description: 'أكّد كل معيار من معايير الملاءمة قبل تأهيل القضية واعتمادها.',
      criteria: {
        standing: 'أهلية ومصلحة المدعي قائمة ومثبتة قانونياً',
        jurisdiction: 'الاختصاص القضائي والنوعي محلياً ودولياً مؤكد ومثبت',
        limitation: 'القضية لم تسقط بالتقادم ومكتملة الشروط الشكلية',
        documents: 'توافر المستندات الثبوتية الكافية لرفع الدعوى فوراً',
        risk_analysis: 'تحليل المخاطر القانونية والمالية المحتملة مرضٍ ومقبول',
      },
      savingHint: 'جارٍ الحفظ…',
    },
    evidence: {
      title: 'ملفات الأدلة والمستندات المرفقة',
      description: 'المستندات الداعمة المرتبطة بهذه القضية.',
      empty: 'لم تُرفَق أي مستندات بهذه القضية بعد.',
      manage: 'إدارة المستندات',
      onFile: (count) => `${count} مستند`,
      uncategorized: 'مستند',
      sizeUnknown: '—',
    },
    strength: {
      title: 'مركز الشركة القضائي وقوة الموقف',
      description: 'قوة الموقف الكلية مشتقة من مصفوفة المخاطر المقيَّمة، مع نقاط القوة والضعف المسجلة.',
      overall: 'مستوى القوة الكلي',
      notAssessed: 'لم يُقيَّم بعد',
      assessHint: 'حدّد احتمالية المخاطر وأثرها (تقييم المخاطر) لاحتساب قوة الموقف.',
      bands: {
        very_strong: 'قوي جداً',
        strong: 'قوي',
        moderate: 'متوسط',
        weak: 'ضعيف',
      },
      strengthCall: 'تقدير القوة',
      strong: 'قوية',
      weak: 'ضعيفة',
      strengthUnset: 'غير محدد',
      riskRating: 'تقييم المخاطر',
      riskUnset: 'غير مُقيَّم',
      exposure: 'التعرّض',
      companyStatus: 'موقف الشركة',
      plaintiff: 'مدَّعٍ',
      defendant: 'مدَّعى عليه',
      strongPoints: 'نقاط القوة',
      weakPoints: 'نقاط الضعف',
      addPoint: 'إضافة',
      removePoint: 'إزالة',
      pointPlaceholder: 'اكتب نقطة…',
      noStrongPoints: 'لا توجد نقاط قوة مسجلة.',
      noWeakPoints: 'لا توجد نقاط ضعف مسجلة.',
      rationale: 'مبرر المخاطر',
    },
    readiness: {
      title: 'حالة ملف القضية',
      criteriaMet: (met, total) => `${met} من أصل ${total}`,
      criteriaLabel: 'معايير الملاءمة المستوفاة',
      evidenceLabel: 'مستندات الأدلة',
      evidenceValue: (count) => count,
      readinessLabel: 'نسبة التأهيل والجاهزية',
      completeCta: 'إكمال تأهيل القضية والاعتماد',
      completing: 'جارٍ الإكمال…',
      requestDocsCta: 'طلب وثائق إضافية',
      requesting: 'جارٍ الطلب…',
      completedBadge: 'مؤهَّلة',
      completedBy: (name, date) => `أُكملت بواسطة ${name} · ${date}`,
      pendingBadge: 'قيد التأهيل',
      completeBlocked: 'استوفِ جميع معايير الملاءمة لإكمال التأهيل.',
    },
    witnesses: {
      title: 'قائمة الشهود المعتمدة',
      description: 'الشهود المسجلون في هذه القضية.',
      empty: 'لم يُسجَّل أي شهود بعد.',
      manage: 'إدارة الأطراف',
      roleWitness: 'شاهد',
      noContact: 'لا توجد بيانات تواصل',
    },
    experts: {
      title: 'تقارير الخبراء الفنيين',
      description: 'تكليفات الخبراء وتقاريرهم.',
      empty: 'لا توجد تكليفات خبراء في هذه القضية.',
      manage: 'إدارة الخبراء',
      statuses: {
        requested: 'مطلوب',
        appointed: 'معيَّن',
        report_received: 'استُلم التقرير',
        closed: 'مغلق',
        cancelled: 'ملغى',
      },
      dueOn: (date) => `الاستحقاق ${date}`,
      receivedOn: (date) => `استُلم ${date}`,
    },
    confirmComplete: {
      title: 'إكمال تأهيل القضية؟',
      description: 'سيؤدي ذلك إلى اعتبار القضية مؤهَّلة ومعتمدة للرفع. يمكنك إعادة فتحها لاحقاً.',
      confirm: 'إكمال واعتماد',
      cancel: 'إلغاء',
    },
    toast: {
      checklistSaved: 'تم تحديث التقييم.',
      pointsSaved: 'تم تحديث النقاط.',
      completed: 'اكتمل تأهيل القضية.',
      reopened: 'أُعيد فتح التأهيل.',
      docsRequested: 'تم إنشاء مهمة لتقديم مستندات إضافية.',
    },
    reopenCta: 'إعادة فتح التأهيل',
    requestDocsTaskTitle: 'تقديم مستندات ثبوتية إضافية للتأهيل',
  },
};

export function useQualificationLabels(): QualificationLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(qualificationLabels, locale), [locale]);
}
