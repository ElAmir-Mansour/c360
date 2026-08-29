package store

import (
	"time"

	"github.com/clario360/platform/internal/siem/store/crypto"
	"github.com/clario360/platform/internal/siem/store/minio"
	"github.com/clario360/platform/internal/siem/store/opensearch"
)

// Config bundles the runtime config for the Store and its subpackages.
// It is meant to be assembled from the SIEM-02 environment variables.
type Config struct {
	OpenSearch       opensearch.Config
	MinIO            minio.Config
	DEK              crypto.DEKManagerConfig
	SelfTestEnabled  bool
	SelfTestEndpoint string // path of the admin self-test endpoint; default /_meta/self-test
	// Environment is "dev" or "prod"; used by Validate to enforce stricter
	// invariants in prod (e.g. InsecureTLS rejected).
	Environment string
	// SelfTestTimeout bounds Store.SelfTest end-to-end. Defaults to 30s.
	SelfTestTimeout time.Duration
}

// Option mutates a Store at construction time. The functional-options
// pattern keeps New(...) simple while still allowing tests to inject
// alternate implementations.
type Option func(*Store)

// WithConfig sets the Store's Config.
func WithConfig(cfg Config) Option { return func(s *Store) { s.cfg = cfg } }

// WithOpenSearch overrides the OpenSearch client. Tests inject a stub.
func WithOpenSearch(c opensearch.Client) Option { return func(s *Store) { s.OS = c } }

// WithMinIO overrides the MinIO client. Tests inject a stub.
func WithMinIO(c minio.Client) Option { return func(s *Store) { s.Object = c } }

// WithFieldCrypto overrides the FieldCrypto implementation.
func WithFieldCrypto(fc crypto.FieldCrypto) Option { return func(s *Store) { s.Crypto = fc } }

// WithDEKManager overrides the DEK manager.
func WithDEKManager(d crypto.DEKManager) Option { return func(s *Store) { s.DEK = d } }

// WithPIIRegistry overrides the PII registry.
func WithPIIRegistry(p crypto.PIIRegistry) Option { return func(s *Store) { s.PII = p } }
