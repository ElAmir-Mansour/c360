package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// settlement_dto.go carries the request/response contracts for BOTH Phase-3
// modules owned by this vertical: Settlements / ADR (CAP-089..093) and Case
// Timelines (CAP-084..088). (The Timelines module has no dedicated dto file in the
// assigned file set, so its small request shapes live here alongside settlements.)

// =============================================================================
// Case Timelines (CAP-084..088)
// =============================================================================

// UpdateMatterTimelineRequest sets the estimated-duration / completion projection
// on a matter (CAP-084). Both fields are optional pointers so a caller can clear a
// value by sending an explicit null is NOT supported here — omit to leave
// unchanged; the service treats a non-nil pointer as the new value.
type UpdateMatterTimelineRequest struct {
	EstimatedDurationDays   *int       `json:"estimated_duration_days,omitempty"`
	EstimatedCompletionDate *time.Time `json:"estimated_completion_date,omitempty"`
	// ClearEstimate, when true, nulls both estimate columns regardless of the
	// pointers above (explicit clear).
	ClearEstimate bool `json:"clear_estimate,omitempty"`
}

// SetExternalHoldRequest flags/clears the external-pending state on a matter
// (CAP-087). When Held is true a Category is required (CAP-088).
type SetExternalHoldRequest struct {
	Held     bool                 `json:"held"`
	Category *model.DelayCategory `json:"category,omitempty"`
	Reason   string               `json:"reason,omitempty"`
	Since    *time.Time           `json:"since,omitempty"`
}

// RecordDelayEventRequest opens a classified delay window on a matter (CAP-086).
type RecordDelayEventRequest struct {
	Category model.DelayCategory `json:"category"`
	Reason   string              `json:"reason"`
	OpenedAt *time.Time          `json:"opened_at,omitempty"`
	// AlsoMarkExternalHold, when true, also flips the matter into external-pending
	// with the same category (CAP-087 convenience).
	AlsoMarkExternalHold bool           `json:"also_mark_external_hold,omitempty"`
	Metadata             map[string]any `json:"metadata,omitempty"`
}

// ResolveDelayEventRequest closes an open delay window (CAP-086).
type ResolveDelayEventRequest struct {
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	// AlsoClearExternalHold, when true, also clears the matter external-pending
	// flag if no other open delay windows remain.
	AlsoClearExternalHold bool `json:"also_clear_external_hold,omitempty"`
}

// UpdateDelayEventRequest edits the category and/or reason of an existing delay
// event (#13). Both fields are optional pointers: omit a field to leave it
// unchanged; at least one must be present.
type UpdateDelayEventRequest struct {
	Category *model.DelayCategory `json:"category,omitempty"`
	Reason   *string              `json:"reason,omitempty"`
}

// CreateDeadlineObligationRequest is the HTTP body for creating a matter deadline
// obligation (#10/#11). It wraps CaseTimelineService.CreateDeadlineObligation:
// the service auto-tracks the deadline via the existing obligation reminder
// outbox/monitor (no new timer). OwnerUserID defaults to the caller when omitted.
type CreateDeadlineObligationRequest struct {
	// Kind classifies the deadline (e.g. "hearing", "objection"); recorded in
	// metadata and tags. Defaults to "deadline" when empty.
	Kind string `json:"kind,omitempty"`
	// Title is the obligation title; a default is derived from Kind when empty.
	Title string `json:"title,omitempty"`
	// DueDate is the hearing/objection date (required).
	DueDate time.Time `json:"due_date"`
	// OwnerUserID is the responsible user; defaults to the caller when nil.
	OwnerUserID *uuid.UUID `json:"owner_user_id,omitempty"`
	OwnerName   string     `json:"owner_name,omitempty"`
	// LeadDays are reminder lead-times in days; defaults to [7, 1] when empty.
	LeadDays []int `json:"lead_days,omitempty"`
}

