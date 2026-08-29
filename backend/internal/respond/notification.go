package respond

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	notifmodel "github.com/clario360/platform/internal/notification/model"
	notifservice "github.com/clario360/platform/internal/notification/service"
)

var (
	ErrNotificationDispatchInvalid    = errors.New("respond notification dispatch request is invalid")
	ErrNotificationDispatchNotFound   = errors.New("respond notification dispatch not found")
	ErrNotificationSenderRequired     = errors.New("respond notification sender is required")
	ErrNotificationChannelUnsupported = errors.New("respond notification channel is not supported by configured sender")
)

type NotificationChannel string

const (
	NotificationChannelEmail     NotificationChannel = "email"
	NotificationChannelSMS       NotificationChannel = "sms"
	NotificationChannelChat      NotificationChannel = "chat"
	NotificationChannelInApp     NotificationChannel = "in_app"
	NotificationChannelWebSocket NotificationChannel = "websocket"
	NotificationChannelWebhook   NotificationChannel = "webhook"
)

func (c NotificationChannel) Valid() bool {
	switch c {
	case NotificationChannelEmail, NotificationChannelSMS, NotificationChannelChat,
		NotificationChannelInApp, NotificationChannelWebSocket, NotificationChannelWebhook:
		return true
	default:
		return false
	}
}

type NotificationDeliveryState string

const (
	NotificationDeliveryPending NotificationDeliveryState = "pending"
	NotificationDeliverySent    NotificationDeliveryState = "sent"
	NotificationDeliveryFailed  NotificationDeliveryState = "failed"
)

type NotificationAckState string

const (
	NotificationAckNotRequired  NotificationAckState = "not_required"
	NotificationAckPending      NotificationAckState = "pending"
	NotificationAckAcknowledged NotificationAckState = "acknowledged"
)

type NotificationEscalationState string

const (
	NotificationEscalationNone      NotificationEscalationState = "none"
	NotificationEscalationWaiting   NotificationEscalationState = "waiting"
	NotificationEscalationEscalated NotificationEscalationState = "escalated"
	NotificationEscalationStopped   NotificationEscalationState = "stopped"
	NotificationEscalationExhausted NotificationEscalationState = "exhausted"
)

type NotificationDispatch struct {
	ID                  uuid.UUID                   `json:"id"`
	TenantID            uuid.UUID                   `json:"tenant_id"`
	IncidentID          uuid.UUID                   `json:"incident_id"`
	RoleAssignmentID    *uuid.UUID                  `json:"role_assignment_id,omitempty"`
	Role                IncidentRole                `json:"role,omitempty"`
	RecipientUserID     uuid.UUID                   `json:"recipient_user_id"`
	Channel             NotificationChannel         `json:"channel"`
	IdempotencyKey      string                      `json:"idempotency_key"`
	DeliveryState       NotificationDeliveryState   `json:"delivery_state"`
	AckState            NotificationAckState        `json:"ack_state"`
	EscalationState     NotificationEscalationState `json:"escalation_state"`
	EscalationLevel     int                         `json:"escalation_level"`
	EscalationChain     []uuid.UUID                 `json:"escalation_chain"`
	EscalatedDispatchID *uuid.UUID                  `json:"escalated_dispatch_id,omitempty"`
	ProviderMessageID   string                      `json:"provider_message_id,omitempty"`
	DeliveryAttempts    int                         `json:"delivery_attempts"`
	LastError           string                      `json:"last_error,omitempty"`
	Title               string                      `json:"title"`
	Body                string                      `json:"body"`
	ActionURL           string                      `json:"action_url,omitempty"`
	Payload             map[string]any              `json:"payload,omitempty"`
	NextEscalationAt    *time.Time                  `json:"next_escalation_at,omitempty"`
	EscalatedAt         *time.Time                  `json:"escalated_at,omitempty"`
	AcknowledgedBy      *uuid.UUID                  `json:"acknowledged_by,omitempty"`
	AcknowledgedAt      *time.Time                  `json:"acknowledged_at,omitempty"`
	CreatedAt           time.Time                   `json:"created_at"`
	UpdatedAt           time.Time                   `json:"updated_at"`
}

