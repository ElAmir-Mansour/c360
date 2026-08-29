package admin

import (
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	gwconfig "github.com/clario360/platform/internal/gateway/config"
	"github.com/clario360/platform/internal/gateway/proxy"
	"github.com/clario360/platform/internal/gateway/ratelimit"
	mw "github.com/clario360/platform/internal/middleware"
)

// Handler serves the authenticated gateway admin API (G13/G18/G19/G20). It is
// mounted under /api/v1/gateway/admin behind Auth + RequirePermission and is
// distinct from the unauthenticated /api/v1/gateway/status surface.
type Handler struct {
	routes     []gwconfig.RouteConfig
	router     *proxy.Router
	killSwitch *KillSwitchStore
	rlConfig   ratelimit.Config
	rdb        *redis.Client
	logger     zerolog.Logger
}

// NewHandler builds the gateway admin handler.
func NewHandler(
	routes []gwconfig.RouteConfig,
	router *proxy.Router,
	killSwitch *KillSwitchStore,
	rlConfig ratelimit.Config,
	rdb *redis.Client,
	logger zerolog.Logger,
) *Handler {
	return &Handler{
		routes:     routes,
		router:     router,
		killSwitch: killSwitch,
		rlConfig:   rlConfig,
		rdb:        rdb,
		logger:     logger,
	}
}

// Mount registers the admin routes on the supplied chi router. The caller is
// responsible for wrapping the group in Auth; this method applies the granular
// RequirePermission gates per the contract (read vs admin).
func (h *Handler) Mount(r chi.Router) {
	// G13 — route map (read).
	r.With(mw.RequirePermission("platform:gateway:read")).
		Get("/routes", h.listRoutes)

	// G18 — circuit breakers.
	r.With(mw.RequirePermission("platform:gateway:read")).
		Get("/circuit", h.listCircuits)
	r.With(mw.RequirePermission("platform:gateway:admin")).
		Post("/circuit/{service}", h.controlCircuit)

	// G19 — kill switches (admin only for both read and write — they are control surfaces).
	r.With(mw.RequirePermission("platform:gateway:admin")).
		Get("/killswitch", h.listKillSwitches)
	r.With(mw.RequirePermission("platform:gateway:admin")).
		Post("/killswitch", h.setKillSwitch)

	// G20 — rate limits.
	r.With(mw.RequirePermission("platform:gateway:read")).
		Get("/ratelimits", h.listRateLimits)
	r.With(mw.RequirePermission("platform:gateway:read")).
		Get("/ratelimits/tenants/{tenantId}", h.getTenantTier)
	r.With(mw.RequirePermission("platform:gateway:admin")).
		Put("/ratelimits/tenants/{tenantId}", h.putTenantTier)
}

// ── G13: routes ────────────────────────────────────────────────────────────

type routeView struct {
	Prefix      string                 `json:"prefix"`
	Service     string                 `json:"service"`
	Public      bool                   `json:"public"`
	Group       gwconfig.EndpointGroup `json:"group"`
	Entitlement string                 `json:"entitlement,omitempty"`
	MaxBodyMB   int                    `json:"maxBodyMb,omitempty"`
	TimeoutSec  int                    `json:"timeoutSec,omitempty"`
	Contract    *contractView          `json:"contract,omitempty"`
}

type contractView struct {
	ID         string `json:"id,omitempty"`
	Version    string `json:"version,omitempty"`
	APIVersion string `json:"apiVersion,omitempty"`
	Phase      string `json:"phase,omitempty"`
	FailClosed bool   `json:"failClosed,omitempty"`
}

func (h *Handler) listRoutes(w http.ResponseWriter, r *http.Request) {
	out := make([]routeView, 0, len(h.routes))
	for _, rc := range h.routes {
		v := routeView{
			Prefix:      rc.Prefix,
			Service:     rc.Service,
			Public:      rc.Public,
			Group:       rc.EndpointGroup,
			Entitlement: rc.Entitlement,
			MaxBodyMB:   rc.MaxBodyMB,
			TimeoutSec:  rc.TimeoutSec,
		}
		if rc.Contract != (gwconfig.ContractIntent{}) {
			v.Contract = &contractView{
				ID:         rc.Contract.ID,
				Version:    rc.Contract.Version,
				APIVersion: rc.Contract.APIVersion,
				Phase:      rc.Contract.Phase,
				FailClosed: rc.Contract.FailClosed,
			}
		}
		out = append(out, v)
	}
	writeJSON(w, http.StatusOK, out)
}

