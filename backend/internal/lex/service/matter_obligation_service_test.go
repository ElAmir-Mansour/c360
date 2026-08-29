package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestValidateMatterCreate_DefaultsAndRequiresOwner(t *testing.T) {
	req := dto.CreateMatterRequest{
		Title:       "Procurement dispute",
		Description: "Vendor delay triage",
		OwnerUserID: uuid.New(),
		OwnerName:   "Legal Owner",
	}
	req.Normalize()

	if req.Type != model.MatterTypeGeneral {
		t.Fatalf("Type = %q, want %q", req.Type, model.MatterTypeGeneral)
	}
	if req.Status != model.MatterStatusOpen {
		t.Fatalf("Status = %q, want %q", req.Status, model.MatterStatusOpen)
	}
	if req.Priority != model.LegalPriorityMedium {
		t.Fatalf("Priority = %q, want %q", req.Priority, model.LegalPriorityMedium)
	}
	if err := validateMatterCreate(req); err != nil {
		t.Fatalf("validateMatterCreate() error = %v", err)
	}

	req.OwnerUserID = uuid.Nil
	if err := validateMatterCreate(req); err == nil {
		t.Fatal("validateMatterCreate() error = nil, want owner validation error")
	}
}

func TestValidateObligationCreateRequiresDueDateAndLink(t *testing.T) {
	req := dto.CreateObligationRequest{
		Title:       "Submit renewal notice",
		OwnerUserID: uuid.New(),
		OwnerName:   "Contract Owner",
	}
	req.Normalize()

	if err := validateObligationCreate(req); err == nil {
		t.Fatal("validateObligationCreate() error = nil, want due date/link validation error")
	}

	contractID := uuid.New()
	req.ContractID = &contractID
	req.DueDate = time.Date(2026, 7, 31, 10, 0, 0, 0, time.UTC)
	if err := validateObligationCreate(req); err != nil {
		t.Fatalf("validateObligationCreate() error = %v", err)
	}
}

func TestObligationLeadDaysValidation(t *testing.T) {
	got := normalizeLeadDays([]int{30, 7, 30, 1})
	want := []int{30, 7, 1}
	if len(got) != len(want) {
		t.Fatalf("normalizeLeadDays() len = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("normalizeLeadDays()[%d] = %d, want %d", i, got[i], want[i])
		}
	}
	if err := validateLeadDays([]int{7}, []int{-1}); err == nil {
		t.Fatal("validateLeadDays() error = nil, want invalid lead day error")
	}
}

func TestBuildExtractionDraftsFromPayloadAndRenewal(t *testing.T) {
	contractID := uuid.New()
	ownerID := uuid.New()
	renewalDate := time.Date(2026, 8, 1, 15, 0, 0, 0, time.UTC)
	itemDueDate := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	includeRenewal := true
	contract := &model.Contract{
		ID:                contractID,
		Title:             "Managed Services Agreement",
		CurrentVersion:    3,
		RenewalDate:       &renewalDate,
		AutoRenew:         true,
		RenewalNoticeDays: 45,
	}
	req := dto.ExtractObligationsRequest{
		OwnerUserID:            ownerID,
		OwnerName:              "Contract Owner",
		IncludeContractRenewal: &includeRenewal,
		Items: []dto.ObligationExtractionItem{{
			Title:           "Submit quarterly compliance report",
			Description:     "Report due under the reporting clause.",
			Type:            model.ObligationTypeReporting,
			Priority:        model.LegalPriorityHigh,
			DueDate:         &itemDueDate,
			Source:          "analysis_clause",
			SourceReference: "section 8.1",
			Tags:            []string{"Reporting", "Compliance"},
		}},
	}
	req.Normalize()

	drafts, skipped := buildExtractionDrafts(contract, req, time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC))
	if len(skipped) != 0 {
		t.Fatalf("skipped len = %d, want 0", len(skipped))
	}
	if len(drafts) != 2 {
		t.Fatalf("drafts len = %d, want 2", len(drafts))
	}
	if drafts[0].ContractID == nil || *drafts[0].ContractID != contractID {
		t.Fatalf("draft contract_id = %v, want %s", drafts[0].ContractID, contractID)
	}
	if drafts[0].Type != model.ObligationTypeReporting {
		t.Fatalf("draft type = %q, want reporting", drafts[0].Type)
	}
	if drafts[0].ReminderLeadDays[0] != 30 || drafts[0].ReminderLeadDays[1] != 7 || drafts[0].ReminderLeadDays[2] != 1 {
		t.Fatalf("reminder lead days = %#v, want [30 7 1]", drafts[0].ReminderLeadDays)
	}
	if drafts[1].Type != model.ObligationTypeRenewal {
		t.Fatalf("renewal draft type = %q, want renewal", drafts[1].Type)
	}
	if got := drafts[1].DueDate; !got.Equal(time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("renewal due date = %s, want 2026-08-01", got)
	}
	extraction, ok := drafts[0].Metadata["extraction"].(map[string]any)
	if !ok {
		t.Fatal("draft metadata extraction missing")
	}
	if extraction["source"] != "analysis_clause" {
		t.Fatalf("extraction source = %v, want analysis_clause", extraction["source"])
	}
}

