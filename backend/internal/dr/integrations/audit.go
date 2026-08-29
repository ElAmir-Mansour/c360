package integrations

import (
	"context"

	"github.com/google/uuid"
)

// CredentialAccessReason names WHY an integration's stored credentials were
// decrypted, for the audit trail.
type CredentialAccessReason string

const (
	// CredentialAccessResolve is a decryption to build a live connector for a DR
	// factory (ResolveActive) — i.e. credentials being USED to drive recovery.
	CredentialAccessResolve CredentialAccessReason = "resolve_active"
	// CredentialAccessTest is a decryption to run an operator-triggered
	// connectivity test (TestConnection).
	CredentialAccessTest CredentialAccessReason = "test_connection"
)

// CredentialAccessEvent describes a single decryption of an integration's stored
// credential bundle. It carries NO secret material — only WHO (tenant), WHICH
// integration, and WHY — so it is safe to persist in a durable, replayable audit
// trail. The platform's sovereign WORM/governance posture expects custody
// material access to leave such a trail.
type CredentialAccessEvent struct {
	TenantID      uuid.UUID
	IntegrationID uuid.UUID
	Vendor        string
	Kind          Kind
	Reason        CredentialAccessReason
}

// AuditSink records credential-access events to a durable audit trail. The cmd/
// bridge wires an outbox-backed sink (events staged in-transaction and relayed
// to the DR events topic); the package default is a no-op so the catalog and its
// tests run without one. Implementations MUST treat recording as best-effort
// from the caller's perspective — a sink failure must not fail the resolve/test
// path (recovery must not be blocked because an audit write could not be made),
// so a real sink logs its own errors internally.
type AuditSink interface {
	CredentialAccessed(ctx context.Context, ev CredentialAccessEvent)
}

// noopAuditSink discards events. It is the default when no sink is configured.
type noopAuditSink struct{}

func (noopAuditSink) CredentialAccessed(context.Context, CredentialAccessEvent) {}
