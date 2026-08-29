package attestledger

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// API is the HTTP-facing contract for the attestation ledger, satisfied by
// *Recorder. Defining it as an interface keeps the router testable with a stub.
type API interface {
	ListEntries(ctx context.Context, tenantID uuid.UUID, f ListFilter) ([]*Entry, error)
	Verify(ctx context.Context, tenantID uuid.UUID) (VerifyResult, error)
	Anchor(ctx context.Context, tenantID uuid.UUID) (*Checkpoint, error)
	BuildInclusionProofFor(ctx context.Context, tenantID uuid.UUID, seq int64) (*InclusionProof, error)
}

// Handler maps HTTP to the attestation-ledger recorder.
type Handler struct {
	svc    API
	logger zerolog.Logger
}

// NewHandler constructs the attestation-ledger HTTP handler.
func NewHandler(svc API, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger.With().Str("handler", "dr-attestledger").Logger()}
}

// Routes returns a chi.Router the integration phase mounts under the DR API:
//
//	GET  /attestation-ledger?type=&subject=   (dr:read)     -> list entries
//	GET  /attestation-ledger/verify           (dr:read)     -> walk + verify chain
//	POST /attestation-ledger/anchor           (dr:admin)    -> seal a Merkle checkpoint
//	GET  /attestation-ledger/{seq}/proof      (dr:read)     -> inclusion proof
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/attestation-ledger", h.listEntries)
		r.Get("/attestation-ledger/verify", h.verify)
		r.Get("/attestation-ledger/{seq}/proof", h.proof)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRAdmin))
		r.Post("/attestation-ledger/anchor", h.anchor)
	})

	return r
}

// listEntries handles GET /attestation-ledger: returns the tenant's chain
// (genesis-first), optionally filtered by ?type= and ?subject=.
func (h *Handler) listEntries(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	f := ListFilter{
		EntryType: r.URL.Query().Get("type"),
		SubjectID: r.URL.Query().Get("subject"),
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			f.Limit = n
		}
	}
	entries, err := h.svc.ListEntries(r.Context(), tenantID, f)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if entries == nil {
		entries = []*Entry{}
	}
	suiteapi.WriteData(w, http.StatusOK, entries)
}

// verify handles GET /attestation-ledger/verify: walks and verifies the chain,
// returning whether it is intact or the first broken seq. A detected break is
// still a 200 with intact=false — the verification succeeded; the chain failed.
func (h *Handler) verify(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	result, err := h.svc.Verify(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// anchor handles POST /attestation-ledger/anchor: seals a Merkle checkpoint over
// the next unanchored range. When there is nothing to anchor it returns 409.
func (h *Handler) anchor(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	cp, err := h.svc.Anchor(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, cp)
}

// proof handles GET /attestation-ledger/{seq}/proof: returns a Merkle inclusion
// proof for the entry at seq against the checkpoint that covers it.
func (h *Handler) proof(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	raw := chi.URLParam(r, "seq")
	seq, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || seq < 1 {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "seq must be a positive integer", nil)
		return
	}
	proof, err := h.svc.BuildInclusionProofFor(r.Context(), tenantID, seq)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, proof)
}

func (h *Handler) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrInvalid):
		// ErrInvalid covers "nothing to anchor" (409 conflict) and malformed input
		// (400). Anchor's "nothing to anchor" is the common conflict case.
		suiteapi.WriteError(w, r, http.StatusConflict, "nothing_to_anchor", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("attestation-ledger request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
