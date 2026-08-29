package attestledger

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// memRunner runs fns with a nil DBTX (the in-memory store ignores it). It models
// the tenant-scoped / system transaction boundary without a database.
type memRunner struct{}

func (memRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(nil)
}
func (memRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(nil)
}
func (memRunner) RunSystem(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(nil)
}

// memStore is a faithful in-memory LedgerStore: it allocates a per-tenant
// monotonic seq under a mutex (modeling the DB advisory lock + UNIQUE
// constraint), links each entry to the current head, and supports the range +
// checkpoint queries the recorder needs. It exercises the real chain/Merkle code
// paths without Postgres.
type memStore struct {
	mu          sync.Mutex
	entries     map[uuid.UUID][]*Entry      // tenant -> entries, seq-ordered
	checkpoints map[uuid.UUID][]*Checkpoint // tenant -> checkpoints, append order
}

func newMemStore() *memStore {
	return &memStore{
		entries:     map[uuid.UUID][]*Entry{},
		checkpoints: map[uuid.UUID][]*Checkpoint{},
	}
}

func (s *memStore) LockTenant(context.Context, repository.DBTX, uuid.UUID) error {
	return nil
}

func (s *memStore) AppendEntry(_ context.Context, _ repository.DBTX, e *Entry, payload any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.entries[e.TenantID]
	var prev *Entry
	if len(list) > 0 {
		prev = list[len(list)-1]
	}
	if err := LinkEntry(e, payload, prev); err != nil {
		return err
	}
	e.ID = uuid.New()
	cp := *e
	s.entries[e.TenantID] = append(list, &cp)
	// Return the persisted copy's identity to the caller's entry.
	e.ID = cp.ID
	return nil
}

func (s *memStore) ListEntries(_ context.Context, _ repository.DBTX, tenantID uuid.UUID, f ListFilter) ([]*Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*Entry
	for _, e := range s.entries[tenantID] {
		if f.EntryType != "" && e.EntryType != f.EntryType {
			continue
		}
		if f.SubjectID != "" && e.SubjectID != f.SubjectID {
			continue
		}
		cp := *e
		out = append(out, &cp)
		if f.Limit > 0 && len(out) >= f.Limit {
			break
		}
	}
	return out, nil
}

func (s *memStore) EntriesInRange(_ context.Context, _ repository.DBTX, tenantID uuid.UUID, from, to int64) ([]*Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*Entry
	for _, e := range s.entries[tenantID] {
		if e.Seq >= from && e.Seq <= to {
			cp := *e
			out = append(out, &cp)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Seq < out[j].Seq })
	return out, nil
}

func (s *memStore) HeadSeq(_ context.Context, _ repository.DBTX, tenantID uuid.UUID) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.entries[tenantID]
	if len(list) == 0 {
		return 0, nil
	}
	return list[len(list)-1].Seq, nil
}

func (s *memStore) LastAnchoredSeq(_ context.Context, _ repository.DBTX, tenantID uuid.UUID) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var max int64
	for _, c := range s.checkpoints[tenantID] {
		if c.ToSeq > max {
			max = c.ToSeq
		}
	}
	return max, nil
}

func (s *memStore) CreateCheckpoint(_ context.Context, _ repository.DBTX, c *Checkpoint) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c.ID = uuid.New()
	cp := *c
	s.checkpoints[c.TenantID] = append(s.checkpoints[c.TenantID], &cp)
	return nil
}

func (s *memStore) MarkAnchored(_ context.Context, _ repository.DBTX, tenantID uuid.UUID, from, to int64, root string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.entries[tenantID] {
		if e.Seq >= from && e.Seq <= to {
			e.AnchoredRoot = root
		}
	}
	return nil
}

func (s *memStore) LatestCheckpointCovering(_ context.Context, _ repository.DBTX, tenantID uuid.UUID, seq int64) (*Checkpoint, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var found *Checkpoint
	for _, c := range s.checkpoints[tenantID] {
		if c.FromSeq <= seq && c.ToSeq >= seq {
			found = c // last match wins (newest)
		}
	}
	if found == nil {
		return nil, ErrNotFound
	}
	cp := *found
	return &cp, nil
}

