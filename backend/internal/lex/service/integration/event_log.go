package integration

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// Observability feature #17 — inbound-event inspector + replay.
//
// Every verified INBOUND event a webhook accepts (Nafath etc.) — and every
// synthetic/test loop — is logged by EventLog.RecordEvent as one row carrying
// the kind, signature_valid flag, lifecycle status (received | processed |
// failed), the resulting lex action, a REDACTED payload, and a sanitized error.
// The payload is REDACTED here (secret-field schema + defensive key fragments)
// BEFORE it reaches storage, so secrets / PII are NEVER persisted in cleartext.
//
// List / Get back the console inspector; Replay re-dispatches an inbound event
// through the connector via the EventDispatcher seam (the registry satisfies it,
// keeping this package free of an import cycle on package service).
// =============================================================================

// Event direction + status domains (mirror the repository constants / migration
// CHECKs) re-exported on the service surface.
const (
	EventDirectionInbound  = repository.EventDirectionInbound
	EventDirectionOutbound = repository.EventDirectionOutbound

	EventStatusReceived  = repository.EventStatusReceived
	EventStatusProcessed = repository.EventStatusProcessed
	EventStatusFailed    = repository.EventStatusFailed
)

// IntegrationEvent is one inbound-event record surfaced to the admin console (the
// API twin of repository.IntegrationEventRow). PayloadRedacted is the REDACTED
// payload (secrets/PII already stripped); the JSON shape matches the pinned
// observability API exactly.
type IntegrationEvent struct {
	ID              uuid.UUID      `json:"id"`
	EndpointID      uuid.UUID      `json:"endpoint_id"`
	Direction       string         `json:"direction"`
	Kind            string         `json:"kind"`
	SignatureValid  bool           `json:"signature_valid"`
	Status          string         `json:"status"`
	ResultAction    string         `json:"result_action"`
	PayloadRedacted map[string]any `json:"payload_redacted"`
	Error           string         `json:"error"`
	OccurredAt      time.Time      `json:"occurred_at"`
}

// EventReplayResult is the outcome of replaying ONE inbound event.
type EventReplayResult struct {
	ID     uuid.UUID `json:"id"`
	OK     bool      `json:"ok"`
	Status string    `json:"status"`
	Detail string    `json:"detail"`
}

// EventDispatcher is the seam EventLog.Replay uses to RE-DISPATCH an inbound event
// through the connector. The IntegrationRegistryService satisfies it (it re-runs
// the connector's inbound loop for the recorded kind, e.g. re-verifying / re-
// processing a Nafath event). Taking it as a narrow interface keeps this package
// free of an import cycle on package service. The redacted payload + kind are
// passed; the registry re-resolves any plaintext config itself.
type EventDispatcher interface {
	// DispatchInboundEvent re-processes a previously-received inbound event. It
	// returns a sanitized result action + detail and an error on failure.
	DispatchInboundEvent(ctx context.Context, tenantID, userID, endpointID uuid.UUID, kind model.IntegrationKind, payload map[string]any) (action, detail string, err error)
}

// EventLog records inbound integration events and replays them. It is a thin
// service over IntegrationEventRepository plus the per-kind ConfigSchema (for
// payload redaction) and an optional EventDispatcher (for replay). A nil repo
// makes RecordEvent a safe no-op and List/Get return empty so the webhook ack
// never fails just because the event log is unwired.
type EventLog struct {
	repo       *repository.IntegrationEventRepository
	dispatcher EventDispatcher
	logger     zerolog.Logger
	now        func() time.Time
}

// NewEventLog builds the event log over the repository. The EventDispatcher is
// wired separately via WithDispatcher (it is the registry, which holds the event
// log — a construction cycle resolved by the setter). now defaults to time.Now
// (UTC).
func NewEventLog(repo *repository.IntegrationEventRepository, logger zerolog.Logger) *EventLog {
	return &EventLog{
		repo:   repo,
		logger: logger.With().Str("component", "lex-integration-events").Logger(),
		now:    func() time.Time { return time.Now().UTC() },
	}
}

