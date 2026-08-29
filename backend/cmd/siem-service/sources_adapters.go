// SIEM-03 Phase 4 wiring adapters. Phase 3A's vault.Client now exposes
// the PKI method set; Phase 4 reconciles the stand-ins to real
// implementations:
//
//   - vaultPKIAdapter        — real Vault PKI (was noopVaultPKI).
//   - leadership.RedisElection — real Redis-lock leader (was singleLeader).
//   - source lifecycle events — siem-service stays a separate process from
//     notification-service; WS delivery happens via the Kafka CloudEvent bridge
//     that notification-service consumes.
//     See docs/siem/03-sources.md "WS delivery" subsection.
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/observability/health"
	siemproducer "github.com/clario360/platform/internal/siem/producer"
	"github.com/clario360/platform/internal/siem/sources/detector"
	"github.com/clario360/platform/internal/siem/sources/enroll"
	"github.com/clario360/platform/internal/siem/sources/pki"
	"github.com/clario360/platform/internal/vault"
)

// ---------- Vault PKI real adapter ----------
//
// vaultPKIAdapter implements pki.VaultPKI by delegating to a live
// vault.Client. The only logic here is type conversion between
// pki.PKIRoleSettings ↔ vault.PKIRoleSettings and vault.LeafCert →
// pki.LeafCert. The conversion is lossless — both struct sets share the
// same field names (modulo AllowIPSans/AllowIPSANs casing).
type vaultPKIAdapter struct {
	vc     vault.Client
	logger *zerolog.Logger
}

func newVaultPKIAdapter(vc vault.Client, logger *zerolog.Logger) *vaultPKIAdapter {
	return &vaultPKIAdapter{vc: vc, logger: logger}
}

func (a *vaultPKIAdapter) EnsurePKIMount(ctx context.Context, mountPath string, defaultTTL, maxTTL time.Duration) error {
	return a.vc.EnsurePKIMount(ctx, mountPath, defaultTTL, maxTTL)
}

func (a *vaultPKIAdapter) GenerateRootCA(ctx context.Context, mountPath, commonName string, ttl time.Duration) (string, error) {
	return a.vc.GenerateRootCA(ctx, mountPath, commonName, ttl)
}

func (a *vaultPKIAdapter) EnsureIntermediate(ctx context.Context, rootMount, intermediateMount, commonName string, ttl time.Duration) (string, error) {
	return a.vc.EnsureIntermediate(ctx, rootMount, intermediateMount, commonName, ttl)
}

func (a *vaultPKIAdapter) EnsurePKIRole(ctx context.Context, mountPath, roleName string, settings pki.PKIRoleSettings) error {
	return a.vc.EnsurePKIRole(ctx, mountPath, roleName, vault.PKIRoleSettings{
		AllowedDomains:   settings.AllowedDomains,
		AllowSubdomains:  settings.AllowSubdomains,
		AllowBareDomains: settings.AllowBareDomains,
		AllowLocalhost:   settings.AllowLocalhost,
		AllowIPSANs:      settings.AllowIPSans,
		EnforceHostnames: settings.EnforceHostnames,
		KeyType:          settings.KeyType,
		KeyBits:          settings.KeyBits,
		MaxTTL:           settings.MaxTTL,
		DefaultTTL:       settings.DefaultTTL,
		ClientFlag:       settings.ClientFlag,
		ServerFlag:       settings.ServerFlag,
	})
}

func (a *vaultPKIAdapter) IssueLeaf(ctx context.Context, mountPath, roleName, csrPEM, commonName string, ttl time.Duration) (pki.LeafCert, error) {
	leaf, err := a.vc.IssueLeaf(ctx, mountPath, roleName, csrPEM, commonName, ttl)
	if err != nil {
		return pki.LeafCert{}, err
	}
	return pki.LeafCert{
		CertPEM:    leaf.CertPEM,
		CAChainPEM: leaf.CAChainPEM,
		Serial:     leaf.Serial,
		NotBefore:  leaf.NotBefore,
		NotAfter:   leaf.NotAfter,
	}, nil
}

