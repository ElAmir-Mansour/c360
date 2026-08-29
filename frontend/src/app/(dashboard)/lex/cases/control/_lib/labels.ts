/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the Case &
 * Investigation "Control & Monitoring Panel" (`/lex/cases/control`).
 *
 * Follows the canonical lex i18n contract (see `_lib/lex-i18n.ts`): a single
 * `LexBilingual<T>` bundle with two full, same-shaped copies resolved against
 * the active locale by {@link useControlPanelLabels}. Interpolation stays as
 * `(value) => string` functions on BOTH sides so digits/placeholders are
 * identical across locales; status-enum tokens are localized by the shared
 * `<LexStatusChip>` and are intentionally NOT duplicated here.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  resolveLexBilingual,
  type LexBilingual,
} from '../../../_lib/lex-i18n';

export interface ControlPanelLabels {
  page: {
    title: string;
    description: string;
    role: string;
    roleContext: string;
    activityWindow: string;
    today: string;
    sevenDays: string;
    thirtyDays: string;
    /** Short label for the entry-point button on the cases list header. */
    navShort: string;
    addCase: string;
    refresh: string;
  };
  kpis: {
    activeCases: string;
    underReview: string;
    dueSoon: string;
    defendant: string;
    plaintiff: string;
    investigations: string;
    lawsuits: string;
    /** Honest present-state context shown in the trend slot. */
    shareOfPortfolio: (pct: string) => string;
    inProgress: (count: string) => string;
    openCases: (count: string) => string;
    stable: string;
    unavailable: string;
    dueSoonHint: (count: string) => string;
    underReviewHint: (count: string) => string;
  };
  recent: {
    title: string;
    viewArchive: string;
    columns: {
      reference: string;
      side: string;
      priority: string;
      reviewer: string;
      caseId: string;
      category: string;
      status: string;
      lawyer: string;
      nextHearing: string;
    };
    unassigned: string;
    notScheduled: string;
    untitled: string;
    empty: string;
    assign: string;
  };
  byType: {
    title: string;
    empty: string;
    ofTotal: (count: string) => string;
  };
  investigations: {
    title: string;
    viewAll: string;
    columns: {
      reference: string;
      caseType: string;
      status: string;
      investigator: string;
    };
    heading: string;
    reviewFile: string;
    started: (date: string) => string;
    empty: string;
    untitled: string;
    noSummary: string;
    ledBy: (name: string) => string;
  };
  investigationsByType: {
    title: string;
    empty: string;
    ofTotal: (count: string) => string;
  };
  companyStatus: {
    plaintiff: string;
    defendant: string;
  };
  digest: {
    title: string;
    resolved: (count: string) => string;
    onHold: (count: string) => string;
    allClear: string;
    empty: string;
  };
  states: {
    errorTitle: string;
    errorBody: string;
    portfolioError: string;
    recentCasesError: string;
    investigationsError: string;
    digestError: string;
    retry: string;
  };
}