func TestBuildExtractionDraftsSkipsInvalidPayloadCandidate(t *testing.T) {
	contract := &model.Contract{ID: uuid.New(), Title: "Test Contract"}
	req := dto.ExtractObligationsRequest{
		OwnerUserID: uuid.New(),
		OwnerName:   "Owner",
		Items: []dto.ObligationExtractionItem{{
			Title:  "Missing due date",
			Source: "analysis_clause",
		}},
	}
	req.Normalize()
	includeRenewal := false
	req.IncludeContractRenewal = &includeRenewal

	drafts, skipped := buildExtractionDrafts(contract, req, time.Now())
	if len(drafts) != 0 {
		t.Fatalf("drafts len = %d, want 0", len(drafts))
	}
	if len(skipped) != 1 || skipped[0].Reason != "due_date is required" {
		t.Fatalf("skipped = %#v, want due_date skip", skipped)
	}
}

func TestPlanNotificationEventsFiltersCandidates(t *testing.T) {
	asOf := time.Date(2026, 6, 14, 0, 0, 0, 0, time.UTC)
	ownerID := uuid.New()
	sameDayReminder := asOf.Add(2 * time.Hour)
	obligations := []model.Obligation{
		{
			ID:               uuid.New(),
			Title:            "Seven day reminder",
			Status:           model.ObligationStatusOpen,
			OwnerUserID:      ownerID,
			OwnerName:        "Owner",
			DueDate:          asOf.AddDate(0, 0, 7),
			ReminderEnabled:  true,
			ReminderLeadDays: []int{30, 7, 1},
		},
		{
			ID:               uuid.New(),
			Title:            "Not on lead day",
			Status:           model.ObligationStatusOpen,
			OwnerUserID:      ownerID,
			OwnerName:        "Owner",
			DueDate:          asOf.AddDate(0, 0, 3),
			ReminderEnabled:  true,
			ReminderLeadDays: []int{30, 7, 1},
		},
		{
			ID:                 uuid.New(),
			Title:              "Overdue escalation",
			Status:             model.ObligationStatusOpen,
			OwnerUserID:        ownerID,
			OwnerName:          "Owner",
			DueDate:            asOf.AddDate(0, 0, -2),
			EscalationEnabled:  true,
			EscalationLeadDays: []int{7, 1},
		},
		{
			ID:               uuid.New(),
			Title:            "Already sent today",
			Status:           model.ObligationStatusOpen,
			OwnerUserID:      ownerID,
			OwnerName:        "Owner",
			DueDate:          asOf.AddDate(0, 0, 1),
			ReminderEnabled:  true,
			ReminderLeadDays: []int{1},
			LastReminderAt:   &sameDayReminder,
		},
	}

	events := planNotificationEvents(obligations, asOf, 30, true)
	if len(events) != 2 {
		t.Fatalf("events len = %d, want 2: %#v", len(events), events)
	}
	if events[0].Type != model.ObligationNotificationEscalation || events[0].Reason != "obligation overdue" {
		t.Fatalf("first event = %#v, want overdue escalation", events[0])
	}
	if events[1].Type != model.ObligationNotificationReminder || events[1].LeadDays != 7 {
		t.Fatalf("second event = %#v, want 7-day reminder", events[1])
	}
	if events[1].EventID == uuid.Nil {
		t.Fatal("event id is nil, want deterministic id")
	}
}

