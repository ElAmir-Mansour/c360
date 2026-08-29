export interface User {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  avatar_url?: string | null;
  status: UserStatus;
  email_verified?: boolean;
  email_verified_at?: string | null;
  mfa_enabled: boolean;
  last_login_at: string | null;
  roles: Role[];
  created_at: string;
  updated_at: string;
}

export type UserStatus = 'active' | 'suspended' | 'inactive' | 'pending_verification';

export interface Role {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string;
  permissions: string[];
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

// Tenant types — re-exported from the canonical tenant.ts to avoid duplication.
// tenant.ts is aligned with the backend iam/dto/tenant_dto.go contract.
export type {
  Tenant,
  TenantStatus,
  SubscriptionTier,
  TenantSettings,
  TenantBranding,
  TenantPasswordPolicy,
} from './tenant';

export type SuiteName = 'cyber' | 'data' | 'respond' | 'acta' | 'lex' | 'visus';

export type NotificationCategory =
  | 'security'
  | 'data'
  | 'workflow'
  | 'system'
  | 'governance'
  | 'legal'
  | 'migration';

export type NotificationPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Notification {
  id: string;
  type?: string;
  title: string;
  body: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  data?: Record<string, unknown> | null;
  action_url?: string | null;
  read: boolean;
  read_at?: string | null;
  created_at: string;
}

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'failed';

export interface WorkflowTask {
  id: string;
  name: string;
  workflow_id: string;
  workflow_name: string;
  status: 'pending' | 'claimed' | 'completed' | 'rejected' | 'escalated' | 'cancelled';
  assigned_to: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

// The canonical bilingual form model lives in @/types/forms (the FE mirror of
// backend/internal/forms/model.go). The legacy flat single-locale shape used by
// HumanTask.form_schema is a strict subset of the canonical FormField (string
// labels normalize to LocalizedText, string[] options to FormOption[], the 6
// original types are a subset of the 17), so we re-export the canonical types
// here and keep this module the single import site that existing consumers use.
import type { FormField } from './forms';

export type {
  LocalizedText,
  FieldType,
  FormOption,
  RuleKind,
  ConditionOperator,
  Condition,
  ValidationRule,
  FieldDir,
  FormField,
  FormDefinition,
  FormData,
  Violation,
} from './forms';
export {
  FIELD_TYPES,
  OPTION_BACKED_TYPES,
  RULE_KINDS,
  CONDITION_OPERATORS,
} from './forms';

/**
 * Legacy 6-type field-type alias. Retained for backward compatibility with the
 * flat human-task form path; it is a subset of the canonical {@link FieldType}.
 */
export type FormFieldType = 'boolean' | 'text' | 'textarea' | 'select' | 'number' | 'date';

export type HumanTaskStatus = 'pending' | 'claimed' | 'completed' | 'rejected' | 'escalated' | 'cancelled';
export type TaskPriority = 0 | 1 | 2;

export interface HumanTask {
  id: string;
  name: string;
  description: string;
  instance_id: string;
  step_id: string;
  step_exec_id?: string;
  definition_name?: string;
  workflow_name?: string;
  status: HumanTaskStatus;
  priority: TaskPriority;
  form_schema: FormField[];
  form_data: Record<string, unknown> | null;
  sla_deadline: string | null;
  sla_breached: boolean;
  claimed_by: string | null;
  claimed_by_name?: string | null;
  assignee_role: string | null;
  assignee_id: string | null;
  escalated_to?: string | null;
  escalation_role?: string | null;
  metadata: Record<string, unknown>;
  claimed_at?: string | null;
  delegated_by?: string | null;
  delegated_at?: string | null;
  completed_at?: string | null;
  late_justification?: string | null;
  late_justification_submitted_by?: string | null;
  late_justification_submitted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type StepType = 'human_task' | 'service_task' | 'event_task' | 'condition' | 'parallel_gateway' | 'timer' | 'end';
export type StepStatus = 'completed' | 'running' | 'failed' | 'pending' | 'skipped' | 'cancelled';

export interface StepDefinition {
  id: string;
  name: string;
  type: StepType;
  description?: string;
}

export interface StepExecution {
  id: string;
  instance_id?: string;
  step_id: string;
  step_name?: string;
  step_type: string;
  status: StepStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms?: number | null;
  attempt: number;
  input_data?: Record<string, unknown> | null;
  output_data?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at?: string;
  // Legacy field names for backward compat with components
  duration_seconds?: number | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  assigned_to?: string | null;
  completed_by?: string | null;
}

export type WorkflowInstanceStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'suspended';

export interface WorkflowInstance {
  id: string;
  definition_id: string;
  definition_name?: string;
  tenant_id: string;
  definition_ver?: number;
  status: WorkflowInstanceStatus;
  current_step_id: string | null;
  current_step_name?: string | null;
  total_steps?: number;
  completed_steps?: number;
  started_at: string;
  completed_at: string | null;
  started_by: string | null;
  started_by_name?: string | null;
  variables: Record<string, unknown>;
  step_outputs?: Record<string, Record<string, unknown>>;
  trigger_data?: unknown;
  definition_steps?: StepDefinition[];
  error_message?: string | null;
  updated_at?: string;
  duration_ms?: number | null;
}

export interface TaskCounts {
  pending: number;
  claimed_by_me: number;
  completed?: number;
  overdue: number;
  escalated: number;
}

export interface AuditLog {
  id: string;
  tenant_id: string;
  user_id?: string | null;
  user_email: string;
  action: string;
  service: string;
  resource_type: string;
  resource_id: string;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  severity: 'info' | 'warning' | 'high' | 'critical';
  ip_address: string;
  user_agent: string;
  event_id: string;
  correlation_id: string;
  entry_hash: string;
  previous_hash: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type FileStatus = 'pending' | 'processing' | 'available' | 'quarantined' | 'deleted';
export type FileVirusScanStatus = 'pending' | 'scanning' | 'clean' | 'infected' | 'error' | 'skipped';
export type FileLifecyclePolicy = 'standard' | 'temporary' | 'archive' | 'audit_retention';
export type FileSuite = 'cyber' | 'data' | 'acta' | 'lex' | 'visus' | 'platform' | 'models';

export interface FileRecord {
  id: string;
  tenant_id: string;
  name: string;
  original_name: string;
  sanitized_name: string;
  content_type: string;
  detected_content_type?: string;
  size: number;
  size_bytes: number;
  status: FileStatus;
  checksum_sha256: string;
  encrypted: boolean;
  virus_scan_status: FileVirusScanStatus;
  uploaded_by: string;
  suite: FileSuite;
  entity_type?: string | null;
  entity_id?: string | null;
  tags: string[];
  version_number: number;
  is_public: boolean;
  lifecycle_policy: FileLifecyclePolicy;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FileItem extends FileRecord {}

export interface FileAccessLogEntry {
  id: string;
  file_id: string;
  tenant_id: string;
  user_id: string;
  action: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
}

export interface FileQuarantineEntry {
  id: string;
  file_id: string;
  original_bucket: string;
  original_key: string;
  quarantine_bucket: string;
  quarantine_key: string;
  virus_name: string;
  scanned_at: string;
  quarantined_at: string;
  resolved: boolean;
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_action?: 'deleted' | 'restored' | 'false_positive' | null;
}

export interface FileStorageStat {
  tenant_id: string;
  suite: string;
  file_count: number;
  total_bytes: number;
}

export interface FilePresignedDownload {
  url: string;
  method: string;
  expires_at: string;
}

export interface Alert {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  status: 'new' | 'acknowledged' | 'investigating' | 'resolved' | 'false_positive';
  source: string;
  created_at: string;
  updated_at: string;
}

// ── Workflow Definition types ──

export type WorkflowDefinitionStatus = 'draft' | 'active' | 'deprecated' | 'archived';
export type WorkflowCategory = 'approval' | 'onboarding' | 'review' | 'escalation' | 'notification' | 'data_pipeline' | 'compliance' | 'custom';

// Backend DTO shapes — these match what the API actually returns
export interface BackendTriggerConfig {
  type: 'manual' | 'event' | 'schedule';
  topic?: string;
  filter?: Record<string, unknown>;
  cron?: string;
}

export interface BackendTransition {
  condition?: string;
  target: string;
}

export interface BackendStepDefinition {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  transitions: BackendTransition[];
}

export interface BackendVariableDef {
  type: string;
  source?: string;
  default?: unknown;
}

export interface WorkflowTrigger {
  type: 'manual' | 'event' | 'schedule';
  event_type?: string;
  schedule_cron?: string;
  webhook_path?: string;
  conditions?: WorkflowCondition[];
}

export interface WorkflowCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'contains' | 'matches';
  value: unknown;
  logic?: 'and' | 'or';
}

export type WorkflowStepType =
  | 'approval'
  | 'approval_chain'
  | 'review'
  | 'task'
  | 'notification'
  | 'condition'
  | 'parallel_gateway'
  | 'join_gateway'
  | 'delay'
  | 'webhook'
  | 'script'
  | 'sub_workflow'
  | 'end';

/**
 * A single approver in an `approval_chain` step. Mirrors the backend
 * executor.Approver contract (internal/workflow/executor/approval_chain.go):
 * `type` is "user" or "role"; `ref` is the user id / `${...}` variable
 * reference (for user) or the role name (for role).
 */
export interface ApprovalChainApprover {
  type: 'user' | 'role';
  ref: string;
}

export interface WorkflowStepConfig {
  form_schema?: FormField[];
  approval_type?: 'single' | 'unanimous' | 'majority';
  min_approvers?: number;
  notification_template?: string;
  notification_channels?: ('email' | 'in_app' | 'webhook')[];
  conditions?: WorkflowCondition[];
  delay_minutes?: number;
  delay_until?: string;
  webhook_url?: string;
  webhook_method?: 'GET' | 'POST' | 'PUT';
  webhook_headers?: Record<string, string>;
  webhook_body_template?: string;
  sub_workflow_id?: string;
  script_id?: string;
  // ── approval_chain (multi-approver) config ──
  // Persisted verbatim to the backend approval_chain executor config
  // (internal/workflow/executor/approval_chain.go → ParseApprovalConfig).
  approvers?: ApprovalChainApprover[];
  /** sequential = one task at a time; parallel = all approver tasks up front. */
  mode?: 'sequential' | 'parallel';
  /** all = every approver; any = one approval; n_of_m = quorum_n of M approvers. */
  quorum?: 'all' | 'any' | 'n_of_m';
  /** Required count when quorum === 'n_of_m'. */
  quorum_n?: number;
  /** Per-approver SLA in hours; 0 / unset means no deadline. */
  sla_hours?: number;
}

export type AssigneeStrategy =
  | { type: 'specific_user'; user_id: string }
  | { type: 'role'; role_id: string }
  | { type: 'manager_of'; relative_to: 'initiator' | 'previous_assignee' }
  | { type: 'round_robin'; user_pool: string[] }
  | { type: 'least_loaded'; role_id: string };

export interface WorkflowTransition {
  id: string;
  target_step_id: string;
  label: string;
  condition?: WorkflowCondition | string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: WorkflowStepType;
  config: WorkflowStepConfig;
  position: { x: number; y: number };
  transitions: WorkflowTransition[];
  timeout_minutes: number | null;
  on_timeout: 'skip' | 'escalate' | 'fail';
  assignee_strategy: AssigneeStrategy;
}

export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
  default_value?: unknown;
  required: boolean;
  description: string;
}

export interface WorkflowDefinition {
  id: string;
  tenant_id?: string;
  name: string;
  description: string;
  category?: WorkflowCategory;
  status: WorkflowDefinitionStatus;
  version: number;
  trigger_config: BackendTriggerConfig;
  steps: BackendStepDefinition[];
  variables: Record<string, BackendVariableDef>;
  step_count?: number;
  instance_count?: number;
  created_by: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
}

export interface WorkflowDefinitionVersion {
  id?: string;
  tenant_id?: string;
  version: number;
  status: WorkflowDefinitionStatus;
  name?: string;
  description?: string;
  category?: string;
  step_count?: number;
  instance_count?: number;
  steps?: BackendStepDefinition[];
  trigger_config?: BackendTriggerConfig;
  variables?: Record<string, BackendVariableDef>;
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
}

export interface CreateInstanceRequest {
  definition_id: string;
  input_variables?: Record<string, unknown>;
  trigger_data?: unknown;
}

export interface TaskComment {
  id: string;
  user_id: string;
  user_name: string;
  user_email?: string;
  content: string;
  created_at: string;
}

export interface CompleteTaskRequest {
  action: 'approve' | 'reject' | 'complete' | 'escalate';
  form_data?: Record<string, unknown>;
  comment?: string;
  late_justification?: string;
}

export interface AssignTaskRequest {
  user_id: string;
  comment?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  name_i18n?: Record<string, string>;
  description_i18n?: Record<string, string>;
  category: string;
  icon?: string;
  preview_image_url?: string | null;
  steps?: BackendStepDefinition[];
  variables?: Record<string, BackendVariableDef>;
  usage_count?: number;
  tags?: string[];
  created_at?: string;
}

export interface CreateFromTemplateRequest {
  template_id: string;
  name: string;
  description?: string;
}

// ── Notification Webhook Types ──

export interface NotificationWebhook {
  id: string;
  name: string;
  url: string;
  secret: string | null;
  events: string[];
  status: 'active' | 'inactive' | 'failing';
  headers: Record<string, string>;
  retry_policy: RetryPolicy;
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
  success_count: number;
  failure_count: number;
}

export interface RetryPolicy {
  max_retries: number;
  backoff_type: 'linear' | 'exponential';
  initial_delay_seconds: number;
}

export interface CreateWebhookRequest {
  name: string;
  url: string;
  events: string[];
  headers?: Record<string, string>;
  retry_policy?: Partial<RetryPolicy>;
}

export interface CreateWebhookResponse {
  webhook: NotificationWebhook;
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  // Backend delivery_log status values: pending | delivered | failed | skipped
  // 'retrying' is a UI-derived state (has next_retry_at set)
  status: 'delivered' | 'failed' | 'pending' | 'skipped' | 'retrying';
  request_url: string;
  request_body: Record<string, unknown>;
  response_status: number | null;
  response_body: string | null;
  duration_ms: number | null;
  attempt_count: number;
  next_retry_at: string | null;
  created_at: string;
}

// ── Notification Counts ──

export interface NotificationCounts {
  unread: number;
  all: number;
  security: number;
  data: number;
  workflow: number;
  governance: number;
  legal: number;
  system: number;
}

// ── Delivery Stats ──

export interface DeliveryStats {
  period: string;
  total_sent: number;
  delivered: number;
  failed: number;
  delivery_rate: number;
  by_channel: Record<string, ChannelStats>;
  by_type: Record<string, number>;
  by_day: { date: string; sent: number; delivered: number; failed: number }[];
  avg_delivery_time_ms: number;
}

export interface ChannelStats {
  sent: number;
  delivered: number;
  failed: number;
  avg_delivery_time_ms: number;
}

// ── Test Notification ──

export type NotificationType =
  | 'alert'
  | 'task'
  | 'approval'
  | 'system'
  | 'mention'
  | 'deadline'
  | 'completion'
  | 'error'
  | 'report';

export interface TestNotificationRequest {
  type: NotificationType;
  channel: 'email' | 'in_app' | 'websocket' | 'webhook';
  recipient_user_id?: string;
  webhook_id?: string;
}

export interface RetryFailedRequest {
  channel?: string;
  since?: string;
  notification_ids?: string[];
}
