package model

import (
	"time"

	"github.com/google/uuid"
)

// DeliveryConfirmationStatus is the lifecycle of a delivery-confirmation request
// (CAP-027, CAP-028). After delivery the provider requests confirmation; the
// requester confirms or denies. Contract requests add an achieved state: the
// contracts associate marks the legal work achieved, then the requester adds
// final delivery notes and performs the closing confirmation. Other request
// types retain the working-day auto-close behavior.
type DeliveryConfirmationStatus string

const (
	DeliveryConfirmationStatusRequested DeliveryConfirmationStatus = "requested"
	DeliveryConfirmationStatusConfirmed DeliveryConfirmationStatus = "confirmed"
	DeliveryConfirmationStatusAchieved  DeliveryConfirmationStatus = "achieved"
	DeliveryConfirmationStatusDenied    DeliveryConfirmationStatus = "denied"
	DeliveryConfirmationStatusExpired   DeliveryConfirmationStatus = "expired"
)

// Valid reports whether the status is a known delivery-confirmation value.
func (s DeliveryConfirmationStatus) Valid() bool {
	switch s {
	case DeliveryConfirmationStatusRequested, DeliveryConfirmationStatusConfirmed,
		DeliveryConfirmationStatusAchieved,
		DeliveryConfirmationStatusDenied, DeliveryConfirmationStatusExpired:
		return true
	default:
		return false
	}
}

// DeliveryConfirmation is the per-delivery confirmation handshake (CAP-027). The
// provider opens one ("requested"). Non-contract requests receive an
// auto_close_at deadline computed via the working calendar (CAP-028/CAP-029).
// Contract requests deliberately have no deadline: a contracts operator marks
// the legal work achieved, then the requester submits final delivery notes and
// closes the request.
type DeliveryConfirmation struct {
	ID                           uuid.UUID                  `json:"id"`
	TenantID                     uuid.UUID                  `json:"tenant_id"`
	LegalRequestID               uuid.UUID                  `json:"legal_request_id"`
	Status                       DeliveryConfirmationStatus `json:"status"`
	RequestedBy                  uuid.UUID                  `json:"requested_by"`
	RecipientUserID              uuid.UUID                  `json:"recipient_user_id"`
	RequestedAt                  time.Time                  `json:"requested_at"`
	AutoCloseAt                  *time.Time                 `json:"auto_close_at"`
	RespondedBy                  *uuid.UUID                 `json:"responded_by,omitempty"`
	RespondedAt                  *time.Time                 `json:"responded_at,omitempty"`
	ResponseNote                 *string                    `json:"response_note,omitempty"`
	LateJustification            *string                    `json:"late_justification,omitempty"`
	LateJustificationSubmittedBy *uuid.UUID                 `json:"late_justification_submitted_by,omitempty"`
	LateJustificationSubmittedAt *time.Time                 `json:"late_justification_submitted_at,omitempty"`
	LateJustificationManagerRole *string                    `json:"late_justification_manager_role,omitempty"`
	Metadata                     map[string]any             `json:"metadata"`
	CreatedBy                    uuid.UUID                  `json:"created_by"`
	CreatedAt                    time.Time                  `json:"created_at"`
	UpdatedAt                    time.Time                  `json:"updated_at"`
}

// DeliveryConfirmationOutboxStatus is the dispatch state machine for the
// delivery-confirmation notification outbox (mirrors the obligation outbox 000007
// pattern): pending → sent/failed.
type DeliveryConfirmationOutboxStatus string

const (
	DeliveryConfirmationOutboxStatusPending DeliveryConfirmationOutboxStatus = "pending"
	DeliveryConfirmationOutboxStatusSent    DeliveryConfirmationOutboxStatus = "sent"
	DeliveryConfirmationOutboxStatusFailed  DeliveryConfirmationOutboxStatus = "failed"
)

// DeliveryConfirmationOutboxItem is one queued delivery-confirmation
// notification. Delivery itself is reused via the obligation-reminder dispatcher
// seam; this row only records the intent + dedup key (partial-unique on
// pending|sent per the 000007 template). It is INSERT-only at the RLS layer for
// new rows; status transitions UPDATE in place.
type DeliveryConfirmationOutboxItem struct {
	ID                uuid.UUID                        `json:"id"`
	TenantID          uuid.UUID                        `json:"tenant_id"`
	LegalRequestID    uuid.UUID                        `json:"legal_request_id"`
	ConfirmationID    uuid.UUID                        `json:"confirmation_id"`
	EventID           uuid.UUID                        `json:"event_id"`
	EventType         string                           `json:"event_type"`
	Channel           string                           `json:"channel"`
	RecipientUserID   *uuid.UUID                       `json:"recipient_user_id,omitempty"`
	RecipientName     string                           `json:"recipient_name"`
	RecipientContact  *string                          `json:"recipient_contact,omitempty"`
	ScheduledAt       time.Time                        `json:"scheduled_at"`
	ScheduledDate     time.Time                        `json:"scheduled_date"`
	Status            DeliveryConfirmationOutboxStatus `json:"status"`
	Provider          string                           `json:"provider"`
	ProviderMessageID *string                          `json:"provider_message_id,omitempty"`
	ProviderMetadata  map[string]any                   `json:"provider_metadata"`
	ErrorMessage      *string                          `json:"error_message,omitempty"`
	AttemptCount      int                              `json:"attempt_count"`
	LastAttemptAt     *time.Time                       `json:"last_attempt_at,omitempty"`
	SentAt            *time.Time                       `json:"sent_at,omitempty"`
	CreatedBy         uuid.UUID                        `json:"created_by"`
	CreatedAt         time.Time                        `json:"created_at"`
	UpdatedAt         time.Time                        `json:"updated_at"`
}
