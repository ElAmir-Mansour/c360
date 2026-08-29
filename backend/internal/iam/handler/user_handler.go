package handler

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	iamauth "github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/service"
)

type UserHandler struct {
	userSvc             *service.UserService
	dashboardPreference *service.DashboardPreferenceService
	logger              zerolog.Logger
}

func NewUserHandler(
	userSvc *service.UserService,
	dashboardPreference *service.DashboardPreferenceService,
	logger zerolog.Logger,
) *UserHandler {
	return &UserHandler{
		userSvc:             userSvc,
		dashboardPreference: dashboardPreference,
		logger:              logger,
	}
}

func (h *UserHandler) Routes() chi.Router {
	r := chi.NewRouter()

	// /users/me routes (must be before /{id} to avoid conflict)
	r.Get("/me", h.GetProfile)
	r.Put("/me", h.UpdateProfile)
	r.Get("/me/dashboard-preferences", h.GetDashboardPreferences)
	r.Put("/me/dashboard-preferences", h.UpdateDashboardPreferences)
	r.Delete("/me/dashboard-preferences", h.ResetDashboardPreferences)
	r.Put("/me/avatar", h.UpdateAvatar)
	r.Delete("/me/avatar", h.DeleteAvatar)
	r.Put("/me/password", h.ChangePassword)
	r.Get("/me/sessions", h.ListSessions)
	r.Delete("/me/sessions", h.DeleteSessions)
	r.Delete("/me/sessions/{id}", h.DeleteSession)
	r.Post("/me/mfa/enable", h.EnableMFA)
	r.Post("/me/mfa/verify-setup", h.VerifyMFASetup)
	r.Post("/me/mfa/disable", h.DisableMFA)

	// /users CRUD
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{id}", h.GetByID)
	r.Put("/{id}", h.Update)
	r.Delete("/{id}", h.Delete)
	r.Put("/{id}/status", h.UpdateStatus)

	return r
}

func (h *UserHandler) GetDashboardPreferences(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	resp, err := h.dashboardPreference.Get(r.Context(), currentUser.TenantID, currentUser.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *UserHandler) UpdateDashboardPreferences(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req dto.DashboardPreferenceRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	resp, err := h.dashboardPreference.Update(
		r.Context(),
		currentUser.TenantID,
		currentUser.ID,
		&req,
	)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *UserHandler) ResetDashboardPreferences(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if err := h.dashboardPreference.Reset(r.Context(), currentUser.TenantID, currentUser.ID); err != nil {
		handleServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if !iamauth.HasPermission(currentUser.Roles, "users:create") && !iamauth.HasPermission(currentUser.Roles, "users:*") {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	var req dto.AdminCreateUserRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp, err := h.userSvc.AdminCreateUser(r.Context(), currentUser.TenantID, &req, currentUser.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, resp)
}

func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	user := iamauth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	page, perPage := parsePagination(r)
	search := r.URL.Query().Get("search")
	// Support multi-value status: ?status=active&status=suspended
	statuses := r.URL.Query()["status"]
	status := strings.Join(statuses, ",")
	sort := r.URL.Query().Get("sort")
	order := r.URL.Query().Get("order")

	users, total, err := h.userSvc.List(r.Context(), user.TenantID, page, perPage, search, status, sort, order)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, paginatedResponse(users, total, page, perPage))
}

func (h *UserHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	userID := urlParam(r, "id")

	// Tenant-scoped read: a foreign-tenant UUID resolves to 404, not the target
	// user's PII (cross-tenant IDOR fix).
	resp, err := h.userSvc.GetByIDInTenant(r.Context(), currentUser.TenantID, userID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *UserHandler) InternalGetEmail(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Internal-Service") == "" {
		writeError(w, http.StatusUnauthorized, "internal access required")
		return
	}

	userID := urlParam(r, "id")
	resp, err := h.userSvc.GetByID(r.Context(), userID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"email": resp.Email})
}

