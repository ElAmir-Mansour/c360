package repository

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

var errNotFound = errors.New("not found")

// fakeInstSource is an in-memory instanceReadSource for the federation tests. Its
// List mirrors the repository contract: tenant + status filter, sort, then
// limit/offset over the matched rows. ListForViewer additionally honours the
// viewer scope by started_by, which is enough to assert that the federation
// layer propagates the viewer to every source.
type fakeInstSource struct {
	rows        []*model.WorkflowInstance
	err         error             // when set, List/GetByID return it (simulates a down suite store)
	lastViewers []*InstanceViewer // viewers this source was queried with
}

func (f *fakeInstSource) List(ctx context.Context, tenantID, status, definitionID, startedBy string, dateFrom, dateTo *time.Time, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowInstance, int, error) {
	return f.ListForViewer(ctx, tenantID, nil, status, definitionID, startedBy, dateFrom, dateTo, sortBy, sortOrder, limit, offset)
}

func (f *fakeInstSource) ListForViewer(_ context.Context, tenantID string, viewer *InstanceViewer, status, _, _ string, _, _ *time.Time, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowInstance, int, error) {
	f.lastViewers = append(f.lastViewers, viewer)
	if f.err != nil {
		return nil, 0, f.err
	}
	var m []*model.WorkflowInstance
	for _, r := range f.rows {
		if r.TenantID != tenantID {
			continue
		}
		if status != "" && r.Status != status {
			continue
		}
		if viewer != nil && viewer.UserID != "" {
			if r.StartedBy == nil || *r.StartedBy != viewer.UserID {
				continue
			}
		}
		m = append(m, r)
	}
	total := len(m)
	mergeSortInstances(m, sortBy, sortOrder)
	if offset > len(m) {
		offset = len(m)
	}
	end := offset + limit
	if end > len(m) {
		end = len(m)
	}
	return m[offset:end], total, nil
}

func (f *fakeInstSource) GetByID(_ context.Context, tenantID, id string) (*model.WorkflowInstance, error) {
	if f.err != nil {
		return nil, f.err
	}
	for _, r := range f.rows {
		if r.ID == id && r.TenantID == tenantID {
			return r, nil
		}
	}
	return nil, errNotFound
}

func (f *fakeInstSource) GetStepExecutions(_ context.Context, _ string) ([]*model.StepExecution, error) {
	return nil, nil
}

func (f *fakeInstSource) UpdateVariables(_ context.Context, _, _ string, _ map[string]interface{}) error {
	return nil
}

func inst(id, tenant, status string, started time.Time) *model.WorkflowInstance {
	return &model.WorkflowInstance{ID: id, TenantID: tenant, Status: status, StartedAt: started}
}

func startedBy(i *model.WorkflowInstance, userID string) *model.WorkflowInstance {
	i.StartedBy = &userID
	return i
}

func ids(rows []*model.WorkflowInstance) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.ID
	}
	return out
}

func TestFederatedInstanceReader_List(t *testing.T) {
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	const T = "tenant-1"
	primary := &fakeInstSource{rows: []*model.WorkflowInstance{
		inst("p1", T, "running", base.Add(5*time.Hour)),
		inst("p2", T, "completed", base.Add(1*time.Hour)),
		inst("x1", "other-tenant", "running", base.Add(9*time.Hour)), // wrong tenant — must be excluded
	}}
	suite := &fakeInstSource{rows: []*model.WorkflowInstance{
		inst("s1", T, "running", base.Add(4*time.Hour)),
		inst("s2", T, "running", base.Add(2*time.Hour)),
		inst("s3", T, "failed", base.Add(3*time.Hour)),
	}}
	r := NewFederatedInstanceReader(primary, zerolog.Nop())
	r.AddSource(suite)

	t.Run("merges + globally sorts + sums totals, tenant-scoped", func(t *testing.T) {
		rows, total, err := r.List(ctx, T, "", "", "", nil, nil, "started_at", "desc", 25, 0)
		if err != nil {
			t.Fatalf("List error: %v", err)
		}
		if total != 5 {
			t.Fatalf("total = %d, want 5 (p1,p2,s1,s2,s3; other-tenant excluded)", total)
		}
		if got, want := ids(rows), []string{"p1", "s1", "s3", "s2", "p2"}; !equal(got, want) {
			t.Fatalf("order = %v, want %v (started_at desc across both stores)", got, want)
		}
	})

	t.Run("status filter sums across stores", func(t *testing.T) {
		_, total, err := r.List(ctx, T, "running", "", "", nil, nil, "started_at", "desc", 1, 0)
		if err != nil {
			t.Fatalf("List error: %v", err)
		}
		if total != 3 {
			t.Fatalf("running total = %d, want 3 (p1,s1,s2)", total)
		}
	})

	t.Run("paginates over the merged global order", func(t *testing.T) {
		rows, total, err := r.List(ctx, T, "", "", "", nil, nil, "started_at", "desc", 2, 2)
		if err != nil {
			t.Fatalf("List error: %v", err)
		}
		if total != 5 {
			t.Fatalf("total = %d, want 5", total)
		}
		if got, want := ids(rows), []string{"s3", "s2"}; !equal(got, want) {
			t.Fatalf("page(limit2,offset2) = %v, want %v", got, want)
		}
	})

	t.Run("a down suite store degrades gracefully (primary still served)", func(t *testing.T) {
		rg := NewFederatedInstanceReader(primary, zerolog.Nop())
		rg.AddSource(&fakeInstSource{err: errors.New("suite db down")})
		rows, total, err := rg.List(ctx, T, "", "", "", nil, nil, "started_at", "desc", 25, 0)
		if err != nil {
			t.Fatalf("a failing suite store must not fail the list: %v", err)
		}
		if total != 2 {
			t.Fatalf("total = %d, want 2 (primary only)", total)
		}
		if got, want := ids(rows), []string{"p1", "p2"}; !equal(got, want) {
			t.Fatalf("primary-only rows = %v, want %v", got, want)
		}
	})
}