// ── G18: circuit breakers ──────────────────────────────────────────────────

type circuitView struct {
	Service             string  `json:"service"`
	State               string  `json:"state"`
	ConsecutiveFailures int     `json:"consecutiveFailures"`
	LastStateChange     *string `json:"lastStateChange,omitempty"`
	Forced              bool    `json:"forced"`
}

func (h *Handler) listCircuits(w http.ResponseWriter, r *http.Request) {
	proxies := h.router.Proxies()
	out := make([]circuitView, 0, len(proxies))
	for name, rp := range proxies {
		snap := rp.Breaker().Snapshot()
		v := circuitView{
			Service:             name,
			State:               snap.State.String(),
			ConsecutiveFailures: snap.ConsecutiveFailures,
			Forced:              snap.Forced,
		}
		if !snap.LastStateChange.IsZero() {
			ts := snap.LastStateChange.UTC().Format(time.RFC3339Nano)
			v.LastStateChange = &ts
		}
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Service < out[j].Service })
	writeJSON(w, http.StatusOK, out)
}

type circuitControlRequest struct {
	Action string `json:"action"`
}

func (h *Handler) controlCircuit(w http.ResponseWriter, r *http.Request) {
	service := chi.URLParam(r, "service")
	rp, ok := h.router.GetProxy(service)
	if !ok {
		writeError(w, http.StatusNotFound, "SERVICE_NOT_FOUND", "no such gateway service", mw.GetRequestID(r.Context()))
		return
	}

	var req circuitControlRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "request body must be valid JSON", mw.GetRequestID(r.Context()))
		return
	}

	breaker := rp.Breaker()
	switch req.Action {
	case "open":
		breaker.ForceOpen()
	case "close":
		breaker.ForceClose()
	case "reset":
		breaker.Reset()
	default:
		writeError(w, http.StatusBadRequest, "INVALID_ACTION", "action must be one of: open, close, reset", mw.GetRequestID(r.Context()))
		return
	}

	h.logger.Warn().
		Str("service", service).
		Str("action", req.Action).
		Str("actor", actorID(r)).
		Msg("gateway circuit breaker forced via admin API")

	snap := breaker.Snapshot()
	out := circuitView{
		Service:             service,
		State:               snap.State.String(),
		ConsecutiveFailures: snap.ConsecutiveFailures,
		Forced:              snap.Forced,
	}
	if !snap.LastStateChange.IsZero() {
		ts := snap.LastStateChange.UTC().Format(time.RFC3339Nano)
		out.LastStateChange = &ts
	}
	writeJSON(w, http.StatusOK, out)
}

// ── G19: kill switches ─────────────────────────────────────────────────────

func (h *Handler) listKillSwitches(w http.ResponseWriter, r *http.Request) {
	list, err := h.killSwitch.List(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, "KILL_SWITCH_STORE_ERROR", "could not read kill switches", mw.GetRequestID(r.Context()))
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *Handler) setKillSwitch(w http.ResponseWriter, r *http.Request) {
	var ks KillSwitch
	if err := json.NewDecoder(r.Body).Decode(&ks); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "request body must be valid JSON", mw.GetRequestID(r.Context()))
		return
	}
	if !ValidScope(ks.Scope) {
		writeError(w, http.StatusBadRequest, "INVALID_SCOPE", "scope must be one of: route, service, tenant, entitlement", mw.GetRequestID(r.Context()))
		return
	}
	if ks.Target == "" {
		writeError(w, http.StatusBadRequest, "INVALID_TARGET", "target is required", mw.GetRequestID(r.Context()))
		return
	}
	ks.UpdatedBy = actorID(r)
	if err := h.killSwitch.Set(r.Context(), ks); err != nil {
		writeError(w, http.StatusBadGateway, "KILL_SWITCH_STORE_ERROR", "could not persist kill switch", mw.GetRequestID(r.Context()))
		return
	}
	h.logger.Warn().
		Str("scope", string(ks.Scope)).
		Str("target", ks.Target).
		Bool("enabled", ks.Enabled).
		Str("reason", ks.Reason).
		Str("actor", ks.UpdatedBy).
		Msg("gateway kill switch updated via admin API")
	writeJSON(w, http.StatusOK, ks)
}

