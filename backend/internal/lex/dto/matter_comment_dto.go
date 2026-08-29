package dto

import "strings"

// CreateMatterCommentRequest creates a collaboration note on a matter. Mentions
// carry user IDs or display handles referenced by the note body or the client-side
// @mention picker so the frontend can render @mentions. Mirrors
// CreateCaseCommentRequest.
type CreateMatterCommentRequest struct {
	Body     string         `json:"body"`
	Mentions []string       `json:"mentions,omitempty"`
	Metadata map[string]any `json:"metadata"`
}

// UpdateMatterCommentRequest patches a collaboration note. Nil fields are left
// as-is. Mirrors UpdateCaseCommentRequest.
type UpdateMatterCommentRequest struct {
	Body     *string        `json:"body,omitempty"`
	Mentions []string       `json:"mentions,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

func (r *CreateMatterCommentRequest) Normalize() {
	r.Body = strings.TrimSpace(r.Body)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	if r.Mentions == nil {
		r.Mentions = []string{}
	}
}

func (r *UpdateMatterCommentRequest) Normalize() {
	if r.Body != nil {
		body := strings.TrimSpace(*r.Body)
		r.Body = &body
	}
}
