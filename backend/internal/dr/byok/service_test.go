package byok

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// --- in-memory infrastructure ---------------------------------------------

// captureDB records every outbox.Write Exec the service issues (the staged
// custody events) so tests can assert events are emitted transactionally. It
// satisfies repository.DBTX; the in-memory store ignores the db argument.
type captureDB struct {
	mu     *sync.Mutex
	events *[]capturedEvent
}

type capturedEvent struct {
	sql  string
	args []any
}

func (c captureDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	*c.events = append(*c.events, capturedEvent{sql: sql, args: args})
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}
func (captureDB) Query(context.Context, string, ...any) (pgx.Rows, error) { return nil, nil }
func (captureDB) QueryRow(context.Context, string, ...any) pgx.Row        { return nil }

// memRunner runs fns with a captureDB. failTx, when set to a tenant, makes that
// tenant's NEXT system transaction return an injected error AFTER fn ran but
// BEFORE commit — modeling a mid-rotation crash where the in-memory store
// changes are rolled back. Because the in-memory store applies changes eagerly,
// the runner snapshots and restores store state on a simulated rollback.
type memRunner struct {
	store  *memStore
	mu     sync.Mutex
	events []capturedEvent
}

func newMemRunner(s *memStore) *memRunner { return &memRunner{store: s} }

func (r *memRunner) db() captureDB { return captureDB{mu: &r.mu, events: &r.events} }

func (r *memRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(r.db())
}
func (r *memRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(r.db())
}
func (r *memRunner) RunSystemTx(_ context.Context, fn func(repository.DBTX) error) error {
	// Snapshot for transactional rollback semantics: if fn returns an error, the
	// store must be restored as a real DB transaction would roll back.
	snap := r.store.snapshot()
	if err := fn(r.db()); err != nil {
		r.store.restore(snap)
		return err
	}
	return nil
}
func (r *memRunner) RunSystemRead(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(r.db())
}

func (r *memRunner) eventTypes() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	// The outbox insert is INSERT INTO event_outbox (... event_type ...) with
	// event_type as the 4th positional arg.
	var out []string
	for _, e := range r.events {
		if len(e.args) >= 4 {
			if s, ok := e.args[3].(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

func (r *memRunner) countEvent(eventType string) int {
	n := 0
	for _, t := range r.eventTypes() {
		if t == eventType {
			n++
		}
	}
	return n
}

// memStore is an in-memory custodyStore. Concurrency-safe for -race.
type memStore struct {
	mu      sync.Mutex
	keks    map[string]*TenantKEK      // key: tenant|version
	wrapped map[string]*WrappedDEK     // key: tenant|dekID
	custody map[string][]*CustodyEntry // key: tenant
	// failUpsertAfter, when > 0, makes UpsertWrappedDEK fail once after that many
	// successful upserts — used to inject a mid-rotation failure.
	failUpsertAfter int
	upsertCount     int
}

func newMemStore() *memStore {
	return &memStore{
		keks:    map[string]*TenantKEK{},
		wrapped: map[string]*WrappedDEK{},
		custody: map[string][]*CustodyEntry{},
	}
}

func kekKey(t uuid.UUID, v int) string     { return fmt.Sprintf("%s|%d", t, v) }
func dekKey(t uuid.UUID, id string) string { return fmt.Sprintf("%s|%s", t, id) }

type storeSnapshot struct {
	keks    map[string]TenantKEK
	wrapped map[string]WrappedDEK
	custody map[string][]CustodyEntry
	upserts int
}

func (m *memStore) snapshot() storeSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := storeSnapshot{
		keks:    map[string]TenantKEK{},
		wrapped: map[string]WrappedDEK{},
		custody: map[string][]CustodyEntry{},
		upserts: m.upsertCount,
	}
	for k, v := range m.keks {
		s.keks[k] = *v
	}
	for k, v := range m.wrapped {
		c := *v
		c.WrappedDEK = append([]byte(nil), v.WrappedDEK...)
		c.Nonce = append([]byte(nil), v.Nonce...)
		s.wrapped[k] = c
	}
	for k, v := range m.custody {
		cp := make([]CustodyEntry, len(v))
		for i, e := range v {
			cp[i] = *e
		}
		s.custody[k] = cp
	}
	return s
}

func (m *memStore) restore(s storeSnapshot) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.keks = map[string]*TenantKEK{}
	m.wrapped = map[string]*WrappedDEK{}
	m.custody = map[string][]*CustodyEntry{}
	m.upsertCount = s.upserts
	for k, v := range s.keks {
		c := v
		m.keks[k] = &c
	}
	for k, v := range s.wrapped {
		c := v
		m.wrapped[k] = &c
	}
	for k, v := range s.custody {
		cp := make([]*CustodyEntry, len(v))
		for i := range v {
			e := v[i]
			cp[i] = &e
		}
		m.custody[k] = cp
	}
}

func (m *memStore) CreateKEK(_ context.Context, _ repository.DBTX, k *TenantKEK) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.keks[kekKey(k.TenantID, k.KeyVersion)]; ok {
		return ErrAlreadyEnrolled
	}
	if k.State == KEKStateActive {
		for _, ex := range m.keks {
			if ex.TenantID == k.TenantID && ex.State == KEKStateActive {
				return ErrAlreadyEnrolled // partial unique index on (tenant) WHERE active
			}
		}
		now := time.Now().UTC()
		k.ActivatedAt = &now
	}
	if k.ID == uuid.Nil {
		k.ID = uuid.New()
	}
	k.CreatedAt = time.Now().UTC()
	k.UpdatedAt = k.CreatedAt
	c := *k
	m.keks[kekKey(k.TenantID, k.KeyVersion)] = &c
	return nil
}

