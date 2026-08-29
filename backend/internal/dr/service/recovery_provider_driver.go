package service

import (
	"context"
	"fmt"

	drprovider "github.com/clario360/platform/internal/dr/provider"
)

// RecoveryTargetDriverCapabilityProvider is implemented by drivers that expose
// regulated-mode compatibility metadata.
type RecoveryTargetDriverCapabilityProvider interface {
	RecoveryCapabilities() drprovider.Capabilities
}

// RecoveryCapabilities returns the exported compatibility metadata for a driver.
func RecoveryCapabilities(driver RecoveryTargetDriver) drprovider.Capabilities {
	if provider, ok := driver.(RecoveryTargetDriverCapabilityProvider); ok {
		return provider.RecoveryCapabilities()
	}
	return drprovider.Capabilities{
		Kind:                "unknown",
		DisplayName:         "Unknown recovery driver",
		SupportsEnsure:      true,
		SupportsTeardown:    true,
		SupportsIdempotency: true,
		RegulatedCompatible: false,
	}
}

// ValidateRecoveryDriverCompatibility rejects non-regulated-compatible drivers
// when the caller opts into regulated/provider mode.
func ValidateRecoveryDriverCompatibility(driver RecoveryTargetDriver, regulated bool) error {
	if !regulated {
		return nil
	}
	return drprovider.ValidateRegulated(RecoveryCapabilities(driver))
}

// ProviderRecoveryTargetDriver adapts a provider.Adapter to the executor's
// RecoveryTargetDriver interface.
type ProviderRecoveryTargetDriver struct {
	adapter drprovider.Adapter
}

func NewProviderRecoveryTargetDriver(adapter drprovider.Adapter) (*ProviderRecoveryTargetDriver, error) {
	if adapter == nil {
		return nil, fmt.Errorf("%w: provider adapter is nil", drprovider.ErrNotConfigured)
	}
	return &ProviderRecoveryTargetDriver{adapter: adapter}, nil
}

func (d *ProviderRecoveryTargetDriver) RecoveryCapabilities() drprovider.Capabilities {
	return d.adapter.Capabilities()
}

func (d *ProviderRecoveryTargetDriver) Ensure(ctx context.Context, rc RestoreContext) (string, error) {
	result, err := d.adapter.Ensure(ctx, providerEnsureRequest(rc))
	if err != nil {
		return "", err
	}
	if result.ExternalID == "" {
		return "", fmt.Errorf("%w: provider ensure returned empty external id", drprovider.ErrNotConfigured)
	}
	return result.ExternalID, nil
}

func (d *ProviderRecoveryTargetDriver) Teardown(ctx context.Context, externalID string, rc RestoreContext) error {
	return d.adapter.Teardown(ctx, drprovider.TeardownRequest{
		ExternalID:    externalID,
		EnsureRequest: providerEnsureRequest(rc),
	})
}

func providerEnsureRequest(rc RestoreContext) drprovider.EnsureRequest {
	return drprovider.EnsureRequest{
		IdempotencyKey:         rc.IdempotencyKey,
		TenantID:               rc.TenantID.String(),
		GroupID:                rc.GroupID,
		SiteID:                 rc.SiteID,
		StreamID:               rc.StreamID,
		RecoveryEndpoint:       rc.RecoveryEndpoint,
		ObjectKey:              rc.ObjectKey,
		Plaintext:              append([]byte(nil), rc.Plaintext...),
		InstantSessionID:       rc.InstantSessionID,
		InstantOverlayLocation: rc.InstantOverlayLocation,
		InstantChunkSize:       rc.InstantChunkSize,
		InstantChunksTotal:     rc.InstantChunksTotal,
		Profile:                rc.Profile,
		PrimaryToRecovery:      copyStringMap(rc.PrimaryToRecovery),
		Drill:                  rc.Drill,
	}
}

func copyStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
