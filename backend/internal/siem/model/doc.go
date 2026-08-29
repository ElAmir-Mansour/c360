// Package model holds the SIEM domain types that are shared across the
// repository, service, handler, consumer and producer layers.
//
// The package exposes the shared primitives used by the concrete SIEM
// domains:
//
//   - TenantID         — typed alias around the tenant string for clarity.
//   - Severity         — enumeration of normalized severity values.
//   - HealthCheck      — row backing siem.health_check used by the
//     readiness probe and by the repository test.
//   - MetaInfo         — payload returned by GET /api/v1/siem/_meta.
package model
