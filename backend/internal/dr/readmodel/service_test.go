package readmodel

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

type markerDBTX struct{}

func (markerDBTX) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	panic("markerDBTX.Exec should not be called")
}

func (markerDBTX) Query(context.Context, string, ...any) (pgx.Rows, error) {
	panic("markerDBTX.Query should not be called")
}

func (markerDBTX) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("markerDBTX.QueryRow should not be called")
}

type recordingRunner struct {
	db      repository.DBTX
	reads   int
	tenants []uuid.UUID
}

func (r *recordingRunner) RunReadWithTenant(_ context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	r.reads++
	r.tenants = append(r.tenants, tenantID)
	return fn(r.db)
}

type repositoryCall struct {
	name     string
	db       repository.DBTX
	tenantID string
	groupID  string
}

type recordingRepository struct {
	calls      []repositoryCall
	sites      []*model.ProtectedSite
	groups     []*model.ConsistencyGroup
	members    map[string][]model.ConsistencyGroupMember
	streams    []*model.ReplicationStream
	points     map[string][]*model.RecoveryPoint
	runs       []*model.FailoverRun
	getGroupFn func(context.Context, repository.DBTX, string, string) (*model.ConsistencyGroup, error)
}

func (r *recordingRepository) record(name string, db repository.DBTX, tenantID, groupID string) {
	r.calls = append(r.calls, repositoryCall{name: name, db: db, tenantID: tenantID, groupID: groupID})
}

func (r *recordingRepository) ListSites(_ context.Context, db repository.DBTX, tenantID string) ([]*model.ProtectedSite, error) {
	r.record("ListSites", db, tenantID, "")
	return r.sites, nil
}

func (r *recordingRepository) GetGroup(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.ConsistencyGroup, error) {
	r.record("GetGroup", db, tenantID, id)
	if r.getGroupFn != nil {
		return r.getGroupFn(ctx, db, tenantID, id)
	}
	for _, group := range r.groups {
		if group.ID == id {
			return group, nil
		}
	}
	return nil, fmt.Errorf("group %s: %w", id, model.ErrNotFound)
}

func (r *recordingRepository) ListGroups(_ context.Context, db repository.DBTX, tenantID string) ([]*model.ConsistencyGroup, error) {
	r.record("ListGroups", db, tenantID, "")
	return r.groups, nil
}

func (r *recordingRepository) ListGroupMembers(_ context.Context, db repository.DBTX, groupID string) ([]model.ConsistencyGroupMember, error) {
	r.record("ListGroupMembers", db, "", groupID)
	return r.members[groupID], nil
}

func (r *recordingRepository) ListStreams(_ context.Context, db repository.DBTX, tenantID string) ([]*model.ReplicationStream, error) {
	r.record("ListStreams", db, tenantID, "")
	return r.streams, nil
}

func (r *recordingRepository) ListRecoveryPointsByGroup(_ context.Context, db repository.DBTX, tenantID, groupID string) ([]*model.RecoveryPoint, error) {
	r.record("ListRecoveryPointsByGroup", db, tenantID, groupID)
	return r.points[groupID], nil
}

func (r *recordingRepository) ListFailoverRuns(_ context.Context, db repository.DBTX, tenantID string) ([]*model.FailoverRun, error) {
	r.record("ListFailoverRuns", db, tenantID, "")
	return r.runs, nil
}

func TestServiceBuildPostureUsesOneReadTransaction(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	groupID := uuid.New()
	fixedNow := time.Date(2026, 6, 13, 14, 30, 0, 0, time.FixedZone("WAT", 3600))
	runner := &recordingRunner{db: markerDBTX{}}
	store := &recordingRepository{
		groups:  []*model.ConsistencyGroup{{ID: groupID.String(), TenantID: tenantID.String(), Name: "Core"}},
		members: map[string][]model.ConsistencyGroupMember{groupID.String(): {}},
		points:  map[string][]*model.RecoveryPoint{groupID.String(): {}},
	}
	svc := newTestService(t, runner, store, fixedNow)

	posture, err := svc.BuildPosture(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("BuildPosture: %v", err)
	}
	if !posture.GeneratedAt.Equal(fixedNow.UTC()) {
		t.Fatalf("GeneratedAt = %s, want %s", posture.GeneratedAt, fixedNow.UTC())
	}
	assertOneReadTransaction(t, runner, tenantID)
	assertRepositoryCalls(t, store.calls, runner.db, []string{
		"ListSites",
		"ListGroups",
		"ListStreams",
		"ListFailoverRuns",
		"ListGroupMembers",
		"ListRecoveryPointsByGroup",
	})
}