func (m *memStore) GetActiveKEK(_ context.Context, _ repository.DBTX, tenantID uuid.UUID) (*TenantKEK, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, k := range m.keks {
		if k.TenantID == tenantID && k.State == KEKStateActive {
			c := *k
			return &c, nil
		}
	}
	return nil, ErrNotEnrolled
}

func (m *memStore) GetActiveKEKSystem(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (*TenantKEK, error) {
	return m.GetActiveKEK(ctx, db, tenantID)
}

func (m *memStore) GetKEKByVersion(_ context.Context, _ repository.DBTX, tenantID uuid.UUID, version int) (*TenantKEK, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k, ok := m.keks[kekKey(tenantID, version)]
	if !ok {
		return nil, ErrNotFound
	}
	c := *k
	return &c, nil
}

func (m *memStore) ListKEKs(_ context.Context, _ repository.DBTX, tenantID uuid.UUID) ([]*TenantKEK, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*TenantKEK
	for _, k := range m.keks {
		if k.TenantID == tenantID {
			c := *k
			out = append(out, &c)
		}
	}
	return out, nil
}

func (m *memStore) MaxKEKVersion(_ context.Context, _ repository.DBTX, tenantID uuid.UUID) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	max := 0
	for _, k := range m.keks {
		if k.TenantID == tenantID && k.KeyVersion > max {
			max = k.KeyVersion
		}
	}
	return max, nil
}

func (m *memStore) SetKEKState(_ context.Context, _ repository.DBTX, tenantID uuid.UUID, version int, state string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k, ok := m.keks[kekKey(tenantID, version)]
	if !ok {
		return false, nil
	}
	k.State = state
	now := time.Now().UTC()
	if state == KEKStateActive && k.ActivatedAt == nil {
		k.ActivatedAt = &now
	}
	if state == KEKStateRetired {
		k.RetiredAt = &now
	}
	k.UpdatedAt = now
	return true, nil
}

