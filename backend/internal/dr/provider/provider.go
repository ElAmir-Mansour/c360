// Package provider defines recovery-provider adapters for ClarioDR.
//
// The package is intentionally SDK-neutral: concrete vSphere, Kubernetes,
// cloud, and storage integrations can implement the narrow Adapter interface
// without leaking vendor clients into the recovery executor.
package provider

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
)

const (
	KindVerify     = "verify"
	KindCustom     = "custom"
	KindVSphere    = "vsphere"
	KindKubernetes = "kubernetes"
	KindCloud      = "cloud"
	KindNetApp     = "netapp"
	KindFake       = "fake"
)

var (
	// ErrNotConfigured means an adapter cannot safely perform recovery because a
	// required endpoint, credential reference, or live client is absent.
	ErrNotConfigured = errors.New("dr provider not configured")
	// ErrRegulatedIncompatible marks a driver/provider that must not be used for
	// regulated recovery mode.
	ErrRegulatedIncompatible = errors.New("dr recovery driver is not regulated-compatible")
)

// Capabilities is the exported compatibility signal for recovery drivers.
type Capabilities struct {
	Kind                string   `json:"kind"`
	DisplayName         string   `json:"display_name"`
	Live                bool     `json:"live"`
	SDKBacked           bool     `json:"sdk_backed"`
	SupportsEnsure      bool     `json:"supports_ensure"`
	SupportsTeardown    bool     `json:"supports_teardown"`
	SupportsDrill       bool     `json:"supports_drill"`
	SupportsIdempotency bool     `json:"supports_idempotency"`
	RegulatedCompatible bool     `json:"regulated_compatible"`
	RequiredConfig      []string `json:"required_config,omitempty"`
	Notes               []string `json:"notes,omitempty"`
}

// Adapter performs provider-native recovery operations.
type Adapter interface {
	Capabilities() Capabilities
	Validate(Config) error
	Ensure(context.Context, EnsureRequest) (EnsureResult, error)
	Teardown(context.Context, TeardownRequest) error
}

// Config is the provider configuration parsed by clario-dr-service.
//
// The transit-hardening fields (CABundlePEM / ClientCertPEM / ClientKeyPEM /
// SigningKeyPEM) all carry PEM CONTENT, never file paths — consistent with the
// rest of the DR key-custody surface (rehearsal-proof signing key, BYOK root
// key). They configure the outbound provider-gateway TLS pin, optional mTLS
// client identity, and the detached request-envelope signer (Wave 3 vendor
// transit hardening). Empty values are permitted outside the regulated profile;
// the regulated ValidateRuntime gate fails closed when they are absent.
type Config struct {
	Kind          string            `json:"kind,omitempty"`
	Endpoint      string            `json:"endpoint,omitempty"`
	CredentialRef string            `json:"credential_ref,omitempty"`
	Region        string            `json:"region,omitempty"`
	Project       string            `json:"project,omitempty"`
	Cluster       string            `json:"cluster,omitempty"`
	Datacenter    string            `json:"datacenter,omitempty"`
	ResourceGroup string            `json:"resource_group,omitempty"`
	StorageVM     string            `json:"storage_vm,omitempty"`
	Settings      map[string]string `json:"settings,omitempty"`

	// --- Vendor transit hardening (Wave 3) --------------------------------
	// CABundlePEM is the PEM CONTENT of the CA bundle used to PIN the provider
	// gateway's server certificate. When set, the outbound client trusts ONLY
	// these roots (RootCAs), never the system pool, so a mis-issued/self-signed
	// gateway cert is rejected. Malformed PEM fails construction.
	CABundlePEM string `json:"ca_bundle_pem,omitempty"`
	// ClientCertPEM / ClientKeyPEM are the PEM CONTENT of an optional mTLS
	// client identity presented to the gateway. Both must be set together
	// (X509KeyPair); one without the other fails construction/validation.
	ClientCertPEM string `json:"client_cert_pem,omitempty"`
	ClientKeyPEM  string `json:"client_key_pem,omitempty"`
	// MinTLSVersion is the minimum negotiated TLS version ("1.2" or "1.3").
	// Empty defaults to 1.2. It can never fall below 1.2.
	MinTLSVersion string `json:"min_tls_version,omitempty"`
	// SigningKeyPEM is the PEM CONTENT of the private key (Ed25519 preferred;
	// RSA/ECDSA accepted) that signs the canonical outbound request envelope
	// with a DETACHED signature. When set, every request carries an
	// X-Clario-Signature header a gateway/receiver can verify. Malformed PEM
	// fails construction.
	SigningKeyPEM string `json:"signing_key_pem,omitempty"`
	// SigningKeyID is the key-id advertised in X-Clario-Signature-KeyId so a
	// receiver can select the right verification key. Optional.
	SigningKeyID string `json:"signing_key_id,omitempty"`
}

