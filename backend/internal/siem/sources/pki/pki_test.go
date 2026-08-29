package pki

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
)

// stubVault is a deterministic in-memory VaultPKI for tests.
type stubVault struct {
	mu             sync.Mutex
	mounts         map[string]bool
	intermediates  map[string]string
	roles          map[string]bool
	leafCallCount  int
	revokeCalls    map[string]int
	failNextIssue  bool
	failNextRevoke bool
}

func newStubVault() *stubVault {
	return &stubVault{
		mounts:        map[string]bool{},
		intermediates: map[string]string{},
		roles:         map[string]bool{},
		revokeCalls:   map[string]int{},
	}
}

func (s *stubVault) EnsurePKIMount(_ context.Context, mountPath string, _, _ time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mounts[mountPath] = true
	return nil
}

func (s *stubVault) GenerateRootCA(_ context.Context, mountPath, cn string, _ time.Duration) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.intermediates[mountPath] != "" {
		return s.intermediates[mountPath], nil
	}
	s.intermediates[mountPath] = "root-" + cn
	return "root-" + cn, nil
}

func (s *stubVault) EnsureIntermediate(_ context.Context, _, intermediateMount, cn string, _ time.Duration) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.intermediates[intermediateMount] = "int-" + cn
	return "int-" + cn, nil
}

func (s *stubVault) EnsurePKIRole(_ context.Context, mountPath, roleName string, _ PKIRoleSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.roles[mountPath+":"+roleName] = true
	return nil
}

func (s *stubVault) IssueLeaf(_ context.Context, _, _, csrPEM, cn string, ttl time.Duration) (LeafCert, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failNextIssue {
		s.failNextIssue = false
		return LeafCert{}, errors.New("issue failed")
	}
	s.leafCallCount++
	// We synthesise a deterministic self-signed cert just so the PEM
	// is parseable for thumbprint computation.
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return LeafCert{}, err
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(int64(s.leafCallCount)),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().UTC(),
		NotAfter:     time.Now().UTC().Add(ttl),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &priv.PublicKey, priv)
	if err != nil {
		return LeafCert{}, err
	}
	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	_ = csrPEM
	return LeafCert{
		CertPEM:    string(leafPEM),
		CAChainPEM: "fake-ca\n",
		Serial:     tpl.SerialNumber.String(),
		NotBefore:  tpl.NotBefore,
		NotAfter:   tpl.NotAfter,
	}, nil
}

func (s *stubVault) RevokeLeaf(_ context.Context, mount, serial string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failNextRevoke {
		s.failNextRevoke = false
		return errors.New("revoke failed")
	}
	s.revokeCalls[mount+":"+serial]++
	return nil
}

func newTestCSR(t *testing.T) string {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tpl := &x509.CertificateRequest{Subject: pkix.Name{CommonName: "test"}}
	der, err := x509.CreateCertificateRequest(rand.Reader, tpl, priv)
	require.NoError(t, err)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: der}))
}

func TestManager_EnsureRoot_Idempotent(t *testing.T) {
	v := newStubVault()
	mgr := New(v, DefaultConfig(), zerolog.Nop())
	require.NoError(t, mgr.EnsureRoot(context.Background()))
	require.NoError(t, mgr.EnsureRoot(context.Background()))
	v.mu.Lock()
	defer v.mu.Unlock()
	// EnsureRoot only hits Vault once after the first success.
	require.True(t, v.mounts[DefaultConfig().RootMount])
}

func TestManager_EnsureTenantIntermediate_Idempotent(t *testing.T) {
	v := newStubVault()
	mgr := New(v, DefaultConfig(), zerolog.Nop())
	tenant := uuid.New()
	mount, err := mgr.EnsureTenantIntermediate(context.Background(), tenant)
	require.NoError(t, err)
	require.Contains(t, mount, tenant.String())
	mount2, err := mgr.EnsureTenantIntermediate(context.Background(), tenant)
	require.NoError(t, err)
	require.Equal(t, mount, mount2)
}

func TestManager_IssueLeaf(t *testing.T) {
	v := newStubVault()
	mgr := New(v, DefaultConfig(), zerolog.Nop())
	tenant := uuid.New()
	source := uuid.New()
	leaf, thumb, err := mgr.IssueLeaf(context.Background(), tenant, source, newTestCSR(t))
	require.NoError(t, err)
	require.NotEmpty(t, leaf.CertPEM)
	require.Len(t, thumb, 64)
}

func TestManager_Revoke(t *testing.T) {
	v := newStubVault()
	mgr := New(v, DefaultConfig(), zerolog.Nop())
	tenant := uuid.New()
	require.NoError(t, mgr.Revoke(context.Background(), tenant, "00:01:02"))
}

func TestThumbprintBadPEM(t *testing.T) {
	_, err := Thumbprint("not-a-pem")
	require.Error(t, err)
}

func TestValidateCSR_Garbage(t *testing.T) {
	_, err := ValidateCSR("not-a-pem")
	require.Error(t, err)
}

func TestValidateCSR_OK(t *testing.T) {
	csr := newTestCSR(t)
	_, err := ValidateCSR(csr)
	require.NoError(t, err)
}

func TestThumbprintDER(t *testing.T) {
	der := []byte{1, 2, 3, 4}
	thumb := ThumbprintDER(der)
	require.Len(t, thumb, 64)
}
