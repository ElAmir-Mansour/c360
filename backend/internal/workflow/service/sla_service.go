package service

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/workflow/repository"
)

// WP-5 INTEGRATE — tenant-scoped CRUD service for SLA policies + business
// calendars. It is the write-side counterpart to DBSLAPolicyResolver: the HTTP
// handler authors policies/calendars through this service, and the scheduler
// resolver reads them back. Every operation runs inside a tenant transaction
// (database.RunWithTenant for writes, RunReadWithTenant for reads) so the
// RLS-forced workflow_sla_policies / workflow_calendars tables resolve
// app.current_tenant_id — the bare pool is never used for these tables.

// slaWriteStore is the full persistence surface the CRUD service needs.
type slaWriteStore interface {
	CreatePolicy(ctx context.Context, db repository.PromotionDBTX, p *repository.SLAPolicyRecord) error
	GetPolicy(ctx context.Context, db repository.PromotionDBTX, tenantID, id string) (*repository.SLAPolicyRecord, error)
	UpdatePolicy(ctx context.Context, db repository.PromotionDBTX, p *repository.SLAPolicyRecord) error
	DeletePolicy(ctx context.Context, db repository.PromotionDBTX, tenantID, id string) error
	ListPolicies(ctx context.Context, db repository.PromotionDBTX, tenantID string) ([]*repository.SLAPolicyRecord, error)

	CreateCalendar(ctx context.Context, db repository.PromotionDBTX, c *repository.CalendarRecord) error
	GetCalendar(ctx context.Context, db repository.PromotionDBTX, tenantID, id string) (*repository.CalendarRecord, error)
	UpdateCalendar(ctx context.Context, db repository.PromotionDBTX, c *repository.CalendarRecord) error
	DeleteCalendar(ctx context.Context, db repository.PromotionDBTX, tenantID, id string) error
	ListCalendars(ctx context.Context, db repository.PromotionDBTX, tenantID string) ([]*repository.CalendarRecord, error)
}

// slaTxRunner abstracts "run fn inside one tenant transaction" for both read and
// write paths. Production uses poolSLATxRunner; tests inject a fake.
type slaTxRunner interface {
	RunWrite(ctx context.Context, tenantID string, fn func(db repository.PromotionDBTX) error) error
	RunRead(ctx context.Context, tenantID string, fn func(db repository.PromotionDBTX) error) error
}

// poolSLATxRunner is the production slaTxRunner backed by a pgx pool.
type poolSLATxRunner struct {
	pool *pgxpool.Pool
}

// NewPoolSLATxRunner adapts a pgx pool to the SLA service's tx runner.
func NewPoolSLATxRunner(pool *pgxpool.Pool) slaTxRunner {
	return &poolSLATxRunner{pool: pool}
}

