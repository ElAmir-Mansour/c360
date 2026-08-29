package byok

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// byokService is the Service surface the HTTP router needs. *Service satisfies
// it; an interface keeps the router unit-testable without a database.
type byokService interface {
	Enroll(ctx context.Context, tenantID uuid.UUID, provider, reference string) (*TenantKEK, error)
	ListKEKs(ctx context.Context, tenantID uuid.UUID) ([]*TenantKEK, error)
	Rotate(ctx context.Context, tenantID uuid.UUID) (*TenantKEK, error)
	CustodyLog(ctx context.Context, tenantID uuid.UUID) ([]*CustodyEntry, error)
	VerifyCustody(ctx context.Context, tenantID uuid.UUID) (bool, int64, string, error)
}

// Router serves the BYOK custody HTTP surface. The integration phase mounts it
// under /api/v1/dr (alongside the main DR handler), giving:
//
//	POST /api/v1/dr/byok/keys                 (dr:admin) enroll a tenant KEK
//	GET  /api/v1/dr/byok/keys                 (dr:read)  KEK versions + state
//	POST /api/v1/dr/byok/keys/rotate          (dr:admin) rotate + rewrap
//	GET  /api/v1/dr/byok/keys/custody-log     (dr:read)  hash-chained custody log
//
// Enrolling and rotating a sovereign master key are administrative actions
// (dr:admin); reading the key inventory and custody log require dr:read.
type Router struct {
	svc    byokService
	logger zerolog.Logger
}

// NewRouter constructs the BYOK HTTP router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-byok").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc byokService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the BYOK endpoints, permission-gated.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/byok/keys", h.listKeys)
		r.Get("/byok/keys/custody-log", h.custodyLog)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRAdmin))
		r.Post("/byok/keys", h.enroll)
		r.Post("/byok/keys/rotate", h.rotate)
	})

	return r
}

// enrollRequest is the body for POST /byok/keys.
type enrollRequest struct {
	Provider  string `json:"provider"`
	Reference string `json:"reference"`
}

func (h *Router) enroll(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	var req enrollRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	kek, err := h.svc.Enroll(r.Context(), tenantID, req.Provider, req.Reference)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, kek)
}

func (h *Router) listKeys(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	out, err := h.svc.ListKEKs(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *Router) rotate(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	kek, err := h.svc.Rotate(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, kek)
}

// custodyLogResponse pairs the entries with the verification result so a caller
// can confirm the chain is intact and pin the Merkle root.
type custodyLogResponse struct {
	Entries    []*CustodyEntry `json:"entries"`
	Intact     bool            `json:"intact"`
	BrokenSeq  int64           `json:"broken_seq"`
	MerkleRoot string          `json:"merkle_root"`
}

func (h *Router) custodyLog(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	entries, err := h.svc.CustodyLog(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	intact, brokenSeq, root, verr := h.svc.VerifyCustody(r.Context(), tenantID)
	if verr != nil {
		h.writeError(w, r, verr)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, custodyLogResponse{
		Entries:    entries,
		Intact:     intact,
		BrokenSeq:  brokenSeq,
		MerkleRoot: root,
	})
}

func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

// writeError maps BYOK sentinel errors to HTTP statuses.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrAlreadyEnrolled):
		suiteapi.WriteError(w, r, http.StatusConflict, "already_enrolled", err.Error(), nil)
	case errors.Is(err, ErrNotEnrolled):
		suiteapi.WriteError(w, r, http.StatusConflict, "not_enrolled", err.Error(), nil)
	case errors.Is(err, ErrInvalidState):
		suiteapi.WriteError(w, r, http.StatusConflict, "invalid_state", err.Error(), nil)
	case errors.Is(err, ErrUnwrap), errors.Is(err, ErrKeyVersion):
		suiteapi.WriteError(w, r, http.StatusConflict, "unwrap_failed", err.Error(), nil)
	case errors.Is(err, ErrValidation):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "validation_error", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr byok request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

var _ byokService = (*Service)(nil)