func (m *memStore) UpsertWrappedDEK(_ context.Context, _ repository.DBTX, w *WrappedDEK) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failUpsertAfter > 0 && m.upsertCount >= m.failUpsertAfter {
		return errors.New("injected upsert failure")
	}
	m.upsertCount++
	key := dekKey(w.TenantID, w.DEKID)
	now := time.Now().UTC()
	if ex, ok := m.wrapped[key]; ok {
		w.ID = ex.ID
		w.CreatedAt = ex.CreatedAt
		w.RewrappedAt = &now
	} else {
		w.ID = uuid.New()
		w.CreatedAt = now
	}
	w.UpdatedAt = now
	c := *w
	c.WrappedDEK = append([]byte(nil), w.WrappedDEK...)
	c.Nonce = append([]byte(nil), w.Nonce...)
	m.wrapped[key] = &c
	return nil
}

func (m *memStore) GetWrappedDEK(_ context.Context, _ repository.DBTX, tenantID uuid.UUID, dekID string) (*WrappedDEK, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	w, ok := m.wrapped[dekKey(tenantID, dekID)]
	if !ok {
		return nil, ErrNotFound
	}
	c := *w
	c.WrappedDEK = append([]byte(nil), w.WrappedDEK...)
	c.Nonce = append([]byte(nil), w.Nonce...)
	return &c, nil
}

func (m *memStore) ListWrappedDEKsSystem(_ context.Context, _ repository.DBTX, tenantID uuid.UUID) ([]*WrappedDEK, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*WrappedDEK
	for _, w := range m.wrapped {
		if w.TenantID == tenantID {
			c := *w
			c.WrappedDEK = append([]byte(nil), w.WrappedDEK...)
			c.Nonce = append([]byte(nil), w.Nonce...)
			out = append(out, &c)
		}
	}
	return out, nil
}

func (m *memStore) CountWrappedNotAtVersion(_ context.Context, _ repository.DBTX, tenantID uuid.UUID, version int) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, w := range m.wrapped {
		if w.TenantID == tenantID && w.KEKVersion != version {
			n++
		}
	}
	return n, nil
}

func (m *memStore) AppendCustody(_ context.Context, _ repository.DBTX, e *CustodyEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	list := m.custody[e.TenantID.String()]
	for _, ex := range list {
		if ex.Seq == e.Seq {
			return ErrInvalidState
		}
	}
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	e.CreatedAt = time.Now().UTC()
	c := *e
	m.custody[e.TenantID.String()] = append(list, &c)
	return nil
}

func (m *memStore) CustodyTip(_ context.Context, _ repository.DBTX, tenantID uuid.UUID) (int64, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	list := m.custody[tenantID.String()]
	if len(list) == 0 {
		return 0, "", nil
	}
	var (
		maxSeq int64
		hash   string
	)
	for _, e := range list {
		if e.Seq >= maxSeq {
			maxSeq = e.Seq
			hash = e.EntryHash
		}
	}
	return maxSeq, hash, nil
}

func (m *memStore) ListCustody(_ context.Context, _ repository.DBTX, tenantID uuid.UUID) ([]*CustodyEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	list := m.custody[tenantID.String()]
	out := make([]*CustodyEntry, 0, len(list))
	for _, e := range list {
		c := *e
		out = append(out, &c)
	}
	// ascending seq (insertion order is already ascending here)
	return out, nil
}

func (m *memStore) RotatingTenantsSystem(_ context.Context, _ repository.DBTX, limit int) ([]uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	seen := map[uuid.UUID]struct{}{}
	var out []uuid.UUID
	for _, k := range m.keks {
		if k.State == KEKStateRotating {
			if _, ok := seen[k.TenantID]; !ok {
				seen[k.TenantID] = struct{}{}
				out = append(out, k.TenantID)
			}
		}
	}
	return out, nil
}

// fakeDEKSource hands back a fixed DEK per dekID, modeling the platform
// DEKManager source. The DEKs are real random 32-byte keys.
type fakeDEKSource struct {
	mu   sync.Mutex
	deks map[string][]byte
}

func newFakeDEKSource() *fakeDEKSource { return &fakeDEKSource{deks: map[string][]byte{}} }

func (f *fakeDEKSource) GetDEK(_ context.Context, _ uuid.UUID, dekID string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	dek, ok := f.deks[dekID]
	if !ok {
		dek = mustDEK(nil2t(), 32)
		f.deks[dekID] = dek
	}
	out := make([]byte, len(dek))
	copy(out, dek)
	return out, nil
}

