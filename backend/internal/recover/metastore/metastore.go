package metastore

import (
	"context"

	"github.com/google/uuid"
)

// MetastoreClient is the stable seam (RECOVER §3.4) that resolves an
// application's recovery-relevant metadata for Clario Recover. It is the
// interface the dedicated Metastore product will later implement to swap the
// default registry; everything in Recover that needs application metadata
// depends on THIS interface, never on the concrete store.
//
// The shipped DefaultRegistry is a complete, persistence-backed implementation
// of this interface (a real CMDB-like registry) — not a stub and not canned
// data. A future implementation can resolve the same metadata from an external
// CMDB without any caller change.
//
// All methods are tenant-scoped: tenantID identifies the estate. Reads return
// ErrNotFound for an unknown application; mutating methods return ErrAlready
// Exists / ErrInvalid as documented. Resolve* methods are the read seam the
// analytics layer (Prompt 8) and the populate/sync actions consume.
type MetastoreClient interface {
	// ResolveApplication returns the full recovery metadata for one application
	// by its server id (owners, environments, dependencies, recovery tier, RTO
	// target, cloud accounts, linked runbooks). ErrNotFound when absent.
	ResolveApplication(ctx context.Context, tenantID uuid.UUID, id string) (*Application, error)
	// ResolveApplicationByKey resolves by the application's stable app_key — the
	// identifier external systems and the populate/sync actions key off.
	ResolveApplicationByKey(ctx context.Context, tenantID uuid.UUID, appKey string) (*Application, error)
	// ListApplications returns a bounded page of the tenant's applications with
	// their full metadata, plus the total count for pagination.
	ListApplications(ctx context.Context, tenantID uuid.UUID, limit, offset int) (ListPage, error)

	// CreateApplication registers a new application from a full metadata payload,
	// validating it and computing the initial metadata fingerprint. ErrAlready
	// Exists on an app_key collision; ErrInvalid on a bad payload.
	CreateApplication(ctx context.Context, tenantID uuid.UUID, in ApplicationInput) (*Application, error)
	// UpdateApplication replaces an application's metadata wholesale (the
	// children sets are replaced, not merged), advancing the metadata revision
	// only when the drift-relevant metadata actually changed. ErrNotFound when
	// absent; ErrInvalid on a bad payload.
	UpdateApplication(ctx context.Context, tenantID uuid.UUID, id string, in ApplicationInput) (*Application, error)
	// DeleteApplication removes an application and all its children + links.
	DeleteApplication(ctx context.Context, tenantID uuid.UUID, id string) error
}

// ApplicationInput is the validated create/update payload for an application's
// recovery metadata. It mirrors Application minus the server-owned fields
// (id/revision/hash/timestamps), which the registry computes.
type ApplicationInput struct {
	AppKey           string
	Name             string
	Description      string
	RecoveryTier     string
	RTOTargetSeconds int
	Owners           []Owner
	Environments     []Environment
	Dependencies     []Dependency
	CloudAccounts    []CloudAccount
}

// compile-time assertion that the default registry satisfies the seam.
var _ MetastoreClient = (*DefaultRegistry)(nil)