type NotificationDispatchRequest struct {
	TenantID         uuid.UUID
	IncidentID       uuid.UUID
	RoleAssignmentID *uuid.UUID
	Role             IncidentRole
	RecipientUserID  uuid.UUID
	Channel          NotificationChannel
	IdempotencyKey   string
	Title            string
	Body             string
	ActionURL        string
	Payload          map[string]any
	RequiresAck      bool
	AckTimeout       time.Duration
	EscalationChain  []uuid.UUID
	EscalationLevel  int
}

func (r *NotificationDispatchRequest) normalize(now time.Time, defaultAckTimeout time.Duration) error {
	r.Title = strings.TrimSpace(r.Title)
	r.Body = strings.TrimSpace(r.Body)
	r.ActionURL = strings.TrimSpace(r.ActionURL)
	r.IdempotencyKey = strings.TrimSpace(r.IdempotencyKey)
	r.EscalationChain = normalizeUUIDs(r.EscalationChain)
	if r.TenantID == uuid.Nil || r.IncidentID == uuid.Nil || r.RecipientUserID == uuid.Nil {
		return fmt.Errorf("tenant_id, incident_id, and recipient_user_id are required: %w", ErrNotificationDispatchInvalid)
	}
	if r.Role != "" && !r.Role.Valid() {
		return ErrInvalidIncidentRole
	}
	if !r.Channel.Valid() {
		return ErrNotificationChannelUnsupported
	}
	if r.Title == "" || r.Body == "" {
		return fmt.Errorf("title and body are required: %w", ErrNotificationDispatchInvalid)
	}
	if r.EscalationLevel < 0 {
		return fmt.Errorf("escalation_level must be non-negative: %w", ErrNotificationDispatchInvalid)
	}
	if r.RequiresAck && r.AckTimeout <= 0 {
		r.AckTimeout = defaultAckTimeout
	}
	if r.RequiresAck && r.AckTimeout <= 0 {
		return fmt.Errorf("ack timeout is required for acknowledgement tracking: %w", ErrNotificationDispatchInvalid)
	}
	if len(r.EscalationChain) == 0 {
		r.EscalationChain = []uuid.UUID{r.RecipientUserID}
	}
	if r.IdempotencyKey == "" {
		r.IdempotencyKey = deriveNotificationIdempotencyKey(*r)
	}
	_ = now
	return nil
}

func (r NotificationDispatchRequest) toDispatch(now time.Time) *NotificationDispatch {
	dispatch := &NotificationDispatch{
		TenantID:         r.TenantID,
		IncidentID:       r.IncidentID,
		RoleAssignmentID: r.RoleAssignmentID,
		Role:             r.Role,
		RecipientUserID:  r.RecipientUserID,
		Channel:          r.Channel,
		IdempotencyKey:   r.IdempotencyKey,
		DeliveryState:    NotificationDeliveryPending,
		AckState:         NotificationAckNotRequired,
		EscalationState:  NotificationEscalationNone,
		EscalationLevel:  r.EscalationLevel,
		EscalationChain:  append([]uuid.UUID(nil), r.EscalationChain...),
		Title:            r.Title,
		Body:             r.Body,
		ActionURL:        r.ActionURL,
		Payload:          copyPayload(r.Payload),
	}
	if r.RequiresAck {
		nextEscalationAt := now.Add(r.AckTimeout)
		dispatch.AckState = NotificationAckPending
		dispatch.EscalationState = NotificationEscalationWaiting
		dispatch.NextEscalationAt = &nextEscalationAt
	}
	return dispatch
}

type RespondNotificationMessage struct {
	TenantID        uuid.UUID
	IncidentID      uuid.UUID
	RecipientUserID uuid.UUID
	Channel         NotificationChannel
	IdempotencyKey  string
	Title           string
	Body            string
	ActionURL       string
	Payload         map[string]any
}

type NotificationSendReceipt struct {
	ProviderMessageID string
	Provider          string
}

