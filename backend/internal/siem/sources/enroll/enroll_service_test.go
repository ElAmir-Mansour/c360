package enroll

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/pki"
)

// stubReader implements SourcesReader for tests.
type stubReader struct {
	mu       sync.Mutex
	sources  map[uuid.UUID]*sources.Source
	creds    map[uuid.UUID]sources.SourceCredentials
	attached map[uuid.UUID]string // sourceID -> thumbprint
	revoked  map[uuid.UUID]string
}

func newStubReader() *stubReader {
	return &stubReader{
		sources:  map[uuid.UUID]*sources.Source{},
		creds:    map[uuid.UUID]sources.SourceCredentials{},
		attached: map[uuid.UUID]string{},
		revoked:  map[uuid.UUID]string{},
	}
}

func (s *stubReader) addSource(src *sources.Source) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sources[src.ID] = src
}

func (s *stubReader) GetByID(_ context.Context, tenantID, id uuid.UUID) (*sources.Source, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	src, ok := s.sources[id]
	if !ok || src.TenantID != tenantID {
		return nil, sources.ErrNotFound
	}
	cp := *src
	return &cp, nil
}

func (s *stubReader) AttachCert(_ context.Context, _, id uuid.UUID, thumbprint, serial string, issued, expires time.Time, status sources.Status) (*sources.Source, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	src, ok := s.sources[id]
	if !ok {
		return nil, sources.ErrNotFound
	}
	src.MTLSThumbprint = thumbprint
	src.CertSerial = serial
	src.CertIssuedAt = &issued
	src.CertExpiresAt = &expires
	src.Status = status
	s.attached[id] = thumbprint
	cp := *src
	return &cp, nil
}

func (s *stubReader) InsertCredentials(_ context.Context, sc sources.SourceCredentials) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.creds[sc.SourceID] = sc
	return nil
}

func (s *stubReader) MarkCertRevoked(_ context.Context, id uuid.UUID, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.revoked[id] = reason
	return nil
}

type stubTokens struct {
	mu   sync.Mutex
	cons map[uuid.UUID]bool
}

func newStubTokens() *stubTokens { return &stubTokens{cons: map[uuid.UUID]bool{}} }

func (s *stubTokens) MarkConsumed(_ context.Context, jti uuid.UUID, _ string, _ time.Time) (*sources.EnrollmentTokenRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cons[jti] {
		return nil, sources.ErrTokenConsumed
	}
	s.cons[jti] = true
	consumed := time.Now()
	return &sources.EnrollmentTokenRecord{JTI: jti, ConsumedAt: &consumed}, nil
}

type stubRevWriter struct {
	mu  sync.Mutex
	got []sources.Revocation
}

func (s *stubRevWriter) Insert(_ context.Context, rv sources.Revocation) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.got = append(s.got, rv)
	return nil
}

type stubEmitter struct {
	mu  sync.Mutex
	got []string
}

func (s *stubEmitter) EmitCertEvent(_ context.Context, _, _ uuid.UUID, eventType string, _ any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.got = append(s.got, eventType)
	return nil
}

func newServiceHarness(t *testing.T) (
	*Service,
	*TokenManager,
	*stubReader,
	*stubTokens,
	*stubRevWriter,
	*stubEmitter,
) {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(func() { mr.Close() })
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer := NewEd25519Signer("k", priv)
	tm := NewTokenManager(signer, rdb)

	reader := newStubReader()
	tokens := newStubTokens()
	rev := &stubRevWriter{}
	emitter := &stubEmitter{}
	pkiMgr := pki.New(stubVaultPKI{}, pki.DefaultConfig(), zerolog.Nop())

	svc := New(tm, reader, tokens, rev, pkiMgr, nil, emitter, 50*time.Millisecond, zerolog.Nop())
	return svc, tm, reader, tokens, rev, emitter
}

// stubVaultPKI is a tiny copy of pki.stubVault to avoid importing test-only
// symbols across packages.
type stubVaultPKI struct{}

func (stubVaultPKI) EnsurePKIMount(context.Context, string, time.Duration, time.Duration) error {
	return nil
}
func (stubVaultPKI) GenerateRootCA(context.Context, string, string, time.Duration) (string, error) {
	return "root", nil
}
func (stubVaultPKI) EnsureIntermediate(context.Context, string, string, string, time.Duration) (string, error) {
	return "int", nil
}
func (stubVaultPKI) EnsurePKIRole(context.Context, string, string, pki.PKIRoleSettings) error {
	return nil
}
func (stubVaultPKI) IssueLeaf(_ context.Context, _, _, _, cn string, ttl time.Duration) (pki.LeafCert, error) {
	return generateLeaf(cn, ttl)
}
func (stubVaultPKI) RevokeLeaf(context.Context, string, string) error { return nil }

