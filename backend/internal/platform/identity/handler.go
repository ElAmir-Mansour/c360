package identity

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
)

// PermSearch is the RBAC permission required to perform a cross-tenant user
// search. It is granted to super_admin (and matched by admin:* / *).
const PermSearch = "platform:identity:read"

const (
	defaultPerPage = 20
	maxPerPage     = 100
)

// Handler exposes the cross-tenant identity search endpoint for the platform
// admin console. It is self-contained: it owns its repository over the
// platform_core pool and is mounted directly onto the iam-service router.
type Handler struct {
	repo   Repository
	logger zerolog.Logger
}

// NewHandler constructs the identity Handler.
func NewHandler(repo Repository, logger zerolog.Logger) *Handler {
	return &Handler{repo: repo, logger: logger}
}

// Routes returns a chi.Router for the identity endpoints. The router applies
// RequirePermission(PermSearch); callers MUST mount it behind middleware.Auth so
// the user/claims are present in the request context.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.With(middleware.RequirePermission(PermSearch)).Get("/search", h.Search)
	return r
}

type paginationMeta struct {
	Page       int `json:"page"`
	PerPage    int `json:"per_page"`
	Total      int `json:"total"`
	TotalPages int `json:"total_pages"`
}

type paginatedResponse struct {
	Data any            `json:"data"`
	Meta paginationMeta `json:"meta"`
}

// Search handles GET /search?email&query&tenant_id?&status&page&per_page and
// returns a paginated list of AdminUserSummary across all tenants (or a single
// tenant when tenant_id is supplied).
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	if user := auth.UserFromContext(r.Context()); user == nil {
		h.writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "authentication required")
		return
	}

	q := r.URL.Query()
	page, perPage := parsePagination(q)

	params := SearchParams{
		Email:    q.Get("email"),
		Query:    q.Get("query"),
		TenantID: q.Get("tenant_id"),
		Status:   q.Get("status"),
		Page:     page,
		PerPage:  perPage,
	}

	results, total, err := h.repo.Search(r.Context(), params)
	if err != nil {
		h.logger.Error().Err(err).Msg("cross-tenant user search failed")
		h.writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "internal server error")
		return
	}

	totalPages := total / perPage
	if total%perPage != 0 {
		totalPages++
	}
	if totalPages < 1 {
		totalPages = 1
	}

	h.writeJSON(w, http.StatusOK, paginatedResponse{
		Data: results,
		Meta: paginationMeta{
			Page:       page,
			PerPage:    perPage,
			Total:      total,
			TotalPages: totalPages,
		},
	})
}

func parsePagination(q map[string][]string) (page, perPage int) {
	page = 1
	perPage = defaultPerPage

	if vs := q["page"]; len(vs) > 0 {
		if v, err := strconv.Atoi(vs[0]); err == nil && v > 0 {
			page = v
		}
	}
	if vs := q["per_page"]; len(vs) > 0 {
		if v, err := strconv.Atoi(vs[0]); err == nil && v > 0 {
			if v > maxPerPage {
				v = maxPerPage
			}
			perPage = v
		}
	}
	return page, perPage
}

func (h *Handler) writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func (h *Handler) writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":  status,
		"code":    code,
		"message": message,
	})
}
