package pki

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

type stubRepo struct {
	mu    sync.Mutex
	items []sources.Revocation
	err   error
}

func (s *stubRepo) ListSince(_ context.Context, since time.Time) ([]sources.Revocation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return nil, s.err
	}
	out := []sources.Revocation{}
	for _, it := range s.items {
		if it.RevokedAt.After(since) {
			out = append(out, it)
		}
	}
	return out, nil
}

func (s *stubRepo) add(rv sources.Revocation) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = append(s.items, rv)
}

func TestCRLCache_Add(t *testing.T) {
	c := NewCRLCache(&stubRepo{}, 0, zerolog.Nop())
	rv := sources.Revocation{Thumbprint: "abc", SourceID: uuid.New(), CertSerial: "sn", Reason: "x", RevokedAt: time.Now()}
	c.Add(rv)
	require.True(t, c.IsRevoked("abc"))
	require.Equal(t, 1, c.Size())
}

func TestCRLCache_Refresh(t *testing.T) {
	repo := &stubRepo{}
	repo.add(sources.Revocation{Thumbprint: "a", RevokedAt: time.Now()})
	repo.add(sources.Revocation{Thumbprint: "b", RevokedAt: time.Now().Add(time.Millisecond)})

	c := NewCRLCache(repo, 0, zerolog.Nop())
	require.NoError(t, c.Refresh(context.Background()))
	require.True(t, c.IsRevoked("a"))
	require.True(t, c.IsRevoked("b"))
	require.False(t, c.IsRevoked("c"))
}

func TestCRLCache_RefreshError(t *testing.T) {
	c := NewCRLCache(&stubRepo{err: errors.New("boom")}, 0, zerolog.Nop())
	require.Error(t, c.Refresh(context.Background()))
}

func TestCRLCache_Run_Cancel(t *testing.T) {
	c := NewCRLCache(&stubRepo{}, 10*time.Millisecond, zerolog.Nop())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { _ = c.Run(ctx); close(done) }()
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not return on cancel")
	}
}
