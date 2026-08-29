package model

import (
	"time"

	"github.com/google/uuid"
)

// JudgmentRecommendation is the legal-affairs recommendation after studying a
// judgment (CAP-063..066): object (file an appeal/objection) or accept (no
// objection). pending is the pre-study default.
type JudgmentRecommendation string

const (
	JudgmentRecommendationPending JudgmentRecommendation = "pending"
	JudgmentRecommendationObject  JudgmentRecommendation = "object"
	JudgmentRecommendationAccept  JudgmentRecommendation = "accept"
)

// Valid reports whether the recommendation is one of the allowed values.
func (r JudgmentRecommendation) Valid() bool {
	switch r {
	case JudgmentRecommendationPending, JudgmentRecommendationObject, JudgmentRecommendationAccept:
		return true
	default:
		return false
	}
}

// JudgmentOutcome records the disposition of the case in the recorded judgment.
type JudgmentOutcome string

const (
	JudgmentOutcomeWon     JudgmentOutcome = "won"
	JudgmentOutcomeLost    JudgmentOutcome = "lost"
	JudgmentOutcomePartial JudgmentOutcome = "partial"
	JudgmentOutcomeOther   JudgmentOutcome = "other"
)

// Valid reports whether the outcome is one of the allowed values.
func (o JudgmentOutcome) Valid() bool {
	switch o {
	case JudgmentOutcomeWon, JudgmentOutcomeLost, JudgmentOutcomePartial, JudgmentOutcomeOther:
		return true
	default:
		return false
	}
}

type JudgmentDecisionType string

const (
	JudgmentDecisionTypeInterim       JudgmentDecisionType = "interim"
	JudgmentDecisionTypeFirstInstance JudgmentDecisionType = "first_instance"
	JudgmentDecisionTypeSubstantive   JudgmentDecisionType = "substantive_ruling"
	JudgmentDecisionTypeFinal         JudgmentDecisionType = "final"
	JudgmentDecisionTypeAppeal        JudgmentDecisionType = "appeal"
	JudgmentDecisionTypeCassation     JudgmentDecisionType = "cassation"
	JudgmentDecisionTypeEnforcement   JudgmentDecisionType = "enforcement"
	JudgmentDecisionTypeOther         JudgmentDecisionType = "other"
)

func (t JudgmentDecisionType) Valid() bool {
	switch t {
	case JudgmentDecisionTypeInterim, JudgmentDecisionTypeFirstInstance,
		JudgmentDecisionTypeSubstantive, JudgmentDecisionTypeFinal, JudgmentDecisionTypeAppeal,
		JudgmentDecisionTypeCassation, JudgmentDecisionTypeEnforcement,
		JudgmentDecisionTypeOther:
		return true
	default:
		return false
	}
}

type JudgmentImpact string

const (
	JudgmentImpactPositive JudgmentImpact = "positive"
	JudgmentImpactNegative JudgmentImpact = "negative"
	JudgmentImpactNeutral  JudgmentImpact = "neutral"
	JudgmentImpactMixed    JudgmentImpact = "mixed"
)

func (i JudgmentImpact) Valid() bool {
	switch i {
	case JudgmentImpactPositive, JudgmentImpactNegative, JudgmentImpactNeutral, JudgmentImpactMixed:
		return true
	default:
		return false
	}
}

// LegalJudgment records and studies a court judgment on a litigation case
// (CAP-063..066). case_id FKs legal_cases. The legal team studies the judgment and
// records an objection / non-objection recommendation; when objecting, an
// objection_deadline is set and a linked legal_obligation (obligation_id) is created
// so the EXISTING obligation reminder outbox fires the deadline reminder — no new
// timer is introduced.
type LegalJudgment struct {
	ID                   uuid.UUID              `json:"id"`
	TenantID             uuid.UUID              `json:"tenant_id"`
	CaseID               uuid.UUID              `json:"case_id"`
	JudgmentRef          string                 `json:"judgment_ref"`
	JudgmentDate         *time.Time             `json:"judgment_date,omitempty"`
	DecisionType         JudgmentDecisionType   `json:"decision_type"`
	Impact               *JudgmentImpact        `json:"impact,omitempty"`
	JudgeName            *string                `json:"judge_name,omitempty"`
	CourtName            *string                `json:"court_name,omitempty"`
	Outcome              *JudgmentOutcome       `json:"outcome,omitempty"`
	Summary              string                 `json:"summary"`
	Implications         string                 `json:"implications"`
	StudyNotes           string                 `json:"study_notes"`
	Recommendation       JudgmentRecommendation `json:"recommendation"`
	ObjectionDeadline    *time.Time             `json:"objection_deadline,omitempty"`
	ObligationID         *uuid.UUID             `json:"obligation_id,omitempty"`
	StudiedBy            *uuid.UUID             `json:"studied_by,omitempty"`
	StudiedAt            *time.Time             `json:"studied_at,omitempty"`
	FileID               *uuid.UUID             `json:"file_id,omitempty"`
	DocumentReference    *string                `json:"document_reference,omitempty"`
	NextExpectedRulingAt *time.Time             `json:"next_expected_ruling_at,omitempty"`
	NextExpectedRuling   *string                `json:"next_expected_ruling,omitempty"`
	Metadata             map[string]any         `json:"metadata"`
	CreatedBy            uuid.UUID              `json:"created_by"`
	CreatedAt            time.Time              `json:"created_at"`
	UpdatedAt            time.Time              `json:"updated_at"`
	DeletedAt            *time.Time             `json:"deleted_at,omitempty"`
}

// LegalJudgmentListFilters carries the validated query parameters for the judgment
// list endpoint (scoped to a case).
type LegalJudgmentListFilters struct {
	Page           int
	PerPage        int
	Search         string
	Recommendation *JudgmentRecommendation
	SortColumn     string
	SortDirection  string
}
