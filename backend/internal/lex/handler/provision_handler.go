package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
)

// provisionRequest is the body of POST /internal/lex/provision. Called by the
// onboarding provisioner (service-to-service) when a tenant subscribes to Watheeq.
type provisionRequest struct {
	TenantID          string `json:"tenant_id"`
	AdminUserID       string `json:"admin_user_id"`
	IncludeSampleData bool   `json:"include_sample_data"`
}

type provisionResponse struct {
	TenantID string `json:"tenant_id"`
	Status   string `json:"status"`
}

// provisionLegalAffairsHandler applies the Legal Affairs starter template to a
// tenant via the wired ProvisionLegalAffairs hook. Service-token gated by the
// caller (see RegisterRoutes); this handler only validates the body. Idempotent:
// re-provisioning an already-provisioned tenant is a safe no-op.
func provisionLegalAffairsHandler(deps RouteDependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req provisionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeProvisionError(w, http.StatusBadRequest, "INVALID_BODY", "request body must be valid JSON")
			return
		}
		tenantID, err := uuid.Parse(req.TenantID)
		if err != nil || tenantID == uuid.Nil {
			writeProvisionError(w, http.StatusBadRequest, "INVALID_TENANT", "tenant_id must be a valid non-nil uuid")
			return
		}
		// admin_user_id is OPTIONAL: empty/absent => uuid.Nil (no admin to bootstrap),
		// which is NOT an error. A present-but-malformed value is a 400.
		var adminUserID uuid.UUID
		if req.AdminUserID != "" {
			adminUserID, err = uuid.Parse(req.AdminUserID)
			if err != nil {
				writeProvisionError(w, http.StatusBadRequest, "INVALID_ADMIN_USER", "admin_user_id must be a valid uuid when provided")
				return
			}
		}
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		if _, err := deps.ProvisionLegalAffairs(ctx, tenantID, adminUserID, req.IncludeSampleData); err != nil {
			writeProvisionError(w, http.StatusInternalServerError, "PROVISION_FAILED", err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(provisionResponse{TenantID: tenantID.String(), Status: "provisioned"})
	}
}

func writeProvisionError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": msg}})
}
