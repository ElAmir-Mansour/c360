/**
 * Legal Role Matrix — role-roster metadata + verb vocabulary for the read-only
 * `/lex/admin/role-matrix` view.
 *
 * The roster (the 14 roles' display names, tier, reports-to, escalation slot) is
 * reconciled against `docs/ClarioWatheeq/Legal_Role_Matrix_Design.md` §3 / §5
 * and the backend `LegalAffairsRoleSeeder` (slugs match). The actual
 * capability×role GRID, however, is NO LONGER a hand-drawn cell fixture: per
 * design v2 §6 it is DERIVED from the seeded role permission sets — the same
 * data the server enforces — see `legal-role-permissions.ts`
 * (`CANONICAL_ROLE_PERMS` + `deriveDomainVerbs`) and the runtime reconciliation
 * the grid performs against `/api/v1/roles`. This file holds only what the
 * permissions cannot express on their own: the roster chrome and the
 * verb-authority ranking used to colour a derived cell.
 *
 * Verbs (matrix code → permission verb, design §2):
 *   V → view, A → add, E → edit, P → approve, C → close, M → manage.
 * A derived cell may combine verbs (e.g. `['A','E']`); colour follows the
 * HIGHEST authority present (M > P > C > E > A > V).
 */

/** A single permission verb code as it appears in the matrix cells. */
export type MatrixVerb = 'M' | 'P' | 'C' | 'E' | 'A' | 'V';

/**
 * Authority ranking (highest → lowest). Used to pick the dominant verb in a
 * combined cell so the cell colour reflects the strongest right granted.
 */
export const VERB_AUTHORITY: readonly MatrixVerb[] = ['M', 'P', 'C', 'E', 'A', 'V'];

/** Returns the highest-authority verb in a cell, or null for "no access". */
export function dominantVerb(cell: readonly MatrixVerb[]): MatrixVerb | null {
  for (const verb of VERB_AUTHORITY) {
    if (cell.includes(verb)) return verb;
  }
  return null;
}

/** The 14 role codes, in the column order used by the source matrix. */
export type RoleCode =
  | 'REQ'
  | 'DM'
  | 'BUC'
  | 'CEO'
  | 'LD'
  | 'CSM'
  | 'KSM'
  | 'CSV'
  | 'KSV'
  | 'LO'
  | 'LA'
  | 'SSM'
  | 'AUD'
  | 'ADM';

/** Org-chart tier a role belongs to (mirrors the matrix column bands). */
export type RoleTier = 'Business' | 'Legal' | 'Oversight' | 'Admin';

/**
 * Role roster entry — the seeded role metadata (design §3 / §5 + xlsx "Role
 * Roster" sheet). `slug` matches the backend seeder; `roleEn`/`roleAr` are the
 * bilingual names; `escalationLevel` is the L1/L2/L3 recipient slot where the
 * matrix assigns one.
 */
export interface RoleRosterEntry {
  code: RoleCode;
  slug: string;
  roleEn: string;
  roleAr: string;
  tier: RoleTier;
  unitEn: string;
  unitAr: string;
  reportsToEn: string;
  reportsToAr: string;
  /** Escalation recipient slot from §3.4 chain, if any. */
  escalationLevel?: 'L1' | 'L2' | 'L3';
}

