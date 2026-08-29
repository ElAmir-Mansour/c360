// Package integrations is the tenant-scoped catalog of external DR
// integrations: hypervisors, storage arrays, cloud vaults, and Kubernetes
// clusters that ClarioDR drives recovery against. Each record stores WHERE an
// external system lives (endpoint) and HOW to authenticate to it (credentials,
// encrypted at rest). The existing DR factories resolve the active integration
// for a (tenant, vendor) at request time via the Resolver; connector adapters
// in other packages test live connectivity via the Connector interface, which
// the cmd/ bridge registers at boot.
//
// This package MUST NOT import internal/dr/storageoffload, internal/dr/vmcapture,
// or internal/dr/cybervault — the bridge imports everything and registers
// connectors, so a dependency the other way would form an import cycle.
package integrations

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Kind is the broad capability class of an integration. It maps 1:1 to the DB
// CHECK constraint on dr_integration.kind.
type Kind string

const (
	// KindHypervisor is a virtualization platform (e.g. vmware_vsphere, libvirt).
	KindHypervisor Kind = "hypervisor"
	// KindStorageArray is a SAN/NAS array (e.g. netapp_ontap, dell_powerstore, nfs).
	KindStorageArray Kind = "storage_array"
	// KindCloudVault is a cloud backup vault (e.g. aws_backup).
	KindCloudVault Kind = "cloud_vault"
	// KindKubernetes is a Kubernetes cluster.
	KindKubernetes Kind = "kubernetes"
)

// Valid reports whether k is one of the known kinds.
func (k Kind) Valid() bool {
	switch k {
	case KindHypervisor, KindStorageArray, KindCloudVault, KindKubernetes:
		return true
	default:
		return false
	}
}

// Status values track the last connectivity-test outcome. They map 1:1 to the
// DB CHECK constraint on dr_integration.status.
const (
	// StatusConfigured means the record was created/updated but not yet tested.
	StatusConfigured = "configured"
	// StatusActive means the most recent TestConnection succeeded.
	StatusActive = "active"
	// StatusError means the most recent TestConnection failed (see LastTestError).
	StatusError = "error"
	// StatusUntested is reserved for records whose credentials changed and that
	// have not been re-tested.
	StatusUntested = "untested"
)

// Integration is the API/DB record for one external integration. Secrets are
// NEVER part of this struct — the encrypted credential bundle lives only in the
// DB column and is opened into a Config solely inside TestConnection and
// ResolveActive.
type Integration struct {
	ID            uuid.UUID  `json:"id"`
	TenantID      uuid.UUID  `json:"tenant_id"`
	Name          string     `json:"name"`
	Kind          Kind       `json:"kind"`
	Vendor        string     `json:"vendor"` // e.g. netapp_ontap, vmware_vsphere, aws_backup, dell_powerstore, nfs, libvirt
	Endpoint      string     `json:"endpoint"`
	Status        string     `json:"status"` // configured | active | error | untested
	Enabled       bool       `json:"enabled"`
	LastTestedAt  *time.Time `json:"last_tested_at,omitempty"`
	LastTestError string     `json:"last_test_error,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// Config is the DECRYPTED credential bundle for an integration. It is NEVER
// serialized to an API response: it is JSON-marshaled then Sealed before insert
// and only Opened+unmarshaled inside TestConnection and ResolveActive.
type Config struct {
	Endpoint  string
	Username  string
	Token     string // bearer token / password / secret-key
	CACertPEM string
	Extra     map[string]string // vendor-specific knobs (e.g. svm, datacenter, region)
}

// Credentials is the API-facing secret bundle a create/update request carries.
// It is encrypted at rest; the Endpoint is taken from the Integration record so
// it is not duplicated here.
type Credentials struct {
	Username  string            `json:"username,omitempty"`
	Token     string            `json:"token,omitempty"`
	CACertPEM string            `json:"ca_cert_pem,omitempty"`
	Extra     map[string]string `json:"extra,omitempty"`
}

// CreateInput is the validated payload to create an integration. Credentials are
// encrypted before the row is inserted.
type CreateInput struct {
	Name        string
	Kind        Kind
	Vendor      string
	Endpoint    string
	Enabled     bool
	Credentials Credentials
}

// UpdateInput is the validated payload to update an integration. Credentials are
// re-encrypted and replace the stored bundle; changing them resets status so the
// integration must be re-tested before ResolveActive will pick it.
type UpdateInput struct {
	Name        string
	Kind        Kind
	Vendor      string
	Endpoint    string
	Enabled     bool
	Credentials Credentials
}

// Connector tests live connectivity for one vendor. Adapters in other packages
// implement it; the cmd/ bridge registers them via Service.RegisterConnector.
type Connector interface {
	// Vendor is the vendor key this connector tests (matches Integration.Vendor).
	Vendor() string
	// Test verifies the supplied decrypted Config can reach the live system. A
	// nil return means the integration is reachable; any error is recorded as the
	// integration's last_test_error.
	Test(ctx context.Context, cfg Config) error
}

// Resolver lets the existing DR factories fetch the decrypted config for the
// active integration of a (tenant, vendor) at request time. *Service implements
// it.
type Resolver interface {
	ResolveActive(ctx context.Context, tenantID uuid.UUID, vendor string) (Integration, Config, error)
}

// toConfig folds an Integration's endpoint and a Credentials bundle into the
// decrypted Config that is sealed at rest.
func (c Credentials) toConfig(endpoint string) Config {
	return Config{
		Endpoint:  endpoint,
		Username:  c.Username,
		Token:     c.Token,
		CACertPEM: c.CACertPEM,
		Extra:     c.Extra,
	}
}

// IsEmpty reports whether the bundle carries no secret material. An update that
// omits credentials (IsEmpty) must preserve the previously stored secret rather
// than overwrite it with an empty Config — otherwise a metadata-only edit (a
// rename or an enable toggle) would silently wipe the stored credentials.
func (c Credentials) IsEmpty() bool {
	return c.Username == "" && c.Token == "" && c.CACertPEM == "" && len(c.Extra) == 0
}
