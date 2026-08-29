package monitor

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service/integration"
)

// integrationRotationRegistry is the seam the rotation scheduler drives. It is
// satisfied by *service.IntegrationRegistryService. Keeping it an interface (mirroring
// integrationSyncRegistry) lets the monitor be unit-tested with a fake and avoids
// importing the concrete service into the monitor's own type.
type integrationRotationRegistry interface {
	// ListTenantIDs enumerates tenants with at least one live endpoint.
	ListTenantIDs(ctx context.Context) ([]uuid.UUID, error)
	// List returns a tenant's endpoints (config is masked; the NON-secret rotation
	// fields — rotate_every_days, last_rotated metadata — echo verbatim, so the
	// scheduler reads the policy without ever touching a secret value).
	List(ctx context.Context, tenantID uuid.UUID, kind, status string) ([]model.IntegrationEndpoint, error)
	// EmitRotationReminder fires a reminder/expiry alert for one endpoint's
	// due/approaching secret fields (in-app + email seam). It is best-effort and
	// secret-free (field NAMES + timing only).
	EmitRotationReminder(ctx context.Context, tenantID, endpointID uuid.UUID, fields []integration.RotationField) error
	// AutoRotateSecret rotates ONE secret field to a fresh provider-minted value when
	// the endpoint opts into auto-rotation. The registry mints/sources the new secret
	// (e.g. via the secret-ref provider); the monitor never handles cleartext. A
	// connector kind that cannot auto-rotate returns a typed unsupported error the
	// monitor logs + skips. Returns whether a rotation actually happened.
	AutoRotateSecret(ctx context.Context, tenantID, endpointID uuid.UUID, field string) (rotated bool, err error)
}

// IntegrationRotationMonitor is the background ticker that enforces the integration
// secret ROTATION policy (#14). Each tick it scans every tenant's ACTIVE endpoints,
// evaluates each against its rotate_every_days cadence (vs the recorded
// last_rotated stamps), and for the due/approaching secret fields it:
//
//   - emits a rotation REMINDER + expiry alert (always), and
//   - AUTO-ROTATES the overdue fields when the endpoint opted in (auto_rotate=true).
//
// It mirrors IntegrationSyncMonitor exactly: Run/RunOnce + ticker, cross-tenant
// fan-out via ListTenantIDs, per-endpoint errors logged + skipped (never aborting the
// tenant loop or panicking the ticker). The scheduler only DECIDES + DISPATCHES; the
// registry owns the actual rotation + the audit. Secrets are never logged.
type IntegrationRotationMonitor struct {
	registry integrationRotationRegistry
	policy   integration.RotationPolicy
	interval time.Duration
	logger   zerolog.Logger
	now      func() time.Time
}

// NewIntegrationRotationMonitor builds the scheduler. interval is the TICK cadence
// (how often the scheduler wakes and re-evaluates rotation due-ness), NOT the
// per-endpoint rotation cadence (that comes from each endpoint's rotate_every_days).
// reminderDays is the look-ahead window for the due-soon warning. A non-positive
// interval defaults to 6h (rotation is a slow-moving concern), mirroring
// NewIntegrationSyncMonitor's guard shape.
func NewIntegrationRotationMonitor(registry integrationRotationRegistry, interval time.Duration, reminderDays int, logger zerolog.Logger) *IntegrationRotationMonitor {
	if interval <= 0 {
		interval = 6 * time.Hour
	}
	return &IntegrationRotationMonitor{
		registry: registry,
		policy:   integration.NewRotationPolicy(reminderDays),
		interval: interval,
		logger:   logger.With().Str("component", "lex-integration-rotation-monitor").Logger(),
		now:      time.Now,
	}
}

func (m *IntegrationRotationMonitor) Run(ctx context.Context) error {
	if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
		m.logger.Error().Err(err).Msg("integration rotation monitor iteration failed")
	}

	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
				m.logger.Error().Err(err).Msg("integration rotation monitor iteration failed")
			}
		}
	}
}

