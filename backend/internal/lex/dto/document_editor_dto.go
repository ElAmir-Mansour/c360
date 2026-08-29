package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

type OpenDocumentEditorSessionRequest struct {
	Mode            model.DocumentEditorMode `json:"mode"`
	Provider        string                   `json:"provider,omitempty"`
	Locale          string                   `json:"locale,omitempty"`
	UserDisplayName string                   `json:"user_display_name,omitempty"`
	DocumentURL     string                   `json:"document_url,omitempty"`
	CallbackURL     string                   `json:"callback_url,omitempty"`
	Options         map[string]any           `json:"options,omitempty"`
	BaseURL         string                   `json:"-"`
	RoutePrefix     string                   `json:"-"`
}

func (r *OpenDocumentEditorSessionRequest) Normalize() {
	r.Provider = strings.ToLower(strings.TrimSpace(r.Provider))
	if r.Provider == "" {
		r.Provider = "onlyoffice"
	}
	r.Locale = strings.TrimSpace(r.Locale)
	if r.Locale == "" {
		r.Locale = "en"
	}
	r.UserDisplayName = strings.TrimSpace(r.UserDisplayName)
	r.DocumentURL = strings.TrimSpace(r.DocumentURL)
	r.CallbackURL = strings.TrimSpace(r.CallbackURL)
	if r.Mode == "" {
		r.Mode = model.DocumentEditorModeView
	}
	if r.Options == nil {
		r.Options = map[string]any{}
	}
}

type AcquireDocumentEditorLockRequest struct {
	SessionID        *uuid.UUID     `json:"session_id,omitempty"`
	LockType         string         `json:"lock_type,omitempty"`
	Reason           string         `json:"reason,omitempty"`
	ExpiresInSeconds *int           `json:"expires_in_seconds,omitempty"`
	Metadata         map[string]any `json:"metadata,omitempty"`
}

func (r *AcquireDocumentEditorLockRequest) Normalize() {
	r.LockType = strings.ToLower(strings.TrimSpace(r.LockType))
	if r.LockType == "" {
		r.LockType = "checkout"
	}
	r.Reason = strings.TrimSpace(r.Reason)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

type ReleaseDocumentEditorLockRequest struct {
	SessionID *uuid.UUID `json:"session_id,omitempty"`
	Reason    string     `json:"reason,omitempty"`
}

func (r *ReleaseDocumentEditorLockRequest) Normalize() {
	r.Reason = strings.TrimSpace(r.Reason)
}

type DocumentEditorCallbackRequest struct {
	Status     int              `json:"status"`
	Key        string           `json:"key,omitempty"`
	URL        string           `json:"url,omitempty"`
	ChangesURL string           `json:"changesurl,omitempty"`
	Users      []string         `json:"users,omitempty"`
	Actions    []map[string]any `json:"actions,omitempty"`
	Error      int              `json:"error,omitempty"`
}

type SubmitDocumentEditorPreflightRequest struct {
	SessionID *uuid.UUID                     `json:"session_id,omitempty"`
	Status    string                         `json:"status"`
	Score     *float64                       `json:"score,omitempty"`
	Blocking  bool                           `json:"blocking"`
	Summary   string                         `json:"summary,omitempty"`
	Checks    []DocumentEditorPreflightCheck `json:"checks,omitempty"`
	Metadata  map[string]any                 `json:"metadata,omitempty"`
}

type RequestDocumentEditorSnapshotRequest struct {
	SessionID      *uuid.UUID     `json:"session_id,omitempty"`
	ChangeSummary  string         `json:"change_summary,omitempty"`
	CurrentVersion *int           `json:"current_version,omitempty"`
	Source         string         `json:"source,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

type RequestDocumentEditorGuestReviewLinkRequest struct {
	SessionID        *uuid.UUID               `json:"session_id,omitempty"`
	ReviewerName     string                   `json:"reviewer_name,omitempty"`
	ReviewerEmail    string                   `json:"reviewer_email"`
	Organization     string                   `json:"organization,omitempty"`
	AccessMode       model.DocumentEditorMode `json:"access_mode,omitempty"`
	Sections         []string                 `json:"sections,omitempty"`
	Message          string                   `json:"message,omitempty"`
	ExpiresInSeconds *int                     `json:"expires_in_seconds,omitempty"`
	Metadata         map[string]any           `json:"metadata,omitempty"`
}

type RequestDocumentEditorClauseAIActionRequest struct {
	SessionID        *uuid.UUID     `json:"session_id,omitempty"`
	Action           string         `json:"action"`
	ClauseID         *uuid.UUID     `json:"clause_id,omitempty"`
	ClauseType       string         `json:"clause_type,omitempty"`
	SectionReference string         `json:"section_reference,omitempty"`
	Prompt           string         `json:"prompt,omitempty"`
	Selection        map[string]any `json:"selection,omitempty"`
	Metadata         map[string]any `json:"metadata,omitempty"`
}

type RequestDocumentEditorPrivilegedControlRequest struct {
	SessionID      *uuid.UUID     `json:"session_id,omitempty"`
	Control        string         `json:"control"`
	RequestedState *bool          `json:"requested_state,omitempty"`
	Reason         string         `json:"reason"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

type DocumentEditorPreflightCheck struct {
	Key      string         `json:"key"`
	Status   string         `json:"status"`
	Severity string         `json:"severity,omitempty"`
	Message  string         `json:"message,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

func (r *SubmitDocumentEditorPreflightRequest) Normalize() {
	r.Status = strings.ToLower(strings.TrimSpace(r.Status))
	r.Summary = strings.TrimSpace(r.Summary)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	for idx := range r.Checks {
		r.Checks[idx].Key = strings.TrimSpace(r.Checks[idx].Key)
		r.Checks[idx].Status = strings.ToLower(strings.TrimSpace(r.Checks[idx].Status))
		r.Checks[idx].Severity = strings.ToLower(strings.TrimSpace(r.Checks[idx].Severity))
		r.Checks[idx].Message = strings.TrimSpace(r.Checks[idx].Message)
		if r.Checks[idx].Metadata == nil {
			r.Checks[idx].Metadata = map[string]any{}
		}
	}
}

func (r *RequestDocumentEditorSnapshotRequest) Normalize() {
	r.ChangeSummary = strings.TrimSpace(r.ChangeSummary)
	r.Source = strings.TrimSpace(r.Source)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *RequestDocumentEditorGuestReviewLinkRequest) Normalize() {
	r.ReviewerName = strings.TrimSpace(r.ReviewerName)
	r.ReviewerEmail = strings.ToLower(strings.TrimSpace(r.ReviewerEmail))
	r.Organization = strings.TrimSpace(r.Organization)
	r.Message = strings.TrimSpace(r.Message)
	if r.AccessMode == "" {
		r.AccessMode = model.DocumentEditorModeComment
	}
	r.Sections = normalizeEditorStringList(r.Sections)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *RequestDocumentEditorClauseAIActionRequest) Normalize() {
	r.Action = strings.ToLower(strings.TrimSpace(r.Action))
	r.ClauseType = strings.ToLower(strings.TrimSpace(r.ClauseType))
	r.SectionReference = strings.TrimSpace(r.SectionReference)
	r.Prompt = strings.TrimSpace(r.Prompt)
	if r.Selection == nil {
		r.Selection = map[string]any{}
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *RequestDocumentEditorPrivilegedControlRequest) Normalize() {
	r.Control = strings.ToLower(strings.TrimSpace(r.Control))
	r.Reason = strings.TrimSpace(r.Reason)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func normalizeEditorStringList(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}
