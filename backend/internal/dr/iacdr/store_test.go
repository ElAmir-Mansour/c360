package iacdr

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

// These tests exercise the Store's REAL SQL against pgxmock's driver-level mock,
// asserting the queries, argument binding, and row scanning the production store
// actually performs (not just method calls).

func TestStore_NextVersion(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	s := NewStore()
	ctx := context.Background()

	// No prior snapshots -> NULL max -> version 1.
	mock.ExpectQuery(`SELECT max\(version\) FROM dr_iac_snapshot WHERE tenant_id = \$1 AND name = \$2`).
		WithArgs("t1", "prod").
		WillReturnRows(pgxmock.NewRows([]string{"max"}).AddRow((*int)(nil)))
	v, err := s.NextVersion(ctx, mock, "t1", "prod")
	if err != nil {
		t.Fatalf("NextVersion: %v", err)
	}
	if v != 1 {
		t.Errorf("version = %d, want 1", v)
	}

	// Existing max 3 -> version 4.
	three := 3
	mock.ExpectQuery(`SELECT max\(version\) FROM dr_iac_snapshot`).
		WithArgs("t1", "prod").
		WillReturnRows(pgxmock.NewRows([]string{"max"}).AddRow(&three))
	v, err = s.NextVersion(ctx, mock, "t1", "prod")
	if err != nil {
		t.Fatalf("NextVersion 2: %v", err)
	}
	if v != 4 {
		t.Errorf("version = %d, want 4", v)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStore_InsertSnapshotAndResources(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	s := NewStore()
	ctx := context.Background()
	now := time.Now().UTC()

	mock.ExpectQuery(`INSERT INTO dr_iac_snapshot`).
		WithArgs("t1", (*string)(nil), "prod", SourceTerraformState, 1, "ch", 2, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "name", "source_kind", "version", "content_hash", "resource_count", "created_at",
		}).AddRow("snap-1", "t1", (*string)(nil), "prod", SourceTerraformState, 1, "ch", 2, now))

	snap := &Snapshot{
		TenantID:      "t1",
		Name:          "prod",
		SourceKind:    SourceTerraformState,
		Version:       1,
		ContentHash:   "ch",
		ResourceCount: 2,
		Metadata:      map[string]string{"format": "terraform_state"},
	}
	stored, err := s.InsertSnapshot(ctx, mock, snap)
	if err != nil {
		t.Fatalf("InsertSnapshot: %v", err)
	}
	if stored.ID != "snap-1" {
		t.Errorf("id = %q, want snap-1", stored.ID)
	}

	// Two resource inserts.
	r1 := mkRes("aws", "aws_vpc", "main", map[string]any{"cidr": "10.0.0.0/16"})
	r2 := mkRes("aws", "aws_subnet", "main", map[string]any{"cidr": "10.0.1.0/24"}, "aws_vpc.main")
	mock.ExpectExec(`INSERT INTO dr_iac_resource`).
		WithArgs("t1", "snap-1", "aws", "aws_vpc", "main", "aws_vpc.main", pgxmock.AnyArg(), pgxmock.AnyArg(), r1.Hash).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec(`INSERT INTO dr_iac_resource`).
		WithArgs("t1", "snap-1", "aws", "aws_subnet", "main", "aws_subnet.main", pgxmock.AnyArg(), pgxmock.AnyArg(), r2.Hash).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	if err := s.InsertResources(ctx, mock, "t1", "snap-1", []Resource{r1, r2}); err != nil {
		t.Fatalf("InsertResources: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStore_GetSnapshot_NotFound(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	s := NewStore()

	mock.ExpectQuery(`SELECT .* FROM dr_iac_snapshot WHERE id = \$1`).
		WithArgs("missing").
		WillReturnError(errNoRows())
	_, err = s.GetSnapshot(context.Background(), mock, "missing")
	if !errors.Is(err, ErrSnapshotNotFound) {
		t.Fatalf("err = %v, want ErrSnapshotNotFound", err)
	}
}

func TestStore_LoadResources(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	s := NewStore()
	now := time.Now().UTC()

	mock.ExpectQuery(`SELECT .* FROM dr_iac_resource\s+WHERE snapshot_id = \$1`).
		WithArgs("snap-1").
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "snapshot_id", "provider", "type", "name", "address", "attributes", "depends_on", "resource_hash", "created_at",
		}).AddRow("r1", "t1", "snap-1", "aws", "aws_subnet", "main", "aws_subnet.main",
			[]byte(`{"cidr":"10.0.1.0/24"}`), []byte(`["aws_vpc.main"]`), "h1", now))

	resources, err := s.LoadResources(context.Background(), mock, "snap-1")
	if err != nil {
		t.Fatalf("LoadResources: %v", err)
	}
	if len(resources) != 1 {
		t.Fatalf("resources = %d, want 1", len(resources))
	}
	r := resources[0]
	if r.Address != "aws_subnet.main" || r.Attributes["cidr"] != "10.0.1.0/24" {
		t.Errorf("scanned resource wrong: %+v", r)
	}
	if len(r.DependsOn) != 1 || r.DependsOn[0] != "aws_vpc.main" {
		t.Errorf("depends_on = %v", r.DependsOn)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStore_GroupExists(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	s := NewStore()

	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("g1").
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(true))
	ok, err := s.GroupExists(context.Background(), mock, "g1")
	if err != nil {
		t.Fatalf("GroupExists: %v", err)
	}
	if !ok {
		t.Error("expected group to exist")
	}
}

// errNoRows returns pgx.ErrNoRows for the not-found path.
func errNoRows() error {
	return pgx.ErrNoRows
}