// WithDispatcher wires the replay dispatcher (the registry) after both are
// constructed. Returns the receiver for chaining. A nil dispatcher disables
// Replay (List/Get/Record still work; Replay reports the dispatcher is unwired).
func (s *EventLog) WithDispatcher(dispatcher EventDispatcher) *EventLog {
	if s != nil {
		s.dispatcher = dispatcher
	}
	return s
}

// RecordEvent logs ONE inbound event. It REDACTS the payload against the endpoint
// kind's secret-field schema + defensive key fragments BEFORE persisting (so a
// payload that echoed a credential / PII never lands in cleartext), then writes a
// row with the signature-valid flag, status, and the resulting lex action.
// Best-effort: a nil repo or a write error is logged and swallowed so the caller
// (the webhook handler) never fails the inbound ack just because the event could
// not be logged. Returns the recorded event id (uuid.Nil when not recorded).
func (s *EventLog) RecordEvent(ctx context.Context, endpoint model.IntegrationEndpoint, direction, kind string, payload map[string]any, sigValid bool, status, resultAction string) uuid.UUID {
	if s == nil || s.repo == nil {
		return uuid.Nil
	}
	if strings.TrimSpace(kind) == "" {
		kind = string(endpoint.Kind)
	}
	row := &repository.IntegrationEventRow{
		TenantID:       endpoint.TenantID,
		EndpointID:     endpoint.ID,
		Direction:      normalizeDirection(direction),
		Kind:           kind,
		SignatureValid: sigValid,
		Status:         normalizeEventStatus(status),
		ResultAction:   strings.TrimSpace(resultAction),
		Payload:        RedactPayloadForKind(endpoint.Kind, payload),
		Error:          "",
	}
	if row.Status == EventStatusFailed {
		// A failed event carries the redacted result action as the operator-safe
		// error breadcrumb (connectors already sanitize their detail).
		row.Error = strings.TrimSpace(resultAction)
	}
	if err := s.repo.Record(ctx, row); err != nil {
		s.logger.Error().Err(err).Str("endpoint_id", endpoint.ID.String()).Msg("record integration inbound event")
		return uuid.Nil
	}
	return row.ID
}

// List returns the inbound-event rows for ONE endpoint (tenant-scoped), newest
// first, filtered by the optional direction/kind/status. Returns an empty slice
// when the repo is unwired.
func (s *EventLog) List(ctx context.Context, tenantID, endpointID uuid.UUID, f repository.IntegrationEventFilter) ([]IntegrationEvent, error) {
	if s == nil || s.repo == nil {
		return []IntegrationEvent{}, nil
	}
	rows, err := s.repo.ListByEndpoint(ctx, tenantID, endpointID, f)
	if err != nil {
		return nil, err
	}
	return mapEvents(rows), nil
}

// ListAll returns the inbound-event rows ACROSS every endpoint for a tenant,
// newest first, filtered by the optional direction/kind/status. Returns an empty
// slice when the repo is unwired.
func (s *EventLog) ListAll(ctx context.Context, tenantID uuid.UUID, f repository.IntegrationEventFilter) ([]IntegrationEvent, error) {
	if s == nil || s.repo == nil {
		return []IntegrationEvent{}, nil
	}
	rows, err := s.repo.ListByTenant(ctx, tenantID, f)
	if err != nil {
		return nil, err
	}
	return mapEvents(rows), nil
}

// Get loads ONE event (tenant-scoped). Returns pgx.ErrNoRows when absent for the
// tenant (the registry maps it to a 404).
func (s *EventLog) Get(ctx context.Context, tenantID, id uuid.UUID) (*IntegrationEvent, error) {
	if s == nil || s.repo == nil {
		return nil, pgx.ErrNoRows
	}
	row, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	ev := mapEvent(*row)
	return &ev, nil
}

