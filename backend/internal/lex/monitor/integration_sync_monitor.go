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

// integrationSyncRegistry is the seam the scheduler drives. It is satisfied by
// *service.IntegrationRegistryService. Keeping it an interface (mirroring
// slaProcessor) lets the monitor be unit-tested with a fake and avoids importing
// the concrete service in the monitor's own type.
type integrationSyncRegistry interface {
	// ListTenantIDs enumerates tenants with at least one live endpoint.
	ListTenantIDs(ctx context.Context) ([]uuid.UUID, error)
	// List returns a tenant's endpoints (config is masked; non-secret fields such
	// as sync_interval_minutes are echoed verbatim, so the scheduler can read the
	// cadence without ever touching secrets).
	List(ctx context.Context, tenantID uuid.UUID, kind, status string) ([]model.IntegrationEndpoint, error)
	// SupportsSync reports whether the adapter for a kind implements Syncer.
	SupportsSync(kind model.IntegrationKind) bool
	// LastSuccessfulSyncByEndpoint maps endpoint -> last succeeded/partial finish
	// time for a tenant (absent ⇒ never synced).
	LastSuccessfulSyncByEndpoint(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]time.Time, error)
	// SyncNow dispatches a pull for one endpoint and appends a ledger row. The trailing
	// force flag bypasses the mass-change guard (extensibility #20); the scheduler always
	// passes false so a runaway feed is blocked, not silently applied.
	SyncNow(ctx context.Context, tenantID, userID, id uuid.UUID, mode integration.SyncMode, force bool) (*integration.SyncReport, error)
}

// IntegrationSyncMonitor is the background ticker that runs the lex Integration
// Platform's PULL connectors on a schedule. It mirrors ExpiryMonitor (Run/RunOnce
// + ticker) and SLAMonitor/ProximityMonitor (cross-tenant fan-out via
// ListTenantIDs). Each tick it scans every tenant's ACTIVE endpoints whose adapter
// implements Syncer, computes whether each is DUE (now - last successful sync >=
// the endpoint's configured sync_interval), and calls SyncNow for the due ones —
// FULL on the first ever sync, DELTA thereafter.
//
// Idempotence & resilience: the scheduler only DECIDES and DISPATCHES; SyncNow
// itself is idempotent at the connector level (delta against the stored
// watermark). A per-endpoint error is logged and skipped — it never aborts the
// tenant loop or panics the ticker. An endpoint with no configured interval, or
// in a planned/disabled/error status, is skipped (on-demand sync only).
type IntegrationSyncMonitor struct {
	registry integrationSyncRegistry
	actorID  uuid.UUID
	interval time.Duration
	logger   zerolog.Logger
	now      func() time.Time
}

// NewIntegrationSyncMonitor builds the scheduler. interval is the TICK cadence
// (how often the scheduler wakes up and re-evaluates "due"), NOT the per-endpoint
// pull cadence — that comes from each endpoint's sync_interval_minutes config. A
// non-positive interval defaults to 5m, mirroring NewSLAMonitor's guard.
func NewIntegrationSyncMonitor(registry integrationSyncRegistry, interval time.Duration, logger zerolog.Logger) *IntegrationSyncMonitor {
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	return &IntegrationSyncMonitor{
		registry: registry,
		actorID:  systemActorID,
		interval: interval,
		logger:   logger.With().Str("component", "lex-integration-sync-monitor").Logger(),
		now:      time.Now,
	}
}

func (m *IntegrationSyncMonitor) Run(ctx context.Context) error {
	if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
		m.logger.Error().Err(err).Msg("integration sync monitor iteration failed")
	}

	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
				m.logger.Error().Err(err).Msg("integration sync monitor iteration failed")
			}
		}
	}
}

// RunOnce performs a single cross-tenant sweep. Tenant-level errors are joined
// and returned (so the ticker logs them); per-endpoint errors are logged and
// swallowed so one bad connector never starves the rest.
func (m *IntegrationSyncMonitor) RunOnce(ctx context.Context) error {
	if m.registry == nil {
		return fmt.Errorf("integration sync monitor registry is not configured")
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

// processTenant syncs every due, syncer-capable, active endpoint for one tenant.
// A failure to enumerate the tenant's endpoints or its sync-run history is a
// tenant-level error (returned, then joined). A single endpoint's sync failure is
// logged and skipped — it does not abort the tenant.
func (m *IntegrationSyncMonitor) processTenant(ctx context.Context, tenantID uuid.UUID) error {
	endpoints, err := m.registry.List(ctx, tenantID, "", string(model.IntegrationStatusActive))
	if err != nil {
		return fmt.Errorf("list endpoints: %w", err)
	}
	if len(endpoints) == 0 {
		return nil
	}
	lastByEndpoint, err := m.registry.LastSuccessfulSyncByEndpoint(ctx, tenantID)
	if err != nil {
		return fmt.Errorf("load last-sync history: %w", err)
	}

	now := m.now().UTC()
	for i := range endpoints {
		// Honour cancellation between endpoints so a leadership loss / shutdown
		// stops dispatching MUTATING syncs promptly instead of finishing the whole
		// tenant. ctx.Err() is the single check; SyncNow itself also respects ctx.
		if err := ctx.Err(); err != nil {
			return err
		}
		endpoint := endpoints[i]
		// Defence-in-depth: List was filtered to active, but re-check so a future
		// caller change can't silently sync planned/disabled/error endpoints.
		if endpoint.Status != model.IntegrationStatusActive {
			continue
		}
		if !m.registry.SupportsSync(endpoint.Kind) {
			continue
		}
		interval, ok := integration.SyncInterval(endpoint.Config)
		if !ok {
			// No cadence configured ⇒ on-demand sync only; skip.
			continue
		}
		last, synced := lastByEndpoint[endpoint.ID]
		mode := integration.SyncModeDelta
		if !synced {
			// Never successfully synced ⇒ due now, run a FULL pull to seed.
			mode = integration.SyncModeFull
		} else if now.Sub(last) < interval {
			// Synced recently enough; not due yet.
			continue
		}

		// force=false: a scheduled sync RESPECTS the mass-change guard (extensibility
		// #20) — a runaway upstream feed deactivating an entire org tree is exactly what
		// the scheduler must not silently apply. A guard block surfaces as an error here,
		// logged like any other per-endpoint failure; an operator then forces it manually.
		if _, serr := m.registry.SyncNow(ctx, tenantID, m.actorID, endpoint.ID, mode, false); serr != nil {
			// Per-endpoint resilience: log and move on. SyncNow already recorded a
			// failed ledger row and stamped last_error; the next tick retries.
			m.logger.Error().
				Err(serr).
				Str("tenant_id", tenantID.String()).
				Str("endpoint_id", endpoint.ID.String()).
				Str("kind", string(endpoint.Kind)).
				Str("mode", string(mode)).
				Msg("scheduled integration sync failed")
			continue
		}
		m.logger.Debug().
			Str("tenant_id", tenantID.String()).
			Str("endpoint_id", endpoint.ID.String()).
			Str("kind", string(endpoint.Kind)).
			Str("mode", string(mode)).
			Msg("scheduled integration sync dispatched")
	}
	return nil
}