func (s *memStore) PendingAnchors(_ context.Context, _ repository.DBTX, limit int) ([]PendingTenant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []PendingTenant
	for tenant, list := range s.entries {
		if len(list) == 0 {
			continue
		}
		head := list[len(list)-1].Seq
		var anchored int64
		for _, c := range s.checkpoints[tenant] {
			if c.ToSeq > anchored {
				anchored = c.ToSeq
			}
		}
		if head > anchored {
			out = append(out, PendingTenant{TenantID: tenant, HeadSeq: head, LastAnchored: anchored})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TenantID.String() < out[j].TenantID.String() })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// recordingStager captures staged events instead of writing the outbox.
type recordingStager struct {
	mu     sync.Mutex
	types  []string
	bodies []map[string]any
}

func (s *recordingStager) Stage(_ context.Context, _ repository.DBTX, eventType, _ string, data map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.types = append(s.types, eventType)
	s.bodies = append(s.bodies, data)
	return nil
}

func (s *recordingStager) count(eventType string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, t := range s.types {
		if t == eventType {
			n++
		}
	}
	return n
}

// recordingSealer captures sealed payloads and returns a synthetic key+version.
type recordingSealer struct {
	mu       sync.Mutex
	payloads [][]byte
	keys     []string
}

func (s *recordingSealer) SealCheckpoint(_ context.Context, _ uuid.UUID, key string, payload []byte) (string, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]byte, len(payload))
	copy(cp, payload)
	s.payloads = append(s.payloads, cp)
	s.keys = append(s.keys, key)
	return key, "v-" + uuid.New().String(), nil
}

// racingAnchorSealer simulates another anchor request winning while the current
// request is outside the DB transaction sealing its checkpoint payload.
type racingAnchorSealer struct {
	store *memStore
}

func (s racingAnchorSealer) SealCheckpoint(_ context.Context, tenantID uuid.UUID, key string, payload []byte) (string, string, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	if len(s.store.checkpoints[tenantID]) == 0 {
		entries := s.store.entries[tenantID]
		leaves := make([]string, len(entries))
		for i, e := range entries {
			leaves[i] = e.EntryHash
		}
		root := MerkleRoot(leaves)
		cp := &Checkpoint{
			ID:            uuid.New(),
			TenantID:      tenantID,
			FromSeq:       entries[0].Seq,
			ToSeq:         entries[len(entries)-1].Seq,
			MerkleRoot:    root,
			EntryCount:    len(entries),
			WORMObjectKey: key,
			WORMVersionID: "raced",
		}
		s.store.checkpoints[tenantID] = append(s.store.checkpoints[tenantID], cp)
		for _, e := range entries {
			e.AnchoredRoot = root
		}
	}
	return key, "lost-race", nil
}

func newTestRecorder(t *testing.T, opts ...func(*Config)) (*Recorder, *memStore, *recordingStager) {
	t.Helper()
	store := newMemStore()
	stager := &recordingStager{}
	cfg := Config{
		TX:      memRunner{},
		System:  memRunner{},
		Store:   store,
		Stager:  stager,
		Metrics: NewMetrics(nil),
		Logger:  zerolog.Nop(),
	}
	for _, o := range opts {
		o(&cfg)
	}
	rec, err := NewRecorder(cfg)
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}
	return rec, store, stager
}

func appendN(t *testing.T, rec *Recorder, tenant uuid.UUID, n int) []*Entry {
	t.Helper()
	out := make([]*Entry, 0, n)
	for i := 0; i < n; i++ {
		e, err := rec.Append(context.Background(), AppendRequest{
			TenantID:  tenant,
			EntryType: EntryTypeCleanroomVerdict,
			SubjectID: uuid.New().String(),
			Payload:   map[string]any{"i": i, "verdict": "clean"},
		})
		if err != nil {
			t.Fatalf("Append[%d]: %v", i, err)
		}
		out = append(out, e)
	}
	return out
}