func (a *vaultPKIAdapter) RevokeLeaf(ctx context.Context, mountPath, serial string) error {
	return a.vc.RevokeLeaf(ctx, mountPath, serial)
}

// ---------- Vault PKI unavailable fallback ----------
//
// Used when the vault.Client failed to construct at boot (e.g. VAULT_ADDR
// unset in CI). CRUD on sources still works; IssueLeaf rejects with a clear
// error until Vault is configured.
type noopVaultPKI struct {
	logger *zerolog.Logger
}

func (n noopVaultPKI) EnsurePKIMount(_ context.Context, mountPath string, _, _ time.Duration) error {
	if n.logger != nil {
		n.logger.Debug().Str("mount", mountPath).Msg("noopVaultPKI EnsurePKIMount (vault client unavailable)")
	}
	return nil
}
func (n noopVaultPKI) GenerateRootCA(_ context.Context, _ string, _ string, _ time.Duration) (string, error) {
	return "", nil
}
func (n noopVaultPKI) EnsureIntermediate(_ context.Context, _ string, _ string, _ string, _ time.Duration) (string, error) {
	return "", nil
}
func (n noopVaultPKI) EnsurePKIRole(_ context.Context, _ string, _ string, _ pki.PKIRoleSettings) error {
	return nil
}
func (n noopVaultPKI) IssueLeaf(_ context.Context, _ string, _ string, _ string, _ string, _ time.Duration) (pki.LeafCert, error) {
	return pki.LeafCert{}, errors.New("vault PKI unavailable: vault.Client failed to initialise at boot")
}
func (n noopVaultPKI) RevokeLeaf(_ context.Context, _ string, _ string) error { return nil }

// ---------- Enrollment-token signer ----------

func newEnrollmentSigner(keyName, privateKeyB64, privateKeyPath, environment string, logger *zerolog.Logger) (enroll.Signer, error) {
	privateKeyB64 = strings.TrimSpace(privateKeyB64)
	privateKeyPath = strings.TrimSpace(privateKeyPath)

	if privateKeyB64 != "" && privateKeyPath != "" {
		return nil, errors.New("set only one of SIEM_ENROLL_TOKEN_PRIVATE_KEY_B64 or SIEM_ENROLL_TOKEN_PRIVATE_KEY_PATH")
	}

	source := "env"
	if privateKeyPath != "" {
		keyBytes, err := os.ReadFile(privateKeyPath)
		if err != nil {
			return nil, fmt.Errorf("read SIEM_ENROLL_TOKEN_PRIVATE_KEY_PATH: %w", err)
		}
		privateKeyB64 = strings.TrimSpace(string(keyBytes))
		source = "file"
	}

	if privateKeyB64 != "" {
		priv, err := parseEd25519PrivateKey(privateKeyB64)
		if err != nil {
			return nil, err
		}
		if logger != nil {
			logger.Info().Str("kid", keyName).Str("source", source).Msg("using persistent enrollment-token signer")
		}
		return enroll.NewEd25519Signer(keyName, priv), nil
	}

	if isProdEnvironment(environment) {
		return nil, errors.New("SIEM_ENROLL_TOKEN_PRIVATE_KEY_B64 or SIEM_ENROLL_TOKEN_PRIVATE_KEY_PATH is required when SIEM_ENV=prod")
	}

	return newEphemeralSigner(keyName, logger), nil
}

func parseEd25519PrivateKey(encoded string) (ed25519.PrivateKey, error) {
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(encoded)
	}
	if err != nil {
		return nil, fmt.Errorf("decode SIEM enrollment token private key: %w", err)
	}
	switch len(decoded) {
	case ed25519.SeedSize:
		return ed25519.NewKeyFromSeed(decoded), nil
	case ed25519.PrivateKeySize:
		return ed25519.PrivateKey(decoded), nil
	default:
		return nil, fmt.Errorf("SIEM enrollment token private key must decode to %d-byte seed or %d-byte private key, got %d bytes", ed25519.SeedSize, ed25519.PrivateKeySize, len(decoded))
	}
}

