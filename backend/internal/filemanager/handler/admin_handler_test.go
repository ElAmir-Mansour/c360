package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/auth"
)

func TestAdminHandlerRequireAdmin_AllowsTenantAdminFilesPermission(t *testing.T) {
	h := &AdminHandler{}
	req := httptest.NewRequest("GET", "/api/v1/files/quarantine", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "user-1",
		TenantID: "tenant-1",
		Roles:    []string{"tenant-admin"},
	}))
	rec := httptest.NewRecorder()

	if !h.requireAdmin(rec, req) {
		t.Fatal("tenant-admin with files:* should pass file administration")
	}
}
