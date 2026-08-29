import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  Eye,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  MinusCircle,
  ArrowUpCircle,
  Play,
  Pause,
  FileEdit,
  UserCheck,
  Ban,
  CheckCheck,
  AlertTriangle,
  Shield,
  User,
  Building2,
  File,
  GitBranch,
  Scale,
  Workflow,
  Lock,
  Globe,
} from "lucide-react";

export interface StatusConfigItem {
  label: string;
  /**
   * Authentic Arabic (Saudi legal/administrative register) label. Optional so
   * existing configs stay valid; the shared `StatusBadge` prefers this over
   * `label` when the active locale is Arabic and falls back to `label` when a
   * given entry has not (yet) been localized.
   */
  labelAr?: string;
  color: string; // Tailwind color name: "red", "green", "yellow", "blue", "gray", "orange", "purple"
  icon: LucideIcon;
}

export type StatusConfig = Record<string, StatusConfigItem>;

export const alertStatusConfig: StatusConfig = {
  new: { label: "New", labelAr: "جديد", color: "red", icon: AlertCircle },
  acknowledged: { label: "Acknowledged", labelAr: "تم الإقرار", color: "orange", icon: Eye },
  investigating: { label: "Investigating", labelAr: "قيد التحقيق", color: "yellow", icon: Search },
  in_progress: { label: "In Progress", labelAr: "قيد المعالجة", color: "blue", icon: Clock },
  resolved: { label: "Resolved", labelAr: "تم الحل", color: "green", icon: CheckCircle },
  closed: { label: "Closed", labelAr: "مغلق", color: "gray", icon: XCircle },
  false_positive: { label: "False Positive", labelAr: "إنذار كاذب", color: "gray", icon: MinusCircle },
  escalated: { label: "Escalated", labelAr: "مُصعّد", color: "purple", icon: ArrowUpCircle },
};

export const pipelineStatusConfig: StatusConfig = {
  active: { label: "Active", color: "green", icon: Play },
  paused: { label: "Paused", color: "yellow", icon: Pause },
  failed: { label: "Failed", color: "red", icon: XCircle },
  completed: { label: "Completed", color: "blue", icon: CheckCircle },
  draft: { label: "Draft", color: "gray", icon: FileEdit },
};

export const sourceStatusConfig: StatusConfig = {
  active: { label: 'Active', color: 'green', icon: CheckCircle },
  syncing: { label: 'Syncing', color: 'blue', icon: Play },
  inactive: { label: 'Inactive', color: 'gray', icon: Pause },
  error: { label: 'Error', color: 'red', icon: AlertCircle },
};

export const datasetStatusConfig: StatusConfig = {
  active: { label: 'Active', color: 'green', icon: CheckCircle },
  published: { label: 'Published', color: 'blue', icon: CheckCheck },
  draft: { label: 'Draft', color: 'gray', icon: FileEdit },
  archived: { label: 'Archived', color: 'gray', icon: XCircle },
  deprecated: { label: 'Deprecated', color: 'orange', icon: AlertTriangle },
};

export const taskStatusConfig: StatusConfig = {
  pending: { label: "Pending", labelAr: "قيد الانتظار", color: "yellow", icon: Clock },
  claimed: { label: "In Progress", labelAr: "قيد المعالجة", color: "blue", icon: UserCheck },
  completed: { label: "Completed", labelAr: "مكتمل", color: "green", icon: CheckCircle },
  rejected: { label: "Rejected", labelAr: "مرفوض", color: "red", icon: XCircle },
  escalated: { label: "Escalated", labelAr: "مُصعّد", color: "purple", icon: ArrowUpCircle },
  cancelled: { label: "Cancelled", labelAr: "ملغى", color: "gray", icon: Ban },
};

export const userStatusConfig: StatusConfig = {
  active: { label: "Active", color: "green", icon: CheckCircle },
  suspended: { label: "Suspended", color: "red", icon: Ban },
  inactive: { label: "Inactive", color: "gray", icon: XCircle },
  pending_verification: { label: "Pending", color: "yellow", icon: Clock },
};

export const fileStatusConfig: StatusConfig = {
  pending: { label: "Pending", color: "yellow", icon: Clock },
  processing: { label: "Processing", color: "blue", icon: Search },
  available: { label: "Available", color: "green", icon: CheckCircle },
  quarantined: { label: "Quarantined", color: "red", icon: AlertTriangle },
  deleted: { label: "Deleted", color: "gray", icon: XCircle },
};

