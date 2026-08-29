package cybervault

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// RegisteredVault is the provider-neutral inventory row fed into cybervault
// posture evaluation. Provider integrations should keep ExternalID stable so
// upserts remain idempotent across name changes.
type RegisteredVault struct {
	ID         string        `json:"id,omitempty"`
	TenantID   string        `json:"tenant_id,omitempty"`
	GroupID    string        `json:"group_id,omitempty"`
	Provider   VaultProvider `json:"provider"`
	Name       string        `json:"name"`
	ExternalID string        `json:"external_id,omitempty"`
	Posture    VaultPosture  `json:"posture"`
	CreatedAt  time.Time     `json:"created_at,omitempty"`
	UpdatedAt  time.Time     `json:"updated_at,omitempty"`
}

// VaultRecord is kept as a short alias for call sites that model the persisted
// inventory row rather than the provider-registration event.
type VaultRecord = RegisteredVault

// StaticPostureSource is an in-memory PostureSource for tests, demos, and
// manual configuration.
type StaticPostureSource struct {
	Vaults []RegisteredVault
}

// NewStaticPostureSource constructs a StaticPostureSource from the given vaults.
func NewStaticPostureSource(vaults []RegisteredVault) StaticPostureSource {
	cp := make([]RegisteredVault, len(vaults))
	copy(cp, vaults)
	return StaticPostureSource{Vaults: cp}
}

// GetVaultPosture returns one matching posture by tenant/vault UUID.
func (s StaticPostureSource) GetVaultPosture(_ context.Context, tenantID, vaultID uuid.UUID) (VaultPosture, error) {
	for _, v := range s.Vaults {
		normaliseVaultRecord(&v)
		if v.TenantID != "" && v.TenantID != tenantID.String() {
			continue
		}
		if v.Posture.ID == vaultID.String() || v.ID == vaultID.String() || v.ExternalID == vaultID.String() {
			return v.Posture, nil
		}
	}
	return VaultPosture{}, fmt.Errorf("vault %s: %w", vaultID, ErrVaultNotFound)
}

// ListRegisteredVaults returns matching inventory records. Empty tenantID or
// groupID acts as a wildcard so small tests can omit scoping when it is not
// under test.
func (s StaticPostureSource) ListRegisteredVaults(_ context.Context, tenantID, groupID string) ([]RegisteredVault, error) {
	out := make([]RegisteredVault, 0, len(s.Vaults))
	for _, v := range s.Vaults {
		if tenantID != "" && v.TenantID != "" && v.TenantID != tenantID {
			continue
		}
		if groupID != "" && v.GroupID != "" && v.GroupID != groupID {
			continue
		}
		normaliseVaultRecord(&v)
		out = append(out, v)
	}
	return out, nil
}

func normaliseVaultRecord(v *RegisteredVault) {
	if v.Posture.ID == "" {
		v.Posture.ID = firstNonEmpty(v.ID, v.ExternalID)
	}
	if v.Posture.Name == "" {
		v.Posture.Name = v.Name
	}
	if v.Posture.Provider == "" {
		v.Posture.Provider = v.Provider
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
