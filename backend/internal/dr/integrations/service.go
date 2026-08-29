package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// TenantRunner runs read/write functions against the tenant-scoped DB so RLS
// sees app.current_tenant_id, exactly as internal/dr/storageoffload uses it. The
// DR service's pgxTenantRunner satisfies it (same uuid.UUID signature).
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// catalogStore is the persistence surface the service drives (satisfied by
// *Store; an interface so the service is unit-testable without a database).
type catalogStore interface {
	Create(ctx context.Context, db repository.DBTX, rec *record) error
	Get(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID) (*record, error)
	List(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]*record, error)
	ResolveActive(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, vendor string) (*record, error)
	Update(ctx context.Context, db repository.DBTX, rec *record) error
	Delete(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID) error
	UpdateTestResult(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID, status, testErr string, testedAt time.Time) (*record, error)
}

// ServiceConfig wires the integrations catalog service.
type ServiceConfig struct {
	Runner  TenantRunner
	Store   *Store
	Cipher  Cipher
	Metrics *Metrics
	Logger  zerolog.Logger
	// Audit records credential-access events (every decryption). A nil Audit is a
	// safe no-op; the cmd/ bridge supplies an outbox-backed sink in production.
	Audit AuditSink
}

// Service is the tenant-scoped catalog of external DR integrations. It encrypts
// credentials on write, decrypts them only to test connectivity or resolve the
// active integration for a vendor, and never returns secrets over the API.
type Service struct {
	runner     TenantRunner
	store      catalogStore
	cipher     Cipher
	metrics    *Metrics
	logger     zerolog.Logger
	connectors *connectorRegistry
	audit      AuditSink
	now        func() time.Time
}

// NewService constructs the catalog service. Runner, Store, and Cipher are
// required; a nil Metrics is a safe no-op.
func NewService(cfg ServiceConfig) (*Service, error) {
	if cfg.Runner == nil {
		return nil, errors.New("integrations service: tenant runner is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("integrations service: store is required")
	}
	if cfg.Cipher == nil {
		return nil, errors.New("integrations service: cipher is required")
	}
	audit := cfg.Audit
	if audit == nil {
		audit = noopAuditSink{}
	}
	return &Service{
		runner:     cfg.Runner,
		store:      cfg.Store,
		cipher:     cfg.Cipher,
		metrics:    cfg.Metrics,
		logger:     cfg.Logger.With().Str("component", "dr_integrations").Logger(),
		connectors: newConnectorRegistry(),
		audit:      audit,
		now:        func() time.Time { return time.Now().UTC() },
	}, nil
}

// RegisterConnector registers a vendor connector for TestConnection /
// ResolveActive. The cmd/ bridge calls this at boot for each adapter.
func (s *Service) RegisterConnector(c Connector) {
	s.connectors.register(c)
}

// canonicalVendors maps every vendor ClarioDR can drive to the kind it belongs
// to. An integration's declared kind MUST match this map. Validating against it
// turns an incoherent (kind, vendor) pair — e.g. kind=kubernetes with
// vendor=netapp_ontap — into a clear 400 at create/update time instead of a
// confusing ErrConnectorMissing 409 at TestConnection time. A vendor not in this
// map is rejected: the catalog only stores vendors ClarioDR has an adapter
// contract for. Keys are the canonical lowercase labels; Create/Update normalise
// the stored Vendor to this form so connector lookup and ResolveActive match.
var canonicalVendors = map[string]Kind{
	"vmware_vsphere":  KindHypervisor,
	"vmware_cbt":      KindHypervisor,
	"libvirt":         KindHypervisor,
	"netapp_ontap":    KindStorageArray,
	"dell_powerstore": KindStorageArray,
	"nfs":             KindStorageArray,
	"aws_backup":      KindCloudVault,
	"azure_backup":    KindCloudVault,
	"gcp_backup_dr":   KindCloudVault,
	"kubernetes":      KindKubernetes,
}

// normalizeVendor lowercases and trims a vendor label to its canonical form so a
// stored Vendor always matches a connector key and a ResolveActive lookup.
func normalizeVendor(vendor string) string {
	return strings.ToLower(strings.TrimSpace(vendor))
}

// vendorKind returns the kind a canonical vendor belongs to and whether the
// vendor is recognised at all.
func vendorKind(vendor string) (Kind, bool) {
	k, ok := canonicalVendors[normalizeVendor(vendor)]
	return k, ok
}

// vendorsRequiringEndpoint lists the vendors for which an endpoint is mandatory.
// Local/file-style vendors (nfs, libvirt) may legitimately have none.
func vendorRequiresEndpoint(vendor string) bool {
	switch strings.ToLower(strings.TrimSpace(vendor)) {
	case "nfs", "libvirt", "file":
		return false
	default:
		return true
	}
}

// validate checks the shared create/update fields.
func validate(name string, kind Kind, vendor, endpoint string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("%w: name is required", ErrValidation)
	}
	if !kind.Valid() {
		return fmt.Errorf("%w: kind %q is not one of hypervisor|storage_array|cloud_vault|kubernetes", ErrValidation, kind)
	}
	if strings.TrimSpace(vendor) == "" {
		return fmt.Errorf("%w: vendor is required", ErrValidation)
	}
	wantKind, known := vendorKind(vendor)
	if !known {
		return fmt.Errorf("%w: vendor %q is not a recognised ClarioDR integration vendor", ErrValidation, vendor)
	}
	if wantKind != kind {
		return fmt.Errorf("%w: vendor %q is a %s integration, not %s", ErrValidation, normalizeVendor(vendor), wantKind, kind)
	}
	if strings.TrimSpace(endpoint) == "" && vendorRequiresEndpoint(vendor) {
		return fmt.Errorf("%w: endpoint is required for vendor %q", ErrValidation, vendor)
	}
	return nil
}

