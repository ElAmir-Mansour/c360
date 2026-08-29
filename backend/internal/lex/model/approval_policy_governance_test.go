package model

import (
	"testing"
	"time"
)

func ts(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func tsp(s string) *time.Time {
	t := ts(s)
	return &t
}

func TestApprovalPolicy_IsEffectiveAt(t *testing.T) {
	at := ts("2026-06-15T12:00:00Z")

	cases := []struct {
		name       string
		validFrom  *time.Time
		validUntil *time.Time
		want       bool
	}{
		{"unbounded both ends", nil, nil, true},
		{"within window", tsp("2026-06-01T00:00:00Z"), tsp("2026-07-01T00:00:00Z"), true},
		{"before from", tsp("2026-06-20T00:00:00Z"), nil, false},
		{"after until", nil, tsp("2026-06-10T00:00:00Z"), false},
		{"open start, within until", nil, tsp("2026-07-01T00:00:00Z"), true},
		{"open end, after from", tsp("2026-06-01T00:00:00Z"), nil, true},
		{"exactly at from boundary", tsp("2026-06-15T12:00:00Z"), nil, true},
		{"exactly at until boundary", nil, tsp("2026-06-15T12:00:00Z"), true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := &ApprovalPolicy{ValidFrom: tc.validFrom, ValidUntil: tc.validUntil}
			if got := p.IsEffectiveAt(at); got != tc.want {
				t.Fatalf("IsEffectiveAt() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestApprovalPolicy_IsEffectiveAt_NilReceiver(t *testing.T) {
	var p *ApprovalPolicy
	if p.IsEffectiveAt(time.Now()) {
		t.Fatalf("nil policy must never be effective")
	}
}
