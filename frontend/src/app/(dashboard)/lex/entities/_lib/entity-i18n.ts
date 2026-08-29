/**
 * ENTITY-360 — feature-local bilingual label bundle (EN + professional MSA).
 *
 * Follows the canonical lex i18n contract verbatim: a `LexBilingual<T>` bundle
 * (two full, same-shaped copies) resolved by a thin `useEntityLabels()` hook
 * over `resolveLexBilingual`. NOTHING is added to the shared suite i18n file —
 * this bundle is owned entirely by the entities domain.
 *
 * Glossary (KSA legal): الطرف المقابل / المنشأة / العقد / القضية / التسوية /
 * التعرّض المالي / نسبة الاسترداد / مدّعٍ / مدّعى عليه.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import {
  type LexBilingual,
  resolveLexBilingual,
} from '../../_lib/lex-i18n';

export interface EntityLabels {
  list: {
    eyebrow: string;
    title: string;
    description: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    errorTitle: string;
    errorDescription: string;
    retry: string;
    columns: {
      organization: string;
      records: string;
      exposure: string;
      recovery: string;
      lastActivity: string;
    };
    /** Inline mini-stats under an org name. */
    recordSummary: (
      contracts: number,
      cases: number,
      settlements: number,
    ) => string;
    noActivity: string;
  };
  kpis: {
    organizations: string;
    totalExposure: string;
    settlementExposure: string;
    recoveryRate: string;
    openCases: string;
    activeContracts: string;
  };
  /**
   * Localized copy for the honest "case attribution unavailable from list view"
   * state. Cases can only be tied to a counterparty once each case's detail
   * (which hydrates parties) is loaded, so we surface this instead of a false 0.
   */
  caseUnavailable: {
    /** Short placeholder shown where a case count/number would otherwise be. */
    value: string;
    /** Title for an explanatory tile/banner. */
    title: string;
    /** One-line explanation of why the metric is unavailable here. */
    description: string;
  };
  detail: {
    backToList: string;
    notFoundTitle: string;
    notFoundDescription: string;
    hero: {
      eyebrow: string;
      records: (n: number) => string;
      lastActivity: string;
      noActivity: string;
      facts: {
        exposure: string;
        recovery: string;
        contracts: string;
        cases: string;
        settlements: string;
      };
    };
    kpis: {
      contractValue: string;
      settlementExposure: string;
      settledValue: string;
      openCases: string;
    };
    posture: {
      plaintiff: string;
      defendant: string;
      activeContracts: string;
      recoveryProgress: string;
    };
    tabs: {
      overview: string;
      contracts: string;
      cases: string;
      settlements: string;
      activity: string;
    };
    sections: {
      contracts: string;
      cases: string;
      settlements: string;
      activity: string;
      exposureBreakdown: string;
    };
    empty: {
      contracts: string;
      cases: string;
      settlements: string;
      activity: string;
    };
    record: {
      noReference: string;
      noValue: string;
      asPlaintiff: string;
      asDefendant: string;
      view: string;
    };
    activityVerbs: {
      contract: string;
      case: string;
      settlement: string;
    };
  };
}