type NotificationSender interface {
	SendRespondNotification(ctx context.Context, message RespondNotificationMessage) (*NotificationSendReceipt, error)
}

type NotificationServiceCreator interface {
	CreateNotification(ctx context.Context, req notifservice.CreateNotificationRequest) error
}

type NotificationServiceSender struct {
	service NotificationServiceCreator
}

func NewNotificationServiceSender(service NotificationServiceCreator) (*NotificationServiceSender, error) {
	if service == nil {
		return nil, ErrNotificationSenderRequired
	}
	return &NotificationServiceSender{service: service}, nil
}

func (s *NotificationServiceSender) SendRespondNotification(ctx context.Context, message RespondNotificationMessage) (*NotificationSendReceipt, error) {
	channelName, err := notificationServiceChannel(message.Channel)
	if err != nil {
		return nil, err
	}
	data := copyPayload(message.Payload)
	if data == nil {
		data = map[string]any{}
	}
	data["incident_id"] = message.IncidentID.String()
	data["respond_idempotency_key"] = message.IdempotencyKey
	req := notifservice.CreateNotificationRequest{
		TenantID:      message.TenantID.String(),
		UserID:        message.RecipientUserID.String(),
		Type:          notifmodel.NotificationType("respond.incident.mobilization"),
		Category:      notifmodel.CategoryWorkflow,
		Priority:      notifmodel.PriorityCritical,
		Title:         message.Title,
		Body:          message.Body,
		ActionURL:     message.ActionURL,
		SourceEventID: message.IdempotencyKey,
		Data:          data,
		Channels:      []string{channelName},
	}
	if err := s.service.CreateNotification(ctx, req); err != nil {
		return nil, fmt.Errorf("respond: send notification through notification service: %w", err)
	}
	return &NotificationSendReceipt{ProviderMessageID: message.IdempotencyKey, Provider: "notification-service"}, nil
}

type NotificationDispatchStore interface {
	UpsertNotificationDispatch(ctx context.Context, dispatch *NotificationDispatch) (*NotificationDispatch, bool, error)
	MarkNotificationDispatchSent(ctx context.Context, tenantID, dispatchID uuid.UUID, providerMessageID string) (*NotificationDispatch, error)
	MarkNotificationDispatchFailed(ctx context.Context, tenantID, dispatchID uuid.UUID, errMessage string) (*NotificationDispatch, error)
	AcknowledgeNotificationDispatch(ctx context.Context, tenantID, dispatchID, actorID uuid.UUID, at time.Time) (*NotificationDispatch, error)
	ListDueNotificationEscalations(ctx context.Context, tenantID uuid.UUID, now time.Time, limit int) ([]NotificationDispatch, error)
	MarkNotificationDispatchEscalated(ctx context.Context, tenantID, dispatchID, escalatedDispatchID uuid.UUID, at time.Time) (*NotificationDispatch, error)
	MarkNotificationDispatchExhausted(ctx context.Context, tenantID, dispatchID uuid.UUID, at time.Time) (*NotificationDispatch, error)
}

type PersistentNotificationDispatchStore struct {
	tx    tenantRunner
	store *Store
}

func NewPersistentNotificationDispatchStore(tx tenantRunner, store *Store) (*PersistentNotificationDispatchStore, error) {
	if tx == nil {
		return nil, errors.New("respond notification dispatch tenant runner is required")
	}
	if store == nil {
		store = NewStore()
	}
	return &PersistentNotificationDispatchStore{tx: tx, store: store}, nil
}

func (s *PersistentNotificationDispatchStore) UpsertNotificationDispatch(ctx context.Context, dispatch *NotificationDispatch) (*NotificationDispatch, bool, error) {
	var out *NotificationDispatch
	var created bool
	err := s.tx.RunWithTenant(ctx, dispatch.TenantID, func(tx DBTX) error {
		var err error
		out, created, err = s.store.UpsertNotificationDispatch(ctx, tx, dispatch)
		return err
	})
	return out, created, err
}

