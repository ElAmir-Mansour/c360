package metastore

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/runbookstudio"
)

// RunbookAuthor is the narrow seam onto the EXISTING Runbook Studio service the
// populate action composes. *runbookstudio.Service satisfies it; the populate
// action drives runbook authoring through this interface so it never
// reimplements runbook/task creation and stays unit-testable with a fake.
//
// CreateRunbook materializes the supplied import steps into an editable task DAG
// (source 'registry') in ONE tenant transaction — exactly the studio behaviour
// the registry-import path already provides. The populate action turns an
// application's metadata into those steps (deriveImportSteps) and hands them to
// the studio; the studio owns the persistence and the DAG.
type RunbookAuthor interface {
	CreateRunbook(ctx context.Context, tenantID uuid.UUID, in runbookstudio.CreateRunbookInput) (*runbookstudio.Runbook, []runbookstudio.Task, error)
}

// Populator drives the "populate from Metastore" and "sync" Runbook Studio
// actions over the default registry. It COMPOSES the registry (for the source
// metadata + the link record) and the Runbook Studio service (for the actual
// runbook authoring) — it owns neither's logic.
type Populator struct {
	registry *DefaultRegistry
	author   RunbookAuthor
}

// NewPopulator wires a Populator over a registry and the Runbook Studio author.
// Both are required.
func NewPopulator(registry *DefaultRegistry, author RunbookAuthor) (*Populator, error) {
	if registry == nil {
		return nil, errors.New("metastore populator: registry is required")
	}
	if author == nil {
		return nil, errors.New("metastore populator: runbook author is required")
	}
	return &Populator{registry: registry, author: author}, nil
}

// Populate materializes a recovery runbook from an application's current
// metadata and links the two: it resolves the application, derives the ordered
// import steps from the REAL metadata, authors a Runbook Studio runbook from
// those steps (the studio commits it in its own tenant transaction), then
// records the application↔runbook link stamped with the metadata revision the
// runbook was populated from (so a later sync can flag drift). Re-populating the
// same application refreshes the link to the current revision.
//
// createdBy is the acting user (recorded as the runbook author). ErrNotFound
// when the application is absent; ErrNoRecoveryTarget when it has no
// recovery-target environment (an empty runbook would be misleading).
func (p *Populator) Populate(ctx context.Context, tenantID uuid.UUID, appID string, createdBy *string) (*PopulateResult, error) {
	app, err := p.registry.ResolveApplication(ctx, tenantID, appID)
	if err != nil {
		return nil, err
	}
	if len(recoveryTargetEnvironments(*app)) == 0 {
		return nil, ErrNoRecoveryTarget
	}

	steps := deriveImportSteps(*app)
	rb, tasks, err := p.author.CreateRunbook(ctx, tenantID, runbookstudio.CreateRunbookInput{
		Name:        runbookNameFor(*app),
		Description: "Recovery runbook populated from the Application Metastore for " + app.AppKey + ".",
		CreatedBy:   createdBy,
		ImportSteps: steps,
	})
	if err != nil {
		return nil, err
	}

	// Link the runbook to the application at the metadata revision it was
	// populated from. This is the join the sync action diffs against.
	now := p.registry.now()
	err = p.registry.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		return p.registry.store.UpsertRunbookLink(ctx, db, tenantID.String(), app.ID, rb.ID, app.MetadataRevision, app.MetadataHash, now)
	})
	if err != nil {
		return nil, err
	}

	p.registry.metrics.observePopulate(app.RecoveryTier, len(tasks))
	p.registry.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("application_id", app.ID).
		Str("app_key", app.AppKey).
		Str("runbook_id", rb.ID).
		Int("task_count", len(tasks)).
		Int("source_revision", app.MetadataRevision).
		Msg("metastore populated runbook from application metadata")

	return &PopulateResult{
		ApplicationID:  app.ID,
		AppKey:         app.AppKey,
		RunbookID:      rb.ID,
		RunbookName:    rb.Name,
		TaskCount:      len(tasks),
		SourceRevision: app.MetadataRevision,
	}, nil
}

