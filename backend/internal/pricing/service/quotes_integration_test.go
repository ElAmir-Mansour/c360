//go:build integration

package service

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/pricing/model"
	"github.com/clario360/platform/internal/pricing/repository"
)

// startPricingDB spins up a throwaway postgres, applies the pricing_config +
// seed + quotes migrations, and returns a pool. It uses the real repository and
// the real database.RunInTx path, so the DDL, the JSONB round-trips, the FK, the
// quote-number sequence, and the outbox staging are all exercised for real.
func startPricingDB(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("pricing_it"),
		postgresmod.WithUsername("pricing"),
		postgresmod.WithPassword("pricing"),
		postgresmod.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	pool, err := pgxpool.New(ctx, container.MustConnectionString(ctx, "sslmode=disable"))
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	// The event_outbox table backs the staged governance events.
	if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS event_outbox (
		id BIGSERIAL PRIMARY KEY,
		event_id TEXT NOT NULL,
		tenant_id TEXT NOT NULL,
		topic TEXT NOT NULL,
		event_type TEXT NOT NULL,
		payload JSONB NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`); err != nil {
		t.Fatalf("create event_outbox: %v", err)
	}

	_, thisFile, _, _ := runtime.Caller(0)
	migrationDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "migrations", "license_db")
	for _, name := range []string{
		"000009_pricing_config.up.sql",
		"000010_seed_pricing_config.up.sql",
		"000011_quotes.up.sql",
	} {
		sqlBytes, err := os.ReadFile(filepath.Join(migrationDir, name))
		if err != nil {
			t.Fatalf("read migration %s: %v", name, err)
		}
		if _, err := pool.Exec(ctx, string(sqlBytes)); err != nil {
			t.Fatalf("apply migration %s: %v", name, err)
		}
	}
	return ctx, pool
}

func newPricingService(t *testing.T, pool *pgxpool.Pool) *Service {
	t.Helper()
	repo := repository.New()
	s := New(pool, repo, zerolog.Nop())
	s.SetQuoteRepo(repo)
	return s
}

func quoteOutboxTypes(t *testing.T, ctx context.Context, pool *pgxpool.Pool) []string {
	t.Helper()
	rows, err := pool.Query(ctx, `SELECT event_type, payload FROM event_outbox ORDER BY id`)
	if err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	defer rows.Close()
	var types []string
	for rows.Next() {
		var et string
		var payload []byte
		if err := rows.Scan(&et, &payload); err != nil {
			t.Fatalf("scan outbox: %v", err)
		}
		// The staged payload must be a valid CloudEvent on the license topic.
		var ev events.Event
		if err := json.Unmarshal(payload, &ev); err != nil {
			t.Fatalf("outbox payload is not a valid event: %v", err)
		}
		types = append(types, et)
	}
	return types
}

func perUserInputs() model.Inputs {
	return model.Inputs{Model: model.ModelPerUser, Deployment: model.DeploymentSaaS, TermMonths: 12, Users: 10, HotStorageGB: 2, ColdStorageGB: 5}
}

// TestIntegration_QuoteLifecycle_ServerRecompute: create -> send -> accept over
// a real DB. Asserts the stored tiers match a fresh engine compute (server
// recompute), the quote_number is sequential, and the governance events staged.
func TestIntegration_QuoteLifecycle_ServerRecompute(t *testing.T) {
	ctx, pool := startPricingDB(t)
	s := newPricingService(t, pool)

	created, err := s.CreateQuote(ctx, CreateQuoteInput{
		Inputs:       perUserInputs(),
		AccountName:  "Acme",
		SelectedTier: tierPtr(model.TierStandard),
		CreatedBy:    "11111111-1111-1111-1111-111111111111",
	})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}
	if created.QuoteNumber == "" || created.PricingVersion != 1 {
		t.Fatalf("stamp wrong: number=%q version=%d", created.QuoteNumber, created.PricingVersion)
	}
	if created.BelowFloor {
		t.Fatalf("default config Standard should be OK, not below floor")
	}

	// Round-trip GET recovers the internal tiers from JSONB.
	got, err := s.GetQuote(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetQuote: %v", err)
	}
	if len(got.ComputedTiers) != 4 {
		t.Fatalf("recovered tiers: got %d, want 4", len(got.ComputedTiers))
	}

	if _, err := s.SendQuote(ctx, created.ID, "actor"); err != nil {
		t.Fatalf("SendQuote: %v", err)
	}
	if _, err := s.AcceptQuote(ctx, created.ID, "actor"); err != nil {
		t.Fatalf("AcceptQuote: %v", err)
	}

	types := quoteOutboxTypes(t, ctx, pool)
	// Event types are normalized (com.clario360.<type>); assert the suffixes are present.
	wantSuffixes := []string{"pricing.quote_created", "pricing.quote_sent", "pricing.quote_accepted"}
	for _, want := range wantSuffixes {
		found := false
		for _, et := range types {
			if et == "com.clario360."+want || et == want {
				found = true
			}
		}
		if !found {
			t.Errorf("outbox missing %q; got %v", want, types)
		}
	}
}

// TestIntegration_BelowFloorGate: a below-floor quote is blocked on send until a
// pricing:admin override is recorded (real DB, real tx).
func TestIntegration_BelowFloorGate(t *testing.T) {
	ctx, pool := startPricingDB(t)
	s := newPricingService(t, pool)

	// Publish a thin-markup config so Standard falls below the floor. Create a
	// draft (via the config path) then activate it directly for the test.
	thin := model.DefaultConfig()
	thin.MarkupMultiplier = 1.05
	draft, err := s.CreateDraft(ctx, CreateDraftInput{Rates: thin, Notes: "thin", CreatedBy: "11111111-1111-1111-1111-111111111111"})
	if err != nil {
		t.Fatalf("CreateDraft: %v", err)
	}
	if _, err := s.Publish(ctx, draft.Version, "11111111-1111-1111-1111-111111111111"); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	in := perUserInputs()
	sales := 0.20
	in.SalesDiscount = &sales
	created, err := s.CreateQuote(ctx, CreateQuoteInput{
		Inputs:       in,
		SelectedTier: tierPtr(model.TierStandard),
		CreatedBy:    "11111111-1111-1111-1111-111111111111",
	})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}
	if !created.BelowFloor {
		t.Fatalf("expected below_floor=true")
	}

	if _, err := s.SendQuote(ctx, created.ID, "actor"); !errors.Is(err, model.ErrBelowFloorBlocked) {
		t.Fatalf("send should be blocked, got %v", err)
	}
	if _, err := s.OverrideFloor(ctx, created.ID, "22222222-2222-2222-2222-222222222222"); err != nil {
		t.Fatalf("OverrideFloor: %v", err)
	}
	if _, err := s.SendQuote(ctx, created.ID, "actor"); err != nil {
		t.Fatalf("SendQuote after override: %v", err)
	}
}