func (s *PersistentNotificationDispatchStore) MarkNotificationDispatchSent(ctx context.Context, tenantID, dispatchID uuid.UUID, providerMessageID string) (*NotificationDispatch, error) {
	var out *NotificationDispatch
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, err = s.store.UpdateNotificationDispatchDelivery(ctx, tx, tenantID, dispatchID, NotificationDeliverySent, providerMessageID, "")
		return err
	})
	return out, err
}

func (s *PersistentNotificationDispatchStore) MarkNotificationDispatchFailed(ctx context.Context, tenantID, dispatchID uuid.UUID, errMessage string) (*NotificationDispatch, error) {
	var out *NotificationDispatch
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, err = s.store.UpdateNotificationDispatchDelivery(ctx, tx, tenantID, dispatchID, NotificationDeliveryFailed, "", errMessage)
		return err
	})
	return out, err
}

func (s *PersistentNotificationDispatchStore) AcknowledgeNotificationDispatch(ctx context.Context, tenantID, dispatchID, actorID uuid.UUID, at time.Time) (*NotificationDispatch, error) {
	var out *NotificationDispatch
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, err = s.store.AcknowledgeNotificationDispatch(ctx, tx, tenantID, dispatchID, actorID, at)
		return err
	})
	return out, err
}

func (s *PersistentNotificationDispatchStore) ListDueNotificationEscalations(ctx context.Context, tenantID uuid.UUID, now time.Time, limit int) ([]NotificationDispatch, error) {
	var out []NotificationDispatch
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, err = s.store.ListDueNotificationEscalations(ctx, tx, tenantID, now, limit)
		return err
	})
	return out, err
}

func (s *PersistentNotificationDispatchStore) MarkNotificationDispatchEscalated(ctx context.Context, tenantID, dispatchID, escalatedDispatchID uuid.UUID, at time.Time) (*NotificationDispatch, error) {
	var out *NotificationDispatch
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, err = s.store.MarkNotificationDispatchEscalated(ctx, tx, tenantID, dispatchID, escalatedDispatchID, at)
		return err
	})
	return out, err
}

func (s *PersistentNotificationDispatchStore) MarkNotificationDispatchExhausted(ctx context.Context, tenantID, dispatchID uuid.UUID, at time.Time) (*NotificationDispatch, error) {
	var out *NotificationDispatch
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, err = s.store.MarkNotificationDispatchExhausted(ctx, tx, tenantID, dispatchID, at)
		return err
	})
	return out, err
}

type NotificationEngine struct {
	store             NotificationDispatchStore
	sender            NotificationSender
	now               func() time.Time
	defaultAckTimeout time.Duration
}

type NotificationEngineOption func(*NotificationEngine)

func WithNotificationEngineClock(now func() time.Time) NotificationEngineOption {
	return func(e *NotificationEngine) {
		if now != nil {
			e.now = now
		}
	}
}

func WithDefaultAckTimeout(timeout time.Duration) NotificationEngineOption {
	return func(e *NotificationEngine) {
		if timeout > 0 {
			e.defaultAckTimeout = timeout
		}
	}
}

func NewNotificationEngine(store NotificationDispatchStore, sender NotificationSender, opts ...NotificationEngineOption) (*NotificationEngine, error) {
	if store == nil {
		return nil, errors.New("respond notification dispatch store is required")
	}
	if sender == nil {
		return nil, ErrNotificationSenderRequired
	}
	engine := &NotificationEngine{
		store:             store,
		sender:            sender,
		now:               func() time.Time { return time.Now().UTC() },
		defaultAckTimeout: 5 * time.Minute,
	}
	for _, opt := range opts {
		opt(engine)
	}
	return engine, nil
}