func TestOutboxItemsFromNotificationEventsDeduplicatesByObligationChannelScheduledDate(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	ownerID := uuid.New()
	obligationID := uuid.New()
	asOf := time.Date(2026, 6, 14, 0, 0, 0, 0, time.UTC)
	escalationTarget := "legal-ops@example.test"
	events := []model.ObligationNotificationEvent{
		{
			EventID:         uuid.New(),
			Type:            model.ObligationNotificationReminder,
			ObligationID:    obligationID,
			ObligationTitle: "File renewal notice",
			OwnerUserID:     ownerID,
			OwnerName:       "Contract Owner",
			LeadDays:        7,
			PlannedFor:      asOf,
		},
		{
			EventID:          uuid.New(),
			Type:             model.ObligationNotificationEscalation,
			ObligationID:     obligationID,
			ObligationTitle:  "File renewal notice",
			OwnerUserID:      ownerID,
			OwnerName:        "Contract Owner",
			LeadDays:         7,
			PlannedFor:       asOf.Add(2 * time.Hour),
			EscalationTarget: &escalationTarget,
		},
	}

	items := outboxItemsFromNotificationEvents(tenantID, userID, events, []model.ObligationNotificationChannel{
		model.ObligationNotificationChannelEmail,
		model.ObligationNotificationChannelEmail,
		model.ObligationNotificationChannelInApp,
	})
	if len(items) != 2 {
		t.Fatalf("outbox items len = %d, want 2: %#v", len(items), items)
	}
	if items[0].Channel != model.ObligationNotificationChannelEmail || items[1].Channel != model.ObligationNotificationChannelInApp {
		t.Fatalf("channels = [%s %s], want [email in_app]", items[0].Channel, items[1].Channel)
	}
	for _, item := range items {
		if item.Status != model.ObligationNotificationOutboxPending {
			t.Fatalf("status = %q, want pending", item.Status)
		}
		if item.CreatedBy != userID {
			t.Fatalf("created_by = %s, want %s", item.CreatedBy, userID)
		}
		if !item.ScheduledAt.Equal(asOf) {
			t.Fatalf("scheduled_at = %s, want %s", item.ScheduledAt, asOf)
		}
		if item.RecipientUserID == nil || *item.RecipientUserID != ownerID {
			t.Fatalf("recipient_user_id = %v, want %s", item.RecipientUserID, ownerID)
		}
	}
}

