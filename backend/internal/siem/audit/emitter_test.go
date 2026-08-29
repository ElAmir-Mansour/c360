package audit_test

import (
	"context"
	"testing"

	auditmodel "github.com/clario360/platform/internal/audit/model"
	"github.com/clario360/platform/internal/siem/audit"
)

func TestNewSyntheticBootstrapEntry_Defaults(t *testing.T) {
	t.Parallel()
	entry := audit.NewSyntheticBootstrapEntry("", "")
	if entry.TenantID == "" {
		t.Error("TenantID default empty")
	}
	if entry.UserEmail == "" {
		t.Error("UserEmail default empty")
	}
	if entry.Service != "siem-service" {
		t.Errorf("Service=%s, want siem-service", entry.Service)
	}
	if entry.Action != "siem.bootstrap" {
		t.Errorf("Action=%s, want siem.bootstrap", entry.Action)
	}
	if entry.Severity != auditmodel.SeverityInfo {
		t.Errorf("Severity=%s, want info", entry.Severity)
	}
	if entry.ID == "" {
		t.Error("ID empty")
	}
	if entry.EventID == "" {
		t.Error("EventID empty")
	}
	if entry.CreatedAt.IsZero() {
		t.Error("CreatedAt zero")
	}
}

func TestNewSyntheticBootstrapEntry_RespectsCallerValues(t *testing.T) {
	t.Parallel()
	entry := audit.NewSyntheticBootstrapEntry("tenant-99", "ops@x.com")
	if entry.TenantID != "tenant-99" {
		t.Errorf("TenantID=%s, want tenant-99", entry.TenantID)
	}
	if entry.UserEmail != "ops@x.com" {
		t.Errorf("UserEmail=%s, want ops@x.com", entry.UserEmail)
	}
}

func TestInMemory_EmitCaptures(t *testing.T) {
	t.Parallel()
	em := audit.NewInMemory()
	entry := audit.NewSyntheticBootstrapEntry("t", "u@x")

	if err := em.Emit(context.Background(), entry); err != nil {
		t.Fatal(err)
	}
	if em.Len() != 1 {
		t.Fatalf("Len=%d, want 1", em.Len())
	}
	got := em.Entries()
	if len(got) != 1 || got[0].Action != "siem.bootstrap" {
		t.Errorf("unexpected captured entries: %+v", got)
	}
	// Entries() returns a copy.
	got[0].Action = "tampered"
	if em.Entries()[0].Action != "siem.bootstrap" {
		t.Error("Entries() must return a defensive copy")
	}
}

func TestNoOp_EmitNeverErrors(t *testing.T) {
	t.Parallel()
	em := audit.NewNoOp()
	if err := em.Emit(context.Background(), auditmodel.AuditEntry{}); err != nil {
		t.Fatal(err)
	}
}
