package readmodel

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
)

// TenantReadRunner runs a function in a tenant-scoped read transaction.
type TenantReadRunner interface {
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// PGXRunner adapts a pgx pool to TenantReadRunner using the shared tenant
// transaction helper.
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunReadWithTenant runs fn in a read-only tenant transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("readmodel: nil transaction pool")
	}
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// Service builds repository-backed read models inside one tenant read
// transaction per public method.
type Service struct {
	runner TenantReadRunner
	store  RepositoryStore
	now    func() time.Time
}

// ServiceConfig wires a Service.
type ServiceConfig struct {
	Runner TenantReadRunner
	// Store is optional; it defaults to repository.New().
	Store RepositoryStore
	// Now is optional; it defaults to time.Now. Inject it for deterministic tests.
	Now func() time.Time
}

// NewService constructs a repository-backed readmodel service.
func NewService(cfg ServiceConfig) (*Service, error) {
	if cfg.Runner == nil {
		return nil, errors.New("readmodel service: runner is required")
	}
	store := cfg.Store
	if store == nil {
		store = repository.New()
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Service{runner: cfg.Runner, store: store, now: now}, nil
}

// BuildPosture builds the tenant-wide posture read model in one read
// transaction.
func (s *Service) BuildPosture(ctx context.Context, tenantID uuid.UUID) (*Posture, error) {
	var posture *Posture
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var err error
		posture, err = BuildPosture(ctx, NewRepositoryReader(s.store, db), tenantID, s.now())
		return err
	})
	return posture, err
}

// BuildReplicationSummary builds the tenant-wide replication read model in one
// read transaction.
func (s *Service) BuildReplicationSummary(ctx context.Context, tenantID uuid.UUID) (*ReplicationSummary, error) {
	var summary *ReplicationSummary
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var err error
		summary, err = BuildReplicationSummary(ctx, NewRepositoryReader(s.store, db), tenantID, s.now())
		return err
	})
	return summary, err
}

// BuildGroupSummary builds one group detail read model in one read transaction.
func (s *Service) BuildGroupSummary(ctx context.Context, tenantID, groupID uuid.UUID) (*GroupSummary, error) {
	var summary *GroupSummary
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var err error
		summary, err = BuildGroupSummary(ctx, NewRepositoryReader(s.store, db), tenantID, groupID, s.now())
		return err
	})
	return summary, err
}
