//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestObligationRTMCRUDAndScopedListsAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Watheeq Obligation Route Contract", model.ContractTypeServiceAgreement, 375_000, lifecycleContractText())
	contractID := contract.ID
	matter := mustData[model.Matter](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/matters", dto.CreateMatterRequest{
		Title:       "Watheeq Obligation Route Matter",
		Description: "Matter fixture for obligation route parity.",
		Type:        model.MatterTypeContract,
		Status:      model.MatterStatusOpen,
		Priority:    model.LegalPriorityHigh,
		OwnerUserID: h.userID,
		OwnerName:   "Integration Owner",
		Tags:        []string{"watheeq-rtm"},
		Metadata:    map[string]any{"control": "WTQ-OBL-SCOPE"},
		ContractIDs: []uuid.UUID{contractID},
	}), http.StatusCreated)
	matterID := matter.ID

	dueDate := time.Now().UTC().AddDate(0, 0, 21)
	escalationTarget := "legal-ops@example.test"
	created := mustData[model.Obligation](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/obligations", dto.CreateObligationRequest{
		Title:              "Submit vendor insurance certificate",
		Description:        "Counterparty must provide updated insurance evidence.",
		Type:               model.ObligationTypeCompliance,
		Status:             model.ObligationStatusOpen,
		Priority:           model.LegalPriorityHigh,
		ContractID:         &contractID,
		MatterID:           &matterID,
		OwnerUserID:        h.userID,
		OwnerName:          "Integration Owner",
		DueDate:            dueDate,
		ReminderEnabled:    true,
		ReminderLeadDays:   []int{21, 7, 1},
		EscalationEnabled:  true,
		EscalationLeadDays: []int{7},
		EscalationTarget:   &escalationTarget,
		Tags:               []string{"rtm", "compliance"},
		Metadata:           map[string]any{"control": "WTQ-OBL-CRUD"},
	}), http.StatusCreated)
	if created.ContractID == nil || *created.ContractID != contractID {
		t.Fatalf("created contract_id = %v, want %s", created.ContractID, contractID)
	}
	if created.MatterID == nil || *created.MatterID != matterID {
		t.Fatalf("created matter_id = %v, want %s", created.MatterID, matterID)
	}

	listed := mustPaginated[model.Obligation](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/obligations?page=1&per_page=20", nil), http.StatusOK)
	if !obligationSliceContains(listed.Data, created.ID) {
		t.Fatalf("global obligation list missing %s in %+v", created.ID, listed.Data)
	}

	detail := mustData[model.Obligation](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/watheeq/obligations/%s", created.ID), nil), http.StatusOK)
	if detail.ID != created.ID || detail.Title != created.Title {
		t.Fatalf("obligation detail = %+v, want created obligation %s", detail, created.ID)
	}

	newTitle := "Submit updated vendor insurance certificate"
	newPriority := model.LegalPriorityCritical
	newDueDate := dueDate.AddDate(0, 0, 7)
	updated := mustData[model.Obligation](t, h.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/obligations/%s", created.ID), dto.UpdateObligationRequest{
		Title:    &newTitle,
		Priority: &newPriority,
		DueDate:  &newDueDate,
		Tags:     []string{"rtm", "updated"},
		Metadata: map[string]any{"control": "WTQ-OBL-UPDATE"},
	}), http.StatusOK)
	if updated.Title != newTitle || updated.Priority != model.LegalPriorityCritical {
		t.Fatalf("updated obligation = %+v, want title/priority update", updated)
	}

	statused := mustData[model.Obligation](t, h.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/watheeq/obligations/%s/status", created.ID), dto.UpdateObligationStatusRequest{
		Status: model.ObligationStatusInProgress,
	}), http.StatusOK)
	if statused.Status != model.ObligationStatusInProgress {
		t.Fatalf("status = %s, want %s", statused.Status, model.ObligationStatusInProgress)
	}

	contractScoped := mustPaginated[model.Obligation](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/watheeq/contracts/%s/obligations?page=1&per_page=20", contractID), nil), http.StatusOK)
	if !obligationSliceContains(contractScoped.Data, created.ID) {
		t.Fatalf("contract-scoped list missing %s in %+v", created.ID, contractScoped.Data)
	}
	matterScoped := mustPaginated[model.Obligation](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/matters/%s/obligations?page=1&per_page=20", matterID), nil), http.StatusOK)
	if !obligationSliceContains(matterScoped.Data, created.ID) {
		t.Fatalf("matter-scoped list missing %s in %+v", created.ID, matterScoped.Data)
	}

	expectStatus(t, h.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/v1/watheeq/obligations/%s", created.ID), nil), http.StatusNoContent)
	mustError(t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/obligations/%s", created.ID), nil), http.StatusNotFound)
}

func TestObligationRTMExtractionAndReminderRoutesAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Watheeq Obligation Extraction Contract", model.ContractTypeServiceAgreement, 640_000, lifecycleContractText())

	asOf := time.Date(2026, 6, 14, 0, 0, 0, 0, time.UTC)
	dueDate := asOf.AddDate(0, 0, 7)
	includeRenewal := false
	reminderLeadDays := []int{7}
	extraction := mustData[model.ObligationExtractionResult](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/contracts/%s/obligations/extract", contract.ID), dto.ExtractObligationsRequest{
		OwnerUserID:             h.userID,
		OwnerName:               "Integration Owner",
		IncludeContractRenewal:  &includeRenewal,
		DefaultReminderLeadDays: reminderLeadDays,
		Items: []dto.ObligationExtractionItem{{
			Title:            "Submit quarterly KPI report",
			Description:      "Report service performance KPIs under the reporting clause.",
			Type:             model.ObligationTypeReporting,
			Priority:         model.LegalPriorityHigh,
			DueDate:          &dueDate,
			Source:           "analysis_clause",
			SourceReference:  "section 7.2",
			ReminderLeadDays: reminderLeadDays,
			Tags:             []string{"reporting"},
			Metadata:         map[string]any{"control": "WTQ-OBL-EXTRACT"},
		}},
		Tags:     []string{"watheeq-rtm"},
		Metadata: map[string]any{"commit": "acceptance"},
	}), http.StatusCreated)
	if extraction.CreatedCount != 1 || len(extraction.Created) != 1 {
		t.Fatalf("extraction created = %d/%d, want one committed obligation: %+v", extraction.CreatedCount, len(extraction.Created), extraction)
	}
	if len(extraction.Skipped) != 0 {
		t.Fatalf("extraction skipped = %+v, want none", extraction.Skipped)
	}
	extracted := extraction.Created[0]
	if extracted.ContractID == nil || *extracted.ContractID != contract.ID {
		t.Fatalf("extracted contract_id = %v, want %s", extracted.ContractID, contract.ID)
	}
	if extracted.Metadata["extraction"] == nil {
		t.Fatalf("extraction metadata missing from committed obligation: %+v", extracted.Metadata)
	}

	plan := mustData[model.ObligationReminderPlan](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/obligations/reminders?as_of=2026-06-14&horizon_days=14&include_escalations=false", nil), http.StatusOK)
	if !reminderPlanContains(plan, extracted.ID, model.ObligationNotificationReminder, 7) {
		t.Fatalf("reminder plan missing 7-day event for %s in %+v", extracted.ID, plan.Events)
	}

	horizonDays := 14
	includeEscalations := false
	enqueued := mustData[model.ObligationReminderEnqueueResult](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/obligations/reminders/enqueue", dto.EnqueueObligationRemindersRequest{
		AsOf:               &asOf,
		HorizonDays:        &horizonDays,
		IncludeEscalations: &includeEscalations,
		Channels:           []model.ObligationNotificationChannel{model.ObligationNotificationChannelEmail},
	}), http.StatusCreated)
	if enqueued.QueuedCount != 1 || len(enqueued.Queued) != 1 {
		t.Fatalf("enqueued = %+v, want one queued email reminder", enqueued)
	}
	queued := enqueued.Queued[0]
	if queued.ObligationID != extracted.ID || queued.Channel != model.ObligationNotificationChannelEmail || queued.Status != model.ObligationNotificationOutboxPending {
		t.Fatalf("queued outbox item = %+v, want pending email for %s", queued, extracted.ID)
	}

	sentAt := asOf.Add(10 * time.Hour)
	recipientContact := "owner@example.test"
	manualSent := mustData[model.Obligation](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/obligations/%s/reminders/sent", extracted.ID), dto.MarkObligationReminderSentRequest{
		SentAt:            &sentAt,
		ScheduledAt:       &asOf,
		Channel:           string(model.ObligationNotificationChannelInApp),
		EventType:         model.ObligationNotificationReminder,
		LeadDays:          7,
		Provider:          "manual",
		ProviderMessageID: "manual-reminder-001",
		ProviderMetadata:  map[string]any{"operator": "integration-test"},
		RecipientContact:  &recipientContact,
	}), http.StatusOK)
	if manualSent.LastReminderAt == nil {
		t.Fatalf("manual reminder sent did not update last_reminder_at: %+v", manualSent)
	}

	deliveryAttemptedAt := asOf.Add(time.Hour)
	delivery := mustData[model.ObligationNotificationOutboxItem](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/obligations/reminders/outbox/%s/delivery", queued.ID), dto.MarkObligationReminderDeliveryRequest{
		Status:            model.ObligationNotificationOutboxSent,
		AttemptedAt:       &deliveryAttemptedAt,
		Provider:          "local",
		ProviderMessageID: "local-email-acceptance-001",
		ProviderMetadata: map[string]any{
			"delivery_status": "accepted",
			"provider_status": "sent",
		},
	}), http.StatusOK)
	if delivery.Status != model.ObligationNotificationOutboxSent || delivery.Provider != "local" || delivery.ProviderMessageID == nil {
		t.Fatalf("delivery = %+v, want recorded local sent delivery", delivery)
	}
}

func obligationSliceContains(items []model.Obligation, id uuid.UUID) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func reminderPlanContains(plan model.ObligationReminderPlan, obligationID uuid.UUID, eventType model.ObligationNotificationType, leadDays int) bool {
	for _, event := range plan.Events {
		if event.ObligationID == obligationID && event.Type == eventType && event.LeadDays == leadDays {
			return true
		}
	}
	return false
}
