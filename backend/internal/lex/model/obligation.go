package model

import (
	"time"

	"github.com/google/uuid"
)

type ObligationType string

const (
	ObligationTypeContractual        ObligationType = "contractual"
	ObligationTypeRenewal            ObligationType = "renewal"
	ObligationTypeNotice             ObligationType = "notice"
	ObligationTypePayment            ObligationType = "payment"
	ObligationTypeDelivery           ObligationType = "delivery"
	ObligationTypeReporting          ObligationType = "reporting"
	ObligationTypeCompliance         ObligationType = "compliance"
	ObligationTypeCovenant           ObligationType = "covenant"
	ObligationTypeConditionPrecedent ObligationType = "condition_precedent"
	ObligationTypeRegulatory         ObligationType = "regulatory"
	ObligationTypeOther              ObligationType = "other"
)

type ObligationStatus string

const (
	ObligationStatusOpen       ObligationStatus = "open"
	ObligationStatusInProgress ObligationStatus = "in_progress"
	ObligationStatusBlocked    ObligationStatus = "blocked"
	ObligationStatusCompleted  ObligationStatus = "completed"
	ObligationStatusWaived     ObligationStatus = "waived"
	ObligationStatusCancelled  ObligationStatus = "cancelled"
)

type ObligationNotificationType string

const (
	ObligationNotificationReminder   ObligationNotificationType = "reminder"
	ObligationNotificationEscalation ObligationNotificationType = "escalation"
)

type ObligationNotificationChannel string

const (
	ObligationNotificationChannelEmail    ObligationNotificationChannel = "email"
	ObligationNotificationChannelCalendar ObligationNotificationChannel = "calendar"
	ObligationNotificationChannelInApp    ObligationNotificationChannel = "in_app"
)

type ObligationNotificationOutboxStatus string

const (
	ObligationNotificationOutboxPending ObligationNotificationOutboxStatus = "pending"
	ObligationNotificationOutboxSent    ObligationNotificationOutboxStatus = "sent"
	ObligationNotificationOutboxFailed  ObligationNotificationOutboxStatus = "failed"
)

type Obligation struct {
	ID                 uuid.UUID        `json:"id"`
	TenantID           uuid.UUID        `json:"tenant_id"`
	Title              string           `json:"title"`
	Description        string           `json:"description"`
	Type               ObligationType   `json:"type"`
	Status             ObligationStatus `json:"status"`
	Priority           LegalPriority    `json:"priority"`
	ContractID         *uuid.UUID       `json:"contract_id,omitempty"`
	ContractTitle      *string          `json:"contract_title,omitempty"`
	MatterID           *uuid.UUID       `json:"matter_id,omitempty"`
	MatterTitle        *string          `json:"matter_title,omitempty"`
	ClauseID           *uuid.UUID       `json:"clause_id,omitempty"`
	OwnerUserID        uuid.UUID        `json:"owner_user_id"`
	OwnerName          string           `json:"owner_name"`
	DueDate            time.Time        `json:"due_date"`
	CompletedAt        *time.Time       `json:"completed_at,omitempty"`
	ReminderEnabled    bool             `json:"reminder_enabled"`
	ReminderLeadDays   []int            `json:"reminder_lead_days"`
	EscalationEnabled  bool             `json:"escalation_enabled"`
	EscalationLeadDays []int            `json:"escalation_lead_days"`
	EscalationTarget   *string          `json:"escalation_target,omitempty"`
	LastReminderAt     *time.Time       `json:"last_reminder_at,omitempty"`
	Tags               []string         `json:"tags"`
	Metadata           map[string]any   `json:"metadata"`
	CreatedBy          uuid.UUID        `json:"created_by"`
	CreatedAt          time.Time        `json:"created_at"`
	UpdatedAt          time.Time        `json:"updated_at"`
	DeletedAt          *time.Time       `json:"deleted_at,omitempty"`
	DaysUntilDue       int              `json:"days_until_due"`
}

type ObligationNotificationEvent struct {
	EventID          uuid.UUID                  `json:"event_id"`
	Type             ObligationNotificationType `json:"type"`
	ObligationID     uuid.UUID                  `json:"obligation_id"`
	ObligationTitle  string                     `json:"obligation_title"`
	ContractID       *uuid.UUID                 `json:"contract_id,omitempty"`
	ContractTitle    *string                    `json:"contract_title,omitempty"`
	MatterID         *uuid.UUID                 `json:"matter_id,omitempty"`
	MatterTitle      *string                    `json:"matter_title,omitempty"`
	OwnerUserID      uuid.UUID                  `json:"owner_user_id"`
	OwnerName        string                     `json:"owner_name"`
	DueDate          time.Time                  `json:"due_date"`
	DaysUntilDue     int                        `json:"days_until_due"`
	LeadDays         int                        `json:"lead_days"`
	PlannedFor       time.Time                  `json:"planned_for"`
	Channel          string                     `json:"channel"`
	EscalationTarget *string                    `json:"escalation_target,omitempty"`
	Reason           string                     `json:"reason"`
}