// sealCredentials JSON-marshals a Config and seals it for storage. The plaintext
// is never retained.
func (s *Service) sealCredentials(cfg Config) ([]byte, error) {
	plaintext, err := json.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("integrations: marshaling credentials: %w", err)
	}
	sealed, err := s.cipher.Seal(plaintext)
	if err != nil {
		return nil, err
	}
	return sealed, nil
}

// openCredentials opens and unmarshals a sealed credential bundle into a Config.
func (s *Service) openCredentials(sealed []byte) (Config, error) {
	plaintext, err := s.cipher.Open(sealed)
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(plaintext, &cfg); err != nil {
		return Config{}, fmt.Errorf("integrations: unmarshaling credentials: %w", err)
	}
	return cfg, nil
}

// Create validates the input, encrypts the credentials, and inserts the
// integration. The returned Integration carries no secrets.
func (s *Service) Create(ctx context.Context, tenantID uuid.UUID, in CreateInput) (Integration, error) {
	if err := validate(in.Name, in.Kind, in.Vendor, in.Endpoint); err != nil {
		return Integration{}, err
	}
	sealed, err := s.sealCredentials(in.Credentials.toConfig(in.Endpoint))
	if err != nil {
		return Integration{}, err
	}
	rec := &record{
		Integration: Integration{
			TenantID: tenantID,
			Name:     strings.TrimSpace(in.Name),
			Kind:     in.Kind,
			Vendor:   normalizeVendor(in.Vendor),
			Endpoint: in.Endpoint,
			Status:   StatusConfigured,
			Enabled:  in.Enabled,
		},
		EncryptedCredentials: sealed,
	}
	if err := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		return s.store.Create(ctx, db, rec)
	}); err != nil {
		return Integration{}, err
	}
	s.logger.Info().Str("integration_id", rec.ID.String()).Str("vendor", rec.Vendor).
		Str("kind", string(rec.Kind)).Msg("integration created")
	return rec.Integration, nil
}

// Get loads an integration within the tenant. Secrets are not returned.
func (s *Service) Get(ctx context.Context, tenantID, id uuid.UUID) (Integration, error) {
	var rec *record
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var gerr error
		rec, gerr = s.store.Get(ctx, db, tenantID, id)
		return gerr
	})
	if err != nil {
		return Integration{}, err
	}
	return rec.Integration, nil
}

// List returns every integration for the tenant. Secrets are not returned.
func (s *Service) List(ctx context.Context, tenantID uuid.UUID) ([]Integration, error) {
	var recs []*record
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var lerr error
		recs, lerr = s.store.List(ctx, db, tenantID)
		return lerr
	})
	if err != nil {
		return nil, err
	}
	out := make([]Integration, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.Integration)
	}
	return out, nil
}

