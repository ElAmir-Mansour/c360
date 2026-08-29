package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

type Queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

type Store struct {
	db         *pgxpool.Pool
	Contracts  *ContractRepository
	Clauses    *ClauseRepository
	Documents  *DocumentRepository
	Compliance *ComplianceRepository
	Libraries  *LibraryRepository
	// ReferenceLibraries backs the GLOBAL, read-only WatheeqTech reference catalog
	// (no tenant_id). Provisioned only by cmd/reference-library-seed.
	ReferenceLibraries       *ReferenceLibraryRepository
	ReferenceLibraryFeedback *ReferenceLibraryFeedbackRepository
	Alerts                   *AlertRepository
	Matters                  *MatterRepository
	Obligations              *ObligationRepository
	Signatures               *SignatureRepository
	Playbooks                *PlaybookRepository
	Prompts                  *PromptTemplateRepository
	LegalHolds               *LegalHoldRepository
	PolicyGov                *ApprovalPolicyGovernanceRepository
	DraftReviews             *DraftReviewRepository

	WorkingCalendars        *WorkingCalendarRepository
	OrgEntities             *OrgEntityRepository
	LegalRequests           *LegalRequestRepository
	LegalRequestAttachments *LegalRequestAttachmentRepository
	RequestApprovalPolicies *RequestApprovalPolicyRepository

	// Phase 1: Service Catalog & Intake.
	ServiceCatalog  *ServiceCatalogRepository
	IntakeMailboxes *IntakeMailboxRepository
	IntakeMessages  *IntakeMessageRepository

	// Phase 1: SLA / Acknowledgement / Escalation.
	SLATargets *SLATargetRepository
	SLAClocks  *SLAClockRepository
	SLAOutbox  *SLAOutboxRepository

	// Phase 1: Execution Rules (owns execution-state/requirement/review/delivery/audit).
	Execution *ExecutionRepository

	// Phase 2: Litigation Case Management (LegalCase aggregate) + Case Classification.
	LegalCases          *LegalCaseRepository
	CaseParties         *CasePartyRepository
	CaseHearings        *CaseHearingRepository
	CaseTasks           *CaseTaskRepository
	CaseComments        *CaseCommentRepository
	CaseDocuments       *CaseDocumentRepository
	CaseIntakes         *CaseIntakeRepository
	CaseClassifications *CaseClassificationRepository
	LegalCourts         *LegalCourtRepository

	// Phase 3: Plaintiff/Defendant litigation flows (pleadings, experts+hearing
	// reports, judgments, defendant cases) extending the LegalCase aggregate.
	Pleadings  *LegalPleadingRepository
	Experts    *LegalExpertRepository
	Judgments  *LegalJudgmentRepository
	Defendants *LegalDefendantRepository

	// Phase 3: Investigations (root + parties/statements/evidence/audit).
	Investigations *InvestigationRepository

	// Phase 3: Legal Consultations.
	Consultations   *ConsultationRepository
	ManagerTasks    *ManagerTaskRepository
	SupportRequests *SupportRequestRepository

	// Phase 3: Case Timelines (external delay/hold) + Settlements/ADR.
	CaseDelays  *CaseDelayRepository
	Settlements *SettlementRepository

	// Phase 3: Contracts review-desk (intake/attachments/correspondence/recommendations).
	ContractIntakes         *ContractIntakeRepository
	ContractAttachments     *ContractAttachmentRepository
	ContractCorrespondence  *ContractCorrespondenceRepository
	ContractRecommendations *ContractRecommendationRepository

	// Phase 4: Reporting & KPIs (read-mostly analytics + consumer-populated facts).
	Reporting       *ReportingRepository
	DurationFacts   *DurationFactRepository
	Workforce       *WorkforceRepository
	WorkforceScopes *WorkforceScopeRepository

	// Phase 4: Notification triggers + in-app inbox + per-user subscriptions.
	NotificationInbox         *NotificationInboxRepository
	NotificationSubscriptions *NotificationSubscriptionRepository

	// Phase 4: Cross-cutting (attachment policies, document FTS, integration registry).
	AttachmentPolicies   *AttachmentPolicyRepository
	IntegrationEndpoints *IntegrationEndpointRepository
	DocumentSearch       *DocumentSearchRepository
	DocumentEditors      *DocumentEditorRepository
}

