package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

type CreateObligationRequest struct {
	Title              string                 `json:"title"`
	Description        string                 `json:"description"`
	Type               model.ObligationType   `json:"type"`
	Status             model.ObligationStatus `json:"status"`
	Priority           model.LegalPriority    `json:"priority"`
	ContractID         *uuid.UUID             `json:"contract_id,omitempty"`
	MatterID           *uuid.UUID             `json:"matter_id,omitempty"`
	ClauseID           *uuid.UUID             `json:"clause_id,omitempty"`
	OwnerUserID        uuid.UUID              `json:"owner_user_id"`
	OwnerName          string                 `json:"owner_name"`
	DueDate            time.Time              `json:"due_date"`
	ReminderEnabled    bool                   `json:"reminder_enabled"`
	ReminderLeadDays   []int                  `json:"reminder_lead_days"`
	EscalationEnabled  bool                   `json:"escalation_enabled"`
	EscalationLeadDays []int                  `json:"escalation_lead_days"`
	EscalationTarget   *string                `json:"escalation_target,omitempty"`
	Tags               []string               `json:"tags"`
	Metadata           map[string]any         `json:"metadata"`
}

type UpdateObligationRequest struct {
	Title              *string                 `json:"title,omitempty"`
	Description        *string                 `json:"description,omitempty"`
	Type               *model.ObligationType   `json:"type,omitempty"`
	Status             *model.ObligationStatus `json:"status,omitempty"`
	Priority           *model.LegalPriority    `json:"priority,omitempty"`
	ContractID         *uuid.UUID              `json:"contract_id,omitempty"`
	MatterID           *uuid.UUID              `json:"matter_id,omitempty"`
	ClauseID           *uuid.UUID              `json:"clause_id,omitempty"`
	OwnerUserID        *uuid.UUID              `json:"owner_user_id,omitempty"`
	OwnerName          *string                 `json:"owner_name,omitempty"`
	DueDate            *time.Time              `json:"due_date,omitempty"`
	ReminderEnabled    *bool                   `json:"reminder_enabled,omitempty"`
	ReminderLeadDays   []int                   `json:"reminder_lead_days,omitempty"`
	EscalationEnabled  *bool                   `json:"escalation_enabled,omitempty"`
	EscalationLeadDays []int                   `json:"escalation_lead_days,omitempty"`
	EscalationTarget   *string                 `json:"escalation_target,omitempty"`
	Tags               []string                `json:"tags,omitempty"`
	Metadata           map[string]any          `json:"metadata,omitempty"`
}

type UpdateObligationStatusRequest struct {
	Status model.ObligationStatus `json:"status"`
}

type ObligationExtractionItem struct {
	Title              string               `json:"title"`
	Description        string               `json:"description"`
	Type               model.ObligationType `json:"type"`
	Priority           model.LegalPriority  `json:"priority"`
	DueDate            *time.Time           `json:"due_date,omitempty"`
	Source             string               `json:"source"`
	SourceReference    string               `json:"source_reference"`
	ClauseID           *uuid.UUID           `json:"clause_id,omitempty"`
	ReminderEnabled    *bool                `json:"reminder_enabled,omitempty"`
	ReminderLeadDays   []int                `json:"reminder_lead_days,omitempty"`
	EscalationEnabled  *bool                `json:"escalation_enabled,omitempty"`
	EscalationLeadDays []int                `json:"escalation_lead_days,omitempty"`
	EscalationTarget   *string              `json:"escalation_target,omitempty"`
	Tags               []string             `json:"tags"`
	Metadata           map[string]any       `json:"metadata"`
}

type ExtractObligationsRequest struct {
	OwnerUserID               uuid.UUID                  `json:"owner_user_id"`
	OwnerName                 string                     `json:"owner_name"`
	MatterID                  *uuid.UUID                 `json:"matter_id,omitempty"`
	Items                     []ObligationExtractionItem `json:"items"`
	IncludeContractRenewal    *bool                      `json:"include_contract_renewal,omitempty"`
	DefaultReminderLeadDays   []int                      `json:"default_reminder_lead_days,omitempty"`
	DefaultEscalationLeadDays []int                      `json:"default_escalation_lead_days,omitempty"`
	DefaultEscalationTarget   *string                    `json:"default_escalation_target,omitempty"`
	Tags                      []string                   `json:"tags"`
	Metadata                  map[string]any             `json:"metadata"`
}