const entityLabels: LexBilingual<EntityLabels> = {
  en: {
    list: {
      eyebrow: 'Legal Suite',
      title: 'Entity 360',
      description:
        'Every counterparty organization at a glance — their contracts, cases, settlements and total SAR footprint, stitched together across the suite.',
      searchPlaceholder: 'Search organizations…',
      emptyTitle: 'No organizations yet',
      emptyDescription:
        'Counterparties appear here as soon as they are named on a contract, case or settlement.',
      errorTitle: 'Could not load organizations',
      errorDescription:
        'We could not aggregate the counterparty footprint. Please try again.',
      retry: 'Retry',
      columns: {
        organization: 'Organization',
        records: 'Records',
        exposure: 'SAR exposure',
        recovery: 'Recovery',
        lastActivity: 'Last activity',
      },
      recordSummary: (contracts, cases, settlements) =>
        `${contracts} contracts · ${cases} cases · ${settlements} settlements`,
      noActivity: 'No activity',
    },
    kpis: {
      organizations: 'Organizations',
      totalExposure: 'Total SAR exposure',
      settlementExposure: 'Settlement exposure',
      recoveryRate: 'Recovery rate',
      openCases: 'Open cases',
      activeContracts: 'Active contracts',
    },
    caseUnavailable: {
      value: 'In case detail',
      title: 'Case metrics need case detail',
      description:
        'Cases are tied to a counterparty by their parties, which the case list does not include. Open a case to attribute it. Contract and settlement figures are complete.',
    },
    detail: {
      backToList: 'All organizations',
      notFoundTitle: 'Organization not found',
      notFoundDescription:
        'This counterparty has no contracts, cases or settlements on record — it may have been merged or renamed.',
      hero: {
        eyebrow: 'Entity 360',
        records: (n) => `${n} linked record${n === 1 ? '' : 's'}`,
        lastActivity: 'Last activity',
        noActivity: 'No activity yet',
        facts: {
          exposure: 'Total SAR exposure',
          recovery: 'Recovery rate',
          contracts: 'Contracts',
          cases: 'Cases',
          settlements: 'Settlements',
        },
      },
      kpis: {
        contractValue: 'Contract value',
        settlementExposure: 'Settlement exposure',
        settledValue: 'Realised settled',
        openCases: 'Open cases',
      },
      posture: {
        plaintiff: 'As plaintiff',
        defendant: 'As defendant',
        activeContracts: 'Active contracts',
        recoveryProgress: 'Settlement recovery',
      },
      tabs: {
        overview: 'Overview',
        contracts: 'Contracts',
        cases: 'Cases',
        settlements: 'Settlements',
        activity: 'Activity',
      },
      sections: {
        contracts: 'Contracts',
        cases: 'Cases',
        settlements: 'Settlements',
        activity: 'Activity timeline',
        exposureBreakdown: 'Exposure breakdown',
      },
      empty: {
        contracts: 'No contracts with this organization.',
        cases: 'No cases involving this organization.',
        settlements: 'No settlements with this organization.',
        activity: 'No recorded activity for this organization yet.',
      },
      record: {
        noReference: 'No reference',
        noValue: 'No value',
        asPlaintiff: 'Plaintiff',
        asDefendant: 'Defendant',
        view: 'Open',
      },
      activityVerbs: {
        contract: 'updated contract',
        case: 'updated case',
        settlement: 'updated settlement',
      },
    },
  },
  ar: {
    list: {
      eyebrow: 'المجموعة القانونية',
      title: 'المنشأة 360',
      description:
        'كل منشأة طرف مقابل في لمحة واحدة — عقودها وقضاياها وتسوياتها وإجمالي تعرّضها المالي بالريال، مجمّعة عبر المجموعة.',
      searchPlaceholder: 'ابحث في المنشآت…',
      emptyTitle: 'لا توجد منشآت بعد',
      emptyDescription:
        'تظهر الأطراف المقابلة هنا فور ذكرها في عقد أو قضية أو تسوية.',
      errorTitle: 'تعذّر تحميل المنشآت',
      errorDescription: 'تعذّر تجميع بصمة الطرف المقابل. يُرجى المحاولة مرة أخرى.',
      retry: 'إعادة المحاولة',
      columns: {
        organization: 'المنشأة',
        records: 'السجلات',
        exposure: 'التعرّض بالريال',
        recovery: 'الاسترداد',
        lastActivity: 'آخر نشاط',
      },
      recordSummary: (contracts, cases, settlements) =>
        `${contracts} عقود · ${cases} قضايا · ${settlements} تسويات`,
      noActivity: 'لا يوجد نشاط',
    },
    kpis: {
      organizations: 'المنشآت',
      totalExposure: 'إجمالي التعرّض بالريال',
      settlementExposure: 'تعرّض التسويات',
      recoveryRate: 'نسبة الاسترداد',
      openCases: 'القضايا المفتوحة',
      activeContracts: 'العقود السارية',
    },
    caseUnavailable: {
      value: 'في تفاصيل القضية',
      title: 'مؤشرات القضايا تتطلب فتح القضية',
      description:
        'تُنسب القضايا إلى الطرف المقابل عبر أطرافها، وهي غير مُضمّنة في قائمة القضايا. افتح القضية لنسبتها. أما أرقام العقود والتسويات فمكتملة.',
    },
    detail: {
      backToList: 'كل المنشآت',
      notFoundTitle: 'المنشأة غير موجودة',
      notFoundDescription:
        'لا توجد لهذا الطرف المقابل عقود أو قضايا أو تسويات مسجّلة — ربما دُمج أو أُعيدت تسميته.',
      hero: {
        eyebrow: 'المنشأة 360',
        records: (n) => `${n} سجل مرتبط`,
        lastActivity: 'آخر نشاط',
        noActivity: 'لا يوجد نشاط بعد',
        facts: {
          exposure: 'إجمالي التعرّض بالريال',
          recovery: 'نسبة الاسترداد',
          contracts: 'العقود',
          cases: 'القضايا',
          settlements: 'التسويات',
        },
      },
      kpis: {
        contractValue: 'قيمة العقود',
        settlementExposure: 'تعرّض التسويات',
        settledValue: 'المُسوّى فعليًا',
        openCases: 'القضايا المفتوحة',
      },
      posture: {
        plaintiff: 'كمدّعٍ',
        defendant: 'كمدّعى عليه',
        activeContracts: 'العقود السارية',
        recoveryProgress: 'استرداد التسويات',
      },
      tabs: {
        overview: 'نظرة عامة',
        contracts: 'العقود',
        cases: 'القضايا',
        settlements: 'التسويات',
        activity: 'النشاط',
      },
      sections: {
        contracts: 'العقود',
        cases: 'القضايا',
        settlements: 'التسويات',
        activity: 'الخط الزمني للنشاط',
        exposureBreakdown: 'تفصيل التعرّض',
      },
      empty: {
        contracts: 'لا توجد عقود مع هذه المنشأة.',
        cases: 'لا توجد قضايا تخص هذه المنشأة.',
        settlements: 'لا توجد تسويات مع هذه المنشأة.',
        activity: 'لا يوجد نشاط مسجّل لهذه المنشأة بعد.',
      },
      record: {
        noReference: 'بلا مرجع',
        noValue: 'لا توجد قيمة',
        asPlaintiff: 'مدّعٍ',
        asDefendant: 'مدّعى عليه',
        view: 'فتح',
      },
      activityVerbs: {
        contract: 'حدّث العقد',
        case: 'حدّث القضية',
        settlement: 'حدّث التسوية',
      },
    },
  },
};

export function resolveEntityLabels(locale: AppLocale = 'en'): EntityLabels {
  return resolveLexBilingual(entityLabels, locale);
}

export function useEntityLabels(): EntityLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveEntityLabels(locale), [locale]);
}
