package service

import (
	"context"
	"errors"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
)

// fakePrefStore is an in-test preferenceStore whose Get can be forced to error.
type fakePrefStore struct {
	pref    *model.NotificationPreference
	getErr  error
	getHits int
}

func (f *fakePrefStore) Get(_ context.Context, _, _ string) (*model.NotificationPreference, error) {
	f.getHits++
	return f.pref, f.getErr
}

func (f *fakePrefStore) Upsert(_ context.Context, _ *model.NotificationPreference) error { return nil }

func newPrefSvc(store preferenceStore) *PreferenceService {
	// rdb nil exercises the nil-safe cache path.
	return &PreferenceService{repo: store, rdb: nil, logger: zerolog.Nop()}
}

// TestResolveChannels_FailsClosedOnError asserts that a resolution error
// (after the single DB retry) yields the fail-closed set — in_app only, ALL
// outbound channels suppressed — and NEVER model.DefaultPreferences (all-on).
func TestResolveChannels_FailsClosedOnError(t *testing.T) {
	store := &fakePrefStore{getErr: errors.New("db down")}
	svc := newPrefSvc(store)

	got, err := svc.ResolveChannels(context.Background(), "u1", "t1", model.NotifAlertCreated)
	if err == nil {
		t.Fatal("expected a non-nil error surfaced for observability")
	}
	if !got.InApp {
		t.Fatal("in_app must remain enabled (best-effort)")
	}
	if got.Email || got.Webhook || got.WebSocket {
		t.Fatalf("outbound channels must be suppressed on fail-closed, got %+v", got)
	}
	if got == model.DefaultPreferences {
		t.Fatal("must not substitute all-on DefaultPreferences on resolution error")
	}
	if store.getHits < 2 {
		t.Fatalf("expected a DB retry (>=2 Get calls), got %d", store.getHits)
	}
}

// TestResolveChannels_NoRecordUsesDefaults asserts an unconfigured user (no
// record, no error) resolves to the all-on defaults — NOT fail-closed.
func TestResolveChannels_NoRecordUsesDefaults(t *testing.T) {
	store := &fakePrefStore{pref: nil, getErr: nil}
	svc := newPrefSvc(store)

	got, err := svc.ResolveChannels(context.Background(), "u1", "t1", model.NotifAlertCreated)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != model.DefaultPreferences {
		t.Fatalf("unconfigured user should get defaults, got %+v", got)
	}
}

// TestResolveChannels_PerTypeOverride asserts a per-type preference wins over
// the global set.
func TestResolveChannels_PerTypeOverride(t *testing.T) {
	store := &fakePrefStore{pref: &model.NotificationPreference{
		GlobalPrefs: model.ChannelPreference{InApp: true, Email: true},
		PerTypePrefs: map[model.NotificationType]model.ChannelPreference{
			model.NotifAlertCreated: {InApp: true, Email: false, Webhook: true},
		},
	}}
	svc := newPrefSvc(store)

	got, err := svc.ResolveChannels(context.Background(), "u1", "t1", model.NotifAlertCreated)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Email {
		t.Fatal("per-type override should have disabled email")
	}
	if !got.Webhook {
		t.Fatal("per-type override should have enabled webhook")
	}
}