type MarkObligationReminderSentRequest struct {
	SentAt            *time.Time                       `json:"sent_at,omitempty"`
	ScheduledAt       *time.Time                       `json:"scheduled_at,omitempty"`
	Channel           string                           `json:"channel"`
	EventType         model.ObligationNotificationType `json:"event_type"`
	LeadDays          int                              `json:"lead_days"`
	Provider          string                           `json:"provider,omitempty"`
	ProviderMessageID string                           `json:"provider_message_id,omitempty"`
	ProviderMetadata  map[string]any                   `json:"provider_metadata,omitempty"`
	RecipientContact  *string                          `json:"recipient_contact,omitempty"`
}

type EnqueueObligationRemindersRequest struct {
	AsOf               *time.Time                            `json:"as_of,omitempty"`
	HorizonDays        *int                                  `json:"horizon_days,omitempty"`
	IncludeEscalations *bool                                 `json:"include_escalations,omitempty"`
	Channels           []model.ObligationNotificationChannel `json:"channels,omitempty"`
}

type MarkObligationReminderDeliveryRequest struct {
	Status            model.ObligationNotificationOutboxStatus `json:"status"`
	AttemptedAt       *time.Time                               `json:"attempted_at,omitempty"`
	Provider          string                                   `json:"provider,omitempty"`
	ProviderMessageID string                                   `json:"provider_message_id,omitempty"`
	ProviderMetadata  map[string]any                           `json:"provider_metadata,omitempty"`
	ErrorMessage      string                                   `json:"error_message,omitempty"`
}

type DispatchObligationReminderOutboxRequest struct {
	Provider string     `json:"provider,omitempty"`
	Retry    bool       `json:"retry,omitempty"`
	Limit    *int       `json:"limit,omitempty"`
	AsOf     *time.Time `json:"as_of,omitempty"`
}

func (r *CreateObligationRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.Description = strings.TrimSpace(r.Description)
	r.OwnerName = strings.TrimSpace(r.OwnerName)
	if r.Type == "" {
		r.Type = model.ObligationTypeContractual
	}
	if r.Status == "" {
		r.Status = model.ObligationStatusOpen
	}
	if r.Priority == "" {
		r.Priority = model.LegalPriorityMedium
	}
	if r.ReminderEnabled && len(r.ReminderLeadDays) == 0 {
		r.ReminderLeadDays = []int{30, 7, 1}
	}
	if r.EscalationEnabled && len(r.EscalationLeadDays) == 0 {
		r.EscalationLeadDays = []int{7, 1}
	}
	r.Tags = normalizeTags(r.Tags)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *ObligationExtractionItem) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.Description = strings.TrimSpace(r.Description)
	r.Source = strings.TrimSpace(r.Source)
	r.SourceReference = strings.TrimSpace(r.SourceReference)
	if r.Type == "" {
		r.Type = model.ObligationTypeContractual
	}
	if r.Priority == "" {
		r.Priority = model.LegalPriorityMedium
	}
	r.Tags = normalizeTags(r.Tags)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *ExtractObligationsRequest) Normalize() {
	r.OwnerName = strings.TrimSpace(r.OwnerName)
	r.Tags = normalizeTags(r.Tags)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	for i := range r.Items {
		r.Items[i].Normalize()
	}
}

func (r *MarkObligationReminderSentRequest) Normalize() {
	r.Channel = strings.ToLower(strings.TrimSpace(r.Channel))
	r.Provider = strings.TrimSpace(r.Provider)
	r.ProviderMessageID = strings.TrimSpace(r.ProviderMessageID)
	if r.ProviderMetadata == nil {
		r.ProviderMetadata = map[string]any{}
	}
	r.RecipientContact = normalizeOptionalStringDTO(r.RecipientContact)
}

func (r *EnqueueObligationRemindersRequest) Normalize() {
	for i := range r.Channels {
		r.Channels[i] = model.ObligationNotificationChannel(strings.ToLower(strings.TrimSpace(string(r.Channels[i]))))
	}
}

func (r *MarkObligationReminderDeliveryRequest) Normalize() {
	r.Provider = strings.TrimSpace(r.Provider)
	r.ProviderMessageID = strings.TrimSpace(r.ProviderMessageID)
	r.ErrorMessage = strings.TrimSpace(r.ErrorMessage)
	if r.ProviderMetadata == nil {
		r.ProviderMetadata = map[string]any{}
	}
}

func (r *DispatchObligationReminderOutboxRequest) Normalize() {
	r.Provider = strings.ToLower(strings.TrimSpace(r.Provider))
}

func normalizeOptionalStringDTO(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
