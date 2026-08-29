from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import Field

from clario360.models.base import BaseModel


class Contract(BaseModel):
    id: str
    title: str
    status: Optional[str] = None
    counterparty: Optional[str] = None
    contract_number: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None
    party_a_name: Optional[str] = None
    party_b_name: Optional[str] = None
    total_value: Optional[float] = None
    currency: Optional[str] = None
    effective_date: Optional[str] = None
    expiry_date: Optional[str] = None
    expiration_date: Optional[str] = None
    owner_user_id: Optional[str] = None
    owner_name: Optional[str] = None
    risk_score: Optional[float] = None
    risk_level: Optional[str] = None
    analysis_status: Optional[str] = None
    current_version: Optional[int] = None
    workflow_instance_id: Optional[str] = None
    department: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class Clause(BaseModel):
    id: str
    title: Optional[str] = None
    contract_id: Optional[str] = None
    clause_type: Optional[str] = None
    risk_level: Optional[str] = None
    risk_score: Optional[float] = None
    text: Optional[str] = None
    content: Optional[str] = None
    section_reference: Optional[str] = None
    review_status: Optional[str] = None
    review_notes: Optional[str] = None
    recommendations: List[str] = Field(default_factory=list)
    compliance_flags: List[str] = Field(default_factory=list)


class ContractVersion(BaseModel):
    id: str
    contract_id: Optional[str] = None
    version: Optional[int] = None
    file_id: Optional[str] = None
    file_name: Optional[str] = None
    file_size_bytes: Optional[int] = None
    content_hash: Optional[str] = None
    change_summary: Optional[str] = None
    uploaded_at: Optional[str] = None


class RiskFinding(BaseModel):
    title: str
    description: Optional[str] = None
    severity: Optional[str] = None
    clause_reference: Optional[str] = None
    recommendation: Optional[str] = None
    clause_type: Optional[str] = None


class ComplianceFlag(BaseModel):
    code: str
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    clause_reference: Optional[str] = None


class ContractRiskAnalysis(BaseModel):
    id: str
    contract_id: Optional[str] = None
    contract_version: Optional[int] = None
    overall_risk: Optional[str] = None
    risk_score: Optional[float] = None
    clause_count: Optional[int] = None
    high_risk_clause_count: Optional[int] = None
    missing_clauses: List[str] = Field(default_factory=list)
    key_findings: List[RiskFinding] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    compliance_flags: List[ComplianceFlag] = Field(default_factory=list)
    analyzed_at: Optional[str] = None


class ContractDetail(BaseModel):
    contract: Optional[Contract] = None
    clauses: List[Clause] = Field(default_factory=list)
    latest_analysis: Optional[ContractRiskAnalysis] = None
    version_count: int = 0


class ContractBriefClause(BaseModel):
    id: str
    title: Optional[str] = None
    clause_type: Optional[str] = None
    section_reference: Optional[str] = None
    risk_level: Optional[str] = None
    risk_score: float = 0
    summary: Optional[str] = None


class ContractBriefRisk(BaseModel):
    title: str
    description: Optional[str] = None
    severity: Optional[str] = None
    clause_reference: Optional[str] = None
    recommendation: Optional[str] = None
    clause_type: Optional[str] = None


class ContractBriefSignal(BaseModel):
    label: str
    value: str
    source: Optional[str] = None


class ContractBrief(BaseModel):
    contract_id: str
    title: str
    type: Optional[str] = None
    status: Optional[str] = None
    counterparty: Optional[str] = None
    owner: Optional[str] = None
    value: Optional[float] = None
    currency: Optional[str] = None
    effective_date: Optional[str] = None
    expiry_date: Optional[str] = None
    renewal_date: Optional[str] = None
    executive_summary: Optional[str] = None
    risk_summary: Optional[str] = None
    risk_level: Optional[str] = None
    risk_score: Optional[float] = None
    top_clauses: List[ContractBriefClause] = Field(default_factory=list)
    top_risks: List[ContractBriefRisk] = Field(default_factory=list)
    obligations: List[ContractBriefSignal] = Field(default_factory=list)
    renewal_signals: List[ContractBriefSignal] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    generated_at: Optional[str] = None


class ContractSummary(BaseModel):
    id: str
    title: str
    type: Optional[str] = None
    status: Optional[str] = None
    party_b_name: Optional[str] = None
    risk_level: Optional[str] = None
    risk_score: Optional[float] = None
    expiry_date: Optional[str] = None
    current_version: Optional[int] = None
    created_at: Optional[str] = None


