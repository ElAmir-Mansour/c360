package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/pricing/export"
	"github.com/clario360/platform/internal/pricing/model"
	"github.com/clario360/platform/internal/pricing/repository"
	"github.com/clario360/platform/internal/pricing/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// quoteRoutes registers the quote surface onto the pricing router. Gating:
//
//	POST /quotes                    pricing:write (create)
//	GET  /quotes                    pricing:read+ (list, masked)
//	GET  /quotes/{id}               pricing:read+ (internal view only for pricing:admin)
//	POST /quotes/{id}/send          pricing:write (blocked if below floor + no override)
//	POST /quotes/{id}/accept        pricing:write (same floor gate)
//	POST /quotes/{id}/reject        pricing:write
//	POST /quotes/{id}/override-floor pricing:admin
//	POST /quotes/{id}/provision     pricing:admin (closes the commercial loop:
//	                                 assigns the tier plan to the linked tenant)
//	GET  /quotes/{id}/export         pricing:read+ (rendered through the MASKED DTO)
func (h *Handler) quoteRoutes(r chi.Router) {
	r.Route("/quotes", func(r chi.Router) {
		r.With(anyPricing()).Get("/", h.listQuotes)
		r.With(writePricing()).Post("/", h.createQuote)

		r.Route("/{id}", func(r chi.Router) {
			r.With(anyPricing()).Get("/", h.getQuote)
			r.With(anyPricing()).Get("/export", h.exportQuote)
			r.With(writePricing()).Post("/send", h.sendQuote)
			r.With(writePricing()).Post("/accept", h.acceptQuote)
			r.With(writePricing()).Post("/reject", h.rejectQuote)
			r.With(adminPricing()).Post("/override-floor", h.overrideFloor)
			r.With(adminPricing()).Post("/provision", h.provisionQuote)
		})
	})
}

// writeQuoteServiceError maps quote-specific sentinels on top of the shared config
// error mapping.
func (h *Handler) writeQuoteServiceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, model.ErrBelowFloorBlocked):
		suiteapi.WriteError(w, r, http.StatusConflict, "below_floor", err.Error(), nil)
	case errors.Is(err, model.ErrInvalidTransition):
		suiteapi.WriteError(w, r, http.StatusConflict, "invalid_transition", err.Error(), nil)
	case errors.Is(err, model.ErrNotProvisionable):
		// The quote is not in a provisionable state (not accepted / no tenant /
		// no tier). 409 — the client can fix state (accept it, link a tenant).
		suiteapi.WriteError(w, r, http.StatusConflict, "not_provisionable", err.Error(), nil)
	case errors.Is(err, model.ErrTierUnmapped):
		// The selected tier has no mapped license plan — a configuration gap.
		// 422: the request is well-formed but cannot be fulfilled fail-closed.
		suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "tier_unmapped", err.Error(), nil)
	case errors.Is(err, service.ErrProvisioningUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "provisioning_unavailable", err.Error(), nil)
	case errors.Is(err, model.ErrInvalidQuote), errors.Is(err, model.ErrNoSelectedTier):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "invalid", err.Error(), nil)
	default:
		h.writeServiceError(w, r, err)
	}
}

// --- Create ------------------------------------------------------------------

// createQuoteRequest is the client body. It carries ONLY inputs + commercial
// linkage + an optional selected tier. It intentionally has NO field for tier
// numbers/totals: the server recomputes from the active config, so any client
// attempt to supply prices is structurally ignored (unknown fields are rejected
// by DecodeJSON, and the struct has no tier-number field to bind them to anyway).
type createQuoteRequest struct {
	Model         model.Model      `json:"model"`
	Deployment    model.Deployment `json:"deployment"`
	TermMonths    int              `json:"term_months"`
	Users         int64            `json:"users"`
	Cores         int64            `json:"cores"`
	VMs           int64            `json:"vms"`
	HotStorageGB  float64          `json:"hot_storage_gb"`
	ColdStorageGB float64          `json:"cold_storage_gb"`
	SalesDiscount *float64         `json:"sales_discount,omitempty"`

	TenantID     *string     `json:"tenant_id,omitempty"`
	LeadID       *string     `json:"lead_id,omitempty"`
	AccountName  string      `json:"account_name,omitempty"`
	SelectedTier *model.Tier `json:"selected_tier,omitempty"`
	ValidUntil   *time.Time  `json:"valid_until,omitempty"`
}

func (h *Handler) createQuote(w http.ResponseWriter, r *http.Request) {
	var req createQuoteRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	in := model.Inputs{
		Model:         req.Model,
		Deployment:    req.Deployment,
		TermMonths:    req.TermMonths,
		Users:         req.Users,
		Cores:         req.Cores,
		VMs:           req.VMs,
		HotStorageGB:  req.HotStorageGB,
		ColdStorageGB: req.ColdStorageGB,
		SalesDiscount: req.SalesDiscount,
	}
	quote, err := h.svc.CreateQuote(r.Context(), service.CreateQuoteInput{
		Inputs:       in,
		TenantID:     req.TenantID,
		LeadID:       req.LeadID,
		AccountName:  req.AccountName,
		SelectedTier: req.SelectedTier,
		ValidUntil:   req.ValidUntil,
		CreatedBy:    callerID(r),
	})
	if err != nil {
		h.writeQuoteServiceError(w, r, err)
		return
	}
	h.writeQuote(w, r, http.StatusCreated, quote)
}

// --- Read --------------------------------------------------------------------

