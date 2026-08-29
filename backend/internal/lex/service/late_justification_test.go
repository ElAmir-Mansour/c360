package service

import (
	"testing"
	"time"
)

func TestValidateLateJustification(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	late := now.Add(-time.Nanosecond)
	if _, err := validateLateJustification(&late, now, nil); err == nil {
		t.Fatal("late terminal transition without justification must fail")
	}
	raw := "  Waiting for the counterparty response. "
	got, err := validateLateJustification(&late, now, &raw)
	if err != nil || got == nil || *got != "Waiting for the counterparty response." {
		t.Fatalf("validated justification = %#v, err=%v", got, err)
	}

	onTime := now
	got, err = validateLateJustification(&onTime, now, &raw)
	if err != nil || got != nil {
		t.Fatalf("completion exactly at deadline must be on time; got %#v, err=%v", got, err)
	}
}

func TestLateJustificationManagerRole(t *testing.T) {
	tests := map[string]string{
		"contract":      lateJustificationManagerRole("contract", ""),
		"case":          lateJustificationManagerRole("legal_case", ""),
		"requester DOA": lateJustificationManagerRole("legal_request_approval", ""),
		"general":       lateJustificationManagerRole("", "GENERAL_LEGAL_REQUEST"),
	}
	wants := map[string]string{
		"contract":      legalContractsManagerRole,
		"case":          legalCasesManagerRole,
		"requester DOA": legalDepartmentManagerRole,
		"general":       legalSharedServicesManagerRole,
	}
	for name, got := range tests {
		if got != wants[name] {
			t.Errorf("%s manager = %q, want %q", name, got, wants[name])
		}
	}
}