func TestRecorder_Append_ChainsAndEmits(t *testing.T) {
	t.Parallel()
	rec, _, stager := newTestRecorder(t)
	tenant := uuid.New()
	entries := appendN(t, rec, tenant, 5)

	for i, e := range entries {
		if e.Seq != int64(i+1) {
			t.Fatalf("entry %d seq = %d, want %d", i, e.Seq, i+1)
		}
		if i == 0 {
			if e.PrevHash != GenesisPrevHash {
				t.Fatal("genesis prev_hash wrong")
			}
		} else if e.PrevHash != entries[i-1].EntryHash {
			t.Fatalf("entry %d not linked to predecessor", i)
		}
	}
	if got := stager.count(EventTypeEntryAppended); got != 5 {
		t.Fatalf("appended events = %d, want 5", got)
	}

	// The persisted chain must verify intact.
	res, err := rec.Verify(context.Background(), tenant)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !res.Intact {
		t.Fatalf("fresh chain not intact: %+v", res)
	}
}

func TestRecorder_Append_Validation(t *testing.T) {
	t.Parallel()
	rec, _, _ := newTestRecorder(t)
	cases := []AppendRequest{
		{EntryType: EntryTypeCleanroomVerdict, SubjectID: "s"},       // no tenant
		{TenantID: uuid.New(), EntryType: "bogus", SubjectID: "s"},   // bad type
		{TenantID: uuid.New(), EntryType: EntryTypeCleanroomVerdict}, // no subject
	}
	for i, c := range cases {
		if _, err := rec.Append(context.Background(), c); !errors.Is(err, ErrInvalid) {
			t.Fatalf("case %d: err = %v, want ErrInvalid", i, err)
		}
	}
}

func TestRecorder_Verify_DetectsTamperViaStore(t *testing.T) {
	t.Parallel()
	rec, store, stager := newTestRecorder(t)
	tenant := uuid.New()
	appendN(t, rec, tenant, 6)

	// Mutate the stored payload of seq 4 directly (simulating a DB-level edit).
	store.mu.Lock()
	store.entries[tenant][3].Payload = []byte(`{"i":3,"verdict":"malware"}`)
	store.mu.Unlock()

	res, err := rec.Verify(context.Background(), tenant)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if res.Intact {
		t.Fatal("tamper not detected")
	}
	if res.FirstBrokenSeq != 4 {
		t.Fatalf("first broken seq = %d, want 4", res.FirstBrokenSeq)
	}
	if stager.count(EventTypeTamperDetected) != 1 {
		t.Fatal("tamper-detected event not staged")
	}
}

