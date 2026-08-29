package model

import (
	"testing"
	"time"
)

// TestWebhookComputeDerived asserts the derived status matrix (inactive /
// failing / active) and the JSONB hydration of headers and retry policy,
// including the default-policy fallback when the raw column is empty or invalid.
func TestWebhookComputeDerived(t *testing.T) {
	tests := []struct {
		name       string
		wh         Webhook
		wantStatus string
	}{
		{
			name:       "inactive when not active",
			wh:         Webhook{Active: false},
			wantStatus: "inactive",
		},
		{
			name:       "failing when only failures recorded",
			wh:         Webhook{Active: true, FailureCount: 3, SuccessCount: 0},
			wantStatus: "failing",
		},
		{
			name:       "active when healthy",
			wh:         Webhook{Active: true, SuccessCount: 5, FailureCount: 1},
			wantStatus: "active",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wh := tt.wh
			wh.ComputeDerived()
			if wh.Status != tt.wantStatus {
				t.Fatalf("status = %q, want %q", wh.Status, tt.wantStatus)
			}
			// Headers must never be left nil so the JSON response serialises {}.
			if wh.Headers == nil {
				t.Error("expected Headers initialised to non-nil map")
			}
		})
	}
}

func TestWebhookComputeDerived_Hydration(t *testing.T) {
	wh := Webhook{
		Active:         true,
		SuccessCount:   1,
		HeadersRaw:     []byte(`{"X-Signature":"abc"}`),
		RetryPolicyRaw: []byte(`{"max_retries":7,"backoff_type":"fixed","initial_delay_seconds":30}`),
	}
	wh.ComputeDerived()

	if wh.Headers["X-Signature"] != "abc" {
		t.Errorf("headers did not hydrate: %+v", wh.Headers)
	}
	if wh.RetryPolicy.MaxRetries != 7 || wh.RetryPolicy.BackoffType != "fixed" {
		t.Errorf("retry policy did not hydrate: %+v", wh.RetryPolicy)
	}
}

func TestWebhookComputeDerived_DefaultRetryPolicy(t *testing.T) {
	// Empty raw → defaults.
	wh := Webhook{Active: true, SuccessCount: 1}
	wh.ComputeDerived()
	if wh.RetryPolicy != DefaultRetryPolicy() {
		t.Errorf("expected default retry policy for empty raw, got %+v", wh.RetryPolicy)
	}

	// Invalid JSON → defaults (never a partially-populated policy).
	wh = Webhook{Active: true, SuccessCount: 1, RetryPolicyRaw: []byte(`not-json`)}
	wh.ComputeDerived()
	if wh.RetryPolicy != DefaultRetryPolicy() {
		t.Errorf("expected default retry policy for invalid raw, got %+v", wh.RetryPolicy)
	}
}

// TestNotificationComputeRead asserts Read is derived from ReadAt.
func TestNotificationComputeRead(t *testing.T) {
	var n Notification
	n.ComputeRead()
	if n.Read {
		t.Error("expected Read=false when ReadAt is nil")
	}

	now := time.Now()
	n.ReadAt = &now
	n.ComputeRead()
	if !n.Read {
		t.Error("expected Read=true when ReadAt is set")
	}
}
