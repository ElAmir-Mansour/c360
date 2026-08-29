'use client';

/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the SLA
 * Operations Board (`/lex/service-desk/sla-board`) — feature #1 of the Watheeq
 * legal service desk.
 *
 * Follows the canonical lex i18n contract verbatim (see
 * `../../_lib/lex-i18n.ts`): a `LexBilingual<T>` bundle with two FULL,
 * same-shaped copies (English in `en`, professional MSA in `ar`), resolved
 * against the active locale by {@link useSlaBoardLabels}. Components consume the
 * resolved `T`, never the bundle. Interpolation params, ICU shape, and Western
 * digits are preserved across both locales.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  resolveLexBilingual,
  type LexBilingual,
} from '../../_lib/lex-i18n';

export interface SlaBoardLabels {
  eyebrow: string;
  pageTitle: string;
  pageDescription: string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  searchPlaceholder: string;
  kpis: {
    breachImminent: string;
    breachImminentDescription: string;
    ackRisk: string;
    ackRiskDescription: string;
    breached: string;
    breachedDescription: string;
    escalated: string;
    escalatedDescription: string;
  };
  columns: {
    request: string;
    service: string;
    priority: string;
    outcome: string;
    ack: string;
    turnaround: string;
    escalation: string;
    risk: string;
    actions: string;
  };
  priorityOptions: Record<string, string>;
  outcomeOptions: Record<string, string>;
  ack: {
    done: string;
    overdue: string;
    risk: string;
  };
  risk: {
    breachImminent: string;
    ackRisk: string;
    escalationImminent: string;
    clear: string;
  };
  escalation: {
    level: (level: number) => string;
    none: string;
    nextRecipientPrefix: string;
    noRecipient: string;
  };
  turnaround: {
    timeLeft: (formatted: string) => string;
    overdue: string;
  };
  filters: {
    outcome: string;
    breached: string;
    escalationLevel: string;
    priority: string;
    serviceCode: string;
    serviceCodePlaceholder: string;
    dueBefore: string;
    dueBeforeClear: string;
  };
  booleanOptions: {
    yes: string;
    no: string;
  };
  escalationLevelOptions: Record<string, string>;
  actions: {
    escalateNow: string;
    escalating: string;
  };
  toast: {
    escalateSuccessTitle: string;
    escalateSuccessDescription: (requestNumber: string) => string;
    escalateErrorTitle: string;
  };
}