class ExpiringContractSummary(ContractSummary):
    days_until_expiry: Optional[int] = None
    owner_name: Optional[str] = None
    legal_reviewer_name: Optional[str] = None


class ContractRenewalWarning(BaseModel):
    contract_id: str
    title: str
    status: Optional[str] = None
    counterparty: Optional[str] = None
    owner: Optional[str] = None
    expiry_date: Optional[str] = None
    renewal_date: Optional[str] = None
    auto_renew: bool = False
    renewal_notice_days: int = 0
    configured_lead_days: int = 0
    trigger_date: Optional[str] = None
    days_until_trigger: int = 0
    days_until_expiry: int = 0
    severity: Optional[str] = None
    reason: Optional[str] = None


class ContractRenewalWarningSummary(BaseModel):
    tenant_id: Optional[str] = None
    generated_at: Optional[str] = None
    horizon_days: int = 0
    lead_days: int = 0
    total: int = 0
    urgent: int = 0
    warning: int = 0
    items: List[ContractRenewalWarning] = Field(default_factory=list)


class ContractClassificationResult(BaseModel):
    contract_id: str
    previous_type: Optional[str] = None
    recommended_type: Optional[str] = None
    applied_type: Optional[str] = None
    applied: bool = False
    confidence: float = 0
    matched_terms: List[str] = Field(default_factory=list)
    rationale: Optional[str] = None
    classified_at: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ContractTimelineEvent(BaseModel):
    id: str
    event_type: str
    title: str
    description: Optional[str] = None
    occurred_at: Optional[str] = None
    actor: Optional[str] = None
    source: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ContractTimeline(BaseModel):
    contract_id: str
    generated_at: Optional[str] = None
    events: List[ContractTimelineEvent] = Field(default_factory=list)


class ContractRedlineSegment(BaseModel):
    operation: str
    text: str
    base_line: Optional[int] = None
    target_line: Optional[int] = None


class ContractRedline(BaseModel):
    contract_id: str
    base_version: int
    target_version: int
    base_file_name: Optional[str] = None
    target_file_name: Optional[str] = None
    change_summary: Optional[str] = None
    segments: List[ContractRedlineSegment] = Field(default_factory=list)
    added_lines: int = 0
    removed_lines: int = 0
    generated_at: Optional[str] = None


class ContractReport(BaseModel):
    generated_at: Optional[str] = None
    total: int = 0
    filters: Dict[str, str] = Field(default_factory=dict)
    contracts: List[ContractSummary] = Field(default_factory=list)
    by_status: Dict[str, int] = Field(default_factory=dict)
    by_type: Dict[str, int] = Field(default_factory=dict)
    by_risk_level: Dict[str, int] = Field(default_factory=dict)


class LegalWorkflowSummary(BaseModel):
    workflow_instance_id: str
    task_id: Optional[str] = None
    contract_id: Optional[str] = None
    contract_title: Optional[str] = None
    contract_status: Optional[str] = None
    workflow_status: Optional[str] = None
    current_step_id: Optional[str] = None
    started_at: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_role: Optional[str] = None
    task_status: Optional[str] = None
    approval_policy: Dict[str, Any] = Field(default_factory=dict)
    delegation: Dict[str, Any] = Field(default_factory=dict)


class LegalWorkflowDecisionResult(BaseModel):
    workflow_instance_id: str
    task_id: str
    contract_id: str
    previous_contract_status: Optional[str] = None
    contract_status: Optional[str] = None
    workflow_status: Optional[str] = None
    task_status: Optional[str] = None
    decision: str
    decided_by: Optional[str] = None
    decided_at: Optional[str] = None
    notes: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    authority_evidence: Dict[str, Any] = Field(default_factory=dict)
    delegation: Dict[str, Any] = Field(default_factory=dict)


class LegalWorkflowBulkDecisionError(BaseModel):
    workflow_instance_id: str
    task_id: str
    code: str
    message: str


class LegalWorkflowBulkDecisionResult(BaseModel):
    decision: str
    requested: int = 0
    succeeded: int = 0
    failed: int = 0
    decided_by: Optional[str] = None
    decided_at: Optional[str] = None
    results: List[LegalWorkflowDecisionResult] = Field(default_factory=list)
    errors: List[LegalWorkflowBulkDecisionError] = Field(default_factory=list)


class ApprovalFormField(BaseModel):
    name: str
    type: str
    label: str
    required: bool = False
    options: List[str] = Field(default_factory=list)
    placeholder: Optional[str] = None
    description: Optional[str] = None


