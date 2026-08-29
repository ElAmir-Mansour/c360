package metastore

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// DBTX is re-exported from the shared repository so the store, the registry, and
// the router all speak the same execution-context type: a *pgxpool.Pool for a
// single read, or the caller's open transaction so a multi-table application
// write commits atomically. This package adds its OWN queries over its OWN
// tables rather than editing the shared repository (disjoint ownership).
type DBTX = repository.DBTX

// Store persists the Application Metastore over its six owned tables. It holds
// no state; callers choose the DBTX, so a request reads/writes under a tenant
// transaction (RLS-scoped) and any future system path reads under a system
// transaction. Every write that changes drift-relevant metadata recomputes the
// application's metadata_revision and metadata_hash atomically within the same
// transaction (see UpsertApplication / ReplaceApplicationChildren).
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// ---------------------------------------------------------------------------
// Application reads.
// ---------------------------------------------------------------------------

// appRow holds the scalar application columns.
type appRow struct {
	id, appKey, name, description, recoveryTier, metadataHash string
	rtoTargetSeconds, metadataRevision                        int
	createdAt, updatedAt                                      time.Time
}

// scanAppRow scans the scalar application columns into an Application shell
// (children loaded separately).
func scanAppRow(row pgx.Row, tenantID string) (Application, error) {
	var r appRow
	if err := row.Scan(&r.id, &r.appKey, &r.name, &r.description, &r.recoveryTier,
		&r.rtoTargetSeconds, &r.metadataRevision, &r.metadataHash, &r.createdAt, &r.updatedAt); err != nil {
		return Application{}, err
	}
	return Application{
		ID:               r.id,
		TenantID:         tenantID,
		AppKey:           r.appKey,
		Name:             r.name,
		Description:      r.description,
		RecoveryTier:     r.recoveryTier,
		RTOTargetSeconds: r.rtoTargetSeconds,
		MetadataRevision: r.metadataRevision,
		MetadataHash:     r.metadataHash,
		CreatedAt:        r.createdAt,
		UpdatedAt:        r.updatedAt,
	}, nil
}

const appSelectCols = `id, app_key, name, description, recovery_tier,
	rto_target_seconds, metadata_revision, metadata_hash, created_at, updated_at`

