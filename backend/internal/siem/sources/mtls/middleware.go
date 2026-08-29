package mtls

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/pki"
)

// ctxKey is the context-key type so we don't accidentally clash with
// other packages.
type ctxKey string

const sourceKey ctxKey = "siem_mtls_source"

// SourceLookup is the subset of the sources repo needed by the
// middleware.
type SourceLookup interface {
	GetByThumbprint(ctx context.Context, thumbprint string) (*sources.Source, error)
}

// Middleware wraps a chi handler with mTLS identity extraction.
//
//   - Pulls the verified leaf cert from r.TLS.PeerCertificates[0].
//   - Computes the SHA-256 thumbprint of the leaf DER.
//   - Looks up siem.sources by thumbprint (cached 60s).
//   - Rejects with 401 if the lookup misses (or 403 if revoked, or
//     401 if status != active).
//   - Attaches the resolved source to the request context.
type Middleware struct {
	lookup SourceLookup
	crl    *pki.CRLCache
	cache  *cache
}

// NewMiddleware constructs a Middleware. cacheTTL ≤ 0 defaults to 60s.
func NewMiddleware(lookup SourceLookup, crl *pki.CRLCache, cacheTTL time.Duration) *Middleware {
	if cacheTTL <= 0 {
		cacheTTL = 60 * time.Second
	}
	return &Middleware{lookup: lookup, crl: crl, cache: &cache{ttl: cacheTTL, entries: map[string]cacheEntry{}}}
}

// Handler is the chi-compatible factory.
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

		src, err := m.resolve(r.Context(), thumb)
		switch {
		case errors.Is(err, sources.ErrNotFound):
			writeMTLSError(w, http.StatusUnauthorized, "unknown_thumbprint", "client certificate not registered")
			return
		case err != nil:
			writeMTLSError(w, http.StatusServiceUnavailable, "lookup_failed", err.Error())
			return
		}
		if src.Status != sources.StatusActive && src.Status != sources.StatusSilent && src.Status != sources.StatusRotating {
			writeMTLSError(w, http.StatusUnauthorized, "inactive_source", "source not active")
			return
		}
		if src.CertRevokedAt != nil {
			writeMTLSError(w, http.StatusForbidden, "cert_revoked", "client certificate has been revoked")
			return
		}
		// Cert expiry — defence in depth (TLS handshake should already reject).
		if !leaf.NotAfter.IsZero() && time.Now().UTC().After(leaf.NotAfter) {
			writeMTLSError(w, http.StatusUnauthorized, "cert_expired", "client certificate expired")
			return
		}

		ctx := WithSource(r.Context(), src)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Invalidate evicts a cached source by thumbprint. Used immediately
// after a rotation or revocation to ensure the next call is denied.
func (m *Middleware) Invalidate(thumbprint string) {
	m.cache.delete(thumbprint)
}

func (m *Middleware) resolve(ctx context.Context, thumb string) (*sources.Source, error) {
	if got := m.cache.get(thumb); got != nil {
		return got, nil
	}
	src, err := m.lookup.GetByThumbprint(ctx, thumb)
	if err != nil {
		return nil, err
	}
	m.cache.put(thumb, src)
	return src, nil
}

// SourceID is the typed source ID stored in the request context.
type SourceID uuid.UUID

// WithSource stores src in ctx.
func WithSource(ctx context.Context, src *sources.Source) context.Context {
	return context.WithValue(ctx, sourceKey, src)
}

// SourceFromContext returns the resolved source, or nil if absent.
func SourceFromContext(ctx context.Context) *sources.Source {
	v, _ := ctx.Value(sourceKey).(*sources.Source)
	return v
}

// ----- cache -----

type cacheEntry struct {
	src    *sources.Source
	expiry time.Time
}

type cache struct {
	mu      sync.Mutex
	entries map[string]cacheEntry
	ttl     time.Duration
}

func (c *cache) get(k string) *sources.Source {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[k]
	if !ok {
		return nil
	}
	if time.Now().After(e.expiry) {
		delete(c.entries, k)
		return nil
	}
	return e.src
}

func (c *cache) put(k string, src *sources.Source) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[k] = cacheEntry{src: src, expiry: time.Now().Add(c.ttl)}
}

func (c *cache) delete(k string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, k)
}

func writeMTLSError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "code": code, "message": msg})
}
