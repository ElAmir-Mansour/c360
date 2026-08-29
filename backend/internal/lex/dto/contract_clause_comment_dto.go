package dto

import "strings"

// CreateContractClauseCommentRequest creates a collaboration note on a contract
// clause (CAP-110). Mentions carry user IDs or display handles referenced by the
// note body or the client-side @mention picker so the frontend can render
// @mentions. ParentCommentID, when set, threads the note as a reply. Mirrors
// CreateMatterCommentRequest.
type CreateContractClauseCommentRequest struct {
	Body            string         `json:"body"`
	Mentions        []string       `json:"mentions,omitempty"`
	Metadata        map[string]any `json:"metadata"`
	ParentCommentID *string        `json:"parent_comment_id,omitempty"`
}

// UpdateContractClauseCommentRequest patches a collaboration note. Nil fields are
// left as-is. Mirrors UpdateMatterCommentRequest.
type UpdateContractClauseCommentRequest struct {
	Body     *string        `json:"body,omitempty"`
	Mentions []string       `json:"mentions,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

func (r *CreateContractClauseCommentRequest) Normalize() {
	r.Body = strings.TrimSpace(r.Body)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	if r.Mentions == nil {
		r.Mentions = []string{}
	}
	if r.ParentCommentID != nil {
		trimmed := strings.TrimSpace(*r.ParentCommentID)
		if trimmed == "" {
			r.ParentCommentID = nil
		} else {
			r.ParentCommentID = &trimmed
		}
	}
}

func (r *UpdateContractClauseCommentRequest) Normalize() {
	if r.Body != nil {
		body := strings.TrimSpace(*r.Body)
		r.Body = &body
	}
}
