//go:build integration

package repository_test

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

func startPGForRLS(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("dr_rls_it"),
		postgresmod.WithUsername("dr"),
		postgresmod.WithPassword("dr"),
		postgresmod.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn := container.MustConnectionString(ctx, "sslmode=disable")
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "migrations", "dr_db")
	migs, err := filepath.Glob(filepath.Join(migDir, "*.up.sql"))
	if err != nil {
		t.Fatalf("glob dr_db migrations: %v", err)
	}
	sort.Strings(migs)
	for _, m := range migs {
		b, err := os.ReadFile(m)
		if err != nil {
			t.Fatalf("read migration %s: %v", m, err)
		}
		if _, err := pool.Exec(ctx, string(b)); err != nil {
			t.Fatalf("apply migration %s: %v", filepath.Base(m), err)
		}
	}
	if _, err := pool.Exec(ctx, `
CREATE ROLE dr_app LOGIN PASSWORD 'dr_app';
GRANT USAGE ON SCHEMA public TO dr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dr_app;
`); err != nil {
		t.Fatalf("create app role: %v", err)
	}

	appURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse postgres dsn: %v", err)
	}
	appURL.User = url.UserPassword("dr_app", "dr_app")
	appPool, err := pgxpool.New(ctx, appURL.String())
	if err != nil {
		t.Fatalf("open app pool: %v", err)
	}
	t.Cleanup(appPool.Close)
	return ctx, appPool
}

func TestLiveDBRLSIsolationHidesOtherTenantRows(t *testing.T) {
	ctx, pool := startPGForRLS(t)
	repo := repository.New()
	tenantA := uuid.New()
	tenantB := uuid.New()

	site := &model.ProtectedSite{
		TenantID:            tenantA.String(),
		Name:                "tenant-a-primary",
		Kind:                model.SiteKindDatabase,
		PrimaryEndpoint:     "pg://primary",
		RTOObjectiveSeconds: 900,
		RPOObjectiveSeconds: 300,
	}
	if err := database.RunWithTenant(ctx, pool, tenantA, func(tx pgx.Tx) error {
		return repo.CreateSite(ctx, tx, site)
	}); err != nil {
		t.Fatalf("seed tenant A site: %v", err)
	}

	if err := database.RunReadWithTenant(ctx, pool, tenantB, func(tx pgx.Tx) error {
		var count int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM protected_site`).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			t.Fatalf("tenant B raw count = %d, want 0 under RLS", count)
		}
		sites, err := repo.ListSites(ctx, tx, tenantB.String())
		if err != nil {
			return err
		}
		if len(sites) != 0 {
			t.Fatalf("tenant B repository sites = %d, want 0", len(sites))
		}
		return nil
	}); err != nil {
		t.Fatalf("tenant B read: %v", err)
	}

	if err := database.RunReadWithTenant(ctx, pool, tenantA, func(tx pgx.Tx) error {
		var count int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM protected_site`).Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			t.Fatalf("tenant A raw count = %d, want 1", count)
		}
		return nil
	}); err != nil {
		t.Fatalf("tenant A read: %v", err)
	}
}