func TestExchange_HappyPath(t *testing.T) {
	svc, tm, reader, _, _, emitter := newServiceHarness(t)
	tenant := uuid.New()
	src := uuid.New()
	reader.addSource(&sources.Source{ID: src, TenantID: tenant, Status: sources.StatusProvisioning, Name: "x"})

	tok, err := tm.Mint(context.Background(), MintParams{SourceID: src, TenantID: tenant, Purpose: sources.PurposeEnroll, TTL: time.Minute})
	require.NoError(t, err)

	out, err := svc.Exchange(context.Background(), ExchangeInput{Token: tok.JWT, CSRPEM: makeCSR(t), IP: "10.0.0.1"})
	require.NoError(t, err)
	require.NotEmpty(t, out.CertPEM)
	require.NotEmpty(t, out.Serial)

	require.Contains(t, emitter.got, "siem.source.cert.issued")
	require.Equal(t, sources.StatusActive, reader.sources[src].Status)
}

func TestExchange_Replay(t *testing.T) {
	svc, tm, reader, _, _, _ := newServiceHarness(t)
	tenant := uuid.New()
	src := uuid.New()
	reader.addSource(&sources.Source{ID: src, TenantID: tenant, Status: sources.StatusProvisioning})

	tok, err := tm.Mint(context.Background(), MintParams{SourceID: src, TenantID: tenant, Purpose: sources.PurposeEnroll, TTL: time.Minute})
	require.NoError(t, err)

	_, err = svc.Exchange(context.Background(), ExchangeInput{Token: tok.JWT, CSRPEM: makeCSR(t), IP: "10.0.0.1"})
	require.NoError(t, err)
	// 2nd Exchange must fail.
	_, err = svc.Exchange(context.Background(), ExchangeInput{Token: tok.JWT, CSRPEM: makeCSR(t), IP: "10.0.0.1"})
	require.ErrorIs(t, err, sources.ErrTokenConsumed)
}

func TestExchange_TenantMismatch(t *testing.T) {
	svc, tm, reader, _, _, _ := newServiceHarness(t)
	tenantA := uuid.New()
	tenantB := uuid.New()
	src := uuid.New()
	reader.addSource(&sources.Source{ID: src, TenantID: tenantB, Status: sources.StatusProvisioning})

	// Token is for tenantA but the source belongs to tenantB.
	tok, err := tm.Mint(context.Background(), MintParams{SourceID: src, TenantID: tenantA, Purpose: sources.PurposeEnroll, TTL: time.Minute})
	require.NoError(t, err)
	_, err = svc.Exchange(context.Background(), ExchangeInput{Token: tok.JWT, CSRPEM: makeCSR(t), IP: "10.0.0.1"})
	require.ErrorIs(t, err, sources.ErrTenantMismatch)
}

func TestExchange_WrongState_Enroll(t *testing.T) {
	svc, tm, reader, _, _, _ := newServiceHarness(t)
	tenant := uuid.New()
	src := uuid.New()
	// Source is already active — enroll should be rejected.
	reader.addSource(&sources.Source{ID: src, TenantID: tenant, Status: sources.StatusActive})

	tok, _ := tm.Mint(context.Background(), MintParams{SourceID: src, TenantID: tenant, Purpose: sources.PurposeEnroll, TTL: time.Minute})
	_, err := svc.Exchange(context.Background(), ExchangeInput{Token: tok.JWT, CSRPEM: makeCSR(t), IP: "10.0.0.1"})
	require.ErrorIs(t, err, sources.ErrInvalidState)
}

func TestExchange_BadCSR(t *testing.T) {
	svc, tm, reader, _, _, _ := newServiceHarness(t)
	tenant := uuid.New()
	src := uuid.New()
	reader.addSource(&sources.Source{ID: src, TenantID: tenant, Status: sources.StatusProvisioning})
	tok, _ := tm.Mint(context.Background(), MintParams{SourceID: src, TenantID: tenant, Purpose: sources.PurposeEnroll, TTL: time.Minute})
	_, err := svc.Exchange(context.Background(), ExchangeInput{Token: tok.JWT, CSRPEM: "garbage", IP: "10.0.0.1"})
	require.ErrorIs(t, err, sources.ErrValidation)
}

func TestExchange_Rotate(t *testing.T) {
	svc, tm, reader, _, rev, emitter := newServiceHarness(t)
	tenant := uuid.New()
	src := uuid.New()
	reader.addSource(&sources.Source{
		ID: src, TenantID: tenant, Status: sources.StatusActive,
		MTLSThumbprint: "oldthumb", CertSerial: "oldsn",
	})
	tok, _ := tm.Mint(context.Background(), MintParams{SourceID: src, TenantID: tenant, Purpose: sources.PurposeRotate, TTL: time.Minute})
	_, err := svc.Exchange(context.Background(), ExchangeInput{Token: tok.JWT, CSRPEM: makeCSR(t), IP: "10.0.0.1"})
	require.NoError(t, err)
	require.Contains(t, emitter.got, "siem.source.cert.rotated")
	// Wait the overlap window for the deferred revocation.
	require.Eventually(t, func() bool {
		rev.mu.Lock()
		defer rev.mu.Unlock()
		return len(rev.got) > 0
	}, time.Second, 10*time.Millisecond)
	rev.mu.Lock()
	defer rev.mu.Unlock()
	require.Equal(t, "oldthumb", rev.got[0].Thumbprint)
}