// nil2t is a tiny shim so fakeDEKSource can mint a DEK without a *testing.T.
func nil2t() *testing.T { return &testing.T{} }

// newTestService wires a Service over the in-memory store, runner, software
// factory, and DEK source. It returns the service, store, runner and factory.
func newTestService(t *testing.T) (*Service, *memStore, *memRunner, *MemoryProviderFactory, *fakeDEKSource) {
	t.Helper()
	store := newMemStore()
	runner := newMemRunner(store)
	factory := NewMemoryProviderFactory()
	deks := newFakeDEKSource()
	svc, err := NewService(Deps{
		Store:     store,
		Runner:    runner,
		System:    runner,
		Factory:   factory,
		DEKSource: deks,
		Logger:    zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	return svc, store, runner, factory, deks
}

// --- tests -----------------------------------------------------------------

func TestService_EnrollAndWrapUnwrap(t *testing.T) {
	ctx := context.Background()
	svc, _, runner, _, deks := newTestService(t)
	tenant := uuid.New()

	kek, err := svc.Enroll(ctx, tenant, ProviderSoftware, "")
	if err != nil {
		t.Fatalf("enroll: %v", err)
	}
	if kek.KeyVersion != 1 || kek.State != KEKStateActive {
		t.Fatalf("unexpected KEK: v%d %s", kek.KeyVersion, kek.State)
	}
	if runner.countEvent(EventTypeKEKEnrolled) != 1 {
		t.Fatalf("expected 1 enroll event, got %d", runner.countEvent(EventTypeKEKEnrolled))
	}

	// Double-enroll is rejected.
	if _, err := svc.Enroll(ctx, tenant, ProviderSoftware, ""); !errors.Is(err, ErrAlreadyEnrolled) {
		t.Fatalf("second enroll should fail with ErrAlreadyEnrolled, got %v", err)
	}

	// Wrap a DEK, then unwrap it back to the SAME plaintext the DEK source held.
	want, _ := deks.GetDEK(ctx, tenant, "idx-alerts")
	rec, err := svc.WrapDEK(ctx, tenant, "idx-alerts")
	if err != nil {
		t.Fatalf("wrap: %v", err)
	}
	if rec.KEKVersion != 1 || len(rec.WrappedDEK) == 0 || len(rec.Nonce) == 0 {
		t.Fatalf("bad wrapped record: %+v", rec)
	}
	if runner.countEvent(EventTypeDEKWrapped) != 1 {
		t.Fatalf("expected 1 wrap event, got %d", runner.countEvent(EventTypeDEKWrapped))
	}

	got, err := svc.UnwrapDEK(ctx, tenant, "idx-alerts")
	if err != nil {
		t.Fatalf("unwrap: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("unwrap returned a different DEK than the source held")
	}
	if runner.countEvent(EventTypeDEKUnwrapped) != 1 {
		t.Fatalf("expected 1 unwrap event, got %d", runner.countEvent(EventTypeDEKUnwrapped))
	}

	// Custody chain is intact and covers enroll + wrap + unwrap.
	intact, broken, root, verr := svc.VerifyCustody(ctx, tenant)
	if verr != nil || !intact || broken != 0 {
		t.Fatalf("custody chain not intact: intact=%v broken=%d err=%v", intact, broken, verr)
	}
	if root == "" {
		t.Fatalf("empty merkle root")
	}
	log, _ := svc.CustodyLog(ctx, tenant)
	if len(log) != 3 {
		t.Fatalf("expected 3 custody entries (enroll, wrap, unwrap), got %d", len(log))
	}
}

func TestService_WrapWithoutEnrollFails(t *testing.T) {
	ctx := context.Background()
	svc, _, _, _, _ := newTestService(t)
	if _, err := svc.WrapDEK(ctx, uuid.New(), "idx"); !errors.Is(err, ErrNotEnrolled) {
		t.Fatalf("wrap without enroll should fail with ErrNotEnrolled, got %v", err)
	}
}

func TestService_UnwrapTamperedFails(t *testing.T) {
	ctx := context.Background()
	svc, store, runner, _, _ := newTestService(t)
	tenant := uuid.New()
	if _, err := svc.Enroll(ctx, tenant, ProviderSoftware, ""); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	if _, err := svc.WrapDEK(ctx, tenant, "idx"); err != nil {
		t.Fatalf("wrap: %v", err)
	}
	// Tamper with the persisted ciphertext directly.
	store.mu.Lock()
	store.wrapped[dekKey(tenant, "idx")].WrappedDEK[0] ^= 0xFF
	store.mu.Unlock()

	if _, err := svc.UnwrapDEK(ctx, tenant, "idx"); !errors.Is(err, ErrUnwrap) {
		t.Fatalf("tampered ciphertext must fail unwrap with ErrUnwrap, got %v", err)
	}
	if runner.countEvent(EventTypeUnwrapRejected) != 1 {
		t.Fatalf("expected a rejected-unwrap custody event, got %d", runner.countEvent(EventTypeUnwrapRejected))
	}
}

// TestService_RotationRewrapsAllDEKs is the core rotation test: rotate rewraps N
// DEKs old->new, the new version becomes active, every DEK unwraps under the new
// KEK and NO LONGER under the old.
func TestService_RotationRewrapsAllDEKs(t *testing.T) {
	ctx := context.Background()
	svc, store, runner, factory, deks := newTestService(t)
	tenant := uuid.New()

	if _, err := svc.Enroll(ctx, tenant, ProviderSoftware, ""); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	const n = 5
	dekIDs := make([]string, n)
	wantDEKs := make(map[string]string, n)
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("idx-%d", i)
		dekIDs[i] = id
		raw, _ := deks.GetDEK(ctx, tenant, id)
		wantDEKs[id] = string(raw)
		if _, err := svc.WrapDEK(ctx, tenant, id); err != nil {
			t.Fatalf("wrap %s: %v", id, err)
		}
	}

	// Capture the old KEK's reference + provider so we can build the OLD provider
	// after rotation and prove the old key no longer opens the rewrapped DEKs.
	oldKEK, _ := store.GetKEKByVersion(ctx, nil, tenant, 1)
	oldKP, _, perr := factory.Provider(ctx, tenant, oldKEK.Provider, oldKEK.Reference, oldKEK.KeyVersion, false)
	if perr != nil {
		t.Fatalf("load old provider: %v", perr)
	}

	newKEK, err := svc.Rotate(ctx, tenant)
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if newKEK.KeyVersion != 2 || newKEK.State != KEKStateActive {
		t.Fatalf("new KEK should be v2 active, got v%d %s", newKEK.KeyVersion, newKEK.State)
	}

	// Old version retired; exactly one active version.
	keks, _ := svc.ListKEKs(ctx, tenant)
	active := 0
	for _, k := range keks {
		if k.State == KEKStateActive {
			active++
			if k.KeyVersion != 2 {
				t.Fatalf("active KEK should be v2, got v%d", k.KeyVersion)
			}
		}
		if k.KeyVersion == 1 && k.State != KEKStateRetired {
			t.Fatalf("v1 should be retired, got %s", k.State)
		}
	}
	if active != 1 {
		t.Fatalf("expected exactly 1 active KEK, got %d", active)
	}

	// Every DEK now wrapped at v2, unwraps via service to the original plaintext.
	for _, id := range dekIDs {
		rec, gerr := store.GetWrappedDEK(ctx, nil, tenant, id)
		if gerr != nil {
			t.Fatalf("get wrapped %s: %v", id, gerr)
		}
		if rec.KEKVersion != 2 {
			t.Fatalf("DEK %s still at v%d after rotation", id, rec.KEKVersion)
		}
		got, uerr := svc.UnwrapDEK(ctx, tenant, id)
		if uerr != nil {
			t.Fatalf("unwrap %s after rotation: %v", id, uerr)
		}
		if string(got) != wantDEKs[id] {
			t.Fatalf("DEK %s changed across rotation", id)
		}
		// The OLD KEK must NOT open the rewrapped ciphertext.
		if _, e := oldKP.UnwrapDEK(ctx, rec.WrappedDEK, rec.Nonce); !errors.Is(e, ErrUnwrap) {
			t.Fatalf("old KEK must not open rewrapped DEK %s, got %v", id, e)
		}
	}

	// Custody events: rotation began once, N rewraps, completed once.
	if runner.countEvent(EventTypeRotationBegan) != 1 {
		t.Fatalf("expected 1 rotation.began, got %d", runner.countEvent(EventTypeRotationBegan))
	}
	if runner.countEvent(EventTypeDEKRewrapped) != n {
		t.Fatalf("expected %d rewrap events, got %d", n, runner.countEvent(EventTypeDEKRewrapped))
	}
	if runner.countEvent(EventTypeRotationDone) != 1 {
		t.Fatalf("expected 1 rotation.completed, got %d", runner.countEvent(EventTypeRotationDone))
	}

	// The whole custody chain is still intact after rotation.
	intact, broken, _, _ := svc.VerifyCustody(ctx, tenant)
	if !intact || broken != 0 {
		t.Fatalf("custody chain broken after rotation at seq %d", broken)
	}
}

// TestService_RotationAtomicOnMidFailure proves that a failure mid-rewrap leaves
// the OLD version active with NO partial promotion: the active KEK is unchanged
// and DEKs still unwrap under the old key.
func TestService_RotationAtomicOnMidFailure(t *testing.T) {
	ctx := context.Background()
	svc, store, _, _, deks := newTestService(t)
	tenant := uuid.New()

	if _, err := svc.Enroll(ctx, tenant, ProviderSoftware, ""); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	const n = 4
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("idx-%d", i)
		_, _ = deks.GetDEK(ctx, tenant, id)
		if _, err := svc.WrapDEK(ctx, tenant, id); err != nil {
			t.Fatalf("wrap %s: %v", id, err)
		}
	}

	// Inject a failure after 2 rewrap upserts (the initial n wraps already ran,
	// so set the threshold relative to the current upsert count).
	store.mu.Lock()
	store.failUpsertAfter = store.upsertCount + 2
	store.mu.Unlock()

	_, err := svc.Rotate(ctx, tenant)
	if err == nil {
		t.Fatalf("rotation should fail when a rewrap upsert fails")
	}

	// The active KEK MUST still be v1 (no flip happened).
	active, gerr := store.GetActiveKEK(ctx, nil, tenant)
	if gerr != nil {
		t.Fatalf("get active: %v", gerr)
	}
	if active.KeyVersion != 1 || active.State != KEKStateActive {
		t.Fatalf("after mid-rotation failure active KEK must still be v1 active, got v%d %s", active.KeyVersion, active.State)
	}

	// v1 must NOT be retired.
	v1, _ := store.GetKEKByVersion(ctx, nil, tenant, 1)
	if v1.State == KEKStateRetired {
		t.Fatalf("v1 must not be retired after a failed rotation")
	}

	// Every DEK still unwraps under the (unchanged) active KEK via the service.
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("idx-%d", i)
		if _, uerr := svc.UnwrapDEK(ctx, tenant, id); uerr != nil {
			t.Fatalf("DEK %s should still unwrap after failed rotation: %v", id, uerr)
		}
	}
}

