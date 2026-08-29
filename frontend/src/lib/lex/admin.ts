/**
 * Legal-Affairs Admin API client + domain types (CAP-005, 008, 015, 020, 021,
 * 074, 075, 153, 165).
 *
 * This module is the typed HTTP surface for the Watheeq / ClarioLegal admin
 * console: working-calendar engine, service catalog + eligibility, SLA targets,
 * attachment policies, the org-entity registry, and the case-classification
 * taxonomy tree. Every method calls the real backend under `/api/v1/lex/...`
 * via the shared axios instance (baseURL = gateway) through the suite-api
 * envelope helpers — singletons are unwrapped from `{data}` and lists from
 * `{data, meta}` exactly like `enterpriseApi.lex.*`.
 *
 * The types mirror the Go models/DTOs in `backend/internal/lex/model` +
 * `backend/internal/lex/dto`. Author-facing labels are bilingual
 * {@link LocalizedText} ({ar, en}); resolve them with `resolveLocalized`.
 */
import { apiDelete, apiGet, apiGetBlob, apiPatch, apiPost, apiPut } from '@/lib/api';
import { fetchSuiteData, fetchSuitePaginated } from '@/lib/suite-api';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';
import type { LocalizedText } from '@/types/forms';

/* --------------------------------------------------------------------------- *
 * Working Calendar Engine (CAP-020/021/029)
 * --------------------------------------------------------------------------- */

export type CalendarProfile = 'standard' | 'ramadan';
export const CALENDAR_PROFILES: readonly CalendarProfile[] = ['standard', 'ramadan'] as const;

export type CalendarHolidayKind = 'weekly' | 'official' | 'religious';
export const CALENDAR_HOLIDAY_KINDS: readonly CalendarHolidayKind[] = [
  'official',
  'religious',
  'weekly',
] as const;

export interface WorkingHours {
  id?: string;
  calendar_id?: string;
  profile: CalendarProfile;
  day_of_week: number; // 0 = Sunday … 6 = Saturday
  segment_index: number;
  start_minute: number;
  end_minute: number;
}

export interface CalendarHoliday {
  id: string;
  calendar_id: string;
  date: string;
  kind: CalendarHolidayKind;
  name: LocalizedText;
  created_at: string;
  updated_at: string;
}

export interface WorkingCalendar {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  timezone: string;
  is_default: boolean;
  ramadan_start?: string | null;
  ramadan_end?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  working_hours?: WorkingHours[];
  holidays?: CalendarHoliday[];
}

export interface WorkingHoursInput {
  profile: CalendarProfile;
  day_of_week: number;
  segment_index: number;
  start_minute: number;
  end_minute: number;
}

export interface CreateWorkingCalendarPayload {
  name: string;
  description?: string;
  timezone: string;
  is_default?: boolean;
  ramadan_start?: string | null;
  ramadan_end?: string | null;
  working_hours: WorkingHoursInput[];
}

export type UpdateWorkingCalendarPayload = Partial<CreateWorkingCalendarPayload>;

export interface AddCalendarHolidayPayload {
  date: string;
  kind: CalendarHolidayKind;
  name: LocalizedText;
}

/* --------------------------------------------------------------------------- *
 * Org & Entity Master-Data Registry (CAP-008/017/018/019/106/153)
 * --------------------------------------------------------------------------- */

export type OrgEntityType =
  | 'business_unit'
  | 'company'
  | 'department'
  | 'section'
  | 'shared_services_unit';
export const ORG_ENTITY_TYPES: readonly OrgEntityType[] = [
  'company',
  'business_unit',
  'department',
  'section',
  'shared_services_unit',
] as const;

export type OrgRoleKey =
  | 'section_supervisor'
  | 'department_manager'
  | 'shared_services_manager'
  | 'legal_director'
  | 'contracts_manager'
  | 'compliance_officer'
  | 'general_counsel';
export const ORG_ROLE_KEYS: readonly OrgRoleKey[] = [
  'section_supervisor',
  'department_manager',
  'shared_services_manager',
  'legal_director',
  'contracts_manager',
  'compliance_officer',
  'general_counsel',
] as const;

/**
 * The role bindings SLA escalation resolution walks for every entity — the org
 * registry's "Missing n" chip and the detail page's coverage hint both count
 * absences from this set, so it must stay a single source of truth.
 */
