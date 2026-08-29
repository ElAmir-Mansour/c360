package bootgraph

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// DBTX is re-exported from the shared repository so the store, service, and
// orchestrator status sink all speak the same execution-context type: a
// *pgxpool.Pool for a single read, or the caller's open transaction so a boot
// definition write commits atomically with its outbox event. This package adds
// its OWN read/write methods for its four owned tables via raw queries rather
// than editing the shared repository.
type DBTX = repository.DBTX

// Store persists the boot dependency graph (dr_boot_service, dr_boot_dependency)
// and boot runs (dr_boot_run, dr_boot_service_status), and reads the consistency
// group the graph is defined over. It holds no state; the caller chooses the
// DBTX so a request runs under a tenant transaction.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

// GroupName returns the consistency group's name (RLS-scoped) or ErrGroupNotFound.
func (s *Store) GroupName(ctx context.Context, db DBTX, groupID string) (string, error) {
	var name string
	err := db.QueryRow(ctx, `SELECT name FROM consistency_group WHERE id = $1`, groupID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("group %s: %w", groupID, ErrGroupNotFound)
	}
	if err != nil {
		return "", fmt.Errorf("bootgraph: reading group %s: %w", groupID, err)
	}
	return name, nil
}

// ---------------------------------------------------------------------------
// Service + dependency definition (dr_boot_service, dr_boot_dependency).
// ---------------------------------------------------------------------------

// UpsertService inserts or updates a boot service by (group, name), returning the
// stored row. The health-check spec is replaced on conflict so a re-definition is
// idempotent.
func (s *Store) UpsertService(ctx context.Context, db DBTX, svc *Service) (*Service, error) {
	if !ValidProbeKind(svc.ProbeKind) {
		return nil, fmt.Errorf("%q: %w", svc.ProbeKind, ErrInvalidProbe)
	}
	var stored Service
	err := db.QueryRow(ctx, `
		INSERT INTO dr_boot_service
		    (tenant_id, group_id, name, kind, boot_action, probe_kind, probe_target,
		     probe_expect_status, boot_timeout_seconds, health_retries, site_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, '')::uuid)
		ON CONFLICT (group_id, name) DO UPDATE SET
		    kind = EXCLUDED.kind,
		    boot_action = EXCLUDED.boot_action,
		    probe_kind = EXCLUDED.probe_kind,
		    probe_target = EXCLUDED.probe_target,
		    probe_expect_status = EXCLUDED.probe_expect_status,
		    boot_timeout_seconds = EXCLUDED.boot_timeout_seconds,
		    health_retries = EXCLUDED.health_retries,
		    site_id = EXCLUDED.site_id,
		    updated_at = now()
		RETURNING id, tenant_id, group_id, name, kind, boot_action, probe_kind, probe_target,
		          probe_expect_status, boot_timeout_seconds, health_retries,
		          COALESCE(site_id::text, ''), created_at, updated_at`,
		svc.TenantID, svc.GroupID, svc.Name, svc.Kind, svc.BootAction, svc.ProbeKind, svc.ProbeTarget,
		svc.ProbeExpectStatus, svc.BootTimeoutSeconds, svc.HealthRetries, svc.SiteID,
	).Scan(&stored.ID, &stored.TenantID, &stored.GroupID, &stored.Name, &stored.Kind,
		&stored.BootAction, &stored.ProbeKind, &stored.ProbeTarget, &stored.ProbeExpectStatus,
		&stored.BootTimeoutSeconds, &stored.HealthRetries, &stored.SiteID, &stored.CreatedAt, &stored.UpdatedAt)
	if err != nil {
		if isForeignKeyViolation(err) {
			return nil, fmt.Errorf("bootgraph: group %s absent: %w", svc.GroupID, ErrGroupNotFound)
		}
		return nil, fmt.Errorf("bootgraph: upserting service %q: %w", svc.Name, err)
	}
	return &stored, nil
}

