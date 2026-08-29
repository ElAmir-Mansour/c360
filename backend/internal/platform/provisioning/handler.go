// Package provisioning exposes the platform admin console's provisioning
// oversight API (GAP G24 from docs/platform-admin-console.md §E.5 screen 9).
//
// It surfaces a single fleet-wide list of tenants whose onboarding is still
// in flight (provisioning_status in pending|provisioning|failed) so the console
// can render its live provisioning ticker without polling the existing
// per-tenant GET /api/v1/admin/tenants/{id}/provision-status endpoint.
package provisioning

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/middleware"
	onboardingmodel "github.com/clario360/platform/internal/onboarding/model"
	onboardingrepo "github.com/clario360/platform/internal/onboarding/repository"
	"github.com/clario360/platform/internal/suiteapi"
)

const (
	// permConsole is the coarse platform-admin-console grant.
	permConsole = "admin:console"
	// permTenantsRead is the granular fleet read grant. Either permission
	// (or an admin:* / platform:* wildcard) admits the request.
	permTenantsRead = "platform:tenants:read"
)

// Lister is the repository contract the handler depends on. It is satisfied by
// *onboardingrepo.ProvisioningRepository, which is backed by the platform_core
// pool (the same svc.DBPool used to construct it in cmd/iam-service/main.go).
type Lister interface {
	ListInFlight(ctx context.Context, statuses []onboardingmodel.OnboardingProvisioningStatus) ([]onboardingrepo.InFlightItem, error)
}

// Handler maps HTTP to the provisioning-oversight repository query.
type Handler struct {
	repo   Lister
	logger zerolog.Logger
}

// New constructs a provisioning-oversight HTTP handler.
func New(repo Lister, logger zerolog.Logger) *Handler {
	return &Handler{repo: repo, logger: logger.With().Str("handler", "platform_provisioning").Logger()}
}

// Item is the JSON shape returned per in-flight tenant.
type Item struct {
	TenantID       string  `json:"tenant_id"`
	TenantName     string  `json:"tenant_name"`
	Status         string  `json:"status"`
	ProgressPct    int     `json:"progress_pct"`
	CurrentStep    *string `json:"current_step,omitempty"`
	TotalSteps     int     `json:"total_steps"`
	CompletedSteps int     `json:"completed_steps"`
	StartedAt      *string `json:"started_at,omitempty"`
	Error          *string `json:"error,omitempty"`
}

// Routes returns a router mounted by cmd/iam-service under /api/v1/admin.
// It registers GET /admin/provisioning gated behind admin:console OR
// platform:tenants:read (honouring admin:* / platform:* wildcards).
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireAnyPermission(permConsole, permTenantsRead))
		r.Get("/provisioning", h.listInFlight)
	})
	return r
}

func (h *Handler) listInFlight(w http.ResponseWriter, r *http.Request) {
	// status=in_flight (the only supported / default value) maps to the
	// pending|provisioning|failed set. Any other value falls back to the same
	// default rather than 400-ing, since the console only ever asks for the
	// in-flight cohort.
	items, err := h.repo.ListInFlight(r.Context(), inFlightStatuses())
	if err != nil {
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("list in-flight provisioning failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
		return
	}

	out := make([]Item, 0, len(items))
	for i := range items {
		out = append(out, toItem(items[i]))
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func inFlightStatuses() []onboardingmodel.OnboardingProvisioningStatus {
	return []onboardingmodel.OnboardingProvisioningStatus{
		onboardingmodel.OnboardingProvisioningPending,
		onboardingmodel.OnboardingProvisioningProvisioning,
		onboardingmodel.OnboardingProvisioningFailed,
	}
}

func toItem(in onboardingrepo.InFlightItem) Item {
	item := Item{
		TenantID:       in.TenantID.String(),
		TenantName:     in.TenantName,
		Status:         string(in.Status),
		ProgressPct:    in.ProgressPct,
		CurrentStep:    in.CurrentStep,
		TotalSteps:     in.TotalSteps,
		CompletedSteps: in.CompletedSteps,
		Error:          in.Error,
	}
	if in.StartedAt != nil {
		formatted := in.StartedAt.UTC().Format("2006-01-02T15:04:05Z07:00")
		item.StartedAt = &formatted
	}
	return item
}