// EnsureRequest is the provider-neutral description of one workload recovery.
type EnsureRequest struct {
	IdempotencyKey         string            `json:"idempotency_key"`
	TenantID               string            `json:"tenant_id"`
	GroupID                string            `json:"group_id"`
	SiteID                 string            `json:"site_id"`
	StreamID               string            `json:"stream_id"`
	RecoveryEndpoint       string            `json:"recovery_endpoint,omitempty"`
	ObjectKey              string            `json:"object_key,omitempty"`
	Plaintext              []byte            `json:"plaintext,omitempty"`
	InstantSessionID       string            `json:"instant_session_id,omitempty"`
	InstantOverlayLocation string            `json:"instant_overlay_location,omitempty"`
	InstantChunkSize       int               `json:"instant_chunk_size,omitempty"`
	InstantChunksTotal     int               `json:"instant_chunks_total,omitempty"`
	Profile                string            `json:"profile,omitempty"`
	PrimaryToRecovery      map[string]string `json:"primary_to_recovery,omitempty"`
	Drill                  bool              `json:"drill"`
}

// EnsureResult identifies the provider resource created or found by Ensure.
type EnsureResult struct {
	ExternalID string            `json:"external_id"`
	Already    bool              `json:"already"`
	Metadata   map[string]string `json:"metadata,omitempty"`
}

// TeardownRequest identifies one provider resource to discard.
type TeardownRequest struct {
	ExternalID string `json:"external_id"`
	EnsureRequest
}

// ValidateRegulated rejects drivers that are explicitly marked incompatible.
func ValidateRegulated(c Capabilities) error {
	if c.RegulatedCompatible {
		return nil
	}
	if c.Kind == "" {
		return fmt.Errorf("%w: unnamed recovery driver", ErrRegulatedIncompatible)
	}
	return fmt.Errorf("%w: %s", ErrRegulatedIncompatible, c.Kind)
}

func missingRequired(cfg Config, fields ...string) error {
	var missing []string
	for _, field := range fields {
		switch field {
		case "endpoint":
			if strings.TrimSpace(cfg.Endpoint) == "" {
				missing = append(missing, field)
			}
		case "credential_ref":
			if strings.TrimSpace(cfg.CredentialRef) == "" {
				missing = append(missing, field)
			}
		case "region":
			if strings.TrimSpace(cfg.Region) == "" {
				missing = append(missing, field)
			}
		case "project":
			if strings.TrimSpace(cfg.Project) == "" {
				missing = append(missing, field)
			}
		case "cluster":
			if strings.TrimSpace(cfg.Cluster) == "" {
				missing = append(missing, field)
			}
		case "datacenter":
			if strings.TrimSpace(cfg.Datacenter) == "" {
				missing = append(missing, field)
			}
		case "resource_group":
			if strings.TrimSpace(cfg.ResourceGroup) == "" {
				missing = append(missing, field)
			}
		case "storage_vm":
			if strings.TrimSpace(cfg.StorageVM) == "" {
				missing = append(missing, field)
			}
		default:
			if cfg.Settings == nil || strings.TrimSpace(cfg.Settings[field]) == "" {
				missing = append(missing, field)
			}
		}
	}
	if len(missing) == 0 {
		return nil
	}
	sort.Strings(missing)
	return fmt.Errorf("%w: missing %s", ErrNotConfigured, strings.Join(missing, ", "))
}