// TestService_ResumeRotationCompletes proves the recovery path: after a failed
// rotation that already created the 'rotating' successor, ResumeRotation finishes
// the rewrap and flips atomically.
func TestService_ResumeRotationCompletes(t *testing.T) {
	ctx := context.Background()
	svc, store, _, _, deks := newTestService(t)
	tenant := uuid.New()
	if _, err := svc.Enroll(ctx, tenant, ProviderSoftware, ""); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	for i := 0; i < 3; i++ {
		id := fmt.Sprintf("idx-%d", i)
		_, _ = deks.GetDEK(ctx, tenant, id)
		if _, err := svc.WrapDEK(ctx, tenant, id); err != nil {
			t.Fatalf("wrap: %v", err)
		}
	}

	// Fail the rotation partway (after the 'rotating' KEK row is created and one
	// rewrap committed).
	store.mu.Lock()
	store.failUpsertAfter = store.upsertCount + 1
	store.mu.Unlock()
	if _, err := svc.Rotate(ctx, tenant); err == nil {
		t.Fatalf("rotation should have failed")
	}

	// There should now be a v2 KEK in 'rotating' state and v1 still active.
	rotating, _ := store.RotatingTenantsSystem(ctx, nil, 10)
	if len(rotating) != 1 || rotating[0] != tenant {
		t.Fatalf("expected tenant to be in rotating set, got %v", rotating)
	}

	// Clear the injected failure and resume.
	store.mu.Lock()
	store.failUpsertAfter = 0
	store.mu.Unlock()
	if err := svc.ResumeRotation(ctx, tenant); err != nil {
		t.Fatalf("resume: %v", err)
	}

	active, _ := store.GetActiveKEK(ctx, nil, tenant)
	if active.KeyVersion != 2 {
		t.Fatalf("after resume active should be v2, got v%d", active.KeyVersion)
	}
	for i := 0; i < 3; i++ {
		id := fmt.Sprintf("idx-%d", i)
		rec, _ := store.GetWrappedDEK(ctx, nil, tenant, id)
		if rec.KEKVersion != 2 {
			t.Fatalf("DEK %s should be at v2 after resume, got v%d", id, rec.KEKVersion)
		}
	}
}

