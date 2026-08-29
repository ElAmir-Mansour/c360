/**
 * §13 Admin Hub Redesign — the permission-filtered card model.
 *
 * Each card declares a `view` permission and a `manage` permission (the §13
 * table). The page derives one of three states per card from the caller's
 * effective permissions:
 *   - HIDDEN     — holds neither view nor manage → not rendered.
 *   - READ_ONLY  — holds view (or wildcard read) but not manage.
 *   - MANAGEABLE — holds manage.
 *
 * View/manage are evaluated with the SAME wildcard resolver (`canAccess` /
 * `hasPermission`) used everywhere else; the backend remains authoritative.
 *
 * Card copy is bilingual and self-contained here (this file is scoped to the
 * admin hub) so the hub can show the shipped §13 surfaces without depending on the
 * shared 8-card admin-labels bundle.
 */

import {
  CalendarDays,
  FileStack,
  GitBranch,
  Landmark,
  Layers,
  Lock,
  Network,
  Plug,
  ScrollText,
  ShieldCheck,
  Timer,
  Grid3x3,
  Bell,
  GitFork,
  type LucideIcon,
} from 'lucide-react';
import { canAccessWith, type PermissionRequirement } from '@/lib/permissions';

export type AdminCardState = 'HIDDEN' | 'READ_ONLY' | 'MANAGEABLE';

/**
 * Resolve a card's §13 state from the caller's permission predicate.
 *   - MANAGEABLE when the manage permission is held,
 *   - READ_ONLY when only the view permission is held,
 *   - HIDDEN when neither is held.
 *
 * Note manage is checked FIRST so a System Administrator (who holds the
 * `:manage` key but NOT the `:view` key) is correctly MANAGEABLE rather than
 * HIDDEN — see backend/internal/auth/legal_roles.go (admin has manage-only).
 */
export function resolveCardState(
  hasPermission: (permission: string) => boolean,
  card: { view: PermissionRequirement; manage: PermissionRequirement },
): AdminCardState {
  if (canAccessWith(hasPermission, card.manage)) return 'MANAGEABLE';
  if (canAccessWith(hasPermission, card.view)) return 'READ_ONLY';
  return 'HIDDEN';
}

export interface AdminHubCardLabel {
  title: string;
  description: string;
}

export interface AdminHubCardDef {
  /** Stable id; also the i18n leaf into the bilingual bundle below. */
  id: string;
  href: string;
  icon: LucideIcon;
  /** kpi-theme key used for the gradient icon badge + accent. */
  theme: string;
  /** §13 view permission (controls READ_ONLY visibility). */
  view: PermissionRequirement;
  /** §13 manage permission (controls MANAGEABLE state). */
  manage: PermissionRequirement;
}

/**
 * The shipped admin-hub cards, in display order: the 11 §13 surfaces plus the
 * two net-new admin surfaces that had no discoverability entry — Legal Holds
 * (FR-WATHEEQ-005) and Contract Approval-Policy Governance (+ its templates
 * sub-page). Each still resolves to a shipped page under /lex/admin.
 */