func (r *poolSLATxRunner) RunWrite(ctx context.Context, tenantID string, fn func(db repository.PromotionDBTX) error) error {
	tid, err := uuid.Parse(tenantID)
	if err != nil {
		return fmt.Errorf("invalid tenant id %q: %w", tenantID, err)
	}
	return database.RunWithTenant(ctx, r.pool, tid, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

func (r *poolSLATxRunner) RunRead(ctx context.Context, tenantID string, fn func(db repository.PromotionDBTX) error) error {
	tid, err := uuid.Parse(tenantID)
	if err != nil {
		return fmt.Errorf("invalid tenant id %q: %w", tenantID, err)
	}
	return database.RunReadWithTenant(ctx, r.pool, tid, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

// SLAService is the tenant-scoped CRUD service for SLA policies and calendars.
type SLAService struct {
	store  slaWriteStore
	runner slaTxRunner
	logger zerolog.Logger
}

// NewSLAService constructs the CRUD service from a pgx pool, building the
// concrete repository and tx runner internally.
func NewSLAService(pool *pgxpool.Pool, logger zerolog.Logger) *SLAService {
	return newSLAService(repository.NewSLARepository(), NewPoolSLATxRunner(pool), logger)
}

// newSLAService is the dependency-injected constructor used by tests.
func newSLAService(store slaWriteStore, runner slaTxRunner, logger zerolog.Logger) *SLAService {
	return &SLAService{
		store:  store,
		runner: runner,
		logger: logger.With().Str("service", "workflow-sla").Logger(),
	}
}

// ---------------------------------------------------------------------------
// SLA policy operations.
// ---------------------------------------------------------------------------

// CreatePolicy validates and inserts a new tiered SLA policy for the tenant.
func (s *SLAService) CreatePolicy(ctx context.Context, tenantID, userID string, p *repository.SLAPolicyRecord) (*repository.SLAPolicyRecord, error) {
	if tenantID == "" {
		return nil, fmt.Errorf("tenant id is required")
	}
	if err := validatePolicy(p); err != nil {
		return nil, err
	}
	p.TenantID = tenantID
	p.CreatedBy = userID
	if err := s.runner.RunWrite(ctx, tenantID, func(db repository.PromotionDBTX) error {
		return s.store.CreatePolicy(ctx, db, p)
	}); err != nil {
		return nil, err
	}
	return p, nil
}

// GetPolicy loads one SLA policy by id for the tenant.
func (s *SLAService) GetPolicy(ctx context.Context, tenantID, id string) (*repository.SLAPolicyRecord, error) {
	var out *repository.SLAPolicyRecord
	err := s.runner.RunRead(ctx, tenantID, func(db repository.PromotionDBTX) error {
		rec, err := s.store.GetPolicy(ctx, db, tenantID, id)
		if err != nil {
			return err
		}
		out = rec
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ListPolicies lists all SLA policies for the tenant.
func (s *SLAService) ListPolicies(ctx context.Context, tenantID string) ([]*repository.SLAPolicyRecord, error) {
	var out []*repository.SLAPolicyRecord
	err := s.runner.RunRead(ctx, tenantID, func(db repository.PromotionDBTX) error {
		recs, err := s.store.ListPolicies(ctx, db, tenantID)
		if err != nil {
			return err
		}
		out = recs
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// UpdatePolicy validates and updates an existing SLA policy.
func (s *SLAService) UpdatePolicy(ctx context.Context, tenantID, id string, p *repository.SLAPolicyRecord) (*repository.SLAPolicyRecord, error) {
	if err := validatePolicy(p); err != nil {
		return nil, err
	}
	p.ID = id
	p.TenantID = tenantID
	if err := s.runner.RunWrite(ctx, tenantID, func(db repository.PromotionDBTX) error {
		return s.store.UpdatePolicy(ctx, db, p)
	}); err != nil {
		return nil, err
	}
	return s.GetPolicy(ctx, tenantID, id)
}

// DeletePolicy soft-deletes an SLA policy.
func (s *SLAService) DeletePolicy(ctx context.Context, tenantID, id string) error {
	return s.runner.RunWrite(ctx, tenantID, func(db repository.PromotionDBTX) error {
		return s.store.DeletePolicy(ctx, db, tenantID, id)
	})
}

// ---------------------------------------------------------------------------
// Calendar operations.
// ---------------------------------------------------------------------------

// CreateCalendar validates and inserts a new business calendar for the tenant.
func (s *SLAService) CreateCalendar(ctx context.Context, tenantID, userID string, c *repository.CalendarRecord) (*repository.CalendarRecord, error) {
	if tenantID == "" {
		return nil, fmt.Errorf("tenant id is required")
	}
	if err := validateCalendar(c); err != nil {
		return nil, err
	}
	c.TenantID = tenantID
	c.CreatedBy = userID
	if err := s.runner.RunWrite(ctx, tenantID, func(db repository.PromotionDBTX) error {
		return s.store.CreateCalendar(ctx, db, c)
	}); err != nil {
		return nil, err
	}
	return c, nil
}

// GetCalendar loads one calendar by id for the tenant.
func (s *SLAService) GetCalendar(ctx context.Context, tenantID, id string) (*repository.CalendarRecord, error) {
	var out *repository.CalendarRecord
	err := s.runner.RunRead(ctx, tenantID, func(db repository.PromotionDBTX) error {
		rec, err := s.store.GetCalendar(ctx, db, tenantID, id)
		if err != nil {
			return err
		}
		out = rec
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ListCalendars lists all calendars for the tenant.
func (s *SLAService) ListCalendars(ctx context.Context, tenantID string) ([]*repository.CalendarRecord, error) {
	var out []*repository.CalendarRecord
	err := s.runner.RunRead(ctx, tenantID, func(db repository.PromotionDBTX) error {
		recs, err := s.store.ListCalendars(ctx, db, tenantID)
		if err != nil {
			return err
		}
		out = recs
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateCalendar validates and updates an existing calendar.
func (s *SLAService) UpdateCalendar(ctx context.Context, tenantID, id string, c *repository.CalendarRecord) (*repository.CalendarRecord, error) {
	if err := validateCalendar(c); err != nil {
		return nil, err
	}
	c.ID = id
	c.TenantID = tenantID
	if err := s.runner.RunWrite(ctx, tenantID, func(db repository.PromotionDBTX) error {
		return s.store.UpdateCalendar(ctx, db, c)
	}); err != nil {
		return nil, err
	}
	return s.GetCalendar(ctx, tenantID, id)
}

// DeleteCalendar soft-deletes a calendar.
func (s *SLAService) DeleteCalendar(ctx context.Context, tenantID, id string) error {
	return s.runner.RunWrite(ctx, tenantID, func(db repository.PromotionDBTX) error {
		return s.store.DeleteCalendar(ctx, db, tenantID, id)
	})
}

// ---------------------------------------------------------------------------
// Validation. Errors carry "invalid"/"required" so the handler's
// handleServiceError classifies them as 400 VALIDATION_ERROR.
// ---------------------------------------------------------------------------

// validatePolicy checks a policy is well-formed: a name, at least one tier, every
// tier valid (non-negative offset, recognised action, non-empty target), and
// non-negative reminder offsets.
func validatePolicy(p *repository.SLAPolicyRecord) error {
	if p == nil {
		return fmt.Errorf("policy is required")
	}
	if p.Name == "" {
		return fmt.Errorf("policy name is required")
	}
	if len(p.Tiers) == 0 {
		return fmt.Errorf("policy must declare at least one tier (invalid empty tiers)")
	}
	for i, t := range p.Tiers {
		if t.AfterSeconds < 0 {
			return fmt.Errorf("tier %d has invalid negative after_seconds", i)
		}
		action := t.Action
		if action == "" {
			action = SLAActionNotify
		}
		if !validSLAActions[action] {
			return fmt.Errorf("tier %d has invalid action %q (must be notify, reassign, or escalate)", i, t.Action)
		}
		if t.Notify == "" {
			return fmt.Errorf("tier %d is missing a notify target (required)", i)
		}
	}
	for i, sec := range p.RemindBefore {
		if sec < 0 {
			return fmt.Errorf("remind_before[%d] is invalid (negative)", i)
		}
	}
	return nil
}

// validateCalendar checks a calendar is well-formed: a name, a loadable timezone,
// at least one open working day, and well-ordered windows. Holidays must parse as
// YYYY-MM-DD.
func validateCalendar(c *repository.CalendarRecord) error {
	if c == nil {
		return fmt.Errorf("calendar is required")
	}
	if c.Name == "" {
		return fmt.Errorf("calendar name is required")
	}
	tz := c.Timezone
	if tz == "" {
		tz = "UTC"
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return fmt.Errorf("invalid timezone %q: %w", c.Timezone, err)
	}
	if len(c.WorkingDays) == 0 {
		return fmt.Errorf("calendar must declare at least one working day (invalid empty working_days)")
	}
	open := 0
	for key, wd := range c.WorkingDays {
		n, err := strconv.Atoi(key)
		if err != nil || n < 0 || n > 6 {
			return fmt.Errorf("invalid working_days key %q (must be 0..6)", key)
		}
		if wd.StartMinute < 0 || wd.EndMinute > 24*60 {
			return fmt.Errorf("working day %q has an invalid window (minutes out of range)", key)
		}
		if wd.EndMinute > wd.StartMinute {
			open++
		}
	}
	if open == 0 {
		return fmt.Errorf("calendar has no open working window (invalid: every day is closed)")
	}
	for _, h := range c.Holidays {
		if _, err := time.Parse("2006-01-02", h); err != nil {
			return fmt.Errorf("invalid holiday %q (must be YYYY-MM-DD): %w", h, err)
		}
	}
	return nil
}
