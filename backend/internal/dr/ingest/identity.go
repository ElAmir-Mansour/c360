// Package ingest accepts mTLS-authenticated DR agent frame streams.
package ingest

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/pki"
)

type ctxKey string

const identityKey ctxKey = "dr_mtls_identity"

// Identity is the authenticated DR agent identity extracted from the client
// certificate thumbprint and dr_agent row.
type Identity struct {
	AgentID    uuid.UUID
	TenantID   uuid.UUID
	SiteID     *uuid.UUID
	Thumbprint string
	CertSerial string
}

// AgentLookup resolves a client certificate thumbprint to a DR agent.
type AgentLookup interface {
	GetByThumbprint(ctx context.Context, thumbprint string) (*model.DRAgent, error)
}

// Middleware authenticates DR agent client certificates. It mirrors the SIEM
// sources mTLS middleware but resolves dr_agent rows and stores a DR Identity.
type Middleware struct {
	lookup AgentLookup
	crl    *pki.CRLCache
	cache  *identityCache
}

// NewMiddleware constructs a Middleware. cacheTTL <= 0 defaults to 60 seconds.
func NewMiddleware(lookup AgentLookup, crl *pki.CRLCache, cacheTTL time.Duration) *Middleware {
	if cacheTTL <= 0 {
		cacheTTL = 60 * time.Second
	}
	return &Middleware{
		lookup: lookup,
		crl:    crl,
		cache: &identityCache{
			ttl:     cacheTTL,
			entries: map[string]identityCacheEntry{},
			now:     func() time.Time { return time.Now().UTC() },
		},
	}
}

// Handler is the chi-compatible middleware factory.
func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
			writeMTLSError(w, http.StatusUnauthorized, "no_cert", "client certificate required")
			return
		}
		leaf := r.TLS.PeerCertificates[0]
		thumb := pki.ThumbprintDER(leaf.Raw)

		if m.crl != nil && m.crl.IsRevoked(thumb) {
			writeMTLSError(w, http.StatusForbidden, "cert_revoked", "client certificate has been revoked")
			return
		}

		identity, err := m.resolve(r.Context(), thumb, leaf)
		switch {
		case errors.Is(err, model.ErrNotFound), errors.Is(err, sources.ErrNotFound):
			writeMTLSError(w, http.StatusUnauthorized, "unknown_thumbprint", "client certificate not registered")
			return
		case err != nil:
			writeMTLSError(w, http.StatusServiceUnavailable, "lookup_failed", err.Error())
			return
		}
		if !agentStatusAllowed(identity.status) {
			writeMTLSError(w, http.StatusUnauthorized, "inactive_agent", "agent not active")
			return
		}
		if identity.revoked {
			writeMTLSError(w, http.StatusForbidden, "cert_revoked", "client certificate has been revoked")
			return
		}
		if !leaf.NotAfter.IsZero() && time.Now().UTC().After(leaf.NotAfter) {
			writeMTLSError(w, http.StatusUnauthorized, "cert_expired", "client certificate expired")
			return
		}

		ctx := WithIdentity(r.Context(), identity.Identity)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Invalidate evicts a cached identity by thumbprint after rotation/revocation.
func (m *Middleware) Invalidate(thumbprint string) {
	if m == nil || m.cache == nil {
		return
	}
	m.cache.delete(thumbprint)
}

type resolvedIdentity struct {
	Identity
	status  string
	revoked bool
}

func (m *Middleware) resolve(ctx context.Context, thumb string, leaf *x509.Certificate) (*resolvedIdentity, error) {
	if m == nil || m.lookup == nil {
		return nil, ErrNotConfigured
	}
	if got := m.cache.get(thumb); got != nil {
		return got, nil
	}
	agent, err := m.lookup.GetByThumbprint(ctx, thumb)
	if err != nil {
		return nil, err
	}
	id, err := identityFromAgent(agent, thumb, leaf)
	if err != nil {
		return nil, err
	}
	m.cache.put(thumb, id)
	return id, nil
}

func identityFromAgent(agent *model.DRAgent, thumb string, leaf *x509.Certificate) (*resolvedIdentity, error) {
	if agent == nil {
		return nil, model.ErrNotFound
	}
	agentID, err := uuid.Parse(agent.ID)
	if err != nil {
		return nil, err
	}
	tenantID, err := uuid.Parse(agent.TenantID)
	if err != nil {
		return nil, err
	}
	var siteID *uuid.UUID
	if agent.SiteID != nil && *agent.SiteID != "" {
		parsed, err := uuid.Parse(*agent.SiteID)
		if err != nil {
			return nil, err
		}
		siteID = &parsed
	}
	serial := ""
	if agent.CertSerial != nil {
		serial = *agent.CertSerial
	} else if leaf != nil && leaf.SerialNumber != nil {
		serial = leaf.SerialNumber.String()
	}
	return &resolvedIdentity{
		Identity: Identity{
			AgentID:    agentID,
			TenantID:   tenantID,
			SiteID:     siteID,
			Thumbprint: thumb,
			CertSerial: serial,
		},
		status:  agent.Status,
		revoked: agent.CertRevokedAt != nil || agent.Status == model.AgentStatusRevoked,
	}, nil
}

func agentStatusAllowed(status string) bool {
	switch status {
	case model.AgentStatusActive, model.AgentStatusSilent, model.AgentStatusRotating:
		return true
	default:
		return false
	}
}

// WithIdentity stores identity in ctx.
func WithIdentity(ctx context.Context, identity Identity) context.Context {
	return context.WithValue(ctx, identityKey, identity)
}

// IdentityFromContext returns the authenticated DR agent identity.
func IdentityFromContext(ctx context.Context) (Identity, bool) {
	v, ok := ctx.Value(identityKey).(Identity)
	return v, ok
}

func writeMTLSError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "code": code, "message": msg})
}

type identityCacheEntry struct {
	id     *resolvedIdentity
	expiry time.Time
}

type identityCache struct {
	mu      sync.Mutex
	entries map[string]identityCacheEntry
	ttl     time.Duration
	now     func() time.Time
}

func (c *identityCache) get(k string) *resolvedIdentity {
	now := c.currentTime()
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[k]
	if !ok {
		return nil
	}
	if now.After(e.expiry) {
		delete(c.entries, k)
		return nil
	}
	return e.id
}

func (c *identityCache) put(k string, id *resolvedIdentity) {
	now := c.currentTime()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[k] = identityCacheEntry{id: id, expiry: now.Add(c.ttl)}
}

func (c *identityCache) delete(k string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, k)
}

func (c *identityCache) currentTime() time.Time {
	if c == nil || c.now == nil {
		return time.Now().UTC()
	}
	return c.now().UTC()
}