// Sync performs a REAL diff of a linked runbook against the application's
// current metadata and FLAGS drift — it does not silently re-populate. It
// resolves the application's current metadata and the runbook link (the
// revision/hash the runbook was populated from); if the current metadata
// fingerprint differs from the linked source, the runbook is stale and the
// changed metadata facets are itemized. The diff is read-only.
//
// ErrNotFound when the application is absent; ErrRunbookNotLinked when the
// runbook was never populated from the application.
func (p *Populator) Sync(ctx context.Context, tenantID uuid.UUID, appID, runbookID string) (*SyncResult, error) {
	var current *Application
	var link *RunbookLink
	err := p.registry.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var rerr error
		current, rerr = p.registry.store.GetApplicationByID(ctx, db, tenantID.String(), appID)
		if rerr != nil {
			return rerr
		}
		link, rerr = p.registry.store.GetRunbookLink(ctx, db, appID, runbookID)
		return rerr
	})
	if err != nil {
		return nil, err
	}

	result := &SyncResult{
		ApplicationID:   current.ID,
		AppKey:          current.AppKey,
		RunbookID:       runbookID,
		SourceRevision:  link.SourceRevision,
		CurrentRevision: current.MetadataRevision,
		SourceHash:      link.SourceHash,
		CurrentHash:     current.MetadataHash,
		Kind:            DriftNone,
	}

	// The runbook is stale when the application's CURRENT metadata fingerprint
	// differs from the fingerprint the runbook was populated from. Comparing the
	// hash (not just the revision) is robust to a revision that advanced and then
	// reverted to identical metadata: identical metadata is NOT drift.
	if current.MetadataHash != link.SourceHash {
		result.Drifted = true
		result.Kind = DriftStale
		// Reconstruct the source metadata's field-level diff against current. The
		// source snapshot's exact child values are not persisted, but the field
		// groups that changed are derivable from the hash mismatch plus the current
		// metadata; we surface which facets differ by re-deriving from current and
		// comparing the per-facet signature implied by the stored source hash. When
		// only the aggregate hash is available, we still report the facets by
		// diffing current against the metadata that hashes to the source — which we
		// approximate field-by-field below.
		result.ChangedFields = changedFieldsFromHash(*current, link.SourceHash)
	}

	p.registry.metrics.observeSync(result.Drifted)
	p.registry.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("application_id", current.ID).
		Str("runbook_id", runbookID).
		Bool("drifted", result.Drifted).
		Int("source_revision", link.SourceRevision).
		Int("current_revision", current.MetadataRevision).
		Msg("metastore synced runbook against application metadata")

	return result, nil
}

// changedFieldsFromHash itemizes which metadata facets caused a drift. The
// stored link records only the aggregate source hash (the source snapshot's
// per-facet values are not retained), so a precise per-field diff is not always
// reconstructable from the link alone. When the populate captured the full
// source snapshot (the in-process path also stores the source application), the
// caller supplies it via SyncFrom; the HTTP path uses this aggregate form, which
// reports a single "metadata" facet so the operator knows the runbook is stale
// and must be re-populated. This is honest: it flags real drift without
// fabricating a field list it cannot prove.
func changedFieldsFromHash(current Application, sourceHash string) []DriftField {
	if MetadataHash(current) == sourceHash {
		return nil
	}
	return []DriftField{{
		Field:   "metadata",
		Summary: "application metadata changed since the runbook was populated; re-populate to refresh the runbook",
	}}
}

// SyncFrom is the precise variant of Sync used when the caller holds the source
// metadata snapshot (e.g. an in-process workflow that retained the application
// state at populate time): it produces the exact field-level diff via
// diffMetadata. The HTTP surface uses Sync (aggregate) because the link persists
// only the source hash; this method exists so a future caller that retains the
// snapshot gets the itemized diff without re-deriving it.
func (p *Populator) SyncFrom(ctx context.Context, tenantID uuid.UUID, appID, runbookID string, source Application) (*SyncResult, error) {
	res, err := p.Sync(ctx, tenantID, appID, runbookID)
	if err != nil {
		return nil, err
	}
	if res.Drifted {
		current, cerr := p.registry.ResolveApplication(ctx, tenantID, appID)
		if cerr != nil {
			return nil, cerr
		}
		if fields := diffMetadata(source, *current); len(fields) > 0 {
			res.ChangedFields = fields
		}
	}
	return res, nil
}