func isProdEnvironment(environment string) bool {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "prod", "production":
		return true
	default:
		return false
	}
}

func newEphemeralSigner(keyName string, logger *zerolog.Logger) *enroll.Ed25519Signer {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic("ed25519 keygen: " + err.Error())
	}
	if logger != nil {
		logger.Warn().Str("kid", keyName).Msg("using ephemeral enrollment-token signer; configure SIEM_ENROLL_TOKEN_PRIVATE_KEY_B64 or SIEM_ENROLL_TOKEN_PRIVATE_KEY_PATH for restart-stable tokens")
	}
	return enroll.NewEd25519Signer(keyName, priv)
}

// ---------- Event emitter ----------
//
// Implements both detector.EventEmitter and enroll.EventEmitter +
// service.EventEmitter — same surface for source / cert events.
type kafkaEmitter struct {
	producer *siemproducer.Producer
	logger   *zerolog.Logger
}

func (k *kafkaEmitter) EmitSourceEvent(ctx context.Context, tenantID, sourceID uuid.UUID, eventType string, payload any) error {
	return k.emit(ctx, tenantID, sourceID, eventType, payload)
}

func (k *kafkaEmitter) EmitCertEvent(ctx context.Context, tenantID, sourceID uuid.UUID, eventType string, payload any) error {
	return k.emit(ctx, tenantID, sourceID, eventType, payload)
}

func (k *kafkaEmitter) emit(ctx context.Context, tenantID, sourceID uuid.UUID, eventType string, payload any) error {
	if k.producer == nil {
		return nil
	}
	// SIEM-04 will route by event type; for now we collapse to a
	// single topic so the producer dispatch is observable. Note: the
	// topic name deliberately avoids the protected "siem.sources"
	// SQL-table prefix so the contract test stays sharp.
	topic := "siem.source_events"
	subjectedPayload := map[string]any{"subject": sourceID.String(), "data": payload}
	if err := k.producer.PublishEvent(ctx, topic, eventType, tenantID.String(), subjectedPayload); err != nil {
		// Producer wraps the underlying error already; we log and
		// return nil so the caller's request doesn't fail just
		// because Kafka is degraded.
		k.logger.Warn().Err(err).Str("event", eventType).Msg("kafka emit failed (best-effort)")
	}
	return nil
}

// ---------- Single-leader fallback ----------
//
// Phase 4 uses leadership.NewRedisElection by default. singleLeader is a
// fallback that's wired only when svc.Redis is nil (e.g. CI test runs).
// Safe ONLY for single-replica deployments.
type singleLeader struct{}

func (singleLeader) IsLeader() bool { return true }

// ---------- Health checker ----------

// leaderProbe is the minimal surface sourcesHealth needs to report the
// leader state. Both *leadership.RedisElection and singleLeader satisfy it.
type leaderProbe interface {
	IsLeader() bool
}

type sourcesHealth struct {
	detector     *detector.Detector
	mtlsCABundle string
	elector      leaderProbe
	mu           sync.Mutex
}

func (s *sourcesHealth) Name() string { return "siem_sources" }

func (s *sourcesHealth) Check(_ context.Context) health.HealthResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	leader := false
	if s.elector != nil {
		leader = s.elector.IsLeader()
	}
	details := map[string]interface{}{
		"detector_present": s.detector != nil,
		"leader":           leader,
	}
	if s.mtlsCABundle == "" {
		details["mtls_listener"] = "skipped (no CA bundle path configured)"
		return health.HealthResult{Status: "degraded", Details: details}
	}
	if _, err := os.Stat(s.mtlsCABundle); err != nil {
		details["mtls_listener"] = "skipped (CA bundle unreadable: " + err.Error() + ")"
		return health.HealthResult{Status: "degraded", Details: details}
	}
	details["mtls_listener"] = "ready"
	return health.HealthResult{Status: "healthy", Details: details}
}