func TestRecorder_AnchorAndInclusionProof(t *testing.T) {
	t.Parallel()
	sealer := &recordingSealer{}
	rec, store, stager := newTestRecorder(t, func(c *Config) { c.Sealer = sealer })
	tenant := uuid.New()
	entries := appendN(t, rec, tenant, 5)

	cp, err := rec.Anchor(context.Background(), tenant)
	if err != nil {
		t.Fatalf("Anchor: %v", err)
	}
	if cp.FromSeq != 1 || cp.ToSeq != 5 || cp.EntryCount != 5 {
		t.Fatalf("checkpoint range wrong: %+v", cp)
	}
	// The checkpoint root must equal the Merkle root of the entry hashes.
	leaves := make([]string, len(entries))
	for i, e := range entries {
		leaves[i] = e.EntryHash
	}
	if cp.MerkleRoot != MerkleRoot(leaves) {
		t.Fatal("checkpoint root != Merkle root of leaves")
	}
	if cp.WORMObjectKey == "" || cp.WORMVersionID == "" {
		t.Fatal("WORM object key/version not recorded")
	}
	if len(sealer.payloads) != 1 {
		t.Fatalf("sealer called %d times, want 1", len(sealer.payloads))
	}
	if stager.count(EventTypeAnchored) != 1 {
		t.Fatal("anchored event not staged")
	}

	// Entries must be stamped with the anchored root.
	store.mu.Lock()
	for _, e := range store.entries[tenant] {
		if e.AnchoredRoot != cp.MerkleRoot {
			store.mu.Unlock()
			t.Fatalf("entry seq %d not stamped with anchored root", e.Seq)
		}
	}
	store.mu.Unlock()

	// Inclusion proof for a present entry verifies; a non-covered seq is NotFound.
	for _, seq := range []int64{1, 3, 5} {
		proof, err := rec.BuildInclusionProofFor(context.Background(), tenant, seq)
		if err != nil {
			t.Fatalf("proof seq %d: %v", seq, err)
		}
		if !VerifyInclusionProof(proof) {
			t.Fatalf("inclusion proof for seq %d failed to verify", seq)
		}
		if proof.Root != cp.MerkleRoot {
			t.Fatalf("proof root != checkpoint root for seq %d", seq)
		}
	}
	if _, err := rec.BuildInclusionProofFor(context.Background(), tenant, 99); !errors.Is(err, ErrNotFound) {
		t.Fatalf("proof for unanchored seq: err = %v, want ErrNotFound", err)
	}
}

func TestRecorder_Anchor_NothingToAnchor(t *testing.T) {
	t.Parallel()
	rec, _, _ := newTestRecorder(t)
	tenant := uuid.New()
	// Empty chain.
	if _, err := rec.Anchor(context.Background(), tenant); !errors.Is(err, ErrInvalid) {
		t.Fatalf("anchor empty chain: err = %v, want ErrInvalid", err)
	}
	appendN(t, rec, tenant, 3)
	if _, err := rec.Anchor(context.Background(), tenant); err != nil {
		t.Fatalf("first anchor: %v", err)
	}
	// Second anchor with no new entries must report nothing to anchor.
	if _, err := rec.Anchor(context.Background(), tenant); !errors.Is(err, ErrInvalid) {
		t.Fatalf("re-anchor: err = %v, want ErrInvalid", err)
	}
	// Append more, then anchoring the next range starts after the first.
	appendN(t, rec, tenant, 2)
	cp, err := rec.Anchor(context.Background(), tenant)
	if err != nil {
		t.Fatalf("second-range anchor: %v", err)
	}
	if cp.FromSeq != 4 || cp.ToSeq != 5 {
		t.Fatalf("second checkpoint range = [%d,%d], want [4,5]", cp.FromSeq, cp.ToSeq)
	}
}

func TestRecorder_Anchor_RechecksRangeAfterSealingRace(t *testing.T) {
	t.Parallel()
	rec, store, stager := newTestRecorder(t)
	rec.sealer = racingAnchorSealer{store: store}
	tenant := uuid.New()
	appendN(t, rec, tenant, 3)

	if _, err := rec.Anchor(context.Background(), tenant); !errors.Is(err, ErrInvalid) {
		t.Fatalf("raced anchor: err = %v, want ErrInvalid", err)
	}
	store.mu.Lock()
	checkpoints := len(store.checkpoints[tenant])
	store.mu.Unlock()
	if checkpoints != 1 {
		t.Fatalf("raced anchor should leave only the winner checkpoint, got %d", checkpoints)
	}
	if got := stager.count(EventTypeAnchored); got != 0 {
		t.Fatalf("losing anchor must not stage an anchored event, got %d", got)
	}
}