// GetApplicationByID loads one application (with all children) by id, scoped to
// the tenant (RLS + explicit predicate). ErrNotFound when absent.
func (s *Store) GetApplicationByID(ctx context.Context, db DBTX, tenantID, id string) (*Application, error) {
	row := db.QueryRow(ctx,
		`SELECT `+appSelectCols+` FROM recover_metastore_application
		  WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	return s.loadApplication(ctx, db, tenantID, row)
}

// GetApplicationByKey loads one application (with all children) by its stable
// app_key. ErrNotFound when absent.
func (s *Store) GetApplicationByKey(ctx context.Context, db DBTX, tenantID, appKey string) (*Application, error) {
	row := db.QueryRow(ctx,
		`SELECT `+appSelectCols+` FROM recover_metastore_application
		  WHERE tenant_id = $1 AND app_key = $2`, tenantID, appKey)
	return s.loadApplication(ctx, db, tenantID, row)
}

func (s *Store) loadApplication(ctx context.Context, db DBTX, tenantID string, row pgx.Row) (*Application, error) {
	app, err := scanAppRow(row, tenantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("metastore: scanning application: %w", err)
	}
	if err := s.loadChildren(ctx, db, &app); err != nil {
		return nil, err
	}
	return &app, nil
}

// loadChildren loads owners/environments/dependencies/cloud accounts/linked
// runbooks for an application.
func (s *Store) loadChildren(ctx context.Context, db DBTX, app *Application) error {
	owners, err := s.listOwners(ctx, db, app.ID)
	if err != nil {
		return err
	}
	app.Owners = owners
	envs, err := s.listEnvironments(ctx, db, app.ID)
	if err != nil {
		return err
	}
	app.Environments = envs
	deps, err := s.listDependencies(ctx, db, app.ID)
	if err != nil {
		return err
	}
	app.Dependencies = deps
	accounts, err := s.listCloudAccounts(ctx, db, app.ID)
	if err != nil {
		return err
	}
	app.CloudAccounts = accounts
	links, err := s.ListRunbookLinks(ctx, db, app.ID)
	if err != nil {
		return err
	}
	app.LinkedRunbooks = links
	return nil
}

func (s *Store) listOwners(ctx context.Context, db DBTX, appID string) ([]Owner, error) {
	rows, err := db.Query(ctx,
		`SELECT role, name, contact FROM recover_metastore_owner
		  WHERE application_id = $1 ORDER BY role, name`, appID)
	if err != nil {
		return nil, fmt.Errorf("metastore: listing owners: %w", err)
	}
	defer rows.Close()
	var out []Owner
	for rows.Next() {
		var o Owner
		if err := rows.Scan(&o.Role, &o.Name, &o.Contact); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Store) listEnvironments(ctx context.Context, db DBTX, appID string) ([]Environment, error) {
	rows, err := db.Query(ctx,
		`SELECT env_key, kind, region, is_recovery_target FROM recover_metastore_environment
		  WHERE application_id = $1 ORDER BY env_key`, appID)
	if err != nil {
		return nil, fmt.Errorf("metastore: listing environments: %w", err)
	}
	defer rows.Close()
	var out []Environment
	for rows.Next() {
		var e Environment
		if err := rows.Scan(&e.Key, &e.Kind, &e.Region, &e.IsRecoveryTarget); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) listDependencies(ctx context.Context, db DBTX, appID string) ([]Dependency, error) {
	rows, err := db.Query(ctx,
		`SELECT depends_on_app_key, criticality FROM recover_metastore_dependency
		  WHERE application_id = $1 ORDER BY depends_on_app_key`, appID)
	if err != nil {
		return nil, fmt.Errorf("metastore: listing dependencies: %w", err)
	}
	defer rows.Close()
	var out []Dependency
	for rows.Next() {
		var d Dependency
		if err := rows.Scan(&d.DependsOnAppKey, &d.Criticality); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) listCloudAccounts(ctx context.Context, db DBTX, appID string) ([]CloudAccount, error) {
	rows, err := db.Query(ctx,
		`SELECT provider, account_ref, region FROM recover_metastore_cloud_account
		  WHERE application_id = $1 ORDER BY provider, account_ref`, appID)
	if err != nil {
		return nil, fmt.Errorf("metastore: listing cloud accounts: %w", err)
	}
	defer rows.Close()
	var out []CloudAccount
	for rows.Next() {
		var a CloudAccount
		if err := rows.Scan(&a.Provider, &a.AccountRef, &a.Region); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListRunbookLinks returns the runbooks linked to an application with the
// metadata revision each was populated from.
func (s *Store) ListRunbookLinks(ctx context.Context, db DBTX, appID string) ([]RunbookLink, error) {
	rows, err := db.Query(ctx,
		`SELECT runbook_id, source_revision, source_hash, created_at, updated_at
		   FROM recover_metastore_runbook_link
		  WHERE application_id = $1 ORDER BY created_at`, appID)
	if err != nil {
		return nil, fmt.Errorf("metastore: listing runbook links: %w", err)
	}
	defer rows.Close()
	var out []RunbookLink
	for rows.Next() {
		var l RunbookLink
		if err := rows.Scan(&l.RunbookID, &l.SourceRevision, &l.SourceHash, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ListPage holds one page of applications and the total count.
type ListPage struct {
	Applications []Application
	Total        int
}

// ListApplications returns a page of the tenant's applications (with all
// children), newest first, plus the total count for pagination. The query is
// bounded by limit/offset so the list never returns the whole estate at once.
func (s *Store) ListApplications(ctx context.Context, db DBTX, tenantID string, limit, offset int) (ListPage, error) {
	var total int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM recover_metastore_application WHERE tenant_id = $1`, tenantID,
	).Scan(&total); err != nil {
		return ListPage{}, fmt.Errorf("metastore: counting applications: %w", err)
	}

	rows, err := db.Query(ctx,
		`SELECT `+appSelectCols+` FROM recover_metastore_application
		  WHERE tenant_id = $1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
		tenantID, limit, offset)
	if err != nil {
		return ListPage{}, fmt.Errorf("metastore: listing applications: %w", err)
	}
	defer rows.Close()

	var apps []Application
	for rows.Next() {
		app, serr := scanAppRow(rows, tenantID)
		if serr != nil {
			return ListPage{}, serr
		}
		apps = append(apps, app)
	}
	if err := rows.Err(); err != nil {
		return ListPage{}, err
	}
	// Load children per app. The page is bounded (LIMIT), so this is a bounded
	// number of child reads, not an unbounded N+1 over the whole estate.
	for i := range apps {
		if err := s.loadChildren(ctx, db, &apps[i]); err != nil {
			return ListPage{}, err
		}
	}
	return ListPage{Applications: apps, Total: total}, nil
}

// ---------------------------------------------------------------------------
// Application writes.
// ---------------------------------------------------------------------------

// InsertApplication inserts the scalar application row and returns its id. The
// caller writes children and finalizes the metadata fingerprint in the same
// transaction. ErrAlreadyExists on an app_key collision.
func (s *Store) InsertApplication(ctx context.Context, db DBTX, tenantID string, app Application, now time.Time) (string, error) {
	var id string
	err := db.QueryRow(ctx,
		`INSERT INTO recover_metastore_application
		    (tenant_id, app_key, name, description, recovery_tier, rto_target_seconds,
		     metadata_revision, metadata_hash, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,1,'',$7,$7)
		 RETURNING id`,
		tenantID, app.AppKey, app.Name, app.Description, app.RecoveryTier, app.RTOTargetSeconds, now,
	).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return "", ErrAlreadyExists
		}
		return "", fmt.Errorf("metastore: inserting application: %w", err)
	}
	return id, nil
}

// UpdateApplicationScalars updates the scalar columns of an application (not the
// fingerprint, which FinalizeRevision sets). ErrNotFound when absent.
func (s *Store) UpdateApplicationScalars(ctx context.Context, db DBTX, tenantID, id string, app Application, now time.Time) error {
	tag, err := db.Exec(ctx,
		`UPDATE recover_metastore_application
		    SET name = $3, description = $4, recovery_tier = $5,
		        rto_target_seconds = $6, updated_at = $7
		  WHERE tenant_id = $1 AND id = $2`,
		tenantID, id, app.Name, app.Description, app.RecoveryTier, app.RTOTargetSeconds, now)
	if err != nil {
		return fmt.Errorf("metastore: updating application: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// FinalizeRevision sets the application's metadata_hash and advances its
// metadata_revision when the hash changed from what is stored. It returns the
// resulting revision and hash. Bumping the revision ONLY on a real hash change
// means an idempotent re-save of identical metadata does not inflate the
// revision (and so does not spuriously flag drift on linked runbooks).
func (s *Store) FinalizeRevision(ctx context.Context, db DBTX, tenantID, id, newHash string, now time.Time) (int, string, error) {
	var currentRev int
	var currentHash string
	err := db.QueryRow(ctx,
		`SELECT metadata_revision, metadata_hash FROM recover_metastore_application
		  WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, tenantID, id).Scan(&currentRev, &currentHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", ErrNotFound
	}
	if err != nil {
		return 0, "", fmt.Errorf("metastore: locking application for revision: %w", err)
	}
	if currentHash == newHash && currentHash != "" {
		return currentRev, currentHash, nil
	}
	newRev := currentRev + 1
	if currentHash == "" {
		// First finalize after insert: this IS revision 1, not a bump to 2.
		newRev = currentRev
	}
	if _, err := db.Exec(ctx,
		`UPDATE recover_metastore_application
		    SET metadata_revision = $3, metadata_hash = $4, updated_at = $5
		  WHERE tenant_id = $1 AND id = $2`,
		tenantID, id, newRev, newHash, now); err != nil {
		return 0, "", fmt.Errorf("metastore: finalizing revision: %w", err)
	}
	return newRev, newHash, nil
}