func TestServiceBuildReplicationSummaryUsesOneReadTransaction(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	runner := &recordingRunner{db: markerDBTX{}}
	store := &recordingRepository{}
	svc := newTestService(t, runner, store, time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC))

	if _, err := svc.BuildReplicationSummary(context.Background(), tenantID); err != nil {
		t.Fatalf("BuildReplicationSummary: %v", err)
	}
	assertOneReadTransaction(t, runner, tenantID)
	assertRepositoryCalls(t, store.calls, runner.db, []string{
		"ListSites",
		"ListGroups",
		"ListStreams",
		"ListFailoverRuns",
	})
}

func TestServiceBuildGroupSummaryUsesOneReadTransaction(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	groupID := uuid.New()
	runner := &recordingRunner{db: markerDBTX{}}
	store := &recordingRepository{
		groups:  []*model.ConsistencyGroup{{ID: groupID.String(), TenantID: tenantID.String(), Name: "Payments"}},
		members: map[string][]model.ConsistencyGroupMember{groupID.String(): {}},
		points:  map[string][]*model.RecoveryPoint{groupID.String(): {}},
	}
	svc := newTestService(t, runner, store, time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC))

	if _, err := svc.BuildGroupSummary(context.Background(), tenantID, groupID); err != nil {
		t.Fatalf("BuildGroupSummary: %v", err)
	}
	assertOneReadTransaction(t, runner, tenantID)
	assertRepositoryCalls(t, store.calls, runner.db, []string{
		"GetGroup",
		"ListSites",
		"ListGroups",
		"ListStreams",
		"ListFailoverRuns",
		"ListGroupMembers",
		"ListRecoveryPointsByGroup",
	})
}

func TestServiceBuildGroupSummaryPreservesErrNotFound(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	groupID := uuid.New()
	runner := &recordingRunner{db: markerDBTX{}}
	store := &recordingRepository{
		getGroupFn: func(context.Context, repository.DBTX, string, string) (*model.ConsistencyGroup, error) {
			return nil, fmt.Errorf("group lookup: %w", model.ErrNotFound)
		},
	}
	svc := newTestService(t, runner, store, time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC))

	_, err := svc.BuildGroupSummary(context.Background(), tenantID, groupID)
	if !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("BuildGroupSummary err = %v, want ErrNotFound", err)
	}
	assertOneReadTransaction(t, runner, tenantID)
	assertRepositoryCalls(t, store.calls, runner.db, []string{"GetGroup"})
}

func newTestService(t *testing.T, runner TenantReadRunner, store RepositoryStore, now time.Time) *Service {
	t.Helper()
	svc, err := NewService(ServiceConfig{
		Runner: runner,
		Store:  store,
		Now:    func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

func assertOneReadTransaction(t *testing.T, runner *recordingRunner, tenantID uuid.UUID) {
	t.Helper()
	if runner.reads != 1 {
		t.Fatalf("read transactions = %d, want 1", runner.reads)
	}
	if !reflect.DeepEqual(runner.tenants, []uuid.UUID{tenantID}) {
		t.Fatalf("transaction tenants = %v, want [%s]", runner.tenants, tenantID)
	}
}

func assertRepositoryCalls(t *testing.T, calls []repositoryCall, wantDB repository.DBTX, wantNames []string) {
	t.Helper()
	if len(calls) != len(wantNames) {
		t.Fatalf("repository calls = %v, want %v", callNames(calls), wantNames)
	}
	for i, call := range calls {
		if call.name != wantNames[i] {
			t.Fatalf("call %d = %s, want %s; all calls = %v", i, call.name, wantNames[i], callNames(calls))
		}
		if call.db != wantDB {
			t.Fatalf("call %d used db %#v, want same transaction marker %#v", i, call.db, wantDB)
		}
	}
}

func callNames(calls []repositoryCall) []string {
	names := make([]string, 0, len(calls))
	for _, call := range calls {
		names = append(names, call.name)
	}
	return names
}