// ── G20: rate limits ───────────────────────────────────────────────────────

type rateLimitView struct {
	Defaults map[string]groupLimitView            `json:"defaults"`
	Tiers    map[string]map[string]groupLimitView `json:"tiers"`
}

type groupLimitView struct {
	RequestsPerWindow int     `json:"requestsPerWindow"`
	WindowSeconds     float64 `json:"windowSeconds"`
	BurstPerSecond    int     `json:"burstPerSecond"`
}

func (h *Handler) listRateLimits(w http.ResponseWriter, r *http.Request) {
	defaults := map[string]groupLimitView{}
	for group, gl := range h.rlConfig.Groups {
		defaults[string(group)] = groupLimitView{
			RequestsPerWindow: gl.RequestsPerWindow,
			WindowSeconds:     gl.Window.Seconds(),
			BurstPerSecond:    gl.BurstPerSecond,
		}
	}

	tiers := map[string]map[string]groupLimitView{}
	groups := []gwconfig.EndpointGroup{
		gwconfig.EndpointGroupAuth, gwconfig.EndpointGroupRead, gwconfig.EndpointGroupWrite,
		gwconfig.EndpointGroupAdmin, gwconfig.EndpointGroupUpload, gwconfig.EndpointGroupWS,
	}
	for tier, limits := range ratelimit.TierLimits {
		gm := map[string]groupLimitView{}
		for _, g := range groups {
			gl := limits.ToGroupLimit(g)
			gm[string(g)] = groupLimitView{
				RequestsPerWindow: gl.RequestsPerWindow,
				WindowSeconds:     gl.Window.Seconds(),
				BurstPerSecond:    gl.BurstPerSecond,
			}
		}
		tiers[string(tier)] = gm
	}

	writeJSON(w, http.StatusOK, rateLimitView{Defaults: defaults, Tiers: tiers})
}

type tenantTierView struct {
	TenantID string `json:"tenantId"`
	Tier     string `json:"tier"`
}

type putTenantTierRequest struct {
	Tier string `json:"tier"`
}

func (h *Handler) getTenantTier(w http.ResponseWriter, r *http.Request) {
	tenantID := chi.URLParam(r, "tenantId")
	tier := string(ratelimit.TierProfessional) // default applied by the resolver
	if h.rdb != nil {
		val, err := h.rdb.Get(r.Context(), "tenant_tier:"+tenantID).Result()
		if err == nil && val != "" {
			tier = val
		}
	}
	writeJSON(w, http.StatusOK, tenantTierView{TenantID: tenantID, Tier: tier})
}

func (h *Handler) putTenantTier(w http.ResponseWriter, r *http.Request) {
	tenantID := chi.URLParam(r, "tenantId")
	var req putTenantTierRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "request body must be valid JSON", mw.GetRequestID(r.Context()))
		return
	}
	tier := ratelimit.SubscriptionTier(req.Tier)
	switch tier {
	case ratelimit.TierFree, ratelimit.TierProfessional, ratelimit.TierEnterprise:
		// valid
	default:
		writeError(w, http.StatusBadRequest, "INVALID_TIER", "tier must be one of: free, professional, enterprise", mw.GetRequestID(r.Context()))
		return
	}
	if h.rdb == nil {
		writeError(w, http.StatusBadGateway, "TIER_STORE_ERROR", "tier store unavailable", mw.GetRequestID(r.Context()))
		return
	}
	if err := h.rdb.Set(r.Context(), "tenant_tier:"+tenantID, req.Tier, 0).Err(); err != nil {
		writeError(w, http.StatusBadGateway, "TIER_STORE_ERROR", "could not persist tenant tier", mw.GetRequestID(r.Context()))
		return
	}
	h.logger.Info().
		Str("tenant_id", tenantID).
		Str("tier", req.Tier).
		Str("actor", actorID(r)).
		Msg("gateway tenant rate-limit tier updated via admin API")
	writeJSON(w, http.StatusOK, tenantTierView{TenantID: tenantID, Tier: req.Tier})
}