// Update validates the input and replaces the integration's mutable fields. When
// the input carries credentials they are re-encrypted; when it OMITS them
// (IsEmpty) the previously stored secret is preserved, so a metadata-only edit
// (rename, enable toggle) cannot silently wipe it. The test status is reset to
// configured — forcing a re-test before ResolveActive picks the record — only
// when the secret or the connectivity target (endpoint/vendor) actually changes;
// a pure metadata edit keeps the prior test status.
func (s *Service) Update(ctx context.Context, tenantID, id uuid.UUID, in UpdateInput) (Integration, error) {
	if err := validate(in.Name, in.Kind, in.Vendor, in.Endpoint); err != nil {
		return Integration{}, err
	}
	vendor := normalizeVendor(in.Vendor)
	var out Integration
	if err := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		existing, gerr := s.store.Get(ctx, db, tenantID, id)
		if gerr != nil {
			return gerr
		}

		// Preserve the stored secret on a metadata-only edit; only re-seal when
		// the operator actually supplied a new credential bundle.
		sealed := existing.EncryptedCredentials
		credsChanged := false
		if !in.Credentials.IsEmpty() {
			resealed, serr := s.sealCredentials(in.Credentials.toConfig(in.Endpoint))
			if serr != nil {
				return serr
			}
			sealed = resealed
			credsChanged = true
		}

		status := existing.Status
		if credsChanged || in.Endpoint != existing.Endpoint || vendor != existing.Vendor {
			status = StatusConfigured
		}

		rec := &record{
			Integration: Integration{
				TenantID: tenantID,
				ID:       id,
				Name:     strings.TrimSpace(in.Name),
				Kind:     in.Kind,
				Vendor:   vendor,
				Endpoint: in.Endpoint,
				Status:   status,
				Enabled:  in.Enabled,
			},
			EncryptedCredentials: sealed,
		}
		if uerr := s.store.Update(ctx, db, rec); uerr != nil {
			return uerr
		}
		out = rec.Integration
		return nil
	}); err != nil {
		return Integration{}, err
	}
	s.logger.Info().Str("integration_id", id.String()).Str("vendor", out.Vendor).Msg("integration updated")
	return out, nil
}

// Delete removes an integration within the tenant.
func (s *Service) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	return s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		return s.store.Delete(ctx, db, tenantID, id)
	})
}

// TestConnection decrypts the integration's credentials, runs the registered
// connector for its vendor, and persists the outcome: status active + cleared
// error on success, status error + the failure text otherwise, with
// last_tested_at stamped either way. ErrConnectorMissing is returned (and NOT
// persisted as an integration error) when no connector is registered for the
// vendor — that is an operator/deployment gap, not an integration failure.
func (s *Service) TestConnection(ctx context.Context, tenantID, id uuid.UUID) (Integration, error) {
	var rec *record
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var gerr error
		rec, gerr = s.store.Get(ctx, db, tenantID, id)
		return gerr
	}); err != nil {
		return Integration{}, err
	}

	connector, ok := s.connectors.lookup(rec.Vendor)
	if !ok {
		return Integration{}, fmt.Errorf("%w: %q", ErrConnectorMissing, rec.Vendor)
	}

	cfg, err := s.openCredentials(rec.EncryptedCredentials)
	if err != nil {
		return Integration{}, err
	}
	s.audit.CredentialAccessed(ctx, CredentialAccessEvent{
		TenantID:      tenantID,
		IntegrationID: rec.ID,
		Vendor:        rec.Vendor,
		Kind:          rec.Kind,
		Reason:        CredentialAccessTest,
	})

	testErr := connector.Test(ctx, cfg)
	status := StatusActive
	errText := ""
	if testErr != nil {
		status = StatusError
		errText = testErr.Error()
	}
	s.metrics.IncTest(rec.Vendor, testErr == nil)

	var updated *record
	if err := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var uerr error
		updated, uerr = s.store.UpdateTestResult(ctx, db, tenantID, id, status, errText, s.now())
		return uerr
	}); err != nil {
		return Integration{}, err
	}

	if testErr != nil {
		s.logger.Warn().Str("integration_id", id.String()).Str("vendor", rec.Vendor).
			Err(testErr).Msg("integration connectivity test failed")
	} else {
		s.logger.Info().Str("integration_id", id.String()).Str("vendor", rec.Vendor).
			Msg("integration connectivity test passed")
	}
	return updated.Integration, nil
}

// ResolveActive returns the newest enabled+active integration for a (tenant,
// vendor) together with its decrypted Config, for the DR factories at request
// time. It returns ErrNotFound when none qualifies. This is the only path beside
// TestConnection that opens credentials.
func (s *Service) ResolveActive(ctx context.Context, tenantID uuid.UUID, vendor string) (Integration, Config, error) {
	var rec *record
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var gerr error
		rec, gerr = s.store.ResolveActive(ctx, db, tenantID, vendor)
		return gerr
	}); err != nil {
		return Integration{}, Config{}, err
	}
	cfg, err := s.openCredentials(rec.EncryptedCredentials)
	if err != nil {
		return Integration{}, Config{}, err
	}
	s.audit.CredentialAccessed(ctx, CredentialAccessEvent{
		TenantID:      tenantID,
		IntegrationID: rec.ID,
		Vendor:        rec.Vendor,
		Kind:          rec.Kind,
		Reason:        CredentialAccessResolve,
	})
	return rec.Integration, cfg, nil
}

var _ Resolver = (*Service)(nil)
