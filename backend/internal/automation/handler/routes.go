package handler

import (
	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
)

// RegisterRoutes mounts the Automation engine API under /api/v1/automation on r
// (DESIGN_Workflow_Forms_Automation.md §9).
//
// Two security regimes share the prefix:
//
//   - The inbound webhook route POST /webhooks/{token} is mounted FIRST, with NO
//     JWT and NO RBAC — it is token-authenticated (the path token is the
//     credential, resolved cross-tenant by the service). It must be registered
//     outside the authenticated group so the Auth middleware never rejects it.
//   - Everything else is mounted inside an Auth(jwt) + Tenant group, then gated
//     per-route by RequirePermission: reads -> automation:read, writes ->
//     automation:write, approval decisions -> automation:approve.
func RegisterRoutes(r chi.Router, h *Handler, jwtMgr *auth.JWTManager) {
	// --- Unauthenticated, token-authed webhook (no JWT, no RBAC) ---
	r.Post("/api/v1/automation/webhooks/{token}", h.Webhook)

	// --- Authenticated + per-route RBAC ---
	r.Route("/api/v1/automation", func(r chi.Router) {
		r.Use(middleware.Auth(jwtMgr))
		r.Use(middleware.Tenant)

		read := r.With(middleware.RequirePermission(auth.PermAutomationRead))
		write := r.With(middleware.RequirePermission(auth.PermAutomationWrite))
		approve := r.With(middleware.RequirePermission(auth.PermAutomationApprove))

		// Automations CRUD + manual invoke.
		write.Post("/automations", h.CreateAutomation)
		read.Get("/automations", h.ListAutomations)
		read.Get("/automations/{id}", h.GetAutomation)
		write.Put("/automations/{id}", h.UpdateAutomation)
		write.Delete("/automations/{id}", h.DeleteAutomation)
		write.Post("/automations/{id}/invoke", h.InvokeAutomation)

		// Runbooks.
		write.Post("/runbooks", h.CreateRunbook)
		read.Get("/runbooks/{id}", h.GetRunbook)

		// Runs + execution log + gate decisions + replay.
		read.Get("/runs", h.ListRuns)
		read.Get("/runs/{id}", h.GetRun)
		approve.Post("/runs/{id}/approve", h.ApproveRun)
		approve.Post("/runs/{id}/reject", h.RejectRun)
		write.Post("/runs/{id}/replay", h.ReplayRun)
	})
}