export const ESCALATION_ROLE_KEYS: readonly OrgRoleKey[] = [
  'section_supervisor',
  'department_manager',
  'shared_services_manager',
] as const;

export interface OrgRole {
  id: string;
  entity_id: string;
  role_key: OrgRoleKey;
  user_id: string;
  label: LocalizedText;
  created_at: string;
  updated_at: string;
}

export interface OrgEntity {
  id: string;
  tenant_id: string;
  parent_id?: string | null;
  entity_type: OrgEntityType;
  code: string;
  name: LocalizedText;
  platform_org_unit_id?: string | null;
  path: string[];
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  roles?: OrgRole[];
}

export interface OrgRolePayload {
  role_key: OrgRoleKey;
  user_id: string;
  label: LocalizedText;
}

export interface CreateOrgEntityPayload {
  parent_id?: string | null;
  entity_type: OrgEntityType;
  code: string;
  name: LocalizedText;
  platform_org_unit_id?: string | null;
  active?: boolean;
  /** Free-form master-data attributes (cost centre, CR/VAT, governorate, …). */
  metadata?: Record<string, unknown>;
  roles?: OrgRolePayload[];
}

export type UpdateOrgEntityPayload = Partial<Omit<CreateOrgEntityPayload, 'roles'>>;

export type OrgImportMode = 'create' | 'update' | 'merge' | 'replace';

export interface OrgStructureImportRow {
  row: number;
  code: string;
  parent_code?: string;
  entity_type: OrgEntityType;
  name: LocalizedText;
  platform_org_unit_id?: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
  roles?: OrgRolePayload[];
  manager_user_id?: string;
  employees?: OrgEmployeeMapping[];
}

