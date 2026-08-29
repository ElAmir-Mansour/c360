package service

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// fakeContractBulkBackend is an in-memory contractBulkBackend so the bulk
// mechanics (filter resolution, cap, de-dup, partial-failure shape) are tested
// without a database; the real per-item semantics live in ContractService and
// are covered by its own tests.
type fakeContractBulkBackend struct {
	pages       [][]model.Contract
	total       int
	listCalls   int
	listFilters []model.ContractListFilters

	contracts  map[uuid.UUID]*model.ContractDetail
	updateErr  map[uuid.UUID]error
	updated    []uuid.UUID
	analyzeErr map[uuid.UUID]error
	analyzed   []uuid.UUID
}

func (f *fakeContractBulkBackend) ListContracts(_ context.Context, _ uuid.UUID, filters model.ContractListFilters) ([]model.Contract, int, error) {
	f.listCalls++
	f.listFilters = append(f.listFilters, filters)
	page := filters.Page
	if page < 1 || page > len(f.pages) {
		return []model.Contract{}, f.total, nil
	}
	return f.pages[page-1], f.total, nil
}

func (f *fakeContractBulkBackend) GetContract(_ context.Context, _ uuid.UUID, id uuid.UUID) (*model.ContractDetail, error) {
	detail, ok := f.contracts[id]
	if !ok {
		return nil, notFoundError("contract not found")
	}
	return detail, nil
}

func (f *fakeContractBulkBackend) UpdateStatus(_ context.Context, _ uuid.UUID, _ uuid.UUID, id uuid.UUID, _ model.ContractStatus) (*model.Contract, error) {
	if err := f.updateErr[id]; err != nil {
		return nil, err
	}
	f.updated = append(f.updated, id)
	return &model.Contract{ID: id}, nil
}

func (f *fakeContractBulkBackend) AnalyzeContract(_ context.Context, _ uuid.UUID, id uuid.UUID) (*model.AnalysisResult, error) {
	if err := f.analyzeErr[id]; err != nil {
		return nil, err
	}
	f.analyzed = append(f.analyzed, id)
	return &model.AnalysisResult{}, nil
}

func detailWithAuthor(id, author uuid.UUID) *model.ContractDetail {
	return &model.ContractDetail{Contract: &model.Contract{ID: id, CreatedBy: author, Status: model.ContractStatusDraft}}
}

func TestContractBulkResolveFilterWalksAllPages(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	backend := &fakeContractBulkBackend{
		pages: [][]model.Contract{{{ID: a}, {ID: b}}, {{ID: c}}},
		total: 3,
	}
	svc := &ContractBulkService{backend: backend}

	status := model.ContractStatusActive
	ids, err := svc.ResolveFilter(context.Background(), uuid.New(), model.ContractListFilters{Status: &status})
	if err != nil {
		t.Fatalf("ResolveFilter() error = %v", err)
	}
	if len(ids) != 3 || ids[0] != a || ids[1] != b || ids[2] != c {
		t.Fatalf("ResolveFilter() ids = %v, want [%s %s %s]", ids, a, b, c)
	}
	if backend.listCalls != 2 {
		t.Fatalf("ListContracts calls = %d, want 2", backend.listCalls)
	}
	// The bulk resolver must pin pagination + a stable sort while PRESERVING the
	// caller's membership filters (the reused query-builder's output).
	for i, filters := range backend.listFilters {
		if filters.Page != i+1 {
			t.Fatalf("page %d: filters.Page = %d, want %d", i, filters.Page, i+1)
		}
		if filters.PerPage != bulkResolvePageSize {
			t.Fatalf("page %d: filters.PerPage = %d, want %d", i, filters.PerPage, bulkResolvePageSize)
		}
		if filters.SortColumn != "c.created_at" || filters.SortDirection != "asc" {
			t.Fatalf("page %d: sort = %s %s, want c.created_at asc", i, filters.SortColumn, filters.SortDirection)
		}
		if filters.Status == nil || *filters.Status != status {
			t.Fatalf("page %d: status filter was not preserved", i)
		}
	}
}

func TestContractBulkResolveFilterRejectsOverCap(t *testing.T) {
	backend := &fakeContractBulkBackend{
		pages: [][]model.Contract{{{ID: uuid.New()}}},
		total: MaxBulkContracts + 1,
	}
	svc := &ContractBulkService{backend: backend}

	_, err := svc.ResolveFilter(context.Background(), uuid.New(), model.ContractListFilters{})
	if err == nil {
		t.Fatal("ResolveFilter() expected over-cap error, got nil")
	}
	if got := httpStatus(err); got != 422 {
		t.Fatalf("over-cap error status = %d, want 422 (validation)", got)
	}
	if msg := bulkErrorMessage(err); !strings.Contains(msg, "narrow the filter") {
		t.Fatalf("over-cap error message = %q, want a clear narrow-the-filter hint", msg)
	}
}