// ReplaceChildren replaces all child rows (owners/environments/dependencies/
// cloud accounts) of an application with the provided sets, in one pass. The
// caller runs it inside the application's transaction so the child set is
// swapped atomically with the scalar update and the fingerprint finalize.
func (s *Store) ReplaceChildren(ctx context.Context, db DBTX, tenantID, appID string, app Application) error {
	if err := s.deleteChildren(ctx, db, appID); err != nil {
		return err
	}
	for _, o := range app.Owners {
		if _, err := db.Exec(ctx,
			`INSERT INTO recover_metastore_owner (tenant_id, application_id, role, name, contact)
			 VALUES ($1,$2,$3,$4,$5)`, tenantID, appID, o.Role, o.Name, o.Contact); err != nil {
			return fmt.Errorf("metastore: inserting owner: %w", err)
		}
	}
	for _, e := range app.Environments {
		if _, err := db.Exec(ctx,
			`INSERT INTO recover_metastore_environment (tenant_id, application_id, env_key, kind, region, is_recovery_target)
			 VALUES ($1,$2,$3,$4,$5,$6)`, tenantID, appID, e.Key, e.Kind, e.Region, e.IsRecoveryTarget); err != nil {
			return fmt.Errorf("metastore: inserting environment: %w", err)
		}
	}
	for _, d := range app.Dependencies {
		if _, err := db.Exec(ctx,
			`INSERT INTO recover_metastore_dependency (tenant_id, application_id, depends_on_app_key, criticality)
			 VALUES ($1,$2,$3,$4)`, tenantID, appID, d.DependsOnAppKey, d.Criticality); err != nil {
			return fmt.Errorf("metastore: inserting dependency: %w", err)
		}
	}
	for _, a := range app.CloudAccounts {
		if _, err := db.Exec(ctx,
			`INSERT INTO recover_metastore_cloud_account (tenant_id, application_id, provider, account_ref, region)
			 VALUES ($1,$2,$3,$4,$5)`, tenantID, appID, a.Provider, a.AccountRef, a.Region); err != nil {
			return fmt.Errorf("metastore: inserting cloud account: %w", err)
		}
	}
	return nil
}

