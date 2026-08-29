package dto

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// ReportQuery is the parsed, normalized query envelope shared by all Phase-4
// report endpoints (CAP-133..151). The handler builds it from URL query params;
// the service validates/clamps it and passes it down to the repositories.
type ReportQuery struct {
	// From / To bound the source rows by their primary timestamp (case created_at,
	// contract created_at, consultation created_at, request clock_started_at, SLA
	// clock clock_started_at). Both optional; To is treated as inclusive end-of-day
	// when only a date is supplied.
	From *time.Time
	To   *time.Time
	// Department / Status / Type narrow the scope when set (trimmed; empty => unset).
	Department *string
	Status     *string
	Type       *string
	// Quarters limits the flagship SLA-compliance report to the most recent N
	// quarters (default 4, clamped to [1, 12]).
	Quarters int
}

// AsModelFilters projects the query into the read-side ReportFilters echoed back
// in every report payload.
func (q ReportQuery) AsModelFilters() model.ReportFilters {
	return model.ReportFilters{
		From:       q.From,
		To:         q.To,
		Department: q.Department,
		Status:     q.Status,
		Type:       q.Type,
	}
}

// UpsertDurationFactRequest is the input to
// DurationFactService.UpsertFromTransition. It is built from a lifecycle event
// (CloudEvent payload via the reporting consumer, or an in-process call) and is
// idempotent on (tenant_id, kind, subject_id).
type UpsertDurationFactRequest struct {
	Kind             model.DurationFactKind `json:"kind"`
	SubjectID        uuid.UUID              `json:"subject_id"`
	Department       *string                `json:"department,omitempty"`
	Category         *string                `json:"category,omitempty"`
	StartedAt        time.Time              `json:"started_at"`
	EndedAt          time.Time              `json:"ended_at"`
	OccurredAt       time.Time              `json:"occurred_at"`
	SLATargetMinutes *int                   `json:"sla_target_minutes,omitempty"`
	SLAOutcome       *model.SLAClockOutcome `json:"sla_outcome,omitempty"`
}
