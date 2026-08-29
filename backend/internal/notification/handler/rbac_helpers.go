package handler

import (
	"net/http"

	"github.com/clario360/platform/internal/auth"
)

// requireNotificationsManage is a cheap handler-level defense-in-depth check for
// the notification control-plane routes (webhook CRUD/test/rotate, delivery-log
// inspection + retry, operational test-send, delivery-stats, retry-failed).
//
// The router already gates these routes with
// middleware.RequirePermission(auth.PermNotificationsManage); re-checking here
// means a future refactor that accidentally drops the middleware (or mounts a
// handler on an ungated path) still fails closed instead of exposing the
// tenant-wide integrations surface. It writes a 403 and returns false when the
// caller lacks the permission (or is unauthenticated), true otherwise.
func requireNotificationsManage(w http.ResponseWriter, r *http.Request) bool {
	user := auth.UserFromContext(r.Context())
	if user == nil || !auth.HasPermission(user.Roles, auth.PermNotificationsManage) {
		writeErrorResponse(w, http.StatusForbidden, "FORBIDDEN", "notifications:manage permission required", r)
		return false
	}
	return true
}