export const tenantStatusConfig: StatusConfig = {
  active: { label: "Active", color: "green", icon: CheckCircle },
  inactive: { label: "Inactive", color: "gray", icon: XCircle },
  suspended: { label: "Suspended", color: "red", icon: Ban },
  trial: { label: "Trial", color: "yellow", icon: Clock },
  onboarding: { label: "Onboarding", color: "blue", icon: Clock },
  deprovisioned: { label: "Deprovisioned", color: "gray", icon: XCircle },
};

export const tenantPlanConfig: StatusConfig = {
  free: { label: "Free", color: "gray", icon: Building2 },
  starter: { label: "Starter", color: "blue", icon: Building2 },
  professional: { label: "Professional", color: "purple", icon: Building2 },
  enterprise: { label: "Enterprise", color: "teal", icon: Building2 },
};

export const apiKeyStatusConfig: StatusConfig = {
  active: { label: "Active", color: "green", icon: CheckCircle },
  revoked: { label: "Revoked", color: "red", icon: Ban },
  expired: { label: "Expired", color: "gray", icon: Clock },
};

export const invitationStatusConfig: StatusConfig = {
  pending: { label: "Pending", color: "yellow", icon: Clock },
  accepted: { label: "Accepted", color: "green", icon: CheckCircle },
  expired: { label: "Expired", color: "gray", icon: Clock },
  cancelled: { label: "Cancelled", color: "red", icon: Ban },
  revoked: { label: "Revoked", color: "red", icon: Ban },
};

export const workflowDefinitionStatusConfig: StatusConfig = {
  draft: { label: "Draft", labelAr: "مسودة", color: "gray", icon: FileEdit },
  active: { label: "Active", labelAr: "نشط", color: "green", icon: CheckCircle },
  archived: { label: "Archived", labelAr: "مؤرشف", color: "gray", icon: Ban },
};

export const workflowStatusConfig: StatusConfig = {
  running: { label: "Running", labelAr: "قيد التشغيل", color: "blue", icon: Play },
  completed: { label: "Completed", labelAr: "مكتمل", color: "green", icon: CheckCircle },
  failed: { label: "Failed", labelAr: "فاشل", color: "red", icon: XCircle },
  cancelled: { label: "Cancelled", labelAr: "ملغى", color: "gray", icon: Ban },
  suspended: { label: "Suspended", labelAr: "موقوف", color: "yellow", icon: Pause },
};

export const contractStatusConfig: StatusConfig = {
  draft: { label: "Draft", labelAr: "مسودة", color: "gray", icon: FileEdit },
  review: { label: "In Review", labelAr: "قيد المراجعة", color: "yellow", icon: Eye },
  internal_review: { label: "Internal Review", labelAr: "مراجعة داخلية", color: "yellow", icon: Eye },
  legal_review: { label: "Legal Review", labelAr: "مراجعة قانونية", color: "orange", icon: Scale },
  negotiation: { label: 'Negotiation', labelAr: "تفاوض", color: 'orange', icon: Workflow },
  pending_signature: { label: 'Pending Signature', labelAr: "بانتظار التوقيع", color: 'blue', icon: FileEdit },
  active: { label: 'Active', labelAr: "ساري", color: 'green', icon: CheckCircle },
  suspended: { label: 'Suspended', labelAr: "موقوف", color: 'yellow', icon: Pause },
  approved: { label: "Approved", labelAr: "معتمد", color: "green", icon: CheckCircle },
  signed: { label: "Signed", labelAr: "موقّع", color: "blue", icon: CheckCheck },
  expired: { label: "Expired", labelAr: "منتهي", color: "red", icon: AlertCircle },
  renewed: { label: 'Renewed', labelAr: "مُجدَّد", color: 'teal', icon: CheckCheck },
  terminated: { label: "Terminated", labelAr: "مُنهى", color: "gray", icon: XCircle },
  cancelled: { label: 'Cancelled', labelAr: "ملغى", color: 'gray', icon: Ban },
};

