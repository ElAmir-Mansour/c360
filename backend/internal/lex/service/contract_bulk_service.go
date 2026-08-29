package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// MaxBulkContracts caps a single bulk contract batch (explicit contract_ids OR a
// server-resolved filter set) so a runaway request cannot tie up the service
// processing thousands of per-id operations. Exceeding it is a 400 with a clear
// message, mirroring bulkConsultationMaxIDs.
const MaxBulkContracts = 1000

// bulkResolvePageSize matches the repository's per-page clamp
// (ContractRepository.List caps PerPage at 200), so filter resolution walks the
// full matching set in deterministic pages instead of silently truncating.
const bulkResolvePageSize = 200

// contractBulkBackend is the slice of *ContractService the bulk facade consumes.
// Every per-item mutation dispatches to the EXISTING per-id service method, so
// the status-transition FSM (ValidateContractTransition), the legal-hold guard,
// the signed-date side effect, the analyzer pipeline, and the per-item event
// emission all run exactly as for a single-item call.
type contractBulkBackend interface {
	ListContracts(ctx context.Context, tenantID uuid.UUID, filters model.ContractListFilters) ([]model.Contract, int, error)
	GetContract(ctx context.Context, tenantID, id uuid.UUID) (*model.ContractDetail, error)
	UpdateStatus(ctx context.Context, tenantID, userID, id uuid.UUID, status model.ContractStatus) (*model.Contract, error)
	AnalyzeContract(ctx context.Context, tenantID, id uuid.UUID) (*model.AnalysisResult, error)
}

// knownContractStatuses is derived from the FSM transition table so the up-front
// target-status validation on a bulk request can never drift from the statuses
// the transition service itself understands.
var knownContractStatuses = func() map[model.ContractStatus]struct{} {
	out := make(map[model.ContractStatus]struct{}, len(validTransitions))
	for from, targets := range validTransitions {
		out[from] = struct{}{}
		for to := range targets {
			out[to] = struct{}{}
		}
	}
	return out
}()

// BulkContractFailure is one per-item failure in a bulk contract result.
type BulkContractFailure struct {
	ID     uuid.UUID `json:"id"`
	Reason string    `json:"reason"`
}

// BulkContractResult is the partial-failure envelope of a bulk contract action:
// every attempted id lands in exactly one of Succeeded or Failed, so the caller
// can render partial outcomes instead of a whole-batch verdict.
type BulkContractResult struct {
	Total     int                   `json:"total"`
	Succeeded []uuid.UUID           `json:"succeeded"`
	Failed    []BulkContractFailure `json:"failed"`
}

// ContractBulkService fans one action out across many contracts (bulk-status /
// bulk-analyze, feature #8 bulk-by-filter). It owns only batch mechanics —
// filter resolution, the batch cap, de-dup, and per-item partial-failure
// collection; the actual domain semantics stay in ContractService.
type ContractBulkService struct {
	backend contractBulkBackend
}

func NewContractBulkService(contracts *ContractService) *ContractBulkService {
	return &ContractBulkService{backend: contracts}
}

// ResolveFilter resolves a contract list-filter to the FULL matching id set —
// the same query-builder behind GET /contracts and the GET /reports/contracts
// CSV export (repository List) does the matching, so bulk-by-filter can never
// select differently than the list the user was looking at. The set is capped
// at MaxBulkContracts with a clear error rather than silently truncated.
func (s *ContractBulkService) ResolveFilter(ctx context.Context, tenantID uuid.UUID, filters model.ContractListFilters) ([]uuid.UUID, error) {
	filters.Page = 1
	filters.PerPage = bulkResolvePageSize
	// Stable paging order: created_at ASC. The list default (updated_at DESC)
	// shifts as rows are touched, which could skip/duplicate ids while walking
	// pages; created_at is immutable so membership stays consistent.
	filters.SortColumn = "c.created_at"
	filters.SortDirection = "asc"

	ids := make([]uuid.UUID, 0, bulkResolvePageSize)
	for {
		items, total, err := s.backend.ListContracts(ctx, tenantID, filters)
		if err != nil {
			return nil, internalError("resolve bulk contract filter", err)
		}
		if total > MaxBulkContracts {
			return nil, validationError(
				fmt.Sprintf("filter matches %d contracts; the bulk maximum is %d — narrow the filter", total, MaxBulkContracts),
				map[string]string{"filter": "too_many"},
			)
		}
		for i := range items {
			ids = append(ids, items[i].ID)
		}
		// Done when the page under-fills or the full count is collected. A page
		// can come back empty/short if rows vanish mid-walk; both exits terminate.
		if len(items) == 0 || len(ids) >= total {
			return ids, nil
		}
		filters.Page++
	}
}

