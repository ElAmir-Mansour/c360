package crypto

import (
	"context"
	"crypto/rand"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

// stubTransit returns deterministic DEKs and tracks call counts.
type stubTransit struct {
	mu           sync.Mutex
	genCount     int32
	decCount     int32
	ensureCount  int32
	ensureErr    error
	genErr       error
	decErr       error
	lastEnvelope []byte
	lastDEK      []byte
	verSeed      int
}

func (s *stubTransit) EnsureKey(ctx context.Context, keyName string) error {
	atomic.AddInt32(&s.ensureCount, 1)
	return s.ensureErr
}
func (s *stubTransit) Generate(ctx context.Context, keyName string) ([]byte, []byte, int, error) {
	atomic.AddInt32(&s.genCount, 1)
	if s.genErr != nil {
		return nil, nil, 0, s.genErr
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	dek := make([]byte, 32)
	_, _ = rand.Read(dek)
	s.verSeed++
	env := make([]byte, 16)
	_, _ = rand.Read(env)
	s.lastEnvelope = env
	s.lastDEK = append([]byte(nil), dek...)
	return dek, env, s.verSeed, nil
}
func (s *stubTransit) Decrypt(ctx context.Context, keyName string, env []byte) ([]byte, error) {
	atomic.AddInt32(&s.decCount, 1)
	if s.decErr != nil {
		return nil, s.decErr
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastDEK == nil {
		return nil, errors.New("no DEK recorded")
	}
	out := make([]byte, len(s.lastDEK))
	copy(out, s.lastDEK)
	return out, nil
}

func TestDEKManager_Get_CachesAcrossCalls(t *testing.T) {
	tr := &stubTransit{}
	mgr, err := NewDEKManager(DEKManagerConfig{}, DEKManagerDeps{Transit: tr})
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()

	tenant := uuid.New()
	idx := "siem-test-2026.05.14"
	dek1, ver1, err := mgr.Get(context.Background(), tenant, idx)
	if err != nil {
		t.Fatal(err)
	}
	dek2, ver2, err := mgr.Get(context.Background(), tenant, idx)
	if err != nil {
		t.Fatal(err)
	}
	if string(dek1) != string(dek2) {
		t.Error("expected same DEK on cache hit")
	}
	if ver1 != ver2 {
		t.Errorf("ver mismatch %d != %d", ver1, ver2)
	}
	if atomic.LoadInt32(&tr.genCount) != 1 {
		t.Errorf("expected 1 Generate call, got %d", tr.genCount)
	}
}

func TestDEKManager_Get_DifferentIndexes(t *testing.T) {
	tr := &stubTransit{}
	mgr, err := NewDEKManager(DEKManagerConfig{}, DEKManagerDeps{Transit: tr})
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()
	tenant := uuid.New()
	dek1, _, _ := mgr.Get(context.Background(), tenant, "idx-A")
	dek2, _, _ := mgr.Get(context.Background(), tenant, "idx-B")
	if string(dek1) == string(dek2) {
		t.Error("expected different DEKs per (tenant,index)")
	}
}

func TestDEKManager_Get_VaultOutageFailsClosed(t *testing.T) {
	tr := &stubTransit{ensureErr: errors.New("sealed")}
	mgr, err := NewDEKManager(DEKManagerConfig{}, DEKManagerDeps{Transit: tr})
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()
	_, _, err = mgr.Get(context.Background(), uuid.New(), "idx")
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrDEKUnavailable) {
		t.Errorf("err not ErrDEKUnavailable: %v", err)
	}
}

func TestDEKManager_TTLExpiry(t *testing.T) {
	tr := &stubTransit{}
	mgr, err := NewDEKManager(DEKManagerConfig{TTL: time.Millisecond}, DEKManagerDeps{Transit: tr})
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()
	tenant := uuid.New()
	if _, _, err := mgr.Get(context.Background(), tenant, "idx"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)
	if _, _, err := mgr.Get(context.Background(), tenant, "idx"); err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(&tr.genCount) != 2 {
		t.Errorf("expected 2 Generate calls after TTL expiry, got %d", tr.genCount)
	}
}

func TestDEKManager_LRUEviction(t *testing.T) {
	tr := &stubTransit{}
	mgr, err := NewDEKManager(DEKManagerConfig{MaxEntries: 2}, DEKManagerDeps{Transit: tr})
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()
	tenant := uuid.New()
	_, _, _ = mgr.Get(context.Background(), tenant, "A")
	_, _, _ = mgr.Get(context.Background(), tenant, "B")
	_, _, _ = mgr.Get(context.Background(), tenant, "C") // should evict A
	// Re-fetch A: cache miss expected.
	priorGen := atomic.LoadInt32(&tr.genCount)
	_, _, _ = mgr.Get(context.Background(), tenant, "A")
	if atomic.LoadInt32(&tr.genCount) != priorGen+1 {
		t.Errorf("expected Generate after LRU eviction; gen=%d prior=%d", tr.genCount, priorGen)
	}
}

func TestDEKManager_Invalidate(t *testing.T) {
	tr := &stubTransit{}
	mgr, err := NewDEKManager(DEKManagerConfig{}, DEKManagerDeps{Transit: tr})
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()
	tenant := uuid.New()
	if _, _, err := mgr.Get(context.Background(), tenant, "idx"); err != nil {
		t.Fatal(err)
	}
	mgr.Invalidate(tenant, "idx")
	if _, _, err := mgr.Get(context.Background(), tenant, "idx"); err != nil {
		t.Fatal(err)
	}
	if tr.genCount != 2 {
		t.Errorf("expected 2 Generate calls after Invalidate, got %d", tr.genCount)
	}
}

func TestDEKManager_ZeroizesOnClose(t *testing.T) {
	tr := &stubTransit{}
	mgr, err := NewDEKManager(DEKManagerConfig{}, DEKManagerDeps{Transit: tr})
	if err != nil {
		t.Fatal(err)
	}
	tenant := uuid.New()
	dek, _, _ := mgr.Get(context.Background(), tenant, "idx")
	// Capture reference; after Close, mgr must zero this exact slice.
	if err := mgr.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	for i, b := range dek {
		if b != 0 {
			t.Fatalf("byte %d not zeroed: %x", i, b)
		}
	}
}

func TestDEKManager_ConcurrentSafe(t *testing.T) {
	tr := &stubTransit{}
	mgr, err := NewDEKManager(DEKManagerConfig{MaxEntries: 64}, DEKManagerDeps{Transit: tr})
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()
	tenant := uuid.New()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _, err := mgr.Get(context.Background(), tenant, "shared-idx")
			if err != nil {
				t.Errorf("Get: %v", err)
			}
		}(i)
	}
	wg.Wait()
}
