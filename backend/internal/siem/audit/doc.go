// Package audit wires the siem-service to the platform audit chain.
//
// The platform-wide audit chain is implemented as an in-process
// AuditService in backend/internal/audit/service which buffers entries,
// computes a per-tenant hash chain, and batch-inserts them into
// audit_db. SIEM-01 has no admin actions to emit yet, so this package
// only provides:
//
//   - Emitter      — interface every future siem admin action will call.
//   - InMemory     — test implementation that captures emitted entries.
//   - NoOp         — production default until SIEM-04 wires an event
//     producer-backed implementation.
//
// The single unit test asserts that constructing a synthetic
// "siem.bootstrap" AuditEntry and routing it through the in-memory
// emitter preserves every field — proving that downstream prompts can
// rely on this seam.
package audit