// BulkUpdateStatus applies one status transition across many contracts. Each id
// is processed independently through ContractService.UpdateStatus (FSM
// validation, legal-hold guard, signed-date, status_changed event — SoD and
// validation preserved) plus the per-item dynamic-SoD check below; one failure
// never blocks the rest.
func (s *ContractBulkService) BulkUpdateStatus(ctx context.Context, tenantID, userID uuid.UUID, ids []uuid.UUID, status model.ContractStatus) (*BulkContractResult, error) {
	if _, ok := knownContractStatuses[status]; !ok {
		return nil, validationError("unknown target status", map[string]string{"status": "invalid"})
	}
	targets, err := validateBulkContractIDs(ids)
	if err != nil {
		return nil, err
	}
	result := newBulkContractResult(targets)
	for _, id := range targets {
		if err := s.applyStatusOne(ctx, tenantID, userID, id, status); err != nil {
			result.Failed = append(result.Failed, BulkContractFailure{ID: id, Reason: bulkErrorMessage(err)})
			continue
		}
		result.Succeeded = append(result.Succeeded, id)
	}
	return result, nil
}

// applyStatusOne mirrors the single PUT /contracts/{id}/status control point.
// That route carries lexmw.RequireDistinctActor keyed on the {id} path param,
// which a bulk route cannot carry (exactly the BulkDecideTasks situation, see
// routes.go contractReview comment) — so the same dynamic-SoD invariant
// (author != actor, fail CLOSED when the author cannot be resolved) is enforced
// here per item before the transition service runs.
func (s *ContractBulkService) applyStatusOne(ctx context.Context, tenantID, userID, id uuid.UUID, status model.ContractStatus) error {
	detail, err := s.backend.GetContract(ctx, tenantID, id)
	if err != nil {
		return err
	}
	if detail == nil || detail.Contract == nil {
		return notFoundError("contract not found")
	}
	if err := requireDistinctDecisionAuthor("contract", detail.Contract.CreatedBy, userID); err != nil {
		return err
	}
	_, err = s.backend.UpdateStatus(ctx, tenantID, userID, id, status)
	return err
}

// BulkAnalyze re-runs the risk analysis across many contracts. Each id is
// processed independently through ContractService.AnalyzeContract (the same
// analyzer + governance pipeline as POST /contracts/{id}/analyze); the heavy
// per-item analysis payloads are deliberately not echoed back — callers refetch
// per contract as needed.
func (s *ContractBulkService) BulkAnalyze(ctx context.Context, tenantID, userID uuid.UUID, ids []uuid.UUID) (*BulkContractResult, error) {
	_ = userID // route-level RBAC (lex:contract:edit tier) is the analyze gate; kept for signature symmetry/audit.
	targets, err := validateBulkContractIDs(ids)
	if err != nil {
		return nil, err
	}
	result := newBulkContractResult(targets)
	for _, id := range targets {
		if _, err := s.backend.AnalyzeContract(ctx, tenantID, id); err != nil {
			result.Failed = append(result.Failed, BulkContractFailure{ID: id, Reason: bulkErrorMessage(err)})
			continue
		}
		result.Succeeded = append(result.Succeeded, id)
	}
	return result, nil
}

// validateBulkContractIDs enforces the batch cap and de-dups the id list (a
// repeated id must not double-apply a transition), dropping nil ids.
func validateBulkContractIDs(ids []uuid.UUID) ([]uuid.UUID, error) {
	if len(ids) > MaxBulkContracts {
		return nil, validationError(
			fmt.Sprintf("too many contracts in one batch (%d); the bulk maximum is %d", len(ids), MaxBulkContracts),
			map[string]string{"contract_ids": "too_many"},
		)
	}
	out := make([]uuid.UUID, 0, len(ids))
	seen := make(map[uuid.UUID]struct{}, len(ids))
	for _, id := range ids {
		if id == uuid.Nil {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, nil
}

func newBulkContractResult(targets []uuid.UUID) *BulkContractResult {
	return &BulkContractResult{
		Total:     len(targets),
		Succeeded: make([]uuid.UUID, 0, len(targets)),
		Failed:    make([]BulkContractFailure, 0),
	}
}
