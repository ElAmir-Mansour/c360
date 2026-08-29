'use client';

/**
 * Bilingual strings (EN + professional MSA) for the per-role Lex landing
 * dashboards. Every displayed label resolves here so the lex-i18n gate stays
 * clean (no raw tokens, no untranslated ar labels). `t(key, {name})`
 * interpolates the greeting name.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

type Dict = Record<string, string>;

const EN: Dict = {
  // Role eyebrows
  'role.legal-requester': 'Legal Requester',
  'role.legal-dept-manager': 'Legal Dept Manager',
  'role.legal-bu-ceo': 'Business Unit CEO',
  'role.legal-ceo': 'Chief Executive',
  'role.legal-director': 'Legal Director',
  'role.legal-cases-manager': 'Cases Manager',
  'role.legal-contracts-manager': 'Contracts Manager',
  'role.legal-case-supervisor': 'Case Supervisor',
  'role.legal-contracts-supervisor': 'Contracts Supervisor',
  'role.legal-officer': 'Legal Officer',
  'role.legal-advisor': 'Legal Advisor',
  'role.legal-shared-services-manager': 'Shared Services Manager',
  'role.legal-auditor': 'Legal Auditor',
  'role.legal-system-admin': 'System Administrator',
  'role.generic': 'Legal Affairs',
  // Subtitles
  'subtitle.manager': 'Monitor legal ticket flow, team resolution rates, and compliance trends',
  'subtitle.requester': 'Track your requests and their progress across the legal desk',
  'subtitle.executive': 'A portfolio-level view of approvals, contracts, and compliance',
  'subtitle.director': 'Command view across matters, contracts, litigation, and compliance',
  'subtitle.cases': 'Litigation, investigations, and settlements at a glance',
  'subtitle.contracts': 'Contract lifecycle, renewals, and obligation health',
  'subtitle.officer': 'Your assigned matters and what needs action today',
  'subtitle.advisor': 'Consultations and advisory work across the department',
  'subtitle.oversight': 'Cross-team service levels, approvals, and obligations',
  'subtitle.auditor': 'Compliance posture, alerts, and control health',
  'subtitle.admin': 'Platform-wide legal activity and operational health',
  'subtitle.generic': 'Your legal affairs overview',
  // Panels
  'panel.recentRequests': 'Recent Service Requests Received',
  'panel.myWork': 'My Open Work',
  'panel.pendingDecisions': 'Pending My Decision',
  'panel.escalations': 'Escalation & Risk Warnings',
  'panel.distribution': 'Service Request Distribution',
  'panel.workload': 'Open Items by Area',
  'panel.contractMix': 'Contracts by Status',
  'panel.resolutionRates': 'Legal Teams Resolution Rate',
  'panel.teamPerformance': 'Team Performance',
  'panel.managerTasks': 'Task Management',
  'panel.domains': 'Legal Domains',
  // Resolution-rate categories (bar categories)
  'cat.contracts': 'Contracts',
  'cat.litigation': 'Litigation',
  'cat.advisory': 'Advisory',
  'cat.requests': 'Requests',
  // KPI labels
  'kpi.totalRequests': 'Total Requests',
  'kpi.pendingRequests': 'Pending Requests',
  'kpi.slaCompliance': 'SLA Compliance',
  'kpi.activeLitigations': 'Active Litigations',
  'kpi.contractsUnderReview': 'Contracts Under Review',
  'kpi.activeContracts': 'Active Contracts',
  'kpi.openMatters': 'Open Matters',
  'kpi.overdueObligations': 'Overdue Obligations',
  'kpi.pendingApprovals': 'Pending Approvals',
  'kpi.slaBreaches': 'SLA Breaches',
  'kpi.openAlerts': 'Open Alerts',
  'kpi.complianceScore': 'Compliance Score',
  'kpi.consultations': 'Consultations',
  'kpi.investigations': 'Investigations',
  'kpi.settlements': 'Settlements',
  'kpi.expiringContracts': 'Expiring in 30 Days',
  'kpi.highRiskContracts': 'High-Risk Contracts',
  'kpi.myOpenItems': 'My Open Items',
  // Captions
  'caption.actionRequired': 'Action required',
  'caption.allClear': 'All clear',
  'caption.onTarget': 'On target',
  'caption.needsAttention': 'Needs attention',
  'caption.tracking': 'Tracking',
  // Contextual captions (real data)
  'cap.hearingsScheduled': '{n} hearings scheduled',
  // Distribution slices
  'dist.contracts': 'Contracts',
  'dist.consultations': 'Consultations',
  'dist.litigations': 'Litigations',
  'dist.others': 'Others',
  // Workload areas
  'area.sla': 'SLA',
  'area.obligations': 'Obligations',
  'area.approvals': 'Approvals',
  'area.renewals': 'Renewals',
  'area.hearings': 'Hearings',
  'area.alerts': 'Alerts',
  // Severity levels (Escalation & Risk Warnings chart)
  'sev.critical': 'Critical',
  'sev.high': 'High',
  'sev.medium': 'Medium',
  'sev.low': 'Low',
  'sev.info': 'Info',
  'ui.warnings': 'warnings',
  // Contract statuses (bar categories)
  'cstatus.draft': 'Draft',
  'cstatus.internal_review': 'Internal Review',
  'cstatus.legal_review': 'Legal Review',
  'cstatus.negotiation': 'Negotiation',
  'cstatus.pending_signature': 'Pending Signature',
  'cstatus.active': 'Active',
  'cstatus.expired': 'Expired',
  'cstatus.terminated': 'Terminated',
  'cstatus.renewed': 'Renewed',
  'cstatus.suspended': 'Suspended',
  // UI chrome
  'ui.welcome': 'Welcome, {name}',
  'ui.exportReports': 'Export Reports',
  'ui.viewAll': 'View all',
  'ui.total': 'Total',
  // Empty states
  'empty.requests': 'No recent requests.',
  'empty.escalations': 'No escalations — everything is on track.',
  'empty.myWork': 'You have no open work.',
  'empty.distribution': 'No distribution data yet.',
  'empty.workload': 'No open items.',
  'empty.resolutionRates': 'No resolution data yet.',
};

const AR: Dict = {
  'role.legal-requester': 'مُقدّم الطلب القانوني',
  'role.legal-dept-manager': 'مدير الإدارة القانونية',
  'role.legal-bu-ceo': 'الرئيس التنفيذي لوحدة الأعمال',
  'role.legal-ceo': 'الرئيس التنفيذي',
  'role.legal-director': 'المدير القانوني',
  'role.legal-cases-manager': 'مدير القضايا',
  'role.legal-contracts-manager': 'مدير العقود',
  'role.legal-case-supervisor': 'مشرف القضايا',
  'role.legal-contracts-supervisor': 'مشرف العقود',
  'role.legal-officer': 'الموظف القانوني',
  'role.legal-advisor': 'المستشار القانوني',
  'role.legal-shared-services-manager': 'مدير الخدمات المشتركة',
  'role.legal-auditor': 'المدقق القانوني',
  'role.legal-system-admin': 'مسؤول النظام',
  'role.generic': 'الشؤون القانونية',
  'subtitle.manager': 'تابع تدفّق الطلبات القانونية ومعدلات إنجاز الفرق واتجاهات الامتثال',
  'subtitle.requester': 'تابع طلباتك وسير عملها عبر المكتب القانوني',
  'subtitle.executive': 'نظرة تنفيذية على الاعتمادات والعقود والامتثال',
  'subtitle.director': 'نظرة قيادية على القضايا والعقود والتقاضي والامتثال',
  'subtitle.cases': 'التقاضي والتحقيقات والتسويات في لمحة',
  'subtitle.contracts': 'دورة حياة العقود والتجديدات وسلامة الالتزامات',
  'subtitle.officer': 'قضاياك المُسندة وما يتطلب إجراءً اليوم',
  'subtitle.advisor': 'الاستشارات والأعمال الاستشارية عبر الإدارة',
  'subtitle.oversight': 'مستويات الخدمة والاعتمادات والالتزامات عبر الفرق',
  'subtitle.auditor': 'وضع الامتثال والتنبيهات وسلامة الضوابط',
  'subtitle.admin': 'النشاط القانوني وسلامة التشغيل على مستوى المنصة',
  'subtitle.generic': 'نظرة عامة على شؤونك القانونية',
  'panel.recentRequests': 'أحدث طلبات الخدمة الواردة',
  'panel.myWork': 'أعمالي المفتوحة',
  'panel.pendingDecisions': 'بانتظار قراري',
  'panel.escalations': 'تنبيهات التصعيد والمخاطر',
  'panel.distribution': 'توزيع طلبات الخدمة',
  'panel.workload': 'العناصر المفتوحة حسب المجال',
  'panel.contractMix': 'العقود حسب الحالة',
  'panel.resolutionRates': 'معدل إنجاز الفرق القانونية',
  'panel.teamPerformance': 'أداء الفريق',
  'panel.managerTasks': 'إدارة المهام',
  'panel.domains': 'المجالات القانونية',
  'cat.contracts': 'العقود',
  'cat.litigation': 'التقاضي',
  'cat.advisory': 'الاستشارات',
  'cat.requests': 'الطلبات',
  'kpi.totalRequests': 'إجمالي الطلبات',
  'kpi.pendingRequests': 'الطلبات المعلّقة',
  'kpi.slaCompliance': 'الالتزام باتفاقية الخدمة',
  'kpi.activeLitigations': 'القضايا النشطة',
  'kpi.contractsUnderReview': 'العقود قيد المراجعة',
  'kpi.activeContracts': 'العقود النشطة',
  'kpi.openMatters': 'الملفات المفتوحة',
  'kpi.overdueObligations': 'الالتزامات المتأخرة',
  'kpi.pendingApprovals': 'الاعتمادات المعلّقة',
  'kpi.slaBreaches': 'خروقات اتفاقية الخدمة',
  'kpi.openAlerts': 'التنبيهات المفتوحة',
  'kpi.complianceScore': 'درجة الامتثال',
  'kpi.consultations': 'الاستشارات',
  'kpi.investigations': 'التحقيقات',
  'kpi.settlements': 'التسويات',
  'kpi.expiringContracts': 'تنتهي خلال ٣٠ يومًا',
  'kpi.highRiskContracts': 'عقود عالية المخاطر',
  'kpi.myOpenItems': 'عناصري المفتوحة',
  'caption.actionRequired': 'يتطلب إجراءً',
  'caption.allClear': 'لا يوجد ما يستدعي',
  'caption.onTarget': 'ضمن المستهدف',
  'caption.needsAttention': 'يحتاج إلى متابعة',
  'caption.tracking': 'قيد المتابعة',
  'cap.hearingsScheduled': '{n} جلسة مجدولة',
  'dist.contracts': 'العقود',
  'dist.consultations': 'الاستشارات',
  'dist.litigations': 'القضايا',
  'dist.others': 'أخرى',
  'area.sla': 'اتفاقية الخدمة',
  'area.obligations': 'الالتزامات',
  'area.approvals': 'الاعتمادات',
  'area.renewals': 'التجديدات',
  'area.hearings': 'الجلسات',
  'area.alerts': 'التنبيهات',
  // Severity levels (Escalation & Risk Warnings chart)
  'sev.critical': 'حرجة',
  'sev.high': 'عالية',
  'sev.medium': 'متوسطة',
  'sev.low': 'منخفضة',
  'sev.info': 'معلومات',
  'ui.warnings': 'تنبيه',
  'cstatus.draft': 'مسودة',
  'cstatus.internal_review': 'مراجعة داخلية',
  'cstatus.legal_review': 'مراجعة قانونية',
  'cstatus.negotiation': 'تفاوض',
  'cstatus.pending_signature': 'بانتظار التوقيع',
  'cstatus.active': 'نشط',
  'cstatus.expired': 'منتهٍ',
  'cstatus.terminated': 'مُنهى',
  'cstatus.renewed': 'مُجدَّد',
  'cstatus.suspended': 'موقوف',
  'ui.welcome': 'مرحبًا، {name}',
  'ui.exportReports': 'تصدير التقارير',
  'ui.viewAll': 'عرض الكل',
  'ui.total': 'الإجمالي',
  'empty.requests': 'لا توجد طلبات حديثة.',
  'empty.escalations': 'لا توجد تصعيدات — كل شيء ضمن المسار.',
  'empty.myWork': 'لا توجد لديك أعمال مفتوحة.',
  'empty.distribution': 'لا تتوفر بيانات توزيع بعد.',
  'empty.workload': 'لا توجد عناصر مفتوحة.',
  'empty.resolutionRates': 'لا تتوفر بيانات إنجاز بعد.',
};

/** Exported for exact EN/AR key-parity regression coverage. */
export const ROLE_DASHBOARD_DICTIONARIES = { en: EN, ar: AR } as const;

export type RoleDashboardT = (key: string, vars?: Record<string, string>) => string;

export function useRoleDashboardStrings(): { t: RoleDashboardT; locale: 'en' | 'ar' } {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => {
    const dict = locale === 'ar'
      ? ROLE_DASHBOARD_DICTIONARIES.ar
      : ROLE_DASHBOARD_DICTIONARIES.en;
    const t: RoleDashboardT = (key, vars) => {
      let s = dict[key] ?? EN[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
      }
      return s;
    };
    return { t, locale: locale === 'ar' ? 'ar' : 'en' };
  }, [locale]);
}

/** Humanized label for a contract-status bar category (localized, safe fallback). */
export function contractStatusLabel(t: RoleDashboardT, status: string): string {
  const key = `cstatus.${status}`;
  const resolved = t(key);
  if (resolved !== key) return resolved;
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
