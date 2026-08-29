package recover

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/repository"
)

// Demo entity kinds recorded in the demo-seed ledger. metastore_application is a
// recover_metastore_application row (deleting it cascades its owners /
// environments / dependencies / cloud accounts / runbook links); runbook is a
// dr_studio_runbook row (deleting it cascades its tasks / runs / task-runs).
const (
	DemoKindMetastoreApplication = "metastore_application"
	DemoKindRunbook              = "runbook"
)

// DemoSeedItem is one demo entity created for a tenant during sub-solution
// seeding, tracked in recover_demo_seed_item so seeding is idempotent and the
// demo content is precisely and fully removable. RefID is a soft reference to
// the owning table's id (a recover_metastore_application.id or a
// dr_studio_runbook.id); AppKey records the demo application the entity belongs
// to so removal and idempotency group by application.
type DemoSeedItem struct {
	ID          string    `json:"id"`
	SubSolution string    `json:"sub_solution"`
	Kind        string    `json:"kind"`
	RefID       string    `json:"ref_id"`
	AppKey      string    `json:"app_key"`
	CreatedAt   time.Time `json:"created_at"`
}

// DemoSeedStore persists the demo-seed ledger that backs idempotent seeding and
// the "remove demo data" action. The concrete implementation is SQL-backed over
// recover_demo_seed_item; the interface keeps the onboarding service
// unit-testable without a database. Every method takes a tenant-scoped DBTX so
// reads/writes are RLS-isolated to the tenant.
type DemoSeedStore interface {
	// ListItems returns every demo-seed ledger row for the tenant, oldest first
	// (so a removal deletes runbooks before the applications they link to is not
	// required — the metastore application delete cascades the link — but a stable
	// order keeps removal deterministic).
	ListItems(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]DemoSeedItem, error)
	// CountForSubSolution returns how many demo applications a tenant already has
	// seeded for one sub-solution. The seed flow uses it to skip a sub-solution
	// whose demo content already exists (idempotency at the sub-solution grain).
	CountForSubSolution(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, subSolution string) (int, error)
	// RecordItem inserts one demo-seed ledger row. The UNIQUE (tenant_id, kind,
	// ref_id) constraint makes a re-record of the same entity a no-op via
	// ON CONFLICT DO NOTHING, so a partially-completed seed is safe to retry.
	RecordItem(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, item DemoSeedItem, now time.Time) error
	// DeleteItem removes one demo-seed ledger row by ref_id after its referenced
	// entity has been deleted.
	DeleteItem(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, kind, refID string) error
}

// SQLDemoSeedStore is the SQL-backed DemoSeedStore over recover_demo_seed_item.
type SQLDemoSeedStore struct{}

// NewDemoSeedStore constructs the SQL demo-seed store.
func NewDemoSeedStore() *SQLDemoSeedStore { return &SQLDemoSeedStore{} }

// ListItems reads every demo-seed ledger row for the tenant, oldest first.
func (s *SQLDemoSeedStore) ListItems(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]DemoSeedItem, error) {
	rows, err := db.Query(ctx,
		`SELECT id, sub_solution, kind, ref_id, app_key, created_at
		   FROM recover_demo_seed_item
		  WHERE tenant_id = $1
		  ORDER BY created_at ASC, id ASC`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []DemoSeedItem
	for rows.Next() {
		var it DemoSeedItem
		if err := rows.Scan(&it.ID, &it.SubSolution, &it.Kind, &it.RefID, &it.AppKey, &it.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// CountForSubSolution counts the demo applications a tenant has for one
// sub-solution (idempotency at the sub-solution grain).
func (s *SQLDemoSeedStore) CountForSubSolution(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, subSolution string) (int, error) {
	var n int
	err := db.QueryRow(ctx,
		`SELECT count(*)
		   FROM recover_demo_seed_item
		  WHERE tenant_id = $1 AND sub_solution = $2 AND kind = $3`,
		tenantID, subSolution, DemoKindMetastoreApplication).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}

// RecordItem inserts one demo-seed ledger row idempotently.
func (s *SQLDemoSeedStore) RecordItem(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, item DemoSeedItem, now time.Time) error {
	_, err := db.Exec(ctx,
		`INSERT INTO recover_demo_seed_item (tenant_id, sub_solution, kind, ref_id, app_key, created_at)
		      VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (tenant_id, kind, ref_id) DO NOTHING`,
		tenantID, item.SubSolution, item.Kind, item.RefID, item.AppKey, now)
	return err
}

// DeleteItem removes one demo-seed ledger row by (kind, ref_id) for the tenant.
func (s *SQLDemoSeedStore) DeleteItem(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, kind, refID string) error {
	_, err := db.Exec(ctx,
		`DELETE FROM recover_demo_seed_item
		  WHERE tenant_id = $1 AND kind = $2 AND ref_id = $3`,
		tenantID, kind, refID)
	return err
}

var _ DemoSeedStore = (*SQLDemoSeedStore)(nil)

// RunbookDeleter removes a Runbook Studio runbook (and, via ON DELETE CASCADE,
// its tasks / runs / task-runs) by id within a tenant-scoped transaction. The
// runbookstudio service intentionally exposes no delete (authored runbooks are
// long-lived), so the "remove demo data" action deletes the demo-seeded runbook
// rows it created directly over the dr_studio_runbook table. This is REMOVAL of
// demo content the onboarding flow itself seeded, not a reimplementation of any
// studio authoring/execution logic — it issues a single tenant-scoped DELETE and
// relies on the table's existing cascade.
type RunbookDeleter interface {
	DeleteRunbook(ctx context.Context, db repository.DBTX, runbookID string) error
}

// SQLRunbookDeleter is the SQL-backed RunbookDeleter over dr_studio_runbook.
type SQLRunbookDeleter struct{}

// NewRunbookDeleter constructs the SQL runbook deleter.
func NewRunbookDeleter() *SQLRunbookDeleter { return &SQLRunbookDeleter{} }

// DeleteRunbook deletes one runbook by id; the dr_studio_task / dr_studio_run /
// dr_studio_task_run rows cascade. RLS scopes the delete to the tenant.
func (d *SQLRunbookDeleter) DeleteRunbook(ctx context.Context, db repository.DBTX, runbookID string) error {
	_, err := db.Exec(ctx, `DELETE FROM dr_studio_runbook WHERE id = $1`, runbookID)
	return err
}

var _ RunbookDeleter = (*SQLRunbookDeleter)(nil)
