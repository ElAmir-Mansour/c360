package pki

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/siem/sources"
)

// RevocationSource is implemented by the durable revocation repo.
// We accept the smallest interface here to keep the cache testable.
type RevocationSource interface {
	ListSince(ctx context.Context, since time.Time) ([]sources.Revocation, error)
}

// CRLCache is the in-memory denylist consulted by the mTLS
// middleware. It refreshes from the durable Postgres table on a
// periodic schedule, plus an explicit Add() for "just revoked" cases
// so a freshly revoked thumbprint is denied immediately without
// waiting for the next refresh.
type CRLCache struct {
	repo     RevocationSource
	refresh  time.Duration
	logger   zerolog.Logger
	mu       sync.RWMutex
	denylist map[string]sources.Revocation
	lastTS   time.Time
}

// NewCRLCache constructs the cache. refresh ≤ 0 defaults to 60s.
func NewCRLCache(repo RevocationSource, refresh time.Duration, logger zerolog.Logger) *CRLCache {
	if refresh <= 0 {
		refresh = 60 * time.Second
	}
	return &CRLCache{
		repo:     repo,
		refresh:  refresh,
		logger:   logger.With().Str("component", "siem-crl").Logger(),
		denylist: map[string]sources.Revocation{},
	}
}

// IsRevoked returns true if the thumbprint is denylisted.
func (c *CRLCache) IsRevoked(thumbprint string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, ok := c.denylist[thumbprint]
	return ok
}

// Add inserts a single thumbprint into the in-memory denylist
// without waiting for the next refresh.
func (c *CRLCache) Add(rv sources.Revocation) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.denylist[rv.Thumbprint] = rv
	if rv.RevokedAt.After(c.lastTS) {
		c.lastTS = rv.RevokedAt
	}
}

// Size returns the current denylist size.
func (c *CRLCache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.denylist)
}

// Refresh pulls newer revocations from the repo and merges them in.
func (c *CRLCache) Refresh(ctx context.Context) error {
	c.mu.RLock()
	since := c.lastTS
	c.mu.RUnlock()

	list, err := c.repo.ListSince(ctx, since)
	if err != nil {
		return err
	}
	if len(list) == 0 {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, rv := range list {
		c.denylist[rv.Thumbprint] = rv
		if rv.RevokedAt.After(c.lastTS) {
			c.lastTS = rv.RevokedAt
		}
	}
	return nil
}

// Run periodically refreshes the cache until ctx is done.
func (c *CRLCache) Run(ctx context.Context) error {
	t := time.NewTicker(c.refresh)
	defer t.Stop()
	if err := c.Refresh(ctx); err != nil {
		c.logger.Warn().Err(err).Msg("crl cold-start refresh failed")
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			if err := c.Refresh(ctx); err != nil {
				c.logger.Warn().Err(err).Msg("crl refresh failed")
			}
		}
	}
}