func (h *UserHandler) InternalGetByEmail(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Internal-Service") == "" {
		writeError(w, http.StatusUnauthorized, "internal access required")
		return
	}

	email := strings.TrimSpace(r.URL.Query().Get("email"))
	tenantID := strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	if email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}

	resp, err := h.userSvc.GetByEmail(r.Context(), tenantID, email)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *UserHandler) Update(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	userID := urlParam(r, "id")

	// Allow self-update or admin
	if userID != currentUser.ID && !iamauth.HasPermission(currentUser.Roles, "users:*") {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	var req dto.UpdateUserRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Tenant-scoped: an admin (or self) can only update a user in their own
	// tenant; a foreign-tenant target resolves to 404.
	resp, err := h.userSvc.UpdateInTenant(r.Context(), currentUser.TenantID, userID, &req, currentUser.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *UserHandler) Delete(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if !iamauth.HasPermission(currentUser.Roles, "users:delete") && !iamauth.HasPermission(currentUser.Roles, "users:*") {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	userID := urlParam(r, "id")

	if err := h.userSvc.DeleteInTenant(r.Context(), currentUser.TenantID, userID, currentUser.ID); err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, dto.MessageResponse{Message: "user deleted"})
}

func (h *UserHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if !iamauth.HasPermission(currentUser.Roles, "users:update") && !iamauth.HasPermission(currentUser.Roles, "users:*") {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	userID := urlParam(r, "id")

	var req dto.UpdateStatusRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.userSvc.UpdateStatusInTenant(r.Context(), currentUser.TenantID, userID, &req, currentUser.ID); err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, dto.MessageResponse{Message: "user status updated"})
}

func (h *UserHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req dto.UpdateUserRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp, err := h.userSvc.Update(r.Context(), currentUser.ID, &req, currentUser.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *UserHandler) GetProfile(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	resp, err := h.userSvc.GetByID(r.Context(), currentUser.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

type updateAvatarRequest struct {
	// Avatar is a base64 image data URL: data:image/{png|jpeg|webp};base64,<data>.
	Avatar string `json:"avatar"`
}

// UpdateAvatar sets the current user's profile picture. The picture is stored
// inline as a validated data URL on users.avatar_url (mirrors the lex signature
// profile pattern) so every surface that already returns the user object — the
// header chip, sidebar footer, comment threads, admin user lists — shows it with
// no extra fetch. Client downscales to ~256px before upload; the server still
// enforces the MIME allowlist, magic bytes, and a hard size cap.
func (h *UserHandler) UpdateAvatar(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req updateAvatarRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	dataURL, err := parseAvatarDataURL(req.Avatar)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	resp, err := h.userSvc.SetAvatar(r.Context(), currentUser.ID, &dataURL, currentUser.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// DeleteAvatar clears the current user's profile picture, reverting every avatar
// surface to the initials fallback.
func (h *UserHandler) DeleteAvatar(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	resp, err := h.userSvc.SetAvatar(r.Context(), currentUser.ID, nil, currentUser.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// maxAvatarBytes caps the DECODED image size. A ~256px avatar is far smaller
// (tens of KB); this is a generous safety bound, matched to the lex signature cap.
const maxAvatarBytes = 512 * 1024

var avatarMIMEAllow = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
}

// parseAvatarDataURL validates a base64 image data URL against the MIME allowlist,
// the decoded-size cap, and the actual magic bytes (so a mislabeled or non-image
// payload can't be persisted and later served as an avatar). SVG is deliberately
// excluded — avatars are raster-only. Returns the normalized data URL to store.
func parseAvatarDataURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("avatar is required")
	}
	if !strings.HasPrefix(raw, "data:") {
		return "", fmt.Errorf("avatar must be a base64 image data URL")
	}
	comma := strings.IndexByte(raw, ',')
	if comma < 0 {
		return "", fmt.Errorf("malformed data URL")
	}
	header := raw[len("data:"):comma] // e.g. "image/png;base64"
	if !strings.Contains(header, ";base64") {
		return "", fmt.Errorf("avatar must be base64-encoded")
	}
	mime := strings.ToLower(strings.TrimSpace(strings.SplitN(header, ";", 2)[0]))
	if !avatarMIMEAllow[mime] {
		return "", fmt.Errorf("unsupported image type %q (allowed: png, jpeg, webp)", mime)
	}
	decoded, err := base64.StdEncoding.DecodeString(raw[comma+1:])
	if err != nil {
		return "", fmt.Errorf("avatar is not valid base64")
	}
	if len(decoded) == 0 {
		return "", fmt.Errorf("avatar image is empty")
	}
	if len(decoded) > maxAvatarBytes {
		return "", fmt.Errorf("avatar image exceeds %d KB", maxAvatarBytes/1024)
	}
	if !bytesMatchImageMIME(decoded, mime) {
		return "", fmt.Errorf("avatar bytes do not match the declared %s image", mime)
	}
	return raw, nil
}

// bytesMatchImageMIME confirms the decoded bytes begin with the magic signature
// of the declared image type.
func bytesMatchImageMIME(b []byte, mime string) bool {
	switch mime {
	case "image/png":
		return len(b) >= 8 && bytes.Equal(b[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a})
	case "image/jpeg":
		return len(b) >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff
	case "image/webp":
		return len(b) >= 12 && bytes.Equal(b[0:4], []byte("RIFF")) && bytes.Equal(b[8:12], []byte("WEBP"))
	}
	return false
}

func (h *UserHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req dto.ChangePasswordRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.userSvc.ChangePassword(r.Context(), currentUser.ID, &req); err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, dto.MessageResponse{Message: "password changed successfully"})
}

func (h *UserHandler) EnableMFA(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	resp, err := h.userSvc.EnableMFA(r.Context(), currentUser.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *UserHandler) VerifyMFASetup(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req dto.DisableMFARequest // reuse — same shape: {code: "123456"}
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.userSvc.VerifyMFASetup(r.Context(), currentUser.ID, req.Code); err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, dto.MessageResponse{Message: "MFA enabled successfully"})
}

func (h *UserHandler) DisableMFA(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req dto.DisableMFARequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.userSvc.DisableMFA(r.Context(), currentUser.ID, &req); err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, dto.MessageResponse{Message: "MFA disabled"})
}

func (h *UserHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	sessions, err := h.userSvc.ListSessions(
		r.Context(),
		currentUser.TenantID,
		currentUser.ID,
		currentUser.SessionID,
	)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, sessions)
}

func (h *UserHandler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if err := h.userSvc.DeleteSession(
		r.Context(),
		currentUser.TenantID,
		currentUser.ID,
		currentUser.SessionID,
		urlParam(r, "id"),
	); err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, dto.MessageResponse{Message: "session revoked"})
}

func (h *UserHandler) DeleteSessions(w http.ResponseWriter, r *http.Request) {
	currentUser := iamauth.UserFromContext(r.Context())
	if currentUser == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	excludeCurrent := r.URL.Query().Get("exclude_current") == "true"
	if err := h.userSvc.DeleteSessions(r.Context(), currentUser.TenantID, currentUser.ID, excludeCurrent); err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, dto.MessageResponse{Message: "sessions revoked"})
}