export const committeeStatusConfig: StatusConfig = {
  active: { label: 'Active', labelAr: "نشطة", color: 'green', icon: CheckCircle },
  inactive: { label: 'Inactive', labelAr: "غير نشطة", color: 'gray', icon: Pause },
  dissolved: { label: 'Dissolved', labelAr: "منحلّة", color: 'red', icon: XCircle },
};

export const meetingStatusConfig: StatusConfig = {
  draft: { label: 'Draft', labelAr: "مسودة", color: 'gray', icon: FileEdit },
  scheduled: { label: 'Scheduled', labelAr: "مجدول", color: 'blue', icon: Clock },
  in_progress: { label: 'In Progress', labelAr: "قيد الانعقاد", color: 'yellow', icon: Play },
  completed: { label: 'Completed', labelAr: "مكتمل", color: 'green', icon: CheckCircle },
  cancelled: { label: 'Cancelled', labelAr: "ملغى", color: 'gray', icon: Ban },
  postponed: { label: 'Postponed', labelAr: "مؤجّل", color: 'orange', icon: Pause },
};

export const minuteStatusConfig: StatusConfig = {
  draft: { label: 'Draft', labelAr: "مسودة", color: 'gray', icon: FileEdit },
  review: { label: 'In Review', labelAr: "قيد المراجعة", color: 'yellow', icon: Eye },
  revision_requested: { label: 'Revision Requested', labelAr: "مطلوب تعديل", color: 'orange', icon: AlertTriangle },
  approved: { label: 'Approved', labelAr: "معتمد", color: 'green', icon: CheckCircle },
  published: { label: 'Published', labelAr: "منشور", color: 'blue', icon: CheckCheck },
};

export const documentStatusConfig: StatusConfig = {
  draft: { label: 'Draft', labelAr: "مسودة", color: 'gray', icon: FileEdit },
  review: { label: 'In Review', labelAr: "قيد المراجعة", color: 'yellow', icon: Eye },
  approved: { label: 'Approved', labelAr: "معتمد", color: 'green', icon: CheckCircle },
  active: { label: 'Active', labelAr: "ساري", color: 'green', icon: CheckCircle },
  archived: { label: 'Archived', labelAr: "مؤرشف", color: 'gray', icon: XCircle },
  superseded: { label: 'Superseded', labelAr: "مُستبدل", color: 'orange', icon: AlertTriangle },
};

/**
 * Confidentiality classification for legal documents, keyed by the raw
 * `LexDocumentConfidentiality` backend token. `privileged` is intentionally red
 * + Lock so attorney-client privileged material is impossible to miss in lists.
 */
export const documentConfidentialityConfig: StatusConfig = {
  public: { label: 'Public', labelAr: "عام", color: 'gray', icon: Globe },
  internal: { label: 'Internal', labelAr: "داخلي", color: 'blue', icon: Building2 },
  confidential: { label: 'Confidential', labelAr: "سري", color: 'orange', icon: Shield },
  privileged: { label: 'Privileged', labelAr: "محمي بالحصانة", color: 'red', icon: Lock },
};

export const actionItemStatusConfig: StatusConfig = {
  pending: { label: 'Pending', labelAr: "قيد الانتظار", color: 'gray', icon: Clock },
  in_progress: { label: 'In Progress', labelAr: "قيد المعالجة", color: 'blue', icon: Play },
  completed: { label: 'Completed', labelAr: "مكتمل", color: 'green', icon: CheckCircle },
  overdue: { label: 'Overdue', labelAr: "متأخر", color: 'red', icon: AlertCircle },
  cancelled: { label: 'Cancelled', labelAr: "ملغى", color: 'gray', icon: Ban },
  deferred: { label: 'Deferred', labelAr: "مؤجّل", color: 'yellow', icon: Pause },
};

export const clauseReviewStatusConfig: StatusConfig = {
  pending: { label: 'Pending', labelAr: "قيد الانتظار", color: 'gray', icon: Clock },
  reviewed: { label: 'Reviewed', labelAr: "تمت المراجعة", color: 'blue', icon: Eye },
  flagged: { label: 'Flagged', labelAr: "مؤشَّر", color: 'red', icon: AlertTriangle },
  accepted: { label: 'Accepted', labelAr: "مقبول", color: 'green', icon: CheckCircle },
  rejected: { label: 'Rejected', labelAr: "مرفوض", color: 'orange', icon: XCircle },
};