func TestContractBulkUpdateStatusPartialFailureShape(t *testing.T) {
	actor := uuid.New()
	okID := uuid.New()      // distinct author, transition succeeds
	missingID := uuid.New() // not found
	sodID := uuid.New()     // authored by the actor -> dynamic SoD denial
	fsmID := uuid.New()     // transition service rejects

	backend := &fakeContractBulkBackend{
		contracts: map[uuid.UUID]*model.ContractDetail{
			okID:  detailWithAuthor(okID, uuid.New()),
			sodID: detailWithAuthor(sodID, actor),
			fsmID: detailWithAuthor(fsmID, uuid.New()),
		},
		updateErr: map[uuid.UUID]error{
			fsmID: validationError("invalid contract transition from draft to active", map[string]string{"status": "invalid transition"}),
		},
	}
	svc := &ContractBulkService{backend: backend}

	// okID is passed twice: de-dup must apply the transition exactly once.
	result, err := svc.BulkUpdateStatus(context.Background(), uuid.New(), actor,
		[]uuid.UUID{okID, missingID, sodID, fsmID, okID}, model.ContractStatusInternalReview)
	if err != nil {
		t.Fatalf("BulkUpdateStatus() error = %v", err)
	}

	if result.Total != 4 {
		t.Fatalf("result.Total = %d, want 4 (de-duped)", result.Total)
	}
	if len(result.Succeeded) != 1 || result.Succeeded[0] != okID {
		t.Fatalf("result.Succeeded = %v, want [%s]", result.Succeeded, okID)
	}
	if len(backend.updated) != 1 || backend.updated[0] != okID {
		t.Fatalf("UpdateStatus applied to %v, want exactly [%s]", backend.updated, okID)
	}

	reasons := make(map[uuid.UUID]string, len(result.Failed))
	for _, failure := range result.Failed {
		reasons[failure.ID] = failure.Reason
	}
	if len(reasons) != 3 {
		t.Fatalf("result.Failed = %v, want 3 distinct failures", result.Failed)
	}
	if reasons[missingID] != "contract not found" {
		t.Fatalf("missing-id reason = %q, want %q", reasons[missingID], "contract not found")
	}
	if !strings.Contains(reasons[sodID], "separation of duties") {
		t.Fatalf("SoD reason = %q, want a separation-of-duties denial", reasons[sodID])
	}
	if !strings.Contains(reasons[fsmID], "invalid contract transition") {
		t.Fatalf("FSM reason = %q, want the transition-service message", reasons[fsmID])
	}
}

func TestContractBulkUpdateStatusRejectsUnknownStatus(t *testing.T) {
	svc := &ContractBulkService{backend: &fakeContractBulkBackend{}}
	_, err := svc.BulkUpdateStatus(context.Background(), uuid.New(), uuid.New(), []uuid.UUID{uuid.New()}, model.ContractStatus("bogus"))
	if err == nil {
		t.Fatal("BulkUpdateStatus() expected unknown-status error, got nil")
	}
	if got := httpStatus(err); got != 422 {
		t.Fatalf("unknown-status error status = %d, want 422 (validation)", got)
	}
}

func TestContractBulkUpdateStatusRejectsOverCap(t *testing.T) {
	ids := make([]uuid.UUID, MaxBulkContracts+1)
	for i := range ids {
		ids[i] = uuid.New()
	}
	svc := &ContractBulkService{backend: &fakeContractBulkBackend{}}
	_, err := svc.BulkUpdateStatus(context.Background(), uuid.New(), uuid.New(), ids, model.ContractStatusInternalReview)
	if err == nil {
		t.Fatal("BulkUpdateStatus() expected over-cap error, got nil")
	}
	if got := httpStatus(err); got != 422 {
		t.Fatalf("over-cap error status = %d, want 422 (validation)", got)
	}
	if msg := bulkErrorMessage(err); !strings.Contains(msg, "bulk maximum") {
		t.Fatalf("over-cap error message = %q, want a clear bulk-maximum message", msg)
	}
}

func TestContractBulkAnalyzePartialFailureShape(t *testing.T) {
	okID, badID := uuid.New(), uuid.New()
	backend := &fakeContractBulkBackend{
		analyzeErr: map[uuid.UUID]error{
			badID: validationError("contract has no document text to analyze", map[string]string{"document": "missing"}),
		},
	}
	svc := &ContractBulkService{backend: backend}

	result, err := svc.BulkAnalyze(context.Background(), uuid.New(), uuid.New(), []uuid.UUID{okID, badID})
	if err != nil {
		t.Fatalf("BulkAnalyze() error = %v", err)
	}
	if result.Total != 2 {
		t.Fatalf("result.Total = %d, want 2", result.Total)
	}
	if len(result.Succeeded) != 1 || result.Succeeded[0] != okID {
		t.Fatalf("result.Succeeded = %v, want [%s]", result.Succeeded, okID)
	}
	if len(result.Failed) != 1 || result.Failed[0].ID != badID {
		t.Fatalf("result.Failed = %v, want one failure for %s", result.Failed, badID)
	}
	if result.Failed[0].Reason != "contract has no document text to analyze" {
		t.Fatalf("failure reason = %q, want the per-item service message", result.Failed[0].Reason)
	}
	if len(backend.analyzed) != 1 || backend.analyzed[0] != okID {
		t.Fatalf("AnalyzeContract applied to %v, want exactly [%s]", backend.analyzed, okID)
	}
}