// RunOnce performs a single cross-tenant rotation sweep. Tenant-level errors are
// joined + returned (so the ticker logs them); per-endpoint errors are logged +
// swallowed so one bad endpoint never starves the rest.
func (m *IntegrationRotationMonitor) RunOnce(ctx context.Context) error {
	if m.registry == nil {
		return fmt.Errorf("integration rotation monitor registry is not configured")
	}
	tenantIDs, err := m.registry.ListTenantIDs(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, tenantID := range tenantIDs {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := m.processTenant(ctx, tenantID); err != nil {
			errs = append(errs, fmt.Errorf("tenant %s: %w", tenantID, err))
		}
	}
	return errors.Join(errs...)
}

// processTenant evaluates the rotation policy for every active endpoint of one
// tenant, reminding on due-soon/overdue fields and auto-rotating the overdue ones for
// auto-rotation-enabled endpoints. A failure to enumerate endpoints is a tenant-level
// error (returned, then joined). A single endpoint's reminder/rotation failure is
// logged + skipped.
func (m *IntegrationRotationMonitor) processTenant(ctx context.Context, tenantID uuid.UUID) error {
	endpoints, err := m.registry.List(ctx, tenantID, "", string(model.IntegrationStatusActive))
	if err != nil {
		return fmt.Errorf("list endpoints: %w", err)
	}
	now := m.now().UTC()
	for i := range endpoints {
		// Honour cancellation between endpoints so a leadership loss / shutdown
		// stops auto-rotating secrets promptly instead of finishing the tenant.
		if err := ctx.Err(); err != nil {
			return err
		}
		endpoint := endpoints[i]
		if endpoint.Status != model.IntegrationStatusActive {
			continue
		}
		fields := m.policy.Evaluate(endpoint, now)
		if len(fields) == 0 {
			// No rotation policy, or every secret comfortably within window.
			continue
		}
		// Collect due-soon + overdue for the reminder; overdue for auto-rotate.
		var warn []integration.RotationField
		var overdue []integration.RotationField
		for _, f := range fields {
			switch f.Status {
			case integration.RotationStatusDueSoon:
				warn = append(warn, f)
			case integration.RotationStatusOverdue:
				warn = append(warn, f)
				overdue = append(overdue, f)
			}
		}
		if len(warn) > 0 {
			if rerr := m.registry.EmitRotationReminder(ctx, tenantID, endpoint.ID, warn); rerr != nil {
				m.logger.Error().
					Err(rerr).
					Str("tenant_id", tenantID.String()).
					Str("endpoint_id", endpoint.ID.String()).
					Msg("integration rotation reminder failed")
			}
		}
		if len(overdue) > 0 && autoRotateEnabled(endpoint) {
			for _, f := range overdue {
				rotated, aerr := m.registry.AutoRotateSecret(ctx, tenantID, endpoint.ID, f.Field)
				if aerr != nil {
					m.logger.Error().
						Err(aerr).
						Str("tenant_id", tenantID.String()).
						Str("endpoint_id", endpoint.ID.String()).
						Str("field", f.Field).
						Msg("integration secret auto-rotation failed")
					continue
				}
				if rotated {
					m.logger.Info().
						Str("tenant_id", tenantID.String()).
						Str("endpoint_id", endpoint.ID.String()).
						Str("field", f.Field).
						Msg("integration secret auto-rotated")
				}
			}
		}
	}
	return nil
}

// autoRotateEnabled reports whether the endpoint opted into automatic rotation via the
// non-secret config flag auto_rotate (default false). When false, the monitor only
// reminds (a human rotates via the registry RotateSecret API).
func autoRotateEnabled(endpoint model.IntegrationEndpoint) bool {
	if endpoint.Config == nil {
		return false
	}
	switch v := endpoint.Config["auto_rotate"].(type) {
	case bool:
		return v
	case string:
		return v == "true" || v == "1"
	default:
		return false
	}
}
