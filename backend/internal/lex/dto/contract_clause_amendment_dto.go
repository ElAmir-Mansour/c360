package dto

import (
	"strings"

	"github.com/clario360/platform/internal/lex/model"
)

// ProposeClauseAmendmentRequest proposes a redlined revision of a clause's text
// (CAP-111). original_text is optional: when blank the service snapshots the
// clause's current content so the redline view always has a left-hand baseline.
// proposed_by + status are derived server-side (never trusted from the client).
type ProposeClauseAmendmentRequest struct {
	ProposedText string `json:"proposed_text"`
	OriginalText string `json:"original_text,omitempty"`
	Reason       string `json:"reason,omitempty"`
}

func (r *ProposeClauseAmendmentRequest) Normalize() {
	r.ProposedText = strings.TrimSpace(r.ProposedText)
	r.OriginalText = strings.TrimSpace(r.OriginalText)
	r.Reason = strings.TrimSpace(r.Reason)
}

// DecideClauseAmendmentRequest accepts or rejects a proposed amendment. Status
// must be one of accepted|rejected; decided_by/decided_at are stamped
// server-side from the JWT + clock.
type DecideClauseAmendmentRequest struct {
	Status model.ClauseAmendmentStatus `json:"status"`
}

func (r *DecideClauseAmendmentRequest) Normalize() {
	r.Status = model.ClauseAmendmentStatus(strings.ToLower(strings.TrimSpace(string(r.Status))))
}