class ApprovalPolicyApprover(BaseModel):
    type: str
    ref: str
    label: Optional[str] = None


class ApprovalPolicy(BaseModel):
    id: str
    tenant_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    status: Optional[str] = None
    priority: int = 0
    contract_type: Optional[str] = None
    department: Optional[str] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    currency: Optional[str] = None
    mode: Optional[str] = None
    quorum: Optional[str] = None
    quorum_n: Optional[int] = None
    approvers: List[ApprovalPolicyApprover] = Field(default_factory=list)
    form_fields: List[ApprovalFormField] = Field(default_factory=list)
    require_authority_evidence: bool = False
    required_role: Optional[str] = None
    required_authority_amount: Optional[float] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ApprovalPolicyRecommendationResult(BaseModel):
    policy: Optional[ApprovalPolicy] = None
    matched: bool = False
    reason: str = ""


class ApprovalPolicyAnalyticsPolicy(BaseModel):
    policy_id: str
    name: str
    status: Optional[str] = None
    mode: Optional[str] = None
    quorum: Optional[str] = None
    quorum_n: Optional[int] = None
    require_authority_evidence: bool = False
    total_tasks: int = 0
    active_tasks: int = 0
    completed_tasks: int = 0
    rejected_tasks: int = 0
    cancelled_tasks: int = 0
    awaiting_quorum_tasks: int = 0
    average_decision_hours: Optional[float] = None
    last_task_at: Optional[str] = None


class ApprovalPolicyAnalytics(BaseModel):
    tenant_id: Optional[str] = None
    generated_at: Optional[str] = None
    total_policies: int = 0
    active_policies: int = 0
    draft_policies: int = 0
    archived_policies: int = 0
    total_routed_tasks: int = 0
    active_tasks: int = 0
    completed_tasks: int = 0
    rejected_tasks: int = 0
    cancelled_tasks: int = 0
    awaiting_quorum_tasks: int = 0
    average_decision_hours: Optional[float] = None
    policies: List[ApprovalPolicyAnalyticsPolicy] = Field(default_factory=list)


class ComplianceRule(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    rule_type: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict)
    contract_types: List[str] = Field(default_factory=list)
    enabled: Optional[bool] = None