const controlPanelLabels: LexBilingual<ControlPanelLabels> = {
  en: {
    page: {
      title: 'Welcome, Cases Manager',
      description: 'Cases & Investigations Management Workspace',
      role: 'Cases Manager',
      roleContext: 'Legal cases and investigations',
      activityWindow: 'Recent activity window',
      today: 'Today',
      sevenDays: '7 Days',
      thirtyDays: '30 Days',
      navShort: 'Control Panel',
      addCase: 'Add New Case',
      refresh: 'Refresh',
    },
    kpis: {
      activeCases: 'Active Cases',
      underReview: 'Under Review',
      dueSoon: 'Due in 30 Days',
      defendant: 'Cases as Defendant',
      plaintiff: 'Cases as Plaintiff',
      investigations: 'Investigations',
      lawsuits: 'Active Lawsuits',
      shareOfPortfolio: (pct) => `${pct}% of portfolio`,
      inProgress: (count) => `${count} in progress`,
      openCases: (count) => `${count} open cases`,
      stable: 'Stable',
      unavailable: 'Not available',
      dueSoonHint: (count) => `${count} approaching due date`,
      underReviewHint: (count) => `${count} in review`,
    },
    recent: {
      title: 'Recent Cases',
      viewArchive: 'View Full Archive',
      columns: {
        reference: 'Reference',
        side: 'Side',
        priority: 'Priority',
        reviewer: 'Reviewer',
        caseId: 'Case ID',
        category: 'Category',
        status: 'Status',
        lawyer: 'Assigned Lawyer',
        nextHearing: 'Next Hearing',
      },
      unassigned: 'Unassigned',
      notScheduled: 'Not scheduled',
      untitled: 'Untitled case',
      empty: 'No cases have been recorded yet.',
      assign: 'Assign',
    },
    byType: {
      title: 'Cases by Type',
      empty: 'No case-type data available yet.',
      ofTotal: (count) => `${count} cases`,
    },
    investigations: {
      title: 'Recent Investigations',
      viewAll: 'View All Investigations',
      columns: {
        reference: 'Reference',
        caseType: 'Case Type',
        status: 'Status',
        investigator: 'Investigator',
      },
      heading: 'Active Investigations',
      reviewFile: 'Review File',
      started: (date) => `Started: ${date}`,
      empty: 'No active investigations right now.',
      untitled: 'Untitled investigation',
      noSummary: 'No summary recorded yet.',
      ledBy: (name) => `Led by ${name}`,
    },
    investigationsByType: {
      title: 'Investigations by Case Type',
      empty: 'No investigation case-type data available yet.',
      ofTotal: (count) => `${count} investigations`,
    },
    companyStatus: {
      plaintiff: 'As plaintiff',
      defendant: 'As defendant',
    },
    digest: {
      title: 'Weekly Activity Digest',
      resolved: (count) =>
        `${count} internal dispute(s) resolved in the last seven days.`,
      onHold: (count) =>
        `Please prioritise legal audits for the ${count} case(s) flagged “On Hold” to initiate the relevant actions.`,
      allClear: 'No cases are currently on hold — the portfolio is progressing.',
      empty: 'Activity summary will appear once cases are recorded.',
    },
    states: {
      errorTitle: 'Unable to load the control panel',
      errorBody: 'The case and investigation metrics could not be retrieved.',
      portfolioError: 'Portfolio metrics could not be retrieved.',
      recentCasesError: 'Recent cases could not be retrieved.',
      investigationsError: 'Active investigations could not be retrieved.',
      digestError: 'The weekly activity digest could not be retrieved.',
      retry: 'Try again',
    },
  },
  ar: {
    page: {
      title: 'مرحبًا، مدير القضايا',
      description: 'مساحة عمل إدارة القضايا والتحقيقات',
      role: 'مدير القضايا',
      roleContext: 'القضايا والتحقيقات القانونية',
      activityWindow: 'نطاق النشاط الأخير',
      today: 'اليوم',
      sevenDays: '٧ أيام',
      thirtyDays: '٣٠ يومًا',
      navShort: 'لوحة التحكم',
      addCase: 'إضافة قضية جديدة',
      refresh: 'تحديث',
    },
    kpis: {
      activeCases: 'القضايا النشطة',
      underReview: 'قيد المراجعة',
      dueSoon: 'تستحق خلال ٣٠ يومًا',
      defendant: 'قضايا بصفة مدَّعى عليه',
      plaintiff: 'قضايا بصفة مدَّعٍ',
      investigations: 'التحقيقات',
      lawsuits: 'الدعاوى النشطة',
      shareOfPortfolio: (pct) => `${pct}% من المحفظة`,
      inProgress: (count) => `${count} قيد التنفيذ`,
      openCases: (count) => `${count} قضية مفتوحة`,
      stable: 'مستقر',
      unavailable: 'غير متاح',
      dueSoonHint: (count) => `${count} تقترب مواعيد استحقاقها`,
      underReviewHint: (count) => `${count} قيد المراجعة`,
    },
    recent: {
      title: 'أحدث القضايا',
      viewArchive: 'عرض الأرشيف الكامل',
      columns: {
        reference: 'المرجع',
        side: 'الصفة',
        priority: 'الأولوية',
        reviewer: 'المراجع',
        caseId: 'رقم القضية',
        category: 'التصنيف',
        status: 'الحالة',
        lawyer: 'المحامي المكلَّف',
        nextHearing: 'الجلسة القادمة',
      },
      unassigned: 'غير مُسنَدة',
      notScheduled: 'غير مجدولة',
      untitled: 'قضية بلا عنوان',
      empty: 'لم تُسجَّل أي قضايا بعد.',
      assign: 'تعيين',
    },
    byType: {
      title: 'القضايا حسب النوع',
      empty: 'لا تتوفر بيانات عن أنواع القضايا بعد.',
      ofTotal: (count) => `${count} قضية`,
    },
    investigations: {
      title: 'أحدث التحقيقات',
      viewAll: 'عرض جميع التحقيقات',
      columns: {
        reference: 'المرجع',
        caseType: 'نوع القضية',
        status: 'الحالة',
        investigator: 'المحقق',
      },
      heading: 'التحقيقات النشطة',
      reviewFile: 'مراجعة الملف',
      started: (date) => `بدأت في: ${date}`,
      empty: 'لا توجد تحقيقات نشطة حاليًا.',
      untitled: 'تحقيق بلا عنوان',
      noSummary: 'لم يُسجَّل ملخّص بعد.',
      ledBy: (name) => `بقيادة ${name}`,
    },
    investigationsByType: {
      title: 'التحقيقات حسب نوع القضية',
      empty: 'لا تتوفر بيانات لأنواع قضايا التحقيقات بعد.',
      ofTotal: (count) => `${count} تحقيقات`,
    },
    companyStatus: {
      plaintiff: 'بصفة مدَّعٍ',
      defendant: 'بصفة مدَّعى عليه',
    },
    digest: {
      title: 'الملخّص الأسبوعي للنشاط',
      resolved: (count) => `تمت تسوية ${count} نزاع داخلي خلال الأيام السبعة الماضية.`,
      onHold: (count) =>
        `يُرجى إعطاء الأولوية للمراجعة القانونية لـ ${count} قضية موسومة بحالة «معلّقة» لاتخاذ الإجراءات اللازمة.`,
      allClear: 'لا توجد قضايا معلّقة حاليًا — المحفظة تسير بانتظام.',
      empty: 'سيظهر ملخّص النشاط عند تسجيل القضايا.',
    },
    states: {
      errorTitle: 'تعذّر تحميل لوحة التحكم',
      errorBody: 'تعذّر جلب مؤشرات القضايا والتحقيقات.',
      portfolioError: 'تعذّر جلب مؤشرات محفظة القضايا.',
      recentCasesError: 'تعذّر جلب أحدث القضايا.',
      investigationsError: 'تعذّر جلب التحقيقات النشطة.',
      digestError: 'تعذّر جلب الملخّص الأسبوعي للنشاط.',
      retry: 'إعادة المحاولة',
    },
  },
};

export function useControlPanelLabels(): ControlPanelLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(controlPanelLabels, locale), [locale]);
}