func (r *CreateDeadlineObligationRequest) Normalize() {
	r.Kind = strings.ToLower(strings.TrimSpace(r.Kind))
	if r.Kind == "" {
		r.Kind = "deadline"
	}
	r.Title = strings.TrimSpace(r.Title)
	r.OwnerName = strings.TrimSpace(r.OwnerName)
}

func (r *RecordDelayEventRequest) Normalize() {
	r.Category = model.DelayCategory(strings.ToLower(strings.TrimSpace(string(r.Category))))
	r.Reason = strings.TrimSpace(r.Reason)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *UpdateDelayEventRequest) Normalize() {
	if r.Category != nil {
		c := model.DelayCategory(strings.ToLower(strings.TrimSpace(string(*r.Category))))
		r.Category = &c
	}
	if r.Reason != nil {
		trimmed := strings.TrimSpace(*r.Reason)
		r.Reason = &trimmed
	}
}

func (r *SetExternalHoldRequest) Normalize() {
	r.Reason = strings.TrimSpace(r.Reason)
	if r.Category != nil {
		c := model.DelayCategory(strings.ToLower(strings.TrimSpace(string(*r.Category))))
		r.Category = &c
	}
}

// =============================================================================
// Settlements / ADR (CAP-089..093)
// =============================================================================

// OpenReconciliationRequest opens a reconciliation/settlement attempt on a matter
// (CAP-089). The settlement starts in status=proposed.
type OpenReconciliationRequest struct {
	MatterID             uuid.UUID              `json:"matter_id"`
	Reference            *string                `json:"reference,omitempty"`
	Method               model.SettlementMethod `json:"method"`
	Title                string                 `json:"title"`
	Terms                string                 `json:"terms"`
	Value                *float64               `json:"value,omitempty"`
	Currency             *string                `json:"currency,omitempty"`
	CounterpartyName     *string                `json:"counterparty_name,omitempty"`
	CounterpartyContact  *string                `json:"counterparty_contact,omitempty"`
	CounterpartyIDNumber *string                `json:"counterparty_id_number,omitempty"`
	Metadata             map[string]any         `json:"metadata,omitempty"`
}

// RecordSettlementRequest records/updates the negotiated settlement terms
// (CAP-090). It is applied to an existing settlement that is still mutable.
type RecordSettlementRequest struct {
	Reference            *string                 `json:"reference,omitempty"`
	Method               *model.SettlementMethod `json:"method,omitempty"`
	Title                *string                 `json:"title,omitempty"`
	Terms                *string                 `json:"terms,omitempty"`
	Value                *float64                `json:"value,omitempty"`
	Currency             *string                 `json:"currency,omitempty"`
	CounterpartyName     *string                 `json:"counterparty_name,omitempty"`
	CounterpartyContact  *string                 `json:"counterparty_contact,omitempty"`
	CounterpartyIDNumber *string                 `json:"counterparty_id_number,omitempty"`
	Metadata             map[string]any          `json:"metadata,omitempty"`
}

// AddNegotiationRoundRequest appends one negotiation round (CAP-091).
type AddNegotiationRoundRequest struct {
	ProposedBy    string         `json:"proposed_by"`
	ProposedValue *float64       `json:"proposed_value,omitempty"`
	Currency      *string        `json:"currency,omitempty"`
	Terms         string         `json:"terms"`
	Outcome       string         `json:"outcome,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
}

func (r *OpenReconciliationRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.Terms = strings.TrimSpace(r.Terms)
	r.Method = model.SettlementMethod(strings.ToLower(strings.TrimSpace(string(r.Method))))
	if r.Method == "" {
		r.Method = model.SettlementMethodReconciliation
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *AddNegotiationRoundRequest) Normalize() {
	r.ProposedBy = strings.TrimSpace(r.ProposedBy)
	r.Terms = strings.TrimSpace(r.Terms)
	r.Outcome = strings.TrimSpace(r.Outcome)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}
