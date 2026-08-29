/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the Contracts &
 * Consultations "Control & Monitoring Panel" (`/lex/contracts/control`).
 *
 * Twin of the Case & Investigation control-panel bundle
 * (`../../cases/control/_lib/labels.ts`) — same shape and tone so the two
 * service-workspace dashboards read as one system. Follows the canonical lex
 * i18n contract (`_lib/lex-i18n.ts`): a single `LexBilingual<T>` bundle with two
 * full, same-shaped copies resolved by {@link useContractsControlLabels}.
 * Interpolation stays as `(value) => string` on BOTH sides so digits and
 * placeholders are identical across locales; status/type tokens are localized by
 * the shared chips/resolvers and are intentionally NOT duplicated here.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  resolveLexBilingual,
  type LexBilingual,
} from '../../../_lib/lex-i18n';

export interface ContractsControlLabels {
  page: {
    title: string;
    description: string;
    navShort: string;
    newRequest: string;
    newContract: string;
  };
  kpis: {
    activeContracts: string;
    underReview: string;
    consultations: string;
    expiring: string;
    shareOfPortfolio: (pct: string) => string;
    inReview: (count: string) => string;
    open: (count: string) => string;
    withinDays: (days: string) => string;
  };
  recentContracts: {
    title: string;
    viewAll: string;
    columns: {
      reference: string;
      type: string;
      status: string;
      counterparty: string;
      reviewer: string;
    };
    unassigned: string;
    untitled: string;
    empty: string;
  };
  recentConsultations: {
    title: string;
    viewAll: string;
    columns: {
      reference: string;
      type: string;
      status: string;
      advisor: string;
    };
    unassigned: string;
    untitled: string;
    empty: string;
  };
  byType: {
    contractsTitle: string;
    consultationsTitle: string;
    empty: string;
    ofTotal: (count: string) => string;
  };
  assignment: {
    title: string;
    description: string;
    count: (count: string) => string;
    contract: string;
    consultation: string;
    approvedRequest: string;
    received: (value: string) => string;
    viewDetails: string;
    assign: string;
    dialogTitle: string;
    dialogDescription: (reference: string) => string;
    teamMember: string;
    searchPlaceholder: string;
    noEligibleMembers: string;
    cancel: string;
    confirm: string;
    assigning: string;
    success: string;
    empty: string;
    emptyHint: string;
  };
  states: {
    errorTitle: string;
    errorBody: string;
    retry: string;
  };
}

