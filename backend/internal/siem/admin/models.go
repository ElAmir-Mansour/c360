package admin

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ParserStatus is the lifecycle state for a tenant parser definition.
type ParserStatus string

const (
	ParserStatusDraft   ParserStatus = "draft"
	ParserStatusActive  ParserStatus = "active"
	ParserStatusRetired ParserStatus = "retired"
)

var (
	ErrNotFound     = errors.New("siem admin: not found")
	ErrConflict     = errors.New("siem admin: conflict")
	ErrValidation   = errors.New("siem admin: validation failed")
	ErrInvalidState = errors.New("siem admin: invalid state")
)

// FieldError is a single validation failure suitable for JSON error envelopes.
type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// FieldErrors carries one or more validation failures.
type FieldErrors struct {
	Errors []FieldError
}

func (f *FieldErrors) Error() string {
	if f == nil || len(f.Errors) == 0 {
		return "validation failed"
	}
	if len(f.Errors) == 1 {
		return f.Errors[0].Field + ": " + f.Errors[0].Message
	}
	return "validation failed: multiple field errors"
}

func (f *FieldErrors) Unwrap() error { return ErrValidation }

// Parser is the JSON shape for rows in siem.parsers.
type Parser struct {
	ID         uuid.UUID       `json:"id"`
	TenantID   uuid.UUID       `json:"tenant_id"`
	Name       string          `json:"name"`
	SourceType string          `json:"source_type"`
	Version    string          `json:"version"`
	Status     ParserStatus    `json:"status"`
	ECSVersion string          `json:"ecs_version"`
	Config     json.RawMessage `json:"config"`
	Fixtures   json.RawMessage `json:"fixtures"`
	SHA256     string          `json:"sha256"`
	CreatedBy  uuid.UUID       `json:"created_by"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
	RetiredAt  *time.Time      `json:"retired_at,omitempty"`
}

type ParserCreateInput struct {
	TenantID   uuid.UUID
	Name       string
	SourceType string
	Version    string
	ECSVersion string
	Config     json.RawMessage
	Fixtures   json.RawMessage
	CreatedBy  uuid.UUID
}

type ParserUpdateInput struct {
	Name       *string
	SourceType *string
	Version    *string
	ECSVersion *string
	Config     *json.RawMessage
	Fixtures   *json.RawMessage
}

type ParserListQuery struct {
	Status     *ParserStatus
	SourceType *string
	Limit      int
}

// Settings is the tenant-level SIEM administration policy.
type Settings struct {
	TenantID         uuid.UUID `json:"tenant_id"`
	RetentionDays    int       `json:"retention_days"`
	ParserCIRequired bool      `json:"parser_ci_required"`
	HSMRequired      bool      `json:"hsm_required"`
	WarmTierDays     int       `json:"warm_tier_days"`
	ColdTierEnabled  bool      `json:"cold_tier_enabled"`
	UpdatedBy        uuid.UUID `json:"updated_by,omitempty"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type SettingsInput struct {
	TenantID         uuid.UUID
	RetentionDays    int
	ParserCIRequired bool
	HSMRequired      bool
	WarmTierDays     int
	ColdTierEnabled  bool
	UpdatedBy        uuid.UUID
}
