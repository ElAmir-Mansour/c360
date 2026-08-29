package service

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// subMemStore is an in-memory substitutionStore for tests. It keys the
// active substitution by (tenant, user) — the same one-active-per-user invariant
// the DB partial-unique index enforces.
type subMemStore struct {
	active map[string]*model.Substitution // key: tenant|user
	err    error                          // when set, GetActiveDeputy returns it
}

func newSubMemStore() *subMemStore {
	return &subMemStore{active: map[string]*model.Substitution{}}
}

func key(tenant, user string) string { return tenant + "|" + user }

func (m *subMemStore) GetActiveDeputy(_ context.Context, tenantID, userID string, at time.Time) (*model.Substitution, error) {
	if m.err != nil {
		return nil, m.err
	}
	sub, ok := m.active[key(tenantID, userID)]
	if !ok {
		return nil, nil
	}
	if !sub.IsActiveAt(at) {
		return nil, nil // outside the window: no hand-off
	}
	return sub, nil
}

func (m *subMemStore) SetSubstitution(_ context.Context, sub *model.Substitution) error {
	sub.ID = "sub-" + sub.UserID
	sub.Active = true
	m.active[key(sub.TenantID, sub.UserID)] = sub
	return nil
}

func (m *subMemStore) ClearSubstitution(_ context.Context, tenantID, userID string) error {
	delete(m.active, key(tenantID, userID))
	return nil
}

func (m *subMemStore) ListForUser(_ context.Context, tenantID, userID string) ([]*model.Substitution, error) {
	if sub, ok := m.active[key(tenantID, userID)]; ok {
		return []*model.Substitution{sub}, nil
	}
	return nil, nil
}

// put is a test helper that stores an active window [from, to] for user->deputy.
func (m *subMemStore) put(tenant, user, deputy string, from, to time.Time) {
	m.active[key(tenant, user)] = &model.Substitution{
		ID: "sub-" + user, TenantID: tenant, UserID: user, DeputyID: deputy,
		FromTime: from, ToTime: to, Active: true,
	}
}

const testTenant = "tenant-1"

func fixedClock(t time.Time) func() time.Time { return func() time.Time { return t } }

func TestResolveAssignee_NoWindow_FastPathNoop(t *testing.T) {
	store := newSubMemStore()
	svc := NewSubstitutionService(store, zerolog.Nop())

	d := svc.ResolveAssignee(context.Background(), testTenant, "alice")
	if d.Substituted {
		t.Fatalf("expected no substitution for a user with no active window, got Substituted=true")
	}
	if d.Assignee != "alice" {
		t.Fatalf("expected assignee unchanged 'alice', got %q", d.Assignee)
	}
	if len(d.Chain) != 0 {
		t.Fatalf("expected empty chain, got %v", d.Chain)
	}
}

func TestResolveAssignee_WithinWindow_RoutesToDeputy(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	store := newSubMemStore()
	// Alice is OOO for the whole day; deputy is bob.
	store.put(testTenant, "alice", "bob",
		now.Add(-4*time.Hour), now.Add(4*time.Hour))

	svc := NewSubstitutionService(store, zerolog.Nop())
	svc.now = fixedClock(now)

	d := svc.ResolveAssignee(context.Background(), testTenant, "alice")
	if !d.Substituted {
		t.Fatalf("expected substitution within window")
	}
	if d.Assignee != "bob" {
		t.Fatalf("expected deputy 'bob', got %q", d.Assignee)
	}
	if len(d.Chain) != 1 || d.Chain[0].From != "alice" || d.Chain[0].To != "bob" {
		t.Fatalf("expected chain [alice->bob], got %v", d.Chain)
	}
	if d.OriginalAssignee != "alice" {
		t.Fatalf("expected OriginalAssignee 'alice', got %q", d.OriginalAssignee)
	}
}

func TestResolveAssignee_OutsideWindow_NotRouted(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	store := newSubMemStore()
	// Alice's OOO window is NEXT week — not covering now.
	store.put(testTenant, "alice", "bob",
		now.Add(7*24*time.Hour), now.Add(9*24*time.Hour))

	svc := NewSubstitutionService(store, zerolog.Nop())
	svc.now = fixedClock(now)

	d := svc.ResolveAssignee(context.Background(), testTenant, "alice")
	if d.Substituted {
		t.Fatalf("expected NO substitution outside the window, got Substituted=true (assignee=%q)", d.Assignee)
	}
	if d.Assignee != "alice" {
		t.Fatalf("expected assignee unchanged 'alice' outside window, got %q", d.Assignee)
	}
}

