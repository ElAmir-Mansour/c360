package repository

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
)

func newPreferenceRepo(t *testing.T) (*PreferenceRepository, pgxmock.PgxPoolIface) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return &PreferenceRepository{db: mock, logger: zerolog.Nop()}, mock
}

// TestPreferenceGet_TenantScopedHydrates asserts Get filters by (user_id,
// tenant_id) and hydrates the JSONB columns into the typed preference.
func TestPreferenceGet_TenantScopedHydrates(t *testing.T) {
	repo, mock := newPreferenceRepo(t)

	mock.ExpectQuery(`FROM notification_preferences`).
		WithArgs("user-1", tenantA).
		WillReturnRows(pgxmock.NewRows([]string{
			"user_id", "tenant_id", "global_prefs", "per_type_prefs", "quiet_hours", "digest_config", "opted_out", "updated_at",
		}).AddRow(
			"user-1", tenantA,
			[]byte(`{"in_app":true,"email":true,"websocket":false,"webhook":false}`),
			[]byte(`{}`),
			[]byte(`null`),
			[]byte(`{"daily":true,"weekly":false}`),
			false, time.Now(),
		))

	pref, err := repo.Get(context.Background(), "user-1", tenantA)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if pref == nil {
		t.Fatal("expected a preference row")
	}
	if !pref.GlobalPrefs.Email || pref.GlobalPrefs.WebSocket {
		t.Errorf("global prefs did not hydrate: %+v", pref.GlobalPrefs)
	}
	if !pref.DigestConfig.Daily || pref.DigestConfig.Weekly {
		t.Errorf("digest config did not hydrate: %+v", pref.DigestConfig)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestPreferenceGet_NotFound asserts a missing row returns (nil, nil) — the
// caller then falls back to defaults rather than erroring.
func TestPreferenceGet_NotFound(t *testing.T) {
	repo, mock := newPreferenceRepo(t)

	mock.ExpectQuery(`FROM notification_preferences`).
		WithArgs("nobody", tenantA).
		WillReturnError(pgx.ErrNoRows)

	pref, err := repo.Get(context.Background(), "nobody", tenantA)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if pref != nil {
		t.Fatalf("expected nil pref for missing row, got %+v", pref)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestPreferenceUpsert_ConflictClause asserts the upsert runs and carries the
// user/tenant/opted-out scalars (the JSONB blobs are marshalled internally, so
// they are matched with AnyArg).
func TestPreferenceUpsert_ConflictClause(t *testing.T) {
	repo, mock := newPreferenceRepo(t)

	mock.ExpectExec(`INSERT INTO notification_preferences`).
		WithArgs("user-1", tenantA,
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			true,
		).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	err := repo.Upsert(context.Background(), &model.NotificationPreference{
		UserID:   "user-1",
		TenantID: tenantA,
		OptedOut: true,
	})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestPreferenceGetDigestSubscribers asserts the digest-type validation gate and
// the tenant-scoped subscriber query.
func TestPreferenceGetDigestSubscribers(t *testing.T) {
	repo, mock := newPreferenceRepo(t)

	// Invalid digest type is rejected before any query is issued.
	if _, err := repo.GetDigestSubscribers(context.Background(), tenantA, "hourly"); err == nil {
		t.Fatal("expected an error for an invalid digest type")
	}

	mock.ExpectQuery(`SELECT user_id FROM notification_preferences`).
		WithArgs(tenantA).
		WillReturnRows(pgxmock.NewRows([]string{"user_id"}).AddRow("user-1").AddRow("user-2"))

	subs, err := repo.GetDigestSubscribers(context.Background(), tenantA, "daily")
	if err != nil {
		t.Fatalf("GetDigestSubscribers: %v", err)
	}
	if len(subs) != 2 || subs[0] != "user-1" || subs[1] != "user-2" {
		t.Fatalf("unexpected subscribers: %v", subs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