func TestRecorder_Anchor_EnvelopeEncryptsCheckpoint(t *testing.T) {
	t.Parallel()
	kp := NewSoftwareKeyProvider()
	sealer := &recordingSealer{}
	rec, _, _ := newTestRecorder(t, func(c *Config) {
		c.Sealer = sealer
		c.Keys = kp
	})
	tenant := uuid.New()
	appendN(t, rec, tenant, 4)
	cp, err := rec.Anchor(context.Background(), tenant)
	if err != nil {
		t.Fatalf("Anchor: %v", err)
	}
	// The sealed payload must be an envelope (decryptable with the tenant KEK) and
	// must NOT contain the plaintext merkle_root in the clear.
	if len(sealer.payloads) != 1 {
		t.Fatalf("sealer payloads = %d, want 1", len(sealer.payloads))
	}
	raw := sealer.payloads[0]
	if string(raw) == "" {
		t.Fatal("empty sealed payload")
	}
	sealed, err := unmarshalSealed(raw)
	if err != nil {
		t.Fatalf("sealed payload is not an envelope: %v", err)
	}
	plain, err := EnvelopeOpen(kp, sealed)
	if err != nil {
		t.Fatalf("EnvelopeOpen: %v", err)
	}
	// The decrypted checkpoint must carry the same Merkle root.
	if want := cp.MerkleRoot; !strings.Contains(string(plain), want) {
		t.Fatalf("decrypted checkpoint missing merkle_root %s", want)
	}
}

func TestRecorder_AnchorAll_MultiTenant(t *testing.T) {
	t.Parallel()
	rec, _, _ := newTestRecorder(t)
	t1, t2, t3 := uuid.New(), uuid.New(), uuid.New()
	appendN(t, rec, t1, 3)
	appendN(t, rec, t2, 2)
	// t3 already anchored: append then anchor so it has no pending work.
	appendN(t, rec, t3, 2)
	if _, err := rec.Anchor(context.Background(), t3); err != nil {
		t.Fatalf("pre-anchor t3: %v", err)
	}

	n, err := rec.AnchorAll(context.Background(), 16)
	if err != nil {
		t.Fatalf("AnchorAll: %v", err)
	}
	if n != 2 {
		t.Fatalf("AnchorAll anchored %d tenants, want 2 (t1, t2)", n)
	}
	// A second pass should anchor nothing.
	n, err = rec.AnchorAll(context.Background(), 16)
	if err != nil {
		t.Fatalf("AnchorAll second pass: %v", err)
	}
	if n != 0 {
		t.Fatalf("second AnchorAll anchored %d, want 0", n)
	}
}

// TestRecorder_ConcurrentAppends_MonotonicNoFork appends concurrently and asserts
// the resulting chain has contiguous, unique seqs 1..N and verifies intact — the
// fork-prevention guarantee (the in-memory store serializes on a mutex, modeling
// the DB advisory lock + UNIQUE(tenant_id, seq) constraint).
func TestRecorder_ConcurrentAppends_MonotonicNoFork(t *testing.T) {
	t.Parallel()
	rec, store, _ := newTestRecorder(t)
	tenant := uuid.New()
	const n = 50

	var wg sync.WaitGroup
	errCh := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := rec.Append(context.Background(), AppendRequest{
				TenantID:  tenant,
				EntryType: EntryTypeFailoverAttestation,
				SubjectID: uuid.New().String(),
				Payload:   map[string]any{"i": i},
			})
			errCh <- err
		}(i)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatalf("concurrent append failed: %v", err)
		}
	}

	store.mu.Lock()
	list := store.entries[tenant]
	store.mu.Unlock()
	if len(list) != n {
		t.Fatalf("entries = %d, want %d", len(list), n)
	}
	seen := map[int64]bool{}
	for i, e := range list {
		if e.Seq != int64(i+1) {
			t.Fatalf("entry %d has seq %d, not contiguous", i, e.Seq)
		}
		if seen[e.Seq] {
			t.Fatalf("duplicate seq %d (fork!)", e.Seq)
		}
		seen[e.Seq] = true
	}
	res, err := rec.Verify(context.Background(), tenant)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !res.Intact || res.EntriesChecked != n {
		t.Fatalf("post-concurrency chain not intact: %+v", res)
	}
}
