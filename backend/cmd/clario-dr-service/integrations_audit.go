package main

// integrations_audit.go provides the production AuditSink for the DR integrations
// catalog: every time a stored credential bundle is decrypted (to resolve a live
// connector or to run a connectivity test), a secret-free audit event is staged
// in the transactional outbox and relayed to the DR events topic — giving the
// platform's sovereign WORM/governance trail a durable record of credential
// custody access. Recording is best-effort from the caller's perspective: a
// failure to stage the event is logged but never fails the resolve/test path, so
// a recovery is never blocked because an audit write could not be made.

import (
	"context"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/integrations"
	drrepo "github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const (
	integrationsEventSource           = "clario-dr-service/integrations"
	integrationCredentialAccessedType = "com.clario360.datastream.dr.integration.credential_accessed"
)

// outboxAuditSink stages credential-access events in the transactional outbox.
type outboxAuditSink struct {
	runner integrations.TenantRunner
	topic  string
	logger zerolog.Logger
}

// newOutboxAuditSink builds the production audit sink over the DR events topic.
func newOutboxAuditSink(runner integrations.TenantRunner, logger zerolog.Logger) outboxAuditSink {
	return outboxAuditSink{
		runner: runner,
		topic:  events.Topics.DREvents,
		logger: logger.With().Str("component", "dr_integrations_audit").Logger(),
	}
}

// CredentialAccessed stages one secret-free audit event in its own tenant-scoped
// write transaction. The event carries the tenant, integration id, vendor, kind,
// and reason — never any credential material. A staging failure is logged and
// swallowed so the resolve/test path is not blocked.
func (a outboxAuditSink) CredentialAccessed(ctx context.Context, ev integrations.CredentialAccessEvent) {
	err := a.runner.RunWithTenant(ctx, ev.TenantID, func(db drrepo.DBTX) error {
		evt, berr := events.NewEvent(
			integrationCredentialAccessedType,
			integrationsEventSource,
			ev.TenantID.String(),
			map[string]any{
				"tenant_id":      ev.TenantID.String(),
				"integration_id": ev.IntegrationID.String(),
				"vendor":         ev.Vendor,
				"kind":           string(ev.Kind),
				"reason":         string(ev.Reason),
			},
		)
		if berr != nil {
			return berr
		}
		return outbox.Write(ctx, db, a.topic, evt)
	})
	if err != nil {
		a.logger.Error().Err(err).
			Str("integration_id", ev.IntegrationID.String()).
			Str("tenant_id", ev.TenantID.String()).
			Str("reason", string(ev.Reason)).
			Msg("failed to record integration credential-access audit event")
	}
}

// Compile-time assertion that the outbox sink satisfies the catalog's AuditSink.
var _ integrations.AuditSink = outboxAuditSink{}
