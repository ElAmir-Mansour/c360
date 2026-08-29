package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/model"
)

// substitutionService is the engine surface the OOO/substitute handler drives. It
// mirrors service.SubstitutionService's write/read methods so the handler can be
// unit-tested against a double.
type substitutionService interface {
	SetSubstitution(ctx context.Context, tenantID, userID, deputyID string, from, to time.Time, reason, createdBy string) (*model.Substitution, error)
	ClearSubstitution(ctx context.Context, tenantID, userID string) error
	ListForUser(ctx context.Context, tenantID, userID string) ([]*model.Substitution, error)
}

// SubstitutionHandler exposes the out-of-office / substitute (deputy) registry: a
// user sets a deputy for a date window, and the human-task assignment path
// consults it so tasks routed to an out-of-office approver are auto-reassigned to
// the deputy. Routes are gated by substitutionRBAC (read -> workflow:read,
// write -> workflow:write).
//
// FAIL-CLOSED cross-user guard: a caller may set/clear a deputy ON THEIR OWN
// BEHALF (targetUserID == caller) with only the base write verb, but targeting
// ANOTHER user's OOO window is an administrative act that additionally requires
// the workflow:admin verb. Without this any workflow:write holder could hijack a
// colleague's task routing by parking a deputy on that colleague — so the check
// lives here, in the handler, where the caller identity and the {userId} target
// are both known (the route-level substitutionRBAC classifier cannot see whether
// /users/{userId} names the caller). RBAC verb resolution reuses
// auth.HasPermission, so the admin:* / workflow:* wildcards apply unchanged.
type SubstitutionHandler struct {
	svc    substitutionService
	logger zerolog.Logger
}

// canTargetOtherUser reports whether the caller may set/clear a deputy for a user
// OTHER than themselves. Self-service always passes; acting on another user
// requires the elevated workflow:admin verb. Centralised so set() and clear()
// enforce the identical rule.
func canTargetOtherUser(user *auth.ContextUser, targetUserID string) bool {
	if user == nil {
		return false
	}
	if targetUserID == "" || targetUserID == user.ID {
		return true // self-service
	}
	return auth.HasPermission(user.Roles, auth.PermWorkflowAdmin)
}

// NewSubstitutionHandler creates a SubstitutionHandler.
func NewSubstitutionHandler(svc substitutionService, logger zerolog.Logger) *SubstitutionHandler {
	return &SubstitutionHandler{
		svc:    svc,
		logger: logger.With().Str("handler", "workflow_substitution").Logger(),
	}
}

// Routes mounts the substitution routes.
//
//	GET    /me                 -> list the caller's own OOO history
//	PUT    /me                 -> set the caller's own OOO deputy window
//	DELETE /me                 -> clear the caller's own OOO window
//	GET    /users/{userId}     -> list a user's OOO history (admin view)
//	PUT    /users/{userId}     -> set a user's OOO deputy window (admin)
//	DELETE /users/{userId}     -> clear a user's OOO window (admin)
func (h *SubstitutionHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/me", h.ListMine)
	r.Put("/me", h.SetMine)
	r.Delete("/me", h.ClearMine)

	r.Get("/users/{userId}", h.ListForUser)
	r.Put("/users/{userId}", h.SetForUser)
	r.Delete("/users/{userId}", h.ClearForUser)

	return r
}

// setSubstitutionRequest is the body for setting an OOO window.
type setSubstitutionRequest struct {
	DeputyID string    `json:"deputy_id"`
	From     time.Time `json:"from"`
	To       time.Time `json:"to"`
	Reason   string    `json:"reason"`
}

func (h *SubstitutionHandler) set(w http.ResponseWriter, r *http.Request, targetUserID string) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	if !canTargetOtherUser(user, targetUserID) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "setting another user's out-of-office deputy requires workflow:admin")
		return
	}
	var req setSubstitutionRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if req.DeputyID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "deputy_id is required")
		return
	}
	if req.To.Before(req.From) {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "to must not be before from")
		return
	}
	if req.DeputyID == targetUserID {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "a user cannot be their own deputy")
		return
	}
	sub, err := h.svc.SetSubstitution(r.Context(), user.TenantID, targetUserID, req.DeputyID, req.From, req.To, req.Reason, user.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sub)
}

func (h *SubstitutionHandler) clear(w http.ResponseWriter, r *http.Request, targetUserID string) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	if !canTargetOtherUser(user, targetUserID) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "clearing another user's out-of-office deputy requires workflow:admin")
		return
	}
	if err := h.svc.ClearSubstitution(r.Context(), user.TenantID, targetUserID); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "out-of-office cleared"})
}

func (h *SubstitutionHandler) list(w http.ResponseWriter, r *http.Request, targetUserID string) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	subs, err := h.svc.ListForUser(r.Context(), user.TenantID, targetUserID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	if subs == nil {
		subs = []*model.Substitution{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": subs})
}

// SetMine handles PUT /me.
func (h *SubstitutionHandler) SetMine(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	h.set(w, r, user.ID)
}

// ClearMine handles DELETE /me.
func (h *SubstitutionHandler) ClearMine(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	h.clear(w, r, user.ID)
}

// ListMine handles GET /me.
func (h *SubstitutionHandler) ListMine(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	h.list(w, r, user.ID)
}

// SetForUser handles PUT /users/{userId} (admin sets another user's deputy).
func (h *SubstitutionHandler) SetForUser(w http.ResponseWriter, r *http.Request) {
	h.set(w, r, urlParam(r, "userId"))
}

// ClearForUser handles DELETE /users/{userId}.
func (h *SubstitutionHandler) ClearForUser(w http.ResponseWriter, r *http.Request) {
	h.clear(w, r, urlParam(r, "userId"))
}

// ListForUser handles GET /users/{userId}.
func (h *SubstitutionHandler) ListForUser(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, urlParam(r, "userId"))
}