func NewStore(db *pgxpool.Pool, logger zerolog.Logger) *Store {
	return &Store{
		db:                       db,
		Contracts:                NewContractRepository(db, logger),
		Clauses:                  NewClauseRepository(db, logger),
		Documents:                NewDocumentRepository(db, logger),
		Compliance:               NewComplianceRepository(db, logger),
		Libraries:                NewLibraryRepository(db, logger),
		ReferenceLibraries:       NewReferenceLibraryRepository(db, logger),
		ReferenceLibraryFeedback: NewReferenceLibraryFeedbackRepository(db, logger),
		Alerts:                   NewAlertRepository(db, logger),
		Matters:                  NewMatterRepository(db, logger),
		Obligations:              NewObligationRepository(db, logger),
		Signatures:               NewSignatureRepository(db, logger),
		Playbooks:                NewPlaybookRepository(db, logger),
		Prompts:                  NewPromptTemplateRepository(db, logger),
		LegalHolds:               NewLegalHoldRepository(db, logger),
		PolicyGov:                NewApprovalPolicyGovernanceRepository(db, logger),
		DraftReviews:             NewDraftReviewRepository(db, logger),

		WorkingCalendars:        NewWorkingCalendarRepository(db, logger),
		OrgEntities:             NewOrgEntityRepository(db, logger),
		LegalRequests:           NewLegalRequestRepository(db, logger),
		LegalRequestAttachments: NewLegalRequestAttachmentRepository(db, logger),
		RequestApprovalPolicies: NewRequestApprovalPolicyRepository(db, logger),

		ServiceCatalog:  NewServiceCatalogRepository(db, logger),
		IntakeMailboxes: NewIntakeMailboxRepository(db, logger),
		IntakeMessages:  NewIntakeMessageRepository(db, logger),

		SLATargets: NewSLATargetRepository(db, logger),
		SLAClocks:  NewSLAClockRepository(db, logger),
		SLAOutbox:  NewSLAOutboxRepository(db, logger),

		Execution: NewExecutionRepository(db, logger),

		LegalCases:          NewLegalCaseRepository(db, logger),
		CaseParties:         NewCasePartyRepository(db, logger),
		CaseHearings:        NewCaseHearingRepository(db, logger),
		CaseTasks:           NewCaseTaskRepository(db, logger),
		CaseComments:        NewCaseCommentRepository(db, logger),
		CaseDocuments:       NewCaseDocumentRepository(db, logger),
		CaseIntakes:         NewCaseIntakeRepository(db, logger),
		CaseClassifications: NewCaseClassificationRepository(db, logger),
		LegalCourts:         NewLegalCourtRepository(db, logger),

		Pleadings:  NewLegalPleadingRepository(db, logger),
		Experts:    NewLegalExpertRepository(db, logger),
		Judgments:  NewLegalJudgmentRepository(db, logger),
		Defendants: NewLegalDefendantRepository(db, logger),

		Investigations: NewInvestigationRepository(db, logger),

		Consultations:   NewConsultationRepository(db, logger),
		ManagerTasks:    NewManagerTaskRepository(db, logger),
		SupportRequests: NewSupportRequestRepository(db, logger),

		CaseDelays:  NewCaseDelayRepository(db, logger),
		Settlements: NewSettlementRepository(db, logger),

		ContractIntakes:         NewContractIntakeRepository(db, logger),
		ContractAttachments:     NewContractAttachmentRepository(db, logger),
		ContractCorrespondence:  NewContractCorrespondenceRepository(db, logger),
		ContractRecommendations: NewContractRecommendationRepository(db, logger),

		Reporting:       NewReportingRepository(db, logger),
		DurationFacts:   NewDurationFactRepository(db, logger),
		Workforce:       NewWorkforceRepository(db),
		WorkforceScopes: NewWorkforceScopeRepository(db),

		NotificationInbox:         NewNotificationInboxRepository(db, logger),
		NotificationSubscriptions: NewNotificationSubscriptionRepository(db, logger),

		AttachmentPolicies:   NewAttachmentPolicyRepository(db, logger),
		IntegrationEndpoints: NewIntegrationEndpointRepository(db, logger),
		DocumentSearch:       NewDocumentSearchRepository(db, logger),
		DocumentEditors:      NewDocumentEditorRepository(db, logger),
	}
}

func (s *Store) DB() *pgxpool.Pool {
	if s == nil {
		return nil
	}
	return s.db
}

func queryRowJSON[T any](ctx context.Context, q Queryer, query string, args ...any) (*T, error) {
	var raw []byte
	if err := q.QueryRow(ctx, query, args...).Scan(&raw); err != nil {
		return nil, err
	}
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("unmarshal row json: %w", err)
	}
	return &out, nil
}

func queryListJSON[T any](ctx context.Context, q Queryer, query string, args ...any) ([]T, error) {
	rows, err := q.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]T, 0)
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item T
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, fmt.Errorf("unmarshal row json: %w", err)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func buildWhere(base []string, filters ...string) string {
	conditions := make([]string, 0, len(base)+len(filters))
	conditions = append(conditions, base...)
	for _, filter := range filters {
		if strings.TrimSpace(filter) != "" {
			conditions = append(conditions, filter)
		}
	}
	return strings.Join(conditions, " AND ")
}