func (h *Handler) listQuotes(w http.ResponseWriter, r *http.Request) {
	page, perPage := suiteapi.ParsePagination(r)
	f := repository.QuoteFilter{
		Status:   r.URL.Query().Get("status"),
		TenantID: r.URL.Query().Get("tenant_id"),
		Model:    r.URL.Query().Get("model"),
		Limit:    perPage,
		Offset:   (page - 1) * perPage,
	}
	quotes, total, err := h.svc.ListQuotes(r.Context(), f)
	if err != nil {
		h.writeQuoteServiceError(w, r, err)
		return
	}
	admin := callerIsPricingAdmin(r)
	// List serializes the masked or internal view per role, item by item.
	if admin {
		out := make([]*model.StoredQuote, 0, len(quotes))
		out = append(out, quotes...)
		suiteapi.WritePaginated(w, http.StatusOK, out, page, perPage, total)
		return
	}
	out := make([]model.ClientView, 0, len(quotes))
	for _, q := range quotes {
		out = append(out, q.Client())
	}
	suiteapi.WritePaginated(w, http.StatusOK, out, page, perPage, total)
}

func (h *Handler) getQuote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	quote, err := h.svc.GetQuote(r.Context(), id)
	if err != nil {
		h.writeQuoteServiceError(w, r, err)
		return
	}
	h.writeQuote(w, r, http.StatusOK, quote)
}

// writeQuote serializes a quote by role: pricing:admin gets the full internal
// StoredQuote (computed_tiers carry the internal block); everyone else gets the
// masked ClientView, whose tiers PHYSICALLY lack the internal block.
func (h *Handler) writeQuote(w http.ResponseWriter, r *http.Request, status int, q *model.StoredQuote) {
	if callerIsPricingAdmin(r) {
		suiteapi.WriteData(w, status, q)
		return
	}
	suiteapi.WriteData(w, status, q.Client())
}

// --- State machine -----------------------------------------------------------

func (h *Handler) sendQuote(w http.ResponseWriter, r *http.Request) {
	h.doTransition(w, r, h.svc.SendQuote)
}

func (h *Handler) acceptQuote(w http.ResponseWriter, r *http.Request) {
	h.doTransition(w, r, h.svc.AcceptQuote)
}

func (h *Handler) rejectQuote(w http.ResponseWriter, r *http.Request) {
	h.doTransition(w, r, h.svc.RejectQuote)
}

func (h *Handler) doTransition(w http.ResponseWriter, r *http.Request, fn func(ctx context.Context, id, actor string) (*model.StoredQuote, error)) {
	id := chi.URLParam(r, "id")
	quote, err := fn(r.Context(), id, callerID(r))
	if err != nil {
		h.writeQuoteServiceError(w, r, err)
		return
	}
	h.writeQuote(w, r, http.StatusOK, quote)
}

func (h *Handler) overrideFloor(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	quote, err := h.svc.OverrideFloor(r.Context(), id, callerID(r))
	if err != nil {
		h.writeQuoteServiceError(w, r, err)
		return
	}
	h.writeQuote(w, r, http.StatusOK, quote)
}

// provisionQuote is the DIRECT-apply loop close (pricing:admin): for an ACCEPTED
// quote linked to a tenant_id it resolves the selected tier to a license plan
// and assigns that plan to the tenant, carrying the tier's AI allowance into the
// tenant's entitlement/usage. Fail-closed: 409 if the quote is not accepted /
// tenant-less, 422 if the tier is unmapped, 503 if provisioning is not wired.
// The response carries the (masked/internal by role) quote plus the plan key it
// was provisioned to.
func (h *Handler) provisionQuote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	quote, planKey, err := h.svc.ProvisionFromQuote(r.Context(), id, callerID(r))
	if err != nil {
		h.writeQuoteServiceError(w, r, err)
		return
	}
	// Serialize the quote by role (admin -> internal, else masked) alongside the
	// resolved plan key so the caller can confirm what was assigned.
	body := map[string]any{"plan_key": planKey}
	if callerIsPricingAdmin(r) {
		body["quote"] = quote
	} else {
		body["quote"] = quote.Client()
	}
	suiteapi.WriteData(w, http.StatusOK, body)
}

// --- Export ------------------------------------------------------------------

func (h *Handler) exportQuote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	formatStr := r.URL.Query().Get("format")
	if formatStr == "" {
		formatStr = string(export.FormatPDF)
	}
	format, ok := export.ParseFormat(formatStr)
	if !ok {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_format", "format must be pdf or xlsx", nil)
		return
	}
	quote, err := h.svc.GetQuote(r.Context(), id)
	if err != nil {
		h.writeQuoteServiceError(w, r, err)
		return
	}

	// GOVERNANCE: the export is ALWAYS rendered from the MASKED ClientView,
	// regardless of the caller's role. Even a pricing:admin export is client-
	// facing by construction (export.Render takes a ClientView, which cannot
	// carry the internal margin block). This is not a role check — it is the
	// only type the exporter accepts.
	rendered, err := export.Render(format, quote.Client())
	if err != nil {
		h.logger.Error().Err(err).Str("quote_id", id).Str("format", string(format)).Msg("quote export failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "export_failed", "failed to render export", nil)
		return
	}

	w.Header().Set("Content-Type", rendered.ContentType)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+rendered.Filename+"\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(rendered.Bytes)
}

// anyPricing / writePricing / adminPricing centralize the RBAC middleware used
// by the quote routes so the gating reads at the route table.
func anyPricing() func(http.Handler) http.Handler {
	return middleware.RequireAnyPermission(PermPricingRead, PermPricingWrite, PermPricingAdmin)
}
func writePricing() func(http.Handler) http.Handler {
	return middleware.RequirePermission(PermPricingWrite)
}
func adminPricing() func(http.Handler) http.Handler {
	return middleware.RequirePermission(PermPricingAdmin)
}