// InsertDependency adds a depends_on edge between two services of a group. A
// duplicate edge is a benign no-op (ON CONFLICT DO NOTHING) returning the
// existing row's effect; a missing endpoint maps to ErrServiceNotFound; a
// self-edge maps to ErrSelfDependency.
func (s *Store) InsertDependency(ctx context.Context, db DBTX, d *Dependency) error {
	if d.ServiceID == d.DependsOnID {
		return ErrSelfDependency
	}
	_, err := db.Exec(ctx, `
		INSERT INTO dr_boot_dependency (tenant_id, group_id, service_id, depends_on_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (service_id, depends_on_id) DO NOTHING`,
		d.TenantID, d.GroupID, d.ServiceID, d.DependsOnID)
	if err != nil {
		if isForeignKeyViolation(err) {
			return ErrServiceNotFound
		}
		if isUniqueViolation(err) {
			return nil
		}
		return fmt.Errorf("bootgraph: inserting dependency %s->%s: %w", d.ServiceID, d.DependsOnID, err)
	}
	return nil
}

// LoadServices reads all services of a group (after confirming the group exists),
// ordered by name for determinism.
func (s *Store) LoadServices(ctx context.Context, db DBTX, groupID string) ([]Service, error) {
	if _, err := s.GroupName(ctx, db, groupID); err != nil {
		return nil, err
	}
	rows, err := db.Query(ctx, `
		SELECT id, tenant_id, group_id, name, kind, boot_action, probe_kind, probe_target,
		       probe_expect_status, boot_timeout_seconds, health_retries,
		       COALESCE(site_id::text, ''), created_at, updated_at
		  FROM dr_boot_service
		 WHERE group_id = $1
		 ORDER BY name ASC, id ASC`, groupID)
	if err != nil {
		return nil, fmt.Errorf("bootgraph: reading services of group %s: %w", groupID, err)
	}
	defer rows.Close()
	var out []Service
	for rows.Next() {
		var svc Service
		if err := rows.Scan(&svc.ID, &svc.TenantID, &svc.GroupID, &svc.Name, &svc.Kind,
			&svc.BootAction, &svc.ProbeKind, &svc.ProbeTarget, &svc.ProbeExpectStatus,
			&svc.BootTimeoutSeconds, &svc.HealthRetries, &svc.SiteID, &svc.CreatedAt, &svc.UpdatedAt); err != nil {
			return nil, fmt.Errorf("bootgraph: scanning service of group %s: %w", groupID, err)
		}
		out = append(out, svc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("bootgraph: iterating services of group %s: %w", groupID, err)
	}
	return out, nil
}

// LoadDependencies reads all depends_on edges of a group, ordered deterministically.
func (s *Store) LoadDependencies(ctx context.Context, db DBTX, groupID string) ([]Dependency, error) {
	rows, err := db.Query(ctx, `
		SELECT id, tenant_id, group_id, service_id, depends_on_id
		  FROM dr_boot_dependency
		 WHERE group_id = $1
		 ORDER BY service_id ASC, depends_on_id ASC`, groupID)
	if err != nil {
		return nil, fmt.Errorf("bootgraph: reading dependencies of group %s: %w", groupID, err)
	}
	defer rows.Close()
	var out []Dependency
	for rows.Next() {
		var d Dependency
		if err := rows.Scan(&d.ID, &d.TenantID, &d.GroupID, &d.ServiceID, &d.DependsOnID); err != nil {
			return nil, fmt.Errorf("bootgraph: scanning dependency of group %s: %w", groupID, err)
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("bootgraph: iterating dependencies of group %s: %w", groupID, err)
	}
	return out, nil
}

// LoadServicesForLock reads a group's services FOR UPDATE so a dependency add and
// its cycle check are serialised against a concurrent definition change to the
// same group.
func (s *Store) LoadServicesForLock(ctx context.Context, db DBTX, groupID string) ([]Service, error) {
	rows, err := db.Query(ctx, `
		SELECT id, tenant_id, group_id, name, kind, boot_action, probe_kind, probe_target,
		       probe_expect_status, boot_timeout_seconds, health_retries,
		       COALESCE(site_id::text, ''), created_at, updated_at
		  FROM dr_boot_service
		 WHERE group_id = $1
		 ORDER BY id ASC
		 FOR UPDATE`, groupID)
	if err != nil {
		return nil, fmt.Errorf("bootgraph: locking services of group %s: %w", groupID, err)
	}
	defer rows.Close()
	var out []Service
	for rows.Next() {
		var svc Service
		if err := rows.Scan(&svc.ID, &svc.TenantID, &svc.GroupID, &svc.Name, &svc.Kind,
			&svc.BootAction, &svc.ProbeKind, &svc.ProbeTarget, &svc.ProbeExpectStatus,
			&svc.BootTimeoutSeconds, &svc.HealthRetries, &svc.SiteID, &svc.CreatedAt, &svc.UpdatedAt); err != nil {
			return nil, fmt.Errorf("bootgraph: scanning locked service of group %s: %w", groupID, err)
		}
		out = append(out, svc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("bootgraph: iterating locked services of group %s: %w", groupID, err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Boot run + per-service status (dr_boot_run, dr_boot_service_status).
// ---------------------------------------------------------------------------

// CreateRun inserts a pending boot run and seeds a pending status row per service
// at its planned tier, all in the caller's transaction. Returns the stored run.
func (s *Store) CreateRun(ctx context.Context, db DBTX, run *BootRun, plan BootPlan) (*BootRun, error) {
	if !ValidPolicy(run.Policy) {
		return nil, fmt.Errorf("%q: %w", run.Policy, ErrInvalidPolicy)
	}
	var stored BootRun
	err := db.QueryRow(ctx, `
		INSERT INTO dr_boot_run (tenant_id, group_id, status, policy, total_tiers, initiated_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, tenant_id, group_id, status, policy, total_tiers, tiers_booted,
		          initiated_by, last_error, started_at, completed_at`,
		run.TenantID, run.GroupID, RunStatusPending, run.Policy, len(plan.Tiers), run.InitiatedBy,
	).Scan(&stored.ID, &stored.TenantID, &stored.GroupID, &stored.Status, &stored.Policy,
		&stored.TotalTiers, &stored.TiersBooted, &stored.InitiatedBy, &stored.LastError,
		&stored.StartedAt, &stored.CompletedAt)
	if err != nil {
		if isForeignKeyViolation(err) {
			return nil, fmt.Errorf("bootgraph: group %s absent: %w", run.GroupID, ErrGroupNotFound)
		}
		return nil, fmt.Errorf("bootgraph: creating boot run: %w", err)
	}

	for tierIdx, tier := range plan.Tiers {
		for _, svc := range tier {
			if _, err := db.Exec(ctx, `
				INSERT INTO dr_boot_service_status
				    (run_id, service_id, service_name, tier, status, attempts)
				VALUES ($1, $2, $3, $4, $5, 0)`,
				stored.ID, svc.ID, svc.Name, tierIdx, SvcPending); err != nil {
				return nil, fmt.Errorf("bootgraph: seeding status for %q: %w", svc.Name, err)
			}
		}
	}
	return &stored, nil
}

// SetRunStatus updates a run's status, tiers-booted count, last error and (for a
// terminal status) completion time.
func (s *Store) SetRunStatus(ctx context.Context, db DBTX, runID, status string, tiersBooted int, lastErr *string) error {
	terminal := status == RunStatusCompleted || status == RunStatusFailed || status == RunStatusRolledBack
	_, err := db.Exec(ctx, `
		UPDATE dr_boot_run
		   SET status = $2,
		       tiers_booted = $3,
		       last_error = $4,
		       completed_at = CASE WHEN $5 THEN now() ELSE completed_at END
		 WHERE id = $1`,
		runID, status, tiersBooted, lastErr, terminal)
	if err != nil {
		return fmt.Errorf("bootgraph: updating run %s status: %w", runID, err)
	}
	return nil
}

// GetRun reads a run by ID (RLS-scoped) or ErrRunNotFound.
func (s *Store) GetRun(ctx context.Context, db DBTX, runID string) (*BootRun, error) {
	var r BootRun
	err := db.QueryRow(ctx, `
		SELECT id, tenant_id, group_id, status, policy, total_tiers, tiers_booted,
		       initiated_by, last_error, started_at, completed_at
		  FROM dr_boot_run WHERE id = $1`, runID,
	).Scan(&r.ID, &r.TenantID, &r.GroupID, &r.Status, &r.Policy, &r.TotalTiers, &r.TiersBooted,
		&r.InitiatedBy, &r.LastError, &r.StartedAt, &r.CompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("run %s: %w", runID, ErrRunNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("bootgraph: reading run %s: %w", runID, err)
	}
	return &r, nil
}

// ListRunStatuses reads the per-service status rows for a run, ordered by tier
// then service name.
func (s *Store) ListRunStatuses(ctx context.Context, db DBTX, runID string) ([]BootServiceStatus, error) {
	rows, err := db.Query(ctx, `
		SELECT id, run_id, service_id, service_name, tier, status, attempts,
		       last_error, booted_at, healthy_at, updated_at
		  FROM dr_boot_service_status
		 WHERE run_id = $1
		 ORDER BY tier ASC, service_name ASC`, runID)
	if err != nil {
		return nil, fmt.Errorf("bootgraph: reading statuses of run %s: %w", runID, err)
	}
	defer rows.Close()
	var out []BootServiceStatus
	for rows.Next() {
		var st BootServiceStatus
		if err := rows.Scan(&st.ID, &st.RunID, &st.ServiceID, &st.ServiceName, &st.Tier,
			&st.Status, &st.Attempts, &st.LastError, &st.BootedAt, &st.HealthyAt, &st.UpdatedAt); err != nil {
			return nil, fmt.Errorf("bootgraph: scanning status of run %s: %w", runID, err)
		}
		out = append(out, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("bootgraph: iterating statuses of run %s: %w", runID, err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// statusSink implementation (called by the Orchestrator during a run).
// Each method runs its own short transaction via a runner the service injects;
// here the Store exposes the raw DBTX-scoped writes, and the service wraps them.
// ---------------------------------------------------------------------------

// MarkServiceBooting transitions a service-status row to booting and bumps its
// attempt counter and booted-at stamp.
func (s *Store) MarkServiceBooting(ctx context.Context, db DBTX, runID, serviceID string, tier, attempt int) error {
	_, err := db.Exec(ctx, `
		UPDATE dr_boot_service_status
		   SET status = $3, tier = $4, attempts = $5,
		       booted_at = COALESCE(booted_at, now()), updated_at = now()
		 WHERE run_id = $1 AND service_id = $2`,
		runID, serviceID, SvcBooting, tier, attempt)
	if err != nil {
		return fmt.Errorf("bootgraph: marking %s booting: %w", serviceID, err)
	}
	return nil
}

// MarkServiceHealthy transitions a service-status row to healthy.
func (s *Store) MarkServiceHealthy(ctx context.Context, db DBTX, runID, serviceID string, attempts int, at time.Time) error {
	_, err := db.Exec(ctx, `
		UPDATE dr_boot_service_status
		   SET status = $3, attempts = $4, healthy_at = $5, last_error = NULL, updated_at = now()
		 WHERE run_id = $1 AND service_id = $2`,
		runID, serviceID, SvcHealthy, attempts, at)
	if err != nil {
		return fmt.Errorf("bootgraph: marking %s healthy: %w", serviceID, err)
	}
	return nil
}

// MarkServiceUnhealthy transitions a service-status row to unhealthy with the
// last probe error.
func (s *Store) MarkServiceUnhealthy(ctx context.Context, db DBTX, runID, serviceID string, attempts int, lastErr string) error {
	_, err := db.Exec(ctx, `
		UPDATE dr_boot_service_status
		   SET status = $3, attempts = $4, last_error = $5, updated_at = now()
		 WHERE run_id = $1 AND service_id = $2`,
		runID, serviceID, SvcUnhealthy, attempts, lastErr)
	if err != nil {
		return fmt.Errorf("bootgraph: marking %s unhealthy: %w", serviceID, err)
	}
	return nil
}

// MarkServiceRolledBack transitions a service-status row to rolled-back.
func (s *Store) MarkServiceRolledBack(ctx context.Context, db DBTX, runID, serviceID string) error {
	_, err := db.Exec(ctx, `
		UPDATE dr_boot_service_status
		   SET status = $3, updated_at = now()
		 WHERE run_id = $1 AND service_id = $2`,
		runID, serviceID, SvcRolledBack)
	if err != nil {
		return fmt.Errorf("bootgraph: marking %s rolled back: %w", serviceID, err)
	}
	return nil
}
