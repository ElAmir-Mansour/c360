package consumer

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/lex/model"
)

// TestContractIntakeReceiptRoutesToRequester covers PRD §9.1: when a contract is
// received at the legal review desk (intake_opened), the requester (contract owner)
// gets an in-app inbox row + email receipt carrying the desk reference number — NOT
// the desk clerk who processed the intake.
func TestContractIntakeReceiptRoutesToRequester(t *testing.T) {
	tenantID := uuid.New()
	clerkID := uuid.New()
	requesterID := uuid.New()
	contractID := uuid.New()
	eventID := uuid.New()
	payload, err := json.Marshal(map[string]any{
		"contract_id":       contractID.String(),
		"intake_id":         uuid.New().String(),
		"reference_number":  "CRD-2026-000042",
		"contract_title":    "Vendor Services Agreement",
		"status":            "received",
		"requester_user_id": requesterID.String(),
		"requester_name":    "Sara Al-Otaibi",
	})
	if err != nil {
		t.Fatal(err)
	}

	notifier := &fakeLexNotifier{}
	consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
	if err := consumer.Handle(context.Background(), &events.Event{
		ID:       eventID.String(),
		Type:     "com.clario360.lex.contract_review_desk.intake_opened",
		TenantID: tenantID.String(),
		UserID:   clerkID.String(),
		Time:     time.Date(2026, 7, 17, 9, 0, 0, 0, time.UTC),
		Data:     payload,
	}); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(notifier.calls) != 1 {
		t.Fatalf("notifications = %d, want 1", len(notifier.calls))
	}
	got := notifier.calls[0]
	if got.tenantID != tenantID {
		t.Fatalf("tenantID = %s, want %s", got.tenantID, tenantID)
	}
	if got.input.RecipientID != requesterID {
		t.Fatalf("RecipientID = %s, want requester %s (not clerk %s)", got.input.RecipientID, requesterID, clerkID)
	}
	if got.input.Category != model.NotificationCategoryContract {
		t.Fatalf("Category = %s, want %s", got.input.Category, model.NotificationCategoryContract)
	}
	if got.input.EntityType != "contract" {
		t.Fatalf("EntityType = %q, want contract", got.input.EntityType)
	}
	if got.input.EntityID == nil || *got.input.EntityID != contractID {
		t.Fatalf("EntityID = %v, want %s", got.input.EntityID, contractID)
	}
	if !got.input.Email {
		t.Fatalf("Email = false, want true for contract receipt")
	}
	if got.input.EventID == nil || *got.input.EventID != eventID {
		t.Fatalf("EventID = %v, want %s", got.input.EventID, eventID)
	}
	if got.input.DedupKey == "" {
		t.Fatalf("DedupKey empty, want a dedup key for idempotent redelivery")
	}
	if got.input.Title.EN != "Contract received by legal review desk" {
		t.Fatalf("Title.EN = %q, want receipt title", got.input.Title.EN)
	}
	if !strings.Contains(got.input.Body.EN, "CRD-2026-000042") {
		t.Fatalf("Body.EN = %q, want it to contain the reference number", got.input.Body.EN)
	}
	if got.input.Metadata["reference_number"] != "CRD-2026-000042" {
		t.Fatalf("Metadata reference_number = %v, want CRD-2026-000042", got.input.Metadata["reference_number"])
	}
}

// TestContractIntakeAcknowledgedReceipt covers the acknowledgement leg: the
// requester gets a distinct acknowledgement row + email once the desk acknowledges
// receipt.
func TestContractIntakeAcknowledgedReceipt(t *testing.T) {
	tenantID := uuid.New()
	requesterID := uuid.New()
	contractID := uuid.New()
	payload, err := json.Marshal(map[string]any{
		"contract_id":       contractID.String(),
		"reference_number":  "CRD-2026-000042",
		"status":            "acknowledged",
		"requester_user_id": requesterID.String(),
	})
	if err != nil {
		t.Fatal(err)
	}

	notifier := &fakeLexNotifier{}
	consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
	if err := consumer.Handle(context.Background(), &events.Event{
		ID:       uuid.New().String(),
		Type:     "com.clario360.lex.contract_review_desk.intake_acknowledged",
		TenantID: tenantID.String(),
		UserID:   uuid.New().String(),
		Data:     payload,
	}); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(notifier.calls) != 1 {
		t.Fatalf("notifications = %d, want 1", len(notifier.calls))
	}
	got := notifier.calls[0]
	if got.input.RecipientID != requesterID {
		t.Fatalf("RecipientID = %s, want requester %s", got.input.RecipientID, requesterID)
	}
	if !got.input.Email {
		t.Fatalf("Email = false, want true for acknowledgement receipt")
	}
	if got.input.Title.EN != "Contract review acknowledged" {
		t.Fatalf("Title.EN = %q, want acknowledgement title", got.input.Title.EN)
	}
	if got.input.Title.AR == "" {
		t.Fatalf("Title.AR empty, want Arabic acknowledgement title")
	}
}

// TestContractIntakeReceiptSkippedWithoutRequester verifies we do NOT fall back to
// the event actor (the desk clerk): an intake event with no requester_user_id
// produces no notification.
func TestContractIntakeReceiptSkippedWithoutRequester(t *testing.T) {
	tenantID := uuid.New()
	clerkID := uuid.New()
	payload, err := json.Marshal(map[string]any{
		"contract_id":      uuid.New().String(),
		"reference_number": "CRD-2026-000043",
		"status":           "received",
	})
	if err != nil {
		t.Fatal(err)
	}

	notifier := &fakeLexNotifier{}
	consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
	if err := consumer.Handle(context.Background(), &events.Event{
		ID:       uuid.New().String(),
		Type:     "com.clario360.lex.contract_review_desk.intake_opened",
		TenantID: tenantID.String(),
		UserID:   clerkID.String(),
		Data:     payload,
	}); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(notifier.calls) != 0 {
		t.Fatalf("notifications = %d, want 0 (no fall-back to the desk clerk actor)", len(notifier.calls))
	}
}