export const complianceStatusConfig: StatusConfig = {
  compliant: { label: 'Compliant', color: 'green', icon: CheckCircle },
  non_compliant: { label: 'Non-Compliant', color: 'red', icon: AlertTriangle },
  warning: { label: 'Warning', color: 'yellow', icon: AlertCircle },
  not_applicable: { label: 'Not Applicable', color: 'gray', icon: MinusCircle },
};

export const visusAlertStatusConfig: StatusConfig = {
  new: { label: 'New', color: 'red', icon: AlertCircle },
  viewed: { label: 'Viewed', color: 'blue', icon: Eye },
  acknowledged: { label: 'Acknowledged', color: 'yellow', icon: Search },
  actioned: { label: 'Actioned', color: 'green', icon: CheckCircle },
  dismissed: { label: 'Dismissed', color: 'gray', icon: XCircle },
  escalated: { label: 'Escalated', color: 'purple', icon: ArrowUpCircle },
};

export const riskStatusConfig: StatusConfig = {
  open: { label: 'Open', color: 'yellow', icon: AlertCircle },
  mitigated: { label: 'Mitigated', color: 'blue', icon: Shield },
  accepted: { label: 'Accepted', color: 'green', icon: CheckCircle },
  closed: { label: 'Closed', color: 'gray', icon: XCircle },
};

export const riskTreatmentConfig: StatusConfig = {
  mitigate: { label: 'Mitigate', color: 'blue', icon: Shield },
  transfer: { label: 'Transfer', color: 'purple', icon: ArrowUpCircle },
  accept: { label: 'Accept', color: 'green', icon: CheckCircle },
  avoid: { label: 'Avoid', color: 'orange', icon: Ban },
};

export const policyStatusConfig: StatusConfig = {
  draft: { label: 'Draft', color: 'gray', icon: FileEdit },
  review: { label: 'In Review', color: 'yellow', icon: Eye },
  approved: { label: 'Approved', color: 'green', icon: CheckCircle },
  published: { label: 'Published', color: 'blue', icon: CheckCheck },
  retired: { label: 'Retired', color: 'gray', icon: Ban },
};

export const policyExceptionStatusConfig: StatusConfig = {
  pending: { label: 'Pending', color: 'yellow', icon: Clock },
  approved: { label: 'Approved', color: 'green', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'red', icon: XCircle },
  expired: { label: 'Expired', color: 'gray', icon: Clock },
};

export const vendorStatusConfig: StatusConfig = {
  active: { label: 'Active', color: 'green', icon: CheckCircle },
  onboarding: { label: 'Onboarding', color: 'blue', icon: Play },
  under_review: { label: 'Under Review', color: 'yellow', icon: Eye },
  offboarding: { label: 'Offboarding', color: 'orange', icon: Clock },
  terminated: { label: 'Terminated', color: 'gray', icon: XCircle },
};

export const questionnaireStatusConfig: StatusConfig = {
  draft: { label: 'Draft', color: 'gray', icon: FileEdit },
  sent: { label: 'Sent', color: 'blue', icon: ArrowUpCircle },
  in_progress: { label: 'In Progress', color: 'yellow', icon: Play },
  completed: { label: 'Completed', color: 'green', icon: CheckCircle },
  expired: { label: 'Expired', color: 'red', icon: Clock },
};

export const evidenceStatusConfig: StatusConfig = {
  current: { label: 'Current', color: 'green', icon: CheckCircle },
  stale: { label: 'Stale', color: 'yellow', icon: AlertTriangle },
  expired: { label: 'Expired', color: 'red', icon: XCircle },
};

export const budgetItemStatusConfig: StatusConfig = {
  proposed: { label: 'Proposed', color: 'yellow', icon: Clock },
  approved: { label: 'Approved', color: 'green', icon: CheckCircle },
  in_progress: { label: 'In Progress', color: 'blue', icon: Play },
  completed: { label: 'Completed', color: 'green', icon: CheckCheck },
  deferred: { label: 'Deferred', color: 'gray', icon: Pause },
};

export const maturityAssessmentStatusConfig: StatusConfig = {
  draft: { label: 'Draft', color: 'gray', icon: FileEdit },
  in_progress: { label: 'In Progress', color: 'blue', icon: Play },
  completed: { label: 'Completed', color: 'green', icon: CheckCircle },
};

