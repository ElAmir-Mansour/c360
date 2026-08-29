package dto

import (
	"strings"
	"time"

	"github.com/clario360/platform/internal/lex/model"
)

// CreateRequestNoteRequest posts an internal collaboration note against a legal
// request. Mentions carry user IDs or display handles referenced by the note
// body or the client-side @mention picker so the frontend can render @mentions.
// Mirrors CreateMatterCommentRequest.
type CreateRequestNoteRequest struct {
	Body     string   `json:"body"`
	Mentions []string `json:"mentions,omitempty"`
}

func (r *CreateRequestNoteRequest) Normalize() {
	r.Body = strings.TrimSpace(r.Body)
	if r.Mentions == nil {
		r.Mentions = []string{}
	}
}

// RequestNoteResponse is the transport projection of a persisted request note.
type RequestNoteResponse struct {
	ID         string    `json:"id"`
	TenantID   string    `json:"tenant_id"`
	RequestID  string    `json:"request_id"`
	Body       string    `json:"body"`
	Mentions   []string  `json:"mentions"`
	AuthorID   string    `json:"author_id"`
	AuthorName string    `json:"author_name"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// NewRequestNoteResponse maps a persisted note into its transport shape.
func NewRequestNoteResponse(n model.RequestNote) RequestNoteResponse {
	mentions := n.Mentions
	if mentions == nil {
		mentions = []string{}
	}
	return RequestNoteResponse{
		ID:         n.ID.String(),
		TenantID:   n.TenantID.String(),
		RequestID:  n.RequestID.String(),
		Body:       n.Body,
		Mentions:   mentions,
		AuthorID:   n.AuthorID.String(),
		AuthorName: n.AuthorName,
		CreatedAt:  n.CreatedAt,
		UpdatedAt:  n.UpdatedAt,
	}
}

// NewRequestNoteResponses maps a slice of persisted notes into transport shape,
// always returning a non-nil slice so the JSON payload is `[]` when empty.
func NewRequestNoteResponses(notes []model.RequestNote) []RequestNoteResponse {
	out := make([]RequestNoteResponse, 0, len(notes))
	for _, n := range notes {
		out = append(out, NewRequestNoteResponse(n))
	}
	return out
}
