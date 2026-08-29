package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// LexAuditRecord is one immutable audit entry describing a lex operation. It maps
// onto the audit_db ledger columns (tenant_id, action, resource_type,
// resource_id, user_id, severity, detail) which the audit-service hash-chains on
// ingest (migrations/audit_db 000001).
type LexAuditRecord struct {
	TenantID     uuid.UUID
	ActorUserID  *uuid.UUID
	Action       string
	ResourceType string
	ResourceID   string
	Severity     string
	OldValue     map[string]any
	NewValue     map[string]any
	Detail       map[string]any
}

// LexAuditEmitter routes lex operations to the audit_db immutable hash-chained
// ledger (CAP-155/181). Rather than write the foreign audit_db schema directly
// (which would couple lex to the audit-service's table layout and chain-state),
// it publishes a structured audit event on the platform audit topic; the
// audit-service consumer is the single writer that appends to the ledger and
// maintains the hash chain. This keeps the lex suite decoupled from the
// audit-service internals while still producing tamper-evident records.
//
// The emitter is best-effort and never blocks or fails a business operation: a
// publish error is logged, not returned, mirroring writeEvent.
type LexAuditEmitter struct {
	publisher Publisher
	topic     string
	source    string
	logger    zerolog.Logger
	now       func() time.Time
}

// NewLexAuditEmitter builds the emitter. topic should be events.Topics.AuditEvents.
// When publisher is nil a no-op publisher is used so audit emission is safe in
// tests and offline modes.
func NewLexAuditEmitter(publisher Publisher, topic string, logger zerolog.Logger) *LexAuditEmitter {
	if strings.TrimSpace(topic) == "" {
		topic = events.Topics.AuditEvents
	}
	return &LexAuditEmitter{
		publisher: publisherOrNoop(publisher),
		topic:     topic,
		source:    "lex-service",
		logger:    logger.With().Str("component", "lex-audit-emitter").Logger(),
		now:       time.Now,
	}
}

// Emit publishes one audit record. Severity defaults to "info" when unset.
func (e *LexAuditEmitter) Emit(ctx context.Context, record LexAuditRecord) {
	if e == nil {
		return
	}
	severity := strings.TrimSpace(record.Severity)
	if severity == "" {
		severity = "info"
	}
	payload := map[string]any{
		"tenant_id":     record.TenantID.String(),
		"action":        record.Action,
		"resource_type": record.ResourceType,
		"resource_id":   record.ResourceID,
		"severity":      severity,
		"service":       "lex",
		"suite":         "lex",
		"product":       "watheeq",
		"recorded_at":   e.now().UTC().Format(time.RFC3339Nano),
	}
	if record.ActorUserID != nil {
		payload["user_id"] = record.ActorUserID.String()
	}
	if len(record.OldValue) > 0 {
		payload["old_value"] = record.OldValue
	}
	if len(record.NewValue) > 0 {
		payload["new_value"] = record.NewValue
	}
	if len(record.Detail) > 0 {
		payload["detail"] = record.Detail
	}

	event, err := events.NewEvent("com.clario360.audit.entry.recorded", e.source, record.TenantID.String(), payload)
	if err != nil {
		e.logger.Error().Err(err).Str("action", record.Action).Msg("build lex audit event")
		return
	}
	if record.ActorUserID != nil {
		event.UserID = record.ActorUserID.String()
	}
	event.Subject = record.ResourceType + "/" + record.ResourceID
	if event.Metadata == nil {
		event.Metadata = map[string]string{}
	}
	event.Metadata["tenant_id"] = record.TenantID.String()
	event.Metadata["action"] = record.Action
	event.Metadata["resource_type"] = record.ResourceType
	event.Metadata["suite"] = "lex"
	event.Metadata["severity"] = severity

	if err := e.publisher.Publish(ctx, e.topic, event); err != nil {
		e.logger.Error().Err(err).Str("action", record.Action).Msg("publish lex audit event")
	}
}
