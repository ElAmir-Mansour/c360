//go:build integration

package rehearsalproof_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"
)

// This integration test proves the APPEND-ONLY guarantee of the sealed
// rehearsal-proof ledger AT THE DATABASE LAYER, against an EPHEMERAL
// testcontainers Postgres (spun up and torn down in-test — never a shared/prod
// DB). Migration 000045 installs a BEFORE UPDATE OR DELETE trigger
// (dr_rehearsal_proof_immutable_guard) that raises an exception on any mutation.
// A sealed, signed proof is auditor evidence; it must never be altered or
// deleted after it is written, INCLUDING under a bypass-RLS maintenance context.
//
// The assertions are specific: INSERT succeeds, UPDATE is rejected with the
// "immutable (update refused)" message, DELETE is rejected with the "append-only
// (delete refused)" message.

func startEphemeralPG(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("dr_proof_it"),
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

	// Apply every dr_db migration in order so the trigger (000045) exists exactly
	// as it does in production. Mirrors the repository RLS integration harness.
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
	return ctx, pool
}

// insertProof inserts one valid sealed-proof row under a bypass-RLS system tx and
// returns its id. It uses bypass-RLS so the INSERT path is exercised without
// having to satisfy tenant RLS policy for the fixture — the point of the test is
// the immutability trigger, which fires regardless of RLS.
func insertProof(ctx context.Context, t *testing.T, pool *pgxpool.Pool, tenantID uuid.UUID) uuid.UUID {
	t.Helper()
	envelope := map[string]any{
		"schema_version":  "clario.dr.rehearsal_proof.v1",
		"id":              uuid.NewString(),
		"tenant_id":       tenantID.String(),
		"overall_verdict": "passed",
	}
	envJSON, err := json.Marshal(envelope)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}

	var id uuid.UUID
	err = withBypassRLS(ctx, pool, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO dr_rehearsal_proof
    (tenant_id, subject_kind, subject_run_id, envelope_json, envelope_hash,
     signature, signature_alg, signed_at, worm_object_key, ledger_seq, ledger_entry_hash)
VALUES ($1, 'gameday', 'run-append-only', $2, 'sha256:deadbeef',
        'c2lnbmF0dXJl', 'RSA-SHA256', now(), 'worm/key', 1, 'entryhash')
RETURNING id`, tenantID, envJSON).Scan(&id)
	})
	if err != nil {
		t.Fatalf("INSERT of a sealed proof must succeed, got: %v", err)
	}
	if id == uuid.Nil {
		t.Fatalf("insert returned nil id")
	}
	return id
}

func TestRehearsalProofAppendOnly_InsertSucceeds_UpdateAndDeleteRejected(t *testing.T) {
	ctx, pool := startEphemeralPG(t)
	tenantID := uuid.New()

	// (1) INSERT succeeds.
	id := insertProof(ctx, t, pool, tenantID)

	// Sanity: the row is present.
	assertProofCount(ctx, t, pool, tenantID, id, 1)

	// (2) UPDATE is rejected by the immutability trigger — even under bypass-RLS.
	updateErr := withBypassRLS(ctx, pool, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`UPDATE dr_rehearsal_proof SET signature = 'tampered' WHERE id = $1`, id)
		return err
	})
	if updateErr == nil {
		t.Fatalf("UPDATE of a sealed proof MUST be rejected by the append-only trigger")
	}
	assertRaisedException(t, updateErr, "immutable (update refused)")

	// (3) DELETE is rejected by the immutability trigger — even under bypass-RLS.
	deleteErr := withBypassRLS(ctx, pool, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM dr_rehearsal_proof WHERE id = $1`, id)
		return err
	})
	if deleteErr == nil {
		t.Fatalf("DELETE of a sealed proof MUST be rejected by the append-only trigger")
	}
	assertRaisedException(t, deleteErr, "append-only (delete refused)")

	// (4) The row is UNCHANGED and STILL PRESENT — neither mutation took effect.
	assertProofCount(ctx, t, pool, tenantID, id, 1)
	assertSignatureUnchanged(ctx, t, pool, id, "c2lnbmF0dXJl")
}

func TestRehearsalProofAppendOnly_TriggerAndPoliciesInstalled(t *testing.T) {
	ctx, pool := startEphemeralPG(t)

	// The BEFORE UPDATE OR DELETE trigger must exist on the table.
	var triggerName string
	err := pool.QueryRow(ctx, `
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'dr_rehearsal_proof'::regclass
  AND NOT tgisinternal
  AND tgname = 'trg_dr_rehearsal_proof_immutable'`).Scan(&triggerName)
	if err != nil {
		t.Fatalf("append-only trigger not installed on dr_rehearsal_proof: %v", err)
	}
	if triggerName != "trg_dr_rehearsal_proof_immutable" {
		t.Fatalf("unexpected trigger name %q", triggerName)
	}

	// There must be NO tenant_update / tenant_delete RLS policy on the table — the
	// append-only design deliberately omits them; the trigger is the hard backstop.
	var mutatingPolicies int
	if err := pool.QueryRow(ctx, `
SELECT count(*) FROM pg_policies
WHERE tablename = 'dr_rehearsal_proof'
  AND policyname IN ('tenant_update', 'tenant_delete')`).Scan(&mutatingPolicies); err != nil {
		t.Fatalf("query policies: %v", err)
	}
	if mutatingPolicies != 0 {
		t.Fatalf("dr_rehearsal_proof must have NO update/delete RLS policies, found %d", mutatingPolicies)
	}
}

// --- helpers -----------------------------------------------------------------

// withBypassRLS runs fn inside a transaction with app.bypass_rls = 'on', proving
// the immutability trigger is a hard backstop that fires even in a maintenance
// context that bypasses row-level security.
func withBypassRLS(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, "SELECT set_config('app.bypass_rls', 'on', true)"); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func assertProofCount(ctx context.Context, t *testing.T, pool *pgxpool.Pool, tenantID, id uuid.UUID, want int) {
	t.Helper()
	var count int
	err := withBypassRLS(ctx, pool, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT count(*) FROM dr_rehearsal_proof WHERE tenant_id = $1 AND id = $2`,
			tenantID, id).Scan(&count)
	})
	if err != nil {
		t.Fatalf("count proofs: %v", err)
	}
	if count != want {
		t.Fatalf("proof row count = %d, want %d", count, want)
	}
}

func assertSignatureUnchanged(ctx context.Context, t *testing.T, pool *pgxpool.Pool, id uuid.UUID, want string) {
	t.Helper()
	var sig string
	err := withBypassRLS(ctx, pool, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT signature FROM dr_rehearsal_proof WHERE id = $1`, id).Scan(&sig)
	})
	if err != nil {
		t.Fatalf("read signature: %v", err)
	}
	if sig != want {
		t.Fatalf("signature was mutated: got %q, want %q (append-only violated)", sig, want)
	}
}

// assertRaisedException asserts the error is a Postgres RAISE EXCEPTION whose
// message contains want — proving the SPECIFIC trigger rejection fired (not some
// other constraint error).
func assertRaisedException(t *testing.T, err error, want string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected a Postgres error, got %T: %v", err, err)
	}
	// P0001 = raise_exception (plpgsql RAISE EXCEPTION).
	if pgErr.Code != "P0001" {
		t.Fatalf("expected raise_exception (P0001), got code %s: %s", pgErr.Code, pgErr.Message)
	}
	if !strings.Contains(pgErr.Message, want) {
		t.Fatalf("trigger rejection message = %q, want it to contain %q", pgErr.Message, want)
	}
}
