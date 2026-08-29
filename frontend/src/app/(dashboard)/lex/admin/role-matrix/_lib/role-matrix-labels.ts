/**
 * Bilingual (English + Modern Standard Arabic) labels for the read-only Legal
 * Role Matrix view (`/lex/admin/role-matrix`).
 *
 * Follows the canonical lex bilingual contract VERBATIM (see
 * `../../../_lib/lex-i18n.ts`): a `LexBilingual<T> = { en, ar }` bundle with two
 * FULL same-shaped copies; the JSX only ever touches the resolved `T` from the
 * memoized hook. Role names carry their own AR/EN in `legal-role-matrix.ts`
 * (the roster); this file holds the chrome (page header, legend, column/domain
 * headers, summary, drift banner).
 *
 * Glossary: role = دور, permission = صلاحية, capability = قدرة, matrix = مصفوفة,
 * authority = صلاحية, escalation = تصعيد, separation of duties = فصل المهام.
 */
'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';
import type { MatrixVerb, RoleTier } from './legal-role-matrix';

/** Domain ids the matrix grid renders one row per (mirrors MATRIX_DOMAINS). */
export type MatrixDomainId =
  | 'request'
  | 'case'
  | 'investigation'
  | 'settlement'
  | 'contract'
  | 'consultation'
  | 'document'
  | 'report'
  | 'notification'
  | 'sla'
  | 'escalation'
  | 'catalog'
  | 'role'
  | 'audit'
  | 'integration'
  | 'security';

export interface RoleMatrixLabels {
  pageTitle: string;
  pageDescription: string;
  eyebrow: string;
  readOnlyBadge: string;
  /** Legend section. */
  legendTitle: string;
  legendNoAccess: string;
  verbName: Record<MatrixVerb, string>;
  verbMeaning: Record<MatrixVerb, string>;
  /** Column-header chrome. */
  capabilityColumn: string;
  brdColumn: string;
  /** Domain (capability-family) row labels — the grid's row axis. */
  domainName: Record<MatrixDomainId, string>;
  /** Restricted-verb tooltip fragments (assign / distribute). */
  restricted: { assign: string; distribute: string; label: string };
  /** Source-of-truth + runtime drift banner copy. */
  sourceNote: string;
  driftSyncedLabel: string;
  driftDetectedLabel: (n: number) => string;
  driftExtra: (slug: string, keys: string) => string;
  driftMissing: (slug: string, keys: string) => string;
  driftUnseeded: string;
  /** Tier band names (column groups). */
  tier: Record<RoleTier, string>;
  /** Roster column tooltips. */
  reportsTo: string;
  unit: string;
  escalation: string;
  /** Per-role coverage summary. */
  coverageTitle: string;
  coverageOf: (granted: number, total: number) => string;
  rolesCount: (n: number) => string;
  capabilitiesCount: (n: number) => string;
  /** Footnote / SoD principles. */
  principlesTitle: string;
  principleLeastPrivilege: string;
  principleSoD: string;
  principleAuditor: string;
  /** Accessible cell description for screen readers. */
  cellAria: (role: string, capability: string, verbs: string) => string;
  noAccessAria: (role: string, capability: string) => string;
}

