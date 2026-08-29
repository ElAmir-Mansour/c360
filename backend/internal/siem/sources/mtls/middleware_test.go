package mtls

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/pki"
)

type stubLookup struct {
	mu  sync.Mutex
	by  map[string]*sources.Source
	err error
}

func (s *stubLookup) GetByThumbprint(_ context.Context, thumb string) (*sources.Source, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return nil, s.err
	}
	src, ok := s.by[thumb]
	if !ok {
		return nil, sources.ErrNotFound
	}
	return src, nil
}

// buildTLS makes a self-signed cert; we don't need a real chain because
// the middleware only looks at the leaf.
func buildLeafCert(t *testing.T) (*x509.Certificate, []byte) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "test-source"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &priv.PublicKey, priv)
	require.NoError(t, err)
	cert, err := x509.ParseCertificate(der)
	require.NoError(t, err)
	return cert, der
}

func TestMiddleware_NoCert(t *testing.T) {
	m := NewMiddleware(&stubLookup{}, nil, 0)
	h := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("should not reach")
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x", nil)
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestMiddleware_UnknownThumbprint(t *testing.T) {
	stub := &stubLookup{by: map[string]*sources.Source{}}
	m := NewMiddleware(stub, nil, 0)
	cert, _ := buildLeafCert(t)
	h := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("should not reach")
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x", nil)
	req.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestMiddleware_Active_Allows(t *testing.T) {
	cert, der := buildLeafCert(t)
	thumb := pki.ThumbprintDER(der)
	id := uuid.New()
	stub := &stubLookup{by: map[string]*sources.Source{thumb: {ID: id, TenantID: uuid.New(), Status: sources.StatusActive}}}
	m := NewMiddleware(stub, nil, 0)
	called := false
	h := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		got := SourceFromContext(r.Context())
		require.NotNil(t, got)
		require.Equal(t, id, got.ID)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x", nil)
	req.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}
	h.ServeHTTP(rec, req)
	require.True(t, called)
}

func TestMiddleware_Revoked(t *testing.T) {
	cert, der := buildLeafCert(t)
	thumb := pki.ThumbprintDER(der)
	crl := pki.NewCRLCache(stubCRLSrc{}, time.Minute, zerolog.Nop())
	crl.Add(sources.Revocation{Thumbprint: thumb})
	m := NewMiddleware(&stubLookup{by: map[string]*sources.Source{thumb: {Status: sources.StatusActive}}}, crl, 0)
	h := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Fatal() }))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x", nil)
	req.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusForbidden, rec.Code)
}

type stubCRLSrc struct{}

func (stubCRLSrc) ListSince(context.Context, time.Time) ([]sources.Revocation, error) {
	return nil, nil
}

func TestMiddleware_InactiveStatus(t *testing.T) {
	cert, der := buildLeafCert(t)
	thumb := pki.ThumbprintDER(der)
	m := NewMiddleware(&stubLookup{by: map[string]*sources.Source{thumb: {Status: sources.StatusDisabled}}}, nil, 0)
	h := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Fatal() }))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x", nil)
	req.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestMiddleware_RevokedAtSet(t *testing.T) {
	cert, der := buildLeafCert(t)
	thumb := pki.ThumbprintDER(der)
	now := time.Now()
	m := NewMiddleware(&stubLookup{by: map[string]*sources.Source{thumb: {Status: sources.StatusActive, CertRevokedAt: &now}}}, nil, 0)
	h := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Fatal() }))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x", nil)
	req.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusForbidden, rec.Code)
}

func TestMiddleware_LookupError(t *testing.T) {
	cert, _ := buildLeafCert(t)
	m := NewMiddleware(&stubLookup{err: errors.New("boom")}, nil, 0)
	h := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Fatal() }))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x", nil)
	req.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
}

func TestCache_Invalidate(t *testing.T) {
	c := &cache{ttl: time.Minute, entries: map[string]cacheEntry{}}
	c.put("a", &sources.Source{Name: "x"})
	require.NotNil(t, c.get("a"))
	c.delete("a")
	require.Nil(t, c.get("a"))
}

func TestCache_Expiry(t *testing.T) {
	c := &cache{ttl: 10 * time.Millisecond, entries: map[string]cacheEntry{}}
	c.put("a", &sources.Source{Name: "x"})
	time.Sleep(15 * time.Millisecond)
	require.Nil(t, c.get("a"))
}