func TestManualReminderSentOutboxItemCapturesProviderMetadata(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	ownerID := uuid.New()
	obligation := model.Obligation{
		ID:          uuid.New(),
		OwnerUserID: ownerID,
		OwnerName:   "Contract Owner",
	}
	sentAt := time.Date(2026, 6, 14, 15, 30, 0, 0, time.UTC)
	scheduledAt := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	contact := " owner@example.test "
	req := dto.MarkObligationReminderSentRequest{
		EventType:         model.ObligationNotificationReminder,
		LeadDays:          7,
		Provider:          " mailgun ",
		ProviderMessageID: " msg-123 ",
		ProviderMetadata:  map[string]any{"template": "obligation-reminder"},
		RecipientContact:  &contact,
	}
	req.Normalize()

	item := manualReminderSentOutboxItem(tenantID, userID, obligation, req, model.ObligationNotificationChannelEmail, scheduledAt, sentAt)
	if item.Status != model.ObligationNotificationOutboxSent {
		t.Fatalf("status = %q, want sent", item.Status)
	}
	if item.AttemptCount != 1 {
		t.Fatalf("attempt_count = %d, want 1", item.AttemptCount)
	}
	if item.Provider != "mailgun" || item.ProviderMessageID == nil || *item.ProviderMessageID != "msg-123" {
		t.Fatalf("provider fields = %q %v, want mailgun msg-123", item.Provider, item.ProviderMessageID)
	}
	if item.RecipientContact == nil || *item.RecipientContact != "owner@example.test" {
		t.Fatalf("recipient_contact = %v, want trimmed email", item.RecipientContact)
	}
	if item.SentAt == nil || !item.SentAt.Equal(sentAt) {
		t.Fatalf("sent_at = %v, want %s", item.SentAt, sentAt)
	}
	if item.LastAttemptAt == nil || !item.LastAttemptAt.Equal(sentAt) {
		t.Fatalf("last_attempt_at = %v, want %s", item.LastAttemptAt, sentAt)
	}
	if !item.ScheduledAt.Equal(time.Date(2026, 6, 14, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("scheduled_at = %s, want normalized date", item.ScheduledAt)
	}
	if item.EventID == uuid.Nil {
		t.Fatal("event id is nil, want deterministic planned notification id")
	}
}

func TestBuildLocalReminderDeliveryAttemptSuccessCapturesProviderMetadata(t *testing.T) {
	tenantID := uuid.New()
	attemptedAt := time.Date(2026, 6, 14, 16, 45, 0, 0, time.UTC)
	channels := []model.ObligationNotificationChannel{
		model.ObligationNotificationChannelEmail,
		model.ObligationNotificationChannelCalendar,
		model.ObligationNotificationChannelInApp,
	}

	for _, channel := range channels {
		item := testReminderOutboxItem(tenantID, channel, model.ObligationNotificationOutboxPending)
		delivery := buildLocalReminderDeliveryAttempt(tenantID, item, "", attemptedAt)
		if delivery.Status != model.ObligationNotificationOutboxSent {
			t.Fatalf("channel %s status = %q, want sent", channel, delivery.Status)
		}
		if delivery.Provider != "local" {
			t.Fatalf("channel %s provider = %q, want local", channel, delivery.Provider)
		}
		if delivery.ProviderMessageID == nil || *delivery.ProviderMessageID == "" {
			t.Fatalf("channel %s provider_message_id missing", channel)
		}
		if delivery.ProviderMetadata["provider"] != "local" || delivery.ProviderMetadata["channel"] != string(channel) {
			t.Fatalf("channel %s metadata = %#v, want provider/channel", channel, delivery.ProviderMetadata)
		}
		if delivery.ProviderMetadata["attempted_at"] != attemptedAt.Format(time.RFC3339Nano) {
			t.Fatalf("channel %s attempted_at = %v, want %s", channel, delivery.ProviderMetadata["attempted_at"], attemptedAt.Format(time.RFC3339Nano))
		}
		summary, ok := delivery.ProviderMetadata["payload_summary"].(map[string]any)
		if !ok {
			t.Fatalf("channel %s payload_summary missing: %#v", channel, delivery.ProviderMetadata)
		}
		if summary["payload_hash"] == "" || summary["obligation_id"] != item.ObligationID.String() {
			t.Fatalf("channel %s payload summary = %#v, want deterministic obligation summary", channel, summary)
		}
		switch channel {
		case model.ObligationNotificationChannelCalendar:
			if delivery.ProviderMetadata["calendar_event_id"] != *delivery.ProviderMessageID {
				t.Fatalf("calendar_event_id = %v, want provider message id %s", delivery.ProviderMetadata["calendar_event_id"], *delivery.ProviderMessageID)
			}
		default:
			if delivery.ProviderMetadata["message_id"] != *delivery.ProviderMessageID {
				t.Fatalf("message_id = %v, want provider message id %s", delivery.ProviderMetadata["message_id"], *delivery.ProviderMessageID)
			}
		}
	}
}

func TestBuildLocalReminderDeliveryAttemptFailsClosedForUnsupportedProviderAndChannel(t *testing.T) {
	tenantID := uuid.New()
	attemptedAt := time.Date(2026, 6, 14, 16, 45, 0, 0, time.UTC)

	item := testReminderOutboxItem(tenantID, model.ObligationNotificationChannelEmail, model.ObligationNotificationOutboxPending)
	unsupportedProvider := buildLocalReminderDeliveryAttempt(tenantID, item, "smtp", attemptedAt)
	if unsupportedProvider.Status != model.ObligationNotificationOutboxFailed {
		t.Fatalf("unsupported provider status = %q, want failed", unsupportedProvider.Status)
	}
	if unsupportedProvider.ErrorMessage == nil || *unsupportedProvider.ErrorMessage != "unsupported reminder dispatch provider" {
		t.Fatalf("unsupported provider error = %v, want unsupported provider", unsupportedProvider.ErrorMessage)
	}

	item.Channel = model.ObligationNotificationChannel("sms")
	unsupportedChannel := buildLocalReminderDeliveryAttempt(tenantID, item, "local", attemptedAt)
	if unsupportedChannel.Status != model.ObligationNotificationOutboxFailed {
		t.Fatalf("unsupported channel status = %q, want failed", unsupportedChannel.Status)
	}
	if unsupportedChannel.ErrorMessage == nil || *unsupportedChannel.ErrorMessage != "unsupported reminder notification channel" {
		t.Fatalf("unsupported channel error = %v, want unsupported channel", unsupportedChannel.ErrorMessage)
	}

	otherTenant := uuid.New()
	tenantMismatch := buildLocalReminderDeliveryAttempt(otherTenant, item, "local", attemptedAt)
	if tenantMismatch.Status != model.ObligationNotificationOutboxFailed {
		t.Fatalf("tenant mismatch status = %q, want failed", tenantMismatch.Status)
	}
	if tenantMismatch.ErrorMessage == nil || *tenantMismatch.ErrorMessage != "tenant mismatch" {
		t.Fatalf("tenant mismatch error = %v, want tenant mismatch", tenantMismatch.ErrorMessage)
	}
}

func TestDeterministicObligationReminderNotificationDispatcherProducesOutboundProof(t *testing.T) {
	tenantID := uuid.New()
	attemptedAt := time.Date(2026, 6, 14, 16, 45, 0, 0, time.UTC)
	item := testReminderOutboxItem(tenantID, model.ObligationNotificationChannelCalendar, model.ObligationNotificationOutboxPending)
	dispatcher := DeterministicObligationReminderNotificationDispatcher{}

	dispatch, err := dispatcher.DispatchObligationReminder(context.Background(), tenantID, item, "", attemptedAt)
	if err != nil {
		t.Fatalf("DispatchObligationReminder() error = %v", err)
	}
	if dispatch.Status != model.ObligationNotificationOutboxSent {
		t.Fatalf("status = %q, want sent", dispatch.Status)
	}
	if dispatch.Provider != "local" || dispatch.ProviderStatus != "sent" || dispatch.DeliveryStatus != "accepted" {
		t.Fatalf("provider proof = %#v, want local/sent/accepted", dispatch)
	}
	if dispatch.ProviderMessageID == "" {
		t.Fatal("provider_message_id is empty, want deterministic calendar event id")
	}
	if dispatch.ProviderMetadata["calendar_event_id"] != dispatch.ProviderMessageID {
		t.Fatalf("calendar_event_id = %v, want %s", dispatch.ProviderMetadata["calendar_event_id"], dispatch.ProviderMessageID)
	}

	delivery := providerDispatchDeliveryAttempt("local", item, attemptedAt, dispatch)
	if delivery.Status != model.ObligationNotificationOutboxSent {
		t.Fatalf("delivery status = %q, want sent", delivery.Status)
	}
	if delivery.ProviderMetadata["provider_status"] != "sent" || delivery.ProviderMetadata["delivery_status"] != "accepted" {
		t.Fatalf("delivery statuses metadata = %#v, want provider/delivery statuses", delivery.ProviderMetadata)
	}
}

func TestProviderDispatchDeliveryAttemptFailsClosedOnIncompleteSentProof(t *testing.T) {
	tenantID := uuid.New()
	attemptedAt := time.Date(2026, 6, 14, 16, 45, 0, 0, time.UTC)
	item := testReminderOutboxItem(tenantID, model.ObligationNotificationChannelEmail, model.ObligationNotificationOutboxPending)
	dispatch := &ObligationReminderProviderDispatch{
		Status:           model.ObligationNotificationOutboxSent,
		Provider:         "mailgun",
		ProviderStatus:   "queued",
		DeliveryStatus:   "accepted",
		ProviderMetadata: map[string]any{"provider_attempt_id": "attempt-123"},
	}

	delivery := providerDispatchDeliveryAttempt("mailgun", item, attemptedAt, dispatch)
	if delivery.Status != model.ObligationNotificationOutboxFailed {
		t.Fatalf("status = %q, want failed", delivery.Status)
	}
	if delivery.ErrorMessage == nil || *delivery.ErrorMessage != "reminder notification provider message id is required" {
		t.Fatalf("error_message = %v, want missing message id error", delivery.ErrorMessage)
	}
	if delivery.ProviderMetadata["provider_attempt_id"] != "attempt-123" {
		t.Fatalf("provider metadata = %#v, want attempted provider metadata retained", delivery.ProviderMetadata)
	}
	if delivery.ProviderMetadata["provider_status"] != "queued" || delivery.ProviderMetadata["delivery_status"] != "accepted" {
		t.Fatalf("provider statuses = %#v, want original statuses retained", delivery.ProviderMetadata)
	}
}

func TestObligationServiceReminderDispatcherFakeExternalProof(t *testing.T) {
	tenantID := uuid.New()
	attemptedAt := time.Date(2026, 6, 14, 16, 45, 0, 0, time.UTC)
	item := testReminderOutboxItem(tenantID, model.ObligationNotificationChannelEmail, model.ObligationNotificationOutboxPending)
	service := NewObligationService(nil, nil, nil, nil, nil, nil, "", zerolog.Nop(), nil)
	service.SetReminderNotificationDispatcher(fakeObligationReminderDispatcher{
		dispatch: &ObligationReminderProviderDispatch{
			Status:            model.ObligationNotificationOutboxSent,
			Provider:          "mailgun",
			ProviderStatus:    "queued",
			DeliveryStatus:    "accepted",
			ProviderMessageID: "mg-msg-123",
			ProviderMetadata: map[string]any{
				"provider_attempt_id": "mg-attempt-123",
				"template":            "obligation-reminder",
			},
		},
	})

	delivery := service.dispatchObligationReminder(context.Background(), tenantID, item, "mailgun", attemptedAt)
	if delivery.Status != model.ObligationNotificationOutboxSent {
		t.Fatalf("status = %q, want sent", delivery.Status)
	}
	if delivery.Provider != "mailgun" || delivery.ProviderMessageID == nil || *delivery.ProviderMessageID != "mg-msg-123" {
		t.Fatalf("provider fields = %q %v, want mailgun mg-msg-123", delivery.Provider, delivery.ProviderMessageID)
	}
	if delivery.ProviderMetadata["provider_attempt_id"] != "mg-attempt-123" {
		t.Fatalf("provider metadata = %#v, want fake provider proof", delivery.ProviderMetadata)
	}
	if delivery.ProviderMetadata["provider_status"] != "queued" || delivery.ProviderMetadata["delivery_status"] != "accepted" {
		t.Fatalf("provider statuses = %#v, want queued/accepted", delivery.ProviderMetadata)
	}
}

func TestObligationServiceSetReminderNotificationDispatcherResetsToDefault(t *testing.T) {
	service := NewObligationService(nil, nil, nil, nil, nil, nil, "", zerolog.Nop(), nil)
	service.SetReminderNotificationDispatcher(fakeObligationReminderDispatcher{})
	service.SetReminderNotificationDispatcher(nil)

	if _, ok := service.dispatcher.(DeterministicObligationReminderNotificationDispatcher); !ok {
		t.Fatalf("dispatcher = %T, want DeterministicObligationReminderNotificationDispatcher", service.dispatcher)
	}
}

func TestReminderDispatchSkipReasonEnforcesIdempotency(t *testing.T) {
	tests := []struct {
		name   string
		status model.ObligationNotificationOutboxStatus
		retry  bool
		want   string
	}{
		{name: "pending dispatches", status: model.ObligationNotificationOutboxPending, retry: false, want: ""},
		{name: "sent skips without retry", status: model.ObligationNotificationOutboxSent, retry: false, want: "already_sent"},
		{name: "sent skips with retry", status: model.ObligationNotificationOutboxSent, retry: true, want: "already_sent"},
		{name: "failed skips without retry", status: model.ObligationNotificationOutboxFailed, retry: false, want: "retry_required"},
		{name: "failed retries", status: model.ObligationNotificationOutboxFailed, retry: true, want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := reminderDispatchSkipReason(tt.status, tt.retry); got != tt.want {
				t.Fatalf("reminderDispatchSkipReason(%q, %v) = %q, want %q", tt.status, tt.retry, got, tt.want)
			}
		})
	}
}

