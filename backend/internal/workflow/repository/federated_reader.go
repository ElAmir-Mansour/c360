package repository

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// instanceReadSource is the read surface the FederatedInstanceReader fans out
// over. *InstanceRepository satisfies it.
type instanceReadSource interface {
	GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowInstance, error)
	List(ctx context.Context, tenantID, status, definitionID, startedBy string, dateFrom, dateTo *time.Time, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowInstance, int, error)
	ListForViewer(ctx context.Context, tenantID string, viewer *InstanceViewer, status, definitionID, startedBy string, dateFrom, dateTo *time.Time, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowInstance, int, error)
	GetStepExecutions(ctx context.Context, instanceID string) ([]*model.StepExecution, error)
	UpdateVariables(ctx context.Context, tenantID, instanceID string, variables map[string]interface{}) error
}

// FederatedInstanceReader wraps a PRIMARY instance store plus zero or more
// READ-ONLY suite stores, merging read operations so the shared admin console can
// surface workflow instances a suite's embedded engine still holds in its own
// database. Reads (List / GetByID / GetStepExecutions) are federated; writes
// (UpdateVariables) target the primary only, so an instance that lives in a suite
// store is view-only here — acting on it belongs to the owning suite. This is a
// temporary read-model bridge (docs/workflow-instance-visibility.md); it never
// affects the engine's write/execution paths. With no federated sources added it
// behaves exactly like the primary store.
type FederatedInstanceReader struct {
	primary   instanceReadSource
	federated []instanceReadSource
	logger    zerolog.Logger
}

// NewFederatedInstanceReader builds a reader over the primary store. Suite stores
// are attached with AddSource.
func NewFederatedInstanceReader(primary instanceReadSource, logger zerolog.Logger) *FederatedInstanceReader {
	return &FederatedInstanceReader{primary: primary, logger: logger}
}

// AddSource registers a read-only suite store to federate reads over. Nil is a no-op.
func (r *FederatedInstanceReader) AddSource(src instanceReadSource) {
	if src != nil {
		r.federated = append(r.federated, src)
	}
}

// List merges the primary store with every federated suite store. It pulls the
// top (offset+limit) matching rows from each (each already tenant/status-filtered),
// globally sorts + slices for correct cross-store pagination, and SUMS per-store
// totals so the admin count cards (which are per-status list calls) stay accurate.
// Fetching offset+limit from every store guarantees the global top-(offset+limit)
// rows are present. A failing suite store degrades gracefully — logged and skipped,
// never breaking the primary view.
func (r *FederatedInstanceReader) List(ctx context.Context, tenantID, status, definitionID, startedBy string, dateFrom, dateTo *time.Time, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowInstance, int, error) {
	return r.ListForViewer(ctx, tenantID, nil, status, definitionID, startedBy, dateFrom, dateTo, sortBy, sortOrder, limit, offset)
}

// ListForViewer is List narrowed to one viewer's involvement. The viewer scope
// is applied by EVERY source (primary and federated) so a suite store cannot
// leak instances the viewer has no part in.
func (r *FederatedInstanceReader) ListForViewer(ctx context.Context, tenantID string, viewer *InstanceViewer, status, definitionID, startedBy string, dateFrom, dateTo *time.Time, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowInstance, int, error) {
	if len(r.federated) == 0 {
		return r.primary.ListForViewer(ctx, tenantID, viewer, status, definitionID, startedBy, dateFrom, dateTo, sortBy, sortOrder, limit, offset)
	}

	fetch := offset + limit
	merged, total, err := r.primary.ListForViewer(ctx, tenantID, viewer, status, definitionID, startedBy, dateFrom, dateTo, sortBy, sortOrder, fetch, 0)
	if err != nil {
		return nil, 0, err
	}
	for _, src := range r.federated {
		rows, cnt, ferr := src.ListForViewer(ctx, tenantID, viewer, status, definitionID, startedBy, dateFrom, dateTo, sortBy, sortOrder, fetch, 0)
		if ferr != nil {
			r.logger.Warn().Err(ferr).Msg("federated instance list failed; skipping source")
			continue
		}
		merged = append(merged, rows...)
		total += cnt
	}
	mergeSortInstances(merged, sortBy, sortOrder)
	if offset >= len(merged) {
		return []*model.WorkflowInstance{}, total, nil
	}
	end := offset + limit
	if end > len(merged) {
		end = len(merged)
	}
	return merged[offset:end], total, nil
}