func (e *NotificationEngine) Dispatch(ctx context.Context, request NotificationDispatchRequest) (*NotificationDispatch, bool, error) {
	now := e.now()
	if err := request.normalize(now, e.defaultAckTimeout); err != nil {
		return nil, false, err
	}
	dispatch := request.toDispatch(now)
	persisted, created, err := e.store.UpsertNotificationDispatch(ctx, dispatch)
	if err != nil {
		return nil, false, err
	}
	if !created {
		return persisted, false, nil
	}

	receipt, sendErr := e.sender.SendRespondNotification(ctx, RespondNotificationMessage{
		TenantID:        persisted.TenantID,
		IncidentID:      persisted.IncidentID,
		RecipientUserID: persisted.RecipientUserID,
		Channel:         persisted.Channel,
		IdempotencyKey:  persisted.IdempotencyKey,
		Title:           persisted.Title,
		Body:            persisted.Body,
		ActionURL:       persisted.ActionURL,
		Payload:         persisted.Payload,
	})
	if sendErr != nil {
		failed, updateErr := e.store.MarkNotificationDispatchFailed(ctx, persisted.TenantID, persisted.ID, sendErr.Error())
		if updateErr != nil {
			return persisted, true, errors.Join(sendErr, updateErr)
		}
		return failed, true, sendErr
	}
	providerMessageID := ""
	if receipt != nil {
		providerMessageID = receipt.ProviderMessageID
	}
	sent, err := e.store.MarkNotificationDispatchSent(ctx, persisted.TenantID, persisted.ID, providerMessageID)
	if err != nil {
		return persisted, true, err
	}
	return sent, true, nil
}

func (e *NotificationEngine) Acknowledge(ctx context.Context, tenantID, dispatchID, actorID uuid.UUID) (*NotificationDispatch, error) {
	if tenantID == uuid.Nil || dispatchID == uuid.Nil || actorID == uuid.Nil {
		return nil, fmt.Errorf("tenant_id, dispatch_id, and actor_id are required: %w", ErrNotificationDispatchInvalid)
	}
	return e.store.AcknowledgeNotificationDispatch(ctx, tenantID, dispatchID, actorID, e.now())
}

func (e *NotificationEngine) ProcessDueEscalations(ctx context.Context, tenantID uuid.UUID, limit int) ([]NotificationDispatch, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("tenant_id is required: %w", ErrNotificationDispatchInvalid)
	}
	now := e.now()
	due, err := e.store.ListDueNotificationEscalations(ctx, tenantID, now, limit)
	if err != nil {
		return nil, err
	}
	escalated := make([]NotificationDispatch, 0, len(due))
	for _, dispatch := range due {
		if dispatch.AckState == NotificationAckAcknowledged {
			continue
		}
		nextLevel := dispatch.EscalationLevel + 1
		if nextLevel >= len(dispatch.EscalationChain) {
			if _, err := e.store.MarkNotificationDispatchExhausted(ctx, tenantID, dispatch.ID, now); err != nil {
				return escalated, err
			}
			continue
		}
		nextRecipient := dispatch.EscalationChain[nextLevel]
		nextRequest := NotificationDispatchRequest{
			TenantID:         dispatch.TenantID,
			IncidentID:       dispatch.IncidentID,
			RoleAssignmentID: dispatch.RoleAssignmentID,
			Role:             dispatch.Role,
			RecipientUserID:  nextRecipient,
			Channel:          dispatch.Channel,
			IdempotencyKey:   fmt.Sprintf("%s:escalation:%d:%s", dispatch.IdempotencyKey, nextLevel, nextRecipient.String()),
			Title:            dispatch.Title,
			Body:             dispatch.Body,
			ActionURL:        dispatch.ActionURL,
			Payload:          dispatch.Payload,
			RequiresAck:      true,
			AckTimeout:       e.defaultAckTimeout,
			EscalationChain:  dispatch.EscalationChain,
			EscalationLevel:  nextLevel,
		}
		nextDispatch, _, err := e.Dispatch(ctx, nextRequest)
		if err != nil {
			return escalated, err
		}
		if _, err := e.store.MarkNotificationDispatchEscalated(ctx, tenantID, dispatch.ID, nextDispatch.ID, now); err != nil {
			return escalated, err
		}
		escalated = append(escalated, *nextDispatch)
	}
	return escalated, nil
}

