package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/events"
)

type Publisher interface {
	Publish(ctx context.Context, topic string, event *events.Event) error
}

type noopPublisher struct{}

func (noopPublisher) Publish(context.Context, string, *events.Event) error { return nil }

func publisherOrNoop(p Publisher) Publisher {
	if p == nil {
		return noopPublisher{}
	}
	return p
}

func validationError(message string, fields map[string]string) error {
	return apperrors.NewValidation("VALIDATION_ERROR", message, fields)
}

func notFoundError(message string) error {
	return apperrors.NewNotFound("NOT_FOUND", message)
}

func conflictError(message string) error {
	return apperrors.NewConflict("CONFLICT", message)
}

// conflictErrorWithFields is a 409 carrying a structured, non-sensitive details map
// (e.g. the mass-change guard summary) so the console can explain WHY the request
// was blocked. The fields are surfaced to the caller via the handler's writeError.
func conflictErrorWithFields(message string, fields map[string]string) error {
	err := apperrors.NewConflict("CONFLICT", message)
	err.Fields = fields
	return err
}

func forbiddenError(message string) error {
	return apperrors.NewForbidden("FORBIDDEN", message)
}

func internalError(message string, err error) error {
	return apperrors.NewInternal("INTERNAL_ERROR", message, err)
}

// requireDistinctDecisionAuthor enforces the dynamic-SoD invariant (author !=
// decider, design v2 §4.2) on an approval-DECISION service path whose decision
// route is gated by capability-key RBAC only (no URL-keyed lexmw.RequireDistinctActor
// at the router). It mirrors workflow_service.go validateWorkflowDecisionDistinctAuthor:
// the user who AUTHORED the record (its created_by) may not render the approve/reject
// verdict on it, REGARDLESS of the capability key they hold. Fails CLOSED — if the
// author cannot be resolved (zero UUID) the decision is rejected, so an unresolved
// author can never silently bypass the check. The `subject` string names the record
// type in the 403 message (e.g. "legal request", "pleading", "defendant case").
func requireDistinctDecisionAuthor(subject string, author, decider uuid.UUID) error {
	if author == uuid.Nil {
		return forbiddenError(subject + " author could not be resolved for separation-of-duties check")
	}
	if author == decider {
		return forbiddenError("you authored this " + subject + " and cannot decide its approval (separation of duties)")
	}
	return nil
}

func writeEvent(ctx context.Context, publisher Publisher, source, topic, eventType string, tenantID uuid.UUID, userID *uuid.UUID, payload any, logger zerolog.Logger) {
	event, err := events.NewEvent(eventType, source, tenantID.String(), payload)
	if err != nil {
		logger.Error().Err(err).Str("event_type", eventType).Msg("build lex event")
		return
	}
	event.Metadata = lexEventMetadata(event.Type, tenantID, userID, event.Metadata)
	event.Subject = lexEventSubject(event.Type, event.Data)
	if userID != nil {
		event.UserID = userID.String()
	}
	if err := publisher.Publish(ctx, topic, event); err != nil {
		logger.Error().Err(err).Str("topic", topic).Str("event_type", eventType).Msg("publish lex event")
	}
}

func lexEventMetadata(eventType string, tenantID uuid.UUID, userID *uuid.UUID, existing map[string]string) map[string]string {
	metadata := make(map[string]string, len(existing)+3)
	for key, value := range existing {
		metadata[key] = value
	}
	metadata["tenant_id"] = tenantID.String()
	metadata["action"] = lexEventAction(eventType)
	metadata["product"] = "watheeq"
	metadata["suite"] = "lex"
	if userID != nil {
		metadata["user_id"] = userID.String()
	}
	return metadata
}

func lexEventAction(eventType string) string {
	action := strings.TrimPrefix(eventType, "com.clario360.")
	action = strings.TrimPrefix(action, "lex.")
	return action
}

func lexEventSubject(eventType string, data []byte) string {
	resourceType := lexEventResourceType(eventType)
	resourceID := lexEventResourceID(data)
	if resourceType == "" || resourceID == "" {
		return ""
	}
	return resourceType + "/" + resourceID
}

func lexEventResourceType(eventType string) string {
	action := lexEventAction(eventType)
	head, _, _ := strings.Cut(action, ".")
	switch head {
	case "contracts":
		return "contract"
	case "documents":
		return "document"
	case "matters":
		return "matter"
	case "obligations", "obligation_reminder", "obligation_reminders":
		return "obligation"
	case "signatures":
		return "signature"
	case "workflows":
		return "workflow"
	default:
		return strings.TrimSuffix(head, "s")
	}
}

func lexEventResourceID(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return ""
	}
	for _, key := range []string{
		"id",
		"contract_id",
		"document_id",
		"matter_id",
		"obligation_id",
		"envelope_id",
		"workflow_instance_id",
		"task_id",
		"alert_id",
		"rule_id",
		"file_id",
	} {
		if id := stringValue(payload[key]); id != "" {
			return id
		}
	}
	return ""
}

func stringValue(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case fmt.Stringer:
		return strings.TrimSpace(v.String())
	default:
		return ""
	}
}

func httpStatus(err error) int {
	var appErr *apperrors.AppError
	if errors.As(err, &appErr) {
		return appErr.Status
	}
	return http.StatusInternalServerError
}

func clampScore(score float64) float64 {
	switch {
	case score < 0:
		return 0
	case score > 100:
		return 100
	default:
		return score
	}
}

func normalizeOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizeTextPointer(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizeDate(value time.Time) time.Time {
	return time.Date(value.UTC().Year(), value.UTC().Month(), value.UTC().Day(), 0, 0, 0, 0, time.UTC)
}

func changedFields(before, after map[string]any) []string {
	keys := make([]string, 0)
	for key, afterValue := range after {
		if fmt.Sprintf("%v", before[key]) != fmt.Sprintf("%v", afterValue) {
			keys = append(keys, key)
		}
	}
	return keys
}

// isUniqueViolation reports whether err is a Postgres unique-constraint
// violation (SQLSTATE 23505), used to translate duplicate inserts into a 409.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

// isUniqueViolationOn reports whether err is a Postgres unique-constraint
// violation (SQLSTATE 23505) raised by the named index/constraint. It backs
// idempotent handling that must distinguish a duplicate caught by a SPECIFIC
// unique index (a safe no-op) from any other unique violation (a real error).
func isUniqueViolationOn(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505" && pgErr.ConstraintName == constraint
	}
	return false
}