func TestValidateObligationReminderDeliveryRequestSentAndFailed(t *testing.T) {
	sent := dto.MarkObligationReminderDeliveryRequest{Status: model.ObligationNotificationOutboxSent}
	sent.Normalize()
	if err := validateObligationReminderDeliveryRequest(sent); err != nil {
		t.Fatalf("validate sent delivery error = %v, want nil", err)
	}

	failed := dto.MarkObligationReminderDeliveryRequest{Status: model.ObligationNotificationOutboxFailed, ErrorMessage: "smtp timeout"}
	failed.Normalize()
	if err := validateObligationReminderDeliveryRequest(failed); err != nil {
		t.Fatalf("validate failed delivery error = %v, want nil", err)
	}

	missingError := dto.MarkObligationReminderDeliveryRequest{Status: model.ObligationNotificationOutboxFailed}
	missingError.Normalize()
	if err := validateObligationReminderDeliveryRequest(missingError); err == nil {
		t.Fatal("validate failed delivery error = nil, want missing error_message validation")
	}

	pending := dto.MarkObligationReminderDeliveryRequest{Status: model.ObligationNotificationOutboxPending}
	pending.Normalize()
	if err := validateObligationReminderDeliveryRequest(pending); err == nil {
		t.Fatal("validate pending delivery error = nil, want invalid status validation")
	}
}