/** The 14 roles in column order, with seeding metadata (design §3 / §5). */
export const ROLE_ROSTER: readonly RoleRosterEntry[] = [
  {
    code: 'REQ',
    slug: 'legal-requester',
    roleEn: 'Requester / Employee',
    roleAr: 'الموظف / مقدّم الطلب',
    tier: 'Business',
    unitEn: 'Requesting BU',
    unitAr: 'الوحدة الطالبة',
    reportsToEn: 'Line Manager',
    reportsToAr: 'المدير المباشر',
  },
  {
    code: 'DM',
    slug: 'legal-dept-manager',
    roleEn: 'Dept. Manager (Requesting)',
    roleAr: 'مدير الإدارة الطالبة',
    tier: 'Business',
    unitEn: 'Requesting BU',
    unitAr: 'الوحدة الطالبة',
    reportsToEn: 'BU CEO',
    reportsToAr: 'الرئيس التنفيذي للقطاع',
    escalationLevel: 'L2',
  },
  {
    code: 'BUC',
    slug: 'legal-bu-ceo',
    roleEn: 'Business Unit CEO',
    roleAr: 'الرئيس التنفيذي للقطاع',
    tier: 'Business',
    unitEn: 'Business Unit',
    unitAr: 'قطاع الأعمال',
    reportsToEn: 'CEO',
    reportsToAr: 'الرئيس التنفيذي للشركة',
  },
  {
    code: 'CEO',
    slug: 'legal-ceo',
    roleEn: 'CEO / Exec. Management',
    roleAr: 'الرئيس التنفيذي للشركة',
    tier: 'Business',
    unitEn: 'Executive',
    unitAr: 'الإدارة التنفيذية',
    reportsToEn: 'Board',
    reportsToAr: 'مجلس الإدارة',
  },
  {
    code: 'LD',
    slug: 'legal-director',
    roleEn: 'Legal Director (Head of Legal)',
    roleAr: 'مدير الإدارة القانونية',
    tier: 'Legal',
    unitEn: 'Legal Dept.',
    unitAr: 'الإدارة القانونية',
    reportsToEn: 'Shared Svcs Mgr',
    reportsToAr: 'مدير الخدمات المشتركة',
  },
  {
    code: 'CSM',
    slug: 'legal-cases-manager',
    roleEn: 'Cases & Investigations Sec. Mgr',
    roleAr: 'مدير قسم القضايا والتحقيقات',
    tier: 'Legal',
    unitEn: 'Legal Dept.',
    unitAr: 'الإدارة القانونية',
    reportsToEn: 'Legal Director',
    reportsToAr: 'مدير الإدارة القانونية',
  },
  {
    code: 'KSM',
    slug: 'legal-contracts-manager',
    roleEn: 'Contracts Section Manager',
    roleAr: 'مدير قسم العقود',
    tier: 'Legal',
    unitEn: 'Legal Dept.',
    unitAr: 'الإدارة القانونية',
    reportsToEn: 'Legal Director',
    reportsToAr: 'مدير الإدارة القانونية',
  },
  {
    code: 'CSV',
    slug: 'legal-case-supervisor',
    roleEn: 'Case Supervisor',
    roleAr: 'مشرف القضايا',
    tier: 'Legal',
    unitEn: 'Cases Section',
    unitAr: 'قسم القضايا',
    reportsToEn: 'Cases Sec. Mgr',
    reportsToAr: 'مدير قسم القضايا',
    escalationLevel: 'L1',
  },
  {
    code: 'KSV',
    slug: 'legal-contracts-supervisor',
    roleEn: 'Contracts Supervisor',
    roleAr: 'مشرف العقود',
    tier: 'Legal',
    unitEn: 'Contracts Section',
    unitAr: 'قسم العقود',
    reportsToEn: 'Contracts Sec. Mgr',
    reportsToAr: 'مدير قسم العقود',
  },
  {
    code: 'LO',
    slug: 'legal-officer',
    roleEn: 'Legal Officer / Handling Lawyer',
    roleAr: 'الموظف المختص / المحامي',
    tier: 'Legal',
    unitEn: 'Cases Section',
    unitAr: 'قسم القضايا',
    reportsToEn: 'Case Supervisor',
    reportsToAr: 'مشرف القضايا',
  },
  {
    code: 'LA',
    slug: 'legal-advisor',
    roleEn: 'Legal Advisor / Consultant',
    roleAr: 'المستشار القانوني',
    tier: 'Legal',
    unitEn: 'Advisory / Contracts',
    unitAr: 'الاستشارات / العقود',
    reportsToEn: 'Contracts Sec. Mgr',
    reportsToAr: 'مدير قسم العقود',
  },
  {
    code: 'SSM',
    slug: 'legal-shared-services-manager',
    roleEn: 'Shared Services Unit Manager',
    roleAr: 'مدير وحدة الخدمات المشتركة',
    tier: 'Oversight',
    unitEn: 'Shared Services',
    unitAr: 'الخدمات المشتركة',
    reportsToEn: 'Executive',
    reportsToAr: 'الإدارة التنفيذية',
    escalationLevel: 'L3',
  },
  {
    code: 'AUD',
    slug: 'legal-auditor',
    roleEn: 'Auditor / Compliance Officer',
    roleAr: 'المدقق / مسؤول الالتزام',
    tier: 'Oversight',
    unitEn: 'Governance',
    unitAr: 'الحوكمة',
    reportsToEn: 'Shared Svcs Mgr',
    reportsToAr: 'مدير الخدمات المشتركة',
  },
  {
    code: 'ADM',
    slug: 'legal-system-admin',
    roleEn: 'System Administrator',
    roleAr: 'مسؤول النظام',
    tier: 'Admin',
    unitEn: 'IT / Shared Services',
    unitAr: 'تقنية المعلومات / الخدمات المشتركة',
    reportsToEn: 'Shared Svcs Mgr',
    reportsToAr: 'مدير الخدمات المشتركة',
  },
];
