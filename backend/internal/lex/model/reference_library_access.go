package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Reference-library access-log actions (the `action` column of
// reference_library_access_log). Downloads are per-document; ask/search are
// corpus-wide Second-Brain proxy calls (document_id is nil).
const (
	ReferenceLibraryActionDownload = "download"
	ReferenceLibraryActionAsk      = "ask"
	ReferenceLibraryActionSearch   = "search"
)

// ReferenceLibraryAccessEntry is one durable per-access audit row for the global
// reference library (WatheeqTech_Library_Design.md §4). It records WHO read WHAT,
// WHEN, from WHERE, and the terminal outcome — the byte-source-independent audit
// trail covering both the mounted-volume path and the Second-Brain LLM surface.
type ReferenceLibraryAccessEntry struct {
	ID          uuid.UUID  `json:"id"`
	DocumentID  *uuid.UUID `json:"document_id,omitempty"`
	Action      string     `json:"action"`
	TenantID    *uuid.UUID `json:"tenant_id,omitempty"`
	UserID      *uuid.UUID `json:"user_id,omitempty"`
	UserEmail   string     `json:"user_email"`
	ClientIP    string     `json:"client_ip"`
	UserAgent   string     `json:"user_agent"`
	ByteSource  string     `json:"byte_source"`
	Outcome     string     `json:"outcome"`
	BytesServed int64      `json:"bytes_served"`
	QueryHash   string     `json:"query_hash"`
	QuerySample string     `json:"query_sample"`
	StatusCode  int        `json:"status_code"`
	CreatedAt   time.Time  `json:"created_at"`
}

// Reference-library ask-feedback ratings (the `rating` column of
// reference_library_ask_feedback). A thumbs up/down on a Second-Brain /ask answer.
const (
	ReferenceLibraryRatingUp   = "up"
	ReferenceLibraryRatingDown = "down"
)

// ReferenceLibraryAskFeedbackEntry is one durable answer-quality signal for a
// Second-Brain /ask answer (WatheeqTech_Library_Design.md §7 P2). It records WHO
// rated (TenantID + UserID, for attribution), WHAT they asked (Question), the
// Rating, an optional Comment, and the Citations the graded answer cited. Citations
// is stored verbatim as JSONB so the feedback keeps the exact grounding the reader
// judged. It carries no free text beyond the operator-supplied comment.
type ReferenceLibraryAskFeedbackEntry struct {
	ID        uuid.UUID       `json:"id"`
	TenantID  *uuid.UUID      `json:"tenant_id,omitempty"`
	UserID    *uuid.UUID      `json:"user_id,omitempty"`
	Question  string          `json:"question"`
	Rating    string          `json:"rating"`
	Comment   string          `json:"comment"`
	Citations json.RawMessage `json:"citations,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}