const notificationDispatchColumns = `id, tenant_id, incident_id, role_assignment_id, role,
recipient_user_id, channel, idempotency_key, delivery_state, ack_state, escalation_state,
escalation_level, escalation_chain, escalated_dispatch_id, provider_message_id,
delivery_attempts, last_error, title, body, action_url, payload, next_escalation_at,
escalated_at, acknowledged_by, acknowledged_at, created_at, updated_at`

func scanNotificationDispatch(row rowScanner) (*NotificationDispatch, error) {
	var dispatch NotificationDispatch
	var role, channel, deliveryState, ackState, escalationState string
	var payloadJSON, chainJSON []byte
	if err := row.Scan(
		&dispatch.ID,
		&dispatch.TenantID,
		&dispatch.IncidentID,
		&dispatch.RoleAssignmentID,
		&role,
		&dispatch.RecipientUserID,
		&channel,
		&dispatch.IdempotencyKey,
		&deliveryState,
		&ackState,
		&escalationState,
		&dispatch.EscalationLevel,
		&chainJSON,
		&dispatch.EscalatedDispatchID,
		&dispatch.ProviderMessageID,
		&dispatch.DeliveryAttempts,
		&dispatch.LastError,
		&dispatch.Title,
		&dispatch.Body,
		&dispatch.ActionURL,
		&payloadJSON,
		&dispatch.NextEscalationAt,
		&dispatch.EscalatedAt,
		&dispatch.AcknowledgedBy,
		&dispatch.AcknowledgedAt,
		&dispatch.CreatedAt,
		&dispatch.UpdatedAt,
	); err != nil {
		return nil, err
	}
	dispatch.Role = IncidentRole(role)
	dispatch.Channel = NotificationChannel(channel)
	dispatch.DeliveryState = NotificationDeliveryState(deliveryState)
	dispatch.AckState = NotificationAckState(ackState)
	dispatch.EscalationState = NotificationEscalationState(escalationState)
	if len(payloadJSON) > 0 {
		if err := json.Unmarshal(payloadJSON, &dispatch.Payload); err != nil {
			return nil, fmt.Errorf("respond: unmarshal notification payload: %w", err)
		}
	}
	if len(chainJSON) > 0 {
		if err := json.Unmarshal(chainJSON, &dispatch.EscalationChain); err != nil {
			return nil, fmt.Errorf("respond: unmarshal escalation chain: %w", err)
		}
	}
	if dispatch.Payload == nil {
		dispatch.Payload = map[string]any{}
	}
	if dispatch.EscalationChain == nil {
		dispatch.EscalationChain = []uuid.UUID{}
	}
	return &dispatch, nil
}

func (s *Store) UpsertNotificationDispatch(ctx context.Context, db DBTX, dispatch *NotificationDispatch) (*NotificationDispatch, bool, error) {
	if dispatch == nil {
		return nil, false, fmt.Errorf("notification dispatch is required: %w", ErrNotificationDispatchInvalid)
	}
	payloadJSON, err := json.Marshal(dispatch.Payload)
	if err != nil {
		return nil, false, fmt.Errorf("respond: marshal notification payload: %w", err)
	}
	if dispatch.Payload == nil {
		payloadJSON = []byte(`{}`)
	}
	chainJSON, err := json.Marshal(dispatch.EscalationChain)
	if err != nil {
		return nil, false, fmt.Errorf("respond: marshal escalation chain: %w", err)
	}
	inserted, err := scanNotificationDispatch(db.QueryRow(ctx, `
INSERT INTO respond_notification_dispatch (
    tenant_id, incident_id, role_assignment_id, role, recipient_user_id, channel,
    idempotency_key, delivery_state, ack_state, escalation_state, escalation_level,
    escalation_chain, title, body, action_url, payload, next_escalation_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
RETURNING `+notificationDispatchColumns,
		dispatch.TenantID,
		dispatch.IncidentID,
		dispatch.RoleAssignmentID,
		dispatch.Role,
		dispatch.RecipientUserID,
		dispatch.Channel,
		dispatch.IdempotencyKey,
		dispatch.DeliveryState,
		dispatch.AckState,
		dispatch.EscalationState,
		dispatch.EscalationLevel,
		chainJSON,
		dispatch.Title,
		dispatch.Body,
		dispatch.ActionURL,
		payloadJSON,
		dispatch.NextEscalationAt,
	))
	if err == nil {
		return inserted, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, fmt.Errorf("respond: insert notification dispatch: %w", err)
	}
	existing, err := s.GetNotificationDispatchByIdempotencyKey(ctx, db, dispatch.TenantID, dispatch.IdempotencyKey)
	if err != nil {
		return nil, false, err
	}
	return existing, false, nil
}