type ObligationReminderPlan struct {
	AsOf        time.Time                     `json:"as_of"`
	HorizonDays int                           `json:"horizon_days"`
	Total       int                           `json:"total"`
	Events      []ObligationNotificationEvent `json:"events"`
}

type ObligationNotificationOutboxItem struct {
	ID                uuid.UUID                          `json:"id"`
	TenantID          uuid.UUID                          `json:"tenant_id"`
	ObligationID      uuid.UUID                          `json:"obligation_id"`
	EventID           uuid.UUID                          `json:"event_id"`
	EventType         ObligationNotificationType         `json:"event_type"`
	LeadDays          int                                `json:"lead_days"`
	Channel           ObligationNotificationChannel      `json:"channel"`
	RecipientUserID   *uuid.UUID                         `json:"recipient_user_id,omitempty"`
	RecipientName     string                             `json:"recipient_name"`
	RecipientContact  *string                            `json:"recipient_contact,omitempty"`
	ScheduledAt       time.Time                          `json:"scheduled_at"`
	Status            ObligationNotificationOutboxStatus `json:"status"`
	Provider          string                             `json:"provider"`
	ProviderMessageID *string                            `json:"provider_message_id,omitempty"`
	ProviderMetadata  map[string]any                     `json:"provider_metadata"`
	ErrorMessage      *string                            `json:"error_message,omitempty"`
	AttemptCount      int                                `json:"attempt_count"`
	LastAttemptAt     *time.Time                         `json:"last_attempt_at,omitempty"`
	SentAt            *time.Time                         `json:"sent_at,omitempty"`
	CreatedBy         uuid.UUID                          `json:"created_by"`
	CreatedAt         time.Time                          `json:"created_at"`
	UpdatedAt         time.Time                          `json:"updated_at"`
}

type ObligationReminderEnqueueResult struct {
	Plan                  ObligationReminderPlan             `json:"plan"`
	RequestedCount        int                                `json:"requested_count"`
	QueuedCount           int                                `json:"queued_count"`
	SkippedDuplicateCount int                                `json:"skipped_duplicate_count"`
	Queued                []ObligationNotificationOutboxItem `json:"queued"`
}

type ObligationReminderDispatchAttempt struct {
	OutboxID          uuid.UUID                          `json:"outbox_id"`
	ObligationID      uuid.UUID                          `json:"obligation_id"`
	Channel           ObligationNotificationChannel      `json:"channel"`
	PreviousStatus    ObligationNotificationOutboxStatus `json:"previous_status"`
	Status            ObligationNotificationOutboxStatus `json:"status"`
	Provider          string                             `json:"provider,omitempty"`
	ProviderMessageID *string                            `json:"provider_message_id,omitempty"`
	ProviderMetadata  map[string]any                     `json:"provider_metadata,omitempty"`
	ErrorMessage      *string                            `json:"error_message,omitempty"`
	SkippedReason     string                             `json:"skipped_reason,omitempty"`
	Item              *ObligationNotificationOutboxItem  `json:"item,omitempty"`
}

type ObligationReminderDispatchResult struct {
	Provider        string                              `json:"provider"`
	Retry           bool                                `json:"retry"`
	RequestedCount  int                                 `json:"requested_count"`
	DispatchedCount int                                 `json:"dispatched_count"`
	SentCount       int                                 `json:"sent_count"`
	FailedCount     int                                 `json:"failed_count"`
	SkippedCount    int                                 `json:"skipped_count"`
	Attempts        []ObligationReminderDispatchAttempt `json:"attempts"`
}

type ObligationExtractionSkip struct {
	Source string `json:"source"`
	Title  string `json:"title,omitempty"`
	Reason string `json:"reason"`
}

type ObligationExtractionResult struct {
	ContractID            uuid.UUID                     `json:"contract_id"`
	CreatedCount          int                           `json:"created_count"`
	Created               []Obligation                  `json:"created"`
	Skipped               []ObligationExtractionSkip    `json:"skipped"`
	PlannedNotifications  []ObligationNotificationEvent `json:"planned_notifications"`
	CommittedAt           time.Time                     `json:"committed_at"`
	DeterministicStrategy string                        `json:"deterministic_strategy"`
}

type ObligationListFilters struct {
	Page          int
	PerPage       int
	Search        string
	Status        *ObligationStatus
	Type          *ObligationType
	Priority      *LegalPriority
	OwnerUserID   *uuid.UUID
	ContractID    *uuid.UUID
	MatterID      *uuid.UUID
	DueBefore     *time.Time
	DueAfter      *time.Time
	Overdue       bool
	Tag           string
	SortColumn    string
	SortDirection string
}
