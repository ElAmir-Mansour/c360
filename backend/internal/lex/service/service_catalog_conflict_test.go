package service

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// TestServiceCatalogUniqueViolationClassifiedAsConflict is the no-DB assertion of
// the error mapping the fix relies on: a duplicate code raises SQLSTATE 23505 on
// idx_legal_service_catalog_code_unique, and that PgError — whether it surfaces at
// the INSERT or (for a deferred CONSTRAINT) at COMMIT — must classify as a 409
// conflict, never a 500. pgx surfaces the server error unwrapped, which is exactly
// how ServiceCatalogService.Create/Update receive the tx.Commit() error.
func TestServiceCatalogUniqueViolationClassifiedAsConflict(t *testing.T) {
	pgErr := &pgconn.PgError{
		Severity:       "ERROR",
		Code:           "23505",
		Message:        `duplicate key value violates unique constraint "idx_legal_service_catalog_code_unique"`,
		ConstraintName: "idx_legal_service_catalog_code_unique",
	}
	if !isUniqueViolation(pgErr) {
		t.Fatalf("isUniqueViolation(23505 code constraint) = false, want true")
	}
	// Mirror the Create/Update commit-path branch: a classified unique violation
	// maps to conflictError (409); anything else maps to internalError (500).
	mapCommitErr := func(err error) error {
		if isUniqueViolation(err) {
			return conflictError("a service with this code or intake email already exists")
		}
		return internalError("commit service catalog create", err)
	}
	var appErr *apperrors.AppError
	if !asAppError(mapCommitErr(pgErr), &appErr) || appErr.Status != 409 {
		t.Fatalf("duplicate-code commit error mapped to %v, want 409 CONFLICT", mapCommitErr(pgErr))
	}
	// A non-23505 failure must still be a 500 (no over-broad conflict classification).
	other := &pgconn.PgError{Code: "23502", Message: "not-null violation"}
	if !asAppError(mapCommitErr(other), &appErr) || appErr.Status != 500 {
		t.Fatalf("non-unique error mapped to %v, want 500 INTERNAL_ERROR", mapCommitErr(other))
	}
}

// TestServiceCatalogCreateDuplicateCodeReturnsConflict is the end-to-end regression
// guard against BUG-2 (duplicate code -> HTTP 500). It enforces uniqueness with a
// DEFERRABLE INITIALLY DEFERRED constraint so the 23505 surfaces at tx.Commit() —
// the exact path the fix hardens. Requires PGVERIFY_DSN; skipped in DB-less CI.
func TestServiceCatalogCreateDuplicateCodeReturnsConflict(t *testing.T) {
	dsn := os.Getenv("PGVERIFY_DSN")
	if dsn == "" {
		t.Skip("set PGVERIFY_DSN to run the end-to-end duplicate-code regression test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()

	pool.Exec(ctx, `DROP TABLE IF EXISTS legal_service_catalog CASCADE`)
	if _, err := pool.Exec(ctx, `CREATE TABLE legal_service_catalog (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, code TEXT NOT NULL,
		request_type TEXT NOT NULL, name JSONB NOT NULL DEFAULT '{}'::jsonb, description JSONB NOT NULL DEFAULT '{}'::jsonb,
		available_to TEXT[] NOT NULL DEFAULT '{}', requester_approval_required BOOLEAN NOT NULL DEFAULT false,
		provider_approval_required BOOLEAN NOT NULL DEFAULT false, approval_policy_id UUID, intake_email TEXT,
		channel TEXT NOT NULL DEFAULT 'platform', active BOOLEAN NOT NULL DEFAULT true, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
		created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
		CONSTRAINT idx_legal_service_catalog_code_unique UNIQUE (tenant_id, code) DEFERRABLE INITIALLY DEFERRED)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS legal_service_eligibility_rules (
		id UUID PRIMARY KEY, tenant_id UUID, service_id UUID, rule_type TEXT, value TEXT, created_by UUID,
		created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), deleted_at TIMESTAMPTZ)`)
	defer pool.Exec(ctx, `DROP TABLE IF EXISTS legal_service_catalog CASCADE`)

	repo := repository.NewServiceCatalogRepository(pool, zerolog.Nop())
	svc := NewServiceCatalogService(pool, repo, nil, nil, nil, "", zerolog.Nop())
	tenant, user := uuid.New(), uuid.New()
	req := dto.CreateServiceCatalogRequest{
		Code: "DUP", RequestType: "contract",
		Name: forms.LocalizedText{EN: "X"}, AvailableTo: []string{}, Channel: model.ServiceChannelPlatform,
	}
	if _, err := svc.Create(ctx, tenant, user, req); err != nil {
		t.Fatalf("first create: %v", err)
	}
	_, err = svc.Create(ctx, tenant, user, req)
	if err == nil {
		t.Fatal("second create with duplicate code: expected an error, got nil")
	}
	var appErr *apperrors.AppError
	if !asAppError(err, &appErr) || appErr.Status != 409 {
		t.Fatalf("duplicate code returned %v, want 409 CONFLICT (BUG-2 regression)", err)
	}
}
