package ingest

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/pki"
)

type fakeLookup struct {
	agent *model.DRAgent
	err   error
}

func (f fakeLookup) GetByThumbprint(context.Context, string) (*model.DRAgent, error) {
	if f.err != nil {
		return nil, f.err
	}
	if f.agent == nil {
		return nil, model.ErrNotFound
	}
	return f.agent, nil
}

func TestMiddlewareRejectsMissingClientIdentity(t *testing.T) {
	t.Parallel()
	mw := NewMiddleware(fakeLookup{}, nil, 0)
	called := false
	h := mw.Handler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/streams/s/frames", nil)
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	require.False(t, called)
}

func TestMiddlewareRejectsRevokedClientIdentity(t *testing.T) {
	t.Parallel()
	cert, der := buildLeafCert(t)
	thumb := pki.ThumbprintDER(der)
	crl := pki.NewCRLCache(stubCRL{}, time.Minute, zerolog.Nop())
	crl.Add(sources.Revocation{Thumbprint: thumb, RevokedAt: time.Now()})
	mw := NewMiddleware(fakeLookup{agent: activeAgent(t)}, crl, 0)
	called := false
	h := mw.Handler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/streams/s/frames", nil)
	req.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.False(t, called)
}

func TestMiddlewareAllowsActiveAgentAndStoresIdentity(t *testing.T) {
	t.Parallel()
	cert, der := buildLeafCert(t)
	thumb := pki.ThumbprintDER(der)
	agent := activeAgent(t)
	mw := NewMiddleware(fakeLookup{agent: agent}, nil, 0)
	h := mw.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := IdentityFromContext(r.Context())
		require.True(t, ok)
		require.Equal(t, agent.ID, id.AgentID.String())
		require.Equal(t, agent.TenantID, id.TenantID.String())
		require.Equal(t, thumb, id.Thumbprint)
		w.WriteHeader(http.StatusNoContent)
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/streams/s/frames", nil)
	req.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNoContent, rec.Code)
}

func TestMiddlewareRechecksRevokedAgentAfterIdentityCacheTTL(t *testing.T) {
	cert, der := buildLeafCert(t)
	agent := activeAgent(t)
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	mw := NewMiddleware(fakeLookup{agent: agent}, nil, time.Minute)
	mw.cache.now = func() time.Time { return now }
	h := mw.Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := func() int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/streams/s/frames", nil)
		req.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	require.Equal(t, http.StatusNoContent, request())

	revokedAt := time.Now().UTC()
	agent.CertRevokedAt = &revokedAt
	require.Equal(t, http.StatusNoContent, request(), "cached active identity should remain until TTL")

	now = now.Add(time.Minute + time.Second)
	require.Equal(t, http.StatusForbidden, request(), "revoked cert must be rejected after cache TTL")
	require.NotEmpty(t, pki.ThumbprintDER(der))
}

func activeAgent(t *testing.T) *model.DRAgent {
	t.Helper()
	agentID := uuid.New()
	tenantID := uuid.New()
	siteID := uuid.New().String()
	return &model.DRAgent{
		ID:       agentID.String(),
		TenantID: tenantID.String(),
		SiteID:   &siteID,
		Status:   model.AgentStatusActive,
	}
}

type stubCRL struct{}

func (stubCRL) ListSince(context.Context, time.Time) ([]sources.Revocation, error) {
	return nil, nil
}

func buildLeafCert(t *testing.T) (*x509.Certificate, []byte) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "dr-agent"},
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