func TestResolveAssignee_ChainFollowsMultipleHops(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	from, to := now.Add(-time.Hour), now.Add(time.Hour)
	store := newSubMemStore()
	// alice -> bob -> carol, and carol is available (terminal).
	store.put(testTenant, "alice", "bob", from, to)
	store.put(testTenant, "bob", "carol", from, to)

	svc := NewSubstitutionService(store, zerolog.Nop())
	svc.now = fixedClock(now)

	d := svc.ResolveAssignee(context.Background(), testTenant, "alice")
	if d.Assignee != "carol" {
		t.Fatalf("expected chain to terminate at 'carol', got %q", d.Assignee)
	}
	if len(d.Chain) != 2 {
		t.Fatalf("expected 2 hops, got %d (%v)", len(d.Chain), d.Chain)
	}
	if d.Truncated {
		t.Fatalf("did not expect truncation for a short chain")
	}
	if d.OriginalOrFirstEquals("alice") == false {
		t.Fatalf("expected original head 'alice'")
	}
}

func TestResolveAssignee_CycleDetectedAndBounded(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	from, to := now.Add(-time.Hour), now.Add(time.Hour)
	store := newSubMemStore()
	// A -> B -> A : a two-node cycle. Must NOT loop; must terminate bounded.
	store.put(testTenant, "A", "B", from, to)
	store.put(testTenant, "B", "A", from, to)

	svc := NewSubstitutionService(store, zerolog.Nop())
	svc.now = fixedClock(now)

	done := make(chan SubstitutionDecision, 1)
	go func() {
		done <- svc.ResolveAssignee(context.Background(), testTenant, "A")
	}()

	select {
	case d := <-done:
		// The walk: A->B (hop1), then B->A closes the cycle (hop2 recorded, stop).
		if len(d.Chain) != 2 {
			t.Fatalf("expected 2 recorded hops for A->B->A cycle, got %d (%v)", len(d.Chain), d.Chain)
		}
		if last := d.Chain[len(d.Chain)-1]; last.From != "B" || last.To != "A" {
			t.Fatalf("expected terminal cycle hop B->A, got %v", last)
		}
		if !d.Substituted {
			t.Fatalf("expected Substituted=true (at least one real hand-off happened)")
		}
		// It must have stopped — never exceeding the depth cap.
		if len(d.Chain) > model.MaxSubstitutionDepth {
			t.Fatalf("cycle was not bounded: chain length %d exceeds cap", len(d.Chain))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ResolveAssignee did not terminate on a cycle within 2s — LOOP DETECTION FAILED")
	}
}

func TestResolveAssignee_DepthLimitBoundsLongChain(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	from, to := now.Add(-time.Hour), now.Add(time.Hour)
	store := newSubMemStore()
	// Build a long acyclic chain u0 -> u1 -> u2 -> ... longer than the cap so the
	// depth limit (not loop detection) is what stops the walk.
	total := model.MaxSubstitutionDepth + 5
	for i := 0; i < total; i++ {
		u := userID(i)
		next := userID(i + 1)
		store.put(testTenant, u, next, from, to)
	}

	svc := NewSubstitutionService(store, zerolog.Nop())
	svc.now = fixedClock(now)

	d := svc.ResolveAssignee(context.Background(), testTenant, userID(0))
	if !d.Truncated {
		t.Fatalf("expected Truncated=true when the chain exceeds MaxSubstitutionDepth")
	}
	if len(d.Chain) != model.MaxSubstitutionDepth {
		t.Fatalf("expected exactly %d hops at the depth cap, got %d", model.MaxSubstitutionDepth, len(d.Chain))
	}
}

func TestResolveAssignee_StoreErrorFailsOpen(t *testing.T) {
	store := newSubMemStore()
	store.err = context.DeadlineExceeded
	svc := NewSubstitutionService(store, zerolog.Nop())

	d := svc.ResolveAssignee(context.Background(), testTenant, "alice")
	if d.Substituted {
		t.Fatalf("a store error must fail OPEN (no substitution), got Substituted=true")
	}
	if d.Assignee != "alice" {
		t.Fatalf("fail-open must keep the original assignee 'alice', got %q", d.Assignee)
	}
}

// userID builds a stable synthetic user id for the depth test.
func userID(i int) string {
	return "u" + strconv.Itoa(i)
}

// OriginalOrFirstEquals is a tiny helper used by the multi-hop test.
func (d SubstitutionDecision) OriginalOrFirstEquals(want string) bool {
	if len(d.Chain) > 0 {
		return d.Chain[0].From == want
	}
	return d.OriginalAssignee == want
}
