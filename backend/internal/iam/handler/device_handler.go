package handler

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	iamauth "github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/service"
)

// DeviceHandler exposes the authenticated trusted-device endpoints
// (POST/GET /api/v1/auth/devices).
type DeviceHandler struct {
	deviceSvc *service.DeviceService
	logger    zerolog.Logger
}

func NewDeviceHandler(deviceSvc *service.DeviceService, logger zerolog.Logger) *DeviceHandler {
	return &DeviceHandler{deviceSvc: deviceSvc, logger: logger}
}

func (h *DeviceHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.Register)
	r.Get("/", h.List)
	return r
}

// Register handles POST /api/v1/auth/devices.
func (h *DeviceHandler) Register(w http.ResponseWriter, r *http.Request) {
	user := iamauth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	tenantID := resolveTenantID(r, user)

	var req dto.DeviceRegisterRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// X-Device-Id header is the fallback fingerprint when the body omits it.
	deviceID := strings.TrimSpace(req.DeviceID)
	if deviceID == "" {
		deviceID = strings.TrimSpace(r.Header.Get("X-Device-Id"))
	}

	in := service.RegisterDeviceInput{
		DeviceID:  deviceID,
		Trusted:   req.Trusted != nil && *req.Trusted,
		UserAgent: resolveUserAgent(r, req.UserAgent),
		IPAddress: optionalString(getIPAddress(r)),
	}

	resp, err := h.deviceSvc.Register(r.Context(), tenantID, user.ID, in)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// List handles GET /api/v1/auth/devices.
func (h *DeviceHandler) List(w http.ResponseWriter, r *http.Request) {
	user := iamauth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	tenantID := resolveTenantID(r, user)

	resp, err := h.deviceSvc.List(r.Context(), tenantID, user.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// resolveTenantID prefers the tenant on the context (set by tenant middleware)
// and falls back to the tenant embedded in the user claims.
func resolveTenantID(r *http.Request, user *iamauth.ContextUser) string {
	if tid := iamauth.TenantFromContext(r.Context()); tid != "" {
		return tid
	}
	return user.TenantID
}

// resolveUserAgent prefers an explicit body value, then the request header.
func resolveUserAgent(r *http.Request, fromBody *string) *string {
	if fromBody != nil && strings.TrimSpace(*fromBody) != "" {
		return fromBody
	}
	if ua := strings.TrimSpace(r.UserAgent()); ua != "" {
		return &ua
	}
	return nil
}

func optionalString(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}
