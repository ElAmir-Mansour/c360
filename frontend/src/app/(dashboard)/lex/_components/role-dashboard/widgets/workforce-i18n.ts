'use client';

import { useMemo } from 'react';

import { useBilingual } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { registerMessages } from '@/lib/i18n/registry';

import type { WorkforceMetricValue } from './workforce-contract';

type WorkforceMessages = {
  title: string;
  description: string;
  states: {
    loading: string;
    empty: string;
    error: string;
    unavailable: string;
  };
  actions: {
    retry: string;
    viewReports: string;
    showBreakdown: (name: string) => string;
    hideBreakdown: (name: string) => string;
  };
  scope: {
    label: string;
    memberCount: (count: string) => string;
    modes: Record<'org' | 'self' | 'tenant' | 'unscoped', string>;
    no_org_role: string;
    roster_not_configured: string;
    roster_stale: (days: string) => string;
  };
  period: {
    label: (from: string, to: string) => string;
    asOfNow: string;
    tenant: string;
    fallback_utc: string;
    workingDays: (days: string) => string;
  };
  columns: {
    member: string;
    activeWorkload: string;
    loadIndexPct: string;
    utilisationPct: string;
    completionRatePct: string;
    onTimePct: string;
    medianCycleDays: string;
    approvalLatencyHrs: string;
    obligationDischargePct: string;
    overdueCount: string;
    idleAssignmentPct: string;
  };
  anchors: {
    completionRatePct: string;
    obligationDischargePct: string;
  };
  identity: {
    inactive: string;
    unverified: string;
    unknown: string;
  };
  values: {
    days: (value: string) => string;
    hours: (value: string) => string;
    linked: (value: string) => string;
    unavailable: string;
    open: string;
    resolved: string;
    noBreakdown: string;
  };
  coverage: {
    summary: (attributed: string, total: string, percent: string) => string;
    truncated: (count: string) => string;
  };
  degraded: {
    title: string;
    forbidden: (domain: string) => string;
    query_error: (domain: string) => string;
  };
  domains: Record<string, string>;
  reasons: Record<string, string>;
};