func TestService_RotateRetriesExistingRotatingSuccessor(t *testing.T) {
	ctx := context.Background()
	svc, store, runner, _, deks := newTestService(t)
	tenant := uuid.New()
	if _, err := svc.Enroll(ctx, tenant, ProviderSoftware, ""); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	for i := 0; i < 3; i++ {
		id := fmt.Sprintf("idx-%d", i)
		_, _ = deks.GetDEK(ctx, tenant, id)
		if _, err := svc.WrapDEK(ctx, tenant, id); err != nil {
			t.Fatalf("wrap: %v", err)
		}
	}

	// First rotation creates v2 in rotating state and commits one rewrap, then
	// fails before the atomic active-version flip.
	store.mu.Lock()
	store.failUpsertAfter = store.upsertCount + 1
	store.mu.Unlock()
	if _, err := svc.Rotate(ctx, tenant); err == nil {
		t.Fatalf("rotation should have failed")
	}
	if got := runner.countEvent(EventTypeRotationBegan); got != 1 {
		t.Fatalf("failed rotation should have emitted exactly one rotate_begin event, got %d", got)
	}

	// A manual retry through Rotate should converge on the existing rotating v2
	// row and finish it rather than trying to create v2 again.
	store.mu.Lock()
	store.failUpsertAfter = 0
	store.mu.Unlock()
	kek, err := svc.Rotate(ctx, tenant)
	if err != nil {
		t.Fatalf("retry rotate: %v", err)
	}
	if kek.KeyVersion != 2 || kek.State != KEKStateActive {
		t.Fatalf("retry should activate v2, got v%d %s", kek.KeyVersion, kek.State)
	}
	if got := runner.countEvent(EventTypeRotationBegan); got != 1 {
		t.Fatalf("retry must not emit a second rotate_begin event, got %d", got)
	}
	if got := runner.countEvent(EventTypeRotationDone); got != 1 {
		t.Fatalf("retry should emit one rotation.completed event, got %d", got)
	}
	for i := 0; i < 3; i++ {
		id := fmt.Sprintf("idx-%d", i)
		rec, err := store.GetWrappedDEK(ctx, nil, tenant, id)
		if err != nil {
			t.Fatalf("get wrapped %s: %v", id, err)
		}
		if rec.KEKVersion != 2 {
			t.Fatalf("DEK %s should be at v2 after retry, got v%d", id, rec.KEKVersion)
		}
	}
}
