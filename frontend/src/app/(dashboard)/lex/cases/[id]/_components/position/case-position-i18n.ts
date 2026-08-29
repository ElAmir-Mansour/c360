'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  resolveLexBilingual,
  type LexBilingual,
} from '../../../../_lib/lex-i18n';
import type { CaseCompanyStatus, CaseTaskStatus } from '@/lib/lex/cases';
import type { PositionBand } from '../qualification/qualification-i18n';

export interface CasePositionLabels {
  tab: string;
  heading: string;
  description: string;
  role: {
    title: string;
    description: string;
    options: Record<CaseCompanyStatus, string>;
    saving: string;
  };
  strength: {
    title: string;
    overall: string;
    bands: Record<PositionBand, string>;
    notAssessed: string;
    notAssessedHint: string;
    assessedHint: (score: string) => string;
  };
  facts: {
    title: string;
    description: string;
    opponent: string;
    opponentRepresentative: string;
    court: string;
    circuit: string;
    notSet: string;
  };
  actions: {
    title: (role: string) => string;
    description: string;
    empty: string;
    noDueDate: string;
    due: (date: string) => string;
    statuses: Record<CaseTaskStatus, string>;
    readOnly: string;
  };
  toast: {
    roleUpdated: string;
    taskCompleted: string;
    taskReopened: string;
  };
}

const labels: LexBilingual<CasePositionLabels> = {
  en: {
    tab: 'Legal position',
    heading: 'Company legal-position assessment',
    description:
      'Live company role, litigation posture, opposing-party facts, and required actions for this case.',
    role: {
      title: 'Company legal role',
      description: 'This role controls the plaintiff and defendant litigation workspaces.',
      options: {
        plaintiff: 'Plaintiff (company)',
        defendant: 'Defendant (company)',
      },
      saving: 'Saving role…',
    },
    strength: {
      title: 'Legal-position strength',
      overall: 'Overall success posture',
      bands: {
        very_strong: 'Very strong legal position',
        strong: 'Strong legal position',
        moderate: 'Moderate legal position',
        weak: 'Weak legal position',
      },
      notAssessed: 'Not assessed',
      notAssessedHint:
        'Set the case risk likelihood and impact to calculate a defensible position score.',
      assessedHint: (score) =>
        `The ${score} position score is calculated from the saved legal-risk likelihood and impact.`,
    },
    facts: {
      title: 'Case and party facts',
      description: 'Court and opposing-party data recorded on the live case.',
      opponent: 'Opposing party',
      opponentRepresentative: 'Opposing legal representative',
      court: 'Competent court',
      circuit: 'Court circuit / reference',
      notSet: 'Not recorded',
    },
    actions: {
      title: (role) => `Required actions (${role})`,
      description: 'Case tasks update immediately when checked or reopened.',
      empty: 'No required actions have been recorded for this case.',
      noDueDate: 'No due date',
      due: (date) => `Due ${date}`,
      statuses: {
        open: 'Open',
        in_progress: 'In progress',
        done: 'Completed',
        cancelled: 'Cancelled',
      },
      readOnly: 'You have read-only access to these actions.',
    },
    toast: {
      roleUpdated: 'Company legal role updated.',
      taskCompleted: 'Required action completed.',
      taskReopened: 'Required action reopened.',
    },
  },
  ar: {
    tab: 'الموقف القانوني',
    heading: 'تقييم الموقف القانوني للشركة',
    description:
      'الصفة القانونية الحالية للشركة وقوة الموقف وبيانات الخصم والإجراءات المطلوبة في هذه القضية.',
    role: {
      title: 'الصفة القانونية للشركة',
      description: 'تحدد هذه الصفة مسارات عمل المدعي والمدعى عليه في القضية.',
      options: {
        plaintiff: 'مدعي (الشركة)',
        defendant: 'مدعى عليه (الشركة)',
      },
      saving: 'جارٍ حفظ الصفة…',
    },
    strength: {
      title: 'مؤشر قوة الموقف القانوني',
      overall: 'قوة الموقف الكلية',
      bands: {
        very_strong: 'موقف قانوني قوي جداً',
        strong: 'موقف قانوني قوي',
        moderate: 'موقف قانوني متوسط',
        weak: 'موقف قانوني ضعيف',
      },
      notAssessed: 'لم يُقيَّم بعد',
      notAssessedHint:
        'حدّد احتمالية المخاطر القانونية وأثرها لاحتساب مؤشر موثوق لقوة الموقف.',
      assessedHint: (score) =>
        `يُحتسب مؤشر الموقف البالغ ${score} من احتمالية المخاطر القانونية وأثرها المحفوظين.`,
    },
    facts: {
      title: 'بيانات الدعوى والأطراف',
      description: 'بيانات المحكمة والطرف الخصم المسجلة فعلياً في ملف القضية.',
      opponent: 'الطرف الخصم',
      opponentRepresentative: 'الممثل القانوني للخصم',
      court: 'الاختصاص القضائي',
      circuit: 'الدائرة أو المرجع القضائي',
      notSet: 'غير مسجل',
    },
    actions: {
      title: (role) => `الإجراءات المطلوبة (${role})`,
      description: 'تُحدَّث مهام القضية مباشرة عند إكمالها أو إعادة فتحها.',
      empty: 'لا توجد إجراءات مطلوبة مسجلة لهذه القضية.',
      noDueDate: 'بلا موعد استحقاق',
      due: (date) => `الاستحقاق ${date}`,
      statuses: {
        open: 'مفتوحة',
        in_progress: 'قيد التنفيذ',
        done: 'مكتملة',
        cancelled: 'ملغاة',
      },
      readOnly: 'لديك صلاحية قراءة هذه الإجراءات فقط.',
    },
    toast: {
      roleUpdated: 'تم تحديث الصفة القانونية للشركة.',
      taskCompleted: 'تم إكمال الإجراء المطلوب.',
      taskReopened: 'تمت إعادة فتح الإجراء المطلوب.',
    },
  },
};

export function useCasePositionLabels(): CasePositionLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(labels, locale), [locale]);
}
