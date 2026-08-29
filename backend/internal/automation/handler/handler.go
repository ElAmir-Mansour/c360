// Package handler exposes the Automation engine over HTTP under
// /api/v1/automation (DESIGN_Workflow_Forms_Automation.md §9, WP-13). It is a
// thin chi layer over the service: every request resolves the tenant (and, for
// writes, the user) from the JWT-populated context, decodes/validates the body,
// calls one service method, and maps the domain error to an HTTP status. The
// service owns all transactions, RLS, and the durable FSM; the handler owns only
// request/response shaping and RBAC routing.
//
// RBAC (middleware.RequirePermission): reads -> automation:read, writes ->
// automation:write, approval-gate decisions -> automation:approve. The inbound
// webhook route (POST /webhooks/{token}) is mounted OUTSIDE the JWT/RBAC group —
// it is token-authenticated (the path token IS the credential, resolved
// cross-tenant by the service), so it carries no JWT and no permission gate.
package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// Service is the request-path surface the handler drives. *service.
// AutomationService satisfies it; tests substitute a fake so the routes,
// auth/permission gating, and error mapping are exercised without a database.
type Service interface {
	// Automation CRUD.
	CreateAutomation(ctx context.Context, tenantID string, a *model.Automation) (*model.Automation, error)
	GetAutomationByID(ctx context.Context, tenantID, id string) (*model.Automation, error)
	ListAutomations(ctx context.Context, tenantID string) ([]*model.Automation, error)
	UpdateAutomation(ctx context.Context, tenantID, id string, a *model.Automation) (*model.Automation, error)
	DeleteAutomation(ctx context.Context, tenantID, id string) error

	// Runbook CRUD.
	CreateRunbook(ctx context.Context, tenantID string, rb *model.Runbook) (*model.Runbook, error)
	GetRunbookByID(ctx context.Context, tenantID, id string) (*model.Runbook, error)

	// Runs + execution log.
	ListRuns(ctx context.Context, tenantID string, limit, offset int) ([]*model.Run, error)
	GetRunWithLog(ctx context.Context, tenantID, runID string) (*service.RunWithLog, error)

	// Approval-gate decisions.
	ApproveRun(ctx context.Context, tenantID, runID, userID, comment string) (*model.ApprovalGate, error)
	RejectRun(ctx context.Context, tenantID, runID, userID, comment string) (*model.ApprovalGate, error)

	// Replay.
	Replay(ctx context.Context, tenantID, originalID string) (*model.Run, error)
}

// ManualInvoker fires a manual trigger for an automation. *trigger.ManualSource
// satisfies it (Invoke generates a fresh per-invocation EventID); the handler
// uses it for POST /automations/{id}/invoke so a manual run flows through the same
// exactly-once dispatcher as every other trigger source.
type ManualInvoker interface {
	Invoke(ctx context.Context, tenantID, automationID, userID string, body map[string]any) error
}

// WebhookHandler serves an inbound webhook for a given path token. *trigger.
// WebhookSource satisfies it (HandleToken resolves the token cross-tenant, parses
// the body, fires). The handler mounts it on the no-JWT webhook route.
type WebhookHandler interface {
	HandleToken(w http.ResponseWriter, r *http.Request, token string)
}

// Handler bundles the service + trigger sources the routes need.
type Handler struct {
	svc     Service
	invoker ManualInvoker
	webhook WebhookHandler
	logger  zerolog.Logger
}

// New constructs the Automation HTTP handler. svc is required; invoker and
// webhook may be nil only in a deployment that disables those routes (the route
// registration guards against a nil dependency by returning 503).
func New(svc Service, invoker ManualInvoker, webhook WebhookHandler, logger zerolog.Logger) *Handler {
	return &Handler{
		svc:     svc,
		invoker: invoker,
		webhook: webhook,
		logger:  logger.With().Str("component", "automation-handler").Logger(),
	}
}

// writeErr maps a domain error to an HTTP status + structured body. The mapping
// is exhaustive over the automation sentinel errors and falls back to 500 (with
// a logged cause) for anything unexpected, never leaking an internal message.
func (h *Handler) writeErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, model.ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", "resource not found", nil)
	case errors.Is(err, model.ErrAlreadyExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "ALREADY_EXISTS", cleanMsg(err), nil)
	case errors.Is(err, service.ErrNonReplayable):
		suiteapi.WriteError(w, r, http.StatusConflict, "NON_REPLAYABLE", cleanMsg(err), nil)
	case errors.Is(err, model.ErrConflict):
		suiteapi.WriteError(w, r, http.StatusConflict, "CONFLICT", cleanMsg(err), nil)
	case errors.Is(err, model.ErrInvalidTransition):
		suiteapi.WriteError(w, r, http.StatusConflict, "INVALID_TRANSITION", cleanMsg(err), nil)
	case errors.Is(err, model.ErrInvalidConfig):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", cleanMsg(err), nil)
	default:
		h.logger.Error().Err(err).Msg("automation request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "internal server error", nil)
	}
}

// tenant resolves the tenant id from context, writing a 401 and returning ok=false
// when absent (the Auth+Tenant middleware should have populated it).
func (h *Handler) tenant(w http.ResponseWriter, r *http.Request) (string, bool) {
	tid, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", err.Error(), nil)
		return "", false
	}
	return tid.String(), true
}

// userID resolves the authenticated user id (required for writes that record an
// actor: manual invoke and approval decisions).
func (h *Handler) userID(w http.ResponseWriter, r *http.Request) (string, bool) {
	uid, err := suiteapi.UserID(r)
	if err != nil || uid == nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "user context is required", nil)
		return "", false
	}
	return uid.String(), true
}

// cleanMsg returns the error message for client-safe (validation/conflict)
// errors. These messages are authored in the service to be safe to surface.
func cleanMsg(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
