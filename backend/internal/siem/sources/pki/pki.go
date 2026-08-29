package pki

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// VaultPKI captures the Phase 3A method set added to
// backend/internal/vault/pki.go. The package depends only on this
// interface to keep PKI logic testable without a live Vault.
type VaultPKI interface {
	EnsurePKIMount(ctx context.Context, mountPath string, defaultTTL, maxTTL time.Duration) error
	GenerateRootCA(ctx context.Context, mountPath, commonName string, ttl time.Duration) (caCertPEM string, err error)
	EnsureIntermediate(ctx context.Context, rootMount, intermediateMount, commonName string, ttl time.Duration) (intermediateCertPEM string, err error)
	EnsurePKIRole(ctx context.Context, mountPath, roleName string, settings PKIRoleSettings) error
	IssueLeaf(ctx context.Context, mountPath, roleName, csrPEM, commonName string, ttl time.Duration) (LeafCert, error)
	RevokeLeaf(ctx context.Context, mountPath, serial string) error
}

// PKIRoleSettings mirrors the Phase 3A vault.PKIRoleSettings struct.
type PKIRoleSettings struct {
	AllowedDomains   []string
	AllowSubdomains  bool
	AllowBareDomains bool
	AllowLocalhost   bool
	AllowIPSans      bool
	EnforceHostnames bool
	KeyType          string
	KeyBits          int
	MaxTTL           time.Duration
	DefaultTTL       time.Duration
	ClientFlag       bool
	ServerFlag       bool
}

// LeafCert mirrors the Phase 3A vault.LeafCert struct.
type LeafCert struct {
	CertPEM    string
	CAChainPEM string
	Serial     string
	NotBefore  time.Time
	NotAfter   time.Time
}

// Config captures the runtime config for the PKI layer.
type Config struct {
	RootMount           string
	IntermediatePrefix  string
	LeafTTL             time.Duration
	IntermediateTTL     time.Duration
	RoleName            string
	DefaultDomainSuffix string // e.g. ".collectors.siem.clario360.local"
}

// DefaultConfig returns the SIEM-03 §4.2 defaults.
func DefaultConfig() Config {
	return Config{
		RootMount:           "pki-siem-root",
		IntermediatePrefix:  "pki-siem-intermediate-",
		LeafTTL:             365 * 24 * time.Hour,
		IntermediateTTL:     5 * 365 * 24 * time.Hour,
		RoleName:            "collector-leaf",
		DefaultDomainSuffix: "collectors.siem.clario360.local",
	}
}

// Manager wraps VaultPKI with caching and per-tenant intermediate
// lazy provisioning.
type Manager struct {
	vault  VaultPKI
	cfg    Config
	logger zerolog.Logger

	mu       sync.Mutex
	ensured  map[uuid.UUID]struct{} // tenants whose intermediate is known to exist
	rootDone bool
}

// New constructs a Manager.
func New(v VaultPKI, cfg Config, logger zerolog.Logger) *Manager {
	if cfg.RootMount == "" {
		cfg = DefaultConfig()
	}
	return &Manager{
		vault:   v,
		cfg:     cfg,
		logger:  logger.With().Str("component", "siem-pki").Logger(),
		ensured: map[uuid.UUID]struct{}{},
	}
}