func (s *Store) GetNotificationDispatchByIdempotencyKey(ctx context.Context, db DBTX, tenantID uuid.UUID, key string) (*NotificationDispatch, error) {
	dispatch, err := scanNotificationDispatch(db.QueryRow(ctx, `SELECT `+notificationDispatchColumns+`
FROM respond_notification_dispatch
WHERE tenant_id = $1 AND idempotency_key = $2`, tenantID, key))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotificationDispatchNotFound
		}
		return nil, fmt.Errorf("respond: get notification dispatch by idempotency key: %w", err)
	}
	return dispatch, nil
}

func (s *Store) GetNotificationDispatch(ctx context.Context, db DBTX, tenantID, dispatchID uuid.UUID) (*NotificationDispatch, error) {
	dispatch, err := scanNotificationDispatch(db.QueryRow(ctx, `SELECT `+notificationDispatchColumns+`
FROM respond_notification_dispatch
WHERE tenant_id = $1 AND id = $2`, tenantID, dispatchID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotificationDispatchNotFound
		}
		return nil, fmt.Errorf("respond: get notification dispatch: %w", err)
	}
	return dispatch, nil
}

func (s *Store) ListNotificationDispatchesForIncident(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, limit int) ([]NotificationDispatch, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := db.Query(ctx, `SELECT `+notificationDispatchColumns+`
FROM respond_notification_dispatch
WHERE tenant_id = $1 AND incident_id = $2
ORDER BY created_at DESC, id DESC
LIMIT $3`, tenantID, incidentID, limit)
	if err != nil {
		return nil, fmt.Errorf("respond: list notification dispatches for incident: %w", err)
	}
	defer rows.Close()

	var out []NotificationDispatch
	for rows.Next() {
		dispatch, err := scanNotificationDispatch(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan incident notification dispatch: %w", err)
		}
		out = append(out, *dispatch)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read incident notification dispatches: %w", err)
	}
	return out, nil
}

func (s *Store) UpdateNotificationDispatchDelivery(ctx context.Context, db DBTX, tenantID, dispatchID uuid.UUID, state NotificationDeliveryState, providerMessageID, errMessage string) (*NotificationDispatch, error) {
	dispatch, err := scanNotificationDispatch(db.QueryRow(ctx, `
UPDATE respond_notification_dispatch
   SET delivery_state = $3,
       provider_message_id = CASE WHEN $4 = '' THEN provider_message_id ELSE $4 END,
       last_error = $5,
       delivery_attempts = delivery_attempts + 1,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2
RETURNING `+notificationDispatchColumns,
		tenantID, dispatchID, state, strings.TrimSpace(providerMessageID), strings.TrimSpace(errMessage)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotificationDispatchNotFound
		}
		return nil, fmt.Errorf("respond: update notification dispatch delivery: %w", err)
	}
	return dispatch, nil
}

func (s *Store) AcknowledgeNotificationDispatch(ctx context.Context, db DBTX, tenantID, dispatchID, actorID uuid.UUID, at time.Time) (*NotificationDispatch, error) {
	dispatch, err := scanNotificationDispatch(db.QueryRow(ctx, `
UPDATE respond_notification_dispatch
   SET ack_state = $3,
       escalation_state = $4,
       next_escalation_at = NULL,
       acknowledged_by = $5,
       acknowledged_at = $6,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2
RETURNING `+notificationDispatchColumns,
		tenantID, dispatchID, NotificationAckAcknowledged, NotificationEscalationStopped, actorID, at))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotificationDispatchNotFound
		}
		return nil, fmt.Errorf("respond: acknowledge notification dispatch: %w", err)
	}
	return dispatch, nil
}

