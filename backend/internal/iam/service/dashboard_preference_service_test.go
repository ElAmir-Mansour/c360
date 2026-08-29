package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/model"
)

type dashboardPreferenceRepoStub struct {
	preference *model.DashboardPreference
	deleted    bool
}

func (r *dashboardPreferenceRepoStub) Get(context.Context, string, string) (*model.DashboardPreference, error) {
	if r.preference == nil {
		return nil, model.ErrNotFound
	}
	return r.preference, nil
}

func (r *dashboardPreferenceRepoStub) Upsert(_ context.Context, preference *model.DashboardPreference) error {
	r.preference = preference
	return nil
}

func (r *dashboardPreferenceRepoStub) Delete(context.Context, string, string) error {
	r.deleted = true
	return nil
}

func TestDashboardPreferenceServiceRoundTripAndReset(t *testing.T) {
	repo := &dashboardPreferenceRepoStub{}
	svc := NewDashboardPreferenceService(repo)

	empty, err := svc.Get(context.Background(), "tenant-a", "user-a")
	if err != nil || string(empty.Preferences) != "{}" {
		t.Fatalf("expected empty preferences, got %s, %v", empty.Preferences, err)
	}

	updated, err := svc.Update(context.Background(), "tenant-a", "user-a", &dto.DashboardPreferenceRequest{
		Preferences: json.RawMessage(`{"preset":"my-work","horizonDays":30}`),
	})
	if err != nil {
		t.Fatalf("update preferences: %v", err)
	}
	if updated == nil || repo.preference.TenantID != "tenant-a" || repo.preference.UserID != "user-a" {
		t.Fatal("preference was not tenant and user scoped")
	}

	if err := svc.Reset(context.Background(), "tenant-a", "user-a"); err != nil || !repo.deleted {
		t.Fatalf("reset preferences: deleted=%v err=%v", repo.deleted, err)
	}
}

func TestDashboardPreferenceServiceRejectsInvalidOrOversizedValues(t *testing.T) {
	svc := NewDashboardPreferenceService(&dashboardPreferenceRepoStub{})
	cases := []json.RawMessage{
		json.RawMessage(`[]`),
		json.RawMessage(`{"broken"`),
		json.RawMessage(`{"payload":"` + strings.Repeat("x", maxDashboardPreferenceBytes) + `"}`),
	}
	for _, raw := range cases {
		_, err := svc.Update(context.Background(), "tenant-a", "user-a", &dto.DashboardPreferenceRequest{Preferences: raw})
		if !errors.Is(err, model.ErrValidation) {
			t.Fatalf("expected validation error for %d-byte payload, got %v", len(raw), err)
		}
	}
}