const bundle: LexBilingual<RoleMatrixLabels> = {
  en: {
    pageTitle: 'Legal Role Matrix',
    pageDescription:
      'The 14 legal roles mapped to every system capability with granular View / Add / Edit / Approve / Close / Manage rights — least-privilege and separation-of-duties enforced server-side.',
    eyebrow: 'Legal Suite · Access Control',
    readOnlyBadge: 'Read-only',
    legendTitle: 'Permission legend',
    legendNoAccess: 'No access',
    verbName: {
      M: 'Manage',
      P: 'Approve',
      C: 'Close',
      E: 'Edit',
      A: 'Add',
      V: 'View',
    },
    verbMeaning: {
      M: 'Manage / configure — create, modify or remove the configuration itself (catalog, calendar, roles, security).',
      P: 'Approve / sign-off — authorise or reject an item; the decisive control point in a workflow.',
      C: 'Close / finalise — close, settle or finalise a request, case or matter.',
      E: 'Edit / update — modify existing records, act on items, advance the workflow.',
      A: 'Add / create — create new records, submit, upload or initiate.',
      V: 'View / read — read-only visibility (often scoped to own department or matter).',
    },
    capabilityColumn: 'Capability domain',
    brdColumn: 'Key',
    domainName: {
      request: 'Requests & intake',
      case: 'Cases',
      investigation: 'Investigations',
      settlement: 'Settlements / ADR',
      contract: 'Contracts',
      consultation: 'Consultations',
      document: 'Documents & attachments',
      report: 'Reports & KPIs',
      notification: 'Notifications',
      sla: 'SLA & working calendar',
      escalation: 'Escalation matrix',
      catalog: 'Service catalog',
      role: 'Users, roles & permissions',
      audit: 'Audit log',
      integration: 'Integrations',
      security: 'Security & data governance',
    },
    restricted: {
      assign: 'case assignment',
      distribute: 'contract distribution',
      label: 'Restricted verb',
    },
    sourceNote:
      'Rendered from the same seeded role permission sets the server enforces — drift between the doc and the live tenant is shown below.',
    driftSyncedLabel: 'In sync with the live tenant',
    driftDetectedLabel: (n) => `${n} role${n === 1 ? '' : 's'} drift from the live tenant`,
    driftExtra: (slug, keys) => `${slug} has extra keys: ${keys}`,
    driftMissing: (slug, keys) => `${slug} is missing keys: ${keys}`,
    driftUnseeded: 'Legal roles not yet seeded for this tenant — showing the canonical model.',
    tier: {
      Business: 'Business',
      Legal: 'Legal',
      Oversight: 'Oversight',
      Admin: 'Admin',
    },
    reportsTo: 'Reports to',
    unit: 'Unit / Section',
    escalation: 'Escalation',
    coverageTitle: 'Role coverage',
    coverageOf: (granted, total) => `${granted} of ${total} capabilities`,
    rolesCount: (n) => `${n} roles`,
    capabilitiesCount: (n) => `${n} capabilities`,
    principlesTitle: 'Applied principles',
    principleLeastPrivilege:
      'Least privilege — each role gets only the rights its job requires; defaults to no access.',
    principleSoD:
      'Separation of duties — initiator ≠ approver. Officers draft; supervisors and managers approve and close.',
    principleAuditor:
      'Auditability — the Auditor role is read-only and cannot alter records (CAP-155 / 181).',
    cellAria: (role, capability, verbs) => `${role} — ${capability}: ${verbs}`,
    noAccessAria: (role, capability) => `${role} — ${capability}: no access`,
  },
  ar: {
    pageTitle: 'مصفوفة الأدوار القانونية',
    pageDescription:
      'الأدوار القانونية الأربعة عشر مرتبطة بكل قدرة في النظام بصلاحيات دقيقة: عرض / إضافة / تعديل / اعتماد / إغلاق / إدارة — مع تطبيق مبدأ أقل الصلاحيات وفصل المهام على مستوى الخادم.',
    eyebrow: 'المجموعة القانونية · التحكم بالوصول',
    readOnlyBadge: 'للقراءة فقط',
    legendTitle: 'دليل الصلاحيات',
    legendNoAccess: 'لا وصول',
    verbName: {
      M: 'إدارة',
      P: 'اعتماد',
      C: 'إغلاق',
      E: 'تعديل',
      A: 'إضافة',
      V: 'عرض',
    },
    verbMeaning: {
      M: 'إدارة / تهيئة — إنشاء أو تعديل أو إزالة التهيئة نفسها (الكتالوج، التقويم، الأدوار، الأمن).',
      P: 'اعتماد / توقيع — إجازة عنصر أو رفضه؛ نقطة التحكم الحاسمة في سير العمل.',
      C: 'إغلاق / إنهاء — إغلاق أو تسوية أو إنهاء طلب أو قضية أو مسألة.',
      E: 'تعديل / تحديث — تعديل السجلات القائمة والعمل على العناصر ودفع سير العمل.',
      A: 'إضافة / إنشاء — إنشاء سجلات جديدة أو التقديم أو الرفع أو البدء.',
      V: 'عرض / قراءة — رؤية للقراءة فقط (غالبًا ضمن نطاق الإدارة أو المسألة الخاصة).',
    },
    capabilityColumn: 'مجال القدرة',
    brdColumn: 'المفتاح',
    domainName: {
      request: 'الطلبات والاستقبال',
      case: 'القضايا',
      investigation: 'التحقيقات',
      settlement: 'التسويات / الحلول البديلة',
      contract: 'العقود',
      consultation: 'الاستشارات',
      document: 'الوثائق والمرفقات',
      report: 'التقارير والمؤشرات',
      notification: 'الإشعارات',
      sla: 'مستوى الخدمة وتقويم العمل',
      escalation: 'مصفوفة التصعيد',
      catalog: 'كتالوج الخدمات',
      role: 'المستخدمون والأدوار والصلاحيات',
      audit: 'سجل التدقيق',
      integration: 'التكاملات',
      security: 'الأمن وحوكمة البيانات',
    },
    restricted: {
      assign: 'إسناد القضايا',
      distribute: 'توزيع العقود',
      label: 'صلاحية مقيّدة',
    },
    sourceNote:
      'يُعرض من مجموعات صلاحيات الأدوار المُهيّأة نفسها التي يطبّقها الخادم — ويظهر أدناه أي اختلاف بين التوثيق والمستأجر الفعلي.',
    driftSyncedLabel: 'متوافق مع المستأجر الفعلي',
    driftDetectedLabel: (n) => `${n} دور يختلف عن المستأجر الفعلي`,
    driftExtra: (slug, keys) => `${slug} يحمل مفاتيح إضافية: ${keys}`,
    driftMissing: (slug, keys) => `${slug} تنقصه مفاتيح: ${keys}`,
    driftUnseeded: 'لم تُهيَّأ الأدوار القانونية لهذا المستأجر بعد — يُعرض النموذج المرجعي.',
    tier: {
      Business: 'الأعمال',
      Legal: 'القانوني',
      Oversight: 'الإشراف',
      Admin: 'الإدارة',
    },
    reportsTo: 'يرفع إلى',
    unit: 'الوحدة / القسم',
    escalation: 'التصعيد',
    coverageTitle: 'تغطية الدور',
    coverageOf: (granted, total) => `${granted} من ${total} قدرة`,
    rolesCount: (n) => `${n} أدوار`,
    capabilitiesCount: (n) => `${n} قدرة`,
    principlesTitle: 'المبادئ المطبَّقة',
    principleLeastPrivilege:
      'أقل الصلاحيات — يُمنح كل دور ما يلزم عمله فقط، والافتراضي عدم الوصول.',
    principleSoD:
      'فصل المهام — المُنشئ ≠ المُعتمِد. يحرّر الموظفون، ويعتمد المشرفون والمديرون ويغلقون.',
    principleAuditor:
      'قابلية التدقيق — دور المدقق للقراءة فقط ولا يمكنه تعديل السجلات (CAP-155 / 181).',
    cellAria: (role, capability, verbs) => `${role} — ${capability}: ${verbs}`,
    noAccessAria: (role, capability) => `${role} — ${capability}: لا وصول`,
  },
};

export function useRoleMatrixLabels(): RoleMatrixLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(bundle, locale), [locale]);
}
