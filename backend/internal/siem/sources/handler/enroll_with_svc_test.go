package handler

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/enroll"
	"github.com/clario360/platform/internal/siem/sources/pki"
)

// Minimal stub reader / tokens / rev for the enroll handler-with-svc test.

type readerStub struct {
	mu  sync.Mutex
	src map[uuid.UUID]*sources.Source
}

func (r *readerStub) GetByID(_ context.Context, tenantID, id uuid.UUID) (*sources.Source, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if v, ok := r.src[id]; ok && v.TenantID == tenantID {
		return v, nil
	}
	return nil, sources.ErrNotFound
}
func (r *readerStub) AttachCert(_ context.Context, _, id uuid.UUID, _, _ string, _, _ time.Time, st sources.Status) (*sources.Source, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v := r.src[id]
	v.Status = st
	return v, nil
}
func (r *readerStub) InsertCredentials(_ context.Context, _ sources.SourceCredentials) error {
	return nil
}
func (r *readerStub) MarkCertRevoked(_ context.Context, _ uuid.UUID, _ string) error { return nil }

type tokStub struct{ used map[uuid.UUID]bool }

func (t *tokStub) MarkConsumed(_ context.Context, jti uuid.UUID, _ string, _ time.Time) (*sources.EnrollmentTokenRecord, error) {
	if t.used == nil {
		t.used = map[uuid.UUID]bool{}
	}
	if t.used[jti] {
		return nil, sources.ErrTokenConsumed
	}
	t.used[jti] = true
	now := time.Now()
	return &sources.EnrollmentTokenRecord{JTI: jti, ConsumedAt: &now}, nil
}

type revStub struct{}

func (revStub) Insert(_ context.Context, _ sources.Revocation) error { return nil }

type pkiVaultStub struct{}

func (pkiVaultStub) EnsurePKIMount(context.Context, string, time.Duration, time.Duration) error {
	return nil
}
func (pkiVaultStub) GenerateRootCA(context.Context, string, string, time.Duration) (string, error) {
	return "r", nil
}
func (pkiVaultStub) EnsureIntermediate(context.Context, string, string, string, time.Duration) (string, error) {
	return "i", nil
}
func (pkiVaultStub) EnsurePKIRole(context.Context, string, string, pki.PKIRoleSettings) error {
	return nil
}
func (pkiVaultStub) IssueLeaf(_ context.Context, _, _, _, cn string, ttl time.Duration) (pki.LeafCert, error) {
	// generate a leaf via ecdsa
	priv := edPriv()
	_ = priv
	// reuse the leaf from pki test util — generate a parseable PEM.
	return pki.LeafCert{
		CertPEM: `-----BEGIN CERTIFICATE-----
MIIBhTCCASugAwIBAgIBATAKBggqhkjOPQQDAjAUMRIwEAYDVQQDDAlsZWFmLXRl
c3QwHhcNMjAwMTAxMDAwMDAwWhcNNDAwMTAxMDAwMDAwWjAUMRIwEAYDVQQDDAls
ZWFmLXRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARpyMpkF31bRJZc7m4z
n7AwPsBKQyA2NK4Sd1AdRf4kVQz2lksbAcjUybRyTNxs1jR8GuJWMz3VaJU+8gOG
RR3Po4GAMH4wDgYDVR0PAQH/BAQDAgWgMB0GA1UdDgQWBBSDONjAd4mGRSnXQ2dl
3IGOgsHt5jAfBgNVHSMEGDAWgBSDONjAd4mGRSnXQ2dl3IGOgsHt5jAMBgNVHRMB
Af8EAjAAMB0GA1UdJQQWMBQGCCsGAQUFBwMCBggrBgEFBQcDATAKBggqhkjOPQQD
AgNHADBEAiBKCxh6Ip5oNcZJSt/E7TVuQRz0fQ7sySYxRMx48zoYxgIgGmYxENXq
JzVrnVmKKAWXr0VjqEsezPVhWMK0wHv8X1k=
-----END CERTIFICATE-----
`,
		CAChainPEM: "", Serial: "1",
		NotBefore: time.Now(), NotAfter: time.Now().Add(time.Hour),
	}, nil
}
func (pkiVaultStub) RevokeLeaf(context.Context, string, string) error { return nil }

func edPriv() ed25519.PrivateKey {
	_, p, _ := ed25519.GenerateKey(rand.Reader)
	return p
}

func TestEnroll_RealEnroller_Dispatches(t *testing.T) {
	mr, err := miniredis.Run()
	require.NoError(t, err)
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer := enroll.NewEd25519Signer("k", priv)
	tm := enroll.NewTokenManager(signer, rdb)

	reader := &readerStub{src: map[uuid.UUID]*sources.Source{}}
	tenant := uuid.New()
	id := uuid.New()
	reader.src[id] = &sources.Source{ID: id, TenantID: tenant, Status: sources.StatusProvisioning}

	pkiMgr := pki.New(pkiVaultStub{}, pki.DefaultConfig(), zerolog.Nop())
	svc := enroll.New(tm, reader, &tokStub{}, revStub{}, pkiMgr, nil, nil, 0, zerolog.Nop())

	h := NewEnrollHandler(Deps{Enroller: svc, Logger: zerolog.Nop()})
	// Token claims tenant + source.
	res, _ := tm.Mint(context.Background(), enroll.MintParams{SourceID: id, TenantID: tenant, Purpose: sources.PurposeEnroll, TTL: time.Minute})

	body := []byte(`{"token":"` + res.JWT + `","csr_pem":"garbage"}`)
	req := httptest.NewRequest("POST", "/x/enroll", bytes.NewBuffer(body))
	rec := httptest.NewRecorder()
	h.Enroll(rec, req)
	// CSR is garbage — handler should return 400 (validation).
	require.Equal(t, http.StatusBadRequest, rec.Code)
}