const contractsControlLabels: LexBilingual<ContractsControlLabels> = {
  en: {
    page: {
      title: 'Control & Monitoring Panel',
      description: 'Contracts & Consultations Management Workspace',
      navShort: 'Control Panel',
      newRequest: 'New Request',
      newContract: 'New Contract',
    },
    kpis: {
      activeContracts: 'Active Contracts',
      underReview: 'Under Review',
      consultations: 'Consultations',
      expiring: 'Expiring in 30 Days',
      shareOfPortfolio: (pct) => `${pct}% of portfolio`,
      inReview: (count) => `${count} in review`,
      open: (count) => `${count} open`,
      withinDays: (days) => `${days} approaching renewal`,
    },
    recentContracts: {
      title: 'Recent Contracts',
      viewAll: 'View All Contracts',
      columns: {
        reference: 'Reference',
        type: 'Type',
        status: 'Status',
        counterparty: 'Counterparty',
        reviewer: 'Reviewer',
      },
      unassigned: 'Unassigned',
      untitled: 'Untitled contract',
      empty: 'No contracts have been recorded yet.',
    },
    recentConsultations: {
      title: 'Recent Consultations',
      viewAll: 'View All Consultations',
      columns: {
        reference: 'Reference',
        type: 'Type',
        status: 'Status',
        advisor: 'Advisor',
      },
      unassigned: 'Unassigned',
      untitled: 'Untitled consultation',
      empty: 'No consultations have been recorded yet.',
    },
    byType: {
      contractsTitle: 'Contracts by Type',
      consultationsTitle: 'Consultations by Type',
      empty: 'No type data available yet.',
      ofTotal: (count) => `${count} records`,
    },
    assignment: {
      title: 'Unassigned Backlog',
      description:
        'Approved consultation requests and contracts you own that are ready for assignment.',
      count: (count) => `${count} waiting`,
      contract: 'Contract',
      consultation: 'Consultation',
      approvedRequest: 'Approved request',
      received: (value) => `Received ${value}`,
      viewDetails: 'View details',
      assign: 'Assign team member',
      dialogTitle: 'Quick assignment',
      dialogDescription: (reference) => `Choose an eligible team member for ${reference}.`,
      teamMember: 'Team member',
      searchPlaceholder: 'Search eligible team members…',
      noEligibleMembers: 'No eligible team members match your search.',
      cancel: 'Cancel',
      confirm: 'Assign',
      assigning: 'Assigning…',
      success: 'Work assigned successfully',
      empty: 'No work is waiting for assignment',
      emptyHint: 'New approved requests and owned contracts will appear here automatically.',
    },
    states: {
      errorTitle: 'This workspace is unavailable',
      errorBody:
        'We could not load the contracts and consultations workspace. Please try again.',
      retry: 'Retry',
    },
  },
  ar: {
    page: {
      title: 'لوحة التحكم والمراقبة',
      description: 'مساحة عمل إدارة العقود والاستشارات',
      navShort: 'لوحة التحكم',
      newRequest: 'طلب جديد',
      newContract: 'عقد جديد',
    },
    kpis: {
      activeContracts: 'العقود النشطة',
      underReview: 'قيد المراجعة',
      consultations: 'الاستشارات',
      expiring: 'تنتهي خلال ٣٠ يومًا',
      shareOfPortfolio: (pct) => `${pct}٪ من المحفظة`,
      inReview: (count) => `${count} قيد المراجعة`,
      open: (count) => `${count} مفتوحة`,
      withinDays: (days) => `${days} تقترب من التجديد`,
    },
    recentContracts: {
      title: 'أحدث العقود',
      viewAll: 'عرض جميع العقود',
      columns: {
        reference: 'المرجع',
        type: 'النوع',
        status: 'الحالة',
        counterparty: 'الطرف المقابل',
        reviewer: 'المراجع',
      },
      unassigned: 'غير مُسند',
      untitled: 'عقد بلا عنوان',
      empty: 'لم يتم تسجيل أي عقود بعد.',
    },
    recentConsultations: {
      title: 'أحدث الاستشارات',
      viewAll: 'عرض جميع الاستشارات',
      columns: {
        reference: 'المرجع',
        type: 'النوع',
        status: 'الحالة',
        advisor: 'المستشار',
      },
      unassigned: 'غير مُسند',
      untitled: 'استشارة بلا عنوان',
      empty: 'لم يتم تسجيل أي استشارات بعد.',
    },
    byType: {
      contractsTitle: 'العقود حسب النوع',
      consultationsTitle: 'الاستشارات حسب النوع',
      empty: 'لا تتوفر بيانات حسب النوع بعد.',
      ofTotal: (count) => `${count} سجلًا`,
    },
    assignment: {
      title: 'قائمة الأعمال غير المسندة',
      description:
        'طلبات الاستشارات المعتمدة والعقود التي تملكها والجاهزة للإسناد.',
      count: (count) => `${count} بانتظار الإسناد`,
      contract: 'عقد',
      consultation: 'استشارة',
      approvedRequest: 'طلب معتمد',
      received: (value) => `ورد ${value}`,
      viewDetails: 'عرض التفاصيل',
      assign: 'إسناد إلى عضو فريق',
      dialogTitle: 'إسناد سريع',
      dialogDescription: (reference) => `اختر عضو فريق مؤهلًا لإسناد ${reference}.`,
      teamMember: 'عضو الفريق',
      searchPlaceholder: 'ابحث في أعضاء الفريق المؤهلين…',
      noEligibleMembers: 'لا يوجد أعضاء فريق مؤهلون يطابقون البحث.',
      cancel: 'إلغاء',
      confirm: 'إسناد',
      assigning: 'جارٍ الإسناد…',
      success: 'تم إسناد العمل بنجاح',
      empty: 'لا توجد أعمال بانتظار الإسناد',
      emptyHint: 'ستظهر هنا تلقائيًا الطلبات الجديدة المعتمدة والعقود التي تملكها.',
    },
    states: {
      errorTitle: 'مساحة العمل هذه غير متاحة',
      errorBody:
        'تعذّر تحميل مساحة عمل العقود والاستشارات. يرجى المحاولة مرة أخرى.',
      retry: 'إعادة المحاولة',
    },
  },
};

export function useContractsControlLabels(): ContractsControlLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => resolveLexBilingual(contractsControlLabels, locale),
    [locale],
  );
}

/** Pure resolver for non-React consumers and unit tests. */
export function resolveContractsControlLabels(
  locale: 'en' | 'ar' = 'en',
): ContractsControlLabels {
  return resolveLexBilingual(contractsControlLabels, locale);
}