export const ADMIN_HUB_CARDS: AdminHubCardDef[] = [
  {
    id: 'workingCalendars',
    href: '/lex/admin/working-calendars',
    icon: CalendarDays,
    theme: 'primary',
    view: 'lex:catalog:view',
    manage: 'lex:catalog:manage',
  },
  {
    id: 'serviceCatalog',
    href: '/lex/admin/service-catalog',
    icon: Layers,
    theme: 'emerald',
    view: 'lex:catalog:view',
    manage: 'lex:catalog:manage',
  },
  {
    id: 'slaTargets',
    href: '/lex/admin/sla-targets',
    icon: Timer,
    theme: 'amber',
    view: 'lex:sla:view',
    manage: 'lex:sla:manage',
  },
  {
    id: 'escalations',
    href: '/lex/admin/escalations',
    icon: GitFork,
    theme: 'primary',
    view: 'lex:escalation:view',
    manage: 'lex:escalation:manage',
  },
  {
    id: 'attachmentPolicies',
    href: '/lex/admin/attachment-policies',
    icon: FileStack,
    theme: 'primary',
    view: 'lex:catalog:view',
    manage: 'lex:catalog:manage',
  },
  {
    id: 'orgEntities',
    href: '/lex/admin/org-entities',
    icon: Network,
    theme: 'rose',
    view: 'lex:security:view',
    manage: 'lex:security:manage',
  },
  {
    id: 'classifications',
    href: '/lex/admin/classifications',
    icon: GitBranch,
    theme: 'teal',
    view: 'lex:catalog:view',
    manage: 'lex:catalog:manage',
  },
  {
    // Competent-court reference list. Same catalogue tier as its siblings. It is
    // the only route by which the (deliberately unseeded) court dropdown on the
    // case form ever becomes populated, so it needs a discoverability entry.
    id: 'courts',
    href: '/lex/admin/courts',
    icon: Landmark,
    theme: 'cyan',
    view: 'lex:catalog:view',
    manage: 'lex:catalog:manage',
  },
  {
    // FR-WATHEEQ-005 Legal Holds register. The page self-gates on the coarse
    // backend list/mutate tiers (view lex:read, apply/release lex:write —
    // handler/routes.go), so the card mirrors those exact keys.
    id: 'legalHolds',
    href: '/lex/admin/legal-holds',
    icon: Lock,
    theme: 'rose',
    view: 'lex:read',
    manage: 'lex:write',
  },
  {
    id: 'approvalPolicies',
    href: '/lex/admin/request-approval-policies',
    icon: ShieldCheck,
    theme: 'primary',
    view: 'lex:approval:read',
    manage: 'lex:approval:admin',
  },
  {
    // Contract approval-policy GOVERNANCE (version history, audit trail,
    // conflict-check, reusable templates). Same granular approval tier as the
    // request-policy sibling: view lex:approval:read, restore lex:approval:admin.
    id: 'contractApprovalPolicies',
    href: '/lex/admin/contract-approval-policies',
    icon: ScrollText,
    theme: 'primary',
    view: 'lex:approval:read',
    manage: 'lex:approval:admin',
  },
  {
    id: 'integrations',
    href: '/lex/admin/integrations',
    icon: Plug,
    theme: 'primary',
    view: 'lex:integration:read',
    manage: 'lex:integration:manage',
  },
  {
    id: 'roleMatrix',
    href: '/lex/admin/role-matrix',
    icon: Grid3x3,
    theme: 'rose',
    view: 'lex:role:view',
    manage: 'lex:role:manage',
  },
  // §13 also lists "Role Assignments" (/lex/admin/role-assignments) and
  // "Security" (/lex/admin/security) — neither page nor backend surface exists
  // yet, so the cards are withheld until they ship: a permission-gated card
  // whose href 404s is worse than an absent card. Re-add here when the pages
  // land (the LEX_ROUTE_PERMISSIONS entries are already reserved).
  {
    id: 'notificationRules',
    // §13's own route table maps Notifications to /lex/notifications (the page
    // that hosts inbox + notification preferences/subscription rules); the
    // previous /lex/admin/notifications href pointed at a page that never
    // existed and 404'd every permitted admin.
    href: '/lex/notifications',
    icon: Bell,
    theme: 'amber',
    view: 'lex:notification:view',
    manage: 'lex:notification:manage',
  },
];

/* ── Bilingual card copy ──────────────────────────────────────────────────── */

export interface AdminHubLabels {
  cards: Record<string, AdminHubCardLabel>;
  state: { readOnly: string; manage: string };
  open: string;
  /** Shown when no cards are visible (e.g. an Officer persona). */
  emptyTitle: string;
  emptyBody: string;
}

