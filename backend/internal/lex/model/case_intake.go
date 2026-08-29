package model

import (
	"time"

	"github.com/google/uuid"
)

// CaseIntakePhase tracks where a case sits in the two-phase intake pipeline
// (CAP-032..036). Phase 1 runs the administrative directive/approval chain up the
// org hierarchy with DoA-to-CEO authority evidence; Phase 2 is the Legal Director
// → Section Manager handoff (task estimation + officer/supervisor assignment).
type CaseIntakePhase string

const (
	CaseIntakePhasePhase1   CaseIntakePhase = "phase1"
	CaseIntakePhasePhase2   CaseIntakePhase = "phase2"
	CaseIntakePhaseComplete CaseIntakePhase = "complete"
)

// Valid reports whether the phase is a known intake phase.
func (p CaseIntakePhase) Valid() bool {
	switch p {
	case CaseIntakePhasePhase1, CaseIntakePhasePhase2, CaseIntakePhaseComplete:
		return true
	default:
		return false
	}
}

// CaseIntake is the singleton-per-case intake tracking record (CAP-032..036). It
// records the Phase-1 directive approval chain (CEO directive reference + DoA
// authority-evidence reference + the case-strength assessment), and the Phase-2
// handoff bookkeeping (task estimation + officer/supervisor assignment). The
// per-task decision audit lives on the workflow primitives + the case audit log;
// this row is the durable phase-state summary the case service drives off.
type CaseIntake struct {
	ID                 uuid.UUID       `json:"id"`
	TenantID           uuid.UUID       `json:"tenant_id"`
	CaseID             uuid.UUID       `json:"case_id"`
	Phase              CaseIntakePhase `json:"phase"`
	Phase1StartedAt    *time.Time      `json:"phase1_started_at,omitempty"`
	Phase1CompletedAt  *time.Time      `json:"phase1_completed_at,omitempty"`
	Phase2StartedAt    *time.Time      `json:"phase2_started_at,omitempty"`
	Phase2CompletedAt  *time.Time      `json:"phase2_completed_at,omitempty"`
	CEODirectiveRef    *string         `json:"ceo_directive_ref,omitempty"`
	DoAAuthorityRef    *string         `json:"doa_authority_ref,omitempty"`
	StrengthAssessment *CaseStrength   `json:"strength_assessment,omitempty"`
	TaskEstimate       *string         `json:"task_estimate,omitempty"`
	WorkflowInstanceID *uuid.UUID      `json:"workflow_instance_id,omitempty"`
	Metadata           map[string]any  `json:"metadata"`
	CreatedBy          uuid.UUID       `json:"created_by"`
	CreatedAt          time.Time       `json:"created_at"`
	UpdatedAt          time.Time       `json:"updated_at"`
}
