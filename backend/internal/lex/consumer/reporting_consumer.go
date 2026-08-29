package consumer

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
)

// ReportingConsumer ingests lex CloudEvents (com.clario360.lex.*.*) off the
// LexEvents topic and upserts processing-time facts into the duration_fact store
// WITHOUT editing any sibling module's code. It reads the event envelope + payload
// and either writes directly from event timestamps or reconstructs bounds from
// canonical source rows when terminal events carry only IDs.
type durationFactWriter interface {
	UpsertFromTransition(ctx context.Context, tenantID uuid.UUID, req dto.UpsertDurationFactRequest) (*model.DurationFact, error)
	UpsertFromSource(ctx context.Context, tenantID uuid.UUID, kind model.DurationFactKind, subjectID uuid.UUID, occurredAt time.Time) (*model.DurationFact, error)
}

type ReportingConsumer struct {
	facts    durationFactWriter
	consumer *events.Consumer
	logger   zerolog.Logger
}

func NewReportingConsumer(facts *service.DurationFactService, consumer *events.Consumer, logger zerolog.Logger) *ReportingConsumer {
	handler := &ReportingConsumer{
		facts:    facts,
		consumer: consumer,
		logger:   logger.With().Str("component", "lex-reporting-consumer").Logger(),
	}
	if consumer != nil {
		consumer.Subscribe(events.Topics.LexEvents, handler)
	}
	return handler
}

func (c *ReportingConsumer) Start(ctx context.Context) error {
	if c.consumer == nil {
		return nil
	}
	return c.consumer.Start(ctx)
}

func (c *ReportingConsumer) Stop() error {
	if c.consumer == nil {
		return nil
	}
	return c.consumer.Stop()
}

// Handle maps a terminal lifecycle event to a duration fact. Only the terminal
// transitions that bound a processing window are acted on; everything else is a
// no-op so the consumer never errors on unrelated lex events.
func (c *ReportingConsumer) Handle(ctx context.Context, event *events.Event) error {
	if c.facts == nil || event == nil {
		return nil
	}
	tenantID, err := uuid.Parse(strings.TrimSpace(event.TenantID))
	if err != nil {
		return nil
	}

	var payload reportingEventPayload
	payloadMap := map[string]any{}
	if len(event.Data) > 0 {
		if err := json.Unmarshal(event.Data, &payload); err != nil {
			return nil
		}
		_ = json.Unmarshal(event.Data, &payloadMap)
	}
	kind, ok := factKindForEvent(event.Type, payload)
	if !ok {
		return nil
	}
	subjectID := payload.subjectID(kind, event.Subject)
	if subjectID == uuid.Nil {
		return nil
	}
	startedAt := payload.startedAt()
	endedAt := payload.endedAt(event.Time)
	if startedAt.IsZero() || endedAt.IsZero() {
		_, err := c.facts.UpsertFromSource(ctx, tenantID, kind, subjectID, payload.occurredAt(event.Time))
		if err != nil {
			c.logger.Warn().Err(err).Str("event_type", event.Type).Str("subject_id", subjectID.String()).Msg("upsert duration fact from source")
		}
		return nil
	}

	req := dto.UpsertDurationFactRequest{
		Kind:             kind,
		SubjectID:        subjectID,
		Department:       payload.department(),
		Category:         payload.category(),
		StartedAt:        startedAt,
		EndedAt:          endedAt,
		OccurredAt:       endedAt,
		SLATargetMinutes: payloadSLATargetMinutes(payloadMap),
		SLAOutcome:       payloadSLAOutcome(payloadMap),
	}
	if _, err := c.facts.UpsertFromTransition(ctx, tenantID, req); err != nil {
		c.logger.Warn().Err(err).Str("event_type", event.Type).Str("subject_id", subjectID.String()).Msg("upsert duration fact from event")
	}
	return nil
}

// factKindForEvent maps a terminal lex event type to the duration-fact kind it
// closes. Returns ok=false for non-terminal / unrelated events.
func factKindForEvent(eventType string, payload reportingEventPayload) (model.DurationFactKind, bool) {
	switch eventType {
	case "com.clario360.lex.legal_case.closed",
		"com.clario360.lex.case.closed":
		return model.DurationFactCaseResolution, true
	case "com.clario360.lex.legal_case.status_changed",
		"com.clario360.lex.case.status_changed":
		if isCaseTerminalStatus(payload.statusValue()) {
			return model.DurationFactCaseResolution, true
		}
	case "com.clario360.lex.contract.activated",
		"com.clario360.lex.contract.approved",
		"com.clario360.lex.contract.renewed":
		return model.DurationFactContractReview, true
	case "com.clario360.lex.contract.status_changed":
		if isContractTerminalStatus(payload.statusValue()) {
			return model.DurationFactContractReview, true
		}
	case "com.clario360.lex.consultation.responded",
		"com.clario360.lex.consultation.approved":
		return model.DurationFactConsultationAnswer, true
	case "com.clario360.lex.consultation.status_changed":
		if isConsultationTerminalStatus(payload.statusValue()) {
			return model.DurationFactConsultationAnswer, true
		}
	case "com.clario360.lex.legal_request.delivered",
		"com.clario360.lex.request.delivered",
		"com.clario360.lex.execution.delivered",
		"com.clario360.lex.execution.delivery_confirmed",
		"com.clario360.lex.execution.delivery_auto_closed":
		return model.DurationFactRequestProcessing, true
	case "com.clario360.lex.legal_request.status_changed",
		"com.clario360.lex.request.status_changed":
		if isRequestTerminalStatus(payload.statusValue()) {
			return model.DurationFactRequestProcessing, true
		}
	default:
		return "", false
	}
	return "", false
}