const EN: AdminHubLabels = {
  cards: {
    workingCalendars: {
      title: 'Working Calendars',
      description: 'Weekly working hours, Ramadan overlay, and official holidays.',
    },
    serviceCatalog: {
      title: 'Service Catalog',
      description: 'Published legal services, eligibility, and intake channels.',
    },
    slaTargets: {
      title: 'SLA Targets',
      description: 'Turnaround and acknowledgement targets per service and priority.',
    },
    escalations: {
      title: 'Escalation Policies',
      description: 'Escalation ladders and breach triggers per service tier.',
    },
    attachmentPolicies: {
      title: 'Attachment Policies',
      description: 'Required documents and upload slots per request type.',
    },
    orgEntities: {
      title: 'Org Entities',
      description: 'Legal-org entities, escalation roles, and master data.',
    },
    classifications: {
      title: 'Classifications',
      description: 'The extensible case-classification taxonomy tree.',
    },
    courts: {
      title: 'Competent Courts',
      description: 'The court list behind the Competent Court field. Ships empty — add your own.',
    },
    legalHolds: {
      title: 'Legal Holds',
      description: 'Preservation holds on cases, contracts, documents, and consultations.',
    },
    approvalPolicies: {
      title: 'Approval Policies',
      description: 'Request approval routing, delegation of authority, and policy versions.',
    },
    contractApprovalPolicies: {
      title: 'Contract Approval Policies',
      description: 'Version history, audit trail, conflict-checks, and templates for contract approvals.',
    },
    integrations: {
      title: 'Integrations',
      description: 'Connectors, sync runs, and the integration health console.',
    },
    roleMatrix: {
      title: 'Role Matrix',
      description: 'The 14 legal roles mapped to every capability.',
    },
    notificationRules: {
      title: 'Notification Rules',
      description: 'Notification channels, templates, and routing rules.',
    },
  },
  state: { readOnly: 'View only', manage: 'Manage' },
  open: 'Open',
  emptyTitle: 'No administration tools available',
  emptyBody:
    'Your active legal role does not include any configuration permissions. Administration surfaces are reserved for system administrators and oversight roles.',
};

const AR: AdminHubLabels = {
  cards: {
    workingCalendars: {
      title: 'تقاويم العمل',
      description: 'ساعات العمل الأسبوعية وتراكب رمضان والعطلات الرسمية.',
    },
    serviceCatalog: {
      title: 'كتالوج الخدمات',
      description: 'الخدمات القانونية المنشورة والأهلية وقنوات الاستقبال.',
    },
    slaTargets: {
      title: 'أهداف اتفاقية مستوى الخدمة',
      description: 'أهداف الإنجاز والإقرار لكل خدمة وأولوية.',
    },
    escalations: {
      title: 'سياسات التصعيد',
      description: 'سلالم التصعيد ومحفزات تجاوز المدة لكل مستوى خدمة.',
    },
    attachmentPolicies: {
      title: 'سياسات المرفقات',
      description: 'المستندات المطلوبة وخانات الرفع لكل نوع طلب.',
    },
    orgEntities: {
      title: 'الجهات التنظيمية',
      description: 'الجهات التنظيمية القانونية وأدوار التصعيد والبيانات الرئيسية.',
    },
    classifications: {
      title: 'التصنيفات',
      description: 'شجرة التصنيف الهرمي القابلة للتوسعة للقضايا.',
    },
    courts: {
      title: 'المحاكم المختصة',
      description: 'قائمة المحاكم خلف حقل «المحكمة المختصة». تبدأ فارغة — أضف محاكمك.',
    },
    legalHolds: {
      title: 'الحجوزات القانونية',
      description: 'حجوزات الحفظ على القضايا والعقود والمستندات والاستشارات.',
    },
    approvalPolicies: {
      title: 'سياسات الاعتماد',
      description: 'توجيه اعتماد الطلبات وتفويض الصلاحيات وإصدارات السياسات.',
    },
    contractApprovalPolicies: {
      title: 'لوائح موافقة العقود',
      description: 'سجل الإصدارات وسجل التدقيق وفحص التعارض والقوالب للوائح موافقة العقود.',
    },
    integrations: {
      title: 'التكاملات',
      description: 'الموصّلات وعمليات المزامنة ولوحة صحة التكامل.',
    },
    roleMatrix: {
      title: 'مصفوفة الأدوار',
      description: 'الأدوار القانونية الأربعة عشر مرتبطة بكل قدرة.',
    },
    notificationRules: {
      title: 'قواعد الإشعارات',
      description: 'قنوات الإشعارات والقوالب وقواعد التوجيه.',
    },
  },
  state: { readOnly: 'اطّلاع فقط', manage: 'إدارة' },
  open: 'فتح',
  emptyTitle: 'لا تتوفر أدوات إدارة',
  emptyBody:
    'دورك القانوني الحالي لا يتضمن أي صلاحيات إعداد. أسطح الإدارة محجوزة لمسؤولي النظام وأدوار الإشراف.',
};

export function getAdminHubLabels(locale: string): AdminHubLabels {
  return locale.startsWith('ar') ? AR : EN;
}
