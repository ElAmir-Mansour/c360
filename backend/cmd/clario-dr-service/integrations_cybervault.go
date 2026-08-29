package main

// integrations_cybervault.go closes the loop between the integrations catalog and
// the cyber-vault posture source: when an operator has registered+tested a
// cloud_vault integration (aws_backup / azure_backup / gcp_backup_dr), the
// cybervault service refreshes live posture from the cloud-backup posture GATEWAY
// whose URL/credentials come from that tenant's active integration.
//
// This wiring is GATED behind DR_CYBERVAULT_USE_INTEGRATIONS=true (see
// sovereign.go) because attaching a PostureSource changes EvaluateVault to refresh
// from the source on every evaluation. With the opt-in set, a tenant that evaluates
// a vault must have an active cloud_vault integration; without an active
// integration the refresh reports the source unavailable (ErrSourceUnavailable),
// the same signal the cybervault router already maps. Operators who register vault
// posture manually/by API should leave the opt-in off (the default), in which case
// no source is attached and stored posture is scored directly.

import (
	"context"
	"errors"
	"sync"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/cybervault"
	"github.com/clario360/platform/internal/dr/integrations"
)

// cloudVaultVendors are the integration vendor labels a cloud_vault integration
// may carry; the posture source resolves the first one active for the tenant. All
// three are backed by the same normalised cloud-backup gateway contract, so the
// concrete posture HTTP source is identical regardless of which provider is active.
var cloudVaultVendors = []string{
	string(cybervault.VaultProviderAWSBackup),
	string(cybervault.VaultProviderAzureBackup),
	string(cybervault.VaultProviderGCPBackupDR),
}

// resolverPostureSource is a cybervault.PostureSource that builds the concrete
// HTTPPostureSource from the tenant's active cloud_vault integration at request
// time. The built source is cached per tenant so repeated evaluations do not
// re-resolve+re-decrypt the gateway credentials. Safe for concurrent use.
type resolverPostureSource struct {
	resolver integrations.Resolver
	logger   zerolog.Logger

	mu      sync.Mutex
	sources map[uuid.UUID]*cybervault.HTTPPostureSource // by tenant
}

// newResolverPostureSource builds a resolver-backed posture source.
func newResolverPostureSource(resolver integrations.Resolver, logger zerolog.Logger) *resolverPostureSource {
	return &resolverPostureSource{
		resolver: resolver,
		logger:   logger.With().Str("component", "dr_cybervault_integration_source").Logger(),
		sources:  make(map[uuid.UUID]*cybervault.HTTPPostureSource),
	}
}

// GetVaultPosture refreshes one vault's posture from the tenant's active
// cloud_vault gateway. It resolves the first active cloud_vault vendor, builds (and
// caches) the HTTP posture source from the decrypted gateway URL + token + CA, and
// delegates. With no active cloud_vault integration it reports ErrSourceUnavailable.
func (s *resolverPostureSource) GetVaultPosture(ctx context.Context, tenantID, vaultID uuid.UUID) (cybervault.VaultPosture, error) {
	src, err := s.sourceFor(ctx, tenantID)
	if err != nil {
		return cybervault.VaultPosture{}, err
	}
	return src.GetVaultPosture(ctx, tenantID, vaultID)
}

// sourceFor resolves (and caches) the per-tenant HTTPPostureSource from the active
// cloud_vault integration. It tries each cloud_vault vendor in turn and uses the
// first active one. When none is active it returns ErrSourceUnavailable so the
// cybervault router surfaces a clear "no live posture source" error rather than a
// generic failure.
func (s *resolverPostureSource) sourceFor(ctx context.Context, tenantID uuid.UUID) (*cybervault.HTTPPostureSource, error) {
	s.mu.Lock()
	if cached, ok := s.sources[tenantID]; ok {
		s.mu.Unlock()
		return cached, nil
	}
	s.mu.Unlock()

	var (
		cfg   integrations.Config
		found bool
	)
	for _, vendor := range cloudVaultVendors {
		_, c, err := s.resolver.ResolveActive(ctx, tenantID, vendor)
		if err != nil {
			if errors.Is(err, integrations.ErrNotFound) {
				continue
			}
			return nil, err
		}
		cfg = c
		found = true
		break
	}
	if !found {
		return nil, cybervault.ErrSourceUnavailable
	}

	src, err := cybervault.NewHTTPPostureSourceFromConfig(cybervault.CloudGatewayConfig{
		BaseURL:   cfg.Endpoint,
		Token:     cfg.Token,
		CACertPEM: cfg.CACertPEM,
	})
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.sources[tenantID] = src
	s.mu.Unlock()
	return src, nil
}

// Compile-time assertion that the resolver-backed source satisfies the cybervault
// PostureSource contract the service consumes.
var _ cybervault.PostureSource = (*resolverPostureSource)(nil)