// A viewer-scoped list must reach EVERY source, or a federated suite store
// would keep handing a business user instances they have no part in — the exact
// leak the scope exists to close.
func TestFederatedInstanceReader_ListForViewerScopesEverySource(t *testing.T) {
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	const T = "tenant-1"
	const me = "user-me"

	primary := &fakeInstSource{rows: []*model.WorkflowInstance{
		startedBy(inst("mine-p", T, "running", base.Add(5*time.Hour)), me),
		startedBy(inst("theirs-p", T, "running", base.Add(4*time.Hour)), "user-other"),
	}}
	suite := &fakeInstSource{rows: []*model.WorkflowInstance{
		startedBy(inst("mine-s", T, "running", base.Add(3*time.Hour)), me),
		startedBy(inst("theirs-s", T, "running", base.Add(2*time.Hour)), "user-other"),
	}}
	r := NewFederatedInstanceReader(primary, zerolog.Nop())
	r.AddSource(suite)

	rows, total, err := r.ListForViewer(ctx, T, &InstanceViewer{UserID: me}, "", "", "", nil, nil, "started_at", "desc", 25, 0)
	if err != nil {
		t.Fatalf("ListForViewer error: %v", err)
	}
	if total != 2 {
		t.Fatalf("total = %d, want 2 (only the viewer's own instances across both stores)", total)
	}
	if got, want := ids(rows), []string{"mine-p", "mine-s"}; !equal(got, want) {
		t.Fatalf("rows = %v, want %v", got, want)
	}
	for _, src := range []*fakeInstSource{primary, suite} {
		if len(src.lastViewers) == 0 || src.lastViewers[len(src.lastViewers)-1] == nil {
			t.Fatalf("source was queried without the viewer scope: %+v", src.lastViewers)
		}
	}

	// A nil viewer keeps the operator's unscoped, tenant-wide view.
	_, allTotal, err := r.ListForViewer(ctx, T, nil, "", "", "", nil, nil, "started_at", "desc", 25, 0)
	if err != nil {
		t.Fatalf("unscoped ListForViewer error: %v", err)
	}
	if allTotal != 4 {
		t.Fatalf("unscoped total = %d, want 4", allTotal)
	}
}

func TestFederatedInstanceReader_GetByID(t *testing.T) {
	ctx := context.Background()
	const T = "tenant-1"
	primary := &fakeInstSource{rows: []*model.WorkflowInstance{inst("p1", T, "running", time.Now().UTC())}}
	suite := &fakeInstSource{rows: []*model.WorkflowInstance{inst("s1", T, "running", time.Now().UTC())}}
	r := NewFederatedInstanceReader(primary, zerolog.Nop())
	r.AddSource(suite)

	if got, err := r.GetByID(ctx, T, "p1"); err != nil || got == nil || got.ID != "p1" {
		t.Fatalf("primary lookup failed: got=%v err=%v", got, err)
	}
	if got, err := r.GetByID(ctx, T, "s1"); err != nil || got == nil || got.ID != "s1" {
		t.Fatalf("federated fallback failed: got=%v err=%v", got, err)
	}
	if _, err := r.GetByID(ctx, T, "missing"); err == nil {
		t.Fatalf("expected error for an id in no store")
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