export const awarenessStatusConfig: StatusConfig = {
  scheduled: { label: 'Scheduled', color: 'gray', icon: Clock },
  active: { label: 'Active', color: 'blue', icon: Play },
  completed: { label: 'Completed', color: 'green', icon: CheckCircle },
};

export const iamFindingStatusConfig: StatusConfig = {
  open: { label: 'Open', color: 'red', icon: AlertCircle },
  in_progress: { label: 'In Progress', color: 'blue', icon: Play },
  resolved: { label: 'Resolved', color: 'green', icon: CheckCircle },
  accepted: { label: 'Accepted', color: 'gray', icon: CheckCheck },
};

export const threatStatusConfig: StatusConfig = {
  active: { label: 'Active', color: 'red', icon: AlertCircle },
  contained: { label: 'Contained', color: 'orange', icon: Shield },
  eradicated: { label: 'Eradicated', color: 'green', icon: CheckCircle },
  monitoring: { label: 'Monitoring', color: 'blue', icon: Eye },
  closed: { label: 'Closed', color: 'gray', icon: XCircle },
};

export const playbookStatusConfig: StatusConfig = {
  draft: { label: 'Draft', color: 'gray', icon: FileEdit },
  approved: { label: 'Approved', color: 'green', icon: CheckCircle },
  tested: { label: 'Tested', color: 'blue', icon: CheckCheck },
  retired: { label: 'Retired', color: 'red', icon: Ban },
};

export const simulationResultConfig: StatusConfig = {
  pass: { label: 'Pass', color: 'green', icon: CheckCircle },
  partial: { label: 'Partial', color: 'orange', icon: AlertTriangle },
  fail: { label: 'Fail', color: 'red', icon: XCircle },
};

export const integrationStatusConfig: StatusConfig = {
  connected: { label: 'Connected', color: 'green', icon: CheckCircle },
  disconnected: { label: 'Disconnected', color: 'gray', icon: XCircle },
  error: { label: 'Error', color: 'red', icon: AlertCircle },
  pending: { label: 'Pending', color: 'yellow', icon: Clock },
};

export const integrationHealthConfig: StatusConfig = {
  healthy: { label: 'Healthy', color: 'green', icon: CheckCircle },
  degraded: { label: 'Degraded', color: 'yellow', icon: AlertTriangle },
  unavailable: { label: 'Unavailable', color: 'red', icon: XCircle },
};

export const ownershipStatusConfig: StatusConfig = {
  assigned: { label: 'Assigned', color: 'blue', icon: UserCheck },
  pending_review: { label: 'Pending Review', color: 'yellow', icon: Clock },
  reviewed: { label: 'Reviewed', color: 'green', icon: CheckCircle },
};

export const approvalStatusConfig: StatusConfig = {
  pending: { label: 'Pending', labelAr: "قيد الانتظار", color: 'yellow', icon: Clock },
  approved: { label: 'Approved', labelAr: "معتمد", color: 'green', icon: CheckCircle },
  rejected: { label: 'Rejected', labelAr: "مرفوض", color: 'red', icon: XCircle },
  escalated: { label: 'Escalated', labelAr: "مُصعّد", color: 'purple', icon: ArrowUpCircle },
};

export const obligationStatusConfig: StatusConfig = {
  compliant: { label: 'Compliant', labelAr: "ممتثل", color: 'green', icon: CheckCircle },
  partially_compliant: { label: 'Partially Compliant', labelAr: "ممتثل جزئيًا", color: 'orange', icon: AlertTriangle },
  non_compliant: { label: 'Non-Compliant', labelAr: "غير ممتثل", color: 'red', icon: XCircle },
  not_assessed: { label: 'Not Assessed', labelAr: "لم يُقيَّم", color: 'gray', icon: MinusCircle },
};

export const controlTestResultConfig: StatusConfig = {
  effective: { label: 'Effective', color: 'green', icon: CheckCircle },
  partially_effective: { label: 'Partially Effective', color: 'orange', icon: AlertTriangle },
  ineffective: { label: 'Ineffective', color: 'red', icon: XCircle },
  not_tested: { label: 'Not Tested', color: 'gray', icon: MinusCircle },
};

// Re-export icons that are referenced in status configs for convenience
export {
  Shield,
  User,
  Building2,
  File,
  GitBranch,
  Workflow,
};