// GetByID returns the instance from the primary store, falling back to the
// federated suite stores when it is not present in the primary.
func (r *FederatedInstanceReader) GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowInstance, error) {
	inst, err := r.primary.GetByID(ctx, tenantID, id)
	if err == nil {
		return inst, nil
	}
	for _, src := range r.federated {
		if fi, ferr := src.GetByID(ctx, tenantID, id); ferr == nil && fi != nil {
			return fi, nil
		}
	}
	return nil, err
}

// GetStepExecutions returns an instance's step history from whichever store owns
// it (an instance's steps live in exactly one store; UUIDs are unique across
// stores, so probing each is safe).
func (r *FederatedInstanceReader) GetStepExecutions(ctx context.Context, instanceID string) ([]*model.StepExecution, error) {
	execs, err := r.primary.GetStepExecutions(ctx, instanceID)
	if err == nil && len(execs) > 0 {
		return execs, nil
	}
	for _, src := range r.federated {
		if fe, ferr := src.GetStepExecutions(ctx, instanceID); ferr == nil && len(fe) > 0 {
			return fe, nil
		}
	}
	return execs, err
}

// UpdateVariables targets the primary store only — a suite-owned instance is
// view-only through this read-model bridge.
func (r *FederatedInstanceReader) UpdateVariables(ctx context.Context, tenantID, instanceID string, variables map[string]interface{}) error {
	return r.primary.UpdateVariables(ctx, tenantID, instanceID, variables)
}

// definitionReadSource is the read surface FederatedDefinitionReader fans out
// over. *DefinitionRepository satisfies it.
type definitionReadSource interface {
	GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowDefinition, error)
}

// FederatedDefinitionReader resolves a workflow definition from the primary store,
// falling back to read-only suite stores so the admin console can render the
// definition NAME of an instance a suite's embedded engine stores (with its
// definition) in its own database. Read-model bridge companion to
// FederatedInstanceReader; with no federated sources it behaves like the primary.
type FederatedDefinitionReader struct {
	primary   definitionReadSource
	federated []definitionReadSource
}

// NewFederatedDefinitionReader builds a reader over the primary store. Suite
// stores are attached with AddSource.
func NewFederatedDefinitionReader(primary definitionReadSource) *FederatedDefinitionReader {
	return &FederatedDefinitionReader{primary: primary}
}

// AddSource registers a read-only suite store to resolve definitions from. Nil is a no-op.
func (r *FederatedDefinitionReader) AddSource(src definitionReadSource) {
	if src != nil {
		r.federated = append(r.federated, src)
	}
}

// GetByID returns the definition from the primary store, falling back to the
// federated suite stores when it is not present in the primary.
func (r *FederatedDefinitionReader) GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	def, err := r.primary.GetByID(ctx, tenantID, id)
	if err == nil {
		return def, nil
	}
	for _, src := range r.federated {
		if fd, ferr := src.GetByID(ctx, tenantID, id); ferr == nil && fd != nil {
			return fd, nil
		}
	}
	return nil, err
}

// mergeSortInstances orders instances in place to mirror the repository's SQL
// ORDER BY allowlist (started_at | updated_at | status; default started_at DESC),
// so a federated merge across stores preserves the ordering the console expects.
func mergeSortInstances(insts []*model.WorkflowInstance, sortBy, sortOrder string) {
	asc := sortOrder == "asc"
	sort.SliceStable(insts, func(i, j int) bool {
		a, b := insts[i], insts[j]
		var c int
		switch sortBy {
		case "updated_at":
			c = a.UpdatedAt.Compare(b.UpdatedAt)
		case "status":
			c = strings.Compare(a.Status, b.Status)
		default:
			c = a.StartedAt.Compare(b.StartedAt)
		}
		if c == 0 {
			c = strings.Compare(a.ID, b.ID) // stable, deterministic tiebreak
		}
		if asc {
			return c < 0
		}
		return c > 0
	})
}
