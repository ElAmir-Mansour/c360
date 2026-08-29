package service

import (
	"strings"
	"testing"
	"time"

	"github.com/clario360/platform/internal/notification/model"
)

func TestQuietHoursActiveAt_SameDayWindow(t *testing.T) {
	qh := &model.QuietHours{
		Enabled:   true,
		StartTime: "09:00",
		EndTime:   "17:00",
		Timezone:  "UTC",
	}

	tests := []struct {
		name string
		at   time.Time
		want bool
	}{
		{name: "before start", at: time.Date(2026, 1, 2, 8, 59, 0, 0, time.UTC), want: false},
		{name: "at start", at: time.Date(2026, 1, 2, 9, 0, 0, 0, time.UTC), want: true},
		{name: "inside", at: time.Date(2026, 1, 2, 12, 30, 0, 0, time.UTC), want: true},
		{name: "at end", at: time.Date(2026, 1, 2, 17, 0, 0, 0, time.UTC), want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := QuietHoursActiveAt(qh, tt.at)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("expected %v, got %v", tt.want, got)
			}
		})
	}
}

func TestQuietHoursActiveAt_OvernightWindow(t *testing.T) {
	qh := &model.QuietHours{
		Enabled:   true,
		StartTime: "22:00",
		EndTime:   "07:00",
		Timezone:  "UTC",
	}

	tests := []struct {
		name string
		at   time.Time
		want bool
	}{
		{name: "before start", at: time.Date(2026, 1, 2, 21, 59, 0, 0, time.UTC), want: false},
		{name: "late night", at: time.Date(2026, 1, 2, 23, 30, 0, 0, time.UTC), want: true},
		{name: "early morning", at: time.Date(2026, 1, 3, 6, 59, 0, 0, time.UTC), want: true},
		{name: "at end", at: time.Date(2026, 1, 3, 7, 0, 0, 0, time.UTC), want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := QuietHoursActiveAt(qh, tt.at)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("expected %v, got %v", tt.want, got)
			}
		})
	}
}

func TestQuietHoursActiveAt_UsesConfiguredTimezone(t *testing.T) {
	qh := &model.QuietHours{
		Enabled:   true,
		StartTime: "22:00",
		EndTime:   "07:00",
		Timezone:  "Asia/Riyadh",
	}

	got, err := QuietHoursActiveAt(qh, time.Date(2026, 1, 2, 20, 30, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got {
		t.Fatal("expected UTC timestamp to be evaluated in Asia/Riyadh quiet hours")
	}
}

func TestShouldDeferForQuietHours_CriticalBypassesQuietHours(t *testing.T) {
	pref := &model.NotificationPreference{
		QuietHours: &model.QuietHours{
			Enabled:   true,
			StartTime: "22:00",
			EndTime:   "07:00",
			Timezone:  "UTC",
		},
	}
	at := time.Date(2026, 1, 2, 23, 30, 0, 0, time.UTC)

	got, err := ShouldDeferForQuietHours(pref, model.PriorityCritical, at)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got {
		t.Fatal("critical notifications should not be deferred")
	}

	got, err = ShouldDeferForQuietHours(pref, model.PriorityHigh, at)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got {
		t.Fatal("non-critical notifications should be deferred during quiet hours")
	}
}

func TestQuietHoursActiveAt_InvalidConfiguration(t *testing.T) {
	tests := []struct {
		name string
		qh   *model.QuietHours
		want string
	}{
		{
			name: "bad timezone",
			qh:   &model.QuietHours{Enabled: true, StartTime: "22:00", EndTime: "07:00", Timezone: "Mars/Base"},
			want: "invalid timezone",
		},
		{
			name: "bad hour",
			qh:   &model.QuietHours{Enabled: true, StartTime: "24:00", EndTime: "07:00", Timezone: "UTC"},
			want: "hour must be 00-23",
		},
		{
			name: "bad format",
			qh:   &model.QuietHours{Enabled: true, StartTime: "9:00", EndTime: "07:00", Timezone: "UTC"},
			want: "expected HH:MM",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := QuietHoursActiveAt(tt.qh, time.Date(2026, 1, 2, 23, 30, 0, 0, time.UTC))
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected error containing %q, got %v", tt.want, err)
			}
		})
	}
}