// Replay RE-DISPATCHES ONE inbound event through the connector. It loads the row
// (tenant-scoped, pgx.ErrNoRows on absence), re-processes it via the dispatcher
// for the recorded kind + REDACTED payload, then records a NEW event row marking
// the replay outcome (status processed | failed, result_action the dispatcher's
// action) so the inspector shows the replay as its own event. The returned
// EventReplayResult is sanitized. A nil dispatcher reports an unwired replay path.
// Only INBOUND events are replayable (an outbound delivery is not re-processed
// here).
func (s *EventLog) Replay(ctx context.Context, tenantID, userID, eventID uuid.UUID) (EventReplayResult, error) {
	if s == nil || s.repo == nil {
		return EventReplayResult{}, pgx.ErrNoRows
	}
	row, err := s.repo.Get(ctx, tenantID, eventID)
	if err != nil {
		return EventReplayResult{}, err
	}
	res := EventReplayResult{ID: row.ID}
	if row.Direction != EventDirectionInbound {
		res.OK = false
		res.Status = row.Status
		res.Detail = "only inbound events can be replayed"
		return res, nil
	}
	if s.dispatcher == nil {
		res.OK = false
		res.Status = row.Status
		res.Detail = "event replay dispatcher is not wired"
		return res, nil
	}
	endpoint := model.IntegrationEndpoint{
		ID:       row.EndpointID,
		TenantID: tenantID,
		Kind:     model.IntegrationKind(row.Kind),
	}
	action, detail, derr := s.dispatcher.DispatchInboundEvent(
		ctx, tenantID, userID, row.EndpointID, model.IntegrationKind(row.Kind), row.Payload)
	status := EventStatusProcessed
	if derr != nil {
		status = EventStatusFailed
		res.OK = false
		res.Detail = sanitizeEventError(derr)
		if strings.TrimSpace(action) == "" {
			action = "replay_failed"
		}
	} else {
		res.OK = true
		res.Detail = firstNonEmptyEvent(detail, "replayed successfully")
		if strings.TrimSpace(action) == "" {
			action = "replayed"
		}
	}
	res.Status = status
	// The replay is itself an inbound event: record it (signature was already
	// verified at original receipt, so the replay carries the original's
	// signature_valid=true). Payload is re-redacted defensively.
	s.RecordEvent(ctx, endpoint, EventDirectionInbound, row.Kind, row.Payload, row.SignatureValid, status, action)
	return res, nil
}

// mapEvents maps storage rows to API IntegrationEvent structs. The stored payload
// is already redacted at write time; this is a straight field copy.
func mapEvents(rows []repository.IntegrationEventRow) []IntegrationEvent {
	out := make([]IntegrationEvent, 0, len(rows))
	for i := range rows {
		out = append(out, mapEvent(rows[i]))
	}
	return out
}

func mapEvent(row repository.IntegrationEventRow) IntegrationEvent {
	return IntegrationEvent{
		ID:              row.ID,
		EndpointID:      row.EndpointID,
		Direction:       row.Direction,
		Kind:            row.Kind,
		SignatureValid:  row.SignatureValid,
		Status:          row.Status,
		ResultAction:    row.ResultAction,
		PayloadRedacted: orEmpty(row.Payload),
		Error:           row.Error,
		OccurredAt:      row.OccurredAt,
	}
}

func normalizeDirection(d string) string {
	if strings.TrimSpace(strings.ToLower(d)) == EventDirectionOutbound {
		return EventDirectionOutbound
	}
	return EventDirectionInbound
}

func normalizeEventStatus(s string) string {
	switch strings.TrimSpace(strings.ToLower(s)) {
	case EventStatusProcessed:
		return EventStatusProcessed
	case EventStatusFailed:
		return EventStatusFailed
	default:
		return EventStatusReceived
	}
}

func sanitizeEventError(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func firstNonEmptyEvent(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// IsEventNotFound reports whether an error is the repository's not-found sentinel,
// so a caller can map a missing event row to a 404.
func IsEventNotFound(err error) bool {
	return err == pgx.ErrNoRows
}