func TestValidateMatterExtractionLinkFailsClosed(t *testing.T) {
	matterID := uuid.New()
	if err := validateMatterExtractionLink(&matterID, false); err == nil {
		t.Fatal("validateMatterExtractionLink() error = nil, want validation error")
	}
	if err := validateMatterExtractionLink(&matterID, true); err != nil {
		t.Fatalf("validateMatterExtractionLink() error = %v, want nil", err)
	}
	if err := validateMatterExtractionLink(nil, false); err != nil {
		t.Fatalf("validateMatterExtractionLink(nil) error = %v, want nil", err)
	}
}

func testReminderOutboxItem(tenantID uuid.UUID, channel model.ObligationNotificationChannel, status model.ObligationNotificationOutboxStatus) model.ObligationNotificationOutboxItem {
	ownerID := uuid.New()
	contact := "owner@example.test"
	return model.ObligationNotificationOutboxItem{
		ID:               uuid.New(),
		TenantID:         tenantID,
		ObligationID:     uuid.New(),
		EventID:          uuid.New(),
		EventType:        model.ObligationNotificationReminder,
		LeadDays:         7,
		Channel:          channel,
		RecipientUserID:  &ownerID,
		RecipientName:    "Contract Owner",
		RecipientContact: &contact,
		ScheduledAt:      time.Date(2026, 6, 14, 9, 30, 0, 0, time.UTC),
		Status:           status,
		CreatedBy:        uuid.New(),
	}
}