export const slaBoardLabels: LexBilingual<SlaBoardLabels> = {
  en: {
    eyebrow: 'Legal Suite',
    pageTitle: 'SLA Operations Board',
    pageDescription:
      'Cross-request triage of SLA clocks. Surface acknowledgement and turnaround deadlines about to breach, and escalate before they do.',
    loadError: 'Failed to load SLA clocks.',
    emptyTitle: 'No SLA clocks',
    emptyDescription: 'No SLA clocks match the current filters.',
    searchPlaceholder: 'Search by request number…',
    kpis: {
      breachImminent: 'Breach Imminent',
      breachImminentDescription: 'On the loaded page',
      ackRisk: 'Acknowledgement Risk',
      ackRiskDescription: 'Ack window at risk',
      breached: 'Breached',
      breachedDescription: 'SLA already missed',
      escalated: 'Escalated',
      escalatedDescription: 'Past level 0',
    },
    columns: {
      request: 'Request',
      service: 'Service',
      priority: 'Priority',
      outcome: 'Outcome',
      ack: 'Acknowledgement',
      turnaround: 'Turnaround Due',
      escalation: 'Escalation',
      risk: 'Risk',
      actions: 'Actions',
    },
    priorityOptions: {
      urgent: 'Urgent',
      normal: 'Normal',
    },
    outcomeOptions: {
      pending: 'Pending',
      on_time: 'On time',
      breached: 'Breached',
    },
    ack: {
      done: 'Acknowledged',
      overdue: 'Overdue',
      risk: 'At risk',
    },
    risk: {
      breachImminent: 'Breach imminent',
      ackRisk: 'Ack risk',
      escalationImminent: 'Escalation imminent',
      clear: 'Clear',
    },
    escalation: {
      level: (level) => `Level ${level}`,
      none: 'No escalation',
      nextRecipientPrefix: 'Next:',
      noRecipient: 'No recipient',
    },
    turnaround: {
      timeLeft: (formatted) => `${formatted} left`,
      overdue: 'Overdue',
    },
    filters: {
      outcome: 'Outcome',
      breached: 'Breached',
      escalationLevel: 'Escalation level',
      priority: 'Priority',
      serviceCode: 'Service code',
      serviceCodePlaceholder: 'e.g. contract_review',
      dueBefore: 'Turnaround due before',
      dueBeforeClear: 'Clear',
    },
    booleanOptions: {
      yes: 'Breached',
      no: 'Not breached',
    },
    escalationLevelOptions: {
      '0': 'Level 0',
      '1': 'Level 1',
      '2': 'Level 2',
      '3': 'Level 3',
    },
    actions: {
      escalateNow: 'Escalate now',
      escalating: 'Escalating…',
    },
    toast: {
      escalateSuccessTitle: 'Escalated',
      escalateSuccessDescription: (requestNumber) =>
        `SLA clock for ${requestNumber} escalated to the next level.`,
      escalateErrorTitle: 'Escalation failed',
    },
  },
  ar: {
    eyebrow: 'الشؤون القانونية',
    pageTitle: 'لوحة عمليات اتفاقية مستوى الخدمة',
    pageDescription:
      'فرز شامل لساعات اتفاقية مستوى الخدمة عبر الطلبات. إبراز مواعيد الإقرار والإنجاز الموشكة على التجاوز، والتصعيد قبل وقوعه.',
    loadError: 'تعذّر تحميل ساعات اتفاقية مستوى الخدمة.',
    emptyTitle: 'لا توجد ساعات اتفاقية مستوى الخدمة',
    emptyDescription: 'لا توجد ساعات مطابقة للمرشّحات الحالية.',
    searchPlaceholder: 'البحث برقم الطلب…',
    kpis: {
      breachImminent: 'تجاوز وشيك',
      breachImminentDescription: 'في الصفحة المحمَّلة',
      ackRisk: 'خطر الإقرار',
      ackRiskDescription: 'نافذة الإقرار في خطر',
      breached: 'متجاوَز',
      breachedDescription: 'تم تجاوز الاتفاقية بالفعل',
      escalated: 'مُصعَّد',
      escalatedDescription: 'تجاوز المستوى 0',
    },
    columns: {
      request: 'الطلب',
      service: 'الخدمة',
      priority: 'الأولوية',
      outcome: 'النتيجة',
      ack: 'الإقرار',
      turnaround: 'موعد الإنجاز',
      escalation: 'التصعيد',
      risk: 'الخطر',
      actions: 'الإجراءات',
    },
    priorityOptions: {
      urgent: 'عاجل',
      normal: 'عادي',
    },
    outcomeOptions: {
      pending: 'قيد الانتظار',
      on_time: 'في الوقت المحدد',
      breached: 'متجاوَز',
    },
    ack: {
      done: 'تم الإقرار',
      overdue: 'متأخر',
      risk: 'في خطر',
    },
    risk: {
      breachImminent: 'تجاوز وشيك',
      ackRisk: 'خطر الإقرار',
      escalationImminent: 'تصعيد وشيك',
      clear: 'سليم',
    },
    escalation: {
      level: (level) => `المستوى ${level}`,
      none: 'لا تصعيد',
      nextRecipientPrefix: 'التالي:',
      noRecipient: 'لا مستلِم',
    },
    turnaround: {
      timeLeft: (formatted) => `متبقٍّ ${formatted}`,
      overdue: 'متأخر',
    },
    filters: {
      outcome: 'النتيجة',
      breached: 'التجاوز',
      escalationLevel: 'مستوى التصعيد',
      priority: 'الأولوية',
      serviceCode: 'رمز الخدمة',
      serviceCodePlaceholder: 'مثال: contract_review',
      dueBefore: 'موعد الإنجاز قبل',
      dueBeforeClear: 'مسح',
    },
    booleanOptions: {
      yes: 'متجاوَز',
      no: 'غير متجاوَز',
    },
    escalationLevelOptions: {
      '0': 'المستوى 0',
      '1': 'المستوى 1',
      '2': 'المستوى 2',
      '3': 'المستوى 3',
    },
    actions: {
      escalateNow: 'تصعيد الآن',
      escalating: 'جارٍ التصعيد…',
    },
    toast: {
      escalateSuccessTitle: 'تم التصعيد',
      escalateSuccessDescription: (requestNumber) =>
        `تم تصعيد ساعة اتفاقية مستوى الخدمة للطلب ${requestNumber} إلى المستوى التالي.`,
      escalateErrorTitle: 'فشل التصعيد',
    },
  },
};

/**
 * useSlaBoardLabels reads the active locale and returns the resolved
 * {@link SlaBoardLabels}, memoized on locale. Mirrors the suite-wide
 * `use<Feature>Labels()` pattern.
 */
export function useSlaBoardLabels(): SlaBoardLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(slaBoardLabels, locale), [locale]);
}