export interface OrgEmployeeMapping {
  user_id: string;
  employee_code?: string;
  title?: LocalizedText;
  manager_user_id?: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Active employee-to-org-unit binding returned by the organisation registry.
 * User identity (name/email) remains owned by IAM and is hydrated separately
 * by the entity-aware user picker.
 */
export interface OrgMembership {
  id: string;
  tenant_id: string;
  entity_id: string;
  user_id: string;
  employee_code: string;
  title: LocalizedText;
  manager_user_id?: string | null;
  active: boolean;
  metadata: Record<string, unknown>;
  created_by: string;
}

export interface OrgImportRowError {
  row: number;
  code?: string;
  field: string;
  error_code: string;
  message: string;
}

export interface OrgImportJob {
  id: string;
  mode: OrgImportMode;
  dry_run: boolean;
  status: 'validated' | 'failed' | 'completed';
  source_filename: string;
  errors: OrgImportRowError[];
  total_rows: number;
  create_count: number;
  update_count: number;
  deactivate_count: number;
  role_count: number;
  employee_count: number;
  created_at: string;
  completed_at?: string;
}

export interface EscalationRecipient {
  level: number;
  role_key: OrgRoleKey;
  user_id: string;
  label: LocalizedText;
  entity_id: string;
  entity_code: string;
  entity_name: LocalizedText;
}

export interface EscalationLadder {
  entity_id: string;
  entity_code: string;
  entity_name: LocalizedText;
  resolved_at: string;
  recipients: EscalationRecipient[];
}

/* --------------------------------------------------------------------------- *
 * Service Catalog & Eligibility (CAP-001..005/008/015/174)
 * --------------------------------------------------------------------------- */

export type ServiceChannel = 'platform' | 'email' | 'both';
export const SERVICE_CHANNELS: readonly ServiceChannel[] = ['platform', 'email', 'both'] as const;

export type EligibilityRuleType = 'all' | 'department' | 'role' | 'doa_matrix';
export const ELIGIBILITY_RULE_TYPES: readonly EligibilityRuleType[] = [
  'all',
  'department',
  'role',
  'doa_matrix',
] as const;

export interface ServiceEligibilityRule {
  id?: string;
  service_id?: string;
  rule_type: EligibilityRuleType;
  value: string;
}

export interface ServiceCatalogEntry {
  id: string;
  tenant_id: string;
  code: string;
  request_type: string;
  name: LocalizedText;
  description: LocalizedText;
  available_to: string[];
  requester_approval_required: boolean;
  provider_approval_required: boolean;
  approval_policy_id?: string | null;
  intake_email?: string | null;
  channel: ServiceChannel;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  eligibility_rules?: ServiceEligibilityRule[];
}

export interface ServiceEligibilityRulePayload {
  rule_type: EligibilityRuleType;
  value: string;
}

export interface CreateServiceCatalogPayload {
  code: string;
  request_type: string;
  name: LocalizedText;
  description: LocalizedText;
  available_to?: string[];
  requester_approval_required?: boolean;
  provider_approval_required?: boolean;
  intake_email?: string | null;
  channel: ServiceChannel;
  active?: boolean;
  eligibility_rules?: ServiceEligibilityRulePayload[];
}

export type UpdateServiceCatalogPayload = Partial<Omit<CreateServiceCatalogPayload, 'code'>>;

/* --------------------------------------------------------------------------- *
 * Intake Mailboxes (CAP-002 email intake)
 * --------------------------------------------------------------------------- */

/**
 * Inbound email mailbox that maps an address to a default routing target for the
 * email-intake webhook. Mirrors `backend/internal/lex/model/intake_mailbox.go` —
 * the HMAC ingest secret is stored encrypted and is `json:"-"`, so it is NEVER
 * present on read responses; the client generates it and displays it once.
 */
export interface IntakeMailbox {
  id: string;
  tenant_id: string;
  address: string;
  request_type: string;
  service_id?: string | null;
  beneficiary_entity_id?: string | null;
  active: boolean;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateIntakeMailboxPayload {
  address: string;
  request_type: string;
  service_id?: string | null;
  beneficiary_entity_id?: string | null;
  /** Plaintext HMAC shared secret; encrypted at rest, never echoed back. */
  ingest_secret: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Update payload. Address is immutable post-create (the backend
 * `UpdateIntakeMailboxRequest` has no address field). A non-empty
 * `ingest_secret` rotates the shared secret; omitting it leaves it unchanged.
 */
export type UpdateIntakeMailboxPayload = Partial<{
  request_type: string;
  service_id: string | null;
  beneficiary_entity_id: string | null;
  ingest_secret: string;
  active: boolean;
  metadata: Record<string, unknown>;
}>;

/* --------------------------------------------------------------------------- *
 * SLA Targets (CAP-012/013/014/017/018/019)
 * --------------------------------------------------------------------------- */

export type SLATargetPriority = 'emergency' | 'urgent' | 'normal';
export const SLA_PRIORITIES: readonly SLATargetPriority[] = ['emergency', 'urgent', 'normal'] as const;

export type SLAAckUnit = 'working_days' | 'working_hours';
export const SLA_ACK_UNITS: readonly SLAAckUnit[] = ['working_days', 'working_hours'] as const;

export interface SLATarget {
  id: string;
  tenant_id: string;
  service_code: string;
  priority: SLATargetPriority;
  /**
   * Lower bound (earliest-promise) of the delivery budget, in working days. The
   * turnaround is published as a From–To window (e.g. 5–6); `turnaround_working_days`
   * is the enforced upper-bound deadline and this is the display-only lower bound.
   * `from <= to` always holds; when the sheet gives a single figure, `from == to`.
   * Optional for backward compatibility with pre-window records/fixtures; the
   * backend always populates it.
   */
  turnaround_working_days_from?: number;
  turnaround_working_days: number;
  ack_window_value: number;
  ack_window_unit: SLAAckUnit;
  escalation_l1_days: number;
  escalation_l2_days: number;
  escalation_l3_days: number;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateSLATargetPayload {
  service_code: string;
  priority: SLATargetPriority;
  /** Lower-bound (earliest-promise) working-day figure; defaults to the upper bound when omitted. */
  turnaround_working_days_from?: number;
  turnaround_working_days: number;
  ack_window_value: number;
  ack_window_unit: SLAAckUnit;
  escalation_l1_days: number;
  escalation_l2_days: number;
  escalation_l3_days: number;
  active?: boolean;
}

export type UpdateSLATargetPayload = Partial<
  Omit<CreateSLATargetPayload, 'service_code' | 'priority'>
>;

/* --------------------------------------------------------------------------- *
 * Attachment Policies (CAP-165..170)
 * --------------------------------------------------------------------------- */

export interface AttachmentSlot {
  key: string;
  label: LocalizedText;
  required: boolean;
  sort_order: number;
  allowed_content_types?: string[];
}

export interface AttachmentPolicy {
  id: string;
  tenant_id: string;
  request_type: string;
  service_code: string;
  name: LocalizedText;
  description: LocalizedText;
  min_attachment_count: number;
  max_attachment_count: number;
  slots: AttachmentSlot[];
  allowed_content_types: string[];
  max_file_size_bytes: number;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AttachmentSlotPayload {
  key: string;
  label: LocalizedText;
  required: boolean;
  sort_order: number;
  allowed_content_types?: string[];
}

export interface CreateAttachmentPolicyPayload {
  request_type?: string;
  service_code?: string;
  name: LocalizedText;
  description?: LocalizedText;
  min_attachment_count: number;
  max_attachment_count: number;
  slots: AttachmentSlotPayload[];
  allowed_content_types?: string[];
  max_file_size_bytes?: number;
  active?: boolean;
}

export type UpdateAttachmentPolicyPayload = Partial<CreateAttachmentPolicyPayload>;

/* --------------------------------------------------------------------------- *
 * Case Classification Taxonomy (CAP-074/075/076)
 * --------------------------------------------------------------------------- */

export interface CaseClassification {
  id: string;
  tenant_id: string;
  parent_id?: string | null;
  code: string;
  name: LocalizedText;
  path: string[];
  is_system: boolean;
  active: boolean;
  sort: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  children?: CaseClassification[];
}

export interface CreateCaseClassificationPayload {
  parent_id?: string | null;
  code: string;
  name: LocalizedText;
  active?: boolean;
  sort?: number;
}

export type UpdateCaseClassificationPayload = Partial<CreateCaseClassificationPayload>;

export interface CaseClassificationUsage {
  usage: Record<string, number>;
  generated_at: string;
}

export interface CaseClassificationMergeResult {
  source_id: string;
  target_id: string;
  reassigned: number;
  source_deactivated: boolean;
}

export interface CaseClassificationAuditEntry {
  id: string;
  classification_id: string;
  action: string;
  actor_id: string | null;
  actor_name?: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
}

/* --------------------------------------------------------------------------- *
 * Endpoint constants (local to the admin module; kept off the shared
 * API_ENDPOINTS map which the integrator owns).
 * --------------------------------------------------------------------------- */

export const LEX_ADMIN_ENDPOINTS = {
  WORKING_CALENDARS: '/api/v1/lex/working-calendars',
  ORG_ENTITIES: '/api/v1/lex/org-entities',
  SERVICE_CATALOG: '/api/v1/lex/service-catalog',
  INTAKE_MAILBOXES: '/api/v1/lex/intake/mailboxes',
  SLA_TARGETS: '/api/v1/lex/sla/targets',
  ATTACHMENT_POLICIES: '/api/v1/lex/attachment-policies',
  CASE_CLASSIFICATIONS: '/api/v1/lex/case-classifications',
  ROLE_MATRIX: '/api/v1/lex/role-matrix',
} as const;

/* --------------------------------------------------------------------------- *
 * Tenant Role-Matrix Import (Lex_Role_Matrix_Import_Design.md). Types mirror
 * backend/internal/lex/model/role_matrix.go field-for-field.
 * --------------------------------------------------------------------------- */

export type RoleMatrixImportMode = 'merge' | 'replace';
export type RoleMatrixImportStatus = 'validated' | 'failed' | 'committed';
export type RoleMatrixVersionStatus = 'draft' | 'active' | 'superseded';

export interface RoleMatrixIssue {
  role_slug?: string;
  permission?: string;
  field?: string;
  code_key: string;
  message: string;
}

export interface RoleMatrixRoleDiff {
  role_slug: string;
  added?: string[];
  removed?: string[];
}

export interface RoleMatrixDiff {
  roles_added?: string[];
  roles_deactivated?: string[];
  roles_changed?: RoleMatrixRoleDiff[];
  roles_unchanged: number;
  grants_added: number;
  grants_removed: number;
}

export interface RoleMatrixImportJob {
  id: string;
  tenant_id: string;
  version_id?: string | null;
  mode: RoleMatrixImportMode;
  dry_run: boolean;
  status: RoleMatrixImportStatus;
  source_filename: string;
  role_count: number;
  grant_count: number;
  error_count: number;
  warning_count: number;
  errors: RoleMatrixIssue[];
  warnings: RoleMatrixIssue[];
  diff: RoleMatrixDiff;
  created_by: string;
  created_at: string;
}

export interface RoleMatrixRoleSnapshot {
  slug: string;
  code?: string;
  name_en: string;
  name_ar?: string;
  description?: string;
  tier?: string;
  org_unit?: string;
  reports_to?: string;
  escalation_level?: number;
  is_system: boolean;
  active: boolean;
  permissions: string[];
}

export interface RoleMatrixVersion {
  id: string;
  tenant_id: string;
  version: number;
  status: RoleMatrixVersionStatus;
  source_filename: string;
  checksum: string;
  change_reason: string;
  snapshot: RoleMatrixRoleSnapshot[];
  created_by: string;
  created_at: string;
  activated_by?: string | null;
  activated_at?: string | null;
}

export interface RoleMatrixImportRolePayload {
  code?: string;
  slug: string;
  name_en: string;
  name_ar?: string;
  description?: string;
  tier?: string;
  org_unit?: string;
  reports_to?: string;
  escalation_level?: number;
  is_system: boolean;
  active: boolean;
}

export interface RoleMatrixImportPayload {
  mode: RoleMatrixImportMode;
  dry_run: boolean;
  source_filename?: string;
  change_reason?: string;
  confirm_warnings?: boolean;
  roles?: RoleMatrixImportRolePayload[];
  grants: Record<string, string[]>;
}

/* --------------------------------------------------------------------------- *
 * API client.
 * --------------------------------------------------------------------------- */

export const lexAdminApi = {
  // Working calendars ------------------------------------------------------
  listWorkingCalendars: (params: FetchParams): Promise<PaginatedResponse<WorkingCalendar>> =>
    fetchSuitePaginated<WorkingCalendar>(LEX_ADMIN_ENDPOINTS.WORKING_CALENDARS, params),
  getWorkingCalendar: (id: string): Promise<WorkingCalendar> =>
    fetchSuiteData<WorkingCalendar>(`${LEX_ADMIN_ENDPOINTS.WORKING_CALENDARS}/${id}`),
  createWorkingCalendar: (payload: CreateWorkingCalendarPayload): Promise<WorkingCalendar> =>
    apiPost<{ data: WorkingCalendar }>(LEX_ADMIN_ENDPOINTS.WORKING_CALENDARS, payload).then(
      (res) => res.data,
    ),
  updateWorkingCalendar: (
    id: string,
    payload: UpdateWorkingCalendarPayload,
  ): Promise<WorkingCalendar> =>
    apiPut<{ data: WorkingCalendar }>(
      `${LEX_ADMIN_ENDPOINTS.WORKING_CALENDARS}/${id}`,
      payload,
    ).then((res) => res.data),
  deleteWorkingCalendar: (id: string): Promise<void> =>
    apiDelete<void>(`${LEX_ADMIN_ENDPOINTS.WORKING_CALENDARS}/${id}`),
  addCalendarHoliday: (
    id: string,
    payload: AddCalendarHolidayPayload,
  ): Promise<CalendarHoliday> =>
    apiPost<{ data: CalendarHoliday }>(
      `${LEX_ADMIN_ENDPOINTS.WORKING_CALENDARS}/${id}/holidays`,
      payload,
    ).then((res) => res.data),
  deleteCalendarHoliday: (id: string, holidayId: string): Promise<void> =>
    apiDelete<void>(`${LEX_ADMIN_ENDPOINTS.WORKING_CALENDARS}/${id}/holidays/${holidayId}`),

  // Org entities -----------------------------------------------------------
  listOrgEntities: (params: FetchParams): Promise<PaginatedResponse<OrgEntity>> =>
    fetchSuitePaginated<OrgEntity>(LEX_ADMIN_ENDPOINTS.ORG_ENTITIES, params),
  getOrgEntity: (id: string): Promise<OrgEntity> =>
    fetchSuiteData<OrgEntity>(`${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/${id}`),
  getOrgEscalation: (id: string): Promise<EscalationLadder> =>
    fetchSuiteData<EscalationLadder>(`${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/${id}/escalation`),
  listOrgMemberships: (id: string): Promise<OrgMembership[]> =>
    fetchSuiteData<OrgMembership[]>(`${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/${id}/memberships`),
  createOrgEntity: (payload: CreateOrgEntityPayload): Promise<OrgEntity> =>
    apiPost<{ data: OrgEntity }>(LEX_ADMIN_ENDPOINTS.ORG_ENTITIES, payload).then((res) => res.data),
  updateOrgEntity: (id: string, payload: UpdateOrgEntityPayload): Promise<OrgEntity> =>
    apiPut<{ data: OrgEntity }>(`${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/${id}`, payload).then(
      (res) => res.data,
    ),
  deleteOrgEntity: (id: string): Promise<void> =>
    apiDelete<void>(`${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/${id}`),
  assignOrgRole: (id: string, payload: OrgRolePayload): Promise<OrgRole> =>
    apiPost<{ data: OrgRole }>(`${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/${id}/roles`, payload).then(
      (res) => res.data,
    ),
  removeOrgRole: (id: string, roleKey: string): Promise<void> =>
    apiDelete<void>(`${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/${id}/roles/${roleKey}`),
  importOrgStructure: (payload: {
    mode: OrgImportMode;
    dry_run: boolean;
    source_filename?: string;
    rows: OrgStructureImportRow[];
  }): Promise<OrgImportJob> =>
    apiPost<{ data: OrgImportJob }>(`${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/imports`, payload).then(
      (res) => res.data,
    ),
  listOrgImportJobs: (): Promise<OrgImportJob[]> =>
    apiGet<{ data: OrgImportJob[] }>(`${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/imports`).then(
      (res) => res.data,
    ),
  getOrgImportTemplate: (format: 'xlsx' | 'csv' | 'json', sample = false): Promise<Blob> =>
    apiGetBlob(`${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/import-template`, { format, sample }).then((res) => res.blob),
  getOrgImportErrors: (id: string, format: 'csv' | 'json' = 'csv'): Promise<Blob> =>
    apiGetBlob(`${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/imports/${id}/errors`, { format }).then((res) => res.blob),

  // Tenant role-matrix import ---------------------------------------------
  importRoleMatrix: (payload: RoleMatrixImportPayload): Promise<RoleMatrixImportJob> =>
    apiPost<{ data: RoleMatrixImportJob }>(`${LEX_ADMIN_ENDPOINTS.ROLE_MATRIX}/imports`, payload).then(
      (res) => res.data,
    ),
  listRoleMatrixImports: (): Promise<RoleMatrixImportJob[]> =>
    apiGet<{ data: RoleMatrixImportJob[] }>(`${LEX_ADMIN_ENDPOINTS.ROLE_MATRIX}/imports`).then(
      (res) => res.data,
    ),
  getRoleMatrixImportErrors: (id: string, format: 'csv' | 'json' = 'csv'): Promise<Blob> =>
    apiGetBlob(`${LEX_ADMIN_ENDPOINTS.ROLE_MATRIX}/imports/${id}/errors`, { format }).then((res) => res.blob),
  getRoleMatrixTemplate: (format: 'xlsx' | 'csv' | 'json', prefilled = true): Promise<Blob> =>
    apiGetBlob(`${LEX_ADMIN_ENDPOINTS.ROLE_MATRIX}/import-template`, { format, prefilled }).then(
      (res) => res.blob,
    ),
  listRoleMatrixVersions: (): Promise<RoleMatrixVersion[]> =>
    apiGet<{ data: RoleMatrixVersion[] }>(`${LEX_ADMIN_ENDPOINTS.ROLE_MATRIX}/versions`).then(
      (res) => res.data,
    ),
  activateRoleMatrixVersion: (id: string): Promise<RoleMatrixVersion> =>
    apiPost<{ data: RoleMatrixVersion }>(`${LEX_ADMIN_ENDPOINTS.ROLE_MATRIX}/versions/${id}/activate`).then(
      (res) => res.data,
    ),
  rollbackRoleMatrixVersion: (id: string): Promise<RoleMatrixVersion> =>
    apiPost<{ data: RoleMatrixVersion }>(`${LEX_ADMIN_ENDPOINTS.ROLE_MATRIX}/versions/${id}/rollback`).then(
      (res) => res.data,
    ),

  // Service catalog --------------------------------------------------------
  listServiceCatalog: (params: FetchParams): Promise<PaginatedResponse<ServiceCatalogEntry>> =>
    fetchSuitePaginated<ServiceCatalogEntry>(LEX_ADMIN_ENDPOINTS.SERVICE_CATALOG, params),
  getServiceCatalogEntry: (id: string): Promise<ServiceCatalogEntry> =>
    fetchSuiteData<ServiceCatalogEntry>(`${LEX_ADMIN_ENDPOINTS.SERVICE_CATALOG}/${id}`),
  createServiceCatalogEntry: (
    payload: CreateServiceCatalogPayload,
  ): Promise<ServiceCatalogEntry> =>
    apiPost<{ data: ServiceCatalogEntry }>(LEX_ADMIN_ENDPOINTS.SERVICE_CATALOG, payload).then(
      (res) => res.data,
    ),
  updateServiceCatalogEntry: (
    id: string,
    payload: UpdateServiceCatalogPayload,
  ): Promise<ServiceCatalogEntry> =>
    apiPut<{ data: ServiceCatalogEntry }>(
      `${LEX_ADMIN_ENDPOINTS.SERVICE_CATALOG}/${id}`,
      payload,
    ).then((res) => res.data),
  deleteServiceCatalogEntry: (id: string): Promise<void> =>
    apiDelete<void>(`${LEX_ADMIN_ENDPOINTS.SERVICE_CATALOG}/${id}`),

  // Intake mailboxes -------------------------------------------------------
  listIntakeMailboxes: (params: FetchParams): Promise<PaginatedResponse<IntakeMailbox>> =>
    fetchSuitePaginated<IntakeMailbox>(LEX_ADMIN_ENDPOINTS.INTAKE_MAILBOXES, params),
  getIntakeMailbox: (id: string): Promise<IntakeMailbox> =>
    fetchSuiteData<IntakeMailbox>(`${LEX_ADMIN_ENDPOINTS.INTAKE_MAILBOXES}/${id}`),
  createIntakeMailbox: (payload: CreateIntakeMailboxPayload): Promise<IntakeMailbox> =>
    apiPost<{ data: IntakeMailbox }>(LEX_ADMIN_ENDPOINTS.INTAKE_MAILBOXES, payload).then(
      (res) => res.data,
    ),
  updateIntakeMailbox: (id: string, payload: UpdateIntakeMailboxPayload): Promise<IntakeMailbox> =>
    apiPut<{ data: IntakeMailbox }>(
      `${LEX_ADMIN_ENDPOINTS.INTAKE_MAILBOXES}/${id}`,
      payload,
    ).then((res) => res.data),
  deleteIntakeMailbox: (id: string): Promise<void> =>
    apiDelete<void>(`${LEX_ADMIN_ENDPOINTS.INTAKE_MAILBOXES}/${id}`),

  // SLA targets ------------------------------------------------------------
  listSLATargets: (params: FetchParams): Promise<PaginatedResponse<SLATarget>> =>
    fetchSuitePaginated<SLATarget>(LEX_ADMIN_ENDPOINTS.SLA_TARGETS, params),
  getSLATarget: (id: string): Promise<SLATarget> =>
    fetchSuiteData<SLATarget>(`${LEX_ADMIN_ENDPOINTS.SLA_TARGETS}/${id}`),
  createSLATarget: (payload: CreateSLATargetPayload): Promise<SLATarget> =>
    apiPost<{ data: SLATarget }>(LEX_ADMIN_ENDPOINTS.SLA_TARGETS, payload).then((res) => res.data),
  updateSLATarget: (id: string, payload: UpdateSLATargetPayload): Promise<SLATarget> =>
    apiPatch<{ data: SLATarget }>(`${LEX_ADMIN_ENDPOINTS.SLA_TARGETS}/${id}`, payload).then(
      (res) => res.data,
    ),
  deleteSLATarget: (id: string): Promise<void> =>
    apiDelete<void>(`${LEX_ADMIN_ENDPOINTS.SLA_TARGETS}/${id}`),

  // Attachment policies ----------------------------------------------------
  listAttachmentPolicies: (params: FetchParams): Promise<PaginatedResponse<AttachmentPolicy>> =>
    fetchSuitePaginated<AttachmentPolicy>(LEX_ADMIN_ENDPOINTS.ATTACHMENT_POLICIES, params),
  getAttachmentPolicy: (id: string): Promise<AttachmentPolicy> =>
    fetchSuiteData<AttachmentPolicy>(`${LEX_ADMIN_ENDPOINTS.ATTACHMENT_POLICIES}/${id}`),
  createAttachmentPolicy: (
    payload: CreateAttachmentPolicyPayload,
  ): Promise<AttachmentPolicy> =>
    apiPost<{ data: AttachmentPolicy }>(
      LEX_ADMIN_ENDPOINTS.ATTACHMENT_POLICIES,
      payload,
    ).then((res) => res.data),
  updateAttachmentPolicy: (
    id: string,
    payload: UpdateAttachmentPolicyPayload,
  ): Promise<AttachmentPolicy> =>
    apiPut<{ data: AttachmentPolicy }>(
      `${LEX_ADMIN_ENDPOINTS.ATTACHMENT_POLICIES}/${id}`,
      payload,
    ).then((res) => res.data),
  deleteAttachmentPolicy: (id: string): Promise<void> =>
    apiDelete<void>(`${LEX_ADMIN_ENDPOINTS.ATTACHMENT_POLICIES}/${id}`),

  // Case classifications ---------------------------------------------------
  listCaseClassifications: (params: FetchParams): Promise<PaginatedResponse<CaseClassification>> =>
    fetchSuitePaginated<CaseClassification>(LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS, params),
  getCaseClassificationTree: (): Promise<CaseClassification[]> =>
    fetchSuiteData<CaseClassification[]>(`${LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS}/tree`),
  getCaseClassification: (id: string): Promise<CaseClassification> =>
    fetchSuiteData<CaseClassification>(`${LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS}/${id}`),
  createCaseClassification: (
    payload: CreateCaseClassificationPayload,
  ): Promise<CaseClassification> =>
    apiPost<{ data: CaseClassification }>(
      LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS,
      payload,
    ).then((res) => res.data),
  updateCaseClassification: (
    id: string,
    payload: UpdateCaseClassificationPayload,
  ): Promise<CaseClassification> =>
    apiPut<{ data: CaseClassification }>(
      `${LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS}/${id}`,
      payload,
    ).then((res) => res.data),
  deleteCaseClassification: (id: string): Promise<void> =>
    apiDelete<void>(`${LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS}/${id}`),
  getCaseClassificationUsage: (): Promise<Record<string, number>> =>
    apiGet<{ data: CaseClassificationUsage }>(
      `${LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS}/usage`,
    ).then((res) => res.data?.usage ?? {}),
  mergeCaseClassification: (
    sourceId: string,
    targetId: string,
  ): Promise<CaseClassificationMergeResult> =>
    apiPost<{ data: CaseClassificationMergeResult }>(
      `${LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS}/${sourceId}/merge`,
      { target_id: targetId },
    ).then((res) => res.data),
  listCaseClassificationAudit: (
    id: string,
  ): Promise<CaseClassificationAuditEntry[]> =>
    apiGet<{ data: CaseClassificationAuditEntry[] }>(
      `${LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS}/${id}/audit`,
    ).then((res) => res.data ?? []),
  reorderCaseClassifications: (body: {
    parent_id: string | null;
    ordered_ids: string[];
  }): Promise<{ updated: number }> =>
    apiPost<{ data: { updated: number } }>(
      `${LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS}/reorder`,
      body,
    ).then((res) => res.data),
  bulkCaseClassifications: (body: {
    action: 'activate' | 'deactivate';
    ids: string[];
  }): Promise<{ updated: number }> =>
    apiPost<{ data: { updated: number } }>(
      `${LEX_ADMIN_ENDPOINTS.CASE_CLASSIFICATIONS}/bulk`,
      body,
    ).then((res) => res.data),
};

// Re-export the raw apiGet for any ad-hoc admin reads (kept typed-thin).
export { apiGet as lexAdminRawGet };