class ComplianceAlert(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    status: Optional[str] = None
    severity: Optional[str] = None
    rule_id: Optional[str] = None
    contract_id: Optional[str] = None
    evidence: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None


class ComplianceDashboard(BaseModel):
    rules_by_type: Dict[str, int] = Field(default_factory=dict)
    alerts_by_status: Dict[str, int] = Field(default_factory=dict)
    alerts_by_severity: Dict[str, int] = Field(default_factory=dict)
    open_alerts: int = 0
    resolved_alerts: int = 0
    contracts_in_scope: int = 0
    compliance_score: float = 0
    calculated_at: Optional[str] = None


class ComplianceScore(BaseModel):
    tenant_id: Optional[str] = None
    score: float = 0
    open_alerts: int = 0
    resolved_alerts: int = 0
    rule_coverage: int = 0
    calculated_at: Optional[str] = None


class ComplianceRunResult(BaseModel):
    tenant_id: Optional[str] = None
    score: float = 0
    alerts_created: int = 0
    alerts: List[ComplianceAlert] = Field(default_factory=list)
    calculated_at: Optional[str] = None


class LegalDocument(BaseModel):
    id: str
    name: Optional[str] = None
    title: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    file_id: Optional[str] = None
    file_name: Optional[str] = None
    category: Optional[str] = None
    confidentiality: Optional[str] = None
    contract_id: Optional[str] = None
    current_version: Optional[int] = None
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DocumentFolderSummary(BaseModel):
    path: str
    document_count: int = 0
    privileged: int = 0
    archived: int = 0


class DocumentSavedViewSummary(BaseModel):
    name: str
    document_count: int = 0
    filters: Dict[str, Any] = Field(default_factory=dict)


class DocumentTaxonomySummary(BaseModel):
    dimension: str
    value: str
    document_count: int = 0


class DocumentRetentionSummary(BaseModel):
    with_policy: int = 0
    with_disposition: int = 0
    disposition_due: int = 0
    missing_policy: int = 0


class DocumentRepositorySummary(BaseModel):
    tenant_id: Optional[str] = None
    generated_at: Optional[str] = None
    total_documents: int = 0
    by_type: Dict[str, int] = Field(default_factory=dict)
    by_status: Dict[str, int] = Field(default_factory=dict)
    by_confidentiality: Dict[str, int] = Field(default_factory=dict)
    by_category: Dict[str, int] = Field(default_factory=dict)
    folders: List[DocumentFolderSummary] = Field(default_factory=list)
    saved_views: List[DocumentSavedViewSummary] = Field(default_factory=list)
    taxonomy: List[DocumentTaxonomySummary] = Field(default_factory=list)
    retention: DocumentRetentionSummary = Field(default_factory=DocumentRetentionSummary)


class DocumentBulkImportItemResult(BaseModel):
    index: int = 0
    status: str
    document_id: Optional[str] = None
    title: Optional[str] = None
    ocr_status: Optional[str] = None
    index_status: Optional[str] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DocumentBulkImportResult(BaseModel):
    batch_id: str
    source_system: Optional[str] = None
    requested: int = 0
    succeeded: int = 0
    failed: int = 0
    items: List[DocumentBulkImportItemResult] = Field(default_factory=list)


class DocumentVersion(BaseModel):
    id: str
    document_id: Optional[str] = None
    version: Optional[int] = None
    file_id: Optional[str] = None
    file_name: Optional[str] = None
    file_size_bytes: Optional[int] = None
    content_hash: Optional[str] = None
    change_summary: Optional[str] = None
    uploaded_at: Optional[str] = None


class MatterContract(BaseModel):
    id: str
    matter_id: Optional[str] = None
    contract_id: Optional[str] = None
    contract_title: Optional[str] = None
    relationship: Optional[str] = None
    created_at: Optional[str] = None


class Matter(BaseModel):
    id: str
    matter_number: Optional[str] = None
    title: str
    description: Optional[str] = None
    type: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    owner_user_id: Optional[str] = None
    owner_name: Optional[str] = None
    requester_user_id: Optional[str] = None
    requester_name: Optional[str] = None
    department: Optional[str] = None
    opened_at: Optional[str] = None
    due_date: Optional[str] = None
    closed_at: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    contracts: List[MatterContract] = Field(default_factory=list)


class MatterSummary(BaseModel):
    id: str
    matter_number: Optional[str] = None
    title: str
    type: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    owner_user_id: Optional[str] = None
    owner_name: Optional[str] = None
    department: Optional[str] = None
    opened_at: Optional[str] = None
    due_date: Optional[str] = None
    closed_at: Optional[str] = None
    created_at: Optional[str] = None


class MatterConflictIssue(BaseModel):
    severity: Optional[str] = None
    reasons: List[str] = Field(default_factory=list)
    matter_id: Optional[str] = None
    matter_title: Optional[str] = None
    contract_id: Optional[str] = None
    contract_title: Optional[str] = None
    matched_terms: List[str] = Field(default_factory=list)


class MatterConflictCheckResult(BaseModel):
    checked_at: Optional[str] = None
    conflicts: List[MatterConflictIssue] = Field(default_factory=list)
    warnings: List[MatterConflictIssue] = Field(default_factory=list)


class MatterReport(BaseModel):
    generated_at: Optional[str] = None
    total: int = 0
    filters: Dict[str, str] = Field(default_factory=dict)
    matters: List[MatterSummary] = Field(default_factory=list)
    by_status: Dict[str, int] = Field(default_factory=dict)
    by_type: Dict[str, int] = Field(default_factory=dict)
    by_priority: Dict[str, int] = Field(default_factory=dict)


class Obligation(BaseModel):
    id: str
    tenant_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    type: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    contract_id: Optional[str] = None
    contract_title: Optional[str] = None
    matter_id: Optional[str] = None
    matter_title: Optional[str] = None
    clause_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    owner_name: Optional[str] = None
    due_date: Optional[str] = None
    completed_at: Optional[str] = None
    reminder_enabled: Optional[bool] = None
    reminder_lead_days: List[int] = Field(default_factory=list)
    escalation_enabled: Optional[bool] = None
    escalation_lead_days: List[int] = Field(default_factory=list)
    escalation_target: Optional[str] = None
    last_reminder_at: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    deleted_at: Optional[str] = None
    days_until_due: Optional[int] = None


class ObligationSummary(BaseModel):
    id: str
    title: str
    type: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    owner_user_id: Optional[str] = None
    owner_name: Optional[str] = None
    contract_id: Optional[str] = None
    contract_title: Optional[str] = None
    matter_id: Optional[str] = None
    matter_title: Optional[str] = None
    due_date: Optional[str] = None
    days_until_due: Optional[int] = None
    completed_at: Optional[str] = None
    created_at: Optional[str] = None


class ObligationReport(BaseModel):
    generated_at: Optional[str] = None
    total: int = 0
    filters: Dict[str, str] = Field(default_factory=dict)
    obligations: List[ObligationSummary] = Field(default_factory=list)
    by_status: Dict[str, int] = Field(default_factory=dict)
    by_type: Dict[str, int] = Field(default_factory=dict)
    by_priority: Dict[str, int] = Field(default_factory=dict)
    overdue: int = 0
    due_soon: int = 0
    completed: int = 0


class ObligationNotificationEvent(BaseModel):
    event_id: str
    type: Optional[str] = None
    obligation_id: Optional[str] = None
    obligation_title: Optional[str] = None
    contract_id: Optional[str] = None
    contract_title: Optional[str] = None
    matter_id: Optional[str] = None
    matter_title: Optional[str] = None
    owner_user_id: Optional[str] = None
    owner_name: Optional[str] = None
    due_date: Optional[str] = None
    days_until_due: Optional[int] = None
    lead_days: Optional[int] = None
    planned_for: Optional[str] = None
    channel: Optional[str] = None
    escalation_target: Optional[str] = None
    reason: Optional[str] = None


class ObligationReminderPlan(BaseModel):
    as_of: Optional[str] = None
    horizon_days: int = 0
    total: int = 0
    events: List[ObligationNotificationEvent] = Field(default_factory=list)


class ObligationNotificationOutboxItem(BaseModel):
    id: str
    tenant_id: Optional[str] = None
    obligation_id: Optional[str] = None
    event_id: Optional[str] = None
    event_type: Optional[str] = None
    lead_days: Optional[int] = None
    channel: Optional[str] = None
    recipient_user_id: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_contact: Optional[str] = None
    scheduled_at: Optional[str] = None
    status: Optional[str] = None
    provider: Optional[str] = None
    provider_message_id: Optional[str] = None
    provider_metadata: Dict[str, Any] = Field(default_factory=dict)
    error_message: Optional[str] = None
    attempt_count: int = 0
    last_attempt_at: Optional[str] = None
    sent_at: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ObligationReminderEnqueueResult(BaseModel):
    plan: Optional[ObligationReminderPlan] = None
    requested_count: int = 0
    queued_count: int = 0
    skipped_duplicate_count: int = 0
    queued: List[ObligationNotificationOutboxItem] = Field(default_factory=list)


class ObligationReminderDispatchAttempt(BaseModel):
    outbox_id: str
    obligation_id: Optional[str] = None
    channel: Optional[str] = None
    previous_status: Optional[str] = None
    status: Optional[str] = None
    provider: Optional[str] = None
    provider_message_id: Optional[str] = None
    provider_metadata: Dict[str, Any] = Field(default_factory=dict)
    error_message: Optional[str] = None
    skipped_reason: Optional[str] = None
    item: Optional[ObligationNotificationOutboxItem] = None


class ObligationReminderDispatchResult(BaseModel):
    provider: Optional[str] = None
    retry: bool = False
    requested_count: int = 0
    dispatched_count: int = 0
    sent_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0
    attempts: List[ObligationReminderDispatchAttempt] = Field(default_factory=list)


class ObligationExtractionSkip(BaseModel):
    source: str
    title: Optional[str] = None
    reason: Optional[str] = None


class ObligationExtractionResult(BaseModel):
    contract_id: str
    created_count: int = 0
    created: List[Obligation] = Field(default_factory=list)
    skipped: List[ObligationExtractionSkip] = Field(default_factory=list)
    planned_notifications: List[ObligationNotificationEvent] = Field(default_factory=list)
    committed_at: Optional[str] = None
    deterministic_strategy: Optional[str] = None


class ClauseLibraryEntry(BaseModel):
    id: str
    code: str
    title_en: Optional[str] = None
    title_ar: Optional[str] = None
    text_en: Optional[str] = None
    text_ar: Optional[str] = None
    clause_type: Optional[str] = None
    category: Optional[str] = None
    jurisdiction: Optional[str] = None
    source: Optional[str] = None
    source_url: Optional[str] = None
    version: Optional[int] = None
    status: Optional[str] = None
    governance_status: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ClauseLibrarySearchResult(BaseModel):
    item: ClauseLibraryEntry
    score: float = 0
    matched_fields: List[str] = Field(default_factory=list)
    snippets: Dict[str, str] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RegulationClauseReference(BaseModel):
    id: str
    regulation_id: Optional[str] = None
    clause_id: Optional[str] = None
    reference_type: Optional[str] = None
    notes: Optional[str] = None
    clause_code: Optional[str] = None
    clause_title_en: Optional[str] = None
    clause_title_ar: Optional[str] = None


class Regulation(BaseModel):
    id: str
    code: str
    title_en: Optional[str] = None
    title_ar: Optional[str] = None
    description_en: Optional[str] = None
    description_ar: Optional[str] = None
    jurisdiction: Optional[str] = None
    authority: Optional[str] = None
    source: Optional[str] = None
    source_url: Optional[str] = None
    regulation_type: Optional[str] = None
    effective_date: Optional[str] = None
    version: Optional[int] = None
    status: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    clause_references: List[RegulationClauseReference] = Field(default_factory=list)


class RegulationSearchResult(BaseModel):
    item: Regulation
    score: float = 0
    matched_fields: List[str] = Field(default_factory=list)
    snippets: Dict[str, str] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SignatureRecipient(BaseModel):
    id: str
    envelope_id: Optional[str] = None
    user_id: Optional[str] = None
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    provider: Optional[str] = None
    method: Optional[str] = None
    signing_order: Optional[int] = None
    evidence_metadata: Dict[str, Any] = Field(default_factory=dict)


class SignatureEvent(BaseModel):
    id: str
    envelope_id: Optional[str] = None
    recipient_id: Optional[str] = None
    event_type: Optional[str] = None
    provider: Optional[str] = None
    provider_status: Optional[str] = None
    provider_event_id: Optional[str] = None
    provider_envelope_id: Optional[str] = None
    provider_recipient_id: Optional[str] = None
    actor_user_id: Optional[str] = None
    actor_name: Optional[str] = None
    actor_email: Optional[str] = None
    evidence_metadata: Dict[str, Any] = Field(default_factory=dict)
    occurred_at: Optional[str] = None


class SignatureCustodyEvidence(BaseModel):
    id: str
    envelope_id: Optional[str] = None
    file_id: str
    file_name: str
    file_size_bytes: Optional[int] = None
    content_hash: str
    seal_hash: Optional[str] = None
    evidence_hash: Optional[str] = None
    provider: Optional[str] = None
    signed_at: Optional[str] = None
    retention_metadata: Dict[str, Any] = Field(default_factory=dict)
    custody_metadata: Dict[str, Any] = Field(default_factory=dict)
    created_by: Optional[str] = None
    created_at: Optional[str] = None


class SignatureEnvelope(BaseModel):
    id: str
    target_type: Optional[str] = None
    contract_id: Optional[str] = None
    document_id: Optional[str] = None
    title: str
    subject: Optional[str] = None
    message: Optional[str] = None
    status: Optional[str] = None
    provider: Optional[str] = None
    method: Optional[str] = None
    due_at: Optional[str] = None
    expires_at: Optional[str] = None
    sent_at: Optional[str] = None
    completed_at: Optional[str] = None
    cancelled_at: Optional[str] = None
    cancellation_reason: Optional[str] = None
    evidence_hash: Optional[str] = None
    evidence_metadata: Dict[str, Any] = Field(default_factory=dict)
    recipients: List[SignatureRecipient] = Field(default_factory=list)
    events: List[SignatureEvent] = Field(default_factory=list)
    custody_evidence: List[SignatureCustodyEvidence] = Field(default_factory=list)


class LexDashboard(BaseModel):
    summary: Dict[str, Any] = Field(default_factory=dict)
    kpis: Dict[str, Any] = Field(default_factory=dict)
    contracts_by_type: Dict[str, int] = Field(default_factory=dict)
    contracts_by_status: Dict[str, int] = Field(default_factory=dict)
    expiring_contracts: List[ExpiringContractSummary] = Field(default_factory=list)
    high_risk_contracts: List[ContractSummary] = Field(default_factory=list)
    recent_contracts: List[ContractSummary] = Field(default_factory=list)
    compliance_alerts_by_status: Dict[str, int] = Field(default_factory=dict)
    total_contract_value: Dict[str, Any] = Field(default_factory=dict)
    monthly_activity: List[Dict[str, Any]] = Field(default_factory=list)
    calculated_at: Optional[str] = None


ClauseLibraryItem = ClauseLibraryEntry
RegulationLibraryItem = Regulation
RegulationLibrarySearchResult = RegulationSearchResult