// reportingEventPayload is the tolerant subset of fields the consumer reads off a
// lex CloudEvent. It accepts several conventional key names so it works with the
// varied payloads the sibling modules already publish, without coupling to them.
type reportingEventPayload struct {
	ID              string `json:"id"`
	ContractID      string `json:"contract_id"`
	CaseID          string `json:"case_id"`
	ConsultationID  string `json:"consultation_id"`
	LegalRequestID  string `json:"legal_request_id"`
	RequestID       string `json:"request_id"`
	Department      string `json:"department"`
	CaseType        string `json:"case_type"`
	Type            string `json:"type"`
	Status          string `json:"status"`
	NewStatus       string `json:"new_status"`
	OldStatus       string `json:"old_status"`
	PreviousStatus  string `json:"previous_status"`
	CreatedAt       string `json:"created_at"`
	StartedAt       string `json:"started_at"`
	ClockStartedAt  string `json:"clock_started_at"`
	CompletedAt     string `json:"completed_at"`
	ClosedAt        string `json:"closed_at"`
	DeliveredAt     string `json:"delivered_at"`
	RespondedAt     string `json:"responded_at"`
	StatusChangedAt string `json:"status_changed_at"`
}

func (p reportingEventPayload) subjectID(kind model.DurationFactKind, eventSubject string) uuid.UUID {
	var candidates []string
	switch kind {
	case model.DurationFactRequestProcessing:
		candidates = []string{p.LegalRequestID, p.RequestID, p.ID, eventSubject}
	case model.DurationFactContractReview:
		candidates = []string{p.ContractID, p.ID, eventSubject}
	case model.DurationFactCaseResolution:
		candidates = []string{p.CaseID, p.ID, eventSubject}
	case model.DurationFactConsultationAnswer:
		candidates = []string{p.ConsultationID, p.ID, eventSubject}
	default:
		candidates = []string{p.ID, eventSubject}
	}
	for _, raw := range candidates {
		if id, err := uuid.Parse(strings.TrimSpace(raw)); err == nil && id != uuid.Nil {
			return id
		}
	}
	return uuid.Nil
}

func (p reportingEventPayload) startedAt() time.Time {
	return firstTime(p.StartedAt, p.ClockStartedAt, p.CreatedAt)
}

func (p reportingEventPayload) endedAt(fallback time.Time) time.Time {
	if t := firstTime(p.ClosedAt, p.DeliveredAt, p.RespondedAt, p.CompletedAt, p.StatusChangedAt); !t.IsZero() {
		return t
	}
	return fallback.UTC()
}

func (p reportingEventPayload) occurredAt(fallback time.Time) time.Time {
	if t := p.endedAt(fallback); !t.IsZero() {
		return t
	}
	return fallback.UTC()
}

func (p reportingEventPayload) department() *string {
	if v := strings.TrimSpace(p.Department); v != "" {
		return &v
	}
	return nil
}

func (p reportingEventPayload) category() *string {
	for _, raw := range []string{p.CaseType, p.Type} {
		if v := strings.TrimSpace(raw); v != "" {
			return &v
		}
	}
	return nil
}

func (p reportingEventPayload) statusValue() string {
	for _, raw := range []string{p.NewStatus, p.Status} {
		if v := strings.ToLower(strings.TrimSpace(raw)); v != "" {
			return v
		}
	}
	return ""
}

func isCaseTerminalStatus(status string) bool {
	return status == "closed"
}

func isContractTerminalStatus(status string) bool {
	return status == "active" || status == "renewed"
}

func isConsultationTerminalStatus(status string) bool {
	return status == "responded" || status == "approved" || status == "archived"
}

func isRequestTerminalStatus(status string) bool {
	return status == "delivered" || status == "closed"
}

func firstTime(values ...string) time.Time {
	for _, raw := range values {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02"} {
			if t, err := time.Parse(layout, raw); err == nil {
				return t.UTC()
			}
		}
	}
	return time.Time{}
}

func payloadSLATargetMinutes(values map[string]any) *int {
	if minutes, ok := payloadInt(values, "sla_target_minutes", "target_minutes"); ok {
		v := int(minutes)
		if v < 0 {
			v = 0
		}
		return &v
	}
	if seconds, ok := payloadInt(values, "sla_target_seconds", "target_seconds"); ok {
		v := int((seconds + 59) / 60)
		if v < 0 {
			v = 0
		}
		return &v
	}
	return nil
}

func payloadSLAOutcome(values map[string]any) *model.SLAClockOutcome {
	for _, key := range []string{"sla_outcome", "outcome"} {
		raw, ok := values[key]
		if !ok {
			continue
		}
		text, ok := raw.(string)
		if !ok {
			continue
		}
		outcome := model.SLAClockOutcome(strings.ToLower(strings.TrimSpace(text)))
		if outcome.Valid() {
			return &outcome
		}
	}
	return nil
}

func payloadInt(values map[string]any, keys ...string) (int64, bool) {
	for _, key := range keys {
		raw, ok := values[key]
		if !ok {
			continue
		}
		switch v := raw.(type) {
		case int:
			return int64(v), true
		case int32:
			return int64(v), true
		case int64:
			return v, true
		case float64:
			return int64(v), true
		case json.Number:
			if out, err := v.Int64(); err == nil {
				return out, true
			}
		case string:
			if out, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil {
				return out, true
			}
		}
	}
	return 0, false
}
