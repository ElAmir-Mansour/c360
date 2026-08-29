package residency

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

// fakeRow implements pgx.Row for unit testing the PGLoader.
type fakeRow struct {
	region string
	err    error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) > 0 {
		if p, ok := dest[0].(*string); ok {
			*p = r.region
		}
	}
	return nil
}

// fakeQuerier implements rowQuerier.
type fakeQuerier struct {
	row     fakeRow
	gotSQL  string
	gotArgs []any
}

func (q *fakeQuerier) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	q.gotSQL = sql
	q.gotArgs = args
	return q.row
}

func TestPGLoader_TenantRegion_Found(t *testing.T) {
	q := &fakeQuerier{row: fakeRow{region: "ksa-central"}}
	l := NewPGLoader(q)

	region, err := l.TenantRegion(context.Background(), "tenant-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if region != "ksa-central" {
		t.Errorf("region = %q, want ksa-central", region)
	}
	if len(q.gotArgs) != 1 || q.gotArgs[0] != "tenant-1" {
		t.Errorf("query args = %v, want [tenant-1]", q.gotArgs)
	}
}

func TestPGLoader_TenantRegion_Unrestricted(t *testing.T) {
	// NULL residency_region is COALESCEd to "" by the query.
	q := &fakeQuerier{row: fakeRow{region: ""}}
	l := NewPGLoader(q)

	region, err := l.TenantRegion(context.Background(), "tenant-2")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if region != "" {
		t.Errorf("region = %q, want empty (unrestricted)", region)
	}
}

func TestPGLoader_TenantRegion_NotFound(t *testing.T) {
	q := &fakeQuerier{row: fakeRow{err: pgx.ErrNoRows}}
	l := NewPGLoader(q)

	_, err := l.TenantRegion(context.Background(), "missing")
	if !errors.Is(err, ErrTenantNotFound) {
		t.Errorf("err = %v, want ErrTenantNotFound", err)
	}
}

func TestPGLoader_TenantRegion_DBError(t *testing.T) {
	dbErr := errors.New("connection refused")
	q := &fakeQuerier{row: fakeRow{err: dbErr}}
	l := NewPGLoader(q)

	_, err := l.TenantRegion(context.Background(), "tenant-3")
	if err == nil {
		t.Fatal("expected error")
	}
	if errors.Is(err, ErrTenantNotFound) {
		t.Errorf("db error should not be reported as ErrTenantNotFound")
	}
	if !errors.Is(err, dbErr) {
		t.Errorf("error should wrap the db error, got %v", err)
	}
}

func TestStaticLoader(t *testing.T) {
	l := NewStaticLoader(map[string]string{"t1": "ksa-central", "t2": ""})

	if r, err := l.TenantRegion(context.Background(), "t1"); err != nil || r != "ksa-central" {
		t.Errorf("t1: got (%q,%v)", r, err)
	}
	if r, err := l.TenantRegion(context.Background(), "t2"); err != nil || r != "" {
		t.Errorf("t2: got (%q,%v)", r, err)
	}
	if _, err := l.TenantRegion(context.Background(), "unknown"); !errors.Is(err, ErrTenantNotFound) {
		t.Errorf("unknown tenant should return ErrTenantNotFound, got %v", err)
	}
}