func (s *Store) ListDueNotificationEscalations(ctx context.Context, db DBTX, tenantID uuid.UUID, now time.Time, limit int) ([]NotificationDispatch, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := db.Query(ctx, `SELECT `+notificationDispatchColumns+`
FROM respond_notification_dispatch
WHERE tenant_id = $1
  AND ack_state = $2
  AND escalation_state = $3
  AND next_escalation_at IS NOT NULL
  AND next_escalation_at <= $4
ORDER BY next_escalation_at ASC, id ASC
LIMIT $5`, tenantID, NotificationAckPending, NotificationEscalationWaiting, now, limit)
	if err != nil {
		return nil, fmt.Errorf("respond: list due notification escalations: %w", err)
	}
	defer rows.Close()

	var out []NotificationDispatch
	for rows.Next() {
		dispatch, err := scanNotificationDispatch(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan due notification escalation: %w", err)
		}
		out = append(out, *dispatch)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read due notification escalations: %w", err)
	}
	return out, nil
}

func (s *Store) MarkNotificationDispatchEscalated(ctx context.Context, db DBTX, tenantID, dispatchID, escalatedDispatchID uuid.UUID, at time.Time) (*NotificationDispatch, error) {
	dispatch, err := scanNotificationDispatch(db.QueryRow(ctx, `
UPDATE respond_notification_dispatch
   SET escalation_state = $3,
       escalated_dispatch_id = $4,
       escalated_at = $5,
       next_escalation_at = NULL,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2
RETURNING `+notificationDispatchColumns,
		tenantID, dispatchID, NotificationEscalationEscalated, escalatedDispatchID, at))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotificationDispatchNotFound
		}
		return nil, fmt.Errorf("respond: mark notification dispatch escalated: %w", err)
	}
	return dispatch, nil
}

func (s *Store) MarkNotificationDispatchExhausted(ctx context.Context, db DBTX, tenantID, dispatchID uuid.UUID, at time.Time) (*NotificationDispatch, error) {
	dispatch, err := scanNotificationDispatch(db.QueryRow(ctx, `
UPDATE respond_notification_dispatch
   SET escalation_state = $3,
       escalated_at = $4,
       next_escalation_at = NULL,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2
RETURNING `+notificationDispatchColumns,
		tenantID, dispatchID, NotificationEscalationExhausted, at))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotificationDispatchNotFound
		}
		return nil, fmt.Errorf("respond: mark notification dispatch exhausted: %w", err)
	}
	return dispatch, nil
}

func notificationServiceChannel(channel NotificationChannel) (string, error) {
	switch channel {
	case NotificationChannelEmail:
		return notifmodel.ChannelEmail, nil
	case NotificationChannelInApp:
		return notifmodel.ChannelInApp, nil
	case NotificationChannelWebSocket:
		return notifmodel.ChannelWebSocket, nil
	case NotificationChannelWebhook, NotificationChannelChat:
		return notifmodel.ChannelWebhook, nil
	case NotificationChannelSMS:
		return "", ErrNotificationChannelUnsupported
	default:
		return "", ErrNotificationChannelUnsupported
	}
}

func deriveNotificationIdempotencyKey(request NotificationDispatchRequest) string {
	return strings.Join([]string{
		"respond",
		request.IncidentID.String(),
		string(request.Role),
		request.RecipientUserID.String(),
		string(request.Channel),
		fmt.Sprintf("%d", request.EscalationLevel),
	}, ":")
}

func normalizeUUIDs(in []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{}, len(in))
	out := make([]uuid.UUID, 0, len(in))
	for _, id := range in {
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func copyPayload(in map[string]any) map[string]any {
	if in == nil {
		return nil
	}
	out := make(map[string]any, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

var _ NotificationSender = (*NotificationServiceSender)(nil)
var _ NotificationDispatchStore = (*PersistentNotificationDispatchStore)(nil)