func (s *Store) deleteChildren(ctx context.Context, db DBTX, appID string) error {
	for _, table := range []string{
		"recover_metastore_owner",
		"recover_metastore_environment",
		"recover_metastore_dependency",
		"recover_metastore_cloud_account",
	} {
		if _, err := db.Exec(ctx, `DELETE FROM `+table+` WHERE application_id = $1`, appID); err != nil {
			return fmt.Errorf("metastore: clearing %s: %w", table, err)
		}
	}
	return nil
}

// DeleteApplication removes an application and (via ON DELETE CASCADE) all its
// children and runbook links. ErrNotFound when absent.
func (s *Store) DeleteApplication(ctx context.Context, db DBTX, tenantID, id string) error {
	tag, err := db.Exec(ctx,
		`DELETE FROM recover_metastore_application WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	if err != nil {
		return fmt.Errorf("metastore: deleting application: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// Runbook links.
// ---------------------------------------------------------------------------

// UpsertRunbookLink records (or refreshes) the link between an application and a
// runbook populated from it, stamping the metadata revision/hash the runbook was
// populated from. Idempotent on (application_id, runbook_id).
func (s *Store) UpsertRunbookLink(ctx context.Context, db DBTX, tenantID, appID, runbookID string, sourceRev int, sourceHash string, now time.Time) error {
	_, err := db.Exec(ctx,
		`INSERT INTO recover_metastore_runbook_link
		    (tenant_id, application_id, runbook_id, source_revision, source_hash, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$6)
		 ON CONFLICT (application_id, runbook_id)
		 DO UPDATE SET source_revision = EXCLUDED.source_revision,
		               source_hash = EXCLUDED.source_hash,
		               updated_at = EXCLUDED.updated_at`,
		tenantID, appID, runbookID, sourceRev, sourceHash, now)
	if err != nil {
		return fmt.Errorf("metastore: upserting runbook link: %w", err)
	}
	return nil
}

// GetRunbookLink loads one application↔runbook link. ErrRunbookNotLinked when
// the runbook was never populated from the application.
func (s *Store) GetRunbookLink(ctx context.Context, db DBTX, appID, runbookID string) (*RunbookLink, error) {
	var l RunbookLink
	err := db.QueryRow(ctx,
		`SELECT runbook_id, source_revision, source_hash, created_at, updated_at
		   FROM recover_metastore_runbook_link
		  WHERE application_id = $1 AND runbook_id = $2`, appID, runbookID,
	).Scan(&l.RunbookID, &l.SourceRevision, &l.SourceHash, &l.CreatedAt, &l.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRunbookNotLinked
	}
	if err != nil {
		return nil, fmt.Errorf("metastore: loading runbook link: %w", err)
	}
	return &l, nil
}

// compile-time check.
var _ = repository.DBTX(nil)
