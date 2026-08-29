package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/suiteapi"
)

// ListRuns handles GET /runs (automation:read): the tenant's run history,
// newest-first, paginated by ?page / ?per_page.
func (h *Handler) ListRuns(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	offset := (page - 1) * perPage
	runs, err := h.svc.ListRuns(r.Context(), tenantID, perPage, offset)
	if err != nil {
		h.writeErr(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, orEmptyRuns(runs))
}

// GetRun handles GET /runs/{id} (automation:read): the run plus its append-only
// execution log and the computed replayability (§4.7).
func (h *Handler) GetRun(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing run id", nil)
		return
	}
	withLog, err := h.svc.GetRunWithLog(r.Context(), tenantID, id)
	if err != nil {
		h.writeErr(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, withLog)
}

// decisionRequest is the body for an approval-gate decision: an optional comment.
type decisionRequest struct {
	Comment string `json:"comment,omitempty"`
}

// ApproveRun handles POST /runs/{id}/approve (automation:approve): records the
// authenticated user's affirmative vote on the run's open gate. When quorum is
// met the run is re-armed for the driver; otherwise it stays parked.
func (h *Handler) ApproveRun(w http.ResponseWriter, r *http.Request) {
	h.decide(w, r, true)
}

// RejectRun handles POST /runs/{id}/reject (automation:approve): a rejection
// FAILs the run.
func (h *Handler) RejectRun(w http.ResponseWriter, r *http.Request) {
	h.decide(w, r, false)
}

func (h *Handler) decide(w http.ResponseWriter, r *http.Request, approved bool) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing run id", nil)
		return
	}
	var req decisionRequest
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
	}
	var (
		gate *model.ApprovalGate
		err  error
	)
	if approved {
		gate, err = h.svc.ApproveRun(r.Context(), tenantID, id, userID, req.Comment)
	} else {
		gate, err = h.svc.RejectRun(r.Context(), tenantID, id, userID, req.Comment)
	}
	if err != nil {
		h.writeErr(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, gate)
}

// ReplayRun handles POST /runs/{id}/replay (automation:write): creates a NEW run
// re-executing the original from its recorded inputs (replay_of lineage). A run
// that is not terminal, or whose step log has a gap, is non_replayable and
// returns 409 (§4.7).
func (h *Handler) ReplayRun(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing run id", nil)
		return
	}
	newRun, err := h.svc.Replay(r.Context(), tenantID, id)
	if err != nil {
		h.writeErr(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, newRun)
}

func orEmptyRuns(in []*model.Run) []*model.Run {
	if in == nil {
		return []*model.Run{}
	}
	return in
}