const messages: Record<'en' | 'ar', WorkforceMessages> = {
  en: {
    title: 'Load distribution',
    description: 'Named team workload and delivery measures',
    states: {
      loading: 'Loading team performance',
      empty: 'No team members are available for this scope',
      error: 'Unable to load team performance',
      unavailable: 'Some measures are unavailable because their source contract is incomplete.',
    },
    actions: {
      retry: 'Retry',
      viewReports: 'View reports',
      showBreakdown: (name) => `Show ${name} workload breakdown`,
      hideBreakdown: (name) => `Hide ${name} workload breakdown`,
    },
    scope: {
      label: 'Scope',
      memberCount: (count) => `${count} members`,
      modes: { org: 'Organisation', self: 'My work', tenant: 'Tenant', unscoped: 'Unscoped' },
      no_org_role: 'No Legal Director organisation role is configured — showing department-wide figures.',
      roster_not_configured: 'Org roster not configured — showing department-wide figures.',
      roster_stale: (days) => `The organisation roster may be stale (${days} days).`,
    },
    period: {
      label: (from, to) => `${from} to ${to}`,
      asOfNow: 'Active workload and distribution are as of now.',
      tenant: 'Tenant calendar',
      fallback_utc: 'UTC fallback calendar',
      workingDays: (days) => `${days} working days`,
    },
    columns: {
      member: 'Team member',
      activeWorkload: 'Active workload',
      loadIndexPct: 'Team median',
      utilisationPct: 'Utilisation',
      completionRatePct: 'Completion',
      onTimePct: 'On time',
      medianCycleDays: 'Median cycle',
      approvalLatencyHrs: 'Approval latency',
      obligationDischargePct: 'Obligation discharge',
      overdueCount: 'Overdue',
      idleAssignmentPct: 'Idle assignment',
    },
    anchors: {
      completionRatePct: 'Resolved in period / resolved + open at period end',
      obligationDischargePct: 'Due in period / discharged on time',
    },
    identity: { inactive: 'Inactive', unverified: 'Unverified identity', unknown: 'Unknown identity' },
    values: {
      days: (value) => `${value} days`,
      hours: (value) => `${value} hours`,
      linked: (value) => `+${value} via linked records`,
      unavailable: 'Unavailable',
      open: 'Open',
      resolved: 'Resolved',
      noBreakdown: 'No attributable domain activity for this period.',
    },
    coverage: {
      summary: (attributed, total, percent) => `${attributed} of ${total} items attributed (${percent})`,
      truncated: (count) => `${count} additional rows are not shown`,
    },
    degraded: {
      title: 'Partial data',
      forbidden: (domain) => `${domain}: you do not have permission to view this domain.`,
      query_error: (domain) => `${domain}: the domain could not be queried.`,
    },
    domains: {
      contracts: 'Contracts', matters: 'Matters', obligations: 'Obligations',
      consultations: 'Consultations', cases: 'Cases', contract_intakes: 'Contract intakes',
      requests: 'Requests', support: 'Peer support', unknown: 'Other legal domain',
    },
    reasons: {
      calendar_unavailable: 'A tenant reporting calendar is unavailable.',
      no_capacity_source: 'No capacity source is configured.',
      no_capacity_configured: 'This person has zero configured capacity.',
      capacity_formula_undefined: 'The capacity-to-utilisation formula is not defined.',
      no_completion_sample: 'No completion sample is available for this period.',
      no_period_activity: 'No resolved or period-end open activity is available for this period.',
      terminal_timestamp_unavailable: 'A reliable terminal-status timestamp is unavailable.',
      historical_state_unavailable: 'A reliable historical state at the period boundary is unavailable.',
      aggregation_not_implemented: 'The required aggregation is not implemented.',
      workflow_attribution_undefined: 'Workflow attribution is not defined.',
      no_close_timestamp: 'No reliable close timestamp is available.',
      no_obligation_sample: 'No obligation sample is available for this period.',
      no_obligations_due_in_period: 'No obligations were due during this period.',
      no_cycle_sample: 'No completed-work sample is available for cycle-time measurement.',
      query_error: 'The source could not be queried.',
      no_population: 'No team population is available.',
      no_active_workload: 'There is no active workload.',
      aggregation_contract_undefined: 'The aggregation contract is not defined.',
      scope_not_permitted: 'This tenant-wide measure is not available in self scope.',
      domain_not_requested: 'This domain was not requested.',
      no_team_median: 'A non-zero team median is unavailable.',
      window_event_undefined: 'The reporting event for this windowed metric is not defined.',
      partial_data: 'This measure is incomplete because one or more domain sources failed.',
      no_assignee_column: 'This domain has no assignee column.',
      assignee_encrypted: 'The assignee source cannot be aggregated.',
      partial: 'Only partial domain coverage is available.',
      forbidden: 'You do not have permission to view this source.',
      unknown: 'This measure is unavailable.',
    },
  },
  ar: {
    title: 'توزيع الأحمال',
    description: 'أعباء العمل ومقاييس الإنجاز لأعضاء الفريق بالاسم',
    states: {
      loading: 'جارٍ تحميل أداء الفريق',
      empty: 'لا يتوفر أعضاء فريق ضمن هذا النطاق',
      error: 'تعذّر تحميل أداء الفريق',
      unavailable: 'بعض المقاييس غير متاحة لأن عقد مصدرها غير مكتمل.',
    },
    actions: {
      retry: 'إعادة المحاولة',
      viewReports: 'عرض التقارير',
      showBreakdown: (name) => `عرض تفاصيل عبء عمل ${name}`,
      hideBreakdown: (name) => `إخفاء تفاصيل عبء عمل ${name}`,
    },
    scope: {
      label: 'النطاق',
      memberCount: (count) => `${count} أعضاء`,
      modes: { org: 'الهيكل التنظيمي', self: 'أعمالي', tenant: 'المستأجر', unscoped: 'غير مقيّد تنظيميًا' },
      no_org_role: 'لم يُضبط دور تنظيمي للمدير القانوني — تُعرض أرقام الإدارة كاملة.',
      roster_not_configured: 'لم تُضبط قائمة الهيكل التنظيمي — تُعرض أرقام الإدارة كاملة.',
      roster_stale: (days) => `قد تكون قائمة الهيكل التنظيمي قديمة (${days} يومًا).`,
    },
    period: {
      label: (from, to) => `من ${from} إلى ${to}`,
      asOfNow: 'عبء العمل النشط والتوزيع محسوبان حتى الآن.',
      tenant: 'تقويم المستأجر',
      fallback_utc: 'تقويم UTC الاحتياطي',
      workingDays: (days) => `${days} يوم عمل`,
    },
    columns: {
      member: 'عضو الفريق',
      activeWorkload: 'عبء العمل النشط',
      loadIndexPct: 'وسيط الفريق',
      utilisationPct: 'الاستفادة',
      completionRatePct: 'الإنجاز',
      onTimePct: 'في الموعد',
      medianCycleDays: 'وسيط الدورة',
      approvalLatencyHrs: 'زمن الاعتماد',
      obligationDischargePct: 'تنفيذ الالتزامات',
      overdueCount: 'المتأخر',
      idleAssignmentPct: 'الإسناد الخامل',
    },
    anchors: {
      completionRatePct: 'المحلول خلال الفترة / المحلول + المفتوح في نهاية الفترة',
      obligationDischargePct: 'المستحق خلال الفترة / المنفّذ في موعده',
    },
    identity: { inactive: 'غير نشط', unverified: 'هوية غير متحقق منها', unknown: 'هوية غير معروفة' },
    values: {
      days: (value) => `${value} يومًا`,
      hours: (value) => `${value} ساعة`,
      linked: (value) => `+${value} عبر سجلات مرتبطة`,
      unavailable: 'غير متاح',
      open: 'مفتوح',
      resolved: 'مغلق',
      noBreakdown: 'لا يوجد نشاط منسوب إلى مجال قانوني خلال هذه الفترة.',
    },
    coverage: {
      summary: (attributed, total, percent) => `أُسنِد ${attributed} من أصل ${total} عنصرًا (${percent})`,
      truncated: (count) => `لا يظهر ${count} صفوف إضافية`,
    },
    degraded: {
      title: 'بيانات جزئية',
      forbidden: (domain) => `${domain}: لا تملك صلاحية عرض هذا المجال.`,
      query_error: (domain) => `${domain}: تعذّر الاستعلام عن هذا المجال.`,
    },
    domains: {
      contracts: 'العقود', matters: 'المسائل', obligations: 'الالتزامات',
      consultations: 'الاستشارات', cases: 'القضايا', contract_intakes: 'طلبات مراجعة العقود',
      requests: 'الطلبات', support: 'دعم الزملاء', unknown: 'مجال قانوني آخر',
    },
    reasons: {
      calendar_unavailable: 'تقويم تقارير المستأجر غير متاح.',
      no_capacity_source: 'لم يُضبط مصدر للسعة.',
      no_capacity_configured: 'السعة المضبوطة لهذا الشخص تساوي صفرًا.',
      capacity_formula_undefined: 'لم تُعرّف معادلة تحويل السعة إلى نسبة استفادة.',
      no_completion_sample: 'لا تتوفر عينة إنجاز لهذه الفترة.',
      no_period_activity: 'لا يتوفر نشاط محلول أو مفتوح في نهاية هذه الفترة.',
      terminal_timestamp_unavailable: 'لا يتوفر طابع زمني موثوق للحالة النهائية.',
      historical_state_unavailable: 'لا تتوفر حالة تاريخية موثوقة عند حدود الفترة.',
      aggregation_not_implemented: 'التجميع المطلوب غير منفذ.',
      workflow_attribution_undefined: 'إسناد سير العمل غير معرّف.',
      no_close_timestamp: 'لا يتوفر وقت إغلاق موثوق.',
      no_obligation_sample: 'لا تتوفر عينة التزامات لهذه الفترة.',
      no_obligations_due_in_period: 'لم تستحق أي التزامات خلال هذه الفترة.',
      no_cycle_sample: 'لا تتوفر عينة أعمال مكتملة لقياس مدة الدورة.',
      query_error: 'تعذّر الاستعلام عن المصدر.',
      no_population: 'لا تتوفر مجموعة فريق.',
      no_active_workload: 'لا يوجد عبء عمل نشط.',
      aggregation_contract_undefined: 'عقد التجميع غير معرّف.',
      scope_not_permitted: 'هذا المقياس على مستوى المستأجر غير متاح ضمن النطاق الشخصي.',
      domain_not_requested: 'لم يُطلب هذا المجال.',
      no_team_median: 'لا يتوفر وسيط فريق غير صفري.',
      window_event_undefined: 'لم يُعرّف حدث التقرير لهذا المقياس المرتبط بفترة زمنية.',
      partial_data: 'هذا المقياس غير مكتمل بسبب تعذّر مصدر واحد أو أكثر من مصادر المجالات.',
      no_assignee_column: 'لا يحتوي هذا المجال على عمود إسناد.',
      assignee_encrypted: 'لا يمكن تجميع مصدر الإسناد.',
      partial: 'لا تتوفر إلا تغطية جزئية للمجال.',
      forbidden: 'لا تملك صلاحية عرض هذا المصدر.',
      unknown: 'هذا المقياس غير متاح.',
    },
  },
};

registerMessages('lex.workforce', messages);

export function useWorkforceLabels() {
  const labels = useBilingual(messages);
  return useMemo(() => ({
    ...labels,
    reason(metric: WorkforceMetricValue): string {
      return labels.reasons[metric.reason ?? 'unknown'] ?? labels.reasons.unknown;
    },
    domain(key: string): string {
      return labels.domains[key] ?? labels.domains.unknown;
    },
  }), [labels]);
}

export function resolveWorkforceLabels(locale: AppLocale = 'en'): WorkforceMessages {
  return messages[locale === 'ar' ? 'ar' : 'en'];
}