// EnsureRoot idempotently mounts the root CA. Safe to call multiple
// times; only the first call hits Vault.
func (m *Manager) EnsureRoot(ctx context.Context) error {
	if m == nil || m.vault == nil {
		return errors.New("pki: nil vault")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rootDone {
		return nil
	}
	if err := m.vault.EnsurePKIMount(ctx, m.cfg.RootMount, 10*365*24*time.Hour, 10*365*24*time.Hour); err != nil {
		return fmt.Errorf("pki ensure root mount: %w", err)
	}
	if _, err := m.vault.GenerateRootCA(ctx, m.cfg.RootMount, "Clario360 SIEM Root CA", 10*365*24*time.Hour); err != nil {
		return fmt.Errorf("pki generate root: %w", err)
	}
	m.rootDone = true
	return nil
}

// EnsureTenantIntermediate lazily creates the per-tenant intermediate
// and the leaf-issuing role. Idempotent.
func (m *Manager) EnsureTenantIntermediate(ctx context.Context, tenantID uuid.UUID) (string, error) {
	if m == nil || m.vault == nil {
		return "", errors.New("pki: nil vault")
	}
	if err := m.EnsureRoot(ctx); err != nil {
		return "", err
	}
	m.mu.Lock()
	_, done := m.ensured[tenantID]
	m.mu.Unlock()
	mount := m.intermediateMount(tenantID)
	if done {
		return mount, nil
	}

	if err := m.vault.EnsurePKIMount(ctx, mount, m.cfg.IntermediateTTL, m.cfg.IntermediateTTL); err != nil {
		return "", fmt.Errorf("pki ensure intermediate mount: %w", err)
	}
	if _, err := m.vault.EnsureIntermediate(ctx, m.cfg.RootMount, mount,
		fmt.Sprintf("Clario360 SIEM Intermediate %s", tenantID), m.cfg.IntermediateTTL); err != nil {
		return "", fmt.Errorf("pki ensure intermediate: %w", err)
	}

	roleSettings := PKIRoleSettings{
		AllowedDomains:   []string{m.tenantDomain(tenantID)},
		AllowSubdomains:  true,
		AllowBareDomains: true,
		AllowLocalhost:   false,
		AllowIPSans:      false,
		EnforceHostnames: false,
		KeyType:          "ec",
		KeyBits:          256,
		MaxTTL:           m.cfg.LeafTTL,
		DefaultTTL:       m.cfg.LeafTTL,
		ClientFlag:       true,
		ServerFlag:       false,
	}
	if err := m.vault.EnsurePKIRole(ctx, mount, m.cfg.RoleName, roleSettings); err != nil {
		return "", fmt.Errorf("pki ensure role: %w", err)
	}

	m.mu.Lock()
	m.ensured[tenantID] = struct{}{}
	m.mu.Unlock()
	return mount, nil
}

// IssueLeaf produces a leaf cert from a CSR. Returns the leaf plus
// the SHA-256 thumbprint of the leaf DER.
func (m *Manager) IssueLeaf(ctx context.Context, tenantID, sourceID uuid.UUID, csrPEM string) (LeafCert, string, error) {
	if m == nil || m.vault == nil {
		return LeafCert{}, "", errors.New("pki: nil vault")
	}
	mount, err := m.EnsureTenantIntermediate(ctx, tenantID)
	if err != nil {
		return LeafCert{}, "", err
	}
	leaf, err := m.vault.IssueLeaf(ctx, mount, m.cfg.RoleName, csrPEM, sourceID.String(), m.cfg.LeafTTL)
	if err != nil {
		return LeafCert{}, "", fmt.Errorf("pki issue leaf: %w", err)
	}
	thumb, err := Thumbprint(leaf.CertPEM)
	if err != nil {
		return LeafCert{}, "", fmt.Errorf("pki thumbprint: %w", err)
	}
	return leaf, thumb, nil
}

// Revoke revokes the leaf cert with serial via the tenant
// intermediate.
func (m *Manager) Revoke(ctx context.Context, tenantID uuid.UUID, serial string) error {
	if m == nil || m.vault == nil {
		return errors.New("pki: nil vault")
	}
	mount := m.intermediateMount(tenantID)
	if err := m.vault.RevokeLeaf(ctx, mount, serial); err != nil {
		return fmt.Errorf("pki revoke: %w", err)
	}
	return nil
}

// Thumbprint computes SHA-256 over the DER bytes of the leaf PEM and
// returns the lowercase hex.
func Thumbprint(certPEM string) (string, error) {
	block, _ := pem.Decode([]byte(certPEM))
	if block == nil {
		return "", errors.New("pki: PEM decode failed")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("pki parse cert: %w", err)
	}
	sum := sha256.Sum256(cert.Raw)
	return hex.EncodeToString(sum[:]), nil
}

// ThumbprintDER computes SHA-256 over already-parsed DER bytes.
func ThumbprintDER(der []byte) string {
	sum := sha256.Sum256(der)
	return hex.EncodeToString(sum[:])
}

// ValidateCSR parses and minimally validates a CSR PEM.
func ValidateCSR(csrPEM string) (*x509.CertificateRequest, error) {
	block, _ := pem.Decode([]byte(csrPEM))
	if block == nil {
		return nil, errors.New("pki: CSR PEM decode failed")
	}
	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("pki parse csr: %w", err)
	}
	if err := csr.CheckSignature(); err != nil {
		return nil, fmt.Errorf("pki csr signature: %w", err)
	}
	return csr, nil
}

func (m *Manager) intermediateMount(tenantID uuid.UUID) string {
	return m.cfg.IntermediatePrefix + tenantID.String()
}

func (m *Manager) tenantDomain(tenantID uuid.UUID) string {
	return fmt.Sprintf("collectors.siem.%s.clario360.local", tenantID.String())
}
