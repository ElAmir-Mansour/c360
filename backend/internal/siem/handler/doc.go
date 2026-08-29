// Package handler is the HTTP surface of siem-service.
//
// SIEM exposes health/meta endpoints plus mounted admin subrouters:
//
//   - GET /api/v1/siem/_meta — returns build info and uptime, gated
//     by JWT auth and tenant context.
//
// Admin-only sub-paths (/sources, /parsers, /settings) are guarded by
// middleware.RequirePermission("siem:admin"). If a deployment omits a
// dependency, the router returns an explicit gated 501 instead of silently
// hiding the misconfiguration.
//
// Router exposes the chi sub-router; main.go mounts it at /api/v1/siem
// on the bootstrap-supplied router.
package handler