type fakeObligationReminderDispatcher struct {
	dispatch *ObligationReminderProviderDispatch
	err      error
}

func (f fakeObligationReminderDispatcher) DispatchObligationReminder(_ context.Context, _ uuid.UUID, _ model.ObligationNotificationOutboxItem, _ string, _ time.Time) (*ObligationReminderProviderDispatch, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.dispatch, nil
}

func TestApplyMatterTriageMovesIntakeToReview(t *testing.T) {
	triagerID := uuid.New()
	ownerID := uuid.New()
	priority := model.LegalPriorityHigh
	matter := &model.Matter{
		ID:          uuid.New(),
		Status:      model.MatterStatusIntake,
		Priority:    model.LegalPriorityMedium,
		OwnerUserID: uuid.New(),
		OwnerName:   "Old Owner",
		Metadata:    map[string]any{"source": "portal"},
	}
	req := dto.TriageMatterRequest{
		Status:      model.MatterStatusInReview,
		Priority:    &priority,
		OwnerUserID: &ownerID,
		Notes:       "Ready for legal review",
		Metadata:    map[string]any{"triage_queue": "commercial"},
	}
	req.Normalize()

	if err := validateMatterTriage(matter, req); err != nil {
		t.Fatalf("validateMatterTriage() error = %v", err)
	}
	applyMatterTriage(matter, req, triagerID, time.Date(2026, 6, 14, 10, 0, 0, 0, time.UTC))
	if matter.Status != model.MatterStatusInReview {
		t.Fatalf("matter status = %q, want in_review", matter.Status)
	}
	if matter.Priority != model.LegalPriorityHigh {
		t.Fatalf("matter priority = %q, want high", matter.Priority)
	}
	if matter.OwnerUserID != ownerID {
		t.Fatalf("owner_user_id = %s, want %s", matter.OwnerUserID, ownerID)
	}
	if matter.Metadata["triage_queue"] != "commercial" {
		t.Fatalf("triage_queue metadata = %v, want commercial", matter.Metadata["triage_queue"])
	}
	triage, ok := matter.Metadata["intake_triage"].(map[string]any)
	if !ok {
		t.Fatal("intake_triage metadata missing")
	}
	if triage["previous_status"] != model.MatterStatusIntake {
		t.Fatalf("previous_status = %v, want intake", triage["previous_status"])
	}
}
